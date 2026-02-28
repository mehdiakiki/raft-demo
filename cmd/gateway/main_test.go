package main

import (
	"context"
	"errors"
	"testing"
	"time"

	pb "github.com/medvih/raft-core/gen/raft"
	"google.golang.org/grpc"
)

type testBroadcaster struct {
	values []any
}

func (b *testBroadcaster) Broadcast(v any) {
	b.values = append(b.values, v)
}

type testRaftClient struct {
	getStateReply *pb.NodeStateReply
	getStateErr   error
	getStateCalls int
}

func (c *testRaftClient) RequestVote(context.Context, *pb.RequestVoteArgs, ...grpc.CallOption) (*pb.RequestVoteReply, error) {
	return nil, nil
}
func (c *testRaftClient) AppendEntries(context.Context, *pb.AppendEntriesArgs, ...grpc.CallOption) (*pb.AppendEntriesReply, error) {
	return nil, nil
}
func (c *testRaftClient) PreVote(context.Context, *pb.PreVoteArgs, ...grpc.CallOption) (*pb.PreVoteReply, error) {
	return nil, nil
}
func (c *testRaftClient) InstallSnapshot(context.Context, *pb.InstallSnapshotArgs, ...grpc.CallOption) (*pb.InstallSnapshotReply, error) {
	return nil, nil
}
func (c *testRaftClient) GetState(context.Context, *pb.GetStateRequest, ...grpc.CallOption) (*pb.NodeStateReply, error) {
	c.getStateCalls++
	return c.getStateReply, c.getStateErr
}
func (c *testRaftClient) WatchState(context.Context, *pb.WatchStateRequest, ...grpc.CallOption) (grpc.ServerStreamingClient[pb.NodeStateUpdate], error) {
	return nil, nil
}
func (c *testRaftClient) SubmitCommand(context.Context, *pb.SubmitCommandRequest, ...grpc.CallOption) (*pb.SubmitCommandReply, error) {
	return nil, nil
}
func (c *testRaftClient) SetAlive(context.Context, *pb.SetAliveRequest, ...grpc.CallOption) (*pb.SetAliveReply, error) {
	return nil, nil
}
func (c *testRaftClient) ReadIndex(context.Context, *pb.ReadIndexRequest, ...grpc.CallOption) (*pb.ReadIndexReply, error) {
	return nil, nil
}

func TestNormalizeDuplicateInterval(t *testing.T) {
	if got := normalizeDuplicateInterval(-1 * time.Second); got != 0 {
		t.Fatalf("negative interval should clamp to 0, got %v", got)
	}
	if got := normalizeDuplicateInterval(0); got != 0 {
		t.Fatalf("zero interval should stay 0, got %v", got)
	}
	if got := normalizeDuplicateInterval(250 * time.Millisecond); got != 250*time.Millisecond {
		t.Fatalf("positive interval should pass through, got %v", got)
	}
}

func TestNormalizeResyncInterval(t *testing.T) {
	if got := normalizeResyncInterval(-1 * time.Second); got != 0 {
		t.Fatalf("negative interval should clamp to 0, got %v", got)
	}
	if got := normalizeResyncInterval(0); got != 0 {
		t.Fatalf("zero interval should stay 0, got %v", got)
	}
	if got := normalizeResyncInterval(5 * time.Second); got != 5*time.Second {
		t.Fatalf("positive interval should pass through, got %v", got)
	}
}

func TestNormalizeCandidateVisualMin(t *testing.T) {
	if got := normalizeCandidateVisualMin(-1 * time.Second); got != 0 {
		t.Fatalf("negative interval should clamp to 0, got %v", got)
	}
	if got := normalizeCandidateVisualMin(0); got != 0 {
		t.Fatalf("zero interval should stay 0, got %v", got)
	}
	if got := normalizeCandidateVisualMin(400 * time.Millisecond); got != 400*time.Millisecond {
		t.Fatalf("positive interval should pass through, got %v", got)
	}
}

func TestShouldBroadcastState(t *testing.T) {
	now := time.Unix(1000, 0)
	lastSentAt := now.Add(-500 * time.Millisecond)
	interval := 1 * time.Second

	a := &pb.NodeStateReply{NodeId: "A", State: "FOLLOWER", CurrentTerm: 3}
	b := &pb.NodeStateReply{NodeId: "A", State: "FOLLOWER", CurrentTerm: 4}

	if shouldBroadcastState(nil, nil, now, lastSentAt, interval) {
		t.Fatal("nil state must not be broadcast")
	}
	if !shouldBroadcastState(a, nil, now, lastSentAt, interval) {
		t.Fatal("first state must be broadcast")
	}
	if shouldBroadcastState(a, a, now, lastSentAt, interval) {
		t.Fatal("duplicate within interval must be dropped")
	}
	if !shouldBroadcastState(a, a, now, now.Add(-2*time.Second), interval) {
		t.Fatal("duplicate past interval must be rebroadcast")
	}
	if !shouldBroadcastState(b, a, now, lastSentAt, interval) {
		t.Fatal("changed state must be broadcast immediately")
	}
	if shouldBroadcastState(a, a, now, now.Add(-2*time.Second), 0) {
		t.Fatal("duplicate rebroadcast must be disabled when interval=0")
	}
}

