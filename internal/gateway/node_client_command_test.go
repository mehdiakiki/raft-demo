package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	pb "github.com/mehdiakiki/raft-core/gen/raft"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type mockRaftServiceClient struct {
	submitFn   func(ctx context.Context, in *pb.SubmitCommandRequest, opts ...grpc.CallOption) (*pb.SubmitCommandReply, error)
	setAliveFn func(ctx context.Context, in *pb.SetAliveRequest, opts ...grpc.CallOption) (*pb.SetAliveReply, error)
}

func (m *mockRaftServiceClient) RequestVote(context.Context, *pb.RequestVoteArgs, ...grpc.CallOption) (*pb.RequestVoteReply, error) {
	return nil, status.Error(codes.Unimplemented, "not implemented")
}

func (m *mockRaftServiceClient) AppendEntries(context.Context, *pb.AppendEntriesArgs, ...grpc.CallOption) (*pb.AppendEntriesReply, error) {
	return nil, status.Error(codes.Unimplemented, "not implemented")
}

func (m *mockRaftServiceClient) PreVote(context.Context, *pb.PreVoteArgs, ...grpc.CallOption) (*pb.PreVoteReply, error) {
	return nil, status.Error(codes.Unimplemented, "not implemented")
}

func (m *mockRaftServiceClient) InstallSnapshot(context.Context, *pb.InstallSnapshotArgs, ...grpc.CallOption) (*pb.InstallSnapshotReply, error) {
	return nil, status.Error(codes.Unimplemented, "not implemented")
}

func (m *mockRaftServiceClient) GetState(context.Context, *pb.GetStateRequest, ...grpc.CallOption) (*pb.NodeStateReply, error) {
	return nil, status.Error(codes.Unimplemented, "not implemented")
}

func (m *mockRaftServiceClient) WatchState(context.Context, *pb.WatchStateRequest, ...grpc.CallOption) (grpc.ServerStreamingClient[pb.NodeStateUpdate], error) {
	return nil, status.Error(codes.Unimplemented, "not implemented")
}

func (m *mockRaftServiceClient) SubmitCommand(ctx context.Context, in *pb.SubmitCommandRequest, opts ...grpc.CallOption) (*pb.SubmitCommandReply, error) {
	if m.submitFn == nil {
		return nil, status.Error(codes.Unimplemented, "not implemented")
	}
	return m.submitFn(ctx, in, opts...)
}

func (m *mockRaftServiceClient) SetAlive(ctx context.Context, in *pb.SetAliveRequest, opts ...grpc.CallOption) (*pb.SetAliveReply, error) {
	if m.setAliveFn == nil {
		return nil, status.Error(codes.Unimplemented, "not implemented")
	}
	return m.setAliveFn(ctx, in, opts...)
}

func (m *mockRaftServiceClient) ReadIndex(context.Context, *pb.ReadIndexRequest, ...grpc.CallOption) (*pb.ReadIndexReply, error) {
	return nil, status.Error(codes.Unimplemented, "not implemented")
}

func TestNodeClientMap_SubmitCommand_UsesLeaderRedirect(t *testing.T) {
	clients := NodeClientMap{
		"A": {
			id: "A",
			client: &mockRaftServiceClient{
				submitFn: func(context.Context, *pb.SubmitCommandRequest, ...grpc.CallOption) (*pb.SubmitCommandReply, error) {
					return &pb.SubmitCommandReply{Success: false, LeaderId: "B"}, nil
				},
			},
		},
		"B": {
			id: "B",
			client: &mockRaftServiceClient{
				submitFn: func(context.Context, *pb.SubmitCommandRequest, ...grpc.CallOption) (*pb.SubmitCommandReply, error) {
					return &pb.SubmitCommandReply{Success: true, LeaderId: "B", Committed: true}, nil
				},
			},
		},
	}

	reply, routedNode, err := clients.SubmitCommand("A", &pb.SubmitCommandRequest{
		Command:     `{"op":"set","key":"x","value":"1"}`,
		ClientId:    "client-1",
		SequenceNum: 1,
	})
	if err != nil {
		t.Fatalf("SubmitCommand returned error: %v", err)
	}
	if !reply.Success {
		t.Fatalf("expected successful submit reply, got %#v", reply)
	}
	if routedNode != "B" {
		t.Fatalf("expected routed node B after redirect, got %q", routedNode)
	}
}

