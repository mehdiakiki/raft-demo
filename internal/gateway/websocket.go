// Package gateway wires the Raft cluster to the frontend over HTTP and WebSocket.
package gateway

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true }, // allow all origins in dev
}

const (
	// StateTransitionType is the WS message marker for node role transition events.
	StateTransitionType = "state_transition"

	// defaultTransitionHistoryLimit keeps a short replay window for freshly
	// connected WebSocket clients so brief state transitions are still visible.
	defaultTransitionHistoryLimit = 64
)

// StateTransitionEvent is broadcast over WS whenever a node role transition is
// observed by the gateway stream watcher.
type StateTransitionEvent struct {
	Type     string `json:"type"` // always "state_transition"
	NodeID   string `json:"node_id"`
	From     string `json:"from"`
	To       string `json:"to"`
	Term     int64  `json:"term"`
	Inferred bool   `json:"inferred,omitempty"`
	AtUnixMs int64  `json:"at_unix_ms"`
}

// client wraps a WebSocket connection with its own write mutex.
// gorilla/websocket requires that only one goroutine writes to a connection at
// a time, so every WriteMessage call must hold writeMu.
type client struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
}

func (c *client) writeRaw(data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.WriteMessage(websocket.TextMessage, data)
}

// Hub manages WebSocket connections and broadcasts cluster state to all of them.
type Hub struct {
	mu                     sync.RWMutex
	clients                map[*websocket.Conn]*client
	transitionHistory      [][]byte
	transitionHistoryLimit int
}

// NewHub creates an idle Hub.
func NewHub() *Hub {
	return &Hub{
		clients:                make(map[*websocket.Conn]*client),
		transitionHistoryLimit: defaultTransitionHistoryLimit,
	}
}

// ServeWS upgrades an HTTP request to a WebSocket connection and registers
// the client with the hub.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "err", err)
		return
	}

	c := &client{conn: conn}

	h.mu.Lock()
	h.clients[conn] = c
	h.mu.Unlock()

	slog.Info("websocket client connected", "remote", conn.RemoteAddr())

	// Replay recent transitions to help clients that connect after a fast
	// election still see the candidate/leader timeline.
	if err := h.replayTransitionHistory(c); err != nil {
		h.mu.Lock()
		delete(h.clients, conn)
		h.mu.Unlock()
		conn.Close()
		slog.Warn("failed replaying transition history", "remote", conn.RemoteAddr(), "err", err)
		return
	}

	// Block until the client disconnects, then clean up.
	go func() {
		defer func() {
			h.mu.Lock()
			delete(h.clients, conn)
			h.mu.Unlock()
			conn.Close()
			slog.Info("websocket client disconnected", "remote", conn.RemoteAddr())
		}()
		for {
			// We only read to detect disconnects; clients send commands via REST.
			if _, _, err := conn.ReadMessage(); err != nil {
				break
			}
		}
	}()
}

// Broadcast serialises v to JSON and sends it to every connected client.
// Each client write is serialised by its own mutex so concurrent Broadcast
// calls from multiple watchNode goroutines are safe.
// Clients that fail to receive are silently removed.
func (h *Hub) Broadcast(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		slog.Error("broadcast marshal error", "err", err)
		return
	}

	h.recordTransitionFrame(v, data)

	h.mu.RLock()
	clients := make([]*client, 0, len(h.clients))
	for _, c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	var dead []*websocket.Conn
	for _, c := range clients {
		if err := c.writeRaw(data); err != nil {
			dead = append(dead, c.conn)
		}
	}

	if len(dead) > 0 {
		h.mu.Lock()
		for _, conn := range dead {
			delete(h.clients, conn)
			conn.Close()
		}
		h.mu.Unlock()
	}
}

func (h *Hub) recordTransitionFrame(v any, frame []byte) {
	if !isTransitionEvent(v) {
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	limit := h.transitionHistoryLimit
	if limit <= 0 {
		return
	}

	copied := append([]byte(nil), frame...)
	h.transitionHistory = append(h.transitionHistory, copied)
	if len(h.transitionHistory) <= limit {
		return
	}
	start := len(h.transitionHistory) - limit
	h.transitionHistory = append([][]byte(nil), h.transitionHistory[start:]...)
}

func (h *Hub) replayTransitionHistory(c *client) error {
	h.mu.RLock()
	history := make([][]byte, len(h.transitionHistory))
	for i, frame := range h.transitionHistory {
		history[i] = append([]byte(nil), frame...)
	}
	h.mu.RUnlock()

	for _, frame := range history {
		if err := c.writeRaw(frame); err != nil {
			return err
		}
	}
	return nil
}

func isTransitionEvent(v any) bool {
	switch event := v.(type) {
	case StateTransitionEvent:
		return event.Type == StateTransitionType
	case *StateTransitionEvent:
		return event != nil && event.Type == StateTransitionType
	default:
		return false
	}
}

// NewStateTransitionEvent builds a well-formed transition event value.
func NewStateTransitionEvent(nodeID, from, to string, term int64, inferred bool, at time.Time) StateTransitionEvent {
	return StateTransitionEvent{
		Type:     StateTransitionType,
		NodeID:   nodeID,
		From:     from,
		To:       to,
		Term:     term,
		Inferred: inferred,
		AtUnixMs: at.UnixMilli(),
	}
}
