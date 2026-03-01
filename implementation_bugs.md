# Implementation Bugs and Fix Log

This file tracks high-signal engineering issues found during demo development and how they were resolved.

## 2026-03-01: Timeout Visualization Drift and Deceptive Progress

### Symptoms

- Election rings could jump from low progress (for example ~25%) directly to candidate/leader transitions.
- Timeout values looked deceptively uniform between nodes.
- Frontend timing did not faithfully match backend timing behavior.

### Root Causes

1. Frontend multiplied backend timing by a fixed scale (`VISUAL_TIME_SCALE=20`), creating non-authoritative timing.
2. Frontend preserved election timeout values across repeated snapshots and could hide backend timeout-cycle changes.
3. Demo node timing was not explicitly configured in compose, so behavior depended on image defaults.
4. There was no dedicated UI surface to inspect per-node timeout-cycle starts and spread.

### Fixes Applied

1. Backend timing explicitly configured in `docker-compose.yml` for demo realism:
   - heartbeat interval: `2000ms`
   - staggered election windows per node:
     - `A: 8000-10000ms`
     - `B: 11000-13000ms`
     - `C: 14000-16000ms`
     - `D: 17000-19000ms`
     - `E: 20000-22000ms`
2. Frontend timing mapping changed to 1:1 with backend telemetry (`VISUAL_TIME_SCALE=1`).
3. Frontend timeout-cycle tracking updated:
   - stores backend raw timing per node
   - resets local timeout cycle when backend election timeout changes
   - tracks cycle start timestamp (`electionStartedAt`)
4. Added sidebar **Timeout Debug** panel:
   - per-node backend heartbeat/election timeout
   - elapsed and remaining timeout in current cycle
   - progress percentage
   - cluster timeout spread
5. Added gateway debug logging of per-node timing snapshots when timing values change.

### Outcome

- Timeout progression now reads as realistic and monitorable.
- Frontend and backend timing semantics are aligned for demo runs.
- Engineers and reviewers can validate per-node timeout behavior directly from the UI.

## 2026-03-01: Candidate Color Lag After Timeout Rollover

### Symptoms

- After leader kill, some nodes completed multiple timeout circles before turning visually candidate.
- Operators observed "timeout finished, but node still follower color" for 1-3 rounds.

### Root Causes

1. Frontend candidate hinting relied on timeout-change frames arriving after local timer progress had already crossed a strict threshold.
2. For short intervals and 16ms tick cadence, frames can land between ticks, so stored progress under-reported near-timeout state.
3. Pre-vote follower-to-follower timeout rollover can occur without an immediate backend `CANDIDATE` snapshot.

### Fixes Applied

1. Timeout rollover hint logic now checks both:
   - ticked progress (`electionTimer / electionTimeout`)
   - wall-clock progress (`(now - electionStartedAt) / electionTimeout`)
2. Near-timeout threshold relaxed for demo cadence (`0.85`) to avoid missing first rollover hints.
3. Added regression test for "frame arrives between timer ticks" case:
   - backend remains `FOLLOWER`
   - timeout changes near rollover
   - visual state immediately becomes `CANDIDATE` with timer reset
4. Extended Timeout Debug panel:
   - `Visual` vs `Actual` role columns
   - `Hold Left` column for candidate-hint transparency

### Outcome

- Candidate color now aligns with first timeout rollover far more consistently.
- Visual/actual divergence is explicit and inspectable in the UI.
- Behavior remains backend-authoritative while preserving demo readability.
