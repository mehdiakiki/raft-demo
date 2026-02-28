package gateway

import "testing"

func TestRecordTransitionFrame_IgnoresNonTransitionMessages(t *testing.T) {
	hub := NewHub()
	hub.recordTransitionFrame(map[string]any{"node_id": "A"}, []byte(`{"node_id":"A"}`))

	if len(hub.transitionHistory) != 0 {
		t.Fatalf("expected no transition frames to be stored, got %d", len(hub.transitionHistory))
	}
}

func TestRecordTransitionFrame_BoundsHistoryAndCopiesFrames(t *testing.T) {
	hub := NewHub()
	hub.transitionHistoryLimit = 2

	frameA := []byte(`{"type":"state_transition","node_id":"A","to":"CANDIDATE"}`)
	frameB := []byte(`{"type":"state_transition","node_id":"A","to":"LEADER"}`)
	frameC := []byte(`{"type":"state_transition","node_id":"B","to":"CANDIDATE"}`)

	event := StateTransitionEvent{Type: StateTransitionType}
	hub.recordTransitionFrame(event, frameA)
	hub.recordTransitionFrame(event, frameB)
	hub.recordTransitionFrame(event, frameC)

	if len(hub.transitionHistory) != 2 {
		t.Fatalf("expected bounded history length 2, got %d", len(hub.transitionHistory))
	}
	if string(hub.transitionHistory[0]) != string(frameB) {
		t.Fatalf("expected oldest retained frame to be B, got %s", string(hub.transitionHistory[0]))
	}
	if string(hub.transitionHistory[1]) != string(frameC) {
		t.Fatalf("expected newest retained frame to be C, got %s", string(hub.transitionHistory[1]))
	}

	// Ensure history stores independent copies.
	frameC[0] = 'X'
	if string(hub.transitionHistory[1]) != `{"type":"state_transition","node_id":"B","to":"CANDIDATE"}` {
		t.Fatalf("stored history frame was mutated through caller slice")
	}
}
