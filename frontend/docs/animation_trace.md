# Animation Trace Debugging

This project now supports a structured frontend trace for election/candidate animation timing.

## Enable

Add to `frontend/.env.local`:

```env
NEXT_PUBLIC_ANIMATION_TRACE=1
NEXT_PUBLIC_ANIMATION_TRACE_CONSOLE=1
NEXT_PUBLIC_ANIMATION_TRACE_LIMIT=20000
NEXT_PUBLIC_ANIMATION_TRACE_TICK_MS=250
```

Restart frontend after changing env vars.

## Capture

1. Reproduce the sudden candidate transition in the UI.
2. Open browser DevTools console.
3. Export trace:

```js
dumpRaftAnimationTrace()
```

This downloads a JSON file (`raft-animation-trace-*.json`) containing ordered events.

Useful helpers:

```js
getRaftAnimationTrace()
clearRaftAnimationTrace()
```

## What To Inspect

- `ws_transition`: backend role transitions (including `inferred`).
- `candidate_hint_applied`: how candidate visual state was forced (`timer_before_ms`, `timer_after_ms`).
- `mapped_node`: final node state after mapping WS data to UI state.
- `election_tick`: sampled timer progression (`progress`).
- `heartbeat_emit` / `heartbeat_reset`: timer resets from leader heartbeat emission.

## Typical Sudden-Candidate Pattern

1. `ws_transition` with `to: "CANDIDATE"` arrives very close to a `LEADER` snapshot.
2. `candidate_hint_applied` shows a large jump from `timer_before_ms` to `timer_after_ms`.
3. `mapped_node` flips `visual_state` quickly, causing abrupt ring/state changes.

This file gives concrete timing evidence before changing animation semantics.
