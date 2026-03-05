#!/usr/bin/env bash
# dev.sh - Start development environment
#
# Usage:
#   ./scripts/dev.sh              # Start everything
#   ./scripts/dev.sh --no-build   # Start without rebuilding
#   ./scripts/dev.sh --logs       # Start and follow logs
#   ./scripts/dev.sh stop         # Stop everything
#   ./scripts/dev.sh restart      # Restart everything
#   ./scripts/dev.sh status       # Check status
#
# This handles:
#   - Building raft-core node image (if needed)
#   - Building raft-demo gateway + frontend (if needed)
#   - Starting docker-compose stack
#   - Opening browser to demo
#   - Following logs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RAFT_CORE_ROOT="$(cd "$DEMO_ROOT/../raft-core" 2>/dev/null && pwd || echo '')"

NO_BUILD="${NO_BUILD:-}"
FOLLOW_LOGS="${FOLLOW_LOGS:-}"
COMMAND="${1:-}"
shift || true

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${BLUE}[dev]${NC} $1"; }
ok() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
die() {
	echo -e "${RED}✗${NC} $1"
	exit 1
}

needs_raft_core() {
	# Check if raft-core image exists
	if docker image inspect raft-core-node:dev >/dev/null 2>&1; then
		return 1
	fi
	return 0
}

build_raft_core() {
	if [ -z "$RAFT_CORE_ROOT" ]; then
		die "raft-core not found at ../raft-core"
	fi

	log "Building raft-core node image..."
	cd "$RAFT_CORE_ROOT"
	docker build -t raft-core-node:dev . 2>&1 | grep -E "^(Step|Successfully)" | tail -5
	ok "raft-core image built"
}

build_demo() {
	log "Building raft-demo..."
	cd "$DEMO_ROOT"

	# Build gateway
	go build -o /tmp/raft-demo-gateway ./cmd/gateway 2>&1 | tail -3 || true

	# Build frontend (only if needed)
	if [ ! -d "frontend/.next" ] || [ "frontend/package.json" -nt "frontend/.next" ]; then
		cd frontend
		npm install --silent 2>&1 | tail -3 || true
		npm run build >/dev/null 2>&1
		cd ..
	fi

	ok "raft-demo built"
}

start_stack() {
	cd "$DEMO_ROOT"

	# Check if already running
	if docker compose ps -q 2>/dev/null | grep -q .; then
		warn "Stack already running. Use 'dev.sh restart' to restart."
		return 0
	fi

	log "Starting stack..."
	RAFT_CORE_NODE_IMAGE=raft-core-node:dev docker compose up -d --build 2>&1 | tail -5

	# Wait for healthy
	log "Waiting for services..."
	for i in {1..60}; do
		if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
			break
		fi
		if [ $i -eq 60 ]; then
			die "Gateway did not start"
		fi
		sleep 1
	done

	for i in {1..60}; do
		if curl -sf http://localhost:3000 >/dev/null 2>&1; then
			break
		fi
		if [ $i -eq 60 ]; then
			die "Frontend did not start"
		fi
		sleep 1
	done

	ok "All services healthy"
}

show_status() {
	cd "$DEMO_ROOT"

	echo ""
	echo -e "${GREEN}═══════════════════════════════════════════${NC}"
	echo -e "${GREEN}  Raft Demo - Development Environment${NC}"
	echo -e "${GREEN}═══════════════════════════════════════════${NC}"
	echo ""

	# Check services
	GATEWAY_STATUS="down"
	FRONTEND_STATUS="down"

	if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
		GATEWAY_STATUS="up"
	fi
	if curl -sf http://localhost:3000 >/dev/null 2>&1; then
		FRONTEND_STATUS="up"
	fi

	echo "  Services:"
	echo "    Gateway:  $GATEWAY_STATUS (http://localhost:8080)"
	echo "    Frontend: $FRONTEND_STATUS (http://localhost:3000)"
	echo ""

	# Show containers
	echo "  Containers:"
	docker compose ps 2>/dev/null | tail -n +2 | while read -r line; do
		echo "    $line"
	done || echo "    (none running)"
	echo ""

	# Show quick commands
	echo "  Quick commands:"
	echo "    ./scripts/dev.sh logs    - Follow logs"
	echo "    ./scripts/dev.sh stop    - Stop stack"
	echo "    ./scripts/dev.sh restart - Restart stack"
	echo ""
}

follow_logs() {
	cd "$DEMO_ROOT"
	docker compose logs -f --tail=100
}

stop_stack() {
	cd "$DEMO_ROOT"
	log "Stopping stack..."
	docker compose down --remove-orphans 2>&1 | tail -3
	ok "Stack stopped"
}

open_browser() {
	log "Opening browser..."
	xdg-open http://localhost:3000 2>/dev/null ||
		open http://localhost:3000 2>/dev/null ||
		echo "    Open http://localhost:3000 manually"
}

# Parse command
case "$COMMAND" in
stop | down)
	stop_stack
	;;
restart)
	stop_stack
	sleep 2
	NO_BUILD=1
	start_stack
	show_status
	;;
status | ps)
	show_status
	;;
logs | log)
	follow_logs
	;;
build)
	if needs_raft_core; then
		build_raft_core
	else
		ok "raft-core image already exists"
	fi
	build_demo
	;;
--no-build)
	NO_BUILD=1
	;;&
--logs)
	FOLLOW_LOGS=1
	;;&
"" | start | up | --no-build | --logs)
	# Build if needed
	if [ -z "$NO_BUILD" ]; then
		if needs_raft_core; then
			build_raft_core
		fi
		build_demo
	fi

	start_stack
	show_status
	open_browser

	if [ -n "$FOLLOW_LOGS" ]; then
		follow_logs
	fi
	;;
*)
	echo "Usage: $0 [start|stop|restart|status|logs|build]"
	echo ""
	echo "Options:"
	echo "  --no-build  Skip building"
	echo "  --logs      Follow logs after starting"
	exit 1
	;;
esac
