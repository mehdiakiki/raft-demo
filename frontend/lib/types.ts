export type NodeState = 'FOLLOWER' | 'CANDIDATE' | 'LEADER' | 'DEAD';

export interface RaftStateEvent {
  node_id: string;
  state?: NodeState;
  current_term?: string | number;
  voted_for?: string;
  event_time_ms?: string | number;
  commit_index?: string | number;
  last_applied?: string | number;
  leader_id?: string;
  elections_started?: string | number;
  elections_won?: string | number;
  election_timeout_ms?: string | number;
  heartbeat_interval_ms?: string | number;
}

export interface UINode {
  id: string;
  state: NodeState;
  actualState: NodeState;
  term: number;
  votedFor: string | null;
  commitIndex: number;
  leaderId: string | null;
  lastUpdate: number;
  stale: boolean;
  electionTimer: number;
  electionTimeout: number;
  heartbeatInterval: number;
  log: Array<{ term: number; command: string }>;
  electionStartedAt: number;
  candidateHoldUntil: number;
  backendHeartbeatIntervalMs: number;
  backendElectionTimeoutMs: number;
}

export interface HeartbeatMsg {
  id: string;
  from: string;
  to: string;
  progress: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

// API response types
export interface CommandResult {
  success: boolean;
  leader_id: string;
  duplicate: boolean;
  committed?: boolean;
  result?: string;
  routed_node?: string;
}

export interface SetAliveResult {
  node_id: string;
  alive: boolean;
}

export interface ClusterStateResponse {
  nodes: Array<UINode | { node_id: string; error: string }>;
}
