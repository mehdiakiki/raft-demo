// RECONNECT_BASE_MS is the initial back-off delay before re-connecting.
export const RECONNECT_BASE_MS = 500;

// RECONNECT_MAX_MS caps the exponential back-off so we never wait too long.
export const RECONNECT_MAX_MS = 8_000;

// VISUAL_TIME_SCALE magnifies backend timing telemetry for UI readability.
export const VISUAL_TIME_SCALE = 20;

// MIN_STALE_WINDOW_MS is the lower bound for per-node staleness detection.
export const MIN_STALE_WINDOW_MS = 3_000;

// ELECTION_TICK_MS drives local election timer interpolation cadence.
export const ELECTION_TICK_MS = 16;

// MIN_TRANSPORT_SILENCE_MS is the minimum gateway-silence grace window.
export const MIN_TRANSPORT_SILENCE_MS = 2_500;

// TRANSPORT_SILENCE_FACTOR scales node stale windows into a global silence window.
export const TRANSPORT_SILENCE_FACTOR = 0.6;

// HEARTBEAT_THROTTLE_FACTOR avoids emitting heartbeat dots too frequently.
export const HEARTBEAT_THROTTLE_FACTOR = 0.8;

// HEARTBEAT_INTERVAL_MS — how often the leader emits a visible pulse.
// Slowed down from real Raft timing for visual clarity.
export const HB_INTERVAL_MS = 3_000;

// HEARTBEAT_EMIT_TICK_MS controls the polling interval for heartbeat emission.
export const HEARTBEAT_EMIT_TICK_MS = 100;

// HEARTBEAT_ANIM_TICK_MS controls heartbeat dot animation frame cadence.
export const HEARTBEAT_ANIM_TICK_MS = 16;

// PULSE_SPEED — progress added per ~16ms frame.
export const PULSE_SPEED = 0.008;

// NODE_TIMER_CHANGE_EPSILON_MS suppresses tiny election timer update jitter.
export const NODE_TIMER_CHANGE_EPSILON_MS = 1;

// NODE_MAPPING_TRACE_THRESHOLD_MS throttles noisy mapped-node trace events.
export const NODE_MAPPING_TRACE_THRESHOLD_MS = 16;

// MIN_SCALED_HEARTBEAT_MS prevents visually unreadable micro heartbeat intervals.
export const MIN_SCALED_HEARTBEAT_MS = 250;

// ELECTION_TIMEOUT_TO_HEARTBEAT_RATIO enforces timeout >= N * heartbeat in UI.
export const ELECTION_TIMEOUT_TO_HEARTBEAT_RATIO = 2;

// STALE_WINDOW_HEARTBEAT_MULTIPLIER scales stale window by heartbeat interval.
export const STALE_WINDOW_HEARTBEAT_MULTIPLIER = 3;

// STALE_WINDOW_ELECTION_MULTIPLIER scales stale window by election timeout.
export const STALE_WINDOW_ELECTION_MULTIPLIER = 1.2;

// DEFAULT_ELECTION_TIMEOUT_MIN_MS is fallback timeout lower bound without telemetry.
export const DEFAULT_ELECTION_TIMEOUT_MIN_MS = 3_000;

// DEFAULT_ELECTION_TIMEOUT_JITTER_MS is fallback timeout random spread.
export const DEFAULT_ELECTION_TIMEOUT_JITTER_MS = 3_000;

// DEFAULT_MESSAGE_SPEED is the legacy default latency slider output.
export const DEFAULT_MESSAGE_SPEED = 0.02;

// DEFAULT_CHAOS_MODE is the legacy default chaos toggle value.
export const DEFAULT_CHAOS_MODE = false;

function getPositiveIntFromEnv(name: string, fallback: number): number {
  const source = process.env[name];
  if (!source) return fallback;
  const parsed = Number.parseInt(source, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

// CANDIDATE_MIN_VISIBLE_MS keeps CANDIDATE visible briefly for operator readability.
export const CANDIDATE_MIN_VISIBLE_MS = getPositiveIntFromEnv('NEXT_PUBLIC_CANDIDATE_HOLD_MS', 1_200);

// TRANSITION_REPLAY_WINDOW_MS ignores stale replayed transition events older than this.
export const TRANSITION_REPLAY_WINDOW_MS = getPositiveIntFromEnv('NEXT_PUBLIC_TRANSITION_REPLAY_WINDOW_MS', 8_000);

// TRACE_TICK_SAMPLE_MS throttles election tick trace event sampling frequency.
export const TRACE_TICK_SAMPLE_MS = getPositiveIntFromEnv('NEXT_PUBLIC_ANIMATION_TRACE_TICK_MS', 250);

// SESSION_ID identifies this browser tab for exactly-once command delivery.
export const SESSION_ID = typeof crypto !== 'undefined'
  ? crypto.randomUUID()
  : `client-${Math.random().toString(36).slice(2)}`;
