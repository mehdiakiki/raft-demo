// Package api is a thin REST client for the Raft gateway.
//
// Every function maps 1-to-1 to a gateway endpoint. No business logic lives
// here — callers decide what to do with the result.
//
// Endpoints:
//   POST /api/command              — submit a KV command to the leader
//   GET  /api/cluster/state        — fetch aggregate state for all nodes
//   POST /api/nodes/{id}/kill      — simulate node failure
//   POST /api/nodes/{id}/restart   — bring a dead node back

import { gatewayBaseURL } from "@/lib/config";
import type {
  ClusterStateResponse,
  CommandResult,
  SetAliveResult,
} from "@/lib/types";

// submitCommand sends a raw command string to the cluster leader.
//
// The gateway tries each node until it finds the leader. Returns the leader ID
// and a duplicate flag (for exactly-once deduplication, §8).
export async function submitCommand(
  command: string,
  clientID: string,
  sequenceNum: number,
): Promise<CommandResult> {
  const res = await fetch(`${gatewayBaseURL}/api/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      command,
      client_id: clientID,
      sequence_num: sequenceNum,
    }),
  });

  if (!res.ok) {
    throw new Error(`submitCommand: HTTP ${res.status} — ${await res.text()}`);
  }

  return res.json() as Promise<CommandResult>;
}

// killNode simulates a node failure by calling POST /api/nodes/{id}/kill.
// The node transitions to DEAD and stops responding to RPCs.
export async function killNode(nodeID: string): Promise<SetAliveResult> {
  const res = await fetch(`${gatewayBaseURL}/api/nodes/${nodeID}/kill`, {
    method: "POST",
  });

  if (!res.ok) {
    throw new Error(
      `killNode(${nodeID}): HTTP ${res.status} — ${await res.text()}`,
    );
  }

  return res.json() as Promise<SetAliveResult>;
}

// restartNode brings a DEAD node back to FOLLOWER state.
export async function restartNode(nodeID: string): Promise<SetAliveResult> {
  const res = await fetch(`${gatewayBaseURL}/api/nodes/${nodeID}/restart`, {
    method: "POST",
  });

  if (!res.ok) {
    throw new Error(
      `restartNode(${nodeID}): HTTP ${res.status} — ${await res.text()}`,
    );
  }

  return res.json() as Promise<SetAliveResult>;
}

// fetchClusterState returns an immediate state snapshot for all nodes.
export async function fetchClusterState(): Promise<ClusterStateResponse> {
  const res = await fetch(`${gatewayBaseURL}/api/cluster/state`, {
    method: "GET",
  });

  if (!res.ok) {
    throw new Error(`fetchClusterState: HTTP ${res.status} — ${await res.text()}`);
  }

  return res.json() as Promise<ClusterStateResponse>;
}
