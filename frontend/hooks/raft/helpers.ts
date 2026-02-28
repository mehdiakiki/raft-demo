import type { NodeStateReply, StateTransitionEvent } from '@/lib/types';
import type { RaftNode } from '@/hooks/raft/types';
import {
  CANDIDATE_MIN_VISIBLE_MS,
  DEFAULT_ELECTION_TIMEOUT_JITTER_MS,
  DEFAULT_ELECTION_TIMEOUT_MIN_MS,
  ELECTION_TIMEOUT_TO_HEARTBEAT_RATIO,
  HB_INTERVAL_MS,
  MIN_SCALED_HEARTBEAT_MS,
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

function getElectionTimeout(nodeID: string): number {
  if (!electionTimeouts[nodeID]) {
    // 3000–6000ms fallback when backend timing metadata is absent.
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
    ? Math.max(MIN_SCALED_HEARTBEAT_MS, rawHeartbeatMs * VISUAL_TIME_SCALE)
    : (prev?.heartbeatInterval ?? HB_INTERVAL_MS);
  const fallbackElection = prev?.electionTimeout ?? getElectionTimeout(reply.node_id);
  const scaledElection = rawElectionMs > 0
    ? Math.max(scaledHeartbeat * ELECTION_TIMEOUT_TO_HEARTBEAT_RATIO, rawElectionMs * VISUAL_TIME_SCALE)
    : fallbackElection;

  // Keep election timeout stable while role stays the same to avoid denominator
  // jitter in the ring animation on frequent state pushes.
  const stableElection = prev &&
    prev.state === reply.state &&
    (reply.state === 'FOLLOWER' || reply.state === 'CANDIDATE')
    ? prev.electionTimeout
    : scaledElection;

  let candidateHoldUntil = Math.max(prev?.candidateHoldUntil ?? 0, candidateHintUntil);
  // Only apply the minimum candidate visibility hold after we already have
  // a prior snapshot for this node. On first observation this hold creates
  // a perceived "leader lag" during initial page load.
  if (reply.state === 'CANDIDATE' && prev) {
    candidateHoldUntil = Math.max(candidateHoldUntil, now + CANDIDATE_MIN_VISIBLE_MS);
  }
  if (reply.state === 'DEAD') {
    candidateHoldUntil = 0;
  } else if (candidateHoldUntil <= now && reply.state !== 'CANDIDATE') {
    candidateHoldUntil = 0;
  }

  let visualState = reply.state;
  if (reply.state !== 'DEAD' && candidateHoldUntil > now) {
    visualState = 'CANDIDATE';
  }

  // Preserve timer continuity across role transitions.
  // The periodic election tick computes progress from lastHeartbeat.
  const electionTimer = prev?.electionTimer ?? 0;
  const lastHeartbeat = prev?.lastHeartbeat ?? now;

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
    // Preserve election timer state across WS pushes — heartbeat pulses reset it.
    electionTimer,
    electionTimeout: stableElection,
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
