SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c

.DEFAULT_GOAL := help

.PHONY: help doctor test dev dev-up dev-down dev-logs dev-status dev-restart quick clean rebuild smoke-test watch

DOCKER_COMPOSE := $(shell if command -v docker-compose >/dev/null 2>&1; then echo docker-compose; else echo "docker compose"; fi)

## doctor: verify all required tools
doctor:
	@for tool in go docker node npm curl; do \
		if ! command -v $$tool >/dev/null 2>&1; then \
			echo "❌ Missing: $$tool"; exit 1; \
		fi; \
		echo "✓ $$tool"; \
	done

## test: run all unit tests
test:
	go test ./cmd/... ./internal/...
	cd frontend && npm test -- --run

## dev: start development environment
dev:
	@./scripts/dev.sh

## dev-up: alias for dev
dev-up: dev

## dev-down: stop development stack
dev-down:
	@./scripts/dev.sh stop

## dev-logs: follow development logs
dev-logs:
	@./scripts/dev.sh logs

## dev-status: show status
dev-status:
	@./scripts/dev.sh status

## dev-restart: restart stack
dev-restart:
	@./scripts/dev.sh restart

## quick: quick start (builds everything, opens browser)
quick:
	@./scripts/quick-start.sh

## smoke-test: verify everything works end-to-end
smoke-test:
	@./scripts/smoke-test.sh

## clean: remove all artifacts
clean:
	rm -rf .cache frontend/.next frontend/node_modules
	$(DOCKER_COMPOSE) down -v --remove-orphans 2>/dev/null || true
	docker rmi raft-demo-gateway raft-demo-frontend raft-core-node:dev 2>/dev/null || true

## rebuild: clean rebuild from scratch
rebuild: clean dev

## watch: watch for changes and run tests
watch:
	@which entr >/dev/null || (echo "Install entr first: apt install entr" && exit 1)
	find . -name "*.go" -o -name "*.ts" -o -name "*.tsx" | entr -c $(MAKE) test

## help: show this help
help:
	@echo "Raft Demo - Development Commands"
	@echo ""
	@echo "  make dev        Start development (builds + runs everything)"
	@echo "  make dev-logs   Follow logs"
	@echo "  make dev-down   Stop"
	@echo "  make test       Run unit tests"
	@echo "  make smoke-test Full stack verification"
	@echo "  make clean      Remove artifacts"
