// Memory layer use case — Append + Recall + Stats.
//
// Append fire-and-forget: пишем episode в БД мгновенно (без embedding),
// async-worker (embed_worker.go) подберёт. Это держит hot-path юзера
// независимым от Ollama latency.
//
// Recall комбинирует semantic top-K и recency-tail per-kind: дёшево
// и работает даже если worker отстал — recency-tail доставит свежие
// эпизоды без embedding'а.
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// Memory wraps the EpisodeRepo + Embedder. Single instance per process —
// все retrofitted use cases (DailyBrief / AskNotes / hone-hooks) дёргают
// этот.
type Memory struct {
	Episodes domain.EpisodeRepo
	Embed    domain.Embedder
	Log      *slog.Logger
	Now      func() time.Time
}

// AppendInput — параметры одной записи. Embedding async; payload
// произвольный JSON-структурированный (json.Marshal вызывает caller).
type AppendInput struct {
	UserID     uuid.UUID
	Kind       domain.EpisodeKind
	Summary    string
	Payload    any // marshal'ится в jsonb; nil = '{}'
	OccurredAt time.Time
}

// Append пишет episode без embedding'а. Возврат — только I/O ошибка
// (типа БД недоступна). Caller обычно игнорирует — fire-and-forget.
func (m *Memory) Append(ctx context.Context, in AppendInput) error {
	if !in.Kind.IsValid() {
		return fmt.Errorf("intelligence.Memory.Append: invalid kind %q", in.Kind)
	}
	if in.UserID == uuid.Nil {
		return fmt.Errorf("intelligence.Memory.Append: zero user_id")
	}
	var payloadBytes []byte
	if in.Payload != nil {
		b, err := json.Marshal(in.Payload)
		if err != nil {
			return fmt.Errorf("intelligence.Memory.Append: marshal payload: %w", err)
		}
		payloadBytes = b
	}
	occ := in.OccurredAt
	if occ.IsZero() {
		occ = m.Now().UTC()
	}
	if err := m.Episodes.Append(ctx, domain.Episode{
		UserID:     in.UserID,
		Kind:       in.Kind,
		Summary:    truncate(in.Summary, 1500),
		Payload:    payloadBytes,
		OccurredAt: occ,
	}); err != nil {
		return fmt.Errorf("intelligence.Memory.Append: %w", err)
	}
	return nil
}

// AppendAsync — fire-and-forget wrapper для side-effect hooks из hone.
// Ошибки логируются, не пробрасываются — coach-memory ОПЦИОНАЛЬНА для
// hot-path'а юзера.
func (m *Memory) AppendAsync(ctx context.Context, in AppendInput) {
	go func() {
		// Используем background ctx — caller'ский context может уже
		// закрыться (например HTTP-request завершился). Memory append
		// должен дойти.
		bg, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := m.Append(bg, in); err != nil && m.Log != nil {
			m.Log.Warn("intelligence.Memory.AppendAsync: drop",
				slog.String("kind", string(in.Kind)),
				slog.String("user_id", in.UserID.String()),
				slog.Any("err", err))
		}
	}()
}

// RecallParams — параметры выборки.
type RecallParams struct {
	UserID        uuid.UUID
	Query         string               // текст для embedding (context vector)
	Kinds         []domain.EpisodeKind // optional фильтр по kinds
	SinceDays     int                  // 0 = неограничено
	K             int                  // top-K по cosine similarity
	PerKindRecent int                  // плюс N самых свежих от каждого kind
}

