package gateway

import (
	"context"
	"log/slog"

	pb "github.com/mehdiakiki/raft-core/gen/raft"
)

type StateReceiver struct {
	pb.UnimplementedRaftGatewayServer
	Hub *Hub
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

	s.Hub.Broadcast(event)

	return &pb.PushStateAck{Received: true}, nil
}
