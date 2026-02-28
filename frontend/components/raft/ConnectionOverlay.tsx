import type { ConnectionStatus } from '@/hooks/useRaft';
import { cva } from 'class-variance-authority';
import { RAFT_STATUS_BADGE, RAFT_STATUS_PANEL, RAFT_SURFACE } from './uiPrimitives';

interface ConnectionOverlayProps {
  status: ConnectionStatus;
}

const OVERLAY_ROOT_CLASS = 'flex min-h-screen items-center justify-center bg-[#0A0A0B] text-slate-400 font-mono';
const OVERLAY_CONTENT_CLASS =
  'flex max-w-md flex-col items-center gap-4 text-center';
const OVERLAY_PULSE_WRAPPER_CLASS = 'relative flex h-4 w-4';
const OVERLAY_PULSE_RING_CLASS =
  'motion-safe:animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full opacity-75';
const OVERLAY_STATUS_LABEL_CLASS = 'text-sm uppercase tracking-widest text-slate-100';
const OVERLAY_STATUS_DETAIL_CLASS = 'text-xs text-slate-400 leading-relaxed';

const OVERLAY_PULSE_TONE = cva('relative inline-flex rounded-full h-4 w-4', {
  variants: {
    tone: {
      info: 'bg-sky-400',
      success: 'bg-emerald-500',
      warning: 'bg-amber-400',
      danger: 'bg-red-400',
    },
  },
  defaultVariants: {
    tone: 'info',
  },
});

const OVERLAY_PULSE_RING_TONE = cva('', {
  variants: {
    tone: {
      info: 'bg-sky-400',
      success: 'bg-emerald-400',
      warning: 'bg-amber-400',
      danger: 'bg-red-400',
    },
  },
  defaultVariants: {
    tone: 'info',
  },
});

type OverlayTone = 'info' | 'success' | 'warning' | 'danger';

interface OverlayStateView {
  badge: string;
  label: string;
  detail: string;
  tone: OverlayTone;
}

const STATUS_VIEW_BY_CONNECTION_STATE: Record<ConnectionStatus, OverlayStateView> = {
  disconnected: {
    badge: 'Disconnected',
    label: 'Cluster Gateway Is Offline',
    detail: 'The stream is disconnected. Waiting for a manual resume or reconnect attempt.',
    tone: 'danger',
  },
  connecting: {
    badge: 'Connecting',
    label: 'Connecting To Raft Gateway',
    detail: 'Opening stream and waiting for first node snapshot.',
    tone: 'info',
  },
  connected: {
    badge: 'Connected',
    label: 'Gateway Connected',
    detail: 'Waiting for initial node states from the backend.',
    tone: 'success',
  },
  reconnecting: {
    badge: 'Reconnecting',
    label: 'Connection Lost, Retrying',
    detail: 'Automatic retry is active. Visualization updates resume when telemetry arrives.',
    tone: 'warning',
  },
};

function ConnectionPulse({ tone }: { tone: OverlayTone }) {
  return (
    <div className={OVERLAY_PULSE_WRAPPER_CLASS}>
      <span className={`${OVERLAY_PULSE_RING_CLASS} ${OVERLAY_PULSE_RING_TONE({ tone })}`}></span>
      <span className={OVERLAY_PULSE_TONE({ tone })}></span>
    </div>
  );
}

function connectionStatusView(status: ConnectionStatus): OverlayStateView {
  return STATUS_VIEW_BY_CONNECTION_STATE[status];
}

export function ConnectionOverlay({ status }: ConnectionOverlayProps) {
  const view = connectionStatusView(status);

  return (
    <div className={OVERLAY_ROOT_CLASS}>
      <div
        className={`${RAFT_SURFACE({ tone: 'elevated', blur: 'soft', shadow: 'deep', padding: 'card', radius: 'xl' })} ${OVERLAY_CONTENT_CLASS}`}
        role="status"
        aria-live="polite"
      >
        <span className={RAFT_STATUS_BADGE({ tone: view.tone })}>{view.badge}</span>
        <ConnectionPulse tone={view.tone} />
        <span className={OVERLAY_STATUS_LABEL_CLASS}>{view.label}</span>
        <p className={RAFT_STATUS_PANEL({ tone: view.tone })}>
          <span className={OVERLAY_STATUS_DETAIL_CLASS}>{view.detail}</span>
        </p>
      </div>
    </div>
  );
}
