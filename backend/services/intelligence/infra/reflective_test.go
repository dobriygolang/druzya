// Phase 4.1 — reflective two-stage brief synthesiser tests.
//
// Mocks ChatClient with a queue of responses so we can drive sketch /
// critique pairs deterministically, then assert on:
//   - call count (1 = sketch only, 2 = sketch + critique),
//   - which brief surfaces (sketch vs refined),
//   - severity gate (cruise/nudge skip critique),
//   - feature flag gate (Reflective=false skips critique even on warn).
package infra

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"druz9/intelligence/domain"
	"druz9/shared/pkg/llmchain"

	"github.com/google/uuid"
)

// queuedChat returns canned responses in order; on overrun it returns the
// configured tail-error so a missed expectation is loud, not silent.
type queuedChat struct {
	t        *testing.T
	queue    []llmchain.Response
	errAfter error // returned when queue is empty
	calls    []llmchain.Request
}

func (q *queuedChat) Chat(_ context.Context, req llmchain.Request) (llmchain.Response, error) {
	q.calls = append(q.calls, req)
	if len(q.queue) == 0 {
		if q.errAfter == nil {
			q.t.Fatalf("queuedChat: unexpected extra call (#%d)", len(q.calls))
		}
		return llmchain.Response{}, q.errAfter
	}
	resp := q.queue[0]
	q.queue = q.queue[1:]
	return resp, nil
}

func (q *queuedChat) ChatStream(_ context.Context, _ llmchain.Request) (<-chan llmchain.StreamEvent, error) {
	return nil, errors.New("queuedChat: streaming not used in reflective tests")
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError}))
}

// criticalInput — BriefPromptInput that deriveSeverity grades as critical
// (4× same plan item skipped). Used wherever we want a warn/critical-grade
// gate to fire. Calendar pivot 2026-05-04: previously this used an
// upcoming interview signal, now driven by the skipped-item branch.
func criticalInput() domain.BriefPromptInput {
	today := time.Date(2026, 4, 30, 0, 0, 0, 0, time.UTC)
	return domain.BriefPromptInput{
		UserID: uuid.New(),
		Today:  today,
		SkippedRecent: []domain.SkippedPlanItem{
			{ItemID: "p1", SkillKey: "prefix-sum", Title: "Review prefix-sum patterns"},
			{ItemID: "p2", SkillKey: "prefix-sum", Title: "Review prefix-sum patterns"},
			{ItemID: "p3", SkillKey: "prefix-sum", Title: "Review prefix-sum patterns"},
			{ItemID: "p4", SkillKey: "prefix-sum", Title: "Review prefix-sum patterns"},
		},
		FocusDays: []domain.FocusDay{{Day: today.AddDate(0, 0, -1), Seconds: 3600, Pomodoros: 2}},
	}
}

// cruiseInput — BriefPromptInput with no critical signals (no interviews,
// healthy focus). deriveSeverity returns cruise.
func cruiseInput() domain.BriefPromptInput {
	today := time.Date(2026, 4, 30, 0, 0, 0, 0, time.UTC)
	return domain.BriefPromptInput{
		UserID: uuid.New(),
		Today:  today,
		FocusDays: []domain.FocusDay{
			{Day: today.AddDate(0, 0, -2), Seconds: 5400, Pomodoros: 3},
			{Day: today.AddDate(0, 0, -1), Seconds: 4800, Pomodoros: 3},
		},
	}
}

// briefSketch / briefRefined — JSON-encoded briefs that always parse
// cleanly. Headlines include the deterministic critical-anchor
// ("Skipped Review prefix-sum patterns") so pinCriticalHeadline leaves
// them intact and lets the test distinguish sketch vs refined by the
// distinct trailing fragment.
const briefSketch = `{"headline":"Skipped Review prefix-sum patterns 4× — sketch wall.","narrative":"You skipped the same prefix-sum review 4 times in the last 14 days. Today's lever: open the doc and read just the first paragraph.","recommendations":[{"kind":"tiny_task","title":"Solve one capacity-estimation back-of-envelope problem.","rationale":"Listed as weak_topic in last mock; ties into the prefix-sum review you keep skipping.","target_id":""},{"kind":"schedule","title":"Run a system_design mock today, focus on capacity-estimation.","rationale":"Mock weak_topic + 4 skipped reviews = closing the loop matters today.","target_id":""},{"kind":"tiny_task","title":"Read [caching patterns](/codex?topic=system_design&article=caching-strategies) and write 3 takeaways.","rationale":"Weak_topic capacity-estimation overlaps caching primitives.","target_id":""}]}`

