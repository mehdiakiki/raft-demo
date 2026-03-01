// Tests for hooks/useRaft.ts — the WebSocket + REST connector.
//
// Strategy:
//   - Replace global.WebSocket with a FakeWebSocket class whose instances are
//     stored in a registry so tests can drive them (emit messages, trigger
//     open/close) from outside the hook.
//   - Mock lib/api functions with vi.mock so REST calls never hit the network.
//   - Use @testing-library/react renderHook to render the hook in isolation.
//
// Each group verifies one concern:
//   1. Connection lifecycle   (connecting → connected on open)
//   2. State mapping          (wire JSON → RaftNode shape)
//   3. Reconnection back-off  (close triggers reconnect)
//   4. toggleNodeState        (dispatches kill / restart)
//   5. clientRequest          (calls submitCommand with monotonic seqNum)
//   6. setIsRunning           (manual disconnect)

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mock lib/api so no real fetch calls are made ──────────────────────────────

vi.mock('@/lib/api', () => ({
    fetchClusterState: vi.fn().mockResolvedValue({ nodes: [] }),
    fetchNetEmControl: vi.fn().mockResolvedValue({ latency_ms: 40, jitter_ms: 14, drop_pct: 0 }),
    fetchChaosControl: vi.fn().mockResolvedValue({ enabled: false, interval_ms: 20000, down_ms: 12000 }),
    setNetEmControl: vi.fn().mockResolvedValue({ latency_ms: 40, jitter_ms: 14, drop_pct: 0 }),
    setChaosControl: vi.fn().mockResolvedValue({ enabled: false, interval_ms: 20000, down_ms: 12000 }),
    submitCommand: vi.fn().mockResolvedValue({ success: true, leader_id: 'A', duplicate: false }),
    killNode: vi.fn().mockResolvedValue({ node_id: 'B', alive: false }),
    restartNode: vi.fn().mockResolvedValue({ node_id: 'B', alive: true }),
}));

import {
    fetchChaosControl,
    fetchClusterState,
    fetchNetEmControl,
    killNode,
    restartNode,
    setChaosControl,
    setNetEmControl,
    submitCommand,
} from '@/lib/api';
import { useRaft } from '@/hooks/useRaft';
import type { NodeStateReply, StateTransitionEvent } from '@/lib/types';

// ── FakeWebSocket ─────────────────────────────────────────────────────────────

// A minimal WebSocket stand-in.  After construction the instance is pushed onto
// FakeWebSocket.instances so tests can interact with it directly.
class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    static OPEN = 1;
    static CLOSED = 3;

    readyState = 0; // CONNECTING

    onopen: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent<string>) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    onclose: ((e: CloseEvent) => void) | null = null;

    constructor(public url: string) {
        FakeWebSocket.instances.push(this);
    }

    /** Simulate a successful TCP connection. */
    simulateOpen() {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.(new Event('open'));
    }

    /** Push a JSON-serialised server message. */
    simulateMessage(data: unknown) {
        this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
    }

    /** Simulate the server closing the connection. */
    simulateClose() {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.(new CloseEvent('close'));
    }

    close() { this.readyState = FakeWebSocket.CLOSED; }
    send(_data: string) { }
}

// ── Sample wire payload ───────────────────────────────────────────────────────

function makeReply(overrides: Partial<NodeStateReply> = {}): NodeStateReply {
    return {
        node_id: 'A',
        state: 'FOLLOWER',
        current_term: 1,
        voted_for: '',
        commit_index: 0,
        last_applied: 0,
        log: [],
        leader_id: '',
        ...overrides,
    };
}

function makeTransition(overrides: Partial<StateTransitionEvent> = {}): StateTransitionEvent {
    return {
        type: 'state_transition',
        node_id: 'A',
        from: 'FOLLOWER',
        to: 'CANDIDATE',
        term: 1,
        at_unix_ms: Date.now(),
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

    it('hydrates an immediate cluster snapshot after socket open', async () => {
        renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        await act(async () => {
            await Promise.resolve();
        });
        expect(fetchClusterState as Mock).toHaveBeenCalledTimes(1);
    });

    it('transitions to reconnecting and isRunning=false when the socket closes', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => { FakeWebSocket.instances[0].simulateClose(); });
        expect(result.current.status).toBe('reconnecting');
        expect(result.current.isRunning).toBe(false);
    });

    it('opens a new WebSocket after the reconnect back-off delay', () => {
        renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => { FakeWebSocket.instances[0].simulateClose(); });
        expect(FakeWebSocket.instances).toHaveLength(1);
        // Advance past initial 500 ms back-off.
        act(() => { vi.advanceTimersByTime(600); });
        expect(FakeWebSocket.instances).toHaveLength(2);
    });
});

