package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	honeDomain "druz9/hone/domain"
	intelApp "druz9/intelligence/app"
	intelDomain "druz9/intelligence/domain"
	intelInfra "druz9/intelligence/infra"
	intelPorts "druz9/intelligence/ports"
	miDomain "druz9/mock_interview/domain"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/llmcache"
	"druz9/shared/pkg/metrics"
	sharedMw "druz9/shared/pkg/middleware"
	sharedpg "druz9/shared/pkg/pg"

	"connectrpc.com/connect"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewIntelligence wires the AI-coach bounded context.
//
// Adapters:
//   - DailyBriefRepo: own table hone_daily_briefs.
//   - FocusReader / PlanReader / NotesReader: hand-rolled raw SQL over
//     hone_streak_days, hone_daily_plans, hone_notes. Live in this file
//     (not in intelligence/infra) so the intelligence service never
//     imports hone's domain — the boundary stays hard.
//   - BriefSynthesizer / NoteAnswerer: real LLM-backed when d.LLMChain is
//     non-nil; otherwise floor adapters return ErrLLMUnavailable (→ 503).
//   - Embedder: HoneEmbedder (bge-small via Ollama) when OLLAMA_HOST is
//     set; otherwise floor returns ErrEmbeddingUnavailable.
//
// MVP gating: open to all signed-in users (no Pro-gate). Add a TierReader
// dependency mirror of HoneServer.WithTier when the feature graduates.
// IntelligenceModule wraps the standard module with a publicly-readable
// MemoryHook — hone wiring taps into it to write side-effect episodes
// (reflections / standups / plan-skip-or-complete / note-create /
// focus-session-done).
type IntelligenceModule struct {
	*Module
	Memory   *intelApp.Memory
	Hook     honeDomain.MemoryHook
	MockHook miDomain.MemoryHook
}

func NewIntelligence(d Deps) IntelligenceModule {
	briefs := intelInfra.NewDailyBriefs(d.Pool)
	episodes := intelInfra.NewEpisodes(d.Pool)

	focusR := &intelFocusReader{pool: d.Pool}
	planR := &intelPlanReader{pool: d.Pool}
	notesR := &intelNotesReader{pool: d.Pool}
	// Cross-product readers — все опциональные. Coach prompt получает
	// сигналы и из Hone, и из druz9 (mocks/arena/kata) и из user'ского
	// Today (queue, daily notes). См. domain/repo.go BriefPromptInput
	// и services/intelligence.go cross-product readers ниже.
	mockR := &intelMockReader{pool: d.Pool}
	kataR := &intelKataReader{pool: d.Pool}
	arenaR := &intelArenaReader{pool: d.Pool}
	queueR := &intelQueueReader{pool: d.Pool}
	skillR := &intelSkillReader{pool: d.Pool}
	dailyR := &intelDailyNoteReader{pool: d.Pool}
	calR := &intelCalendarReader{pool: d.Pool}
	mockMsgR := &intelMockMessagesReader{pool: d.Pool}

	embedder := newIntelEmbedder(d)

	var (
		synth    intelDomain.BriefSynthesizer
		answerer intelDomain.NoteAnswerer
	)
	if d.LLMChain != nil {
		synth = intelInfra.NewLLMChainBriefSynthesiser(d.LLMChain, d.Log)
		answerer = intelInfra.NewLLMChainNoteAnswerer(d.LLMChain, d.Log)
		d.Log.Info("intelligence: LLM adapters wired (daily brief + note QA)")
	} else {
		synth = intelInfra.NewNoLLMBriefSynthesiser()
		answerer = intelInfra.NewNoLLMNoteAnswerer()
		d.Log.Warn("intelligence: llmchain not configured — daily-brief / ask-notes will return 503")
	}

	memory := &intelApp.Memory{
		Episodes: episodes,
		Embed:    embedder,
		Log:      d.Log,
		Now:      d.Now,
	}

	h := intelApp.NewHandler(intelApp.Handler{
		GetDailyBrief: &intelApp.GetDailyBrief{
			Briefs:      briefs,
			Focus:       focusR,
			Plans:       planR,
			Notes:       notesR,
			Synthesiser: synth,
			Log:         d.Log,
			Now:         d.Now,
			Memory:      memory,
			// Cross-product сигналы для smart Coach.
			Mocks:        mockR,
			Kata:         kataR,
			Arena:        arenaR,
			Queue:        queueR,
			Skills:       skillR,
			DailyNotes:   dailyR,
			Calendar:     calR,
			MockMessages: mockMsgR,
		},
		AskNotes: &intelApp.AskNotes{
			Notes:    notesR,
			Embedder: embedder,
			Answerer: answerer,
			Log:      d.Log,
			Memory:   memory,
		},
		Log: d.Log,
	})

	server := intelPorts.NewIntelligenceServer(h, memory)
	connectPath, connectHandler := druz9v1connect.NewIntelligenceServiceHandler(
		server,
		connect.WithInterceptors(metrics.ConnectInterceptor()),
	)
	transcoder := mustTranscode("intelligence", connectPath, connectHandler)

	// Embed worker — фон. Stop через app shutdown ctx (см. bootstrap).
	worker := &intelApp.EmbedWorker{
		Episodes: episodes,
		Embed:    embedder,
		Log:      d.Log,
	}

	return IntelligenceModule{
		Module: &Module{
			ConnectPath:        connectPath,
			ConnectHandler:     transcoder,
			RequireConnectAuth: true,
			MountREST: func(r chi.Router) {
				// daily-brief got chi-direct because vanguard's transcoder
				// was rejecting the JSON body in prod with 415 even though
				// every other transcoded route accepts the same Content-
				// Type. The use case is small enough that bypassing the
				// transcoder here is cheaper than chasing the Content-Type
				// negotiation quirk.
				dailyBriefDirect := newDailyBriefDirectHandler(h.GetDailyBrief, d.Log)
				r.Post("/intelligence/daily-brief", dailyBriefDirect)
				r.Post("/intelligence/ask-notes", transcoder.ServeHTTP)
				r.Post("/intelligence/brief/ack", transcoder.ServeHTTP)
				r.Get("/intelligence/memory/stats", transcoder.ServeHTTP)
			},
			Background: []func(context.Context){
				func(ctx context.Context) { go worker.Run(ctx) },
			},
		},
		Memory:   memory,
		Hook:     newIntelligenceMemoryHook(memory, d.Log),
		MockHook: newMockMemoryHook(memory, d.Log),
	}
}

