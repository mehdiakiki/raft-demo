import { useState, useEffect, useRef, useCallback } from "react";
import { RaftStateReconstructor } from "@/lib/stateReconstructor";
import * as api from "@/lib/api";
import { encodeUserCommand } from "@/lib/commandCodec";
import type {
  RaftStateEvent,
  UINode,
  NodeState,
  ConnectionStatus,
} from "@/lib/types";

const WS_URL = "ws://localhost:8080/ws";
const CANDIDATE_HINT_THRESHOLD = 1.0;
const CANDIDATE_HINT_HOLD_MS = 1500;

export type RaftNode = UINode;

export interface HeartbeatMsg {
  id: string;
  from: string;
  to: string;
  progress: number;
}

export type LegacyMessageType =
  | "REQUEST_VOTE"
  | "VOTE_REPLY"
  | "APPEND_ENTRIES"
  | "APPEND_REPLY";

export interface LegacyMessage {
  id: string;
  from: string;
  to: string;
  progress: number;
  type: LegacyMessageType;
  voteGranted?: boolean;
}

export interface CandidateVoteTally {
  candidateId: string;
  term: number;
  granted: number;
  quorum: number;
  status: "collecting" | "quorum";
}

interface RpcEventPayload {
  type: "rpc";
  from_node: string;
  to_node: string;
  rpc_type: LegacyMessageType | string;
  event_time_ms?: string | number;
  vote_granted?: boolean;
  term?: string | number;
  candidate_id?: string;
  rpc_id?: string;
}

function isTimedRole(state: NodeState): boolean {
  return state === "FOLLOWER" || state === "CANDIDATE";
}

