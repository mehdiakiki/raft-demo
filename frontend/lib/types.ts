// Package types defines the TypeScript interfaces that mirror the backend's
// protobuf-generated JSON wire format.
//
// The gateway serialises pb.NodeStateReply to JSON using proto field names
// (snake_case), so these interfaces match exactly what arrives over the wire.
// Keeping them in one place means a proto change is a one-file fix here too.

// LogEntry mirrors pb.LogEntry.
export interface LogEntry {
  term: number;
  type: number;      // 0=COMMAND, 1=NOOP, 2=CONFIG
  command: string;
  client_id: string;
  sequence_num: number;
}

// NodeState is the string union the backend sends in the `state` field.
export type NodeState = 'FOLLOWER' | 'CANDIDATE' | 'LEADER' | 'DEAD';

// NodeStateReply mirrors pb.NodeStateReply — the JSON shape pushed over the
// WebSocket and returned by GET /api/nodes/{id}/state.
export interface NodeStateReply {
  node_id: string;
  state: NodeState;
  current_term: number;
  voted_for: string;
  commit_index: number;
  last_applied: number;
  log: LogEntry[];
  leader_id: string;
  // Only populated for LEADER nodes.
  next_index?: Record<string, number>;
  match_index?: Record<string, number>;
  // Optional timing telemetry for frontend interpolation.
  heartbeat_interval_ms?: number;
  election_timeout_ms?: number;
}

// StateTransitionEvent is emitted by the gateway when it observes a node role
// transition in the streamed state feed.
export interface StateTransitionEvent {
  type: 'state_transition';
  node_id: string;
  from: NodeState;
  to: NodeState;
  term: number;
  inferred?: boolean;
  at_unix_ms: number;
}

// CommandResult is the JSON body returned by POST /api/command.
export interface CommandResult {
  success: boolean;
  leader_id: string;
  duplicate: boolean;
}

// SetAliveResult is the JSON body returned by POST /api/nodes/{id}/kill|restart.
export interface SetAliveResult {
  node_id: string;
  alive: boolean;
}

// ClusterStateResponse is the JSON body returned by GET /api/cluster/state.
// Nodes can be either state payloads or per-node error placeholders.
export interface ClusterStateResponse {
  nodes: Array<NodeStateReply | { node_id: string; error: string }>;
}
