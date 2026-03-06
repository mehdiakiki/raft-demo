package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	pb "github.com/mehdiakiki/raft-core/gen/raft"
)

func strPtr(s string) *string { return &s }
func int64Ptr(i int64) *int64 { return &i }

func TestStateReceiver_PushState(t *testing.T) {
	hub := NewHub()
	receiver := &StateReceiver{Hub: hub}

	event := &pb.RaftStateEvent{
		NodeId:      "node-1",
		State:       strPtr("LEADER"),
		CurrentTerm: int64Ptr(1),
		EventTimeMs: 12345,
		CommitIndex: int64Ptr(5),
		LeaderId:    strPtr("node-1"),
		VotedFor:    strPtr("node-1"),
	}

	ack, err := receiver.PushState(context.Background(), event)
	if err != nil {
		t.Fatalf("PushState returned error: %v", err)
	}
	if !ack.Received {
		t.Error("expected Received to be true")
	}
}

func TestStateReceiver_PushState_NilEvent(t *testing.T) {
	hub := NewHub()
	receiver := &StateReceiver{Hub: hub}

	ack, err := receiver.PushState(context.Background(), nil)
	if err != nil {
		t.Fatalf("PushState returned error: %v", err)
	}
	if ack.Received {
		t.Error("expected Received to be false for nil event")
	}
}

func TestStateReceiver_BroadcastsToHub(t *testing.T) {
	hub := NewHub()
	receiver := &StateReceiver{Hub: hub}

	event := &pb.RaftStateEvent{
		NodeId:      "node-2",
		State:       strPtr("FOLLOWER"),
		CurrentTerm: int64Ptr(2),
		LeaderId:    strPtr("node-1"),
	}

	_, err := receiver.PushState(context.Background(), event)
	if err != nil {
		t.Fatalf("PushState returned error: %v", err)
	}
	if _, ok := hub.latestState["node-2"]; !ok {
		t.Fatal("expected pushed node state to be cached for replay")
	}
}

func TestStateReceiver_PushRpc_NilEvent(t *testing.T) {
	hub := NewHub()
	receiver := &StateReceiver{Hub: hub}

	ack, err := receiver.PushRpc(context.Background(), nil)
	if err != nil {
		t.Fatalf("PushRpc returned error: %v", err)
	}
	if ack.Received {
		t.Error("expected Received=false for nil RPC event")
	}
}

func TestStateReceiver_PushRpc_BroadcastsRpcMetadata(t *testing.T) {
	hub := NewHub()
	receiver := &StateReceiver{Hub: hub}

	server := httptest.NewServer(http.HandlerFunc(hub.ServeWS))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer conn.Close()

	term := int64(7)
	candidateID := "A"
	voteGranted := false
	direction := "SEND"
	_, err = receiver.PushRpc(context.Background(), &pb.RaftRpcEvent{
		FromNode:    "B",
		ToNode:      "A",
		RpcType:     "VOTE_REPLY",
		EventTimeMs: 123456,
		RpcId:       "rv:reply:7:B:A",
		Term:        &term,
		CandidateId: &candidateID,
		VoteGranted: &voteGranted,
		Direction:   &direction,
	})
	if err != nil {
		t.Fatalf("PushRpc returned error: %v", err)
	}

	if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline failed: %v", err)
	}

	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage failed: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if payload["type"] != "rpc" {
		t.Fatalf("expected type=rpc, got %#v", payload["type"])
	}
	if payload["rpc_id"] != "rv:reply:7:B:A" {
		t.Fatalf("expected rpc_id in payload, got %#v", payload["rpc_id"])
	}
	if payload["candidate_id"] != "A" {
		t.Fatalf("expected candidate_id=A, got %#v", payload["candidate_id"])
	}
	if payload["direction"] != "SEND" {
		t.Fatalf("expected direction=SEND, got %#v", payload["direction"])
	}
	if payload["term"] != float64(7) {
		t.Fatalf("expected term=7, got %#v", payload["term"])
	}
	if payload["vote_granted"] != false {
		t.Fatalf("expected vote_granted=false, got %#v", payload["vote_granted"])
	}
}
