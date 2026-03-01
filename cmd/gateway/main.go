// Command gateway is the HTTP/WebSocket bridge between the Raft cluster and
// the Next.js frontend.
//
// Usage:
//
//	gateway --addr=:8080 --nodes=A=node-a:50051,B=node-b:50052,...
//
// It opens a WatchState gRPC stream to every node and fans all state updates
// out to connected WebSocket clients. REST endpoints let the frontend submit
// commands and simulate node failures.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	pb "github.com/mehdiakiki/raft-core/gen/raft"
	"github.com/mehdiakiki/raft-demo/internal/gateway"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/proto"
)

type stateBroadcaster interface {
	Broadcast(v any)
}

func main() {
	addr := flag.String("addr", ":8080", "HTTP listen address")
	nodesFlag := flag.String("nodes", "", "comma-separated node list: ID=host:port,…")
	logLevel := flag.String("log-level", "info", "log level: debug, info, warn, error")
	duplicateIntervalFlag := flag.Duration(
		"duplicate-interval",
		1*time.Second,
		"minimum interval for forwarding unchanged state frames (0 disables duplicate rebroadcast)",
	)
	resyncIntervalFlag := flag.Duration(
		"resync-interval",
		5*time.Second,
		"low-frequency forced state resync interval for UI drift correction (0 disables forced resync)",
	)
	candidateVisualMinFlag := flag.Duration(
		"candidate-visual-min",
		400*time.Millisecond,
		"minimum CANDIDATE visibility before forwarding LEADER state/transition (0 disables buffering)",
	)
	flag.Parse()

	level, err := parseLogLevel(*logLevel)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: level,
	})))

	clients, err := connectNodes(*nodesFlag)
	if err != nil {
		slog.Error("failed to connect to nodes", "err", err)
		os.Exit(1)
	}

	hub := gateway.NewHub()
	mux := http.NewServeMux()
	gateway.RegisterRoutes(mux, clients, hub)

	// CORS middleware for local development.
	handler := corsMiddleware(mux)

	srv := &http.Server{Addr: *addr, Handler: handler}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	duplicateInterval := normalizeDuplicateInterval(*duplicateIntervalFlag)
	resyncInterval := normalizeResyncInterval(*resyncIntervalFlag)
	candidateVisualMin := normalizeCandidateVisualMin(*candidateVisualMinFlag)
	slog.Info("duplicate state forwarding configured", "interval", duplicateInterval)
	slog.Info("forced resync configured", "interval", resyncInterval)
	slog.Info("candidate visibility buffering configured", "min", candidateVisualMin)

	// Subscribe to state streams from every node and broadcast updates.
	for id, client := range clients {
		go watchNode(ctx, id, client, hub, duplicateInterval, candidateVisualMin)
		go runForcedResync(ctx, id, client, hub, resyncInterval)
	}

	go func() {
		slog.Info("gateway started", "addr", *addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("HTTP server error", "err", err)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down gateway")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
}

// watchNode opens a WatchState stream from the given node and broadcasts every
// received state update to all connected WebSocket clients.
func watchNode(
	ctx context.Context,
	nodeID string,
	client pb.RaftServiceClient,
	broadcaster stateBroadcaster,
	duplicateInterval time.Duration,
	candidateVisualMin time.Duration,
) {
	var (
		lastBroadcast         *pb.NodeStateReply
		lastObserved          *pb.NodeStateReply
		lastSentAt            time.Time
		candidateVisibleUntil time.Time
	)

	for {
		if ctx.Err() != nil {
			return
		}

		stream, err := client.WatchState(ctx, &pb.WatchStateRequest{})
		if err != nil {
			slog.Warn("WatchState stream error, retrying", "node", nodeID, "err", err)
			time.Sleep(500 * time.Millisecond)
			continue
		}

		slog.Info("watching node state", "node", nodeID)
		for {
			update, err := stream.Recv()
			if err != nil {
				slog.Warn("WatchState recv error, reconnecting", "node", nodeID, "err", err)
				time.Sleep(500 * time.Millisecond)
				break
			}

			state := update.GetState()
			if state == nil {
				continue
			}

			now := time.Now()
			transitions := buildTransitionEvents(lastObserved, state, now)
			for _, transition := range transitions {
				event := transition
				if event.To == "CANDIDATE" && candidateVisualMin > 0 {
					holdUntil := now.Add(candidateVisualMin)
					if holdUntil.After(candidateVisibleUntil) {
						candidateVisibleUntil = holdUntil
					}
				}
				if delay := leaderForwardDelay(now, candidateVisibleUntil, event.To); delay > 0 {
					slog.Debug("delaying leader forwarding to preserve candidate visibility",
						"node", nodeID,
						"delay", delay,
						"candidateVisibleUntil", candidateVisibleUntil,
					)
					if !waitForCandidateVisibility(ctx, delay) {
						return
					}
					now = time.Now()
				}
				slog.Debug("forwarding state transition event",
					"node", event.NodeID,
					"from", event.From,
					"to", event.To,
					"term", event.Term,
					"inferred", event.Inferred,
					"at", event.AtUnixMs,
				)
				broadcaster.Broadcast(&event)
			}
			lastObserved = proto.Clone(state).(*pb.NodeStateReply)

			if delay := leaderForwardDelay(now, candidateVisibleUntil, state.GetState()); delay > 0 {
				slog.Debug("delaying leader state forwarding to preserve candidate visibility",
					"node", nodeID,
					"delay", delay,
					"candidateVisibleUntil", candidateVisibleUntil,
				)
				if !waitForCandidateVisibility(ctx, delay) {
					return
				}
				now = time.Now()
			}

			if !shouldBroadcastState(state, lastBroadcast, now, lastSentAt, duplicateInterval) {
				continue
			}

			broadcaster.Broadcast(state)
			lastBroadcast = proto.Clone(state).(*pb.NodeStateReply)
			lastSentAt = now
		}
	}
}

// runForcedResync periodically fetches and broadcasts the current node state
// even when no stream-visible changes happened, so UIs can re-anchor local
// interpolation over time.
func runForcedResync(
	ctx context.Context,
	nodeID string,
	client pb.RaftServiceClient,
	broadcaster stateBroadcaster,
	interval time.Duration,
) {
	interval = normalizeResyncInterval(interval)
	if interval == 0 {
		return
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			forcedResyncOnce(ctx, nodeID, client, broadcaster)
		}
	}
}