const briefRefined = `{"headline":"Skipped Review prefix-sum patterns 4× — refined push.","narrative":"You skipped the same prefix-sum review 4 times. Refined plan: shrink the first step to one paragraph, then drill capacity-estimation off the back of it.","recommendations":[{"kind":"tiny_task","title":"Solve one capacity-estimation back-of-envelope drill (60s users, 1KB row).","rationale":"Capacity-estimation flagged weak; refined version cites concrete inputs.","target_id":""},{"kind":"schedule","title":"Run a system_design mock today, force a capacity-heavy prompt.","rationale":"Need a second data point under pressure; refined emphasis on the cache-heavy prompt.","target_id":""},{"kind":"tiny_task","title":"Memorise Latency Numbers Every Programmer Should Know.","rationale":"Capacity-estimation rationale needs these constants live.","target_id":""}]}`

// ── tests ─────────────────────────────────────────────────────────────────

func TestSynthesise_CruiseSkipsReflectionEvenWhenEnabled(t *testing.T) {
	chat := &queuedChat{
		t:        t,
		queue:    []llmchain.Response{{Content: briefSketch}},
		errAfter: errors.New("no extra calls expected on cruise"),
	}
	cfg := StaticCoachConfigReader{Reflective: true}
	s := NewLLMChainBriefSynthesiser(chat, cfg, quietLogger())

	got, err := s.Synthesise(context.Background(), cruiseInput())
	if err != nil {
		t.Fatalf("Synthesise: %v", err)
	}
	if len(chat.calls) != 1 {
		t.Fatalf("expected 1 chat call (sketch only), got %d", len(chat.calls))
	}
	if got.Severity != domain.InsightSeverityCruise {
		t.Fatalf("expected cruise severity on healthy input, got %q", got.Severity)
	}
}

func TestSynthesise_CriticalReflectsWhenEnabled(t *testing.T) {
	chat := &queuedChat{
		t: t,
		queue: []llmchain.Response{
			{Content: briefSketch},
			{Content: briefRefined},
		},
	}
	cfg := StaticCoachConfigReader{Reflective: true}
	s := NewLLMChainBriefSynthesiser(chat, cfg, quietLogger())

	got, err := s.Synthesise(context.Background(), criticalInput())
	if err != nil {
		t.Fatalf("Synthesise: %v", err)
	}
	if len(chat.calls) != 2 {
		t.Fatalf("expected 2 chat calls (sketch + critique), got %d", len(chat.calls))
	}
	if !strings.Contains(got.Headline, "refined push") {
		t.Fatalf("expected refined headline, got %q", got.Headline)
	}
	// Second call must include the draft envelope as evidence.
	last := chat.calls[1]
	if len(last.Messages) < 2 {
		t.Fatalf("critique call missing user message")
	}
	if !strings.Contains(last.Messages[0].Content, "critique") &&
		!strings.Contains(last.Messages[0].Content, "DRAFT") {
		// system prompt should advertise critique role
		t.Logf("system prompt preview: %s", firstN(last.Messages[0].Content, 80))
	}
	if !strings.Contains(last.Messages[1].Content, "DRAFT BRIEF") {
		t.Fatalf("critique user prompt missing draft block")
	}
}

func TestSynthesise_CriticalSkipsReflectionWhenDisabled(t *testing.T) {
	chat := &queuedChat{
		t:        t,
		queue:    []llmchain.Response{{Content: briefSketch}},
		errAfter: errors.New("no extra calls expected when reflective disabled"),
	}
	cfg := StaticCoachConfigReader{Reflective: false}
	s := NewLLMChainBriefSynthesiser(chat, cfg, quietLogger())

	got, err := s.Synthesise(context.Background(), criticalInput())
	if err != nil {
		t.Fatalf("Synthesise: %v", err)
	}
	if len(chat.calls) != 1 {
		t.Fatalf("expected 1 chat call when flag off, got %d", len(chat.calls))
	}
	if got.Severity != domain.InsightSeverityCritical {
		t.Fatalf("expected critical severity, got %q", got.Severity)
	}
}

