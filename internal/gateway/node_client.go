package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	pb "github.com/mehdiakiki/raft-core/gen/raft"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type NodeClient struct {
	id     string
	addr   string
	client pb.RaftServiceClient
	conn   *grpc.ClientConn
	mu     sync.Mutex
}

type NodeClientMap map[string]*NodeClient

func NewNodeClientMap(nodeSpec string) (NodeClientMap, error) {
	clients := make(NodeClientMap)

	if nodeSpec == "" {
		return clients, nil
	}

	for _, pair := range strings.Split(nodeSpec, ",") {
		parts := strings.SplitN(pair, "=", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid node spec %q (expected ID=host:port)", pair)
		}
		nodeID, addr := parts[0], parts[1]

		clients[nodeID] = &NodeClient{
			id:   nodeID,
			addr: addr,
		}
		slog.Debug("registered node", "node", nodeID, "addr", addr)
	}

	return clients, nil
}

func (nc *NodeClient) connect() error {
	nc.mu.Lock()
	defer nc.mu.Unlock()

	if nc.client != nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.DialContext(ctx, nc.addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return fmt.Errorf("could not dial node %s at %s: %w", nc.id, nc.addr, err)
	}

	nc.conn = conn
	nc.client = pb.NewRaftServiceClient(conn)
	slog.Info("connected to node", "node", nc.id, "addr", nc.addr)
	return nil
}

func (m NodeClientMap) KillNode(nodeID string, alive bool) error {
	client, ok := m[nodeID]
	if !ok {
		return fmt.Errorf("node %s not found", nodeID)
	}

	if err := client.connect(); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := client.client.SetAlive(ctx, &pb.SetAliveRequest{Alive: alive})
	if err != nil {
		return fmt.Errorf("SetAlive RPC failed: %w", err)
	}

	slog.Info("node alive state changed", "node", nodeID, "alive", alive)
	return nil
}

func (m NodeClientMap) SubmitCommand(preferredNodeID string, req *pb.SubmitCommandRequest) (*pb.SubmitCommandReply, string, error) {
	if len(m) == 0 {
		return nil, "", fmt.Errorf("no nodes configured")
	}
	if req == nil || strings.TrimSpace(req.Command) == "" {
		return nil, "", fmt.Errorf("command is required")
	}

	queue := m.orderedNodeIDs(preferredNodeID)
	tried := make(map[string]bool, len(queue))

	var lastReply *pb.SubmitCommandReply
	var lastNode string
	var lastErr error

	for len(queue) > 0 {
		nodeID := queue[0]
		queue = queue[1:]
		if tried[nodeID] {
			continue
		}
		tried[nodeID] = true

		reply, err := m.submitCommandToNode(nodeID, req)
		if err != nil {
			lastErr = err
			continue
		}
		lastReply = reply
		lastNode = nodeID
		if reply.Success {
			return reply, nodeID, nil
		}

		leaderHint := strings.TrimSpace(reply.LeaderId)
		if leaderHint != "" && !tried[leaderHint] {
			if _, ok := m[leaderHint]; ok {
				// Try leader redirect immediately.
				queue = append([]string{leaderHint}, queue...)
			}
		}
	}

	if lastReply != nil {
		return lastReply, lastNode, nil
	}
	if lastErr != nil {
		return nil, "", lastErr
	}
	return &pb.SubmitCommandReply{Success: false}, "", nil
}

func (m NodeClientMap) submitCommandToNode(nodeID string, req *pb.SubmitCommandRequest) (*pb.SubmitCommandReply, error) {
	client, ok := m[nodeID]
	if !ok {
		return nil, fmt.Errorf("node %s not found", nodeID)
	}

	if err := client.connect(); err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	reply, err := client.client.SubmitCommand(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("SubmitCommand RPC failed on %s: %w", nodeID, err)
	}
	return reply, nil
}

func (m NodeClientMap) orderedNodeIDs(preferredNodeID string) []string {
	ids := make([]string, 0, len(m))
	for nodeID := range m {
		if nodeID == preferredNodeID {
			continue
		}
		ids = append(ids, nodeID)
	}
	sort.Strings(ids)

	if preferredNodeID == "" {
		return ids
	}
	if _, ok := m[preferredNodeID]; ok {
		return append([]string{preferredNodeID}, ids...)
	}
	return ids
}

func (m NodeClientMap) Close() {
	for _, client := range m {
		client.mu.Lock()
		if client.conn != nil {
			client.conn.Close()
		}
		client.mu.Unlock()
	}
}

func (s *StateReceiver) ServeKillNode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	nodeID := r.PathValue("id")
	if nodeID == "" {
		http.Error(w, "node ID required", http.StatusBadRequest)
		return
	}

	var req struct {
		Alive bool `json:"alive"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	if s.NodeClients == nil {
		http.Error(w, "node clients not configured", http.StatusServiceUnavailable)
		return
	}

	if err := s.NodeClients.KillNode(nodeID, req.Alive); err != nil {
		slog.Error("kill node failed", "node", nodeID, "err", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"node_id": nodeID,
		"alive":   req.Alive,
	})
}

func (s *StateReceiver) ServeSubmitCommand(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
	var req struct {
		Command     string `json:"command"`
		ClientID    string `json:"client_id"`
		SequenceNum int64  `json:"sequence_num"`
		LeaderID    string `json:"leader_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	req.Command = strings.TrimSpace(req.Command)
	if req.Command == "" {
		http.Error(w, "command is required", http.StatusBadRequest)
		return
	}

	if s.NodeClients == nil || len(s.NodeClients) == 0 {
		http.Error(w, "node clients not configured", http.StatusServiceUnavailable)
		return
	}

	reply, routedNode, err := s.NodeClients.SubmitCommand(strings.TrimSpace(req.LeaderID), &pb.SubmitCommandRequest{
		Command:     req.Command,
		ClientId:    req.ClientID,
		SequenceNum: req.SequenceNum,
	})
	if err != nil {
		slog.Error("submit command failed", "leader_hint", req.LeaderID, "err", err)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success":     reply.Success,
		"leader_id":   reply.LeaderId,
		"duplicate":   reply.Duplicate,
		"committed":   reply.Committed,
		"result":      reply.Result,
		"routed_node": routedNode,
	})
}
