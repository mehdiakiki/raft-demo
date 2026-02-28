// Tests for lib/config.ts.
//
// Because the module resolves env vars at import time we use vi.resetModules()
// and dynamic import() so each test gets a fresh evaluation of the module with
// different environment variables.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('config', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('uses localhost:8080 as default gatewayBaseURL when env var is absent', async () => {
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_URL', '');
    const { gatewayBaseURL } = await import('./config');
    // An empty string is falsy, so the fallback should apply.
    expect(gatewayBaseURL).toBe('http://localhost:8080')
  });

  it('strips a trailing slash from NEXT_UBLIC_GATEWAY_URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_URL', 'http://gateway:8080/');
    vi.resetModules();
    const { gatewayBaseURL } = await import('./config');
    expect(gatewayBaseURL).toBe('http://gateway:8080');
  });

  it('derives gatewayWSURL from gatewayBaseURL when NEXT_PUBLIC_GATEWAY_WS is absent', async () => {
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_URL', 'http://gateway:8080');
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_WS', '');
    vi.resetModules();
    const { gatewayWSURL } = await import('./config');
    expect(gatewayWSURL).toBe('ws://gateway:8080/ws');
  });

  it('uses NEXT_PUBLIC_GATEWAY_WS verbatim when provided', async () => {
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_WS', 'ws://custom-host:9090/ws');
    vi.resetModules();
    const { gatewayWSURL } = await import('./config');
    expect(gatewayWSURL).toBe('ws://custom-host:9090/ws');
  });
});
