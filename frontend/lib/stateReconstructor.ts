import type { RaftStateEvent, UINode, NodeState } from './types';

const DEFAULT_ELECTION_TIMEOUT = 8000;
const DEFAULT_HEARTBEAT_INTERVAL = 2000;
const VISUAL_CANDIDATE_HOLD_MS = 1500;

export class RaftStateReconstructor {
  private nodes: Map<string, UINode> = new Map();
  private eventLog: RaftStateEvent[] = [];

  applyEvent(event: RaftStateEvent): void {
    const existing = this.nodes.get(event.node_id);
    const now = Date.now();
    const actualState = (event.state as NodeState) ?? existing?.actualState ?? existing?.state ?? 'FOLLOWER';
    const electionTimeout = Number(event.election_timeout_ms ?? existing?.electionTimeout ?? DEFAULT_ELECTION_TIMEOUT);
    const heartbeatInterval = Number(event.heartbeat_interval_ms ?? existing?.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL);
    let visualState = existing?.state ?? actualState;
    let candidateHoldUntil = existing?.candidateHoldUntil ?? 0;

    if (!existing) {
      visualState = actualState;
      candidateHoldUntil = 0;
    } else if (actualState !== existing.actualState) {
      if (actualState === 'CANDIDATE') {
        visualState = 'CANDIDATE';
        candidateHoldUntil = now + VISUAL_CANDIDATE_HOLD_MS;
      } else if (
        actualState === 'LEADER' &&
        existing.actualState !== 'LEADER' &&
        existing.actualState !== 'DEAD'
      ) {
        // Some backend snapshots can skip the short candidate phase.
        // Force a brief candidate visual so leader failover is perceptible.
        visualState = 'CANDIDATE';
        candidateHoldUntil = Math.max(candidateHoldUntil, now + VISUAL_CANDIDATE_HOLD_MS);
      } else if (!(actualState === 'LEADER' && visualState === 'CANDIDATE' && candidateHoldUntil > now)) {
        visualState = actualState;
        candidateHoldUntil = 0;
      }
    } else if (visualState !== actualState && candidateHoldUntil <= now) {
      visualState = actualState;
      candidateHoldUntil = 0;
    }

    const node: UINode = {
      id: event.node_id,
      state: visualState,
      actualState,
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
      candidateHoldUntil,
      backendHeartbeatIntervalMs: heartbeatInterval,
      backendElectionTimeoutMs: electionTimeout,
    };

    if (actualState !== existing?.actualState) {
      node.electionTimer = 0;
      node.electionStartedAt = now;
    }

    this.nodes.set(event.node_id, node);
    this.eventLog.push(event);
  }

  applyHeartbeat(nodeID: string, eventTimeMs?: string | number): void {
    const existing = this.nodes.get(nodeID);
    if (!existing || existing.actualState === 'LEADER' || existing.actualState === 'DEAD') {
      return;
    }

    const heartbeatTime = Number(eventTimeMs ?? Date.now());
    this.nodes.set(nodeID, {
      ...existing,
      state: 'FOLLOWER',
      actualState: existing.actualState === 'CANDIDATE' ? 'FOLLOWER' : existing.actualState,
      electionTimer: 0,
      electionStartedAt: heartbeatTime,
      lastUpdate: Math.max(existing.lastUpdate, heartbeatTime),
      stale: false,
      candidateHoldUntil: 0,
    });
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
