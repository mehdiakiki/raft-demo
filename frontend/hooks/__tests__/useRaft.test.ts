// Tests for hooks/useRaft.ts — the WebSocket event-sourcing connector.
//
// Strategy:
//   - Replace global.WebSocket with a FakeWebSocket class
//   - Use @testing-library/react renderHook to render the hook in isolation
//
// In event-sourcing mode:
//   - State telemetry comes from WebSocket
//   - Control/command actions go through gateway REST proxy calls
//   - State is reconstructed from RaftStateEvent messages

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRaft } from '@/hooks/useRaft';
import type { RaftStateEvent } from '@/lib/types';
import * as api from '@/lib/api';

vi.mock('@/lib/api', () => ({
    killNode: vi.fn(),
    restartNode: vi.fn(),
    submitCommand: vi.fn(),
}));

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
    vi.mocked(api.killNode).mockResolvedValue({ node_id: 'A', alive: false });
    vi.mocked(api.restartNode).mockResolvedValue({ node_id: 'A', alive: true });
    vi.mocked(api.submitCommand).mockResolvedValue({
        success: true,
        leader_id: 'A',
        duplicate: false,
        committed: true,
        result: '',
    });
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

    it('shows a candidate visual hold on direct follower-to-leader promotion', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                state: 'FOLLOWER',
                current_term: 1,
                election_timeout_ms: 5000,
                event_time_ms: 1000,
            }));
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                state: 'LEADER',
                current_term: 2,
                event_time_ms: 1200,
            }));
        });

        expect(result.current.nodes['A'].actualState).toBe('LEADER');
        expect(result.current.nodes['A'].state).toBe('CANDIDATE');

        act(() => { vi.advanceTimersByTime(1700); });
        expect(result.current.nodes['A'].state).toBe('LEADER');
    });

    it('keeps timeout progression stable across same-cycle state snapshots', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                state: 'FOLLOWER',
                current_term: 1,
                election_timeout_ms: 5000,
                event_time_ms: 1000,
            }));
        });

        act(() => { vi.advanceTimersByTime(700); });
        const before = result.current.nodes['A'];
        expect(before.electionTimer).toBeGreaterThan(0);
        expect(before.electionTimeout).toBe(5000);

        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                state: 'FOLLOWER',
                current_term: 1,
                election_timeout_ms: 6200,
                event_time_ms: 1200,
            }));
        });

        const after = result.current.nodes['A'];
        expect(after.electionTimer).toBeGreaterThan(0);
        expect(after.electionTimeout).toBe(5000);
    });

    it('preserves candidate visual hold across follower snapshots in same cycle', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                state: 'FOLLOWER',
                current_term: 1,
                election_timeout_ms: 5000,
                event_time_ms: 1000,
            }));
        });

        act(() => { vi.advanceTimersByTime(5100); });
        expect(result.current.nodes['A'].state).toBe('CANDIDATE');

        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                state: 'FOLLOWER',
                current_term: 1,
                election_timeout_ms: 5400,
                event_time_ms: 1400,
            }));
        });

        expect(result.current.nodes['A'].state).toBe('CANDIDATE');
    });
});

// ── 3. Gateway control/command API ───────────────────────────────────────────

describe('gateway control/command API', () => {
    it('toggleNodeState routes follower kill through gateway API', async () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({ node_id: 'B', state: 'FOLLOWER' }));
        });
        await act(async () => { result.current.toggleNodeState('B'); });
        expect(api.killNode).toHaveBeenCalledWith('B');
    });

    it('clientRequest encodes SET and sends submitCommand request', async () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({ node_id: 'A', state: 'LEADER' }));
        });

        const res = await result.current.clientRequest('SET x=1');
        expect(res.success).toBe(true);

        expect(api.submitCommand).toHaveBeenCalledTimes(1);
        const [encoded, clientID, seqNum, leaderID] = vi.mocked(api.submitCommand).mock.calls[0];
        expect(JSON.parse(encoded)).toEqual({ op: 'set', key: 'x', value: '1' });
        expect(clientID).toMatch(/^fe-/);
        expect(seqNum).toBe(1);
        expect(leaderID).toBe('A');
    });

    it('clientRequest rejects unsupported commands before submit', async () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });

        await expect(result.current.clientRequest('INCR x')).rejects.toThrow(/Unsupported command format/);
        expect(api.submitCommand).not.toHaveBeenCalled();
    });
});

