# Event Sourcing Refactor

## Overview

Refactoring `raft-demo` from a **pull-based** architecture to an **event-sourcing push-based** architecture.

### Old Architecture (Pull-Based)
```
┌─────────────┐    WatchState()     ┌──────────────┐
│   Gateway   │ ──────────────────► │  Raft Nodes  │
│ (gRPC client│                     │ (gRPC server)│
│ + REST API) │ ◄────────────────── │              │
└─────┬───────┘   state updates     └──────────────┘
      │
      │ WebSocket broadcast
      ▼
┌─────────────┐
│   Frontend  │
└─────────────┘
```
- Gateway acted as gRPC **client**, calling `WatchState()` on each node
- REST endpoints (`/api/command`, `/api/nodes/{id}/kill`, etc.) proxied to nodes
- Frontend received state via WebSocket fanout

### New Architecture (Event-Sourcing Push)
```
┌──────────────┐    PushState()    ┌─────────────┐
│  Raft Nodes  │ ─────────────────►│   Gateway   │
│ (gRPC client)│                    │ (gRPC server│
│              │                    │ + WebSocket)│
└──────────────┘                    └──────┬──────┘
                                           │
                    WebSocket broadcast    │
                                           ▼
                                    ┌─────────────┐
                                    │   Frontend  │
                                    │ (reconstruct│
                                    │  from events)│
                                    └─────────────┘
```
- Raft nodes **push** events to gateway via `PushState()` gRPC call
- Gateway is a simple event fanout (no business logic)
- Frontend reconstructs cluster state from event stream

---

## Progress Tracker

### Phase 1: Gateway Refactor (Backend)

| Task | Status | Notes |
|------|--------|-------|
| Add gRPC server for `RaftGateway` service | ✅ Done | `internal/gateway/receiver.go` |
| Implement `PushState()` handler | ✅ Done | Broadcasts to WebSocket clients |
| Remove old HTTP REST endpoints | ✅ Done | Deleted `internal/gateway/http.go` |
| Simplify `cmd/gateway/main.go` | ✅ Done | Now starts gRPC + HTTP servers only |
| Remove node client connections | ✅ Done | No longer connects TO nodes |
| Update `go.mod` dependencies | ✅ Done | Added gRPC server dependency |
| Delete old tests | ✅ Done | `main_test.go`, `http_test.go`, `websocket_test.go` removed |
| Fix `websocket_test.go` | ✅ Done | Deleted (references removed code) |
| Write new tests for `StateReceiver` | ✅ Done | `internal/gateway/receiver_test.go` |
| Clean up `frontend/lib/api.ts` | ✅ Done | REST functions now throw errors |
| Add TypeScript tests for reconstructor | ✅ Done | `frontend/lib/stateReconstructor.test.ts` |
| Update `useRaft.test.ts` | ✅ Done | Rewritten for event-sourcing mode |

### Phase 2: Frontend Refactor

| Task | Status | Notes |
|------|--------|-------|
| Create `RaftStateReconstructor` | ✅ Done | `frontend/lib/stateReconstructor.ts` |
| Update `useRaft` hook | ✅ Done | Uses reconstructor, simpler WebSocket handling |
| Remove old hook utilities | ✅ Done | Deleted `frontend/hooks/raft/*` |
| Update `types.ts` | ✅ Done | Added `RaftStateEvent` type |
| Clean up `api.ts` dead code | ✅ Done | Functions now throw errors in event-sourcing mode |
| Remove or implement stubs | ✅ Done | `toggleNodeState`, `clientRequest` are documented stubs |
| Add reconstructor tests | ✅ Done | `frontend/lib/stateReconstructor.test.ts` |
| Update `useRaft.test.ts` | ✅ Done | Rewritten for event-sourcing mode |

### Phase 3: Raft-Core Integration

| Task | Status | Notes |
|------|--------|-------|
| Add gateway address config to node | ✅ Done | `--gateway` flag in `cmd/node/main.go` |
| Implement `Pusher` in raft-core | ✅ Done | `internal/gateway/pusher.go` |
| Wire observer into node config | ✅ Done | Added to `Observers` list |
| Implement `PushState()` client in node | ✅ Done | Calls gateway on state changes |
| Remove old `WatchState` server (optional) | ❌ TODO | May keep for backwards compat |

### Phase 4: Testing & Documentation

| Task | Status | Notes |
|------|--------|-------|
| Add Go tests for `StateReceiver` | ✅ Done | Unit tests |
| Add TypeScript tests for reconstructor | ✅ Done | Unit tests |
| Update `README.md` | ✅ Done | Reflect new architecture |
| Update `DEMO_SYSTEM_GUIDE.md` | ✅ Done | Reflect new architecture |
| Update `docker-compose.yml` | ✅ Done | Nodes push to gateway via --gateway flag |
| End-to-end test | ✅ Done | Verified 2026-03-05 |

---

## Detailed Task Breakdown

### 1. Clean Up Dead Code (raft-demo)

**Files affected:**
- `frontend/lib/api.ts` — Contains `submitCommand`, `killNode`, `restartNode`, `fetchClusterState` that reference deleted REST endpoints

