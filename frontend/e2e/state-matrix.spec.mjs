import { expect, test } from '@playwright/test';

const LEADER_SNAPSHOT = [
  {
    node_id: 'A',
    state: 'LEADER',
    current_term: 7,
    voted_for: '',
    commit_index: 3,
    last_applied: 3,
    log: [],
    leader_id: 'A',
    next_index: {},
    match_index: {},
    heartbeat_interval_ms: 50,
    election_timeout_ms: 200,
  },
  {
    node_id: 'B',
    state: 'FOLLOWER',
    current_term: 7,
    voted_for: 'A',
    commit_index: 3,
    last_applied: 3,
    log: [],
    leader_id: 'A',
    next_index: {},
    match_index: {},
    heartbeat_interval_ms: 50,
    election_timeout_ms: 200,
  },
];

const NO_LEADER_SNAPSHOT = [
  {
    node_id: 'A',
    state: 'FOLLOWER',
    current_term: 9,
    voted_for: '',
    commit_index: 3,
    last_applied: 3,
    log: [],
    leader_id: '',
    next_index: {},
    match_index: {},
    heartbeat_interval_ms: 50,
    election_timeout_ms: 200,
  },
  {
    node_id: 'B',
    state: 'FOLLOWER',
    current_term: 9,
    voted_for: '',
    commit_index: 3,
    last_applied: 3,
    log: [],
    leader_id: '',
    next_index: {},
    match_index: {},
    heartbeat_interval_ms: 50,
    election_timeout_ms: 200,
  },
];

function installMockWebSocket(page) {
  return page.addInitScript(() => {
    const instances = [];

    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        this.url = url;
        this.readyState = MockWebSocket.CONNECTING;
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;
        instances.push(this);
      }

      close() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) this.onclose({ type: 'close' });
      }

      send() {}
    }

    window.__raftWsHarness = {
      count() {
        return instances.length;
      },
      open(index = 0) {
        const ws = instances[index];
        if (!ws) return false;
        ws.readyState = MockWebSocket.OPEN;
        if (ws.onopen) ws.onopen({ type: 'open' });
        return true;
      },
      close(index = 0) {
        const ws = instances[index];
        if (!ws) return false;
        ws.readyState = MockWebSocket.CLOSED;
        if (ws.onclose) ws.onclose({ type: 'close' });
        return true;
      },
      message(payload, index = 0) {
        const ws = instances[index];
        if (!ws) return false;
        if (ws.onmessage) ws.onmessage({ data: JSON.stringify(payload) });
        return true;
      },
    };

    window.WebSocket = MockWebSocket;
  });
}

function stubClusterState(page, nodes) {
  return page.route('**/api/cluster/state', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ nodes }),
    }),
  );
}

function stubSubmitCommand(page, status, payload) {
  return page.route('**/api/command', (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    }),
  );
}

async function openGatewaySocket(page) {
  await expect
    .poll(() => page.evaluate(() => window.__raftWsHarness?.count() ?? 0))
    .toBeGreaterThan(0);
  await page.evaluate(() => window.__raftWsHarness.open(0));
}

test('connection state matrix: connecting -> connected', async ({ page }) => {
  await installMockWebSocket(page);
  await stubClusterState(page, LEADER_SNAPSHOT);

  await page.goto('/');
  await expect(page.getByText('Connecting To Raft Gateway')).toBeVisible();

  await openGatewaySocket(page);
  await expect(page.getByText('Gateway Connected')).toBeVisible();
  await expect(page.getByText('Leader N-A Ready')).toBeVisible();
});

test('connection state matrix: reconnecting after socket close', async ({ page }) => {
  await installMockWebSocket(page);
  await stubClusterState(page, LEADER_SNAPSHOT);

  await page.goto('/');
  await openGatewaySocket(page);

  await page.evaluate(() => window.__raftWsHarness.close(0));
  await expect(page.getByText('Gateway Reconnecting')).toBeVisible();
  await expect(page.getByText('Command Path Paused')).toBeVisible();
});

test('command state matrix: no leader available', async ({ page }) => {
  await installMockWebSocket(page);
  await stubClusterState(page, NO_LEADER_SNAPSHOT);

  await page.goto('/');
  await openGatewaySocket(page);

  await expect(page.getByText('Command Path Paused')).toBeVisible();
  await expect(page.getByText('No healthy leader available yet.')).toBeVisible();
});

test('command state matrix: submit success', async ({ page }) => {
  await installMockWebSocket(page);
  await stubClusterState(page, LEADER_SNAPSHOT);
  await stubSubmitCommand(page, 200, { success: true, leader_id: 'A', duplicate: false });

  await page.goto('/');
  await openGatewaySocket(page);

  await page.getByPlaceholder('COMMAND (e.g. SET x=5)').fill('SET x=1');
  await page.getByRole('button', { name: 'Send command to cluster leader' }).click();

  await expect(page.getByText(/Command accepted by N-A/)).toBeVisible();
});

test('command state matrix: submit error', async ({ page }) => {
  await installMockWebSocket(page);
  await stubClusterState(page, LEADER_SNAPSHOT);
  await stubSubmitCommand(page, 503, { error: 'no leader available' });

  await page.goto('/');
  await openGatewaySocket(page);

  await page.getByPlaceholder('COMMAND (e.g. SET x=5)').fill('SET x=2');
  await page.getByRole('button', { name: 'Send command to cluster leader' }).click();

  await expect(page.getByText(/HTTP 503/)).toBeVisible();
});
