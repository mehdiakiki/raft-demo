package gateway

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	pb "github.com/mehdiakiki/raft-core/gen/raft"
)

// NodeClients holds a gRPC client for each Raft node keyed by node ID.
type NodeClients map[string]pb.RaftServiceClient

// RegisterRoutes registers all HTTP routes on mux.
//
//	POST /api/command            – submit a client command to the leader
//	POST /api/read               – linearizable ReadIndex (§8)
//	GET  /api/nodes/{id}/state   – query a single node's state
//	GET  /api/cluster/state      – aggregate state for all nodes
//	POST /api/nodes/{id}/kill    – simulate node failure
//	POST /api/nodes/{id}/restart – bring a dead node back
//	GET  /ws                     – WebSocket upgrade (handled separately by hub)
func RegisterRoutes(mux *http.ServeMux, clients NodeClients, hub *Hub) {
	mux.HandleFunc("POST /api/command", handleCommand(clients))
	mux.HandleFunc("POST /api/read", handleReadIndex(clients))
	mux.HandleFunc("GET /api/nodes/{id}/state", handleNodeState(clients))
	mux.HandleFunc("GET /api/cluster/state", handleClusterState(clients))
	mux.HandleFunc("POST /api/nodes/{id}/kill", handleSetAlive(clients, false))
	mux.HandleFunc("POST /api/nodes/{id}/restart", handleSetAlive(clients, true))
	mux.HandleFunc("/ws", hub.ServeWS)
}

// handleCommand forwards a command to the leader node.
// If the targeted node is not the leader it returns 307 with a redirect hint.
func handleCommand(clients NodeClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Command     string `json:"command"`
			NodeID      string `json:"node_id,omitempty"`      // optional preferred node
			ClientID    string `json:"client_id,omitempty"`    // for deduplication (§8)
			SequenceNum int64  `json:"sequence_num,omitempty"` // for deduplication (§8)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Command == "" {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		// Try each node until we find the leader.
		for id, client := range clients {
			_ = id
			reply, err := client.SubmitCommand(context.Background(), &pb.SubmitCommandRequest{
				Command:     body.Command,
				ClientId:    body.ClientID,
				SequenceNum: body.SequenceNum,
			})
			if err != nil {
				slog.Warn("submit command error", "node", id, "err", err)
				continue
			}
			if reply.Success {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]any{
					"success":   true,
					"leader_id": reply.LeaderId,
					"duplicate": reply.Duplicate,
					"committed": reply.Committed,
					"result":    reply.Result,
				})
				return
			}
		}

		http.Error(w, "no leader available", http.StatusServiceUnavailable)
	}
}

// handleReadIndex performs a linearizable read by obtaining a safe read index
// from the leader (§8).  The response contains read_index which the client
// can use to confirm that the state machine is up-to-date before querying.
//
// Request body: { "read_id": "<unique-token>", "node_id": "<optional>" }
func handleReadIndex(clients NodeClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ReadID string `json:"read_id"`
			NodeID string `json:"node_id,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ReadID == "" {
			http.Error(w, "read_id is required", http.StatusBadRequest)
			return
		}

		// Try each node until a leader responds successfully.
		for id, client := range clients {
			_ = id
			reply, err := client.ReadIndex(r.Context(), &pb.ReadIndexRequest{ReadId: body.ReadID})
			if err != nil {
				slog.Warn("read index error", "node", id, "err", err)
				continue
			}
			if reply.Success {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]any{
					"success":    true,
					"read_index": reply.ReadIndex,
				})
				return
			}
		}

		http.Error(w, "no leader available", http.StatusServiceUnavailable)
	}
}

// handleSetAlive kills or restarts a specific node.
func handleSetAlive(clients NodeClients, alive bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		client, ok := clients[id]
		if !ok {
			http.Error(w, "unknown node id", http.StatusNotFound)
			return
		}

		reply, err := client.SetAlive(context.Background(), &pb.SetAliveRequest{Alive: alive})
		if err != nil {
			slog.Error("set alive error", "node", id, "err", err)
			http.Error(w, "rpc error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"node_id": id,
			"alive":   reply.Alive,
		})
	}
}

// handleNodeState returns the current state of a single Raft node.
//
//	GET /api/nodes/{id}/state
func handleNodeState(clients NodeClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		client, ok := clients[id]
		if !ok {
			http.Error(w, "unknown node id", http.StatusNotFound)
			return
		}

		reply, err := client.GetState(r.Context(), &pb.GetStateRequest{NodeId: id})
		if err != nil {
			slog.Error("get state error", "node", id, "err", err)
			http.Error(w, "rpc error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(nodeStateToMap(reply))
	}
}

// handleClusterState returns an aggregate view of all nodes in the cluster.
//
//	GET /api/cluster/state
func handleClusterState(clients NodeClients) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		nodes := make([]map[string]any, 0, len(clients))
		for id, client := range clients {
			reply, err := client.GetState(r.Context(), &pb.GetStateRequest{NodeId: id})
			if err != nil {
				slog.Warn("get state error", "node", id, "err", err)
				nodes = append(nodes, map[string]any{"node_id": id, "error": err.Error()})
				continue
			}
			nodes = append(nodes, nodeStateToMap(reply))
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"nodes": nodes})
	}
}

// nodeStateToMap converts a NodeStateReply proto to a JSON-serialisable map.
func nodeStateToMap(s *pb.NodeStateReply) map[string]any {
	// Convert log entries to a JSON-friendly slice.
	log := make([]map[string]any, len(s.Log))
	for i, e := range s.Log {
		log[i] = map[string]any{
			"term":         e.Term,
			"type":         int(e.Type),
			"command":      e.Command,
			"client_id":    e.ClientId,
			"sequence_num": e.SequenceNum,
		}
	}
	return map[string]any{
		"node_id":               s.NodeId,
		"state":                 s.State,
		"current_term":          s.CurrentTerm,
		"voted_for":             s.VotedFor,
		"commit_index":          s.CommitIndex,
		"last_applied":          s.LastApplied,
		"log":                   log,
		"leader_id":             s.LeaderId,
		"next_index":            s.NextIndex,
		"match_index":           s.MatchIndex,
		"heartbeat_interval_ms": s.HeartbeatIntervalMs,
		"election_timeout_ms":   s.ElectionTimeoutMs,
		"metrics": map[string]any{
			"elections_started":      s.GetMetrics().GetElectionsStarted(),
			"elections_won":          s.GetMetrics().GetElectionsWon(),
			"commands_submitted":     s.GetMetrics().GetCommandsSubmitted(),
			"commands_applied":       s.GetMetrics().GetCommandsApplied(),
			"log_entries_replicated": s.GetMetrics().GetLogEntriesReplicated(),
			"read_index_requests":    s.GetMetrics().GetReadIndexRequests(),
		},
	}
}
