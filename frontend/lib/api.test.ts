// Tests for the gateway API client (lib/api.ts).
//
// In event-sourcing mode, most REST endpoints are unavailable.
// We verify that:
//   - Functions throw appropriate errors when called
//   - fetchClusterState returns an empty response (placeholder)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchClusterState, submitCommand, killNode, restartNode } from './api';

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(String(body)),
  });
}

describe('submitCommand', () => {
  it('throws error in event-sourcing mode', async () => {
    await expect(submitCommand('SET x=1', 'client-1', 42)).rejects.toThrow(
      'submitCommand not available in event-sourcing mode'
    );
  });
});

describe('killNode', () => {
  it('throws error in event-sourcing mode', async () => {
    await expect(killNode('A')).rejects.toThrow(
      'killNode not available in event-sourcing mode'
    );
  });
});

describe('restartNode', () => {
  it('throws error in event-sourcing mode', async () => {
    await expect(restartNode('A')).rejects.toThrow(
      'restartNode not available in event-sourcing mode'
    );
  });
});

describe('fetchClusterState', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({ status: 'ok' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('calls /health endpoint and returns empty nodes array', async () => {
    const result = await fetchClusterState();

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/health$/);
    expect(init.method).toBe('GET');
    expect(result.nodes).toEqual([]);
  });

  it('throws on non-2xx responses', async () => {
    vi.stubGlobal('fetch', mockFetch('gateway unavailable', 503));
    await expect(fetchClusterState()).rejects.toThrow('HTTP 503');
  });
});