// ── 2. State mapping ──────────────────────────────────────────────────────────

describe('state mapping', () => {
    it('populates nodes when a NodeStateReply message arrives', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(
                makeReply({ node_id: 'A', state: 'LEADER', current_term: 3 }),
            );
        });
        const node = result.current.nodes['A'];
        expect(node).toBeDefined();
        expect(node.state).toBe('LEADER');
        expect(node.term).toBe(3);
    });

    it('maps voted_for empty string to null', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => { FakeWebSocket.instances[0].simulateMessage(makeReply({ voted_for: '' })); });
        expect(result.current.nodes['A'].votedFor).toBeNull();
    });

    it('maps voted_for non-empty string correctly', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => { FakeWebSocket.instances[0].simulateMessage(makeReply({ voted_for: 'B' })); });
        expect(result.current.nodes['A'].votedFor).toBe('B');
    });

    it('maps log entries preserving term and command', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeReply({
                log: [
                    { term: 1, type: 0, command: 'SET x=1', client_id: '', sequence_num: 0 },
                    { term: 2, type: 0, command: 'DEL y', client_id: '', sequence_num: 0 },
                ],
            }));
        });
        const log = result.current.nodes['A'].log;
        expect(log).toHaveLength(2);
        expect(log[0]).toEqual({ term: 1, command: 'SET x=1' });
        expect(log[1]).toEqual({ term: 2, command: 'DEL y' });
    });

    it('accumulates state for multiple nodes independently', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'A', state: 'LEADER' }));
            FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'B', state: 'FOLLOWER' }));
        });
        expect(result.current.nodes['A'].state).toBe('LEADER');
        expect(result.current.nodes['B'].state).toBe('FOLLOWER');
    });

    it('silently ignores malformed JSON messages', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'A' }));
            // Inject raw garbage.
            FakeWebSocket.instances[0].onmessage?.(
                new MessageEvent('message', { data: '{not valid json{{' }),
            );
        });
        // Valid node still present, no crash.
        expect(result.current.nodes['A']).toBeDefined();
    });

    it('sets electionTimer=0 and a positive electionTimeout fallback', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => { FakeWebSocket.instances[0].simulateMessage(makeReply()); });
        expect(result.current.nodes['A'].electionTimer).toBe(0);
        expect(result.current.nodes['A'].electionTimeout).toBeGreaterThan(0);
    });

    it('uses backend timing telemetry when provided', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeReply({
                heartbeat_interval_ms: 50,
                election_timeout_ms: 200,
            }));
        });
        // Frontend uses backend timing values 1:1.
        expect(result.current.nodes['A'].heartbeatInterval).toBe(50);
        expect(result.current.nodes['A'].electionTimeout).toBe(200);
        expect(result.current.nodes['A'].backendHeartbeatIntervalMs).toBe(50);
        expect(result.current.nodes['A'].backendElectionTimeoutMs).toBe(200);
    });

    it('marks one node stale while other nodes keep receiving updates', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeReply({
                node_id: 'A',
                heartbeat_interval_ms: 50,
                election_timeout_ms: 200,
            }));
            FakeWebSocket.instances[0].simulateMessage(makeReply({
                node_id: 'B',
                heartbeat_interval_ms: 50,
                election_timeout_ms: 200,
            }));
        });
        expect(result.current.nodes['A'].stale).toBe(false);
        expect(result.current.nodes['B'].stale).toBe(false);

        // Keep transport healthy via periodic updates for B only.
        act(() => { vi.advanceTimersByTime(2_000); });
        act(() => { FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'B', current_term: 2 })); });
        act(() => { vi.advanceTimersByTime(2_000); });
        act(() => { FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'B', current_term: 3 })); });
        act(() => { vi.advanceTimersByTime(1_000); });

        // A has now exceeded its stale window without updates.
        expect(result.current.nodes['A'].stale).toBe(true);
        expect(result.current.nodes['B'].stale).toBe(false);

        act(() => { FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'A', current_term: 4 })); });
        expect(result.current.nodes['A'].stale).toBe(false);
    });

    it('does not mark all nodes stale during transport-wide silence', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeReply({
                node_id: 'A',
                heartbeat_interval_ms: 50,
                election_timeout_ms: 200,
            }));
            FakeWebSocket.instances[0].simulateMessage(makeReply({
                node_id: 'B',
                heartbeat_interval_ms: 50,
                election_timeout_ms: 200,
            }));
        });

        // No updates at all for long enough to exceed per-node stale windows.
        act(() => { vi.advanceTimersByTime(10_000); });

        expect(result.current.nodes['A'].stale).toBe(false);
        expect(result.current.nodes['B'].stale).toBe(false);
    });

    it('keeps CANDIDATE visible briefly when transition event is followed by LEADER snapshot', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => { FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'A', state: 'FOLLOWER', current_term: 1 })); });

        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeTransition({ node_id: 'A', to: 'CANDIDATE', term: 2 }));
            FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'A', state: 'LEADER', current_term: 2 }));
        });

        expect(result.current.nodes['A'].state).toBe('CANDIDATE');
        expect(result.current.nodes['A'].actualState).toBe('LEADER');

        act(() => { vi.advanceTimersByTime(2_100); });

        expect(result.current.nodes['A'].state).toBe('LEADER');
        expect(result.current.nodes['A'].actualState).toBe('LEADER');
    });

    it('does not delay first leader render when candidate transition arrives before first snapshot', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });

        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeTransition({ node_id: 'A', to: 'CANDIDATE', term: 2 }));
            FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'A', state: 'LEADER', current_term: 2 }));
        });

        expect(result.current.nodes['A'].state).toBe('LEADER');
        expect(result.current.nodes['A'].actualState).toBe('LEADER');
    });

    it('does not hold the initial CANDIDATE snapshot once LEADER snapshot arrives', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });

        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'A', state: 'CANDIDATE', current_term: 2 }));
            FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'A', state: 'LEADER', current_term: 2 }));
        });

        expect(result.current.nodes['A'].state).toBe('LEADER');
        expect(result.current.nodes['A'].actualState).toBe('LEADER');
    });

    it('keeps timer continuity on direct candidate transition (no forced near-timeout jump)', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeReply({
                node_id: 'A',
                state: 'FOLLOWER',
                heartbeat_interval_ms: 100,
                election_timeout_ms: 350,
            }));
        });

        act(() => { vi.advanceTimersByTime(1_200); });
        const before = result.current.nodes['A'].electionTimer;
        expect(before).toBeGreaterThan(0);

        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeTransition({
                node_id: 'A',
                to: 'CANDIDATE',
                term: 2,
            }));
        });

        expect(result.current.nodes['A'].state).toBe('CANDIDATE');
        const after = result.current.nodes['A'].electionTimer;
        const timeout = result.current.nodes['A'].electionTimeout;
        expect(after).toBeGreaterThanOrEqual(before);
        expect(after - before).toBeLessThan(timeout * 0.1);

        act(() => { vi.advanceTimersByTime(1_000); });
        expect(result.current.nodes['A'].electionTimer).toBeGreaterThanOrEqual(after);
        expect(result.current.nodes['A'].electionTimer).toBeLessThanOrEqual(timeout);
    });

    it('does not fast-forward the ring on inferred candidate hints', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeReply({
                node_id: 'A',
                state: 'FOLLOWER',
                heartbeat_interval_ms: 100,
                election_timeout_ms: 350,
            }));
        });

        act(() => { vi.advanceTimersByTime(1_000); });
        const before = result.current.nodes['A'].electionTimer;

        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeTransition({
                node_id: 'A',
                to: 'CANDIDATE',
                term: 2,
                inferred: true,
            }));
        });

        const after = result.current.nodes['A'].electionTimer;
        expect(after).toBeGreaterThanOrEqual(before);
        expect(after - before).toBeLessThan(result.current.nodes['A'].electionTimeout * 0.1);
    });

    it('does not reset follower timeout when old heartbeat dots finish after leader death', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeReply({
                node_id: 'A',
                state: 'LEADER',
                current_term: 1,
                heartbeat_interval_ms: 100,
                election_timeout_ms: 350,
            }));
            FakeWebSocket.instances[0].simulateMessage(makeReply({
                node_id: 'B',
                state: 'FOLLOWER',
                current_term: 1,
                heartbeat_interval_ms: 100,
                election_timeout_ms: 350,
            }));
        });

        act(() => { vi.advanceTimersByTime(1_500); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeReply({
                node_id: 'A',
                state: 'DEAD',
                current_term: 1,
                heartbeat_interval_ms: 100,
                election_timeout_ms: 350,
            }));
        });

        const before = result.current.nodes['B'].electionTimer;
        act(() => { vi.advanceTimersByTime(1_200); });
        const after = result.current.nodes['B'].electionTimer;

        expect(after).toBeGreaterThanOrEqual(before);
    });

    it('does not locally reset follower timeout during backend silence while leader snapshot stays LEADER', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeReply({
                node_id: 'A',
                state: 'LEADER',
                current_term: 1,
                heartbeat_interval_ms: 100,
                election_timeout_ms: 400,
            }));
            FakeWebSocket.instances[0].simulateMessage(makeReply({
                node_id: 'B',
                state: 'FOLLOWER',
                current_term: 1,
                heartbeat_interval_ms: 100,
                election_timeout_ms: 350,
            }));
        });

        const startedAt = result.current.nodes['B'].electionStartedAt;
        act(() => { vi.advanceTimersByTime(1_200); });

        const follower = result.current.nodes['B'];
        expect(follower.electionStartedAt).toBe(startedAt);
        expect(follower.electionTimer).toBeGreaterThanOrEqual(320);
        expect(follower.electionTimer).toBeLessThanOrEqual(follower.electionTimeout);
    });

    it('shows CANDIDATE visual on follower timeout rollover even when frame arrives between timer ticks', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeReply({
                node_id: 'A',
                state: 'FOLLOWER',
                current_term: 1,
                heartbeat_interval_ms: 40,
                election_timeout_ms: 100,
            }));
        });

        // 89ms is near timeout but often before the next 16ms election tick update.
        act(() => { vi.advanceTimersByTime(89); });
        const before = result.current.nodes['A'].electionTimer;
        expect(before).toBeLessThan(92);

        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeReply({
                node_id: 'A',
                state: 'FOLLOWER',
                current_term: 1,
                heartbeat_interval_ms: 40,
                election_timeout_ms: 130,
            }));
        });

        expect(result.current.nodes['A'].actualState).toBe('FOLLOWER');
        expect(result.current.nodes['A'].state).toBe('CANDIDATE');
        expect(result.current.nodes['A'].electionTimer).toBe(0);

        act(() => { vi.advanceTimersByTime(2_100); });
        expect(result.current.nodes['A'].state).toBe('FOLLOWER');
        expect(result.current.nodes['A'].actualState).toBe('FOLLOWER');
    });

    it('ignores stale transition replay events that are outside the replay window', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => { FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'A', state: 'FOLLOWER', current_term: 1 })); });

        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeTransition({
                node_id: 'A',
                to: 'CANDIDATE',
                term: 2,
                at_unix_ms: Date.now() - 10_000,
            }));
            FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'A', state: 'LEADER', current_term: 2 }));
        });

        expect(result.current.nodes['A'].state).toBe('LEADER');
        expect(result.current.nodes['A'].actualState).toBe('LEADER');
    });
});

