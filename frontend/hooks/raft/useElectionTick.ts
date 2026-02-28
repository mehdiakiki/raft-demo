import { useEffect, type MutableRefObject } from 'react';
import { traceAnimation } from '@/lib/animationTrace';
import {
  ELECTION_TICK_MS,
  NODE_TIMER_CHANGE_EPSILON_MS,
  TRACE_TICK_SAMPLE_MS,
} from '@/hooks/raft/constants';
import { staleWindowMs, transportSilenceWindowMs } from '@/hooks/raft/helpers';
import type { RaftNode } from '@/hooks/raft/types';

type NodesByID = Record<string, RaftNode>;
type SetAndTrackNodes = (updater: (prev: NodesByID) => NodesByID) => void;

interface UseElectionTickParams {
  setAndTrackNodes: SetAndTrackNodes;
  lastGatewayFrameAtRef: MutableRefObject<number>;
  candidateHintUntilRef: MutableRefObject<Record<string, number>>;
  lastTickTraceAtRef: MutableRefObject<Record<string, number>>;
}

export function useElectionTick({
  setAndTrackNodes,
  lastGatewayFrameAtRef,
  candidateHintUntilRef,
  lastTickTraceAtRef,
}: UseElectionTickParams): void {
  // Advances election timers and stale flags for non-dead nodes.
  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now();
      setAndTrackNodes(prev => {
        const transportQuiet = now - lastGatewayFrameAtRef.current > transportSilenceWindowMs(prev);
        let changed = false;
        const next = { ...prev };

        for (const id of Object.keys(prev)) {
          const n = prev[id];
          let updated = n;

          if (n.state !== n.actualState && n.candidateHoldUntil > 0 && now >= n.candidateHoldUntil) {
            updated = { ...updated, state: n.actualState, candidateHoldUntil: 0 };
            if ((candidateHintUntilRef.current[id] ?? 0) <= now) {
              delete candidateHintUntilRef.current[id];
            }
          }

          if (updated.actualState !== 'LEADER' && updated.actualState !== 'DEAD') {
            const elapsed = now - n.lastHeartbeat;
            const capped = Math.min(elapsed, n.electionTimeout);
            if (Math.abs(capped - n.electionTimer) > NODE_TIMER_CHANGE_EPSILON_MS) {
              updated = { ...updated, electionTimer: capped };
            }
          }

          const lastTraceAt = lastTickTraceAtRef.current[id] ?? 0;
          if (now - lastTraceAt >= TRACE_TICK_SAMPLE_MS && updated.actualState !== 'DEAD') {
            traceAnimation({
              type: 'election_tick',
              node_id: id,
              visual_state: updated.state,
              actual_state: updated.actualState,
              timer_ms: Math.round(updated.electionTimer),
              timeout_ms: Math.round(updated.electionTimeout),
              progress: updated.electionTimeout > 0
                ? Number((updated.electionTimer / updated.electionTimeout).toFixed(3))
                : 0,
              stale: updated.stale,
            });
            lastTickTraceAtRef.current[id] = now;
          }

          if (!transportQuiet && updated.actualState !== 'DEAD') {
            const shouldBeStale = now - n.lastUpdate > staleWindowMs(n);
            if (shouldBeStale !== n.stale) {
              if (updated === n) updated = { ...updated };
              updated.stale = shouldBeStale;
            }
          } else if (n.stale) {
            if (updated === n) updated = { ...updated };
            updated.stale = false;
          }

          if (updated !== n) {
            next[id] = updated;
            changed = true;
          }
        }

        return changed ? next : prev;
      });
    }, ELECTION_TICK_MS);

    return () => clearInterval(tick);
  }, [candidateHintUntilRef, lastGatewayFrameAtRef, lastTickTraceAtRef, setAndTrackNodes]);
}
