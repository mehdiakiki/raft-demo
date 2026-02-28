// useRaft connects the visualizer to the real Raft cluster.
//
// It opens a WebSocket to the gateway and maps every NodeStateReply message
// onto the RaftNode shape the visualizer already understands. REST calls for
// commands and kill/restart are delegated to lib/api.ts.
//
// The hook also maintains a local sequence counter per browser session so that
// every submitted command carries a unique (clientID, sequenceNum) pair,
// enabling exactly-once delivery (§8).

import { useState, useRef, useCallback, useEffect } from "react";
import { fetchClusterState, submitCommand, killNode, restartNode } from "@/lib/api";
import {
  DEFAULT_CHAOS_MODE,
  DEFAULT_MESSAGE_SPEED,
  SESSION_ID,
} from "@/hooks/raft/constants";
import { useGatewayStream } from "@/hooks/raft/useGatewayStream";
import { useElectionTick } from "@/hooks/raft/useElectionTick";
import { useHeartbeatEffects } from "@/hooks/raft/useHeartbeatEffects";
import { isNodeStateReply, mapReplyToNode } from "@/hooks/raft/helpers";
import type { CommandResult, NodeState } from "@/lib/types";
import type {
  ConnectionStatus,
  HeartbeatMsg,
  LegacyMessage,
  RaftNode,
} from "@/hooks/raft/types";

export type {
  ConnectionStatus,
  HeartbeatMsg,
  LegacyMessage,
  LegacyMessageType,
  RaftNode,
} from "@/hooks/raft/types";

type NodesByID = Record<string, RaftNode>;
type SetAndTrackNodes = (updater: (prev: NodesByID) => NodesByID) => void;

export function useRaft() {
  // Public UI state exposed by the hook.
  const [nodes, setNodes] = useState<NodesByID>({});
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [isRunning, setIsRunningState] = useState(false);
  const [heartbeats, setHeartbeats] = useState<HeartbeatMsg[]>([]);

  // Shared mutable refs consumed by internal effect hooks.
  // These avoid stale closures in timers/WS callbacks without forcing re-renders.
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  const lastHBRef = useRef(0);
  const nodesRef = useRef<NodesByID>({});
  const lastGatewayFrameAtRef = useRef(0);
  const candidateHintUntilRef = useRef<Record<string, number>>({});
  const lastTickTraceAtRef = useRef<Record<string, number>>({});

  // Centralized node-state writer used across all sub-hooks.
  // Keeps React state and nodesRef in sync atomically.
  const setAndTrackNodes = useCallback<SetAndTrackNodes>((updater) => {
    setNodes((prev) => {
      const next = updater(prev);
      if (next !== prev) {
        nodesRef.current = next;
      }
      return next;
    });
  }, []);

  // 1) Real-time transport (WS connect/reconnect + frame processing).
  const { connect } = useGatewayStream({
    setAndTrackNodes,
    setStatus,
    setIsRunningState,
    wsRef,
    reconnectTimerRef,
    attemptRef,
    mountedRef,
    shouldReconnectRef,
    lastGatewayFrameAtRef,
    candidateHintUntilRef,
  });

  // 2) Local time-based state derivation (election ring progression + stale flags).
  useElectionTick({
    setAndTrackNodes,
    lastGatewayFrameAtRef,
    candidateHintUntilRef,
    lastTickTraceAtRef,
  });

  // 3) Heartbeat animation and follower timeout resets.
  useHeartbeatEffects({
    setAndTrackNodes,
    setHeartbeats,
    nodesRef,
    lastHBRef,
  });

  // 4) Snapshot hydration on connect — avoids first-render delay waiting
  // for the next periodic WS state frame.
  const hydrateClusterSnapshot = useCallback(async () => {
    try {
      const snapshot = await fetchClusterState();
      if (!mountedRef.current || !Array.isArray(snapshot.nodes)) return;

      const snapshotNodes = snapshot.nodes.filter(isNodeStateReply);
      if (snapshotNodes.length === 0) return;

      const now = Date.now();
      setAndTrackNodes((prev) => {
        let changed = false;
        const next = { ...prev };

        for (const candidate of snapshotNodes) {
          const existing = prev[candidate.node_id];
          const candidateHintUntil = candidateHintUntilRef.current[candidate.node_id] ?? 0;
          next[candidate.node_id] = mapReplyToNode(candidate, existing, candidateHintUntil, now);
          changed = true;
        }

        return changed ? next : prev;
      });
    } catch (err) {
      console.warn("cluster snapshot hydration failed", err);
    }
  }, [setAndTrackNodes]);

  useEffect(() => {
    if (status !== "connected") return;
    hydrateClusterSnapshot();
  }, [hydrateClusterSnapshot, status]);

  // toggleNodeState calls kill/restart via REST depending on current state.
  const toggleNodeState = useCallback(
    (id: string) => {
      const node = nodes[id];
      if (!node) return;

      const wasDead = node.actualState === "DEAD";
      const nextVisualState: NodeState = wasDead ? "FOLLOWER" : "DEAD";
      const request = wasDead ? restartNode(id) : killNode(id);

      request.catch((err) => {
        console.error(err);
        // Revert optimistic visual state on REST failure.
        setAndTrackNodes((prev) => {
          const current = prev[id];
          if (!current) return prev;
          return {
            ...prev,
            [id]: {
              ...current,
              state: current.actualState,
              candidateHoldUntil: 0,
            },
          };
        });
      });

      // Optimistic UI: update only visual state immediately.
      // actualState remains backend-authoritative.
      setAndTrackNodes((prev) => {
        const current = prev[id];
        if (!current) return prev;
        return {
          ...prev,
          [id]: {
            ...current,
            state: nextVisualState,
            candidateHoldUntil: 0,
          },
        };
      });
    },
    [nodes, setAndTrackNodes],
  );

  // clientRequest submits a command to the cluster leader via REST.
  // Uses a monotonically increasing sequence number for deduplication (§8).
  const clientRequest = useCallback((command: string): Promise<CommandResult> => {
    seqRef.current += 1;
    return submitCommand(command, SESSION_ID, seqRef.current);
  }, []);

  // setIsRunning lets the visualizer connect/disconnect the WebSocket.
  const setIsRunning = useCallback(
    (running: boolean) => {
      if (running && wsRef.current?.readyState !== WebSocket.OPEN) {
        shouldReconnectRef.current = true;
        attemptRef.current = 0;
        connect();
      } else if (!running) {
        shouldReconnectRef.current = false;
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        wsRef.current?.close();
        setStatus("disconnected");
        setIsRunningState(false);
      }
    },
    [connect],
  );

  // Return shape is intentionally backward-compatible with the older visualizer API.
  return {
    nodes,
    status,
    heartbeats,
    messages: [] as LegacyMessage[], // legacy — use heartbeats instead
    isRunning,
    setIsRunning,
    toggleNodeState,
    clientRequest,
    reset: () => {
      shouldReconnectRef.current = true;
      attemptRef.current = 0;
      setStatus("connecting");
      connect();
    },
    messageSpeed: DEFAULT_MESSAGE_SPEED,
    setMessageSpeed: (_: number) => {},
    chaosMode: DEFAULT_CHAOS_MODE,
    setChaosMode: (_: boolean) => {},
  };
}