// ── 3. toggleNodeState ────────────────────────────────────────────────────────

describe('toggleNodeState', () => {
    function setup() {
        const hook = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'B', state: 'FOLLOWER' }));
        });
        return hook;
    }

    it('calls killNode when the node is alive', async () => {
        const { result } = setup();
        await act(async () => { result.current.toggleNodeState('B'); });
        expect(killNode as Mock).toHaveBeenCalledWith('B');
    });

    it('optimistically marks the node DEAD before the REST reply arrives', async () => {
        const { result } = setup();
        await act(async () => { result.current.toggleNodeState('B'); });
        expect(result.current.nodes['B'].state).toBe('DEAD');
    });

    it('keeps actualState backend-authored during optimistic kill', async () => {
        const { result } = setup();
        await act(async () => { result.current.toggleNodeState('B'); });
        expect(result.current.nodes['B'].actualState).toBe('FOLLOWER');
    });

    it('calls restartNode when the node is DEAD', async () => {
        const { result } = setup();
        await act(async () => { result.current.toggleNodeState('B'); }); // kill
        act(() => { FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'B', state: 'DEAD' })); });
        await act(async () => { result.current.toggleNodeState('B'); }); // restart
        expect(restartNode as Mock).toHaveBeenCalledWith('B');
    });

    it('optimistically marks a DEAD node as FOLLOWER on restart', async () => {
        const { result } = setup();
        await act(async () => { result.current.toggleNodeState('B'); }); // kill
        act(() => { FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'B', state: 'DEAD' })); });
        await act(async () => { result.current.toggleNodeState('B'); }); // restart
        expect(result.current.nodes['B'].state).toBe('FOLLOWER');
    });

    it('keeps actualState backend-authored during optimistic restart', async () => {
        const { result } = setup();
        await act(async () => { result.current.toggleNodeState('B'); }); // kill
        act(() => { FakeWebSocket.instances[0].simulateMessage(makeReply({ node_id: 'B', state: 'DEAD' })); });
        await act(async () => { result.current.toggleNodeState('B'); }); // restart
        expect(result.current.nodes['B'].actualState).toBe('DEAD');
    });

    it('does nothing for an unknown node ID', async () => {
        const { result } = setup();
        await act(async () => { result.current.toggleNodeState('Z'); });
        expect(killNode as Mock).not.toHaveBeenCalled();
        expect(restartNode as Mock).not.toHaveBeenCalled();
    });
});

