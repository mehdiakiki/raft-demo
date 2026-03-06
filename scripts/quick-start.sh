#!/usr/bin/env bash
# quick-start.sh - One command to build and run the demo
#
# This script:
# 1. Builds raft-core node image
# 2. Builds raft-demo gateway and frontend
# 3. Starts everything with docker-compose
# 4. Opens browser to the demo
#
# Usage: ./scripts/quick-start.sh [--no-browser]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RAFT_CORE_ROOT="$(cd "$DEMO_ROOT/../raft-core" 2>/dev/null && pwd || echo '')"

NO_BROWSER="${1:-}"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[quick-start]${NC} $1"; }
ok() { echo -e "${GREEN}✓${NC} $1"; }
die() {
	echo -e "${RED}✗${NC} $1"
	exit 1
}

# Check prerequisites
log "Checking prerequisites..."
for cmd in go docker npm; do
	command -v $cmd >/dev/null || die "Missing: $cmd"
done
ok "All tools available"

# Find raft-core
if [ -z "$RAFT_CORE_ROOT" ]; then
	die "Could not find raft-core at ../raft-core. Please clone it first."
fi

# Build raft-core node image
log "Building raft-core node image..."
cd "$RAFT_CORE_ROOT"
docker build -t raft-core-node:local . 2>&1 | tail -5
ok "raft-core node image built"

# Build raft-demo
log "Building raft-demo..."
cd "$DEMO_ROOT"
go build -o /tmp/raft-demo-gateway ./cmd/gateway
cd frontend && npm install --silent 2>&1 | tail -3
npm run build >/dev/null 2>&1
ok "raft-demo built"

# Stop any existing stack
log "Stopping existing stack..."
docker compose down --remove-orphans 2>/dev/null || true

# Start stack
log "Starting demo stack..."
RAFT_CORE_NODE_IMAGE=raft-core-node:local docker compose up -d --build 2>&1 | tail -5

# Wait for healthy
log "Waiting for services..."
for i in {1..30}; do
	if curl -s http://localhost:8080/health >/dev/null 2>&1 &&
		curl -s http://localhost:3000 >/dev/null 2>&1; then
		break
	fi
	sleep 1
done
ok "All services healthy"

echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  Raft Demo is running!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
echo "  Frontend:    http://localhost:3000"
echo "  Gateway API: http://localhost:8080"
echo "  WebSocket:   ws://localhost:8080/ws"
echo ""
echo "  To stop:     docker compose down"
echo "  To see logs: docker compose logs -f"
echo ""

# Open browser
if [ -z "$NO_BROWSER" ]; then
	log "Opening browser..."
	xdg-open http://localhost:3000 2>/dev/null ||
		open http://localhost:3000 2>/dev/null ||
		echo "Please open http://localhost:3000 manually"
fi

# Show logs
docker compose logs -f --tail=50
