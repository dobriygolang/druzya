package intelligence

import (
	"testing"

	"github.com/google/uuid"
)

func TestDailyNoteMemorySnapshotExtractsStructuredSignals(t *testing.T) {
	t.Parallel()
	_, payload, ok := dailyNoteMemorySnapshot(
		uuid.New(),
		"Daily 2026-04-28",
		`Intent: focus on Redis cache invalidation before interview.
Blocker: I am stuck explaining tradeoffs clearly.
Need to write 3 examples and review Postgres consistency notes.`,
	)
	if !ok {
		t.Fatal("snapshot rejected useful daily note")
	}
	if payload["source"] != "today" || payload["snapshot"] != true {
		t.Fatalf("payload source/snapshot=%#v/%#v", payload["source"], payload["snapshot"])
	}
	if payload["intent"] != "focus on Redis cache invalidation before interview" {
		t.Fatalf("intent=%#v", payload["intent"])
	}
	topics, ok := payload["topics"].([]string)
	if !ok {
		t.Fatalf("topics type=%T", payload["topics"])
	}
	for _, want := range []string{"cache-design", "databases", "interview"} {
		if !containsMemoryTopic(topics, want) {
			t.Fatalf("topics=%v missing %q", topics, want)
		}
	}
	blockers, ok := payload["blockers"].([]string)
	if !ok || len(blockers) == 0 {
		t.Fatalf("blockers=%#v", payload["blockers"])
	}
	actions, ok := payload["action_hints"].([]string)
	if !ok || len(actions) == 0 {
		t.Fatalf("action_hints=%#v", payload["action_hints"])
	}
}

func TestDailyNoteMemorySnapshotRejectsTinyNoise(t *testing.T) {
	t.Parallel()
	if _, _, ok := dailyNoteMemorySnapshot(uuid.New(), "Daily 2026-04-28", "ok"); ok {
		t.Fatal("tiny note should not create memory")
	}
}

func containsMemoryTopic(topics []string, want string) bool {
	for _, topic := range topics {
		if topic == want {
			return true
		}
	}
	return false
}