// normalizeDuplicateInterval sanitises duplicate-frame forwarding interval.
// Negative values are coerced to zero (disable duplicate rebroadcast).
func normalizeDuplicateInterval(interval time.Duration) time.Duration {
	if interval < 0 {
		return 0
	}
	return interval
}

// normalizeResyncInterval sanitises forced-resync interval.
// Negative values are coerced to zero (disable forced resync).
func normalizeResyncInterval(interval time.Duration) time.Duration {
	if interval < 0 {
		return 0
	}
	return interval
}

// normalizeCandidateVisualMin sanitises the candidate visibility delay.
// Negative values are coerced to zero (disable delay).
func normalizeCandidateVisualMin(interval time.Duration) time.Duration {
	if interval < 0 {
		return 0
	}
	return interval
}

func leaderForwardDelay(now, candidateVisibleUntil time.Time, toState string) time.Duration {
	if toState != "LEADER" {
		return 0
	}
	if candidateVisibleUntil.IsZero() || !now.Before(candidateVisibleUntil) {
		return 0
	}
	return candidateVisibleUntil.Sub(now)
}

func waitForCandidateVisibility(ctx context.Context, delay time.Duration) bool {
	if delay <= 0 {
		return true
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-ctx.Done():
		return false
	}
}

// shouldBroadcastState decides whether a state frame should be forwarded.
func shouldBroadcastState(
	state *pb.NodeStateReply,
	lastBroadcast *pb.NodeStateReply,
	now time.Time,
	lastSentAt time.Time,
	duplicateInterval time.Duration,
) bool {
	if state == nil {
		return false
	}
	if lastBroadcast == nil {
		return true
	}
	if !proto.Equal(state, lastBroadcast) {
		return true
	}
	// Identical frame: optionally rebroadcast as low-frequency liveness signal.
	if duplicateInterval <= 0 {
		return false
	}
	return now.Sub(lastSentAt) >= duplicateInterval
}

// buildTransitionEvents computes role-transition events between two successive
// observed snapshots for one node.
func buildTransitionEvents(
	previous *pb.NodeStateReply,
	current *pb.NodeStateReply,
	now time.Time,
) []gateway.StateTransitionEvent {
	if previous == nil || current == nil {
		return nil
	}
	if previous.State == current.State {
		return nil
	}

	if shouldInferCandidateTransition(previous.State, current.State) {
		return []gateway.StateTransitionEvent{
			gateway.NewStateTransitionEvent(current.NodeId, previous.State, "CANDIDATE", current.CurrentTerm, true, now),
			gateway.NewStateTransitionEvent(current.NodeId, "CANDIDATE", "LEADER", current.CurrentTerm, true, now),
		}
	}

	return []gateway.StateTransitionEvent{
		gateway.NewStateTransitionEvent(current.NodeId, previous.State, current.State, current.CurrentTerm, false, now),
	}
}

func shouldInferCandidateTransition(from, to string) bool {
	if to != "LEADER" {
		return false
	}
	if from == "" || from == "LEADER" || from == "CANDIDATE" {
		return false
	}
	return true
}

// forcedResyncOnce fetches a point-in-time state snapshot and broadcasts it.
func forcedResyncOnce(
	ctx context.Context,
	nodeID string,
	client pb.RaftServiceClient,
	broadcaster stateBroadcaster,
) {
	state, err := client.GetState(ctx, &pb.GetStateRequest{NodeId: nodeID})
	if err != nil {
		slog.Warn("forced resync GetState failed", "node", nodeID, "err", err)
		return
	}
	if state == nil {
		return
	}
	broadcaster.Broadcast(state)
}

// connectNodes parses "--nodes=A=node-a:50051,B=node-b:50052" and dials each.
func connectNodes(flag string) (gateway.NodeClients, error) {
	clients := make(gateway.NodeClients)
	if flag == "" {
		return clients, nil
	}

	for _, pair := range strings.Split(flag, ",") {
		parts := strings.SplitN(pair, "=", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid node spec %q (expected ID=host:port)", pair)
		}
		nodeID, addr := parts[0], parts[1]

		conn, err := grpc.NewClient(addr,
			grpc.WithTransportCredentials(insecure.NewCredentials()),
		)
		if err != nil {
			return nil, fmt.Errorf("could not dial node %s at %s: %w", nodeID, addr, err)
		}
		clients[nodeID] = pb.NewRaftServiceClient(conn)
		slog.Info("connected to node", "node", nodeID, "addr", addr)
	}
	return clients, nil
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func parseLogLevel(raw string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return slog.LevelInfo, fmt.Errorf("invalid --log-level %q (allowed: debug, info, warn, error)", raw)
	}
}
