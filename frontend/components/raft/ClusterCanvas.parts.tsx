import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Activity, Database, Flame, Gauge, Pause, Play, RotateCcw } from 'lucide-react';
import {
  CENTER,
  NETWORK_LATENCY_INVERT_BASE,
  NETWORK_LATENCY_PERCENT_SCALE,
  NETWORK_LATENCY_SLIDER_MAX,
  NETWORK_LATENCY_SLIDER_MIN,
  NETWORK_LATENCY_SLIDER_STEP,
  NODE_IDS,
  RADIAL_GUIDE_DASHARRAY,
  RADIAL_GUIDE_STROKE_WIDTH,
  type NodePositions,
} from './constants';
import { RAFT_CONTROL_BUTTON, RAFT_INTERACTIVE_STANDARD, RAFT_SURFACE } from './uiPrimitives';

export interface ClusterStageProps {
  nodePositions: NodePositions;
  children: ReactNode;
}

export interface ClusterControlsProps {
  chaosMode: boolean;
  isRunning: boolean;
  messageSpeed: number;
  reset: () => void;
  setChaosMode: (enabled: boolean) => void;
  setIsRunning: (running: boolean) => void;
  setMessageSpeed: (speed: number) => void;
}

type ControlButtonVariant = 'running' | 'paused' | 'chaosOn' | 'chaosOff' | 'neutral';

export const CANVAS_ROOT_CLASS = 'flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden';
export const CANVAS_GRID_CLASS =
  'absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]';

const CANVAS_HEADER_CLASS = 'absolute top-8 left-8 z-10';
const CANVAS_HEADER_ROW_CLASS = 'flex items-center gap-3 mb-2';
const CANVAS_PING_WRAPPER_CLASS = 'relative flex h-3 w-3';
const CANVAS_PING_PULSE_CLASS =
  'motion-safe:animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75';
const CANVAS_PING_DOT_CLASS = 'relative inline-flex rounded-full h-3 w-3 bg-emerald-500';
const CANVAS_TITLE_CLASS = 'text-2xl font-bold tracking-tight text-white font-mono uppercase flex items-center gap-2';
const CANVAS_SUBTITLE_CLASS = 'text-sm text-slate-400 font-mono flex items-center gap-2';
const CLUSTER_STAGE_CLASS = 'relative w-[600px] h-[600px] rounded-full border border-white/5 shadow-2xl bg-[#0A0A0B]/80 backdrop-blur-sm z-10';
const CLUSTER_STAGE_CORE_CLASS =
  'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full border border-white/10 flex items-center justify-center';
const CLUSTER_STAGE_CORE_INNER_CLASS = 'w-16 h-16 rounded-full border border-white/5 bg-white/5';
const CLUSTER_STAGE_GUIDE_CLASS = 'absolute inset-0 w-full h-full pointer-events-none opacity-20';
const CONTROLS_DOCK_CLASS = 'absolute bottom-8 z-10 flex flex-col items-center gap-4';
const LATENCY_LABEL_CLASS = 'text-[10px] font-mono text-slate-400 w-24';
const LATENCY_SLIDER_CLASS = cn(
  'flex-1 accent-emerald-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer',
  RAFT_INTERACTIVE_STANDARD(),
);
const LATENCY_PERCENT_CLASS = 'text-[10px] font-mono text-slate-400 w-8 text-right';
const CONTROL_PANEL_DIVIDER_CLASS = 'w-px h-8 bg-white/10';
const NETWORK_LATENCY_SLIDER_ID = 'network-latency-slider';
const LATENCY_PANEL_CLASS = cn(
  RAFT_SURFACE({ tone: 'elevated', blur: 'soft', shadow: 'deep', layout: 'row', gap: 'lg', padding: 'cozy', radius: 'xl' }),
  'w-full max-w-md',
);
const CONTROLS_PANEL_CLASS = RAFT_SURFACE({
  tone: 'elevated',
  blur: 'soft',
  shadow: 'deep',
  layout: 'row',
  gap: 'md',
  padding: 'compact',
  radius: 'xxl',
});
const REPLAY_MODE_HINT_CLASS =
  'text-[10px] font-mono uppercase tracking-widest text-slate-500';

function controlButtonClass(variant: ControlButtonVariant): string {
  return RAFT_CONTROL_BUTTON({ tone: variant });
}

