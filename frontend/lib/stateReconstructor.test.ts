// Tests for the RaftStateReconstructor (lib/stateReconstructor.ts).
//
// We verify that:
//   - Events are correctly applied to build node state
//   - State transitions reset appropriate timers
//   - Multiple events accumulate correctly
//   - getNodes() returns the current state snapshot

import { describe, it, expect, beforeEach } from 'vitest';
import { RaftStateReconstructor } from './stateReconstructor';
import type { RaftStateEvent } from './types';

describe('RaftStateReconstructor', () => {
  let reconstructor: RaftStateReconstructor;

  beforeEach(() => {
    reconstructor = new RaftStateReconstructor();
  });

  describe('applyEvent', () => {
    it('creates a new node from first event', () => {
      const event: RaftStateEvent = {
        node_id: 'node-1',
        state: 'FOLLOWER',
        current_term: 1,
        leader_id: 'node-2',
        event_time_ms: 1000,
      };

      reconstructor.applyEvent(event);
      const nodes = reconstructor.getNodes();

      expect(nodes['node-1']).toBeDefined();
      expect(nodes['node-1'].id).toBe('node-1');
      expect(nodes['node-1'].state).toBe('FOLLOWER');
      expect(nodes['node-1'].term).toBe(1);
      expect(nodes['node-1'].leaderId).toBe('node-2');
    });

    it('updates existing node on subsequent events', () => {
      const event1: RaftStateEvent = {
        node_id: 'node-1',
        state: 'FOLLOWER',
        current_term: 1,
        event_time_ms: 1000,
      };
      const event2: RaftStateEvent = {
        node_id: 'node-1',
        state: 'CANDIDATE',
        current_term: 2,
        event_time_ms: 2000,
      };

      reconstructor.applyEvent(event1);
      reconstructor.applyEvent(event2);
      const nodes = reconstructor.getNodes();

      expect(nodes['node-1'].state).toBe('CANDIDATE');
      expect(nodes['node-1'].term).toBe(2);
    });

    it('resets election timer on state change', () => {
      const event1: RaftStateEvent = {
        node_id: 'node-1',
        state: 'FOLLOWER',
        current_term: 1,
        event_time_ms: 1000,
      };
      
      reconstructor.applyEvent(event1);
      const nodes1 = reconstructor.getNodes();
      nodes1['node-1'].electionTimer = 500;

      const event2: RaftStateEvent = {
        node_id: 'node-1',
        state: 'CANDIDATE',
        current_term: 2,
        event_time_ms: 2000,
      };
      
      reconstructor.applyEvent(event2);
      const nodes2 = reconstructor.getNodes();

      expect(nodes2['node-1'].electionTimer).toBe(0);
      expect(nodes2['node-1'].electionStartedAt).toBeGreaterThan(0);
    });

    it('preserves election timer when state unchanged', () => {
      const event1: RaftStateEvent = {
        node_id: 'node-1',
        state: 'FOLLOWER',
        current_term: 1,
        event_time_ms: 1000,
      };
      
      reconstructor.applyEvent(event1);
      const nodes1 = reconstructor.getNodes();
      nodes1['node-1'].electionTimer = 500;

      const event2: RaftStateEvent = {
        node_id: 'node-1',
        state: 'FOLLOWER',
        current_term: 1,
        commit_index: 10,
        event_time_ms: 2000,
      };
      
      reconstructor.applyEvent(event2);
      const nodes2 = reconstructor.getNodes();

      expect(nodes2['node-1'].electionTimer).toBe(500);
    });

    it('handles partial events (missing fields)', () => {
      const event1: RaftStateEvent = {
        node_id: 'node-1',
        state: 'LEADER',
        current_term: 3,
        event_time_ms: 1000,
      };
      const event2: RaftStateEvent = {
        node_id: 'node-1',
        commit_index: 15,
        event_time_ms: 2000,
      };

      reconstructor.applyEvent(event1);
      reconstructor.applyEvent(event2);
      const nodes = reconstructor.getNodes();

      expect(nodes['node-1'].state).toBe('LEADER');
      expect(nodes['node-1'].term).toBe(3);
      expect(nodes['node-1'].commitIndex).toBe(15);
    });

    it('handles multiple nodes independently', () => {
      const eventA: RaftStateEvent = {
        node_id: 'node-A',
        state: 'LEADER',
        current_term: 2,
        event_time_ms: 1000,
      };
      const eventB: RaftStateEvent = {
        node_id: 'node-B',
        state: 'FOLLOWER',
        current_term: 2,
        leader_id: 'node-A',
        event_time_ms: 1000,
      };

      reconstructor.applyEvent(eventA);
      reconstructor.applyEvent(eventB);
      const nodes = reconstructor.getNodes();

      expect(Object.keys(nodes)).toHaveLength(2);
      expect(nodes['node-A'].state).toBe('LEADER');
      expect(nodes['node-B'].state).toBe('FOLLOWER');
      expect(nodes['node-B'].leaderId).toBe('node-A');
    });
  });

  describe('getEventLog', () => {
    it('returns all applied events in order', () => {
      const event1: RaftStateEvent = {
        node_id: 'node-1',
        state: 'FOLLOWER',
        event_time_ms: 1000,
      };
      const event2: RaftStateEvent = {
        node_id: 'node-1',
        state: 'CANDIDATE',
        event_time_ms: 2000,
      };
      const event3: RaftStateEvent = {
        node_id: 'node-1',
        state: 'LEADER',
        event_time_ms: 3000,
      };

      reconstructor.applyEvent(event1);
      reconstructor.applyEvent(event2);
      reconstructor.applyEvent(event3);

      const log = reconstructor.getEventLog();
      expect(log).toHaveLength(3);
      expect(log[0].state).toBe('FOLLOWER');
      expect(log[1].state).toBe('CANDIDATE');
      expect(log[2].state).toBe('LEADER');
    });

    it('returns a copy of the event log array', () => {
      const event: RaftStateEvent = {
        node_id: 'node-1',
        state: 'FOLLOWER',
        event_time_ms: 1000,
      };

      reconstructor.applyEvent(event);
      const log1 = reconstructor.getEventLog();
      log1.pop();

      const log2 = reconstructor.getEventLog();
      expect(log2).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('resets all state', () => {
      const event: RaftStateEvent = {
        node_id: 'node-1',
        state: 'LEADER',
        current_term: 1,
        event_time_ms: 1000,
      };

      reconstructor.applyEvent(event);
      expect(Object.keys(reconstructor.getNodes())).toHaveLength(1);

      reconstructor.clear();

      expect(Object.keys(reconstructor.getNodes())).toHaveLength(0);
      expect(reconstructor.getEventLog()).toHaveLength(0);
    });
  });

  describe('defaults', () => {
    it('uses default timeout values when not provided', () => {
      const event: RaftStateEvent = {
        node_id: 'node-1',
        state: 'FOLLOWER',
        event_time_ms: 1000,
      };

      reconstructor.applyEvent(event);
      const nodes = reconstructor.getNodes();

      expect(nodes['node-1'].electionTimeout).toBe(8000);
      expect(nodes['node-1'].heartbeatInterval).toBe(2000);
    });

    it('preserves previous timeout values on partial update', () => {
      const event1: RaftStateEvent = {
        node_id: 'node-1',
        state: 'FOLLOWER',
        election_timeout_ms: 5000,
        heartbeat_interval_ms: 1000,
        event_time_ms: 1000,
      };
      const event2: RaftStateEvent = {
        node_id: 'node-1',
        commit_index: 10,
        event_time_ms: 2000,
      };

      reconstructor.applyEvent(event1);
      reconstructor.applyEvent(event2);
      const nodes = reconstructor.getNodes();

      expect(nodes['node-1'].electionTimeout).toBe(5000);
      expect(nodes['node-1'].heartbeatInterval).toBe(1000);
    });
  });
});
