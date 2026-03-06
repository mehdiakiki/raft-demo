package gateway

import (
	"context"
	"log/slog"

	pb "github.com/mehdiakiki/raft-core/gen/raft"
)

type StateReceiver struct {
	pb.UnimplementedRaftGatewayServer
	Hub         *Hub
	NodeClients NodeClientMap
}

func (s *StateReceiver) PushState(ctx context.Context, event *pb.RaftStateEvent) (*pb.PushStateAck, error) {
	if event == nil {
		return &pb.PushStateAck{Received: false}, nil
	}

	slog.Debug("received state push",
		"node", event.NodeId,
		"state", event.State,
		"term", event.CurrentTerm,
		"time_ms", event.EventTimeMs,
	)

	s.Hub.CacheState(event.NodeId, event)
	s.Hub.Broadcast(event)

	return &pb.PushStateAck{Received: true}, nil
}

func (s *StateReceiver) PushRpc(ctx context.Context, event *pb.RaftRpcEvent) (*pb.PushRpcAck, error) {
	if event == nil {
		return &pb.PushRpcAck{Received: false}, nil
	}

	slog.Debug("received RPC push",
		"from", event.FromNode,
		"to", event.ToNode,
		"type", event.RpcType,
		"time_ms", event.EventTimeMs,
	)

	// Wrap the RPC event in a WebSocket message with type info
	msg := map[string]any{
		"type":          "rpc",
		"from_node":     event.FromNode,
		"to_node":       event.ToNode,
		"rpc_type":      event.RpcType,
		"event_time_ms": event.EventTimeMs,
		"rpc_id":        event.RpcId,
	}
	if event.Term != nil {
		msg["term"] = *event.Term
	}
	if event.CandidateId != nil {
		msg["candidate_id"] = *event.CandidateId
	}
	if event.VoteGranted != nil {
		msg["vote_granted"] = *event.VoteGranted
	}
	if event.Direction != nil {
		msg["direction"] = *event.Direction
	}
	s.Hub.Broadcast(msg)

	return &pb.PushRpcAck{Received: true}, nil
}
