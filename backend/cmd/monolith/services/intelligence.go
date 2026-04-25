package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	honeDomain "druz9/hone/domain"
	intelApp "druz9/intelligence/app"
	intelDomain "druz9/intelligence/domain"
	intelInfra "druz9/intelligence/infra"
	intelPorts "druz9/intelligence/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/llmcache"
	"druz9/shared/pkg/metrics"
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
	Memory *intelApp.Memory
	Hook   honeDomain.MemoryHook
}

func NewIntelligence(d Deps) IntelligenceModule {
	briefs := intelInfra.NewDailyBriefs(d.Pool)
	episodes := intelInfra.NewEpisodes(d.Pool)

	focusR := &intelFocusReader{pool: d.Pool}
	planR := &intelPlanReader{pool: d.Pool}
	notesR := &intelNotesReader{pool: d.Pool}

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
				r.Post("/intelligence/daily-brief", transcoder.ServeHTTP)
				r.Post("/intelligence/ask-notes", transcoder.ServeHTTP)
				r.Post("/intelligence/brief/ack", transcoder.ServeHTTP)
				r.Get("/intelligence/memory/stats", transcoder.ServeHTTP)
			},
			Background: []func(context.Context){
				func(ctx context.Context) { go worker.Run(ctx) },
			},
		},
		Memory: memory,
		Hook:   newIntelligenceMemoryHook(memory, d.Log),
	}
}

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

// intelFocusReader реализует intelDomain.FocusReader через hone_streak_days.
type intelFocusReader struct{ pool *pgxpool.Pool }

func (r *intelFocusReader) LastNDays(ctx context.Context, userID uuid.UUID, n int) ([]intelDomain.FocusDay, error) {
	if n <= 0 || n > 60 {
		n = 7
	}
	rows, err := r.pool.Query(ctx,
		`SELECT day, focused_seconds, sessions_count
		   FROM hone_streak_days
		  WHERE user_id=$1 AND day >= CURRENT_DATE - $2::int
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
