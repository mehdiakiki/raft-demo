# raft-demo

Visualization and integration layer for [`raft-core`](https://github.com/mehdiakiki/raft-core).

This repository contains:

- Go gateway (HTTP + WebSocket fanout)
- Next.js frontend visualizer
- Demo Docker Compose topology

It intentionally does **not** own protocol logic. Consensus source of truth is [`raft-core`](https://github.com/mehdiakiki/raft-core).

## Layout

- `cmd/gateway` — gateway binary entrypoint
- `internal/gateway` — REST and websocket hub
- `frontend` — Next.js UI
- `docker-compose.yml` — demo topology

## Dependency contract

`raft-demo` depends on a tagged `raft-core` release.

Current expected baseline:

- `github.com/medvih/raft-core v0.1.0`

If you are bootstrapping both repos locally before first tag, use one of:

1. `go work use ../raft-core` (preferred)
2. temporary `replace github.com/medvih/raft-core => ../raft-core` in `go.mod`

## Local development

```bash
make doctor
make gateway-test
cd frontend && npm install && npm run dev
```

## Make targets

- `make doctor` - verify required local tools (`go`, `node`, `npm`).
- `make gateway-test` - run Go tests for gateway entrypoints and handlers.
- `make frontend-test` - run frontend test suite (`npm test`).
- `make dev` - start demo stack with Docker Compose (nodes, gateway, frontend).
- `make dev-down` - stop and remove the demo stack.
- `make dev-logs` - follow container logs for troubleshooting.
- `make help` - list available targets.

## Full demo stack

```bash
# Requires a published raft-core node image, or override RAFT_CORE_NODE_IMAGE.
make dev
```

To use a specific node image:

```bash
RAFT_CORE_NODE_IMAGE=ghcr.io/medvih/raft-core-node:<tag> make dev
```

## Demo timing note

Election timeout in this demo is intentionally slower than a production profile.

Reason: it makes leader-election transitions visible and keeps the visualization stable for learning/debugging; fast real-world timings can look abrupt or janky in UI playback.

For production protocol tuning, use the `raft-core` configuration defaults and environment-appropriate timeout values.

## License

MIT. See [LICENSE](LICENSE).