func TestNodeClientMap_SubmitCommand_RejectsMissingCommand(t *testing.T) {
	clients := NodeClientMap{
		"A": {
			id: "A",
			client: &mockRaftServiceClient{
				submitFn: func(context.Context, *pb.SubmitCommandRequest, ...grpc.CallOption) (*pb.SubmitCommandReply, error) {
					return &pb.SubmitCommandReply{Success: true}, nil
				},
			},
		},
	}

	_, _, err := clients.SubmitCommand("A", &pb.SubmitCommandRequest{})
	if err == nil {
		t.Fatal("expected error for empty command")
	}
	if !strings.Contains(err.Error(), "command is required") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestNodeClientMap_SubmitCommand_FallsBackAfterTransportError(t *testing.T) {
	clients := NodeClientMap{
		"A": {
			id: "A",
			client: &mockRaftServiceClient{
				submitFn: func(context.Context, *pb.SubmitCommandRequest, ...grpc.CallOption) (*pb.SubmitCommandReply, error) {
					return nil, errors.New("temporary transport error")
				},
			},
		},
		"B": {
			id: "B",
			client: &mockRaftServiceClient{
				submitFn: func(context.Context, *pb.SubmitCommandRequest, ...grpc.CallOption) (*pb.SubmitCommandReply, error) {
					return &pb.SubmitCommandReply{
						Success:   false,
						LeaderId:  "C",
						Duplicate: true,
						Committed: false,
						Result:    "not leader",
					}, nil
				},
			},
		},
	}

	reply, routedNode, err := clients.SubmitCommand("A", &pb.SubmitCommandRequest{
		Command:     `{"op":"set","key":"x","value":"1"}`,
		ClientId:    "client-1",
		SequenceNum: 2,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if routedNode != "B" {
		t.Fatalf("expected fallback routed node B, got %q", routedNode)
	}
	if reply.Success {
		t.Fatalf("expected unsuccessful reply after fallback, got %#v", reply)
	}
	if !reply.Duplicate {
		t.Fatalf("expected duplicate=true from downstream reply, got %#v", reply)
	}
}

func TestStateReceiver_ServeSubmitCommand(t *testing.T) {
	var capturedReq *pb.SubmitCommandRequest
	receiver := &StateReceiver{
		NodeClients: NodeClientMap{
			"A": {
				id: "A",
				client: &mockRaftServiceClient{
					submitFn: func(_ context.Context, in *pb.SubmitCommandRequest, _ ...grpc.CallOption) (*pb.SubmitCommandReply, error) {
						capturedReq = in
						return &pb.SubmitCommandReply{
							Success:   true,
							LeaderId:  "A",
							Duplicate: false,
							Committed: true,
							Result:    "applied",
						}, nil
					},
				},
			},
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/commands", strings.NewReader(`{
		"command":"{\"op\":\"set\",\"key\":\"x\",\"value\":\"1\"}",
		"client_id":"client-1",
		"sequence_num":1,
		"leader_id":"A"
	}`))
	w := httptest.NewRecorder()

	receiver.ServeSubmitCommand(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected HTTP 200, got %d with body %s", w.Code, w.Body.String())
	}

	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if body["success"] != true {
		t.Fatalf("expected success=true, got %#v", body["success"])
	}
	if body["leader_id"] != "A" {
		t.Fatalf("expected leader_id=A, got %#v", body["leader_id"])
	}
	if body["duplicate"] != false {
		t.Fatalf("expected duplicate=false, got %#v", body["duplicate"])
	}
	if body["committed"] != true {
		t.Fatalf("expected committed=true, got %#v", body["committed"])
	}
	if body["result"] != "applied" {
		t.Fatalf("expected result=applied, got %#v", body["result"])
	}
	if body["routed_node"] != "A" {
		t.Fatalf("expected routed_node=A, got %#v", body["routed_node"])
	}
	if capturedReq == nil {
		t.Fatal("expected SubmitCommand request to be forwarded")
	}
	if capturedReq.Command != `{"op":"set","key":"x","value":"1"}` {
		t.Fatalf("unexpected command payload: %q", capturedReq.Command)
	}
	if capturedReq.ClientId != "client-1" {
		t.Fatalf("unexpected client id: %q", capturedReq.ClientId)
	}
	if capturedReq.SequenceNum != 1 {
		t.Fatalf("unexpected sequence num: %d", capturedReq.SequenceNum)
	}
}

func TestStateReceiver_ServeSubmitCommand_ValidationAndErrorPaths(t *testing.T) {
	receiver := &StateReceiver{
		NodeClients: NodeClientMap{
			"A": {
				id: "A",
				client: &mockRaftServiceClient{
					submitFn: func(_ context.Context, _ *pb.SubmitCommandRequest, _ ...grpc.CallOption) (*pb.SubmitCommandReply, error) {
						return nil, status.Error(codes.Unavailable, "upstream unavailable")
					},
				},
			},
		},
	}

	tests := []struct {
		name       string
		method     string
		body       string
		receiver   *StateReceiver
		statusCode int
	}{
		{
			name:       "method not allowed",
			method:     http.MethodGet,
			body:       ``,
			receiver:   receiver,
			statusCode: http.StatusMethodNotAllowed,
		},
		{
			name:       "invalid json",
			method:     http.MethodPost,
			body:       `{`,
			receiver:   receiver,
			statusCode: http.StatusBadRequest,
		},
		{
			name:       "missing command",
			method:     http.MethodPost,
			body:       `{"command":"   "}`,
			receiver:   receiver,
			statusCode: http.StatusBadRequest,
		},
		{
			name:       "no node clients",
			method:     http.MethodPost,
			body:       `{"command":"{\"op\":\"set\",\"key\":\"x\",\"value\":\"1\"}"}`,
			receiver:   &StateReceiver{},
			statusCode: http.StatusServiceUnavailable,
		},
		{
			name:       "upstream unavailable",
			method:     http.MethodPost,
			body:       `{"command":"{\"op\":\"set\",\"key\":\"x\",\"value\":\"1\"}"}`,
			receiver:   receiver,
			statusCode: http.StatusBadGateway,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "/api/commands", strings.NewReader(tc.body))
			w := httptest.NewRecorder()

			tc.receiver.ServeSubmitCommand(w, req)

			if w.Code != tc.statusCode {
				t.Fatalf("expected status %d, got %d (%s)", tc.statusCode, w.Code, w.Body.String())
			}
		})
	}
}
