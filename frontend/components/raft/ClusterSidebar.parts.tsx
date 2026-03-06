import type { FormEvent } from 'react';
import { cva } from 'class-variance-authority';
import type { CandidateVoteTally, ConnectionStatus, RaftNode } from '@/hooks/useRaft';
import { cn } from '@/lib/utils';
import { Send } from 'lucide-react';
import { NODE_IDS } from './constants';
import { RAFT_INTERACTIVE_STANDARD, RAFT_STATUS_BADGE, RAFT_STATUS_PANEL, RAFT_SURFACE } from './uiPrimitives';

interface NodeMetricProps {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}

type NodeBadgeTone = 'dead' | 'stale' | 'leader' | 'candidate' | 'follower' | 'missing';
type LogEntryTone = 'committed' | 'noop' | 'default';

interface RoleBadge {
  label: string;
  tone: NodeBadgeTone;
}

interface NodeLogEntryView {
  key: string;
  label: string;
  committed: boolean;
  isNoop: boolean;
}

interface PlaceholderNodeCardProps {
  id: string;
}

interface ClusterNodeCardProps {
  id: string;
  node: RaftNode;
  voteTally?: CandidateVoteTally;
}

export type CommandDispatchState = 'idle' | 'submitting' | 'success' | 'error';

export interface CommandDispatchStatus {
  state: CommandDispatchState;
  message: string;
}

export interface SidebarClientPanelProps {
  commandStatus: CommandDispatchStatus;
  commandInput: string;
  connectionStatus: ConnectionStatus;
  isRunning: boolean;
  nodes: Record<string, RaftNode>;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  setCommandInput: (value: string) => void;
}

export interface ClusterNodeListProps {
  nodes: Record<string, RaftNode>;
  voteTallies: Record<string, CandidateVoteTally>;
}

export interface TimeoutDebugPanelProps {
  nodes: Record<string, RaftNode>;
}

export const SIDEBAR_ROOT_CLASS =
  'w-full lg:w-[420px] bg-[#0A0A0B] border-l border-white/10 p-6 flex flex-col h-screen overflow-hidden relative z-20';
export const CLUSTER_STATE_TITLE_CLASS =
  'text-[10px] font-mono text-slate-400 uppercase tracking-widest mb-3 pb-2 border-b border-white/5';

