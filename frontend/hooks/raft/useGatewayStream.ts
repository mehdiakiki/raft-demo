import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { gatewayWSURL } from '@/lib/config';
import { traceAnimation } from '@/lib/animationTrace';
import {
  CANDIDATE_MIN_VISIBLE_MS,
  NODE_MAPPING_TRACE_THRESHOLD_MS,
  TRANSITION_REPLAY_WINDOW_MS,
} from '@/hooks/raft/constants';
import { exponentialBackoff, isNodeStateReply, isStateTransitionEvent, mapReplyToNode } from '@/hooks/raft/helpers';
import type { ConnectionStatus, RaftNode } from '@/hooks/raft/types';
import type { StateTransitionEvent } from '@/lib/types';

type NodesByID = Record<string, RaftNode>;
type SetAndTrackNodes = (updater: (prev: NodesByID) => NodesByID) => void;

interface UseGatewayStreamParams {
  setAndTrackNodes: SetAndTrackNodes;
  setStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  setIsRunningState: Dispatch<SetStateAction<boolean>>;
  wsRef: MutableRefObject<WebSocket | null>;
  reconnectTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  attemptRef: MutableRefObject<number>;
  mountedRef: MutableRefObject<boolean>;
  shouldReconnectRef: MutableRefObject<boolean>;
  lastGatewayFrameAtRef: MutableRefObject<number>;
  candidateHintUntilRef: MutableRefObject<Record<string, number>>;
}

interface UseGatewayStreamResult {
  connect: () => void;
}

export function useGatewayStream({
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
}: UseGatewayStreamParams): UseGatewayStreamResult {
  const applyCandidateHint = useCallback((transition: StateTransitionEvent) => {
    if (transition.to !== 'CANDIDATE') return;

    const now = Date.now();
    const eventAt = transition.at_unix_ms ?? now;
    if (now - eventAt > TRANSITION_REPLAY_WINDOW_MS) return;

    const holdUntil = Math.max(now, eventAt) + CANDIDATE_MIN_VISIBLE_MS;

    setAndTrackNodes(prev => {
      const existing = prev[transition.node_id];
      if (!existing || existing.actualState === 'DEAD') return prev;

      const current = candidateHintUntilRef.current[transition.node_id] ?? 0;
      if (holdUntil <= current) return prev;
      candidateHintUntilRef.current[transition.node_id] = holdUntil;

      const candidateTimer = Math.min(existing.electionTimeout, Math.max(0, existing.electionTimer));
      const updatedNode: RaftNode = {
        ...existing,
        state: 'CANDIDATE',
        candidateHoldUntil: holdUntil,
      };
      traceAnimation({
        type: 'candidate_hint_applied',
        node_id: transition.node_id,
        inferred: Boolean(transition.inferred),
        timer_before_ms: Math.round(existing.electionTimer),
        timer_after_ms: Math.round(candidateTimer),
        timeout_ms: Math.round(existing.electionTimeout),
        hold_until_ms: holdUntil,
        event_at_ms: eventAt,
      });
      return { ...prev, [transition.node_id]: updatedNode };
    });
  }, [candidateHintUntilRef, setAndTrackNodes]);

  // connect opens (or re-opens) the WebSocket.
  const connect = useCallback(function connectSocket() {
    if (!mountedRef.current) return;

    setStatus(attemptRef.current === 0 ? 'connecting' : 'reconnecting');

    const ws = new WebSocket(gatewayWSURL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close();
        return;
      }
      attemptRef.current = 0;
      lastGatewayFrameAtRef.current = Date.now();
      setStatus('connected');
      setIsRunningState(true);
    };

    // Gateway messages are either NodeStateReply snapshots or transition events.
    ws.onmessage = (event: MessageEvent<string>) => {
      if (!mountedRef.current) return;
      try {
        lastGatewayFrameAtRef.current = Date.now();
        const payload = JSON.parse(event.data) as unknown;

        if (isStateTransitionEvent(payload)) {
          traceAnimation({
            type: 'ws_transition',
            node_id: payload.node_id,
            from: payload.from,
            to: payload.to,
            inferred: Boolean(payload.inferred),
            term: payload.term,
            event_at_ms: payload.at_unix_ms,
          });
          applyCandidateHint(payload);
          return;
        }

        if (!isNodeStateReply(payload)) {
          return;
        }

        const reply = payload;
        traceAnimation({
          type: 'ws_state',
          node_id: reply.node_id,
          state: reply.state,
          term: reply.current_term ?? 0,
          commit_index: reply.commit_index ?? 0,
          heartbeat_interval_ms: reply.heartbeat_interval_ms ?? 0,
          election_timeout_ms: reply.election_timeout_ms ?? 0,
        });

        setAndTrackNodes(prev => {
          const now = Date.now();
          const candidateHintUntil = candidateHintUntilRef.current[reply.node_id] ?? 0;
          const previous = prev[reply.node_id];
          const nextNode = mapReplyToNode(reply, previous, candidateHintUntil, now);
          if (!previous ||
            previous.state !== nextNode.state ||
            previous.actualState !== nextNode.actualState ||
            Math.abs(previous.electionTimer - nextNode.electionTimer) > NODE_MAPPING_TRACE_THRESHOLD_MS) {
            traceAnimation({
              type: 'mapped_node',
              node_id: reply.node_id,
              visual_state: nextNode.state,
              actual_state: nextNode.actualState,
              term: nextNode.term,
              timer_ms: Math.round(nextNode.electionTimer),
              timeout_ms: Math.round(nextNode.electionTimeout),
            });
          }
          const updated = {
            ...prev,
            [reply.node_id]: nextNode,
          };
          if (candidateHintUntil > 0 && candidateHintUntil <= now) {
            delete candidateHintUntilRef.current[reply.node_id];
          }
          return updated;
        });
      } catch {
        // Malformed message — ignore and keep the existing state.
      }
    };

    ws.onerror = () => {
      // onclose always fires after onerror, so reconnect is handled there.
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;

      if (!shouldReconnectRef.current) {
        setStatus('disconnected');
        setIsRunningState(false);
        return;
      }

      setStatus('reconnecting');
      setIsRunningState(false);
      const delay = exponentialBackoff(attemptRef.current++);
      reconnectTimerRef.current = setTimeout(connectSocket, delay);
    };
  }, [
    applyCandidateHint,
    attemptRef,
    lastGatewayFrameAtRef,
    mountedRef,
    reconnectTimerRef,
    setAndTrackNodes,
    setIsRunningState,
    setStatus,
    shouldReconnectRef,
    wsRef,
    candidateHintUntilRef,
  ]);

  // Mount: open the WebSocket; unmount: close it cleanly.
  useEffect(() => {
    mountedRef.current = true;
    shouldReconnectRef.current = true;
    lastGatewayFrameAtRef.current = Date.now();
    connect();
    return () => {
      mountedRef.current = false;
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect, lastGatewayFrameAtRef, mountedRef, reconnectTimerRef, shouldReconnectRef, wsRef]);

  return { connect };
}
