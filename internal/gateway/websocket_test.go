package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestHub_ReplaysCachedStateOnConnect(t *testing.T) {
	hub := NewHub()
	hub.CacheState("B", map[string]any{
		"node_id": "B",
		"state":   "FOLLOWER",
	})
	hub.CacheState("A", map[string]any{
		"node_id": "A",
		"state":   "LEADER",
	})

	server := httptest.NewServer(http.HandlerFunc(hub.ServeWS))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer conn.Close()

	if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline failed: %v", err)
	}

	var messages []map[string]any
	for i := 0; i < 2; i++ {
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("ReadMessage %d failed: %v", i, err)
		}

		var payload map[string]any
		if err := json.Unmarshal(data, &payload); err != nil {
			t.Fatalf("Unmarshal %d failed: %v", i, err)
		}
		messages = append(messages, payload)
	}

	if messages[0]["node_id"] != "A" || messages[0]["state"] != "LEADER" {
		t.Fatalf("unexpected first replayed state: %#v", messages[0])
	}
	if messages[1]["node_id"] != "B" || messages[1]["state"] != "FOLLOWER" {
		t.Fatalf("unexpected second replayed state: %#v", messages[1])
	}
}
