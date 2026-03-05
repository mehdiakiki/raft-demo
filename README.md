# raft-demo

Visualization and integration layer for [`raft-core`](https://github.com/mehdiakiki/raft-core).

<p align="center">
  <img src="https://github.com/user-attachments/assets/3226f666-2a57-458b-91c9-068d8ad64556" alt="Raft Demo Screenshot" width="860" />
</p>

This repository contains:

- Go gateway (gRPC receiver + WebSocket fanout)
- Next.js frontend visualizer
- Demo Docker Compose topology

It intentionally does **not** own protocol logic. Consensus source of truth is [`raft-core`](https://github.com/mehdiakiki/raft-core).

## Architecture

```
┌──────────────┐    PushState()    ┌──────────────┐
│  Raft Nodes  │ ─────────────────►│   Gateway    │
│ (gRPC client)│                    │ (gRPC server│
│              │                    │ + WebSocket)│
└──────────────┘                    └──────┬───────┘
                                           │
                    WebSocket broadcast    │
                                           ▼
                                    ┌─────────────┐
                                    │   Frontend  │
                                    │ (state      │
                                    │  reconstructor)│
                                    └─────────────┘
```

**Event-sourcing mode:** Raft nodes push state changes to the gateway via `PushState()` gRPC. The gateway broadcasts events to connected WebSocket clients. The frontend reconstructs cluster state from the event stream.

## Layout

- `cmd/gateway` — gateway binary entrypoint
- `internal/gateway` — gRPC receiver and WebSocket hub
- `frontend` — Next.js UI with state reconstructor
- `docker-compose.yml` — demo topology

## Dependency contract

`raft-demo` depends on a tagged `raft-core` release.

Current expected baseline:

- `github.com/mehdiakiki/raft-core v0.1.1`

If you are bootstrapping both repos locally before first tag, use one of:

1. `go work use ../raft-core` (preferred)
2. temporary `replace github.com/mehdiakiki/raft-core => ../raft-core` in `go.mod`

## Local development

```bash
make doctor
make gateway-test
cd frontend && npm install && npm run dev
```

## Make targets

- `make doctor` - verify required local tools (`go`, `node`, `npm`).
- `make gateway-test` - run Go tests for gateway.
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

## Node configuration

Nodes must be configured with the `--gateway` flag to push state events:

```bash
node --id=A --addr=:60051 --peers=B=node-b:60052 --gateway=gateway:50051
```

## Gateway flags

```bash
gateway --http-addr=:8080 --grpc-addr=:50051 --log-level=debug
```

- `--http-addr` — HTTP/WebSocket listen address
- `--grpc-addr` — gRPC listen address (nodes push here)
- `--log-level` — log verbosity (debug, info, warn, error)

## Demo timing note

Election timeout in this demo is intentionally slower than a production profile.

Reason: it makes leader-election transitions visible and keeps the visualization stable for learning/debugging; fast real-world timings can look abrupt or janky in UI playback.

For production protocol tuning, use the `raft-core` configuration defaults and environment-appropriate timeout values.

## License

MIT. See [LICENSE](LICENSE).
