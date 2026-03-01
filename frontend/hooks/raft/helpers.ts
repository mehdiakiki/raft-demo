import type { NodeStateReply, StateTransitionEvent } from '@/lib/types';
import type { RaftNode } from '@/hooks/raft/types';
import {
  CANDIDATE_MIN_VISIBLE_MS,
  DEFAULT_ELECTION_TIMEOUT_JITTER_MS,
  DEFAULT_ELECTION_TIMEOUT_MIN_MS,
  HB_INTERVAL_MS,
  MESSAGE_SPEED_MAX,
  MESSAGE_SPEED_MIN,
  MESSAGE_SPEED_TO_LATENCY_SCALE,
  MIN_STALE_WINDOW_MS,
  MIN_TRANSPORT_SILENCE_MS,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  STALE_WINDOW_ELECTION_MULTIPLIER,
  STALE_WINDOW_HEARTBEAT_MULTIPLIER,
  TRANSPORT_SILENCE_FACTOR,
  VISUAL_TIME_SCALE,
} from '@/hooks/raft/constants';

// electionTimeouts caches a stable per-node fallback timeout.
const electionTimeouts: Record<string, number> = {};
const FOLLOWER_ROLLOVER_HINT_THRESHOLD = 0.85;

function getElectionTimeout(nodeID: string): number {
  if (!electionTimeouts[nodeID]) {
    // 8000–10000ms fallback when backend timing metadata is absent.
    electionTimeouts[nodeID] = DEFAULT_ELECTION_TIMEOUT_MIN_MS + Math.random() * DEFAULT_ELECTION_TIMEOUT_JITTER_MS;
  }
  return electionTimeouts[nodeID];
}

export function staleWindowMs(node: RaftNode): number {
  const byHeartbeat = Math.round(node.heartbeatInterval * STALE_WINDOW_HEARTBEAT_MULTIPLIER);
  const byElection = Math.round(node.electionTimeout * STALE_WINDOW_ELECTION_MULTIPLIER);
  return Math.max(MIN_STALE_WINDOW_MS, byHeartbeat, byElection);
}

export function transportSilenceWindowMs(nodes: Record<string, RaftNode>): number {
  let minWindow = Number.MAX_SAFE_INTEGER;
  let hasLiveNode = false;

  for (const node of Object.values(nodes)) {
    if (node.actualState === 'DEAD') continue;
    hasLiveNode = true;
    const windowMs = staleWindowMs(node);
    if (windowMs < minWindow) {
      minWindow = windowMs;
    }
  }

  if (!hasLiveNode) {
    return MIN_TRANSPORT_SILENCE_MS;
  }

  return Math.max(MIN_TRANSPORT_SILENCE_MS, Math.floor(minWindow * TRANSPORT_SILENCE_FACTOR));
}

export function clampMessageSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return MESSAGE_SPEED_MIN;
  return Math.min(MESSAGE_SPEED_MAX, Math.max(MESSAGE_SPEED_MIN, speed));
}

export function messageSpeedToLatencyMs(speed: number): number {
  const clamped = clampMessageSpeed(speed);
  return Math.max(0, Math.round(clamped * MESSAGE_SPEED_TO_LATENCY_SCALE));
}

export function latencyMsToMessageSpeed(latencyMs: number): number {
  if (!Number.isFinite(latencyMs) || latencyMs <= 0) {
    return MESSAGE_SPEED_MIN;
  }
  return clampMessageSpeed(latencyMs / MESSAGE_SPEED_TO_LATENCY_SCALE);
}

export function isNodeStateReply(value: unknown): value is NodeStateReply {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<NodeStateReply>;
  return typeof candidate.node_id === 'string' && typeof candidate.state === 'string';
}

export function isStateTransitionEvent(value: unknown): value is StateTransitionEvent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StateTransitionEvent>;
  return candidate.type === 'state_transition'
    && typeof candidate.node_id === 'string'
    && typeof candidate.from === 'string'
    && typeof candidate.to === 'string';
}

