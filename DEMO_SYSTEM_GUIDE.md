# Raft Consensus Visualizer: Architecture and Evolution

This document is the concise architecture and engineering summary of the demo system.

## 1. What I Built

This project is a full-stack distributed systems demo of Raft:

- backend Raft nodes in Go (`raft-core`) implementing election, replication, commit/apply, snapshots, and kill/restart behavior
- Go gateway that bridges node gRPC streams to WebSocket/HTTP for UI consumption
- Next.js frontend that visualizes cluster behavior in real time
- Docker Compose orchestration for local multi-node simulation

The result is a live cluster with control-plane APIs and observability, not a static animation.

## 2. Why This Project Is Technically Meaningful

The demo exercises:

- distributed systems invariants (term/vote/log/commit correctness)
- backend protocol integration (node-to-node and gateway-to-node gRPC)
- real-time client architecture (WebSocket streams plus local interpolation)
- failure simulation and recovery workflows
- cross-stack regression testing discipline

## 3. Core Engineering Decisions

1. Consensus correctness lives only in backend nodes.
2. Frontend is an observability/visualization consumer, not a protocol authority.
3. Gateway emits transition events so short-lived state changes remain observable.
4. Timing telemetry is treated as backend authority and passed through explicitly.
5. Regression tests are added for every discovered behavior gap.

## 4. Concrete Work Driven in This Repo

- fixed stale-state fanout and transport-silence handling for frontend stability
- improved candidate observability with transition events and replay buffering
- added structured animation trace instrumentation for root-cause analysis
- introduced gateway control endpoints for stream netem and chaos scheduling
- added tests in gateway/frontend around timing and transition regressions

Reference engineering log:

- `implementation_bugs.md`

## 5. Demo Data Flow

1. Node emits `NodeStateReply` over gRPC stream (`WatchState`).
2. Gateway consumes all node streams and broadcasts snapshots + transition events over WS.
3. Frontend maps each payload into view state and renders:
   - authoritative data: role, term, log, commit, timeout telemetry
   - derived visuals: election ring progression, heartbeat dots, stale indicators

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
   - `--candidate-visual-min=2000ms` on gateway to prevent candidate blink-through
2. Gateway forwards timeout telemetry unchanged (`heartbeat_interval_ms`, `election_timeout_ms`).
3. Frontend maps timing telemetry 1:1 (`VISUAL_TIME_SCALE=1`).
4. Frontend tracks timeout-cycle starts and progression per node for rendering continuity.
5. Sidebar includes a **Timeout Debug** panel for live monitoring:
   - per-node backend heartbeat/election values
   - elapsed/remaining timeout per cycle
   - progress percentage and cluster timeout spread
   - visual role vs actual role
   - candidate-hold remaining time

This removes hidden frontend magnification and makes timeout behavior inspectable.

## 7. State Signal Design (Backend to Frontend)

This is the core design that keeps correctness and readability separate without losing traceability:

1. **Authoritative backend state**:
   - each node emits `NodeStateReply` with role, term, commit/log metadata, and timing telemetry
   - gateway forwards these snapshots unchanged over WS
2. **Gateway transition channel**:
   - gateway emits `state_transition` events when role changes are observed
   - transition replay buffer lets late WS clients still observe short-lived candidate/leader transitions
3. **Frontend dual-state model**:
   - `actualState`: backend-authoritative role from latest snapshot
   - `state`: visual role used for readability (can briefly differ from `actualState`)
4. **Candidate visibility strategy**:
   - gateway applies a minimum candidate visibility window before forwarding leader state
   - frontend applies a short candidate hold when:
     - transition events indicate candidate state
     - timeout rollover occurs near follower timeout but backend remains follower (pre-vote path)
5. **Operator transparency in UI**:
   - Timeout Debug panel surfaces both `Visual` and `Actual` columns
   - `Hold Left` makes visual-only candidate hints explicit
   - node cards show `VISUAL HOLD` whenever display state differs from backend state

This allows a demo-friendly visual timeline without violating Raft correctness ownership.

## 8. Known Tradeoffs

1. Candidate visibility still uses a small hold window for readability.
2. Single-gateway topology is intentionally simple for demo operation.
3. Debug-level logs are noisy by design during issue investigation.
4. Control-plane knobs are demo-oriented, not production-hardening features.

## 9. What to Improve Next

1. Define one typed event contract covering state, timing, and transitions.
2. Add timeline correlation IDs across node logs, gateway logs, and frontend trace.
3. Expand fault scenarios (partitions, asymmetric delays, targeted drops).
4. Add production-readiness path (auth, HA gateway, metrics/alerts).
