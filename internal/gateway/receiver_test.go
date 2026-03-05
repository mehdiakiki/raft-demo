package gateway

import (
	"context"
	"testing"

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
}
