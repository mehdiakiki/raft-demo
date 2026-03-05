# Raft Consensus Visualizer: Architecture and Evolution

This document is the concise architecture and engineering summary of the demo system.

## 1. What I Built

This project is a full-stack distributed systems demo of Raft:

- backend Raft nodes in Go (`raft-core`) implementing election, replication, commit/apply, snapshots, and kill/restart behavior
- Go gateway that receives pushed state events from nodes and broadcasts to WebSocket clients
- Next.js frontend that reconstructs and visualizes cluster behavior in real time
- Docker Compose orchestration for local multi-node simulation

The result is a live cluster with real-time observability, not a static animation.

## 2. Why This Project Is Technically Meaningful

The demo exercises:

- distributed systems invariants (term/vote/log/commit correctness)
- event-sourcing architecture (nodes push, frontend reconstructs)
- real-time client architecture (WebSocket streams with state reconstruction)
- failure simulation and recovery workflows
- cross-stack regression testing discipline

## 3. Core Engineering Decisions

1. Consensus correctness lives only in backend nodes.
2. Frontend is an observability/visualization consumer, not a protocol authority.
3. Nodes push state changes to gateway (event-sourcing), gateway does not poll.
4. Frontend reconstructs cluster state from event stream.
5. Timing telemetry is treated as backend authority and passed through explicitly.
6. Regression tests are added for every discovered behavior gap.

## 4. Concrete Work Driven in This Repo

- refactored from pull-based (WatchState) to push-based (PushState) architecture
- implemented gRPC receiver in gateway for node state events
- created frontend state reconstructor for event-sourcing
- added tests for receiver and reconstructor components
- updated Docker Compose topology for new architecture

Reference engineering log:

- `implementation_bugs.md`
- `REFACTOR_EVENT_SOURCING.md`

## 5. Demo Data Flow

1. Node state changes trigger `StateObserver.OnStateChange()` callback.
2. `Pusher` converts `StateSnapshot` to `RaftStateEvent` protobuf.
3. Node calls `PushState()` gRPC on gateway.
4. Gateway broadcasts event to all connected WebSocket clients.
5. Frontend `RaftStateReconstructor` applies events to build cluster state.
6. UI renders:
   - authoritative data: role, term, commit, leader
   - derived visuals: election ring progression, heartbeat dots

## 6. Timeout Realism Contract (Current Demo)

To prevent deceptive jumps and keep frontend/backend timing aligned:

1. Backend timing is explicitly configured in `docker-compose.yml`:
   - `--heartbeat-interval=2000ms`
   - Staggered election windows per node to keep timers visually distinguishable:
     - `A: 8000-10000ms`
     - `B: 11000-13000ms`
     - `C: 14000-16000ms`
     - `D: 17000-19000ms`
     - `E: 20000-22000ms`
2. Gateway forwards timeout telemetry unchanged (`heartbeat_interval_ms`, `election_timeout_ms`).
3. Frontend maps timing telemetry 1:1.
4. Frontend tracks timeout-cycle starts and progression per node for rendering continuity.

## 7. Event-Sourcing Architecture

The system uses a push-based event-sourcing model:

### Node Side (raft-core)

- `StateObserver` interface allows external systems to react to state changes
- `Pusher` implements `StateObserver` and calls `PushState()` on gateway
- Events are sent asynchronously to avoid blocking the Raft state machine

### Gateway Side (raft-demo)

- `StateReceiver` implements `RaftGatewayServer` gRPC service
- Receives `RaftStateEvent` messages from nodes
- Broadcasts events to WebSocket clients via `Hub`

### Frontend Side (raft-demo)

- `RaftStateReconstructor` applies events to build node state
- Handles partial events (delta semantics)
- Maintains event log for debugging
- `useRaft` hook manages WebSocket connection and state updates

## 8. Event Schema

```typescript
interface RaftStateEvent {
  node_id: string;
  state?: 'FOLLOWER' | 'CANDIDATE' | 'LEADER' | 'DEAD';
  current_term?: number;
  voted_for?: string;
  event_time_ms?: number;
  commit_index?: number;
  last_applied?: number;
  leader_id?: string;
  election_timeout_ms?: number;
  heartbeat_interval_ms?: number;
}
```

Fields use optional (pointer) semantics for delta updates. The reconstructor preserves previous values for fields not included in an event.

## 9. Known Tradeoffs

1. Demo operates in read-only mode (no command submission via UI).
2. Single-gateway topology is intentionally simple for demo operation.
3. Debug-level logs are noisy by design during issue investigation.
4. No persistence of event stream (frontend state is transient).

## 10. What to Improve Next

1. Add command submission via gRPC-web or REST-to-gRPC proxy.
2. Add timeline correlation IDs across node logs, gateway logs, and frontend.
3. Expand fault scenarios (partitions, asymmetric delays, targeted drops).
4. Add production-readiness path (auth, HA gateway, metrics/alerts).
5. Persist event stream for replay/debugging.
