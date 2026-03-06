# Architecture Choices and Rationale

## Context
This project visualizes Raft behavior from backend truth while keeping the system simple to evolve.
The architecture intentionally separates consensus, transport, and presentation concerns.

## Choice 1: Thin Gateway

Decision:
- Keep gateway logic transport-focused only.
- Do not place election business logic in gateway.

Why:
- Avoid duplicating Raft semantics outside `raft-core`.
- Keep protocol ownership in one place.
- Reduce drift and hidden coupling.

Tradeoff:
- Frontend must reconstruct richer visual behavior from event stream.

## Choice 2: Event Replay Instead of Polling Sync

Decision:
- Stream state and RPC events from nodes to gateway, then to frontend over WebSocket.
- Replay latest node snapshots on reconnect.

Why:
- Better temporal fidelity (users see election progression, not just final states).
- Reconnect is deterministic and fast due to cached latest state per node.

Tradeoff:
- Frontend needs robust dedupe and ordering-safe handling.

## Choice 3: Canonical RPC Stream (Send-Side)

Decision:
- Push only canonical send-side RPC observer events to gateway.
- Do not push receive-side observer events to avoid duplicates.

Why:
- Prevent double animation of logically identical traffic.
- Simplify dedupe in frontend and make replay behavior predictable.

Tradeoff:
- Receive-side diagnostics are not visible in gateway stream by default.

## Choice 4: Explicit Vote Metadata in `RaftRpcEvent`

Decision:
- Include `rpc_id`, `term`, `candidate_id`, `vote_granted`, `direction`.

Why:
- Reconstruct granted and denied votes from backend truth.
- Support deterministic replay and reconnect dedupe.
- Remove dependency on frontend inference from snapshot fields.

Tradeoff:
- Protocol payload is richer and requires strict backward handling.

## Choice 5: `rpc_id`-First Dedupe

Decision:
- Use stable `rpc_id` as primary dedupe key.
- Keep deterministic fallback dedupe only for legacy payloads without `rpc_id`.

Why:
- Strong replay determinism.
- Fewer heuristics and fewer edge-case duplicates.

Tradeoff:
- Requires stable ID generation discipline in backend emitters.

## Choice 6: Vote Tally from Explicit Replies

Decision:
- Build candidate tally from explicit `VOTE_REPLY` events and candidate self-vote seeding.
- Do not infer grants from follower `voted_for` snapshots.

Why:
- Prevent false positives and ambiguity in split elections.
- Keep tally semantics transparent and audit-friendly.

Tradeoff:
- Missing reply events can make tally look incomplete (which is accurate to observed data).

## Choice 7: Heartbeat Timeout Reset on Arrival (Not Send)

Decision:
- Reset follower timeout when heartbeat animation reaches follower.

Why:
- Align visual behavior with user mental model of message travel.
- Fixes perceived synchronization bug where followers reset too early.

Tradeoff:
- Introduces intentional visual delay between emission and timeout reset.

## Choice 8: Control Plane via Gateway REST Proxy

Decision:
- Keep control actions (`kill`, `restart`, `submit command`) via gateway REST endpoints.
- Gateway forwards to node gRPC with leader hint + redirect/fallback.

Why:
- Frontend remains simple and decoupled from direct node topology.
- Centralized error/status handling for user-facing actions.

Tradeoff:
- One extra hop in command path.

## Choice 9: Keep Only Functional UI Controls

Decision:
- Remove non-functional controls from visible UX.
- Keep controls that map to real system effects.

Why:
- Avoid misleading users.
- Reduce perceived flakiness and support load.

Tradeoff:
- Fewer simulation toggles unless backend support is later added.

## Maintainability Outcomes

- Single source of protocol truth in `raft-core`.
- Thin gateway that is easy to reason about and test.
- Frontend replay model with explicit contracts and deterministic dedupe.
- Test coverage focused on behavior regressions that users notice first.
