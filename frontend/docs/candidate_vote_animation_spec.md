# Candidate Vote Animation Spec (Event-Replay Mode)

## Goal
Add realistic vote-exchange visualization during leader election, using replayed backend events (not frontend-simulated state).

## Why This Is Needed
Current behavior has these limits:
- Vote traffic is not visualized even though message colors/types exist in the UI.
- `useRaft` returns `messages: []`, so request/reply packet rendering path is effectively disabled.
- Candidate progression is mostly inferred from timeout/state transitions, not from actual vote exchange.

Result: elections work, but the election process is not visually realistic.

## Desired UX
During an election:
1. Candidate sends `REQUEST_VOTE` packets to peers.
2. Peers return `VOTE_REPLY` packets.
3. Candidate shows live vote tally (`x / quorum`).
4. Quorum reached triggers a short "elected" pulse, then leader state.
5. Split vote or rejection remains visible (no fake instant leader).

## Data Contract Requirements
To make vote animation accurate (not guessed), RPC events must include election metadata.

### Required fields for vote realism
- `event_time_ms`
- `from_node`
- `to_node`
- `rpc_type` (at least `REQUEST_VOTE`, `VOTE_REPLY`)
- `term`
- `candidate_id` (for replies, explicit target election candidate)
- `vote_granted` (boolean, for `VOTE_REPLY`)
- `rpc_id` (unique id for dedupe/replay safety)

### Optional but recommended
- `election_round` or `elections_started` snapshot value
- `reason` for denied vote (term mismatch/log freshness)

Without `vote_granted` and election identity, frontend can animate packets but cannot show truthful tally outcomes.

## Event Semantics (Source of Truth)
- Frontend should only animate vote flow from incoming RPC events.
- Frontend must not fabricate vote grants/denials.
- State transition (`CANDIDATE -> LEADER`) remains source-of-truth from pushed state snapshots.
- Vote packets are transient visuals; node role/term remains authoritative from state events.

## Frontend State Model
Add transient message and election-ledger models:

- `VoteMessage`
  - `id`, `from`, `to`, `type`, `progress`, `term`, `candidateId`, `voteGranted`, `eventTimeMs`

- `ElectionLedger` keyed by `(candidateId, term)`
  - `requestedFrom: Set<NodeID>`
  - `grantedBy: Set<NodeID>`
  - `rejectedBy: Set<NodeID>`
  - `quorum: number`
  - `status: collecting | won | lost | stale`

### Replay/reconnect rules
- Deduplicate by `rpc_id` (fallback key only if needed: `from|to|type|event_time_ms`).
- Ignore stale vote RPCs for terms older than node’s current known term.
- On reconnect, avoid replaying very old transient packets; keep only recent in-flight visuals.

## Animation Behavior
### Packet colors
- `REQUEST_VOTE`: yellow
- `VOTE_REPLY` granted: bright yellow/amber
- `VOTE_REPLY` denied: red/orange

### Timing
- Packet travel duration: derive from existing `messageSpeed` control.
- Tally update: when `VOTE_REPLY` arrives (not when request is sent).
- Elected pulse: ~300ms after quorum before settling into leader styling.
- Clear stale packets quickly (~200ms fade) on term change or step-down.

## File-by-File Implementation Scope

### 1) `raft-core` (dependency, required for full realism)
- Extend `RaftRpcEvent` with election/vote fields listed above.
- Emit vote RPC events consistently for request and reply paths.
- Ensure `rpc_id` stability for replay dedupe.

### 2) `internal/gateway/receiver.go`
- Pass through new RPC fields unchanged in WebSocket payload map.
- Keep gateway thin: no election logic in gateway.

### 3) `frontend/lib/types.ts`
- Add strict `RpcEvent` type for vote metadata.
- Add typed models for transient vote messages and election ledger.

### 4) `frontend/hooks/useRaft.ts`
- Replace `messages: []` stub with live transient message store.
- Parse `REQUEST_VOTE` and `VOTE_REPLY` RPC events.
- Maintain per-term candidate ledger and expose it to UI.
- Keep heartbeat handling for `APPEND_ENTRIES` unchanged.

### 5) `frontend/components/raft/ClusterCanvas.tsx`
- Reuse existing packet rendering path for vote packets.
- Add deny/reject visual tone and smoother fade-out for vote packets.

### 6) `frontend/components/raft/ClusterSidebar.parts.tsx`
- Show per-candidate tally while in candidate state: `votes: x / quorum`.
- Show `won/lost` election status briefly before next cycle.

### 7) Tests
- `frontend/hooks/__tests__/useRaft.test.ts`
  - vote request creates outgoing packet
  - vote reply updates ledger (grant/deny)
  - quorum marks candidate election as won
  - reconnect/dedupe does not duplicate vote packets
- `internal/gateway/*_test.go`
  - RPC passthrough includes new fields

## Acceptance Criteria
- Killing current leader shows visible vote exchange before new leader appears.
- At least one candidate displays progressive vote tally updates in UI.
- Denied votes are visually distinct from granted votes.
- Split-vote scenario shows multiple candidates without false leader animation.
- Reconnect does not duplicate old vote animations.

## Replay Troubleshooting
If vote animations do not reconstruct correctly from backend events, validate in this order:

1. Backend event payload contract
- Each vote RPC includes `rpc_id`, `term`, and `candidate_id`.
- Each `VOTE_REPLY` includes explicit `vote_granted` (`true` or `false`).
- `direction` is either omitted or canonicalized to `SEND` for pushed events.

2. Gateway passthrough
- WebSocket payload for `type=rpc` forwards `rpc_id`, `term`, `candidate_id`,
  `vote_granted`, and `direction` unchanged.
- Gateway does not infer election results or mutate vote semantics.

3. Frontend dedupe and tally
- `rpc_id` is the primary dedupe key; fallback dedupe is only for legacy payloads
  without `rpc_id`.
- Vote tally updates happen from `VOTE_REPLY`, not inferred follower `voted_for`.
- Split vote stays `collecting` until quorum is reached by explicit replies.

## Non-Goals
- No backend control-plane simulation from frontend.
- No synthetic/random vote outcomes generated in UI.
- No change to Raft consensus logic in `raft-demo`.
