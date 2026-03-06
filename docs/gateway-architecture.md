# Gateway Architecture

## Purpose
The gateway is a thin bridge between Raft nodes (`raft-core`) and UI clients (`raft-demo/frontend`).
It does two jobs only:

1. Receive event pushes from nodes over gRPC.
2. Broadcast/replay those events to frontend clients over WebSocket.

It also exposes minimal control endpoints (`kill/restart/submit command`) as transport proxies to node gRPC.

## Design Principles

- Thin gateway: no Raft consensus logic in gateway.
- Backend truth first: frontend reconstructs from events, not gateway inference.
- Replay-safe: latest node state is cached and replayed on WebSocket reconnect.
- Deterministic payload forwarding: RPC metadata is passed through unchanged.

## Runtime Surfaces

### gRPC Server (node -> gateway)
Implemented in `cmd/gateway/main.go` + `internal/gateway/receiver.go`.

- `PushState(RaftStateEvent)`
  - Called by nodes on state changes.
  - Cached per node for replay.
  - Broadcast to all WS clients.

- `PushRpc(RaftRpcEvent)`
  - Called by nodes on emitted RPC events.
  - Wrapped into WS `type="rpc"` payload.
  - Broadcast to all WS clients.

### HTTP + WebSocket Server (gateway -> frontend)
Implemented in `cmd/gateway/main.go` + `internal/gateway/websocket.go`.

- `/ws` WebSocket stream for live events.
- `/health` for readiness.
- `/api/nodes/{id}/kill` and `/api/nodes/{id}/restart` control endpoints.
- `/api/commands` client-command proxy endpoint.

### Node Control Proxy (gateway -> node gRPC)
Implemented in `internal/gateway/node_client.go`.

- Keeps a map of node gRPC clients from `--nodes` config.
- `SetAlive` forwarding for kill/restart.
- `SubmitCommand` forwarding with:
  - preferred leader hint first,
  - fallback iteration through nodes,
  - immediate redirect retry when reply contains `leader_id`.

## Replay Model

The WebSocket hub stores `latestState[nodeID]` and replays all cached node snapshots when a client connects.
RPC packets are transient and are not state-cached for replay by the hub.

This gives:

- deterministic cluster baseline after reconnect,
- no duplicate business logic in gateway,
- transient packet reconstruction handled in frontend animation logic.

## RPC Payload Contract Forwarding

Gateway forwards these RPC fields if present:

- `from_node`, `to_node`, `rpc_type`, `event_time_ms`
- `rpc_id`
- optional `term`
- optional `candidate_id`
- optional `vote_granted`
- optional `direction`

No field derivation or election interpretation occurs in gateway.

## Canonical Stream Behavior

In `raft-core`, the gateway pusher sends only canonical outgoing observer events (`OnRpcSend`) and intentionally does not push receive-side observer events (`OnRpcReceive`).
This avoids duplicate packet rendering and keeps frontend dedupe simple and deterministic.

## Failure Handling

- Marshal failures are logged and skipped.
- Per-client WebSocket write errors evict the client.
- gRPC push errors are logged in node-side pusher.
- Control-plane RPC errors are surfaced as HTTP errors.

## Why This Holds Up Well

- Separation of concerns is strict.
- Replay baseline is robust (latest state cache).
- Protocol evolution (extra RPC fields) is easy because gateway is passthrough.
- Frontend can evolve visuals without touching consensus or gateway business logic.
