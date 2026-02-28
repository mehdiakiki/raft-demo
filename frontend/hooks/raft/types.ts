import type { NodeState } from '@/lib/types';

// RaftNode is the shape the visualizer consumes.
export interface RaftNode {
  // Stable node identifier (A/B/C...).
  id: string;
  // state is the current visual role shown in the UI.
  state: NodeState;
  // actualState is the latest authoritative role from backend telemetry.
  actualState: NodeState;
  term: number;
  votedFor: string | null;
  log: { term: number; command: string }[];
  commitIndex: number;
  // Leader replication state — undefined for non-leaders.
  nextIndex: Record<string, number>;
  matchIndex: Record<string, number>;
  // Leader heartbeat interval used for local UI interpolation.
  heartbeatInterval: number; // ms in visualization time
  // Election timer simulation — derived client-side from time since last HB.
  electionTimer: number;   // ms elapsed since last heartbeat reset
  electionTimeout: number; // randomized timeout in ms
  votesReceived: Set<string>;
  // lastUpdate: wall-clock ms of the last WS state push (used for staleness).
  lastUpdate: number;
  // lastHeartbeat: wall-clock ms of the last simulated heartbeat receipt.
  lastHeartbeat: number;
  // stale marks nodes that have not sent any WS state update within a safe window.
  stale: boolean;
  // candidateHoldUntil keeps CANDIDATE visible briefly even when the next
  // backend snapshot has already advanced to LEADER/FOLLOWER.
  candidateHoldUntil: number;
}

// HeartbeatMsg is an animated pulse emitted by the leader toward a follower.
export interface HeartbeatMsg {
  id: string;
  from: string;
  to: string;
  progress: number; // 0–1 travel progress
}

// LegacyMessageType mirrors old RPC animation labels kept for compatibility.
export type LegacyMessageType = 'REQUEST_VOTE' | 'VOTE_REPLY' | 'APPEND_ENTRIES' | 'APPEND_REPLY';

// LegacyMessage is the (currently optional) RPC animation payload shape.
export interface LegacyMessage {
  id: string;
  from: string;
  to: string;
  progress: number;
  type: LegacyMessageType;
}

// ConnectionStatus reflects the current WebSocket lifecycle.
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