export function ClusterCanvasHeader() {
  return (
    <div className={CANVAS_HEADER_CLASS}>
      <div className={CANVAS_HEADER_ROW_CLASS}>
        <div className={CANVAS_PING_WRAPPER_CLASS}>
          <span className={CANVAS_PING_PULSE_CLASS}></span>
          <span className={CANVAS_PING_DOT_CLASS}></span>
        </div>
        <h1 className={CANVAS_TITLE_CLASS}>
          <Activity className="text-emerald-500" size={24} />
          Raft_Consensus
        </h1>
      </div>
      <p className={CANVAS_SUBTITLE_CLASS}>
        <Database size={14} />
        v1.0.0 // Interactive Visualization
      </p>
    </div>
  );
}

export function ClusterStage({ nodePositions, children }: ClusterStageProps) {
  return (
    <div className={CLUSTER_STAGE_CLASS}>
      <div className={CLUSTER_STAGE_CORE_CLASS}>
        <div className={CLUSTER_STAGE_CORE_INNER_CLASS}></div>
      </div>

      <svg className={CLUSTER_STAGE_GUIDE_CLASS}>
        {NODE_IDS.map((id) => {
          const pos = nodePositions[id];
          return (
            <line
              key={`line-${id}`}
              x1={CENTER}
              y1={CENTER}
              x2={pos.x}
              y2={pos.y}
              stroke="currentColor"
              strokeWidth={RADIAL_GUIDE_STROKE_WIDTH}
              strokeDasharray={RADIAL_GUIDE_DASHARRAY}
            />
          );
        })}
      </svg>

      {children}
    </div>
  );
}

export function ClusterControls({
  chaosMode,
  isRunning,
  messageSpeed,
  reset,
  setChaosMode,
  setIsRunning,
  setMessageSpeed,
}: ClusterControlsProps) {
  const chaosControlEnabled = false;
  const latencyPercent = Math.round(
    ((NETWORK_LATENCY_INVERT_BASE - messageSpeed) / NETWORK_LATENCY_SLIDER_MAX) * NETWORK_LATENCY_PERCENT_SCALE,
  );

  return (
    <div className={CONTROLS_DOCK_CLASS}>
      <div className={LATENCY_PANEL_CLASS}>
        <Gauge size={16} className="text-slate-400" />
        <label htmlFor={NETWORK_LATENCY_SLIDER_ID} className={LATENCY_LABEL_CLASS}>
          ANIMATION SPEED
        </label>
        <input
          id={NETWORK_LATENCY_SLIDER_ID}
          type="range"
          min={NETWORK_LATENCY_SLIDER_MIN}
          max={NETWORK_LATENCY_SLIDER_MAX}
          step={NETWORK_LATENCY_SLIDER_STEP}
          value={NETWORK_LATENCY_INVERT_BASE - messageSpeed}
          onChange={(e) => setMessageSpeed(NETWORK_LATENCY_INVERT_BASE - parseFloat(e.target.value))}
          className={LATENCY_SLIDER_CLASS}
          aria-valuemin={NETWORK_LATENCY_SLIDER_MIN}
          aria-valuemax={NETWORK_LATENCY_SLIDER_MAX}
          aria-valuenow={NETWORK_LATENCY_INVERT_BASE - messageSpeed}
          aria-valuetext={`${latencyPercent}%`}
        />
        <span className={LATENCY_PERCENT_CLASS}>
          {latencyPercent}%
        </span>
      </div>
      {!chaosControlEnabled && (
        <div className={REPLAY_MODE_HINT_CLASS}>
          Chaos mode is unavailable in replay mode.
        </div>
      )}

      <div className={CONTROLS_PANEL_CLASS}>
        <button
          type="button"
          onClick={() => setIsRunning(!isRunning)}
          className={controlButtonClass(isRunning ? 'running' : 'paused')}
          aria-pressed={isRunning}
          title={isRunning ? 'Disconnect live stream' : 'Connect live stream'}
        >
          {isRunning ? <Pause size={16} /> : <Play size={16} />}
          {isRunning ? 'DISCONNECT' : 'CONNECT'}
        </button>
        <div className={CONTROL_PANEL_DIVIDER_CLASS}></div>
        <button
          type="button"
          onClick={() => setChaosMode(!chaosMode)}
          className={controlButtonClass(chaosMode ? 'chaosOn' : 'chaosOff')}
          aria-pressed={chaosMode}
          disabled={!chaosControlEnabled}
          title="Not available in replay mode"
        >
          <Flame size={16} className={chaosMode ? 'motion-safe:animate-pulse motion-reduce:animate-none' : ''} />
          CHAOS MODE
        </button>
        <div className={CONTROL_PANEL_DIVIDER_CLASS}></div>
        <button
          type="button"
          onClick={reset}
          className={controlButtonClass('neutral')}
          title="Reconnect frontend stream"
        >
          <RotateCcw size={16} />
          RECONNECT
        </button>
      </div>
    </div>
  );
}
