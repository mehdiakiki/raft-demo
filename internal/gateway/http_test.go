package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	pb "github.com/mehdiakiki/raft-core/gen/raft"
	"google.golang.org/grpc"
)

// ── Mock ──────────────────────────────────────────────────────────────────────

// mockRaftClient is a minimal stub of pb.RaftServiceClient for HTTP handler tests.
type mockRaftClient struct {
	stateReply   *pb.NodeStateReply
	stateErr     error
	commandReply *pb.SubmitCommandReply
	commandErr   error
	aliveReply   *pb.SetAliveReply
	aliveErr     error
	readReply    *pb.ReadIndexReply
	readErr      error
}

func (m *mockRaftClient) RequestVote(_ context.Context, _ *pb.RequestVoteArgs, _ ...grpc.CallOption) (*pb.RequestVoteReply, error) {
	return nil, nil
}
func (m *mockRaftClient) AppendEntries(_ context.Context, _ *pb.AppendEntriesArgs, _ ...grpc.CallOption) (*pb.AppendEntriesReply, error) {
	return nil, nil
}
func (m *mockRaftClient) PreVote(_ context.Context, _ *pb.PreVoteArgs, _ ...grpc.CallOption) (*pb.PreVoteReply, error) {
	return nil, nil
}
func (m *mockRaftClient) GetState(_ context.Context, _ *pb.GetStateRequest, _ ...grpc.CallOption) (*pb.NodeStateReply, error) {
	return m.stateReply, m.stateErr
}
func (m *mockRaftClient) WatchState(_ context.Context, _ *pb.WatchStateRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[pb.NodeStateUpdate], error) {
	return nil, nil
}
func (m *mockRaftClient) SubmitCommand(_ context.Context, _ *pb.SubmitCommandRequest, _ ...grpc.CallOption) (*pb.SubmitCommandReply, error) {
	return m.commandReply, m.commandErr
}
func (m *mockRaftClient) SetAlive(_ context.Context, _ *pb.SetAliveRequest, _ ...grpc.CallOption) (*pb.SetAliveReply, error) {
	return m.aliveReply, m.aliveErr
}
func (m *mockRaftClient) ReadIndex(_ context.Context, _ *pb.ReadIndexRequest, _ ...grpc.CallOption) (*pb.ReadIndexReply, error) {
	return m.readReply, m.readErr
}
func (m *mockRaftClient) InstallSnapshot(_ context.Context, _ *pb.InstallSnapshotArgs, _ ...grpc.CallOption) (*pb.InstallSnapshotReply, error) {
	return nil, nil
}

// ── Tests: GET /api/nodes/{id}/state ─────────────────────────────────────────

