import { useState, useEffect, useRef, useCallback } from 'react';
import { RaftStateReconstructor } from '@/lib/stateReconstructor';
import type { RaftStateEvent, UINode, NodeState, ConnectionStatus } from '@/lib/types';

const WS_URL = 'ws://localhost:8080/ws';

export type RaftNode = UINode;

export interface HeartbeatMsg {
  id: string;
  from: string;
  to: string;
  progress: number;
}

export type LegacyMessageType = 'REQUEST_VOTE' | 'VOTE_REPLY' | 'APPEND_ENTRIES' | 'APPEND_REPLY';

export interface LegacyMessage {
  id: string;
  from: string;
  to: string;
  progress: number;
  type: LegacyMessageType;
}

export function useRaft() {
  const [nodes, setNodes] = useState<Record<string, RaftNode>>({});
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [isRunning, setIsRunningState] = useState(false);
  const [heartbeats, setHeartbeats] = useState<HeartbeatMsg[]>([]);
  
  const reconstructorRef = useRef(new RaftStateReconstructor());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const shouldReconnectRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    setStatus('connecting');

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close();
        return;
      }
      setStatus('connected');
      setIsRunningState(true);
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      if (!mountedRef.current) return;
      
      try {
        const payload = JSON.parse(event.data) as RaftStateEvent;
        
        if (!payload.node_id) return;

        reconstructorRef.current.applyEvent(payload);
        
        setNodes(reconstructorRef.current.getNodes());

        if (payload.state === 'LEADER') {
          const leaderId = payload.node_id;
          Object.keys(reconstructorRef.current.getNodes()).forEach(nodeId => {
            if (nodeId !== leaderId) {
              setHeartbeats(prev => [...prev, {
                id: `${leaderId}-${nodeId}-${Date.now()}`,
                from: leaderId,
                to: nodeId,
                progress: 0,
              }]);
            }
          });
        }
      } catch {
        // Malformed message — ignore
      }
    };

    ws.onerror = () => {
      // onclose will handle reconnection
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;

      if (!shouldReconnectRef.current) {
        setStatus('disconnected');
        setIsRunningState(false);
        return;
      }

      setStatus('reconnecting');
      reconnectTimerRef.current = setTimeout(connect, 1000);
    };
  }, []);

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
      setHeartbeats(prev => prev.map(h => ({ ...h, progress: h.progress + 0.05 })).filter(h => h.progress < 1));
    }, 50);
    return () => clearInterval(interval);
  }, []);

  const toggleNodeState = useCallback((id: string) => {
    console.log('toggleNodeState not implemented in event-sourcing mode', id);
  }, []);

  const clientRequest = useCallback(async (command: string) => {
    console.log('clientRequest not implemented in event-sourcing mode', command);
    return { success: false, leader_id: '', duplicate: false };
  }, []);

  const setIsRunning = useCallback((running: boolean) => {
    if (running) {
      shouldReconnectRef.current = true;
      connect();
    } else {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      setStatus('disconnected');
      setIsRunningState(false);
    }
  }, [connect]);

  return {
    nodes,
    status,
    messages: [] as LegacyMessage[],
    heartbeats,
    isRunning,
    setIsRunning,
    toggleNodeState,
    clientRequest,
    reset: () => {
      shouldReconnectRef.current = true;
      connect();
    },
    messageSpeed: 0.02,
    setMessageSpeed: (_: number) => {},
    chaosMode: false,
    setChaosMode: (_: boolean) => {},
  };
}

export type { UINode, ConnectionStatus, RaftStateEvent, NodeState };
