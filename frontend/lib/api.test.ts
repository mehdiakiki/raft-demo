import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchClusterState, killNode, restartNode, submitCommand } from './api';

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(String(body)),
  });
}

describe('submitCommand', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({
      success: true,
      leader_id: 'A',
      duplicate: false,
      committed: true,
      result: '',
      routed_node: 'A',
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('POSTs /api/commands and returns gateway response', async () => {
    const result = await submitCommand('{"op":"set","key":"x","value":"1"}', 'client-1', 42, 'A');

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/commands$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      command: '{"op":"set","key":"x","value":"1"}',
      client_id: 'client-1',
      sequence_num: 42,
      leader_id: 'A',
    });
    expect(result.success).toBe(true);
    expect(result.leader_id).toBe('A');
    expect(result.duplicate).toBe(false);
    expect(result.committed).toBe(true);
    expect(result.result).toBe('');
    expect(result.routed_node).toBe('A');
  });

  it('throws on non-2xx responses', async () => {
    vi.stubGlobal('fetch', mockFetch('bad gateway', 502));
    await expect(submitCommand('x', 'c', 1)).rejects.toThrow('submitCommand: HTTP 502');
  });
});

describe('killNode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({ node_id: 'A', alive: false }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('POSTs /api/nodes/{id}/kill', async () => {
    const result = await killNode('A');
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/nodes\/A\/kill$/);
    expect(init.method).toBe('POST');
    expect(result).toEqual({ node_id: 'A', alive: false });
  });
});

describe('restartNode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({ node_id: 'A', alive: true }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('POSTs /api/nodes/{id}/restart', async () => {
    const result = await restartNode('A');
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/nodes\/A\/restart$/);
    expect(init.method).toBe('POST');
    expect(result).toEqual({ node_id: 'A', alive: true });
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
    await expect(fetchClusterState()).rejects.toThrow('fetchClusterState: HTTP 503');
  });
});
