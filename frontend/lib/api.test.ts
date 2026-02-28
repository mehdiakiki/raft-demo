// Tests for the REST API connector (lib/api.ts).
//
// Every test mocks global.fetch so no real network calls are made.
// We verify that:
//   - The correct URL and HTTP method are used.
//   - The request body matches the expected JSON shape.
//   - The parsed JSON response is returned unchanged.
//   - Non-2xx responses throw with a descriptive message.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchClusterState, submitCommand, killNode, restartNode } from './api';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(String(body)),
  });
}

// ── submitCommand ─────────────────────────────────────────────────────────────

describe('submitCommand', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({ success: true, leader_id: 'A', duplicate: false }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts to /api/command with the correct body', async () => {
    await submitCommand('SET x=1', 'client-1', 42);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/command$/);
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body as string);
    expect(sent).toEqual({ command: 'SET x=1', client_id: 'client-1', sequence_num: 42 });
  });

  it('returns the parsed CommandResult on success', async () => {
    const result = await submitCommand('DEL y', 'client-1', 1);
    expect(result.success).toBe(true);
    expect(result.leader_id).toBe('A');
    expect(result.duplicate).toBe(false);
  });

  it('throws when the gateway returns 503 (no leader)', async () => {
    vi.stubGlobal('fetch', mockFetch('no leader available', 503));
    await expect(submitCommand('SET z=9', 'c', 1)).rejects.toThrow('HTTP 503');
  });
});

// ── killNode ─────────────────────────────────────────────────────────────────

describe('killNode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({ node_id: 'B', alive: false }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts to /api/nodes/{id}/kill', async () => {
    await killNode('B');

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/nodes\/B\/kill$/);
    expect(init.method).toBe('POST');
  });

  it('returns SetAliveResult with alive=false', async () => {
    const result = await killNode('B');
    expect(result.alive).toBe(false);
    expect(result.node_id).toBe('B');
  });

  it('throws when the gateway returns 404 (unknown node)', async () => {
    vi.stubGlobal('fetch', mockFetch('unknown node id', 404));
    await expect(killNode('Z')).rejects.toThrow('HTTP 404');
  });
});

// ── restartNode ───────────────────────────────────────────────────────────────

describe('restartNode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({ node_id: 'C', alive: true }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts to /api/nodes/{id}/restart', async () => {
    await restartNode('C');

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/nodes\/C\/restart$/);
    expect(init.method).toBe('POST');
  });

  it('returns SetAliveResult with alive=true', async () => {
    const result = await restartNode('C');
    expect(result.alive).toBe(true);
  });

  it('throws when the gateway returns 500', async () => {
    vi.stubGlobal('fetch', mockFetch('rpc error', 500));
    await expect(restartNode('C')).rejects.toThrow('HTTP 500');
  });
});

// ── fetchClusterState ──────────────────────────────────────────────────────────

describe('fetchClusterState', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({ nodes: [{ node_id: 'A', state: 'LEADER' }] }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('gets /api/cluster/state', async () => {
    await fetchClusterState();

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/cluster\/state$/);
    expect(init.method).toBe('GET');
  });

  it('returns the parsed cluster snapshot', async () => {
    const result = await fetchClusterState();
    expect(result.nodes).toHaveLength(1);
    expect((result.nodes[0] as { node_id: string }).node_id).toBe('A');
  });

  it('throws on non-2xx responses', async () => {
    vi.stubGlobal('fetch', mockFetch('gateway unavailable', 503));
    await expect(fetchClusterState()).rejects.toThrow('HTTP 503');
  });
});
