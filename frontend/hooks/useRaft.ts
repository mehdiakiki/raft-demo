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
  | "PRE_VOTE"
  | "PRE_VOTE_REPLY"
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
  rejected: number;
  quorum: number;
  status: "collecting" | "quorum";
}

interface VoteLedgerEntry {
  candidateId: string;
  term: number;
  grantedBy: Set<string>;
  rejectedBy: Set<string>;
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
  direction?: string;
}

function isTimedRole(state: NodeState): boolean {
  return state === "FOLLOWER" || state === "CANDIDATE";
}

function toMs(value: string | number | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function voteLedgerKey(candidateId: string, term: number): string {
  return `${candidateId}:${term}`;
}

function buildVoteTallies(
  nodes: Record<string, RaftNode>,
  ledger: Map<string, VoteLedgerEntry>,
): Record<string, CandidateVoteTally> {
  const tallies: Record<string, CandidateVoteTally> = {};
  const nodeCount = Math.max(1, Object.keys(nodes).length);
  const quorum = Math.floor(nodeCount / 2) + 1;

  for (const [id, node] of Object.entries(nodes)) {
    if (node.actualState !== "CANDIDATE" && node.state !== "CANDIDATE") {
      continue;
    }

    const entry = ledger.get(voteLedgerKey(id, node.term));
    const grantedBy = new Set(entry?.grantedBy ?? []);
    const rejectedBy = new Set(entry?.rejectedBy ?? []);

    const granted = grantedBy.size;
    const rejected = rejectedBy.size;

    tallies[id] = {
      candidateId: id,
      term: node.term,
      granted,
      rejected,
      quorum,
      status: granted >= quorum ? "quorum" : "collecting",
    };
  }

  return tallies;
}

function pruneSeenMap(store: Map<string, number>, cutoff: number): void {
  for (const [key, ts] of store.entries()) {
    if (ts < cutoff) {
      store.delete(key);
    }
  }
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
  const [voteLedgerVersion, setVoteLedgerVersion] = useState(0);

  const reconstructorRef = useRef(new RaftStateReconstructor());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const shouldReconnectRef = useRef(true);
  const suppressReconnectOnCloseRef = useRef(false);
  const clientIDRef = useRef(createClientID());
  const clientSequenceRef = useRef(0);
  const seenRpcIDsRef = useRef<Map<string, number>>(new Map());
  const fallbackRpcSeenRef = useRef<Map<string, number>>(new Map());
  const voteLedgerRef = useRef<Map<string, VoteLedgerEntry>>(new Map());

  const isDuplicateRPC = useCallback((rpcEvent: RpcEventPayload): boolean => {
    const eventTimeMs = toMs(rpcEvent.event_time_ms);
    const rpcID = rpcEvent.rpc_id?.trim();
    if (rpcID && rpcID.length > 0) {
      if (seenRpcIDsRef.current.has(rpcID)) {
        return true;
      }
      seenRpcIDsRef.current.set(rpcID, eventTimeMs);
      if (seenRpcIDsRef.current.size > 1024) {
        pruneSeenMap(seenRpcIDsRef.current, eventTimeMs - 30_000);
      }
      return false;
    }

    // Legacy payload fallback (no rpc_id): dedupe deterministically by event identity.
    const fallbackKey = [
      rpcEvent.rpc_type,
      rpcEvent.from_node,
      rpcEvent.to_node,
      rpcEvent.candidate_id ?? "",
      String(rpcEvent.vote_granted ?? "na"),
      String(rpcEvent.term ?? "na"),
      String(eventTimeMs),
    ].join("|");
    if (fallbackRpcSeenRef.current.has(fallbackKey)) {
      return true;
    }

    fallbackRpcSeenRef.current.set(fallbackKey, eventTimeMs);
    if (fallbackRpcSeenRef.current.size > 1024) {
      pruneSeenMap(fallbackRpcSeenRef.current, eventTimeMs - 30_000);
    }
    return false;
  }, []);

  const upsertVoteLedger = useCallback(
    (
      candidateId: string,
      term: number,
      voterId: string,
      voteGranted?: boolean,
    ) => {
      if (!candidateId || !Number.isFinite(term)) {
        return;
      }

      const key = voteLedgerKey(candidateId, term);
      const existing = voteLedgerRef.current.get(key) ?? {
        candidateId,
        term,
        grantedBy: new Set<string>(),
        rejectedBy: new Set<string>(),
      };

      if (voteGranted === true) {
        existing.grantedBy.add(voterId);
        existing.rejectedBy.delete(voterId);
      } else if (voteGranted === false) {
        existing.rejectedBy.add(voterId);
        existing.grantedBy.delete(voterId);
      }

      voteLedgerRef.current.set(key, existing);
      setVoteLedgerVersion((prev) => prev + 1);
    },
    [],
  );

  const seedCandidateSelfVote = useCallback((candidateId: string, term: number) => {
    if (!candidateId || !Number.isFinite(term)) {
      return;
    }
    for (const [key, entry] of voteLedgerRef.current.entries()) {
      if (entry.candidateId === candidateId && entry.term < term) {
        voteLedgerRef.current.delete(key);
      }
    }
    const key = voteLedgerKey(candidateId, term);
    const existing = voteLedgerRef.current.get(key) ?? {
      candidateId,
      term,
      grantedBy: new Set<string>(),
      rejectedBy: new Set<string>(),
    };
    if (!existing.grantedBy.has(candidateId)) {
      existing.grantedBy.add(candidateId);
      voteLedgerRef.current.set(key, existing);
      setVoteLedgerVersion((prev) => prev + 1);
    }
  }, []);

  const enqueueMessage = useCallback(
    (
      type: LegacyMessageType,
      from: string,
      to: string,
      eventTime: string | number | undefined,
      rpcID?: string,
      voteGranted?: boolean,
    ) => {
      const eventTimeMs = toMs(eventTime);
      const stableID = rpcID?.trim();
      setMessages((prev) => [
        ...prev,
        {
          id: stableID && stableID.length > 0
            ? stableID
            : `${type}-${from}-${to}-${eventTimeMs}-${Math.random().toString(16).slice(2)}`,
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
          const direction = rpcEvent.direction?.trim().toUpperCase();
          if (direction && direction !== "SEND") {
            return;
          }
          if (isDuplicateRPC(rpcEvent)) {
            return;
          }

          if (rpcType === "APPEND_ENTRIES") {
            setHeartbeats((prev) => [
              ...prev,
              {
                id: rpcEvent.rpc_id?.trim() || `hb-${rpcEvent.from_node}-${rpcEvent.to_node}-${toMs(rpcEvent.event_time_ms)}`,
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
            const candidateID = rpcEvent.candidate_id?.trim() || rpcEvent.from_node;
            const term = Number(rpcEvent.term);
            if (Number.isFinite(term) && candidateID.length > 0) {
              seedCandidateSelfVote(candidateID, term);
            }
            enqueueMessage(
              "REQUEST_VOTE",
              rpcEvent.from_node,
              rpcEvent.to_node,
              rpcEvent.event_time_ms,
              rpcEvent.rpc_id,
            );
            return;
          }

          if (rpcType === "PRE_VOTE") {
            enqueueMessage(
              "PRE_VOTE",
              rpcEvent.from_node,
              rpcEvent.to_node,
              rpcEvent.event_time_ms,
              rpcEvent.rpc_id,
            );
            return;
          }

          if (rpcType === "PRE_VOTE_REPLY") {
            const candidateID = rpcEvent.candidate_id?.trim();
            const target = candidateID && candidateID.length > 0
              ? candidateID
              : rpcEvent.to_node;
            const voteGranted = typeof rpcEvent.vote_granted === "boolean"
              ? rpcEvent.vote_granted
              : undefined;

            enqueueMessage(
              "PRE_VOTE_REPLY",
              rpcEvent.from_node,
              target,
              rpcEvent.event_time_ms,
              rpcEvent.rpc_id,
              voteGranted,
            );
            return;
          }

          if (rpcType === "VOTE_REPLY") {
            const candidateID = rpcEvent.candidate_id?.trim();
            const target = candidateID && candidateID.length > 0
              ? candidateID
              : rpcEvent.to_node;
            const term = Number(rpcEvent.term);
            const voteGranted = typeof rpcEvent.vote_granted === "boolean"
              ? rpcEvent.vote_granted
              : undefined;

            enqueueMessage(
              "VOTE_REPLY",
              rpcEvent.from_node,
              target,
              rpcEvent.event_time_ms,
              rpcEvent.rpc_id,
              voteGranted,
            );
            if (Number.isFinite(term) && target.length > 0) {
              upsertVoteLedger(target, term, rpcEvent.from_node, voteGranted);
            }
            return;
          }

          return;
        }

        // Handle state events
        const stateEvent = payload as RaftStateEvent;
        if (!stateEvent.node_id) return;

        if (stateEvent.state === "CANDIDATE") {
          const term = Number(stateEvent.current_term);
          if (Number.isFinite(term)) {
            seedCandidateSelfVote(stateEvent.node_id, term);
          }
        }
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
  }, [enqueueMessage, isDuplicateRPC, seedCandidateSelfVote, upsertVoteLedger]);

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
    setVoteTallies(buildVoteTallies(nodes, voteLedgerRef.current));
  }, [nodes, voteLedgerVersion]);

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
        setVoteTallies({});
        setVoteLedgerVersion(0);
        voteLedgerRef.current.clear();
        seenRpcIDsRef.current.clear();
        fallbackRpcSeenRef.current.clear();
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
      setVoteTallies({});
      setVoteLedgerVersion(0);
      voteLedgerRef.current.clear();
      seenRpcIDsRef.current.clear();
      fallbackRpcSeenRef.current.clear();
      connect();
    },
    messageSpeed,
    setMessageSpeed,
    chaosMode: false,
    setChaosMode: (_: boolean) => {},
  };
}

export type { UINode, ConnectionStatus, RaftStateEvent, NodeState };