// ── 4. Heartbeats visualization ───────────────────────────────────────────────

describe('heartbeats visualization', () => {
    it('generates heartbeat messages when APPEND_ENTRIES RPCs arrive', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({ node_id: 'A', state: 'FOLLOWER' }));
            FakeWebSocket.instances[0].simulateMessage(makeEvent({ node_id: 'B', state: 'FOLLOWER' }));
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'A',
                to_node: 'B',
                rpc_type: 'APPEND_ENTRIES',
                event_time_ms: 1500,
            });
        });
        expect(result.current.heartbeats).toHaveLength(1);
        expect(result.current.heartbeats[0].from).toBe('A');
        expect(result.current.heartbeats[0].to).toBe('B');
    });

    it('removes heartbeats after progress completes', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({ node_id: 'B', state: 'FOLLOWER' }));
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'A',
                to_node: 'B',
                rpc_type: 'APPEND_ENTRIES',
                event_time_ms: 1500,
            });
        });
        expect(result.current.heartbeats.length).toBeGreaterThan(0);
        const before = result.current.heartbeats.length;
        act(() => { vi.advanceTimersByTime(2000); });
        expect(result.current.heartbeats.length).toBeLessThan(before);
    });

    it('resets follower timeout cycle when APPEND_ENTRIES arrives', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                node_id: 'B',
                state: 'FOLLOWER',
                election_timeout_ms: 5000,
                event_time_ms: 1000,
            }));
        });

        act(() => { vi.advanceTimersByTime(500); });
        expect(result.current.nodes['B'].electionTimer).toBeGreaterThan(0);

        act(() => {
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'A',
                to_node: 'B',
                rpc_type: 'APPEND_ENTRIES',
                event_time_ms: 2000,
            });
        });

        expect(result.current.nodes['B'].electionTimer).toBe(0);
        expect(result.current.nodes['B'].electionStartedAt).toBe(2000);
    });

    it('ignores non-heartbeat RPCs for timeout reset', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                node_id: 'B',
                state: 'FOLLOWER',
                election_timeout_ms: 5000,
                event_time_ms: 1000,
            }));
        });

        act(() => { vi.advanceTimersByTime(500); });
        const before = result.current.nodes['B'].electionStartedAt;

        act(() => {
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'A',
                to_node: 'B',
                rpc_type: 'REQUEST_VOTE',
                event_time_ms: 2000,
            });
        });

        expect(result.current.nodes['B'].electionStartedAt).toBe(before);
        expect(result.current.heartbeats).toHaveLength(0);
    });
});

// ── 5. Vote flow visualization ───────────────────────────────────────────────