func TestLeaderForwardDelay(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	holdUntil := now.Add(500 * time.Millisecond)

	if got := leaderForwardDelay(now, holdUntil, "FOLLOWER"); got != 0 {
		t.Fatalf("non-leader transition should not be delayed, got %v", got)
	}
	if got := leaderForwardDelay(now, time.Time{}, "LEADER"); got != 0 {
		t.Fatalf("leader with no hold window should not be delayed, got %v", got)
	}
	if got := leaderForwardDelay(now.Add(1*time.Second), holdUntil, "LEADER"); got != 0 {
		t.Fatalf("leader past hold window should not be delayed, got %v", got)
	}
	if got := leaderForwardDelay(now, holdUntil, "LEADER"); got != 500*time.Millisecond {
		t.Fatalf("expected 500ms leader delay, got %v", got)
	}
}

func TestForcedResyncOnce_BroadcastsOnSuccess(t *testing.T) {
	client := &testRaftClient{
		getStateReply: &pb.NodeStateReply{NodeId: "A", CurrentTerm: 7, State: "FOLLOWER"},
	}
	broadcaster := &testBroadcaster{}

	forcedResyncOnce(context.Background(), "A", client, broadcaster)

	if client.getStateCalls != 1 {
		t.Fatalf("expected one GetState call, got %d", client.getStateCalls)
	}
	if len(broadcaster.values) != 1 {
		t.Fatalf("expected one broadcast, got %d", len(broadcaster.values))
	}

	state, ok := broadcaster.values[0].(*pb.NodeStateReply)
	if !ok {
		t.Fatalf("expected *pb.NodeStateReply, got %T", broadcaster.values[0])
	}
	if state.CurrentTerm != 7 {
		t.Fatalf("expected term 7 in broadcast state, got %d", state.CurrentTerm)
	}
}

func TestForcedResyncOnce_SkipsOnError(t *testing.T) {
	client := &testRaftClient{
		getStateErr: errors.New("boom"),
	}
	broadcaster := &testBroadcaster{}

	forcedResyncOnce(context.Background(), "A", client, broadcaster)

	if client.getStateCalls != 1 {
		t.Fatalf("expected one GetState call, got %d", client.getStateCalls)
	}
	if len(broadcaster.values) != 0 {
		t.Fatalf("expected no broadcasts on error, got %d", len(broadcaster.values))
	}
}

func TestForcedResyncOnce_SkipsOnNilReply(t *testing.T) {
	client := &testRaftClient{}
	broadcaster := &testBroadcaster{}

	forcedResyncOnce(context.Background(), "A", client, broadcaster)

	if client.getStateCalls != 1 {
		t.Fatalf("expected one GetState call, got %d", client.getStateCalls)
	}
	if len(broadcaster.values) != 0 {
		t.Fatalf("expected no broadcasts for nil state, got %d", len(broadcaster.values))
	}
}

func TestBuildTransitionEvents_EmitsDirectTransition(t *testing.T) {
	now := time.UnixMilli(1_700_000_000_000)
	prev := &pb.NodeStateReply{NodeId: "A", State: "FOLLOWER", CurrentTerm: 4}
	curr := &pb.NodeStateReply{NodeId: "A", State: "CANDIDATE", CurrentTerm: 5}

	events := buildTransitionEvents(prev, curr, now)
	if len(events) != 1 {
		t.Fatalf("expected one direct transition, got %d", len(events))
	}

	ev := events[0]
	if ev.NodeID != "A" || ev.From != "FOLLOWER" || ev.To != "CANDIDATE" {
		t.Fatalf("unexpected transition payload: %+v", ev)
	}
	if ev.Term != 5 {
		t.Fatalf("expected term 5, got %d", ev.Term)
	}
	if ev.Inferred {
		t.Fatalf("expected direct transition to be non-inferred, got inferred=true")
	}
}

func TestBuildTransitionEvents_InfersCandidateWhenStreamJumpsToLeader(t *testing.T) {
	now := time.UnixMilli(1_700_000_000_000)
	prev := &pb.NodeStateReply{NodeId: "A", State: "FOLLOWER", CurrentTerm: 4}
	curr := &pb.NodeStateReply{NodeId: "A", State: "LEADER", CurrentTerm: 5}

	events := buildTransitionEvents(prev, curr, now)
	if len(events) != 2 {
		t.Fatalf("expected inferred candidate+leader transitions, got %d", len(events))
	}

	first := events[0]
	if first.From != "FOLLOWER" || first.To != "CANDIDATE" || !first.Inferred {
		t.Fatalf("unexpected first inferred transition: %+v", first)
	}

	second := events[1]
	if second.From != "CANDIDATE" || second.To != "LEADER" || !second.Inferred {
		t.Fatalf("unexpected second inferred transition: %+v", second)
	}
}

func TestBuildTransitionEvents_NoEventWhenStateUnchanged(t *testing.T) {
	now := time.UnixMilli(1_700_000_000_000)
	prev := &pb.NodeStateReply{NodeId: "A", State: "FOLLOWER", CurrentTerm: 4}
	curr := &pb.NodeStateReply{NodeId: "A", State: "FOLLOWER", CurrentTerm: 4}

	events := buildTransitionEvents(prev, curr, now)
	if len(events) != 0 {
		t.Fatalf("expected no transition events, got %d", len(events))
	}
}