// TestHandleNodeState_ReturnsState_WhenNodeExists verifies that the endpoint
// returns a JSON-encoded state for a known node.
func TestHandleNodeState_ReturnsState_WhenNodeExists(t *testing.T) {
	// Arrange
	clients := NodeClients{
		"n1": &mockRaftClient{
			stateReply: &pb.NodeStateReply{
				NodeId:      "n1",
				State:       "LEADER",
				CurrentTerm: 3,
				CommitIndex: 5,
				LastApplied: 5,
				LeaderId:    "n1",
				NextIndex:   map[string]int64{"n2": 6, "n3": 6},
				MatchIndex:  map[string]int64{"n2": 5, "n3": 5},
			},
		},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/nodes/{id}/state", handleNodeState(clients))
	req := httptest.NewRequest("GET", "/api/nodes/n1/state", nil)
	w := httptest.NewRecorder()

	// Act
	mux.ServeHTTP(w, req)

	// Assert
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body["state"] != "LEADER" {
		t.Errorf("expected state=LEADER, got %v", body["state"])
	}
	if body["current_term"] != float64(3) {
		t.Errorf("expected current_term=3, got %v", body["current_term"])
	}
}

// TestHandleNodeState_ReturnsNotFound_ForUnknownNode verifies 404 for unknown IDs.
func TestHandleNodeState_ReturnsNotFound_ForUnknownNode(t *testing.T) {
	// Arrange
	clients := NodeClients{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/nodes/{id}/state", handleNodeState(clients))
	req := httptest.NewRequest("GET", "/api/nodes/ghost/state", nil)
	w := httptest.NewRecorder()

	// Act
	mux.ServeHTTP(w, req)

	// Assert
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// TestHandleNodeState_IncludesReplicationState_WhenLeader verifies that
// next_index and match_index are present in the response for a leader.
func TestHandleNodeState_IncludesReplicationState_WhenLeader(t *testing.T) {
	// Arrange
	clients := NodeClients{
		"n1": &mockRaftClient{
			stateReply: &pb.NodeStateReply{
				NodeId:     "n1",
				State:      "LEADER",
				NextIndex:  map[string]int64{"n2": 7},
				MatchIndex: map[string]int64{"n2": 6},
			},
		},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/nodes/{id}/state", handleNodeState(clients))
	req := httptest.NewRequest("GET", "/api/nodes/n1/state", nil)
	w := httptest.NewRecorder()

	// Act
	mux.ServeHTTP(w, req)

	// Assert
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body["next_index"] == nil {
		t.Error("expected next_index in response, got nil")
	}
	if body["match_index"] == nil {
		t.Error("expected match_index in response, got nil")
	}
}

// TestHandleNodeState_IncludesMetrics verifies that protocol counters are
// present in the serialized node state.
func TestHandleNodeState_IncludesMetrics(t *testing.T) {
	// Arrange
	clients := NodeClients{
		"n1": &mockRaftClient{
			stateReply: &pb.NodeStateReply{
				NodeId: "n1",
				State:  "LEADER",
				Metrics: &pb.ProtocolMetrics{
					ElectionsStarted:     2,
					ElectionsWon:         1,
					CommandsSubmitted:    7,
					CommandsApplied:      6,
					LogEntriesReplicated: 15,
					ReadIndexRequests:    4,
				},
			},
		},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/nodes/{id}/state", handleNodeState(clients))
	req := httptest.NewRequest("GET", "/api/nodes/n1/state", nil)
	w := httptest.NewRecorder()

	// Act
	mux.ServeHTTP(w, req)

	// Assert
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	metricsRaw, ok := body["metrics"].(map[string]any)
	if !ok {
		t.Fatalf("expected metrics object, got %T", body["metrics"])
	}
	if metricsRaw["commands_submitted"] != float64(7) {
		t.Fatalf("commands_submitted = %v, want 7", metricsRaw["commands_submitted"])
	}
	if metricsRaw["log_entries_replicated"] != float64(15) {
		t.Fatalf("log_entries_replicated = %v, want 15", metricsRaw["log_entries_replicated"])
	}
}

// ── Tests: GET /api/cluster/state ────────────────────────────────────────────

// TestHandleClusterState_ReturnsAllNodes verifies that all known nodes appear
// in the response.
func TestHandleClusterState_ReturnsAllNodes(t *testing.T) {
	// Arrange
	clients := NodeClients{
		"n1": &mockRaftClient{stateReply: &pb.NodeStateReply{NodeId: "n1", State: "LEADER"}},
		"n2": &mockRaftClient{stateReply: &pb.NodeStateReply{NodeId: "n2", State: "FOLLOWER"}},
		"n3": &mockRaftClient{stateReply: &pb.NodeStateReply{NodeId: "n3", State: "FOLLOWER"}},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/cluster/state", handleClusterState(clients))
	req := httptest.NewRequest("GET", "/api/cluster/state", nil)
	w := httptest.NewRecorder()

	// Act
	mux.ServeHTTP(w, req)

	// Assert
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	nodes, ok := body["nodes"].([]any)
	if !ok {
		t.Fatalf("expected nodes array, got %T", body["nodes"])
	}
	if len(nodes) != 3 {
		t.Errorf("expected 3 nodes, got %d", len(nodes))
	}
}

// TestHandleClusterState_PartialFailure_StillReturns verifies that a single
// unreachable node doesn't prevent the other nodes from being returned.
func TestHandleClusterState_PartialFailure_StillReturns(t *testing.T) {
	// Arrange: n2 is unreachable.
	clients := NodeClients{
		"n1": &mockRaftClient{stateReply: &pb.NodeStateReply{NodeId: "n1", State: "LEADER"}},
		"n2": &mockRaftClient{stateErr: &grpcError{"connection refused"}},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/cluster/state", handleClusterState(clients))
	req := httptest.NewRequest("GET", "/api/cluster/state", nil)
	w := httptest.NewRecorder()

	// Act
	mux.ServeHTTP(w, req)

	// Assert: still 200 with both entries (one with an error field)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 even with partial failure, got %d", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	nodes := body["nodes"].([]any)
	if len(nodes) != 2 {
		t.Errorf("expected 2 nodes, got %d", len(nodes))
	}
}

// ── Tests: POST /api/command ──────────────────────────────────────────────────

// TestHandleCommand_SuccessOnLeader verifies that a command submitted to a
// leader is forwarded and a success response is returned.
func TestHandleCommand_SuccessOnLeader(t *testing.T) {
	// Arrange
	clients := NodeClients{
		"n1": &mockRaftClient{
			commandReply: &pb.SubmitCommandReply{
				Success:   true,
				LeaderId:  "n1",
				Committed: true,
				Result:    "set x=1",
			},
		},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/command", handleCommand(clients))
	body := `{"command":"set x=1","client_id":"c1","sequence_num":1}`
	req := httptest.NewRequest("POST", "/api/command", strings.NewReader(body))
	w := httptest.NewRecorder()

	// Act
	mux.ServeHTTP(w, req)

	// Assert
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["success"] != true {
		t.Errorf("expected success=true, got %v", resp["success"])
	}
	if resp["committed"] != true {
		t.Errorf("expected committed=true, got %v", resp["committed"])
	}
	if resp["result"] != "set x=1" {
		t.Errorf("expected result='set x=1', got %v", resp["result"])
	}
}

// TestHandleCommand_BadRequest_WhenBodyMissingCommand verifies 400 on missing command.
func TestHandleCommand_BadRequest_WhenBodyMissingCommand(t *testing.T) {
	// Arrange
	clients := NodeClients{}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/command", handleCommand(clients))
	req := httptest.NewRequest("POST", "/api/command", strings.NewReader(`{}`))
	w := httptest.NewRecorder()

	// Act
	mux.ServeHTTP(w, req)

	// Assert
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ── helpers ───────────────────────────────────────────────────────────────────

// grpcError is a minimal error type used to simulate gRPC transport errors.
type grpcError struct{ msg string }

func (e *grpcError) Error() string { return e.msg }