const CLIENT_SECTION_CLASS = 'mb-6';
const CLIENT_HEADER_CLASS = 'flex items-center justify-between mb-4';
const CLIENT_TITLE_CLASS = 'text-sm font-mono text-slate-400 uppercase tracking-widest';
const CLIENT_LEGEND_CLASS = 'flex items-center gap-2 text-[10px] font-mono text-slate-400';
const CLIENT_STATUS_ROW_CLASS = 'mb-3 flex flex-wrap items-center gap-2';
const CLIENT_FEEDBACK_CLASS = 'mt-2';
const TIMEOUT_DEBUG_SECTION_CLASS = 'mb-6';
const TIMEOUT_DEBUG_TITLE_CLASS = 'text-[10px] font-mono text-slate-400 uppercase tracking-widest mb-2';
const TIMEOUT_DEBUG_SUMMARY_CLASS = cn(
  RAFT_SURFACE({ tone: 'inset', padding: 'compact', radius: 'md' }),
  'mb-2 flex items-center justify-between text-[10px] font-mono text-slate-300',
);
const TIMEOUT_DEBUG_TABLE_WRAPPER_CLASS = cn(
  RAFT_SURFACE({ tone: 'inset', padding: 'compact', radius: 'md' }),
  'overflow-x-auto',
);
const TIMEOUT_DEBUG_TABLE_CLASS = 'min-w-full text-[10px] font-mono text-slate-300';
const TIMEOUT_DEBUG_HEADER_CELL_CLASS = 'pb-1 pr-3 text-slate-500 text-left whitespace-nowrap';
const TIMEOUT_DEBUG_VALUE_CELL_CLASS = 'py-1 pr-3 whitespace-nowrap';
const COMMAND_LABEL_CLASS = 'sr-only';
const COMMAND_INPUT_ID = 'raft-client-command-input';
const COMMAND_STATUS_ID = 'raft-client-command-status';
const COMMAND_FORM_CLASS = 'flex gap-2';
const COMMAND_INPUT_CLASS = cn(
  'flex-1 bg-[#151619] border border-white/10 rounded-lg px-4 py-2.5 text-sm font-mono focus:border-emerald-500/50 placeholder:text-slate-600',
  RAFT_INTERACTIVE_STANDARD(),
);
const COMMAND_SEND_BUTTON_CLASS = cn(
  'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 p-2.5 rounded-lg',
  RAFT_INTERACTIVE_STANDARD({ pressable: true }),
);
const NODE_LIST_CLASS = 'flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar';
const NODE_HEADER_CLASS = 'flex justify-between items-start mb-3';
const NODE_HEADER_PLACEHOLDER_CLASS = 'flex items-center justify-between';
const NODE_ID_GROUP_CLASS = 'flex items-center gap-3';
const NODE_ID_CLASS = 'font-mono font-bold text-lg';
const NODE_ID_PLACEHOLDER_CLASS = 'font-mono font-bold text-lg text-slate-500';
const NODE_PLACEHOLDER_STATUS_CLASS = 'text-[10px] font-mono text-slate-600';
const NODE_METRIC_GRID_CLASS = 'grid grid-cols-2 gap-2 mb-3';
const NODE_METRIC_GRID_PLACEHOLDER_CLASS = 'grid grid-cols-2 gap-2 mt-3';
const NODE_METRIC_LABEL_CLASS = 'text-[9px] font-mono uppercase tracking-wider text-slate-400';
const NODE_VOTE_ROW_CLASS = cn(
  RAFT_SURFACE({ tone: 'inset', padding: 'compact', radius: 'md' }),
  'flex justify-between text-[10px] font-mono mb-2',
);
const NODE_CANDIDATE_TALLY_ROW_CLASS = cn(
  RAFT_SURFACE({ tone: 'inset', padding: 'compact', radius: 'md' }),
  'flex items-center justify-between text-[10px] font-mono mb-2 border-yellow-500/25',
);
const NODE_CANDIDATE_TALLY_VALUE_CLASS = 'text-yellow-300';
const NODE_CANDIDATE_TALLY_STATUS_CLASS = cva(
  'px-2 py-0.5 rounded border text-[9px] uppercase tracking-wider',
  {
    variants: {
      tone: {
        collecting: 'text-yellow-300 border-yellow-500/30 bg-yellow-500/10',
        quorum: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
      },
    },
    defaultVariants: {
      tone: 'collecting',
    },
  },
);
const NODE_VISUAL_HOLD_CLASS = cn(
  RAFT_SURFACE({ tone: 'inset', padding: 'compact', radius: 'md' }),
  'text-[10px] font-mono mb-3 border-amber-500/20 text-amber-300',
);
const NODE_LOG_TITLE_CLASS = 'text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-2';
const NODE_LOG_LIST_CLASS = 'flex flex-wrap gap-1.5';
const NODE_LOG_EMPTY_CLASS = 'text-[10px] text-slate-500 font-mono italic';

const SIDEBAR_NODE_CARD = cva(RAFT_SURFACE({ tone: 'card', padding: 'card', radius: 'lg' }), {
  variants: {
    placeholder: {
      true: 'opacity-70',
      false: 'hover:border-white/10 transition-colors',
    },
  },
  defaultVariants: {
    placeholder: false,
  },
});

const LEGEND_DOT = cva('w-2 h-2 rounded-full', {
  variants: {
    tone: {
      leader: 'bg-emerald-500',
      candidate: 'bg-yellow-500',
    },
  },
});

const NODE_STATUS_DOT = cva('w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]', {
  variants: {
    tone: {
      dead: 'bg-red-500',
      stale: 'bg-amber-400',
      leader: 'bg-emerald-500',
      candidate: 'bg-yellow-500',
      follower: 'bg-slate-500',
      missing: 'bg-slate-600 shadow-none',
    },
  },
  defaultVariants: {
    tone: 'follower',
  },
});

const NODE_STATUS_TEXT = cva('text-[10px] font-mono uppercase tracking-wider', {
  variants: {
    tone: {
      dead: 'text-red-400',
      stale: 'text-amber-300',
      leader: 'text-emerald-400',
      candidate: 'text-yellow-400',
      follower: 'text-slate-300',
      missing: 'text-slate-600',
    },
  },
  defaultVariants: {
    tone: 'follower',
  },
});

const NODE_METRIC_VALUE = cva('text-xs font-mono mt-1', {
  variants: {
    tone: {
      default: 'text-slate-200',
      success: 'text-emerald-300',
      warning: 'text-amber-300',
      danger: 'text-red-300',
    },
  },
  defaultVariants: {
    tone: 'default',
  },
});

