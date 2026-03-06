import type { HeartbeatMsg, LegacyMessage, RaftNode } from '@/hooks/useRaft';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Power, Server, ShieldAlert } from 'lucide-react';
import {
  ELECTION_RING_CENTER,
  ELECTION_RING_CIRCUMFERENCE,
  ELECTION_RING_RADIUS,
  ELECTION_RING_STROKE_WIDTH,
  MSG_COLORS,
  NODE_IDS,
  type NodePositions,
  STATE_COLORS,
} from './constants';
import {
  CANVAS_GRID_CLASS,
  CANVAS_ROOT_CLASS,
  ClusterCanvasHeader,
  ClusterControls,
  ClusterStage,
} from './ClusterCanvas.parts';
import { RAFT_INTERACTIVE_STANDARD } from './uiPrimitives';

interface ClusterCanvasProps {
  nodes: Record<string, RaftNode>;
  heartbeats: HeartbeatMsg[];
  messages: LegacyMessage[];
  nodePositions: NodePositions;
  isRunning: boolean;
  setIsRunning: (running: boolean) => void;
  toggleNodeState: (id: string) => void;
  reset: () => void;
  messageSpeed: number;
  setMessageSpeed: (speed: number) => void;
  chaosMode: boolean;
  setChaosMode: (enabled: boolean) => void;
}

type NodeIconTone = 'dead' | 'stale' | 'default';
type NodeBadgeTone = 'leader' | 'term' | 'visualLag';

const NODE_POWER_ANCHOR_CLASS = 'absolute -top-2 -right-2 z-20';
const ELECTION_RING_CLASS = 'absolute -inset-3 w-[120px] h-[120px] -rotate-90 pointer-events-none';
const ELECTION_RING_PROGRESS_CLASS =
  'motion-safe:transition-[stroke-dashoffset] motion-safe:duration-75 motion-safe:ease-linear motion-reduce:transition-none';

const NODE_CARD = cva(
  cn(
    RAFT_INTERACTIVE_STANDARD({ pressable: true }),
    'absolute w-24 h-24 -ml-12 -mt-12 rounded-xl border flex flex-col items-center justify-center cursor-pointer transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-500 ease-out shadow-2xl backdrop-blur-md hover:scale-105',
  ),
  {
    variants: {
      stale: {
        true: 'bg-[#231f16] border-[#7c6226] text-amber-300',
        false: '',
      },
    },
    defaultVariants: {
      stale: false,
    },
  },
);

const NODE_TRANSITION_PULSE_CLASS =
  'motion-safe:animate-pulse motion-reduce:animate-none shadow-[0_0_28px_rgba(234,179,8,0.35)]';

const NODE_POWER_BUTTON = cva(
  cn(
    RAFT_INTERACTIVE_STANDARD({ pressable: true }),
    'bg-[#151619] border border-white/10 rounded-full p-1.5 hover:bg-white/10 hover:scale-110',
  ),
  {
    variants: {
      dead: {
        true: 'shadow-[0_0_15px_rgba(239,68,68,0.3)]',
        false: '',
      },
    },
    defaultVariants: {
      dead: false,
    },
  },
);

const NODE_POWER_ICON = cva('', {
  variants: {
    dead: {
      true: 'text-red-500',
      false: 'text-emerald-500',
    },
  },
  defaultVariants: {
    dead: false,
  },
});

const NODE_ROLE_ICON = cva('mb-1.5', {
  variants: {
    tone: {
      dead: 'text-red-500 opacity-50',
      stale: 'text-amber-400 opacity-80',
      default: 'opacity-80',
    },
  },
  defaultVariants: {
    tone: 'default',
  },
});

const NODE_STATE_BADGE = cva('absolute font-mono bg-[#0A0A0B] rounded border', {
  variants: {
    tone: {
      leader: '-bottom-6 text-[10px] text-emerald-400 px-2 py-0.5 border-emerald-500/30 flex items-center gap-1',
      term: '-bottom-6 text-[10px] text-slate-400 px-2 py-0.5 border-white/10',
      visualLag: '-top-6 text-[8px] text-amber-300 px-1.5 py-0.5 border-amber-500/20',
    },
  },
  defaultVariants: {
    tone: 'term',
  },
});