// mapReplyToNode converts a raw NodeStateReply from the wire to the RaftNode
// shape the visualizer expects.
export function mapReplyToNode(
  reply: NodeStateReply,
  prev?: RaftNode,
  candidateHintUntil = 0,
  now = Date.now(),
): RaftNode {
  const rawHeartbeatMs = reply.heartbeat_interval_ms ?? 0;
  const rawElectionMs = reply.election_timeout_ms ?? 0;
  const scaledHeartbeat = rawHeartbeatMs > 0
    ? rawHeartbeatMs * VISUAL_TIME_SCALE
    : (prev?.heartbeatInterval ?? HB_INTERVAL_MS);
  const fallbackElection = prev?.electionTimeout ?? getElectionTimeout(reply.node_id);
  const scaledElection = rawElectionMs > 0
    ? rawElectionMs * VISUAL_TIME_SCALE
    : fallbackElection;
  const stableElection = scaledElection;

  const timerRole = reply.state === 'FOLLOWER' || reply.state === 'CANDIDATE';
  const backendTimeoutChanged = Boolean(prev) &&
    timerRole &&
    rawElectionMs > 0 &&
    (prev?.backendElectionTimeoutMs ?? 0) > 0 &&
    rawElectionMs !== (prev?.backendElectionTimeoutMs ?? 0);
  const enteredTimerRole = Boolean(prev) &&
    timerRole &&
    (prev?.actualState === 'LEADER' || prev?.actualState === 'DEAD');
  const shouldResetTimer = backendTimeoutChanged || enteredTimerRole;
  const prevProgress = prev && prev.electionTimeout > 0
    ? prev.electionTimer / prev.electionTimeout
    : 0;
  const prevClockProgress = prev && prev.electionTimeout > 0
    ? Math.min(
      1,
      Math.max(0, now - prev.electionStartedAt) / prev.electionTimeout,
    )
    : 0;
  const nearFollowerTimeout = Math.max(prevProgress, prevClockProgress) >= FOLLOWER_ROLLOVER_HINT_THRESHOLD;
  const followerTimeoutRolledOver = Boolean(prev) &&
    backendTimeoutChanged &&
    prev?.actualState === 'FOLLOWER' &&
    reply.state === 'FOLLOWER' &&
    nearFollowerTimeout;

  let candidateHoldUntil = Math.max(prev?.candidateHoldUntil ?? 0, candidateHintUntil);
  // Only apply the minimum candidate visibility hold after we already have
  // a prior snapshot for this node. On first observation this hold creates
  // a perceived "leader lag" during initial page load.
  if (reply.state === 'CANDIDATE' && prev) {
    candidateHoldUntil = Math.max(candidateHoldUntil, now + CANDIDATE_MIN_VISIBLE_MS);
  }
  if (reply.state === 'DEAD') {
    candidateHoldUntil = 0;
  } else if (followerTimeoutRolledOver) {
    // Pre-vote timeouts can reset FOLLOWER->FOLLOWER without an observable
    // backend CANDIDATE frame. Keep a short visual candidate hint so timeout
    // rollover aligns with operator expectations.
    candidateHoldUntil = Math.max(candidateHoldUntil, now + CANDIDATE_MIN_VISIBLE_MS);
  } else if (candidateHoldUntil <= now && reply.state !== 'CANDIDATE') {
    candidateHoldUntil = 0;
  }

  let visualState = reply.state;
  if (reply.state !== 'DEAD' && candidateHoldUntil > now) {
    visualState = 'CANDIDATE';
  }

  // electionTimer is derived locally from lastHeartbeat/electionStartedAt.
  const electionTimer = shouldResetTimer ? 0 : (prev?.electionTimer ?? 0);
  const lastHeartbeat = shouldResetTimer ? now : (prev?.lastHeartbeat ?? now);
  const electionStartedAt = shouldResetTimer ? now : (prev?.electionStartedAt ?? lastHeartbeat);

  return {
    id: reply.node_id,
    state: visualState,
    actualState: reply.state,
    // Numeric fields use ?? 0 because the proto backend omits zero-value
    // integers via json:"...,omitempty", so they arrive as undefined.
    term: reply.current_term ?? 0,
    votedFor: reply.voted_for || null,
    log: (reply.log ?? []).map(e => ({ term: e.term ?? 0, command: e.command })),
    commitIndex: reply.commit_index ?? 0,
    nextIndex: reply.next_index ?? {},
    matchIndex: reply.match_index ?? {},
    heartbeatInterval: scaledHeartbeat,
    backendHeartbeatIntervalMs: rawHeartbeatMs,
    // Preserve election timer state across WS pushes; only backend timeout-cycle
    // changes should reset election progress.
    electionTimer,
    electionTimeout: stableElection,
    backendElectionTimeoutMs: rawElectionMs,
    electionStartedAt,
    votesReceived: prev?.votesReceived ?? new Set<string>(),
    lastUpdate: now,
    lastHeartbeat,
    stale: false,
    candidateHoldUntil,
  };
}

// exponentialBackoff returns the next reconnect delay, doubling each attempt
// up to RECONNECT_MAX_MS.
export function exponentialBackoff(attempt: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
}
