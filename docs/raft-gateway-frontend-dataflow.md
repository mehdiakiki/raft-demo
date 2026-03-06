# Raft -> Gateway -> Frontend

## 1) End-to-End Data Flow

## 1.1 State flow

1. A node in `raft-core` changes state (role/term/leader/vote/commit info).
2. Node-side gateway pusher emits `RaftStateEvent` via gRPC `PushState`.
3. Gateway receiver caches by `node_id` and broadcasts to WebSocket clients.
4. Frontend consumes state events and applies them into `RaftStateReconstructor`.
5. UI renders `actualState` + visual overlays/timers.

## 1.2 RPC flow

1. `raft-core` emits observer RPC events at protocol points:
   - `PRE_VOTE`, `PRE_VOTE_REPLY`
   - `REQUEST_VOTE`, `VOTE_REPLY`
   - `APPEND_ENTRIES`
2. Node-side pusher sends canonical send-side RPC stream to gateway (`PushRpc`).
3. Gateway forwards RPC metadata to WebSocket clients (no inference).
4. Frontend:
   - animates packets,
   - updates vote ledger from explicit `VOTE_REPLY`,
   - resets follower timeout on heartbeat arrival animation completion.

## 1.3 Command flow (control plane)

1. User submits command in frontend.
2. Frontend normalizes command (`SET/DELETE` or raw JSON).
3. Frontend calls gateway `/api/commands`.
4. Gateway forwards to node `SubmitCommand` (leader hint + redirect/fallback).
5. Gateway returns result payload (`success`, `leader_id`, `duplicate`, `committed`, `result`, `routed_node`).

## 2) Core Data Structures

## 2.1 `raft-core` protocol contract

### `RaftStateEvent`
Carries node snapshot data (role, term, leader, voted_for, commit markers, timing fields).

### `RaftRpcEvent`
Carries packet-level metadata used for deterministic visualization:

- `from_node`, `to_node`
- `rpc_type`
- `event_time_ms`
- `rpc_id` (stable logical RPC identity)
- optional `term`
- optional `candidate_id`
- optional `vote_granted`
- optional `direction`

## 2.2 Gateway structures

### `StateReceiver`
- gRPC handler for `PushState` and `PushRpc`.
- owns `Hub` and `NodeClientMap`.

### `Hub`
- `clients`: connected websocket clients.
- `latestState`: per-node cached snapshot for replay.

### `NodeClientMap`
- node ID -> gRPC client.
- helper methods for `KillNode` and `SubmitCommand` routing.

## 2.3 Frontend structures (`useRaft` + reconstructor)

### `UINode`
Reconstructed node model for rendering:

- `state` (visual)
- `actualState` (backend truth)
- `term`, `leaderId`, `votedFor`
- timeout/heartbeat timing fields
- `candidateHoldUntil` (visual hold)

### `RpcEventPayload`
WS RPC message model:

- base routing (`from_node`, `to_node`, `rpc_type`)
- metadata (`rpc_id`, `term`, `candidate_id`, `vote_granted`, `direction`)

### `HeartbeatMsg`
Transient animation object for heartbeat travel.

### `LegacyMessage`
Transient packet animation object for vote/pre-vote flows with optional `voteGranted`.

### Vote ledger
- `VoteLedgerEntry`: per `(candidateId, term)` sets:
  - `grantedBy`
  - `rejectedBy`
- `CandidateVoteTally`: derived display model (`granted`, `rejected`, `quorum`, `status`).

## 3) Determinism and Replay Rules

- `rpc_id` is primary dedupe key.
- Legacy fallback dedupe is deterministic by event identity when `rpc_id` is missing.
- Gateway replays latest node snapshots on WS connect.
- Vote tallies are backend-driven from explicit vote replies (plus candidate self-vote seeding), not follower `voted_for` inference.
- Heartbeat timeout reset is synchronized to follower-side packet arrival animation.

## 4) Timing Semantics

- Node role/term transitions come from pushed state snapshots.
- Packet motion is frontend animation.
- Heartbeat effects are applied on follower arrival point, matching visual timing.
- Candidate visual hold smooths abrupt backend transitions while keeping `actualState` authoritative.

## 5) Why This Architecture Is Maintainable

- Consensus logic remains in `raft-core`.
- Gateway remains transport/replay glue only.
- Frontend holds presentation and reconstruction logic only.
- Field-rich RPC contract allows realistic animation without gateway or frontend protocol guessing.