const PACKET_DOT = cva('absolute w-2 h-2 rounded-full -ml-1 -mt-1', {
  variants: {
    kind: {
      heartbeat: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
      message: '',
    },
  },
  defaultVariants: {
    kind: 'message',
  },
});

const NODE_LEADER_HEARTBEAT_DOT_CLASS =
  'inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse motion-reduce:animate-none';
const NODE_LABEL_CLASS = 'font-mono font-bold text-lg leading-none mb-1';
const NODE_STATE_LABEL_CLASS = 'text-[9px] uppercase tracking-widest opacity-80 font-mono';
const VOTE_REPLY_DENIED_PACKET_CLASS = 'bg-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.55)]';

function nodeCardClass(isStale: boolean, renderState: RaftNode['actualState']): string {
  return cn(NODE_CARD({ stale: isStale }), !isStale && STATE_COLORS[renderState]);
}

function nodePowerButtonClass(isDead: boolean): string {
  return NODE_POWER_BUTTON({ dead: isDead });
}

function rpcMessageClass(message: LegacyMessage): string {
  if (message.type === 'VOTE_REPLY' && message.voteGranted === false) {
    return cn(PACKET_DOT(), VOTE_REPLY_DENIED_PACKET_CLASS);
  }
  return cn(PACKET_DOT(), MSG_COLORS[message.type]);
}

function nodeRoleIconClass(tone: NodeIconTone): string {
  return NODE_ROLE_ICON({ tone });
}

function nodeStateBadgeClass(tone: NodeBadgeTone): string {
  return NODE_STATE_BADGE({ tone });
}

function electionRingProgress(node: RaftNode): number {
  if (node.electionTimeout <= 0) {
    return 0;
  }
  const ratio = node.electionTimer / node.electionTimeout;
  return Math.min(1, Math.max(0, ratio));
}

