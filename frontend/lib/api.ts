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
// The following functions are placeholders for future gRPC-web integration.
// Currently, the demo operates in read-only visualization mode.

export async function submitCommand(
  _command: string,
  _clientID: string,
  _sequenceNum: number,
): Promise<CommandResult> {
  throw new Error("submitCommand not available in event-sourcing mode");
}

export async function killNode(_nodeID: string): Promise<SetAliveResult> {
  throw new Error("killNode not available in event-sourcing mode");
}

export async function restartNode(_nodeID: string): Promise<SetAliveResult> {
  throw new Error("restartNode not available in event-sourcing mode");
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
