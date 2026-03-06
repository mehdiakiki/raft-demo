import { useState, useEffect, useRef, useCallback } from 'react';
import { RaftStateReconstructor } from '@/lib/stateReconstructor';
import * as api from '@/lib/api';
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
        const payload = JSON.parse(event.data);
        
        // Handle RPC events (heartbeats, votes, etc.)
        if (payload.type === 'rpc' && payload.from_node && payload.to_node) {
          setHeartbeats(prev => [...prev, {
            id: `${payload.from_node}-${payload.to_node}-${payload.event_time_ms}`,
            from: payload.from_node,
            to: payload.to_node,
            progress: 0,
          }]);
          return;
        }
        
        // Handle state events
        const stateEvent = payload as RaftStateEvent;
        if (!stateEvent.node_id) return;

        reconstructorRef.current.applyEvent(stateEvent);
        
        setNodes(reconstructorRef.current.getNodes());
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

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setNodes(prev => {
        const updated = { ...prev };
        for (const id of Object.keys(updated)) {
          const node = updated[id];
          if (node.state !== 'LEADER' && node.state !== 'DEAD') {
            const elapsed = now - node.electionStartedAt;
            updated[id] = {
              ...node,
              electionTimer: Math.min(elapsed, node.electionTimeout),
            };
          } else {
            updated[id] = {
              ...node,
              electionTimer: 0,
            };
          }
        }
        return updated;
      });
    }, 50);
    return () => clearInterval(interval);
  }, []);

  const toggleNodeState = useCallback(async (id: string) => {
    const node = nodes[id];
    if (!node) return;
    
    try {
      if (node.state === 'DEAD') {
        await api.restartNode(id);
      } else {
        await api.killNode(id);
      }
    } catch (err) {
      console.error('toggleNodeState failed', err);
    }
  }, [nodes]);

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
