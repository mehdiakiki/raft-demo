// Package api is a thin HTTP client for gateway control endpoints.
//
// State telemetry is streamed via WebSocket. Control actions (kill/restart,
// submit command) go through gateway REST endpoints which proxy to Raft nodes.

import { gatewayBaseURL } from "@/lib/config";

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
  nodes: Array<{ node_id: string; state?: string; error?: string }>;
}

export async function submitCommand(
  command: string,
  clientID: string,
  sequenceNum: number,
  leaderID?: string,
): Promise<CommandResult> {
  const res = await fetch(`${gatewayBaseURL}/api/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command,
      client_id: clientID,
      sequence_num: sequenceNum,
      leader_id: leaderID ?? '',
    }),
  });

  if (!res.ok) {
    throw new Error(`submitCommand: HTTP ${res.status}`);
  }

  return res.json();
}

export async function killNode(nodeID: string): Promise<SetAliveResult> {
  const res = await fetch(`${gatewayBaseURL}/api/nodes/${nodeID}/kill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alive: false }),
  });

  if (!res.ok) {
    throw new Error(`killNode: HTTP ${res.status}`);
  }

  return res.json();
}

export async function restartNode(nodeID: string): Promise<SetAliveResult> {
  const res = await fetch(`${gatewayBaseURL}/api/nodes/${nodeID}/restart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alive: true }),
  });

  if (!res.ok) {
    throw new Error(`restartNode: HTTP ${res.status}`);
  }

  return res.json();
}

export async function fetchClusterState(): Promise<ClusterStateResponse> {
  const res = await fetch(`${gatewayBaseURL}/health`, {
    method: "GET",
  });

  if (!res.ok) {
    throw new Error(`fetchClusterState: HTTP ${res.status}`);
  }

  return { nodes: [] };
}
