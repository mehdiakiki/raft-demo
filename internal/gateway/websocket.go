package gateway

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Hub struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]*client
}

type client struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[*websocket.Conn]*client),
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

func (c *client) writeRaw(data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.WriteMessage(websocket.TextMessage, data)
}