// newMockMemoryHook builds the adapter that mock_interview's
// orchestrator uses to write `mock_pipeline_finished` episodes. Same
// pattern as newIntelligenceMemoryHook for hone — the mock_interview
// service stays decoupled from intelligence/domain and only knows the
// narrow miDomain.MemoryHook interface.
func newMockMemoryHook(m *intelApp.Memory, log *slog.Logger) miDomain.MemoryHook {
	return &mockMemoryHook{memory: m, log: log}
}

type mockMemoryHook struct {
	memory *intelApp.Memory
	log    *slog.Logger
}

func (h *mockMemoryHook) OnPipelineFinished(
	ctx context.Context,
	userID uuid.UUID,
	pipelineID uuid.UUID,
	verdict miDomain.PipelineVerdict,
	totalScore *float32,
	stages []miDomain.PipelineStage,
	occurredAt time.Time,
) {
	parts := []string{fmt.Sprintf("verdict=%s", string(verdict))}
	if totalScore != nil {
		parts = append(parts, fmt.Sprintf("total_score=%.0f", *totalScore))
	}
	stagesPayload := make([]map[string]any, 0, len(stages))
	for _, s := range stages {
		row := map[string]any{"stage_kind": string(s.StageKind)}
		if s.Verdict != nil {
			row["verdict"] = string(*s.Verdict)
		}
		if s.Score != nil {
			row["score"] = *s.Score
		}
		stagesPayload = append(stagesPayload, row)
	}
	summary := strings.Join(parts, " · ")
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID:  userID,
		Kind:    intelDomain.EpisodeMockPipelineFinished,
		Summary: summary,
		Payload: map[string]any{
			"pipeline_id": pipelineID.String(),
			"stages":      stagesPayload,
		},
		OccurredAt: occurredAt,
	})
}

var _ miDomain.MemoryHook = (*mockMemoryHook)(nil)

// memoryHook implements hone/domain.MemoryHook — узкий side-effect channel
// в Coach memory. Hone use cases дёргают (опционально через nil-check).
// Имплементация = thin shim over intelApp.Memory.AppendAsync.
type memoryHook struct {
	memory *intelApp.Memory
	log    *slog.Logger
}

func newIntelligenceMemoryHook(m *intelApp.Memory, log *slog.Logger) honeDomain.MemoryHook {
	return &memoryHook{memory: m, log: log}
}