func TestSynthesise_CritiqueChainErrorFallsBackToSketch(t *testing.T) {
	chat := &queuedChat{
		t: t,
		queue: []llmchain.Response{
			{Content: briefSketch},
		},
		// Second call (critique) gets this error → caller should fall back.
		errAfter: errors.New("provider down"),
	}
	cfg := StaticCoachConfigReader{Reflective: true}
	s := NewLLMChainBriefSynthesiser(chat, cfg, quietLogger())

	got, err := s.Synthesise(context.Background(), criticalInput())
	if err != nil {
		t.Fatalf("Synthesise: %v", err)
	}
	if len(chat.calls) != 2 {
		t.Fatalf("expected 2 chat calls (sketch + failed critique), got %d", len(chat.calls))
	}
	if !strings.Contains(got.Headline, "sketch wall") {
		t.Fatalf("expected sketch headline preserved on critique error, got %q", got.Headline)
	}
}

func TestSynthesise_CritiqueParseFailFallsBackToSketch(t *testing.T) {
	// Critique returns malformed JSON; sketch must surface unchanged.
	chat := &queuedChat{
		t: t,
		queue: []llmchain.Response{
			{Content: briefSketch},
			{Content: "{not-json}"},
		},
	}
	cfg := StaticCoachConfigReader{Reflective: true}
	s := NewLLMChainBriefSynthesiser(chat, cfg, quietLogger())

	got, err := s.Synthesise(context.Background(), criticalInput())
	if err != nil {
		t.Fatalf("Synthesise: %v", err)
	}
	if len(chat.calls) != 2 {
		t.Fatalf("expected 2 chat calls (sketch + parse-fail critique), got %d", len(chat.calls))
	}
	if !strings.Contains(got.Headline, "sketch wall") {
		t.Fatalf("expected sketch headline preserved on critique parse-fail, got %q", got.Headline)
	}
}

// silence "imported and not used" if anyone trims helpers.
var _ = bytes.NewBuffer

// ── Phase 4.2 persona overlay ────────────────────────────────────────────

func TestSynthesise_NoPersonaOverlayWhenUnset(t *testing.T) {
	chat := &queuedChat{
		t:        t,
		queue:    []llmchain.Response{{Content: briefSketch}},
		errAfter: errors.New("no extra calls"),
	}
	cfg := StaticCoachConfigReader{} // PersonaValue empty
	s := NewLLMChainBriefSynthesiser(chat, cfg, quietLogger())

	if _, err := s.Synthesise(context.Background(), cruiseInput()); err != nil {
		t.Fatalf("Synthesise: %v", err)
	}
	if len(chat.calls) != 1 {
		t.Fatalf("expected 1 call, got %d", len(chat.calls))
	}
	// Default sketch path: 2 messages (system + user). Persona overlay
	// would добавил бы third message.
	if len(chat.calls[0].Messages) != 2 {
		t.Fatalf("expected 2 messages without persona, got %d", len(chat.calls[0].Messages))
	}
}

func TestSynthesise_PersonaOverlayInjectsSystemMessage(t *testing.T) {
	chat := &queuedChat{
		t:        t,
		queue:    []llmchain.Response{{Content: briefSketch}},
		errAfter: errors.New("no extra calls"),
	}
	cfg := StaticCoachConfigReader{PersonaValue: CoachPersonaStrict}
	s := NewLLMChainBriefSynthesiser(chat, cfg, quietLogger())

	if _, err := s.Synthesise(context.Background(), cruiseInput()); err != nil {
		t.Fatalf("Synthesise: %v", err)
	}
	msgs := chat.calls[0].Messages
	if len(msgs) != 3 {
		t.Fatalf("expected 3 messages with persona overlay, got %d", len(msgs))
	}
	if !strings.Contains(msgs[1].Content, "TONE OVERLAY: strict") {
		t.Fatalf("overlay message 1 missing strict tag: %q", msgs[1].Content)
	}
}

// ── Phase 5 prompt-variant overlay ──────────────────────────────────────