// ── 4. clientRequest ──────────────────────────────────────────────────────────

describe('clientRequest', () => {
    it('calls submitCommand with the command string', async () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        await act(async () => { result.current.clientRequest('SET x=42'); });
        expect(submitCommand as Mock).toHaveBeenCalledWith(
            'SET x=42',
            expect.any(String), // SESSION_ID
            expect.any(Number), // sequenceNum ≥ 1
        );
    });

    it('increments the sequence number on each successive call', async () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        await act(async () => { result.current.clientRequest('SET a=1'); });
        await act(async () => { result.current.clientRequest('SET b=2'); });
        const calls = (submitCommand as Mock).mock.calls;
        const seq1 = calls[0][2] as number;
        const seq2 = calls[1][2] as number;
        expect(seq2).toBe(seq1 + 1);
    });

    it('propagates submitCommand errors to the caller', async () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        (submitCommand as Mock).mockRejectedValueOnce(new Error('submit failed'));
        await expect(result.current.clientRequest('SET z=9')).rejects.toThrow('submit failed');
    });
});

// ── 5. setIsRunning ───────────────────────────────────────────────────────────

describe('setIsRunning', () => {
    it('closes the socket and stops reconnecting when called with false', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => { result.current.setIsRunning(false); });
        expect(result.current.isRunning).toBe(false);
        expect(result.current.status).toBe('disconnected');
        // No new socket should be created after a manual disconnect.
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(FakeWebSocket.instances).toHaveLength(1);
    });
});

// ── 6. control-plane wiring ──────────────────────────────────────────────────

describe('control-plane wiring', () => {
    it('hydrates gateway control snapshots after socket open', async () => {
        renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });

        await act(async () => {
            await Promise.resolve();
        });

        expect(fetchNetEmControl as Mock).toHaveBeenCalledTimes(1);
        expect(fetchChaosControl as Mock).toHaveBeenCalledTimes(1);
    });

    it('setMessageSpeed debounces netem updates and posts mapped latency values', async () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });

        act(() => { result.current.setMessageSpeed(0.05); });
        expect(setNetEmControl as Mock).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(130); });

        expect(setNetEmControl as Mock).toHaveBeenCalledWith({
            latency_ms: 100,
            jitter_ms: 35,
            drop_pct: 0,
        });
    });

    it('setChaosMode posts scheduler toggle payload', async () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });

        act(() => { result.current.setChaosMode(true); });
        await act(async () => {
            await Promise.resolve();
        });

        expect(setChaosControl as Mock).toHaveBeenCalledWith({
            enabled: true,
            interval_ms: 20000,
            down_ms: 12000,
        });
    });
});