func (h *memoryHook) OnReflectionAdded(ctx context.Context, uid uuid.UUID, reflection, planItemID string, sec int, occ time.Time) {
	if reflection == "" {
		return
	}
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodeReflectionAdded, Summary: reflection,
		Payload:    map[string]any{"plan_item_id": planItemID, "seconds": sec},
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnStandupRecorded(ctx context.Context, uid uuid.UUID, y, t, b string, occ time.Time) {
	parts := []string{}
	if y != "" {
		parts = append(parts, "Yesterday: "+y)
	}
	if t != "" {
		parts = append(parts, "Today: "+t)
	}
	if b != "" {
		parts = append(parts, "Blockers: "+b)
	}
	if len(parts) == 0 {
		return
	}
	summary := strings.Join(parts, " || ")
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodeStandupRecorded, Summary: summary,
		Payload:    map[string]any{"yesterday": y, "today": t, "blockers": b},
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnPlanSkipped(ctx context.Context, uid uuid.UUID, title, skill string, occ time.Time) {
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodePlanSkipped, Summary: title,
		Payload:    map[string]any{"skill_key": skill},
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnPlanCompleted(ctx context.Context, uid uuid.UUID, title, skill string, occ time.Time) {
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodePlanCompleted, Summary: title,
		Payload:    map[string]any{"skill_key": skill},
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnNoteCreated(ctx context.Context, uid uuid.UUID, noteID uuid.UUID, title, body200 string, occ time.Time) {
	summary := title
	if body200 != "" {
		summary = title + ": " + body200
	}
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodeNoteCreated, Summary: summary,
		Payload:    map[string]any{"note_id": noteID.String()},
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnFocusSessionDone(ctx context.Context, uid uuid.UUID, pinned string, sec int, planItemID string, pomodoros int, occ time.Time) {
	if sec < 5*60 {
		return // короче 5 минут — не «сессия», skip
	}
	summary := pinned
	if summary == "" {
		summary = "Focus block"
	}
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodeFocusSessionDone, Summary: summary,
		Payload:    map[string]any{"seconds": sec, "plan_item_id": planItemID, "pomodoros": pomodoros},
		OccurredAt: occ,
	})
}

// Compile-time guard.
var _ honeDomain.MemoryHook = (*memoryHook)(nil)

// ─── Reader adapters (raw SQL, no hone import) ────────────────────────────

// intelFocusReader реализует intelDomain.FocusReader через hone_focus_sessions.
//
// Раньше читал из hone_streak_days и брал sessions_count → метил его как
// `pomodoros` в LLM-prompt'е. sessions_count = «сколько раз нажал Start»,
// НЕ pomodoros (25-min completed units). Юзер 10 раз начинал и сразу
// останавливал — coach писал «10 pomodoros completed». Bullshit.
//
// Сейчас: SUM(pomodoros_completed) из реальных focus_sessions + фильтр
// seconds_focused >= 60 чтобы insta-stop сессии не загрязняли картину.
type intelFocusReader struct{ pool *pgxpool.Pool }

func (r *intelFocusReader) LastNDays(ctx context.Context, userID uuid.UUID, n int) ([]intelDomain.FocusDay, error) {
	if n <= 0 || n > 60 {
		n = 7
	}
	rows, err := r.pool.Query(ctx,
		`SELECT date_trunc('day', started_at)::date AS day,
		        COALESCE(SUM(seconds_focused), 0)::int    AS seconds,
		        COALESCE(SUM(pomodoros_completed), 0)::int AS pomodoros
		   FROM hone_focus_sessions
		  WHERE user_id=$1
		    AND started_at >= CURRENT_DATE - $2::int
		    AND ended_at IS NOT NULL
		    AND seconds_focused >= 60
		  GROUP BY date_trunc('day', started_at)
		  ORDER BY day ASC`,
		sharedpg.UUID(userID), n,
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.intelFocusReader.LastNDays: %w", err)
	}
	defer rows.Close()
	out := make([]intelDomain.FocusDay, 0, n)
	for rows.Next() {
		var (
			day       time.Time
			seconds   int32
			pomodoros int32
		)
		if err := rows.Scan(&day, &seconds, &pomodoros); err != nil {
			return nil, fmt.Errorf("intelligence.intelFocusReader.LastNDays: scan: %w", err)
		}
		out = append(out, intelDomain.FocusDay{
			Day:       day,
			Seconds:   int(seconds),
			Pomodoros: int(pomodoros),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.intelFocusReader.LastNDays: rows: %w", err)
	}
	return out, nil
}

// intelPlanReader реализует intelDomain.PlanReader через hone_daily_plans.items jsonb.
type intelPlanReader struct{ pool *pgxpool.Pool }

func (r *intelPlanReader) SkippedItems(ctx context.Context, userID uuid.UUID, since time.Time) ([]intelDomain.SkippedPlanItem, error) {
	return r.scanItems(ctx, userID, since, true)
}

func (r *intelPlanReader) CompletedItems(ctx context.Context, userID uuid.UUID, since time.Time) ([]intelDomain.CompletedPlanItem, error) {
	skipped, err := r.scanItems(ctx, userID, since, false)
	if err != nil {
		return nil, err
	}
	out := make([]intelDomain.CompletedPlanItem, 0, len(skipped))
	for _, s := range skipped {
		out = append(out, intelDomain.CompletedPlanItem(s))
	}
	return out, nil
}

// scanItems walks plan_date >= since и фильтрует items по флагу
// dismissed (true) или completed (true) в зависимости от skipped.
//
// Implementation note: items — jsonb-array, поэтому распаковываем в Go,
// а не в SQL (jsonb_array_elements + ->> filtering работает, но плодит
// query'ю на 5 строк — на ~hundreds of plan rows in 14 day window это не
// узкое место).
func (r *intelPlanReader) scanItems(
	ctx context.Context,
	userID uuid.UUID,
	since time.Time,
	skippedNotCompleted bool,
) ([]intelDomain.SkippedPlanItem, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT plan_date, items
		   FROM hone_daily_plans
		  WHERE user_id=$1 AND plan_date >= $2`,
		sharedpg.UUID(userID), pgtype.Date{Time: since, Valid: true},
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("intelligence.intelPlanReader.scanItems: %w", err)
	}
	defer rows.Close()

	type rawItem struct {
		ID        string `json:"ID"`
		Title     string `json:"Title"`
		SkillKey  string `json:"SkillKey"`
		Dismissed bool   `json:"Dismissed"`
		Completed bool   `json:"Completed"`
	}

	out := make([]intelDomain.SkippedPlanItem, 0, 16)
	for rows.Next() {
		var (
			planDate time.Time
			rawItems []byte
		)
		if err := rows.Scan(&planDate, &rawItems); err != nil {
			return nil, fmt.Errorf("intelligence.intelPlanReader.scanItems: scan: %w", err)
		}
		var items []rawItem
		if err := unmarshalJSONLenient(rawItems, &items); err != nil {
			// Skip malformed rows — better than aborting whole reader.
			continue
		}
		for _, it := range items {
			if skippedNotCompleted && !it.Dismissed {
				continue
			}
			if !skippedNotCompleted && !it.Completed {
				continue
			}
			out = append(out, intelDomain.SkippedPlanItem{
				ItemID:   it.ID,
				Title:    it.Title,
				SkillKey: it.SkillKey,
				PlanDate: planDate,
			})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.intelPlanReader.scanItems: rows: %w", err)
	}
	return out, nil
}

// intelNotesReader реализует intelDomain.NotesReader через hone_notes.
type intelNotesReader struct{ pool *pgxpool.Pool }

// reflectionPattern — note titles стилизованные «… — YYYY-MM-DD».
// Просим Postgres матчить по regex, чтобы не хайдратить весь корпус.
const reflectionPattern = `[[:space:]]—[[:space:]]\d{4}-\d{2}-\d{2}$`

func (r *intelNotesReader) RecentReflections(ctx context.Context, userID uuid.UUID, limit int) ([]intelDomain.Reflection, error) {
	if limit <= 0 || limit > 50 {
		limit = 5
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, title, body_md, created_at
		   FROM hone_notes
		  WHERE user_id=$1 AND title ~ $2
		  ORDER BY created_at DESC
		  LIMIT $3`,
		sharedpg.UUID(userID), reflectionPattern, int32(limit),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.intelNotesReader.RecentReflections: %w", err)
	}
	defer rows.Close()
	out := make([]intelDomain.Reflection, 0, limit)
	for rows.Next() {
		var (
			id        pgtype.UUID
			title     string
			body      string
			createdAt time.Time
		)
		if err := rows.Scan(&id, &title, &body, &createdAt); err != nil {
			return nil, fmt.Errorf("intelligence.intelNotesReader.RecentReflections: scan: %w", err)
		}
		// EndFocusSession пишет body как «<reflection>\n\n---\nSession: …».
		// Берём фрагмент до разделителя.
		head := body
		if idx := indexOfDivider(head); idx > 0 {
			head = head[:idx]
		}
		if len(head) > 240 {
			head = head[:240] + "…"
		}
		out = append(out, intelDomain.Reflection{
			NoteID:    sharedpg.UUIDFrom(id),
			Title:     title,
			BodyHead:  head,
			CreatedAt: createdAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.intelNotesReader.RecentReflections: rows: %w", err)
	}
	return out, nil
}

func (r *intelNotesReader) RecentNotes(ctx context.Context, userID uuid.UUID, limit int) ([]intelDomain.NoteHead, error) {
	if limit <= 0 || limit > 50 {
		limit = 5
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, title, LEFT(body_md, 220), updated_at
		   FROM hone_notes
		  WHERE user_id=$1
		  ORDER BY updated_at DESC
		  LIMIT $2`,
		sharedpg.UUID(userID), int32(limit),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.intelNotesReader.RecentNotes: %w", err)
	}
	defer rows.Close()
	out := make([]intelDomain.NoteHead, 0, limit)
	for rows.Next() {
		var (
			id        pgtype.UUID
			title     string
			excerpt   string
			updatedAt time.Time
		)
		if err := rows.Scan(&id, &title, &excerpt, &updatedAt); err != nil {
			return nil, fmt.Errorf("intelligence.intelNotesReader.RecentNotes: scan: %w", err)
		}
		out = append(out, intelDomain.NoteHead{
			NoteID:    sharedpg.UUIDFrom(id),
			Title:     title,
			Excerpt:   excerpt,
			UpdatedAt: updatedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.intelNotesReader.RecentNotes: rows: %w", err)
	}
	return out, nil
}

func (r *intelNotesReader) EmbeddedCorpus(ctx context.Context, userID uuid.UUID) ([]intelDomain.NoteEmbedding, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, title, LEFT(body_md, 2048), LEFT(body_md, 140), embedding
		   FROM hone_notes
		  WHERE user_id=$1 AND embedding IS NOT NULL`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.intelNotesReader.EmbeddedCorpus: %w", err)
	}
	defer rows.Close()
	out := make([]intelDomain.NoteEmbedding, 0, 32)
	for rows.Next() {
		var (
			id        pgtype.UUID
			title     string
			body      string
			snippet   string
			embedding []float32
		)
		if err := rows.Scan(&id, &title, &body, &snippet, &embedding); err != nil {
			return nil, fmt.Errorf("intelligence.intelNotesReader.EmbeddedCorpus: scan: %w", err)
		}
		out = append(out, intelDomain.NoteEmbedding{
			NoteID:    sharedpg.UUIDFrom(id),
			Title:     title,
			Body:      body,
			Snippet:   snippet,
			Embedding: embedding,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.intelNotesReader.EmbeddedCorpus: rows: %w", err)
	}
	return out, nil
}

// indexOfDivider returns the index of "\n---" (the EndFocusSession reflection
// divider) or -1 when absent.
func indexOfDivider(body string) int {
	const div = "\n\n---\n"
	if idx := indexOf(body, div); idx >= 0 {
		return idx
	}
	return -1
}

func indexOf(haystack, needle string) int {
	hl, nl := len(haystack), len(needle)
	if nl == 0 || nl > hl {
		return -1
	}
	for i := 0; i+nl <= hl; i++ {
		if haystack[i:i+nl] == needle {
			return i
		}
	}
	return -1
}

// unmarshalJSONLenient — пытается json.Unmarshal; ошибка не валит вызовущий
// loop (silent-skip для одного плохого ряда плана).
func unmarshalJSONLenient(raw []byte, v any) error {
	if len(raw) == 0 {
		return nil
	}
	return jsonUnmarshal(raw, v)
}

// jsonUnmarshal — однострочная индирекция; оборачиваем ошибку для wrapcheck.
func jsonUnmarshal(raw []byte, v any) error {
	if err := json.Unmarshal(raw, v); err != nil {
		return fmt.Errorf("json.Unmarshal: %w", err)
	}
	return nil
}

// ─── Embedder shim ────────────────────────────────────────────────────────

// intelEmbedder — тонкая обёртка над llmcache.OllamaEmbedder с типизированной
// ErrEmbeddingUnavailable. bge-m3 — generic shared-infra (используется и в
// hone, и в documents).
type intelEmbedder struct {
	model string
	emb   *llmcache.OllamaEmbedder
}

func newIntelEmbedder(d Deps) intelDomain.Embedder {
	host := ""
	if d.Cfg != nil {
		host = d.Cfg.LLMChain.OllamaHost
	}
	if host == "" {
		d.Log.Warn("intelligence: OLLAMA_HOST not set — ask-notes will return 503")
		return &intelEmbedder{} // emb==nil → Embed returns ErrEmbeddingUnavailable
	}
	d.Log.Info("intelligence: Ollama embedder wired", slog.String("ollama_host", host))
	return &intelEmbedder{
		model: llmcache.DefaultOllamaEmbedModel,
		emb:   llmcache.NewOllamaEmbedder(host, llmcache.DefaultOllamaEmbedModel, 0),
	}
}

func (e *intelEmbedder) Embed(ctx context.Context, text string) ([]float32, string, error) {
	if e == nil || e.emb == nil {
		return nil, "", fmt.Errorf("intelligence.intelEmbedder.Embed: %w", intelDomain.ErrEmbeddingUnavailable)
	}
	vec, err := e.emb.Embed(ctx, text)
	if err != nil {
		return nil, "", fmt.Errorf("intelligence.intelEmbedder.Embed: %w", err)
	}
	return vec, e.model, nil
}

// ─── Cross-product readers (raw SQL) ──────────────────────────────────────
//
// Coach prompt объединяет сигналы трёх продуктов: Hone (focus, queue,
// notes), druz9 mock-interview (mock_sessions), druz9 arena/codex
// (arena_matches, daily_kata_history). Все adapter'ы здесь — чтобы
// intelligence-domain не импортировал чужие infra-пакеты.

// ── intelMockReader: services/ai_mock domain ──

type intelMockReader struct{ pool *pgxpool.Pool }

// LastNFinished returns last N finished mock-interview sessions с distilled
// score + weak topics из ai_report JSONB.
//
// ai_report shape ожидается такая (см. ai_mock domain):
//
//	{ "score": 7, "weak_topics": ["capacity-estimation", "load-balancing"], ... }
//
// Если поля отсутствуют / другой shape — score=0, weak_topics=nil. Не валим
// reader: даже факт «мок был» — сигнал для Coach.
func (r *intelMockReader) LastNFinished(ctx context.Context, userID uuid.UUID, n int) ([]intelDomain.MockSessionSummary, error) {
	if n <= 0 || n > 50 {
		n = 5
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, section, difficulty, status, ai_report, finished_at, duration_min
		   FROM mock_sessions
		  WHERE user_id=$1
		    AND status='finished'
		    AND finished_at IS NOT NULL
		  ORDER BY finished_at DESC
		  LIMIT $2`,
		sharedpg.UUID(userID), n,
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.intelMockReader: %w", err)
	}
	defer rows.Close()
	out := make([]intelDomain.MockSessionSummary, 0, n)
	for rows.Next() {
		var (
			id          pgtype.UUID
			section     string
			difficulty  string
			status      string
			report      []byte
			finishedAt  *time.Time
			durationMin int32
		)
		if err := rows.Scan(&id, &section, &difficulty, &status, &report, &finishedAt, &durationMin); err != nil {
			return nil, fmt.Errorf("intelligence.intelMockReader: scan: %w", err)
		}
		s := intelDomain.MockSessionSummary{
			SessionID:   sharedpg.UUIDFrom(id),
			Section:     section,
			Difficulty:  difficulty,
			Status:      status,
			DurationMin: int(durationMin),
		}
		if finishedAt != nil {
			s.FinishedAt = *finishedAt
		}
		// Best-effort parse ai_report.{score, weak_topics}.
		if len(report) > 0 {
			var raw struct {
				Score      int      `json:"score"`
				WeakTopics []string `json:"weak_topics"`
			}
			_ = json.Unmarshal(report, &raw)
			s.Score = raw.Score
			s.WeakTopics = raw.WeakTopics
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.intelMockReader: rows: %w", err)
	}
	return out, nil
}

// ── intelKataReader: services/daily domain ──

type intelKataReader struct{ pool *pgxpool.Pool }

func (r *intelKataReader) GetStreak(ctx context.Context, userID uuid.UUID) (intelDomain.KataStreak, error) {
	var (
		current      int32
		longest      int32
		lastKataDate *time.Time
	)
	err := r.pool.QueryRow(ctx,
		`SELECT current_streak, longest_streak, last_kata_date
		   FROM daily_streaks WHERE user_id=$1`,
		sharedpg.UUID(userID),
	).Scan(&current, &longest, &lastKataDate)
	if err != nil {
		// No row = streak ещё не начат. Не ошибка — пустой результат.
		return intelDomain.KataStreak{}, nil //nolint:nilerr
	}
	return intelDomain.KataStreak{
		Current:      int(current),
		Longest:      int(longest),
		LastKataDate: lastKataDate,
	}, nil
}

func (r *intelKataReader) LastNAttempts(ctx context.Context, userID uuid.UUID, n int) ([]intelDomain.KataAttempt, error) {
	if n <= 0 || n > 30 {
		n = 7
	}
	rows, err := r.pool.Query(ctx,
		`SELECT kata_date, COALESCE(passed, FALSE), is_cursed, is_weekly_boss, submitted_at
		   FROM daily_kata_history
		  WHERE user_id=$1
		  ORDER BY kata_date DESC
		  LIMIT $2`,
		sharedpg.UUID(userID), n,
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.intelKataReader: %w", err)
	}
	defer rows.Close()
	out := make([]intelDomain.KataAttempt, 0, n)
	for rows.Next() {
		var (
			day         time.Time
			passed      bool
			cursed      bool
			weeklyBoss  bool
			submittedAt *time.Time
		)
		if err := rows.Scan(&day, &passed, &cursed, &weeklyBoss, &submittedAt); err != nil {
			return nil, fmt.Errorf("intelligence.intelKataReader: scan: %w", err)
		}
		out = append(out, intelDomain.KataAttempt{
			KataDate:     day,
			Passed:       passed,
			IsCursed:     cursed,
			IsWeeklyBoss: weeklyBoss,
			SubmittedAt:  submittedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("intelligence reader rows: %w", err)
	}
	return out, nil
}

// ── intelArenaReader: services/arena domain ──

type intelArenaReader struct{ pool *pgxpool.Pool }

func (r *intelArenaReader) LastNMatches(ctx context.Context, userID uuid.UUID, n int) ([]intelDomain.ArenaMatchSummary, error) {
	if n <= 0 || n > 20 {
		n = 5
	}
	// JOIN arena_matches + arena_participants. winning_team mapping в outcome:
	// если participant.team == match.winning_team → won; 0 (draw) → draw;
	// иначе lost. abandoned — match.status='cancelled'.
	rows, err := r.pool.Query(ctx,
		`SELECT m.id, m.section, m.mode, m.status, m.winning_team,
		        ap.team, COALESCE(ap.elo_after - ap.elo_before, 0) AS elo_delta,
		        COALESCE(ap.solve_time_ms, 0) AS solve_time_ms,
		        COALESCE(m.finished_at, ap.submitted_at) AS finished_at
		   FROM arena_matches m
		   JOIN arena_participants ap ON ap.match_id = m.id
		  WHERE ap.user_id=$1 AND m.status IN ('finished', 'cancelled')
		  ORDER BY COALESCE(m.finished_at, ap.submitted_at) DESC NULLS LAST
		  LIMIT $2`,
		sharedpg.UUID(userID), n,
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.intelArenaReader: %w", err)
	}
	defer rows.Close()
	out := make([]intelDomain.ArenaMatchSummary, 0, n)
	for rows.Next() {
		var (
			id          pgtype.UUID
			section     string
			mode        string
			status      string
			winningTeam *int32
			team        int32
			eloDelta    int32
			solveTimeMs int64
			finishedAt  *time.Time
		)
		if err := rows.Scan(&id, &section, &mode, &status, &winningTeam, &team, &eloDelta, &solveTimeMs, &finishedAt); err != nil {
			return nil, fmt.Errorf("intelligence.intelArenaReader: scan: %w", err)
		}
		outcome := "lost"
		switch {
		case status == "cancelled":
			outcome = "abandoned"
		case winningTeam == nil || *winningTeam == 0:
			outcome = "draw"
		case *winningTeam == team:
			outcome = "won"
		}
		s := intelDomain.ArenaMatchSummary{
			MatchID:     sharedpg.UUIDFrom(id),
			Section:     section,
			Mode:        mode,
			Outcome:     outcome,
			EloDelta:    int(eloDelta),
			SolveTimeMs: solveTimeMs,
		}
		if finishedAt != nil {
			s.FinishedAt = *finishedAt
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("intelligence reader rows: %w", err)
	}
	return out, nil
}

// ── intelQueueReader: services/hone Focus Queue domain ──

type intelQueueReader struct{ pool *pgxpool.Pool }

func (r *intelQueueReader) TodaySnapshot(ctx context.Context, userID uuid.UUID) (intelDomain.QueueSnapshot, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT title, source, status, COALESCE(skill_key, '')
		   FROM hone_queue_items
		  WHERE user_id=$1 AND date=CURRENT_DATE
		  ORDER BY CASE status
		             WHEN 'in_progress' THEN 0
		             WHEN 'todo'        THEN 1
		             ELSE 2 END,
		           created_at ASC`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return intelDomain.QueueSnapshot{}, fmt.Errorf("intelligence.intelQueueReader: %w", err)
	}
	defer rows.Close()
	snap := intelDomain.QueueSnapshot{Items: make([]intelDomain.QueueLine, 0)}
	for rows.Next() {
		var line intelDomain.QueueLine
		if err := rows.Scan(&line.Title, &line.Source, &line.Status, &line.SkillKey); err != nil {
			return intelDomain.QueueSnapshot{}, fmt.Errorf("intelligence.intelQueueReader: scan: %w", err)
		}
		snap.Items = append(snap.Items, line)
		snap.Total++
		switch line.Status {
		case "done":
			snap.Done++
		case "in_progress":
			snap.InProgress++
		default:
			snap.Todo++
		}
		switch line.Source {
		case "ai":
			snap.AISourced++
		case "user":
			snap.UserSourced++
		}
	}
	if err := rows.Err(); err != nil {
		return snap, fmt.Errorf("intelligence.intelQueueReader rows: %w", err)
	}
	return snap, nil
}

// ── intelSkillReader: Skill Atlas weakest nodes ──
//
// Uses skill_progress table directly (mirror hone.SkillAtlasReader).
// Lower progress = weaker. Take top-N ascending.

type intelSkillReader struct{ pool *pgxpool.Pool }

func (r *intelSkillReader) WeakestN(ctx context.Context, userID uuid.UUID, n int) ([]intelDomain.SkillWeak, error) {
	if n <= 0 || n > 20 {
		n = 5
	}
	rows, err := r.pool.Query(ctx,
		`SELECT s.skill_key, COALESCE(sk.title, s.skill_key), s.progress
		   FROM skill_progress s
		   LEFT JOIN skills sk ON sk.key = s.skill_key
		  WHERE s.user_id=$1
		  ORDER BY s.progress ASC
		  LIMIT $2`,
		sharedpg.UUID(userID), n,
	)
	if err != nil {
		// Если skill_progress / skills таблиц нет (ранний deploy) —
		// тихо отдаём пусто, не валим Coach.
		return nil, nil //nolint:nilerr
	}
	defer rows.Close()
	out := make([]intelDomain.SkillWeak, 0, n)
	for rows.Next() {
		var w intelDomain.SkillWeak
		var prog int32
		if err := rows.Scan(&w.SkillKey, &w.Title, &prog); err != nil {
			return nil, fmt.Errorf("intelligence.intelSkillReader: scan: %w", err)
		}
		w.Progress = int(prog)
		out = append(out, w)
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("intelligence reader rows: %w", err)
	}
	return out, nil
}

// ── intelDailyNoteReader: hone_notes с title prefix='Daily ' ──

type intelDailyNoteReader struct{ pool *pgxpool.Pool }

func (r *intelDailyNoteReader) RecentDailyNotes(ctx context.Context, userID uuid.UUID, n int) ([]intelDomain.DailyNoteHead, error) {
	if n <= 0 || n > 14 {
		n = 3
	}
	rows, err := r.pool.Query(ctx,
		`SELECT updated_at, LEFT(body_md, 400)
		   FROM hone_notes
		  WHERE user_id=$1 AND title LIKE 'Daily %'
		    AND archived_at IS NULL
		    AND body_md IS NOT NULL AND body_md != ''
		  ORDER BY updated_at DESC
		  LIMIT $2`,
		sharedpg.UUID(userID), n,
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.intelDailyNoteReader: %w", err)
	}
	defer rows.Close()
	out := make([]intelDomain.DailyNoteHead, 0, n)
	for rows.Next() {
		var h intelDomain.DailyNoteHead
		if err := rows.Scan(&h.Day, &h.Excerpt); err != nil {
			return nil, fmt.Errorf("intelligence.intelDailyNoteReader: scan: %w", err)
		}
		out = append(out, h)
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("intelligence reader rows: %w", err)
	}
	return out, nil
}

// ── intelCalendarReader: services/daily interview_calendars ──

type intelCalendarReader struct{ pool *pgxpool.Pool }

func (r *intelCalendarReader) UpcomingInterviews(ctx context.Context, userID uuid.UUID, withinDays int) ([]intelDomain.UpcomingInterview, error) {
	if withinDays <= 0 || withinDays > 365 {
		withinDays = 30
	}
	rows, err := r.pool.Query(ctx,
		`SELECT COALESCE(c.name, '?'), ic.role, ic.interview_date,
		        COALESCE(ic.current_level, ''), ic.readiness_pct
		   FROM interview_calendars ic
		   LEFT JOIN companies c ON c.id = ic.company_id
		  WHERE ic.user_id=$1
		    AND ic.interview_date >= CURRENT_DATE
		    AND ic.interview_date <= CURRENT_DATE + $2::int
		  ORDER BY ic.interview_date ASC`,
		sharedpg.UUID(userID), withinDays,
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.intelCalendarReader: %w", err)
	}
	defer rows.Close()
	out := make([]intelDomain.UpcomingInterview, 0)
	today := time.Now().UTC().Truncate(24 * time.Hour)
	for rows.Next() {
		var ui intelDomain.UpcomingInterview
		var pct int32
		if err := rows.Scan(&ui.CompanyName, &ui.Role, &ui.InterviewDate, &ui.CurrentLevel, &pct); err != nil {
			return nil, fmt.Errorf("intelligence.intelCalendarReader: scan: %w", err)
		}
		ui.ReadinessPct = int(pct)
		ui.DaysFromNow = int(ui.InterviewDate.Sub(today).Hours() / 24)
		out = append(out, ui)
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("intelligence.intelCalendarReader rows: %w", err)
	}
	return out, nil
}

// ── intelMockMessagesReader: keyword-frequency analysis ──
//
// Извлекает top-N keywords из user-content'а mock_messages за окно
// withinDays. Алгоритм: split по non-letter, lowercase, отсекаем
// stop-words + слова <3 символов, группируем по terms, top-N по count.
//
// Это не embeddings-based topic-model, но достаточно для prompt'а:
// нужны hot topics юзера, не глубокий cluster analysis.

type intelMockMessagesReader struct{ pool *pgxpool.Pool }

// stop-words — английские + транслит ru common. Расширять по наблюдениям.
var mockStopWords = map[string]struct{}{
	"the": {}, "and": {}, "for": {}, "you": {}, "are": {}, "this": {}, "that": {},
	"with": {}, "have": {}, "but": {}, "not": {}, "what": {}, "how": {}, "why": {},
	"can": {}, "will": {}, "would": {}, "could": {}, "should": {}, "your": {},
	"its": {}, "from": {}, "they": {}, "their": {}, "them": {}, "these": {},
	"about": {}, "into": {}, "out": {}, "use": {}, "using": {}, "let": {},
	"like": {}, "just": {}, "well": {}, "yes": {}, "okay": {}, "right": {},
	"think": {}, "know": {}, "see": {}, "say": {}, "got": {}, "get": {},
	"один": {}, "так": {}, "уже": {}, "что": {}, "как": {}, "это": {},
	"для": {}, "или": {}, "его": {}, "вот": {}, "тут": {}, "там": {},
	"мне": {}, "тебе": {}, "если": {}, "только": {}, "тоже": {}, "теперь": {},
}

func (r *intelMockMessagesReader) TopKeywords(ctx context.Context, userID uuid.UUID, withinDays, topN int) ([]intelDomain.MockKeywords, error) {
	if withinDays <= 0 || withinDays > 60 {
		withinDays = 14
	}
	if topN <= 0 || topN > 50 {
		topN = 12
	}
	rows, err := r.pool.Query(ctx,
		`SELECT m.content
		   FROM mock_messages m
		   JOIN mock_sessions s ON s.id = m.session_id
		  WHERE s.user_id=$1
		    AND m.role='user'
		    AND m.created_at >= NOW() - $2::int * INTERVAL '1 day'
		    AND length(m.content) <= 4096`,
		sharedpg.UUID(userID), withinDays,
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.intelMockMessagesReader: %w", err)
	}
	defer rows.Close()
	freq := map[string]int{}
	for rows.Next() {
		var content string
		if err := rows.Scan(&content); err != nil {
			return nil, fmt.Errorf("intelligence.intelMockMessagesReader: scan: %w", err)
		}
		// Tokenize: keep only letters (incl unicode), split everything else.
		// strings.FieldsFunc с predicate isLetter — простой и robust.
		tokens := strings.FieldsFunc(strings.ToLower(content), func(c rune) bool {
			// Letters & digits keep, рестальное delim. Цифры тоже keep
			// (3sum, dp, n+1 patterns).
			return !((c >= 'a' && c <= 'z') ||
				(c >= 'а' && c <= 'я') ||
				(c >= '0' && c <= '9') ||
				c == '-')
		})
		for _, t := range tokens {
			if len(t) < 3 {
				continue
			}
			if _, stop := mockStopWords[t]; stop {
				continue
			}
			freq[t]++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.intelMockMessagesReader rows: %w", err)
	}
	// Sort by count DESC, take top-N.
	type kv struct {
		k string
		c int
	}
	all := make([]kv, 0, len(freq))
	for k, c := range freq {
		if c < 2 {
			continue // singleton noise — skip
		}
		all = append(all, kv{k, c})
	}
	// Selection sort top-N (small N, no need for full sort).
	out := make([]intelDomain.MockKeywords, 0, topN)
	for i := 0; i < topN && len(all) > 0; i++ {
		best := 0
		for j := range all {
			if all[j].c > all[best].c {
				best = j
			}
		}
		out = append(out, intelDomain.MockKeywords{Keyword: all[best].k, Count: all[best].c})
		all = append(all[:best], all[best+1:]...)
	}
	return out, nil
}

// newDailyBriefDirectHandler builds a chi-direct alias for
// POST /intelligence/daily-brief that calls the GetDailyBrief use case
// without going through vanguard. Identical wire shape to the proto
// (camelCase JSON) so the frontend doesn't have to branch.
func newDailyBriefDirectHandler(uc *intelApp.GetDailyBrief, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := sharedMw.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
			return
		}
		// Body is optional. Accept empty / non-JSON bodies — proto
		// behaviour is "force defaults to false" anyway.
		var body struct {
			Force bool `json:"force"`
		}
		if r.ContentLength != 0 && r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&body)
		}
		brief, err := uc.Do(r.Context(), intelApp.GetDailyBriefInput{
			UserID: uid,
			Force:  body.Force,
		})
		if err != nil {
			status := http.StatusInternalServerError
			switch {
			case errors.Is(err, intelDomain.ErrLLMUnavailable):
				status = http.StatusServiceUnavailable
			case errors.Is(err, intelDomain.ErrRateLimited):
				status = http.StatusTooManyRequests
			}
			if log != nil {
				log.WarnContext(r.Context(), "intelligence.daily-brief direct", slog.Any("err", err))
			}
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), status)
			return
		}
		briefID := ""
		if brief.BriefID != uuid.Nil {
			briefID = brief.BriefID.String()
		}
		out := map[string]any{
			"brief_id":     briefID,
			"headline":     brief.Headline,
			"narrative":    brief.Narrative,
			"generated_at": brief.GeneratedAt.UTC().Format(time.RFC3339),
		}
		recs := make([]map[string]any, 0, len(brief.Recommendations))
		for _, rec := range brief.Recommendations {
			row := map[string]any{
				"kind":      string(rec.Kind),
				"title":     rec.Title,
				"rationale": rec.Rationale,
			}
			if rec.TargetID != "" {
				row["target_id"] = rec.TargetID
			}
			recs = append(recs, row)
		}
		out["recommendations"] = recs
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}
}
