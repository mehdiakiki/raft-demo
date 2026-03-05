import type { RaftStateEvent, UINode, NodeState } from './types';

const DEFAULT_ELECTION_TIMEOUT = 8000;
const DEFAULT_HEARTBEAT_INTERVAL = 2000;

export class RaftStateReconstructor {
  private nodes: Map<string, UINode> = new Map();
  private eventLog: RaftStateEvent[] = [];

  applyEvent(event: RaftStateEvent): void {
    const existing = this.nodes.get(event.node_id);
    const state = (event.state as NodeState) ?? existing?.state ?? 'FOLLOWER';
    const now = Date.now();
    const electionTimeout = Number(event.election_timeout_ms ?? existing?.electionTimeout ?? DEFAULT_ELECTION_TIMEOUT);
    const heartbeatInterval = Number(event.heartbeat_interval_ms ?? existing?.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL);

    const node: UINode = {
      id: event.node_id,
      state,
      actualState: state,
      term: Number(event.current_term ?? existing?.term ?? 0),
      votedFor: event.voted_for ?? existing?.votedFor ?? null,
      commitIndex: Number(event.commit_index ?? existing?.commitIndex ?? 0),
      leaderId: event.leader_id ?? existing?.leaderId ?? null,
      lastUpdate: Number(event.event_time_ms ?? now),
      stale: false,
      electionTimer: existing?.electionTimer ?? 0,
      electionTimeout,
      heartbeatInterval,
      log: existing?.log ?? [],
      electionStartedAt: existing?.electionStartedAt ?? now,
      candidateHoldUntil: existing?.candidateHoldUntil ?? 0,
      backendHeartbeatIntervalMs: heartbeatInterval,
      backendElectionTimeoutMs: electionTimeout,
    };

    if (state !== existing?.state) {
      node.electionTimer = 0;
      node.electionStartedAt = now;
    }

    this.nodes.set(event.node_id, node);
    this.eventLog.push(event);
  }

  getNodes(): Record<string, UINode> {
    const result: Record<string, UINode> = {};
    this.nodes.forEach((node, id) => {
      result[id] = node;
    });
    return result;
  }

  getEventLog(): RaftStateEvent[] {
    return [...this.eventLog];
  }

  clear(): void {
    this.nodes.clear();
    this.eventLog = [];
  }
}