const LOG_ENTRY = cva('px-2 py-1 rounded text-[10px] font-mono border', {
  variants: {
    tone: {
      committed: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
      noop: 'bg-slate-500/10 border-slate-500/30 text-slate-300',
      default: 'bg-white/5 border-white/10 text-slate-300',
    },
  },
  defaultVariants: {
    tone: 'default',
  },
});

const VOTED_FOR_VALUE = cva('', {
  variants: {
    hasVote: {
      true: 'text-yellow-400',
      false: 'text-slate-400',
    },
  },
  defaultVariants: {
    hasVote: false,
  },
});

const ROLE_BADGE_BY_STATE: Record<Exclude<RaftNode['actualState'], 'DEAD'>, RoleBadge> = {
  FOLLOWER: { label: 'FOLLOWER', tone: 'follower' },
  CANDIDATE: { label: 'CANDIDATE', tone: 'candidate' },
  LEADER: { label: 'LEADER', tone: 'leader' },
};

type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

interface CommandAvailability {
  canSend: boolean;
  leaderID: string | null;
  reason: string;
}

function nodeCardClass(isPlaceholder = false): string {
  return SIDEBAR_NODE_CARD({ placeholder: isPlaceholder });
}

function logEntryClass(committed: boolean, isNoop: boolean): string {
  const tone: LogEntryTone = committed ? 'committed' : isNoop ? 'noop' : 'default';
  return LOG_ENTRY({ tone });
}

function NodeMetric({ label, value, tone = 'default' }: NodeMetricProps) {
  return (
    <div className={RAFT_SURFACE({ tone: 'inset', padding: 'metric', radius: 'md' })}>
      <div className={NODE_METRIC_LABEL_CLASS}>{label}</div>
      <div className={NODE_METRIC_VALUE({ tone })}>{value}</div>
    </div>
  );
}

function roleBadge(node: RaftNode): RoleBadge {
  if (node.actualState === 'DEAD') {
    return { label: 'DEAD', tone: 'dead' };
  }
  if (node.state === 'DEAD') {
    return { label: 'DEAD', tone: 'dead' };
  }
  if (node.stale) {
    return { label: 'STALE', tone: 'stale' };
  }
  return ROLE_BADGE_BY_STATE[node.state];
}

function compactRole(node: RaftNode): string {
  if (node.actualState === 'DEAD') return 'DEAD';
  if (node.state === 'DEAD') return 'DEAD';
  if (node.stale) return 'STALE';
  return node.state;
}

function heartbeatValue(node: RaftNode): string {
  if (node.actualState === 'DEAD') return '--';
  return `${Math.max(0, Math.round(node.heartbeatInterval))}ms`;
}

function electionValue(node: RaftNode): string {
  if (node.actualState === 'DEAD' || node.actualState === 'LEADER') return '--';
  return `${Math.max(0, Math.round(node.electionTimeout - node.electionTimer))}ms`;
}

function formatMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '--';
  return `${Math.round(value)}ms`;
}

function toLogEntries(node: RaftNode): NodeLogEntryView[] {
  return node.log.map((entry, idx) => {
    const command = entry.command?.trim() ?? '';
    const isNoop = command.length === 0;
    return {
      key: `${idx}-${entry.term}-${command}`,
      label: isNoop ? `NOOP (term ${entry.term})` : command,
      committed: idx < node.commitIndex,
      isNoop,
    };
  });
}

function shouldShowCandidateTally(node: RaftNode): boolean {
  if (node.actualState === 'DEAD' || node.stale) {
    return false;
  }
  return node.actualState === 'CANDIDATE' || node.state === 'CANDIDATE';
}

function resolveCommandAvailability(
  nodes: Record<string, RaftNode>,
  isRunning: boolean,
  connectionStatus: ConnectionStatus,
): CommandAvailability {
  if (connectionStatus === 'connecting') {
    return { canSend: false, leaderID: null, reason: 'Waiting for initial cluster snapshot.' };
  }
  if (connectionStatus === 'reconnecting') {
    return { canSend: false, leaderID: null, reason: 'Gateway reconnecting. Command path is temporarily paused.' };
  }
  if (connectionStatus === 'disconnected') {
    return { canSend: false, leaderID: null, reason: 'Gateway disconnected. Commands are unavailable.' };
  }
  if (!isRunning) {
    return { canSend: false, leaderID: null, reason: 'Frontend stream is disconnected. Connect FE to receive telemetry.' };
  }

  const leaderEntry = Object.entries(nodes).find(([, node]) => node.actualState === 'LEADER' && !node.stale);
  if (!leaderEntry) {
    return { canSend: false, leaderID: null, reason: 'No healthy leader available yet.' };
  }

  const [leaderID] = leaderEntry;
  return { canSend: true, leaderID, reason: `Leader N-${leaderID} is ready for commands.` };
}

