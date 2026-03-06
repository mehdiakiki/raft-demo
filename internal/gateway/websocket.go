package gateway

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sort"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Hub struct {
	mu          sync.RWMutex
	clients     map[*websocket.Conn]*client
	latestState map[string]json.RawMessage
}

type client struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
}

func NewHub() *Hub {
	return &Hub{
		clients:     make(map[*websocket.Conn]*client),
		latestState: make(map[string]json.RawMessage),
	}
}

func (h *Hub) Broadcast(event any) {
	data, err := json.Marshal(event)
	if err != nil {
		slog.Error("broadcast marshal error", "err", err)
		return
	}

	clients := h.snapshotClients()
	for _, c := range clients {
		if err := c.writeRaw(data); err != nil {
			h.removeClient(c.conn)
		}
	}
}

func (h *Hub) CacheState(nodeID string, event any) {
	data, err := json.Marshal(event)
	if err != nil {
		slog.Error("cache state marshal error", "node", nodeID, "err", err)
		return
	}

	h.mu.Lock()
	h.latestState[nodeID] = append(json.RawMessage(nil), data...)
	h.mu.Unlock()
}

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

	if err := h.replayState(c); err != nil {
		h.removeClient(conn)
		conn.Close()
		slog.Error("websocket replay failed", "remote", conn.RemoteAddr(), "err", err)
		return
	}

	slog.Info("websocket client connected", "remote", conn.RemoteAddr())

	go func() {
		defer func() {
			h.removeClient(conn)
			conn.Close()
			slog.Info("websocket client disconnected", "remote", conn.RemoteAddr())
		}()
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				break
			}
		}
	}()
}

func (h *Hub) snapshotClients() []*client {
	h.mu.RLock()
	defer h.mu.RUnlock()
	clients := make([]*client, 0, len(h.clients))
	for _, c := range h.clients {
		clients = append(clients, c)
	}
	return clients
}

func (h *Hub) removeClient(conn *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, conn)
	h.mu.Unlock()
}

func (h *Hub) replayState(c *client) error {
	for _, msg := range h.snapshotState() {
		if err := c.writeRaw(msg); err != nil {
			return err
		}
	}
	return nil
}

func (h *Hub) snapshotState() [][]byte {
	h.mu.RLock()
	defer h.mu.RUnlock()

	ids := make([]string, 0, len(h.latestState))
	for nodeID := range h.latestState {
		ids = append(ids, nodeID)
	}
	sort.Strings(ids)

	state := make([][]byte, 0, len(ids))
	for _, nodeID := range ids {
		state = append(state, append([]byte(nil), h.latestState[nodeID]...))
	}
	return state
}

func (c *client) writeRaw(data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.WriteMessage(websocket.TextMessage, data)
}