function toMs(value: string | number | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function buildVoteTallies(
  nodes: Record<string, RaftNode>,
): Record<string, CandidateVoteTally> {
  const tallies: Record<string, CandidateVoteTally> = {};
  const nodeCount = Math.max(1, Object.keys(nodes).length);
  const quorum = Math.floor(nodeCount / 2) + 1;

  for (const [id, node] of Object.entries(nodes)) {
    if (node.actualState !== "CANDIDATE" && node.state !== "CANDIDATE") {
      continue;
    }

    let granted = 0;
    for (const voter of Object.values(nodes)) {
      if (voter.votedFor === id && voter.term === node.term) {
        granted += 1;
      }
    }

    tallies[id] = {
      candidateId: id,
      term: node.term,
      granted,
      quorum,
      status: granted >= quorum ? "quorum" : "collecting",
    };
  }

  return tallies;
}

function mergeRealtimeNodeState(
  prevNodes: Record<string, RaftNode>,
  nextNodes: Record<string, RaftNode>,
  now = Date.now(),
): Record<string, RaftNode> {
  const merged: Record<string, RaftNode> = {};

  for (const id of Object.keys(nextNodes)) {
    const nextNode = nextNodes[id];
    const prevNode = prevNodes[id];

    if (!prevNode) {
      merged[id] = nextNode;
      continue;
    }

    const sameActualState = nextNode.actualState === prevNode.actualState;
    const sameElectionCycle = nextNode.electionStartedAt === prevNode.electionStartedAt;
    const preserveTimerProgress =
      sameActualState && sameElectionCycle && isTimedRole(nextNode.actualState);
    const preserveCandidateHold =
      sameActualState &&
      prevNode.state === "CANDIDATE" &&
      prevNode.candidateHoldUntil > now;

    merged[id] = {
      ...nextNode,
      electionTimer: preserveTimerProgress
        ? prevNode.electionTimer
        : nextNode.electionTimer,
      electionTimeout: preserveTimerProgress
        ? prevNode.electionTimeout
        : nextNode.electionTimeout,
      state: preserveCandidateHold ? prevNode.state : nextNode.state,
      candidateHoldUntil: preserveCandidateHold
        ? prevNode.candidateHoldUntil
        : nextNode.candidateHoldUntil,
    };
  }

  return merged;
}

function createClientID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `fe-${crypto.randomUUID()}`;
  }
  return `fe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useRaft() {
  const [nodes, setNodes] = useState<Record<string, RaftNode>>({});
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [isRunning, setIsRunningState] = useState(false);
  const [heartbeats, setHeartbeats] = useState<HeartbeatMsg[]>([]);
  const [messages, setMessages] = useState<LegacyMessage[]>([]);
  const [messageSpeed, setMessageSpeed] = useState(0.02);
  const [voteTallies, setVoteTallies] = useState<Record<string, CandidateVoteTally>>({});

  const reconstructorRef = useRef(new RaftStateReconstructor());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const shouldReconnectRef = useRef(true);
  const suppressReconnectOnCloseRef = useRef(false);
  const clientIDRef = useRef(createClientID());
  const clientSequenceRef = useRef(0);
  const lastRpcSeenRef = useRef<Map<string, number>>(new Map());
  const voteTrackerRef = useRef<Map<string, { term: number; votedFor: string }>>(new Map());

  const enqueueMessage = useCallback(
    (
      type: LegacyMessageType,
      from: string,
      to: string,
      eventTime: string | number | undefined,
      voteGranted?: boolean,
    ) => {
      const eventTimeMs = toMs(eventTime);
      const dedupeKey = `${type}|${from}|${to}|${voteGranted === undefined ? "na" : String(voteGranted)}`;
      const dedupeWindowMs = type === "APPEND_ENTRIES" ? 120 : 200;
      const lastSeen = lastRpcSeenRef.current.get(dedupeKey);

      if (lastSeen !== undefined && Math.abs(eventTimeMs - lastSeen) <= dedupeWindowMs) {
        return;
      }

      lastRpcSeenRef.current.set(dedupeKey, eventTimeMs);
      if (lastRpcSeenRef.current.size > 512) {
        const cutoff = eventTimeMs - 10_000;
        for (const [key, ts] of lastRpcSeenRef.current.entries()) {
          if (ts < cutoff) {
            lastRpcSeenRef.current.delete(key);
          }
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `${type}-${from}-${to}-${eventTimeMs}-${Math.random().toString(16).slice(2)}`,
          from,
          to,
          type,
          voteGranted,
          progress: 0,
        },
      ]);
    },
    [],
  );

  const trackVoteAndEmitReply = useCallback(
    (stateEvent: RaftStateEvent) => {
      const nodeID = stateEvent.node_id;
      const previous = voteTrackerRef.current.get(nodeID) ?? { term: 0, votedFor: "" };
      const term = Number(stateEvent.current_term ?? previous.term);
      const hasVotedForField = Object.prototype.hasOwnProperty.call(stateEvent, "voted_for");
      let votedFor = previous.votedFor;

      if (hasVotedForField) {
        votedFor = (stateEvent.voted_for ?? "").trim();
      } else if (Number.isFinite(term) && term > previous.term) {
        votedFor = "";
      }

      const shouldEmitGrant =
        votedFor.length > 0 &&
        votedFor !== nodeID &&
        (votedFor !== previous.votedFor || term !== previous.term);

      if (shouldEmitGrant) {
        enqueueMessage("VOTE_REPLY", nodeID, votedFor, stateEvent.event_time_ms, true);
      }

      voteTrackerRef.current.set(nodeID, {
        term: Number.isFinite(term) ? term : previous.term,
        votedFor,
      });
    },
    [enqueueMessage],
  );

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    setStatus("connecting");

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close();
        return;
      }
      setStatus("connected");
      setIsRunningState(true);
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      if (!mountedRef.current) return;

      try {
        const payload = JSON.parse(event.data);

        if (payload.type === "rpc" && payload.from_node && payload.to_node) {
          const rpcEvent = payload as RpcEventPayload;
          const rpcType = String(rpcEvent.rpc_type || "");

          if (rpcType === "APPEND_ENTRIES") {
            setHeartbeats((prev) => [
              ...prev,
              {
                id: `hb-${rpcEvent.from_node}-${rpcEvent.to_node}-${toMs(rpcEvent.event_time_ms)}`,
                from: rpcEvent.from_node,
                to: rpcEvent.to_node,
                progress: 0,
              },
            ]);

            reconstructorRef.current.applyHeartbeat(
              rpcEvent.to_node,
              rpcEvent.event_time_ms,
            );
            const snapshot = reconstructorRef.current.getNodes();
            setNodes((prev) => mergeRealtimeNodeState(prev, snapshot));
            return;
          }

          if (rpcType === "REQUEST_VOTE") {
            enqueueMessage(
              "REQUEST_VOTE",
              rpcEvent.from_node,
              rpcEvent.to_node,
              rpcEvent.event_time_ms,
            );
            return;
          }

          if (rpcType === "VOTE_REPLY") {
            const candidateID = rpcEvent.candidate_id?.trim();
            const target = candidateID && candidateID.length > 0
              ? candidateID
              : rpcEvent.to_node;

            enqueueMessage(
              "VOTE_REPLY",
              rpcEvent.from_node,
              target,
              rpcEvent.event_time_ms,
              rpcEvent.vote_granted,
            );
            return;
          }

          return;
        }

        // Handle state events
        const stateEvent = payload as RaftStateEvent;
        if (!stateEvent.node_id) return;

        trackVoteAndEmitReply(stateEvent);
        reconstructorRef.current.applyEvent(stateEvent);
        const snapshot = reconstructorRef.current.getNodes();
        setNodes((prev) => mergeRealtimeNodeState(prev, snapshot));
      } catch {
        // Malformed message — ignore
      }
    };

    ws.onerror = () => {
      // onclose will handle reconnection
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;

      if (suppressReconnectOnCloseRef.current) {
        suppressReconnectOnCloseRef.current = false;
        return;
      }

      if (!shouldReconnectRef.current) {
        setStatus("disconnected");
        setIsRunningState(false);
        return;
      }

      setStatus("reconnecting");
      reconnectTimerRef.current = setTimeout(connect, 1000);
    };
  }, [enqueueMessage, trackVoteAndEmitReply]);

  useEffect(() => {
    mountedRef.current = true;
    shouldReconnectRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  useEffect(() => {
    const interval = setInterval(() => {
      const messageStep = Math.min(
        0.2,
        0.05 * (0.02 / Math.max(0.005, messageSpeed)),
      );
      setHeartbeats((prev) =>
        prev
          .map((h) => ({ ...h, progress: h.progress + 0.05 }))
          .filter((h) => h.progress < 1),
      );
      setMessages((prev) =>
        prev
          .map((m) => ({ ...m, progress: m.progress + messageStep }))
          .filter((m) => m.progress < 1),
      );
    }, 50);
    return () => clearInterval(interval);
  }, [messageSpeed]);

  useEffect(() => {
    setVoteTallies(buildVoteTallies(nodes));
  }, [nodes]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setNodes((prev) => {
        const updated = { ...prev };
        for (const id of Object.keys(updated)) {
          const node = updated[id];
          const isTimedRole =
            node.actualState === "FOLLOWER" || node.actualState === "CANDIDATE";
          const elapsed = isTimedRole ? now - node.electionStartedAt : 0;
          const electionTimer = isTimedRole
            ? Math.min(elapsed, node.electionTimeout)
            : 0;
          let visualState = node.state;
          let candidateHoldUntil = node.candidateHoldUntil;

          if (node.actualState === "FOLLOWER") {
            const progress =
              node.electionTimeout > 0 ? electionTimer / node.electionTimeout : 0;
            if (progress >= CANDIDATE_HINT_THRESHOLD) {
              visualState = "CANDIDATE";
              candidateHoldUntil = Math.max(
                candidateHoldUntil,
                now + CANDIDATE_HINT_HOLD_MS,
              );
            } else if (
              visualState === "CANDIDATE" &&
              candidateHoldUntil <= now
            ) {
              visualState = "FOLLOWER";
              candidateHoldUntil = 0;
            }
          } else if (node.actualState === "LEADER" || node.actualState === "DEAD") {
            if (
              !(
                node.actualState === "LEADER" &&
                visualState === "CANDIDATE" &&
                candidateHoldUntil > now
              )
            ) {
              visualState = node.actualState;
              candidateHoldUntil = 0;
            }
          } else {
            visualState = "CANDIDATE";
            candidateHoldUntil = Math.max(
              candidateHoldUntil,
              now + CANDIDATE_HINT_HOLD_MS,
            );
          }

          updated[id] = {
            ...node,
            state: visualState,
            electionTimer,
            candidateHoldUntil,
          };
        }
        return updated;
      });
    }, 50);
    return () => clearInterval(interval);
  }, []);

  const toggleNodeState = useCallback(
    async (id: string) => {
      const node = nodes[id];
      if (!node) return;

      try {
        if (node.state === "DEAD") {
          await api.restartNode(id);
        } else {
          await api.killNode(id);
        }
      } catch (err) {
        console.error("toggleNodeState failed", err);
      }
    },
    [nodes],
  );

  const clientRequest = useCallback(
    async (command: string) => {
      const encodedCommand = encodeUserCommand(command);
      const leaderEntry = Object.entries(nodes).find(
        ([, node]) => node.actualState === "LEADER" && !node.stale,
      );

      clientSequenceRef.current += 1;
      return api.submitCommand(
        encodedCommand,
        clientIDRef.current,
        clientSequenceRef.current,
        leaderEntry?.[0] ?? "",
      );
    },
    [nodes],
  );

  const setIsRunning = useCallback(
    (running: boolean) => {
      if (running) {
        shouldReconnectRef.current = true;
        setStatus("connecting");
        connect();
      } else {
        shouldReconnectRef.current = false;
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
          suppressReconnectOnCloseRef.current = true;
          wsRef.current.close();
        }
        setMessages([]);
        setHeartbeats([]);
        voteTrackerRef.current.clear();
        lastRpcSeenRef.current.clear();
        setStatus("disconnected");
        setIsRunningState(false);
      }
    },
    [connect],
  );

  return {
    nodes,
    status,
    voteTallies,
    messages,
    heartbeats,
    isRunning,
    setIsRunning,
    toggleNodeState,
    clientRequest,
    reset: () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
        suppressReconnectOnCloseRef.current = true;
        wsRef.current.close();
      }
      shouldReconnectRef.current = true;
      setStatus("connecting");
      setMessages([]);
      setHeartbeats([]);
      voteTrackerRef.current.clear();
      lastRpcSeenRef.current.clear();
      connect();
    },
    messageSpeed,
    setMessageSpeed,
    chaosMode: false,
    setChaosMode: (_: boolean) => {},
  };
}

export type { UINode, ConnectionStatus, RaftStateEvent, NodeState };