**Action:** Remove or comment out these functions since the REST API no longer exists. Alternatively, keep them as stubs for future gRPC-web integration.

### 2. Implement or Remove Frontend Stubs

**Current stubs in `useRaft.ts`:**
```typescript
const toggleNodeState = useCallback((id: string) => {
  console.log('toggleNodeState not implemented in event-sourcing mode', id);
}, []);

const clientRequest = useCallback(async (command: string) => {
  console.log('clientRequest not implemented in event-sourcing mode', command);
  return { success: false, leader_id: '', duplicate: false };
}, []);
```

**Options:**
- **Remove:** Delete these functions and update components that use them
- **Implement:** Add gRPC-web or REST-to-gRPC proxy for these operations
- **Keep as stubs:** Document that interactive control is not available in this mode

### 3. Raft-Core Integration (raft-core repo)

The raft-core nodes need to push state to the gateway. This requires changes in raft-core:

**New config:**
```go
type GatewayConfig struct {
    Address string // e.g., "gateway:50051"
    Enabled bool
}
```

**New client in node:**
```go
type StatePusher struct {
    client pb.RaftGatewayClient
    conn   *grpc.ClientConn
}

func (s *StatePusher) Push(event *pb.RaftStateEvent) error {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    _, err := s.client.PushState(ctx, event)
    return err
}
```

**Hook into state changes:**
- On term change
- On state transition (Follower → Candidate → Leader)
- On commit index update
- On heartbeat received/sent (optional, for visualization)

### 4. Docker Compose Updates

Ensure nodes can reach the gateway:
```yaml
environment:
  - GATEWAY_ADDR=gateway:50051
```

---

## Decision Points

### Q1: Should we support interactive commands?

The old system allowed:
- Submitting client commands (`/api/command`)
- Killing/restarting nodes (`/api/nodes/{id}/kill`, `/api/nodes/{id}/restart`)

**Options:**
1. **Remove entirely** — Demo is read-only visualization
2. **Add gRPC gateway for commands** — Nodes expose command service, gateway proxies
3. **Direct node access** — Frontend talks to nodes directly (CORS issues)

**Recommendation:** Start with option 1 (read-only) for simplicity. Add command support later if needed.

### Q2: What events should nodes push?

Minimal set:
- `node_id`, `state`, `current_term`, `leader_id`

Extended set (for richer visualization):
- `commit_index`, `voted_for`, `election_timeout_ms`, `heartbeat_interval_ms`
- Log entries (for log visualization)
- Election statistics

---

## File Changes Summary

### raft-demo

#### Deleted
- `cmd/gateway/main_test.go`
- `internal/gateway/http.go`
- `internal/gateway/http_test.go`
- `internal/gateway/websocket_test.go`
- `frontend/hooks/raft/constants.ts`
- `frontend/hooks/raft/helpers.ts`
- `frontend/hooks/raft/types.ts`
- `frontend/hooks/raft/useElectionTick.ts`
- `frontend/hooks/raft/useGatewayStream.ts`
- `frontend/hooks/raft/useHeartbeatEffects.ts`

#### Modified
- `cmd/gateway/main.go` — Simplified, removed REST routes and node clients
- `internal/gateway/websocket.go` — Simplified hub
- `frontend/hooks/useRaft.ts` — Uses reconstructor
- `frontend/lib/types.ts` — Added event types
- `frontend/lib/api.ts` — Functions throw errors in event-sourcing mode
- `frontend/hooks/__tests__/useRaft.test.ts` — Rewritten for event-sourcing
- `frontend/lib/api.test.ts` — Updated for event-sourcing mode
- `docker-compose.yml` — Updated for new architecture
- `go.mod` — Updated dependencies

#### Added
- `internal/gateway/receiver.go` — gRPC `StateReceiver`
- `internal/gateway/receiver_test.go` — Tests for `StateReceiver`
- `frontend/lib/stateReconstructor.ts` — Event replay logic
- `frontend/lib/stateReconstructor.test.ts` — Tests for reconstructor
- `REFACTOR_EVENT_SOURCING.md` — This document

### raft-core (separate repo)

#### Added
- `internal/gateway/pusher.go` — `StateObserver` implementation that pushes to gateway

#### Modified
- `cmd/node/main.go` — Added `--gateway` flag, wired observer

---

## Next Steps (Priority Order)

1. [x] ~~Fix or delete `internal/gateway/websocket_test.go`~~ — deleted
2. [x] ~~Clean up `frontend/lib/api.ts`~~ — done
3. [x] ~~Add Go tests for `internal/gateway/receiver.go`~~ — done
4. [x] ~~Add TypeScript tests for `stateReconstructor.ts`~~ — done
5. [x] ~~Implement raft-core integration~~ — `internal/gateway/pusher.go` in raft-core
6. [x] ~~Update docker-compose.yml~~ — nodes now use `--gateway` flag
7. [x] ~~Update documentation (README, DEMO_SYSTEM_GUIDE)~~ — done
8. [x] ~~Test end-to-end with nodes pushing events~~ — verified 2026-03-05

## Refactor Complete ✓

All tasks completed. The event-sourcing architecture is fully implemented and tested.

---

*Last updated: 2026-03-05*