describe('vote flow visualization', () => {
    it('creates PRE_VOTE packet animations from explicit RPC events', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'A',
                to_node: 'B',
                rpc_type: 'PRE_VOTE',
                rpc_id: 'pv:req:4:A:B',
                term: 4,
                candidate_id: 'A',
                direction: 'SEND',
                event_time_ms: 3900,
            });
        });

        const preVote = result.current.messages.find((m) => m.id === 'pv:req:4:A:B');
        expect(preVote).toMatchObject({
            type: 'PRE_VOTE',
            from: 'A',
            to: 'B',
        });
    });

    it('renders PRE_VOTE_REPLY but does not change real vote tally', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                node_id: 'A',
                state: 'CANDIDATE',
                current_term: 4,
                event_time_ms: 3950,
            }));
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                node_id: 'B',
                state: 'FOLLOWER',
                current_term: 4,
                event_time_ms: 3955,
            }));
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                node_id: 'C',
                state: 'FOLLOWER',
                current_term: 4,
                event_time_ms: 3958,
            }));
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'B',
                to_node: 'A',
                rpc_type: 'PRE_VOTE_REPLY',
                rpc_id: 'pv:reply:4:B:A',
                term: 4,
                candidate_id: 'A',
                vote_granted: false,
                direction: 'SEND',
                event_time_ms: 3960,
            });
        });

        const preVoteReply = result.current.messages.find((m) => m.id === 'pv:reply:4:B:A');
        expect(preVoteReply).toMatchObject({
            type: 'PRE_VOTE_REPLY',
            voteGranted: false,
            from: 'B',
            to: 'A',
        });

        expect(result.current.voteTallies['A']).toMatchObject({
            granted: 1,
            rejected: 0,
            status: 'collecting',
        });
    });

    it('creates REQUEST_VOTE packet animations from explicit RPC events', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'A',
                to_node: 'B',
                rpc_type: 'REQUEST_VOTE',
                rpc_id: 'rv:req:4:A:B',
                term: 4,
                candidate_id: 'A',
                direction: 'SEND',
                event_time_ms: 4000,
            });
        });

        expect(result.current.messages).toHaveLength(1);
        expect(result.current.messages[0]).toMatchObject({
            id: 'rv:req:4:A:B',
            from: 'A',
            to: 'B',
            type: 'REQUEST_VOTE',
        });
    });

    it('deduplicates duplicate vote RPC packets by rpc_id', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'A',
                to_node: 'C',
                rpc_type: 'REQUEST_VOTE',
                rpc_id: 'rv:req:5:A:C',
                term: 5,
                direction: 'SEND',
                event_time_ms: 5000,
            });
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'A',
                to_node: 'C',
                rpc_type: 'REQUEST_VOTE',
                rpc_id: 'rv:req:5:A:C',
                term: 5,
                direction: 'SEND',
                event_time_ms: 5060,
            });
        });

        expect(result.current.messages).toHaveLength(1);
    });

    it('ignores receive-direction duplicates when direction metadata is provided', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'B',
                to_node: 'A',
                rpc_type: 'VOTE_REPLY',
                rpc_id: 'rv:reply:6:B:A',
                term: 6,
                candidate_id: 'A',
                vote_granted: true,
                direction: 'RECEIVE',
                event_time_ms: 6000,
            });
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'B',
                to_node: 'A',
                rpc_type: 'VOTE_REPLY',
                rpc_id: 'rv:reply:6:B:A',
                term: 6,
                candidate_id: 'A',
                vote_granted: true,
                direction: 'SEND',
                event_time_ms: 6010,
            });
        });

        const voteReply = result.current.messages.find((m) => m.type === 'VOTE_REPLY');
        expect(voteReply).toBeDefined();
        expect(voteReply).toMatchObject({
            from: 'B',
            to: 'A',
            voteGranted: true,
        });
    });

    it('tracks candidate vote tallies from explicit vote replies', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                node_id: 'A',
                state: 'CANDIDATE',
                current_term: 3,
                voted_for: 'A',
                event_time_ms: 7000,
            }));
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                node_id: 'B',
                state: 'FOLLOWER',
                current_term: 3,
                event_time_ms: 7050,
            }));
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                node_id: 'C',
                state: 'FOLLOWER',
                current_term: 3,
                event_time_ms: 7100,
            }));
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'B',
                to_node: 'A',
                rpc_type: 'VOTE_REPLY',
                rpc_id: 'rv:reply:3:B:A',
                term: 3,
                candidate_id: 'A',
                vote_granted: true,
                direction: 'SEND',
                event_time_ms: 7150,
            });
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'C',
                to_node: 'A',
                rpc_type: 'VOTE_REPLY',
                rpc_id: 'rv:reply:3:C:A',
                term: 3,
                candidate_id: 'A',
                vote_granted: false,
                direction: 'SEND',
                event_time_ms: 7200,
            });
        });

        expect(result.current.voteTallies['A']).toMatchObject({
            candidateId: 'A',
            term: 3,
            granted: 2,
            rejected: 1,
            quorum: 2,
            status: 'quorum',
        });

        const deniedReply = result.current.messages.find((m) => m.id === 'rv:reply:3:C:A');
        expect(deniedReply).toMatchObject({
            type: 'VOTE_REPLY',
            voteGranted: false,
        });
    });

    it('does not infer granted replies from follower voted_for snapshots', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                node_id: 'A',
                state: 'CANDIDATE',
                current_term: 4,
                event_time_ms: 8000,
            }));
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                node_id: 'B',
                state: 'FOLLOWER',
                current_term: 4,
                voted_for: 'A',
                event_time_ms: 8050,
            }));
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                node_id: 'C',
                state: 'FOLLOWER',
                current_term: 4,
                event_time_ms: 8100,
            }));
        });

        // Only candidate self-vote should be present without explicit VOTE_REPLY.
        expect(result.current.voteTallies['A']).toMatchObject({
            candidateId: 'A',
            term: 4,
            granted: 1,
            rejected: 0,
            status: 'collecting',
        });
    });

    it('keeps split elections in collecting state when no candidate reaches quorum', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => {
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                node_id: 'A',
                state: 'CANDIDATE',
                current_term: 9,
                voted_for: 'A',
                event_time_ms: 9000,
            }));
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                node_id: 'C',
                state: 'CANDIDATE',
                current_term: 9,
                voted_for: 'C',
                event_time_ms: 9005,
            }));
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                node_id: 'B',
                state: 'FOLLOWER',
                current_term: 9,
                event_time_ms: 9010,
            }));
            FakeWebSocket.instances[0].simulateMessage(makeEvent({
                node_id: 'D',
                state: 'FOLLOWER',
                current_term: 9,
                event_time_ms: 9015,
            }));

            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'B',
                to_node: 'A',
                rpc_type: 'VOTE_REPLY',
                rpc_id: 'rv:reply:9:B:A',
                term: 9,
                candidate_id: 'A',
                vote_granted: true,
                direction: 'SEND',
                event_time_ms: 9020,
            });
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'D',
                to_node: 'C',
                rpc_type: 'VOTE_REPLY',
                rpc_id: 'rv:reply:9:D:C',
                term: 9,
                candidate_id: 'C',
                vote_granted: true,
                direction: 'SEND',
                event_time_ms: 9025,
            });
        });

        expect(result.current.voteTallies['A']).toMatchObject({
            candidateId: 'A',
            term: 9,
            granted: 2,
            quorum: 3,
            status: 'collecting',
        });
        expect(result.current.voteTallies['C']).toMatchObject({
            candidateId: 'C',
            term: 9,
            granted: 2,
            quorum: 3,
            status: 'collecting',
        });
    });

    it('does not duplicate replayed vote packets after websocket reconnect when rpc_id is reused', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => { result.current.setMessageSpeed(1); });

        act(() => {
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'A',
                to_node: 'B',
                rpc_type: 'REQUEST_VOTE',
                rpc_id: 'rv:req:11:A:B',
                term: 11,
                candidate_id: 'A',
                direction: 'SEND',
                event_time_ms: 11_000,
            });
        });
        expect(result.current.messages).toHaveLength(1);

        act(() => {
            FakeWebSocket.instances[0].simulateClose();
            vi.advanceTimersByTime(1100);
            FakeWebSocket.instances[1].simulateOpen();
        });

        act(() => {
            FakeWebSocket.instances[1].simulateMessage({
                type: 'rpc',
                from_node: 'A',
                to_node: 'B',
                rpc_type: 'REQUEST_VOTE',
                rpc_id: 'rv:req:11:A:B',
                term: 11,
                candidate_id: 'A',
                direction: 'SEND',
                event_time_ms: 11_050,
            });
        });

        expect(result.current.messages).toHaveLength(1);
    });

    it('uses deterministic fallback dedupe when rpc_id is missing', () => {
        const { result } = renderHook(() => useRaft());
        act(() => { FakeWebSocket.instances[0].simulateOpen(); });
        act(() => { result.current.setMessageSpeed(1); });

        act(() => {
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'A',
                to_node: 'D',
                rpc_type: 'REQUEST_VOTE',
                term: 12,
                candidate_id: 'A',
                direction: 'SEND',
                event_time_ms: 12_000,
            });
            // Same logical event (same fields, same time) should be deduped.
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'A',
                to_node: 'D',
                rpc_type: 'REQUEST_VOTE',
                term: 12,
                candidate_id: 'A',
                direction: 'SEND',
                event_time_ms: 12_000,
            });
        });
        expect(result.current.messages).toHaveLength(1);

        act(() => {
            // Different event_time => distinct fallback identity.
            FakeWebSocket.instances[0].simulateMessage({
                type: 'rpc',
                from_node: 'A',
                to_node: 'D',
                rpc_type: 'REQUEST_VOTE',
                term: 12,
                candidate_id: 'A',
                direction: 'SEND',
                event_time_ms: 12_050,
            });
        });
        expect(result.current.messages).toHaveLength(2);
    });
});

// ── 6. Reset ──────────────────────────────────────────────────────────────────

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