function connectionBadge(status: ConnectionStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'connected':
      return { label: 'Gateway Connected', tone: 'success' };
    case 'reconnecting':
      return { label: 'Gateway Reconnecting', tone: 'warning' };
    case 'disconnected':
      return { label: 'Gateway Disconnected', tone: 'danger' };
    case 'connecting':
    default:
      return { label: 'Gateway Connecting', tone: 'info' };
  }
}

function commandBadge(availability: CommandAvailability): { label: string; tone: StatusTone } {
  if (!availability.canSend) {
    return { label: 'Command Path Unavailable', tone: 'warning' };
  }
  return {
    label: availability.leaderID ? `Leader N-${availability.leaderID} Ready` : 'Command Path Ready',
    tone: 'success',
  };
}

function commandPanelTone(state: CommandDispatchState, availability: CommandAvailability): StatusTone {
  if (state === 'submitting') return 'info';
  if (state === 'success') return 'success';
  if (state === 'error') return 'danger';
  return availability.canSend ? 'success' : 'warning';
}

function commandPanelRole(state: CommandDispatchState): 'status' | 'alert' {
  return state === 'error' ? 'alert' : 'status';
}

function PlaceholderNodeCard({ id }: PlaceholderNodeCardProps) {
  return (
    <div className={nodeCardClass(true)}>
      <div className={NODE_HEADER_PLACEHOLDER_CLASS}>
        <div className={NODE_ID_GROUP_CLASS}>
          <div className={NODE_STATUS_DOT({ tone: 'missing' })} />
          <span className={NODE_ID_PLACEHOLDER_CLASS}>N-{id}</span>
        </div>
        <span className={NODE_PLACEHOLDER_STATUS_CLASS}>WAITING FOR STATE</span>
      </div>
      <div className={NODE_METRIC_GRID_PLACEHOLDER_CLASS}>
        <NodeMetric label="Term" value="--" />
        <NodeMetric label="Commit" value="--" />
        <NodeMetric label="Heartbeat" value="--" />
        <NodeMetric label="Election" value="--" />
      </div>
    </div>
  );
}

