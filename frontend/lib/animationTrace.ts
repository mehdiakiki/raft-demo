export interface AnimationTraceEvent {
  at: number;
  type: string;
  [key: string]: unknown;
}

type AnimationTracePayload = {
  type: string;
  at?: number;
  [key: string]: unknown;
};

const TRACE_ENABLED = process.env.NEXT_PUBLIC_ANIMATION_TRACE === '1';
const TRACE_CONSOLE = process.env.NEXT_PUBLIC_ANIMATION_TRACE_CONSOLE === '1';
const DEFAULT_TRACE_LIMIT = 20_000;
const parsedLimit = Number.parseInt(process.env.NEXT_PUBLIC_ANIMATION_TRACE_LIMIT ?? '', 10);
const TRACE_LIMIT = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_TRACE_LIMIT;

const traceBuffer: AnimationTraceEvent[] = [];
let helpersInstalled = false;

function canTrace(): boolean {
  return TRACE_ENABLED && typeof window !== 'undefined';
}

function installWindowHelpers(): void {
  if (helpersInstalled || typeof window === 'undefined') return;
  helpersInstalled = true;
  window.__RAFT_ANIMATION_TRACE__ = traceBuffer;
  window.dumpRaftAnimationTrace = (name?: string) => {
    downloadAnimationTrace(name);
  };
  window.clearRaftAnimationTrace = () => {
    clearAnimationTrace();
  };
  window.getRaftAnimationTrace = () => {
    return [...traceBuffer];
  };
}

export function traceAnimation(event: AnimationTracePayload): void {
  if (!canTrace()) return;
  installWindowHelpers();

  const withTime: AnimationTraceEvent = {
    at: event.at ?? Date.now(),
    ...event,
  };
  traceBuffer.push(withTime);
  if (traceBuffer.length > TRACE_LIMIT) {
    traceBuffer.splice(0, traceBuffer.length - TRACE_LIMIT);
  }

  if (TRACE_CONSOLE) {
    console.debug('[raft-animation-trace]', withTime);
  }
}

export function clearAnimationTrace(): void {
  traceBuffer.length = 0;
}

export function downloadAnimationTrace(name?: string): void {
  if (typeof window === 'undefined') return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = name && name.trim() ? name : `raft-animation-trace-${stamp}.json`;
  const payload = JSON.stringify(traceBuffer, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(href);
}

declare global {
  interface Window {
    __RAFT_ANIMATION_TRACE__?: AnimationTraceEvent[];
    dumpRaftAnimationTrace?: (name?: string) => void;
    clearRaftAnimationTrace?: () => void;
    getRaftAnimationTrace?: () => AnimationTraceEvent[];
  }
}
