// Tests for hooks/useRaft.ts — the WebSocket event-sourcing connector.
//
// Strategy:
//   - Replace global.WebSocket with a FakeWebSocket class
//   - Use @testing-library/react renderHook to render the hook in isolation
//
// In event-sourcing mode:
//   - No REST API calls (all state comes via WebSocket)
//   - toggleNodeState and clientRequest are no-ops (stubs)
//   - State is reconstructed from RaftStateEvent messages

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRaft } from '@/hooks/useRaft';
import type { RaftStateEvent } from '@/lib/types';

// ── FakeWebSocket ─────────────────────────────────────────────────────────────

class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    static OPEN = 1;
    static CLOSED = 3;

    readyState = 0;

    onopen: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent<string>) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    onclose: ((e: CloseEvent) => void) | null = null;

    constructor(public url: string) {
        FakeWebSocket.instances.push(this);
    }

    simulateOpen() {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.(new Event('open'));
    }

    simulateMessage(data: unknown) {
        this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
    }

    simulateClose() {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.(new CloseEvent('close'));
    }

    close() { this.readyState = FakeWebSocket.CLOSED; }
    send(_data: string) { }
}

// ── Sample event payload ───────────────────────────────────────────────────────

function makeEvent(overrides: Partial<RaftStateEvent> = {}): RaftStateEvent {
    return {
        node_id: 'A',
        state: 'FOLLOWER',
        current_term: 1,
        event_time_ms: Date.now(),
        ...overrides,
    };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

// ── 1. Connection lifecycle ───────────────────────────────────────────────────

describe('connection lifecycle', () => {
    it('starts as connecting with an empty nodes map', () => {
        const { result } = renderHook(() => useRaft());
        expect(result.current.status).toBe('connecting');
        expect(Object.keys(result.current.nodes)).toHaveLength(0);
    });

    it('transitions to connected and isRunning=true when the socket opens', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        expect(result.current.status).toBe('connected');
        expect(result.current.isRunning).toBe(true);
    });

    it('transitions to reconnecting when the socket closes (isRunning stays true)', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => { FakeWebSocket.instances[0].simulateClose(); });
        expect(result.current.status).toBe('reconnecting');
        // isRunning stays true because we're still trying to reconnect
        expect(result.current.isRunning).toBe(true);
    });

    it('opens a new WebSocket after the reconnect delay', () => {
        renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => { FakeWebSocket.instances[0].simulateClose(); });
        expect(FakeWebSocket.instances).toHaveLength(1);
        act(() => { vi.advanceTimersByTime(1100); });
        expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('stops reconnecting when setIsRunning(false) is called', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => { result.current.setIsRunning(false); });
        expect(result.current.status).toBe('disconnected');
        expect(result.current.isRunning).toBe(false);
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(FakeWebSocket.instances).toHaveLength(1);
    });
});

// ── 2. State mapping ──────────────────────────────────────────────────────────

describe('state mapping', () => {
    it('populates nodes when a RaftStateEvent arrives', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(
                makeEvent({ node_id: 'A', state: 'LEADER', current_term: 3 }),
            );
        });
        const node = result.current.nodes['A'];
        expect(node).toBeDefined();
        expect(node.state).toBe('LEADER');
        expect(node.term).toBe(3);
    });

    it('accumulates state for multiple nodes independently', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({ node_id: 'A', state: 'LEADER' }));
            FakeWebSocket.instances[0].simulateMessage(makeEvent({ node_id: 'B', state: 'FOLLOWER' }));
        });
        expect(result.current.nodes['A'].state).toBe('LEADER');
        expect(result.current.nodes['B'].state).toBe('FOLLOWER');
    });

    it('silently ignores malformed JSON messages', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({ node_id: 'A' }));
            FakeWebSocket.instances[0].onmessage?.(
                new MessageEvent('message', { data: '{not valid json{{' }),
            );
        });
        expect(result.current.nodes['A']).toBeDefined();
    });

    it('silently ignores messages without node_id', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage({ state: 'LEADER' });
        });
        expect(Object.keys(result.current.nodes)).toHaveLength(0);
    });

    it('uses default timeout values when not provided', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent());
        });
        expect(result.current.nodes['A'].electionTimeout).toBe(8000);
        expect(result.current.nodes['A'].heartbeatInterval).toBe(2000);
    });

    it('uses backend timing values when provided', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                election_timeout_ms: 5000,
                heartbeat_interval_ms: 1000,
            }));
        });
        expect(result.current.nodes['A'].electionTimeout).toBe(5000);
        expect(result.current.nodes['A'].heartbeatInterval).toBe(1000);
    });

    it('updates existing node on subsequent events', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({ state: 'FOLLOWER', current_term: 1 }));
            FakeWebSocket.instances[0].simulateMessage(makeEvent({ state: 'CANDIDATE', current_term: 2 }));
        });
        expect(result.current.nodes['A'].state).toBe('CANDIDATE');
        expect(result.current.nodes['A'].term).toBe(2);
    });
});

// ── 3. Stubs (event-sourcing mode) ─────────────────────────────────────────────

describe('stubs', () => {
    it('toggleNodeState is a no-op stub', async () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({ node_id: 'B', state: 'FOLLOWER' }));
        });
        await act(async () => { result.current.toggleNodeState('B'); });
        expect(result.current.nodes['B'].state).toBe('FOLLOWER');
    });

    it('clientRequest returns failure stub', async () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        const res = await result.current.clientRequest('SET x=1');
        expect(res.success).toBe(false);
    });
});

// ── 4. Heartbeats visualization ───────────────────────────────────────────────

describe('heartbeats visualization', () => {
    it('generates heartbeat messages when a LEADER event arrives', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({ node_id: 'A', state: 'FOLLOWER' }));
            FakeWebSocket.instances[0].simulateMessage(makeEvent({ node_id: 'B', state: 'FOLLOWER' }));
            FakeWebSocket.instances[0].simulateMessage(makeEvent({ node_id: 'A', state: 'LEADER' }));
        });
        expect(result.current.heartbeats.length).toBeGreaterThan(0);
        expect(result.current.heartbeats.every(h => h.from === 'A')).toBe(true);
    });

    it('removes heartbeats after progress completes', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({ node_id: 'B', state: 'FOLLOWER' }));
            FakeWebSocket.instances[0].simulateMessage(makeEvent({ node_id: 'A', state: 'LEADER' }));
        });
        expect(result.current.heartbeats.length).toBeGreaterThan(0);
        const before = result.current.heartbeats.length;
        act(() => { vi.advanceTimersByTime(2000); });
        expect(result.current.heartbeats.length).toBeLessThan(before);
    });
});

// ── 5. Reset ──────────────────────────────────────────────────────────────────

describe('reset', () => {
    it('reconnects when reset is called', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => { FakeWebSocket.instances[0].simulateClose(); });
        act(() => { result.current.reset(); });
        act(() => { vi.advanceTimersByTime(100); });
        expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
    });
});
