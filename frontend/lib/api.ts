// Package api is a thin client for the Raft gateway.
//
// In event-sourcing mode, most operations are read-only via WebSocket.
// This module retains types for compatibility and future gRPC-web integration.

import { gatewayBaseURL } from "@/lib/config";

export interface CommandResult {
  success: boolean;
  leader_id: string;
  duplicate: boolean;
  committed?: boolean;
  result?: string;
}

export interface SetAliveResult {
  node_id: string;
  alive: boolean;
}

export interface ClusterStateResponse {
  nodes: Array<{ node_id: string; state?: string; error?: string }>;
}

// NOTE: REST endpoints were removed in the event-sourcing refactor.
// The following functions are now implemented via gateway proxy to nodes.

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
