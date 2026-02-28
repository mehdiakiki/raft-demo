import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { traceAnimation } from '@/lib/animationTrace';
import {
  HB_INTERVAL_MS,
  HEARTBEAT_ANIM_TICK_MS,
  HEARTBEAT_EMIT_TICK_MS,
  HEARTBEAT_THROTTLE_FACTOR,
  MIN_SCALED_HEARTBEAT_MS,
  PULSE_SPEED,
} from '@/hooks/raft/constants';
import type { HeartbeatMsg, RaftNode } from '@/hooks/raft/types';

type NodesByID = Record<string, RaftNode>;
type SetAndTrackNodes = (updater: (prev: NodesByID) => NodesByID) => void;

interface UseHeartbeatEffectsParams {
  setAndTrackNodes: SetAndTrackNodes;
  setHeartbeats: Dispatch<SetStateAction<HeartbeatMsg[]>>;
  nodesRef: MutableRefObject<NodesByID>;
  lastHBRef: MutableRefObject<number>;
}

export function useHeartbeatEffects({
  setAndTrackNodes,
  setHeartbeats,
  nodesRef,
  lastHBRef,
}: UseHeartbeatEffectsParams): void {
  // Heartbeat pulse emitter — when a LEADER is present, fire animated pulses.
  useEffect(() => {
    const hbTick = setInterval(() => {
      const current = nodesRef.current;
      const leader = Object.values(current).find(n => n.actualState === 'LEADER' && !n.stale);
      if (!leader) return;

      const now = Date.now();
      const heartbeatInterval = Math.max(MIN_SCALED_HEARTBEAT_MS, leader.heartbeatInterval || HB_INTERVAL_MS);
      if (now - lastHBRef.current < heartbeatInterval * HEARTBEAT_THROTTLE_FACTOR) return;
      lastHBRef.current = now;

      const targets = Object.keys(current).filter(
        id => id !== leader.id && current[id].actualState !== 'DEAD' && !current[id].stale,
      );
      if (targets.length === 0) return;

      traceAnimation({
        type: 'heartbeat_emit',
        leader_id: leader.id,
        targets,
        heartbeat_interval_ms: heartbeatInterval,
      });

      const newMsgs: HeartbeatMsg[] = targets.map(to => ({
        id: `hb-${leader.id}-${to}-${now}`,
        from: leader.id,
        to,
        progress: 0,
      }));

      // Reset election timers at heartbeat send-time. Dot travel is visual only.
      setAndTrackNodes(prev => {
        let changed = false;
        const updated = { ...prev };
        for (const nodeID of targets) {
          const node = updated[nodeID];
          if (!node || node.actualState === 'DEAD' || node.stale) continue;
          updated[nodeID] = { ...node, lastHeartbeat: now, electionTimer: 0 };
          changed = true;
        }
        return changed ? updated : prev;
      });
      traceAnimation({
        type: 'heartbeat_reset',
        leader_id: leader.id,
        targets,
      });

      setHeartbeats(prev => [...prev, ...newMsgs]);
    }, HEARTBEAT_EMIT_TICK_MS);

    return () => clearInterval(hbTick);
  }, [lastHBRef, nodesRef, setAndTrackNodes, setHeartbeats]);

  // Heartbeat animation ticker — moves each pulse along its path.
  useEffect(() => {
    const animTick = setInterval(() => {
      setHeartbeats(prev => {
        if (prev.length === 0) return prev;
        return prev
          .map(m => ({ ...m, progress: m.progress + PULSE_SPEED }))
          .filter(m => m.progress < 1);
      });
    }, HEARTBEAT_ANIM_TICK_MS); // ~60 fps

    return () => clearInterval(animTick);
  }, [setHeartbeats]);
}
