// Package config exposes the gateway URLs used by all frontend modules.
//
// Values are resolved once from environment variables so the rest of the
// codebase never reads process.env directly.

// gatewayBaseURL is the base URL for all REST API calls (no trailing slash).
// Falls back to localhost:8080 for local `npm run dev` without Docker.
export const gatewayBaseURL: string =
  process.env.NEXT_PUBLIC_GATEWAY_URL?.replace(/\/$/, '') || 'http://localhost:8080';

// gatewayWSURL is the WebSocket endpoint that streams NodeStateUpdate messages.
// Falls back to the ws:// equivalent of gatewayBaseURL/ws.
// Uses || (falsy check) so an empty string env var is treated as absent.
export const gatewayWSURL: string =
  process.env.NEXT_PUBLIC_GATEWAY_WS ||
  gatewayBaseURL.replace(/^http/, 'ws') + '/ws';