func TestSynthesise_NoVariantOverlayWhenDefault(t *testing.T) {
	chat := &queuedChat{
		t:        t,
		queue:    []llmchain.Response{{Content: briefSketch}},
		errAfter: errors.New("no extra calls"),
	}
	cfg := StaticCoachConfigReader{} // PromptVariantValue empty → default
	s := NewLLMChainBriefSynthesiser(chat, cfg, quietLogger())
	if _, err := s.Synthesise(context.Background(), cruiseInput()); err != nil {
		t.Fatalf("Synthesise: %v", err)
	}
	// 2 messages = system + user, без variant overlay.
	if len(chat.calls[0].Messages) != 2 {
		t.Fatalf("expected 2 messages without variant overlay, got %d", len(chat.calls[0].Messages))
	}
}

func TestSynthesise_TerseVariantInjectsMessage(t *testing.T) {
	chat := &queuedChat{
		t:        t,
		queue:    []llmchain.Response{{Content: briefSketch}},
		errAfter: errors.New("no extra calls"),
	}
	cfg := StaticCoachConfigReader{PromptVariantValue: CoachPromptVariantTerse}
	s := NewLLMChainBriefSynthesiser(chat, cfg, quietLogger())
	if _, err := s.Synthesise(context.Background(), cruiseInput()); err != nil {
		t.Fatalf("Synthesise: %v", err)
	}
	msgs := chat.calls[0].Messages
	if len(msgs) != 3 {
		t.Fatalf("expected 3 messages with terse variant, got %d", len(msgs))
	}
	if !strings.Contains(msgs[1].Content, "VARIANT: terse") {
		t.Fatalf("variant message missing terse tag: %q", msgs[1].Content)
	}
}

func TestSynthesise_PersonaAndVariantStackInOrder(t *testing.T) {
	// Persona first, variant second — variant перевешивает при конфликте.
	chat := &queuedChat{
		t:        t,
		queue:    []llmchain.Response{{Content: briefSketch}},
		errAfter: errors.New("no extra calls"),
	}
	cfg := StaticCoachConfigReader{
		PersonaValue:       CoachPersonaStrict,
		PromptVariantValue: CoachPromptVariantSharp,
	}
	s := NewLLMChainBriefSynthesiser(chat, cfg, quietLogger())
	if _, err := s.Synthesise(context.Background(), cruiseInput()); err != nil {
		t.Fatalf("Synthesise: %v", err)
	}
	msgs := chat.calls[0].Messages
	if len(msgs) != 4 {
		t.Fatalf("expected 4 messages (system+persona+variant+user), got %d", len(msgs))
	}
	if !strings.Contains(msgs[1].Content, "TONE OVERLAY: strict") {
		t.Fatalf("msgs[1] should be persona, got: %q", msgs[1].Content)
	}
	if !strings.Contains(msgs[2].Content, "VARIANT: sharp") {
		t.Fatalf("msgs[2] should be variant, got: %q", msgs[2].Content)
	}
}

func TestSynthesise_PersonaOverlayAlsoInCritique(t *testing.T) {
	// Critical input + reflective enabled + warm persona → both stages
	// должны иметь overlay.
	chat := &queuedChat{
		t: t,
		queue: []llmchain.Response{
			{Content: briefSketch},
			{Content: briefRefined},
		},
	}
	cfg := StaticCoachConfigReader{
		Reflective:   true,
		PersonaValue: CoachPersonaWarm,
	}
	s := NewLLMChainBriefSynthesiser(chat, cfg, quietLogger())

	if _, err := s.Synthesise(context.Background(), criticalInput()); err != nil {
		t.Fatalf("Synthesise: %v", err)
	}
	if len(chat.calls) != 2 {
		t.Fatalf("expected 2 calls (sketch + critique), got %d", len(chat.calls))
	}
	for i, c := range chat.calls {
		if len(c.Messages) != 3 {
			t.Fatalf("call %d: expected 3 messages, got %d", i, len(c.Messages))
		}
		if !strings.Contains(c.Messages[1].Content, "TONE OVERLAY: warm") {
			t.Fatalf("call %d: overlay missing warm tag: %q", i, c.Messages[1].Content)
		}
	}
}