export function ClusterCanvas({
  nodes,
  heartbeats,
  messages,
  nodePositions,
  isRunning,
  setIsRunning,
  toggleNodeState,
  reset,
  messageSpeed,
  setMessageSpeed,
  chaosMode,
  setChaosMode,
}: ClusterCanvasProps) {
  return (
    <div className={CANVAS_ROOT_CLASS}>
      <div className={CANVAS_GRID_CLASS}></div>
      <ClusterCanvasHeader />

      <ClusterStage nodePositions={nodePositions}>
        {heartbeats.map((msg: HeartbeatMsg) => {
          const fromPos = nodePositions[msg.from];
          const toPos = nodePositions[msg.to];
          if (!fromPos || !toPos) return null;
          const x = fromPos.x + (toPos.x - fromPos.x) * msg.progress;
          const y = fromPos.y + (toPos.y - fromPos.y) * msg.progress;
          const opacity = Math.sin(msg.progress * Math.PI);
          return (
            <div
              key={msg.id}
              className={PACKET_DOT({ kind: 'heartbeat' })}
              style={{ left: x, top: y, opacity }}
              title="heartbeat"
              aria-hidden="true"
            />
          );
        })}

        {messages.map((msg) => {
          const fromPos = nodePositions[msg.from];
          const toPos = nodePositions[msg.to];
          if (!fromPos || !toPos) return null;
          const x = fromPos.x + (toPos.x - fromPos.x) * msg.progress;
          const y = fromPos.y + (toPos.y - fromPos.y) * msg.progress;
          const opacity = Math.sin(msg.progress * Math.PI);

          return (
            <div
              key={msg.id}
              className={rpcMessageClass(msg)}
              style={{ left: x, top: y, opacity }}
              title={msg.type}
              aria-hidden="true"
            />
          );
        })}

        {NODE_IDS.map((id) => {
          const node = nodes[id];
          const pos = nodePositions[id];
          if (!node) return null;
          const visualState = node.state;
          const actualState = node.actualState;
          const isDead = actualState === 'DEAD';
          const isStale = node.stale && !isDead;
          const renderState = visualState;
          const hasVisualLag = visualState !== actualState;

          return (
            <div
              key={id}
              className={cn(
                nodeCardClass(isStale, renderState),
                !isStale && renderState === 'CANDIDATE' && NODE_TRANSITION_PULSE_CLASS,
              )}
              style={{ left: pos.x, top: pos.y }}
              onClick={() => toggleNodeState(id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleNodeState(id);
                }
              }}
              role="button"
              tabIndex={0}
              aria-pressed={!isDead}
              aria-label={`${isDead ? 'Restart' : 'Stop'} node ${id}. Current role ${isStale ? `${renderState} stale` : renderState}.`}
            >
              <div className={NODE_POWER_ANCHOR_CLASS}>
                <button
                  type="button"
                  className={nodePowerButtonClass(isDead)}
                  title={isDead ? 'Restart Node' : 'Kill Node'}
                  aria-label={isDead ? `Restart node ${id}` : `Kill node ${id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleNodeState(id);
                  }}
                >
                  <Power size={12} className={NODE_POWER_ICON({ dead: isDead })} />
                </button>
              </div>
              {isDead ? (
                <ShieldAlert size={24} className={nodeRoleIconClass('dead')} />
              ) : isStale ? (
                <ShieldAlert size={24} className={nodeRoleIconClass('stale')} />
              ) : (
                <Server size={24} className={nodeRoleIconClass('default')} />
              )}
              <div className={NODE_LABEL_CLASS}>{id}</div>
              <div className={NODE_STATE_LABEL_CLASS}>
                {isStale ? `${renderState} / STALE` : renderState}
              </div>
              {!isDead && !isStale && renderState === 'LEADER' && (
                <div className={nodeStateBadgeClass('leader')}>
                  <span className={NODE_LEADER_HEARTBEAT_DOT_CLASS}></span>
                  HB
                </div>
              )}
              {!isDead && renderState !== 'LEADER' && (
                <div className={nodeStateBadgeClass('term')}>
                  T:{node.term}
                </div>
              )}
              {hasVisualLag && !isStale && (
                <div className={nodeStateBadgeClass('visualLag')}>
                  ACT:{actualState}
                </div>
              )}

              {!isDead && renderState !== 'LEADER' && (
                <svg className={ELECTION_RING_CLASS} aria-hidden="true">
                  <circle
                    cx={ELECTION_RING_CENTER}
                    cy={ELECTION_RING_CENTER}
                    r={ELECTION_RING_RADIUS}
                    fill="none"
                    stroke="rgba(255,255,255,0.05)"
                    strokeWidth={ELECTION_RING_STROKE_WIDTH}
                  />
                  <circle
                    cx={ELECTION_RING_CENTER}
                    cy={ELECTION_RING_CENTER}
                    r={ELECTION_RING_RADIUS}
                    fill="none"
                    stroke={renderState === 'CANDIDATE' ? '#eab308' : '#10b981'}
                    strokeWidth={ELECTION_RING_STROKE_WIDTH}
                    strokeDasharray={ELECTION_RING_CIRCUMFERENCE}
                    strokeDashoffset={ELECTION_RING_CIRCUMFERENCE * (1 - electionRingProgress(node))}
                    className={ELECTION_RING_PROGRESS_CLASS}
                  />
                </svg>
              )}
            </div>
          );
        })}
      </ClusterStage>

      <ClusterControls
        chaosMode={chaosMode}
        isRunning={isRunning}
        messageSpeed={messageSpeed}
        reset={reset}
        setChaosMode={setChaosMode}
        setIsRunning={setIsRunning}
        setMessageSpeed={setMessageSpeed}
      />
    </div>
  );
}
