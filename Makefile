SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c

.DEFAULT_GOAL := help

.PHONY: help doctor gateway-test frontend-test dev dev-down dev-logs

DOCKER_COMPOSE := $(shell if command -v docker-compose >/dev/null 2>&1; then echo docker-compose; else echo "docker compose"; fi)
GO_ENV := GOCACHE=$(CURDIR)/.cache/go-build

## doctor: verify demo toolchain
doctor:
	@for tool in go node npm; do \
		if ! command -v $$tool >/dev/null 2>&1; then \
			echo "error: missing '$$tool'"; exit 1; \
		fi; \
		echo "ok: $$tool -> $$(command -v $$tool)"; \
	done

## gateway-test: run gateway backend tests
gateway-test:
	mkdir -p .cache/go-build
	$(GO_ENV) go test -v ./cmd/gateway/... ./internal/gateway/...

## frontend-test: run frontend tests
frontend-test:
	cd frontend && npm test

## dev: start demo stack (expects raft-core node image available)
dev:
	$(DOCKER_COMPOSE) up --build --remove-orphans

## dev-down: stop demo stack
dev-down:
	$(DOCKER_COMPOSE) down --remove-orphans

## dev-logs: tail demo logs
dev-logs:
	$(DOCKER_COMPOSE) logs -f --tail=200

## help: list available targets
help:
	@grep -E '^## ' Makefile | sed 's/## //'