// Recall возвращает top-K по семантике + per-kind recency-tail.
// Дедупликация по ID; финальный порядок — semantic-first затем recent.
//
// Если Embed недоступен (Ollama down) или Query пустой — пропускаем
// semantic-часть, отдаём только recency-tail. Это «soft-degrade»: Coach
// всё равно знает свою историю.
func (m *Memory) Recall(ctx context.Context, p RecallParams) ([]domain.Episode, error) {
	if p.UserID == uuid.Nil {
		return nil, fmt.Errorf("intelligence.Memory.Recall: zero user_id")
	}
	if p.K <= 0 {
		p.K = 8
	}
	if p.PerKindRecent < 0 {
		p.PerKindRecent = 0
	}

	out := make(map[uuid.UUID]domain.Episode)

	// 1. Semantic top-K.
	if p.Query != "" && m.Embed != nil {
		vec, _, err := m.Embed.Embed(ctx, p.Query)
		if err == nil && len(vec) > 0 {
			scored, sErr := m.Episodes.SearchSimilar(ctx, p.UserID, vec, p.Kinds, p.K)
			if sErr != nil && m.Log != nil {
				m.Log.Warn("intelligence.Memory.Recall: semantic search failed",
					slog.Any("err", sErr))
			}
			for _, h := range scored {
				if !p.withinTime(h.OccurredAt, m.Now()) {
					continue
				}
				out[h.ID] = h.Episode
			}
		} else if err != nil && m.Log != nil {
			m.Log.Debug("intelligence.Memory.Recall: embed failed (degrading to recency)",
				slog.Any("err", err))
		}
	}

	// 2. Per-kind recency tail.
	if p.PerKindRecent > 0 && len(p.Kinds) > 0 {
		for _, k := range p.Kinds {
			rows, err := m.Episodes.LatestByKind(ctx, p.UserID, k, p.PerKindRecent)
			if err != nil {
				if m.Log != nil {
					m.Log.Warn("intelligence.Memory.Recall: latest by kind failed",
						slog.String("kind", string(k)), slog.Any("err", err))
				}
				continue
			}
			for _, ep := range rows {
				if !p.withinTime(ep.OccurredAt, m.Now()) {
					continue
				}
				out[ep.ID] = ep
			}
		}
	}

	// 3. Sort: by occurred_at DESC (recent first — короткий контекст для LLM).
	res := make([]domain.Episode, 0, len(out))
	for _, ep := range out {
		res = append(res, ep)
	}
	sort.Slice(res, func(i, j int) bool {
		return res[i].OccurredAt.After(res[j].OccurredAt)
	})
	return res, nil
}

// AckRecommendation пишет brief_followed / brief_dismissed по конкретному
// recommendation index'у. briefID — UUID brief'а (есть в payload каждого
// brief_emitted episode'а; client получил его через DailyBrief proto).
func (m *Memory) AckRecommendation(ctx context.Context, userID, briefID uuid.UUID, index int, followed bool) error {
	recs, err := m.Episodes.GetBriefRecommendations(ctx, briefID)
	if err != nil {
		return fmt.Errorf("intelligence.Memory.AckRecommendation: %w", err)
	}
	if index < 0 || index >= len(recs) {
		return fmt.Errorf("intelligence.Memory.AckRecommendation: index %d out of [0,%d)", index, len(recs))
	}
	rec := recs[index]
	kind := domain.EpisodeBriefDismissed
	if followed {
		kind = domain.EpisodeBriefFollowed
	}
	payload := map[string]any{
		"brief_id":  briefID.String(),
		"index":     index,
		"rec_kind":  string(rec.Kind),
		"target_id": rec.TargetID,
	}
	return m.Append(ctx, AppendInput{
		UserID:  userID,
		Kind:    kind,
		Summary: rec.Title,
		Payload: payload,
	})
}

// withinTime проверяет SinceDays-окно. Day 0 = неограничено.
func (p RecallParams) withinTime(t time.Time, now time.Time) bool {
	if p.SinceDays <= 0 {
		return true
	}
	threshold := now.Add(-time.Duration(p.SinceDays) * 24 * time.Hour)
	return t.After(threshold)
}

// truncate обрезает summary до n чаров без рваных utf-8 (rune-aware).
func truncate(s string, n int) string {
	if n <= 0 || len(s) <= n {
		return s
	}
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "…"
}
