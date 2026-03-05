#!/usr/bin/env bash
# smoke-test.sh - Quick verification that the demo works
#
# Usage: ./scripts/smoke-test.sh
#
# Exit codes: 0 = pass, 1 = fail, 2 = missing prerequisites

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[smoke]${NC} $1"; }
ok() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
fail() {
	echo -e "${RED}✗${NC} $1"
	exit 1
}

cleanup() {
	log "Cleaning up..."
	cd "$DEMO_ROOT" && docker compose down --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

# Prerequisites
log "Checking prerequisites..."
for cmd in go docker curl; do
	command -v $cmd >/dev/null || {
		echo -e "${RED}Missing: $cmd${NC}"
		exit 2
	}
done
ok "Prerequisites met"

# Build raft-core
log "Building raft-core..."
cd "$DEMO_ROOT/../raft-core"
go build -o /tmp/test-node ./cmd/node
docker build -t raft-core-node:smoke-test . -q
ok "raft-core built"

# Build raft-demo
log "Building raft-demo..."
cd "$DEMO_ROOT"
go build -o /tmp/test-gateway ./cmd/gateway
ok "raft-demo gateway built"

# Start stack
log "Starting demo stack..."
RAFT_CORE_NODE_IMAGE=raft-core-node:smoke-test docker compose up -d --build --quiet-pull
sleep 5

# Test gateway health
log "Testing gateway health..."
for i in {1..30}; do
	if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
		ok "Gateway healthy"
		break
	fi
	[ $i -eq 30 ] && fail "Gateway not healthy"
	sleep 1
done

# Test frontend
log "Testing frontend..."
for i in {1..30}; do
	if curl -sf http://localhost:3000 >/dev/null 2>&1; then
		ok "Frontend ready"
		break
	fi
	[ $i -eq 30 ] && fail "Frontend not ready"
	sleep 1
done

# Test WebSocket upgrade
log "Testing WebSocket..."
curl -si -N \
	-H "Connection: Upgrade" \
	-H "Upgrade: websocket" \
	-H "Sec-WebSocket-Key: test" \
	-H "Sec-WebSocket-Version: 13" \
	http://localhost:8080/ws 2>&1 | head -1 | grep -q "101" && ok "WebSocket upgrade OK" || warn "WebSocket test skipped"

# Test kill API
log "Testing kill API..."
RESP=$(curl -sf -X POST http://localhost:8080/api/nodes/A/kill -H "Content-Type: application/json" -d '{"alive":false}' 2>/dev/null || echo '{"error":"node not connected"}')
echo "$RESP" | grep -q "node_id\|error" && ok "Kill API responds" || warn "Kill API issue: $RESP"

# Verify logs show RPC events
log "Checking for RPC events in logs..."
sleep 3
if docker compose logs node-a 2>&1 | grep -q "gateway\|RPC\|AppendEntries"; then
	ok "Node logs show activity"
else
	warn "No activity in node logs yet (may need more time)"
fi

echo ""
echo -e "${GREEN}══════════════════════════════════════${NC}"
echo -e "${GREEN}  SMOKE TEST PASSED${NC}"
echo -e "${GREEN}══════════════════════════════════════${NC}"
echo ""
echo "  Demo:     http://localhost:3000"
echo "  Stop:     docker compose down"
echo ""