function ClusterNodeCard({ id, node, voteTally }: ClusterNodeCardProps) {
  const badge = roleBadge(node);
  const displayRole = compactRole(node);
  const votedForLabel = node.votedFor ? `N-${node.votedFor}` : 'None';
  const hasVisualLag = node.state !== node.actualState;
  const logEntries = toLogEntries(node);
  const showCandidateTally = shouldShowCandidateTally(node) && voteTally;

  return (
    <div className={nodeCardClass()}>
      <div className={NODE_HEADER_CLASS}>
        <div className={NODE_ID_GROUP_CLASS}>
          <div className={NODE_STATUS_DOT({ tone: badge.tone })} />
          <span className={NODE_ID_CLASS}>N-{id}</span>
        </div>
        <div className={NODE_STATUS_TEXT({ tone: badge.tone })}>
          {badge.label}
        </div>
      </div>

      <div className={NODE_METRIC_GRID_CLASS}>
        <NodeMetric label="Role" value={displayRole} />
        <NodeMetric label="Term" value={`${node.term}`} />
        <NodeMetric
          label="Commit"
          value={`${node.commitIndex}`}
          tone={node.commitIndex > 0 ? 'success' : 'default'}
        />
        <NodeMetric
          label="Log Entries"
          value={`${node.log.length}`}
        />
        <NodeMetric label="Heartbeat" value={heartbeatValue(node)} />
        <NodeMetric
          label="Election Left"
          value={electionValue(node)}
          tone={node.state === 'CANDIDATE' ? 'warning' : 'default'}
        />
      </div>

      <div className={NODE_VOTE_ROW_CLASS}>
        <span className="text-slate-500">VOTED FOR</span>
        <span className={VOTED_FOR_VALUE({ hasVote: Boolean(node.votedFor) })}>{votedForLabel}</span>
      </div>
      {showCandidateTally && (
        <div className={NODE_CANDIDATE_TALLY_ROW_CLASS}>
          <span className="text-slate-400">VOTES (T{voteTally.term})</span>
          <div className="flex items-center gap-2">
            <span className={NODE_CANDIDATE_TALLY_VALUE_CLASS}>
              {voteTally.granted}/{voteTally.quorum} (-{voteTally.rejected})
            </span>
            <span className={NODE_CANDIDATE_TALLY_STATUS_CLASS({ tone: voteTally.status })}>
              {voteTally.status}
            </span>
          </div>
        </div>
      )}
      {hasVisualLag && (
        <div className={NODE_VISUAL_HOLD_CLASS}>
          VISUAL HOLD: showing {node.state}, actual {node.actualState}
        </div>
      )}

      <div className={NODE_LOG_TITLE_CLASS}>Log Timeline</div>
      <div className={NODE_LOG_LIST_CLASS}>
        {logEntries.length === 0 ? (
          <span className={NODE_LOG_EMPTY_CLASS}>No entries yet</span>
        ) : (
          logEntries.map((entry, idx) => (
            <div
              key={entry.key}
              className={logEntryClass(entry.committed, entry.isNoop)}
              title={`Index: ${idx + 1}`}
            >
              #{idx + 1} {entry.label}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function SidebarClientPanel({
  commandStatus,
  commandInput,
  connectionStatus,
  isRunning,
  nodes,
  onSubmit,
  setCommandInput,
}: SidebarClientPanelProps) {
  const availability = resolveCommandAvailability(nodes, isRunning, connectionStatus);
  const canSendCommand = availability.canSend && commandStatus.state !== 'submitting';
  const connectionPill = connectionBadge(connectionStatus);
  const commandPill = commandBadge(availability);
  const feedbackMessage = commandStatus.state === 'idle' ? availability.reason : commandStatus.message;
  const feedbackTone = commandPanelTone(commandStatus.state, availability);
  const feedbackRole = commandPanelRole(commandStatus.state);

  return (
    <div className={CLIENT_SECTION_CLASS}>
      <div className={CLIENT_HEADER_CLASS}>
        <h2 className={CLIENT_TITLE_CLASS}>Client Interface</h2>
        <div className={CLIENT_LEGEND_CLASS}>
          <span className={LEGEND_DOT({ tone: 'leader' })} aria-hidden="true"></span> LEADER
          <span className={cn(LEGEND_DOT({ tone: 'candidate' }), 'ml-2')} aria-hidden="true"></span> CANDIDATE
        </div>
      </div>
      <div className={CLIENT_STATUS_ROW_CLASS}>
        <span className={RAFT_STATUS_BADGE({ tone: connectionPill.tone })}>
          {connectionPill.label}
        </span>
        <span className={RAFT_STATUS_BADGE({ tone: commandPill.tone })}>
          {commandPill.label}
        </span>
      </div>
      <form onSubmit={onSubmit} className={COMMAND_FORM_CLASS} aria-busy={commandStatus.state === 'submitting'}>
        <label htmlFor={COMMAND_INPUT_ID} className={COMMAND_LABEL_CLASS}>
          Client command
        </label>
        <input
          id={COMMAND_INPUT_ID}
          type="text"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          placeholder="COMMAND (e.g. SET x=5)"
          className={COMMAND_INPUT_CLASS}
          aria-describedby={COMMAND_STATUS_ID}
          disabled={commandStatus.state === 'submitting'}
        />
        <button
          type="submit"
          disabled={!canSendCommand}
          className={COMMAND_SEND_BUTTON_CLASS}
          aria-label="Send command to cluster leader"
        >
          <Send size={18} />
        </button>
      </form>
      <div className={CLIENT_FEEDBACK_CLASS}>
        <p
          id={COMMAND_STATUS_ID}
          className={RAFT_STATUS_PANEL({ tone: feedbackTone })}
          role={feedbackRole}
          aria-live={commandStatus.state === 'error' ? 'assertive' : 'polite'}
        >
          {feedbackMessage}
        </p>
      </div>
    </div>
  );
}

export function TimeoutDebugPanel({ nodes }: TimeoutDebugPanelProps) {
  const now = Date.now();
  const rows = NODE_IDS.map((id) => {
    const node = nodes[id];
    if (!node) {
      return {
        id,
        visualRole: '--',
        actualRole: '--',
        backendHeartbeat: '--',
        backendElection: '--',
        elapsed: '--',
        remaining: '--',
        progress: '--',
        holdLeft: '--',
      };
    }

    const isTimerRole = node.actualState === 'FOLLOWER' || node.actualState === 'CANDIDATE';
    const elapsedMs = isTimerRole ? Math.max(0, now - node.electionStartedAt) : 0;
    const remainingMs = isTimerRole ? Math.max(0, node.electionTimeout - node.electionTimer) : 0;
    const holdLeftMs = Math.max(0, node.candidateHoldUntil - now);
    const progressPct = isTimerRole && node.electionTimeout > 0
      ? `${Math.round((node.electionTimer / node.electionTimeout) * 100)}%`
      : '--';

    return {
      id,
      visualRole: node.state,
      actualRole: node.actualState,
      backendHeartbeat: formatMs(node.backendHeartbeatIntervalMs),
      backendElection: formatMs(node.backendElectionTimeoutMs),
      elapsed: isTimerRole ? formatMs(elapsedMs) : '--',
      remaining: isTimerRole ? formatMs(remainingMs) : '--',
      progress: progressPct,
      holdLeft: holdLeftMs > 0 ? formatMs(holdLeftMs) : '--',
    };
  });

  const backendTimeouts = Object.values(nodes)
    .map((node) => node.backendElectionTimeoutMs)
    .filter((value) => Number.isFinite(value) && value > 0);
  const spreadMs = backendTimeouts.length > 1
    ? Math.max(...backendTimeouts) - Math.min(...backendTimeouts)
    : 0;

  return (
    <div className={TIMEOUT_DEBUG_SECTION_CLASS}>
      <div className={TIMEOUT_DEBUG_TITLE_CLASS}>Timeout Debug</div>
      <div className={TIMEOUT_DEBUG_SUMMARY_CLASS}>
        <span>Backend election spread</span>
        <span>{formatMs(spreadMs)}</span>
      </div>
      <div className={TIMEOUT_DEBUG_TABLE_WRAPPER_CLASS}>
        <table className={TIMEOUT_DEBUG_TABLE_CLASS}>
          <thead>
            <tr>
              <th className={TIMEOUT_DEBUG_HEADER_CELL_CLASS}>Node</th>
              <th className={TIMEOUT_DEBUG_HEADER_CELL_CLASS}>Visual</th>
              <th className={TIMEOUT_DEBUG_HEADER_CELL_CLASS}>Actual</th>
              <th className={TIMEOUT_DEBUG_HEADER_CELL_CLASS}>HB</th>
              <th className={TIMEOUT_DEBUG_HEADER_CELL_CLASS}>Election</th>
              <th className={TIMEOUT_DEBUG_HEADER_CELL_CLASS}>Elapsed</th>
              <th className={TIMEOUT_DEBUG_HEADER_CELL_CLASS}>Left</th>
              <th className={TIMEOUT_DEBUG_HEADER_CELL_CLASS}>Progress</th>
              <th className={TIMEOUT_DEBUG_HEADER_CELL_CLASS}>Hold Left</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className={TIMEOUT_DEBUG_VALUE_CELL_CLASS}>N-{row.id}</td>
                <td className={TIMEOUT_DEBUG_VALUE_CELL_CLASS}>{row.visualRole}</td>
                <td className={TIMEOUT_DEBUG_VALUE_CELL_CLASS}>{row.actualRole}</td>
                <td className={TIMEOUT_DEBUG_VALUE_CELL_CLASS}>{row.backendHeartbeat}</td>
                <td className={TIMEOUT_DEBUG_VALUE_CELL_CLASS}>{row.backendElection}</td>
                <td className={TIMEOUT_DEBUG_VALUE_CELL_CLASS}>{row.elapsed}</td>
                <td className={TIMEOUT_DEBUG_VALUE_CELL_CLASS}>{row.remaining}</td>
                <td className={TIMEOUT_DEBUG_VALUE_CELL_CLASS}>{row.progress}</td>
                <td className={TIMEOUT_DEBUG_VALUE_CELL_CLASS}>{row.holdLeft}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ClusterNodeList({ nodes, voteTallies }: ClusterNodeListProps) {
  return (
    <div className={NODE_LIST_CLASS}>
      {NODE_IDS.map((id) => {
        const node = nodes[id];
        if (!node) {
          return <PlaceholderNodeCard key={id} id={id} />;
        }
        return <ClusterNodeCard key={id} id={id} node={node} voteTally={voteTallies[id]} />;
      })}
    </div>
  );
}
