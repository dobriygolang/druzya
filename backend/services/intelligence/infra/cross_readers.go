// Cross-product readers (raw SQL) — Coach prompt объединяет сигналы из
// Hone (focus, queue, notes) и druz9 mock-interview (mock_sessions).
// Все adapter'ы здесь — чтобы intelligence-domain не импортировал
// чужие infra-пакеты.
package infra

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"druz9/intelligence/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── MockReader: services/ai_mock domain ──

// MockReader implements domain.MockReader over mock_sessions.
type MockReader struct{ pool *pgxpool.Pool }

// NewMockReader wraps a pool.
func NewMockReader(pool *pgxpool.Pool) *MockReader { return &MockReader{pool: pool} }

// LastNFinished returns last N finished mock-interview sessions с distilled
// score + weak topics из ai_report JSONB.
//
// ai_report shape ожидается такая (см. ai_mock domain):
//
//	{ "score": 7, "weak_topics": ["capacity-estimation", "load-balancing"], ... }
//
// Если поля отсутствуют / другой shape — score=0, weak_topics=nil. Не валим
// reader: даже факт «мок был» — сигнал для Coach.
func (r *MockReader) LastNFinished(ctx context.Context, userID uuid.UUID, n int) ([]domain.MockSessionSummary, error) {
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
		return nil, fmt.Errorf("intelligence.MockReader: %w", err)
	}
	defer rows.Close()
	out := make([]domain.MockSessionSummary, 0, n)
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
			return nil, fmt.Errorf("intelligence.MockReader: scan: %w", err)
		}
		s := domain.MockSessionSummary{
			SessionID:   sharedpg.UUIDFrom(id),
			Section:     section,
			Difficulty:  difficulty,
			Status:      status,
			DurationMin: int(durationMin),
		}
		if finishedAt != nil {
			s.FinishedAt = *finishedAt
		}
		// Best-effort parse ai_report.{score, weak_topics}. Raw bytes
		// сохраняем для consumer'ов которым нужен per-axis breakdown
		// (skill radar и т.п.).
		if len(report) > 0 {
			s.AIReportRaw = append(s.AIReportRaw, report...)
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
		return nil, fmt.Errorf("intelligence.MockReader: rows: %w", err)
	}
	return out, nil
}

// RecentAbandonedCount — Phase 4.7. Single COUNT(*) хватит: мы используем
// только число для severity grader'а (детали abandoned mocks coach не
// показывает, чтобы не превращать brief в naming-and-shaming).
func (r *MockReader) RecentAbandonedCount(ctx context.Context, userID uuid.UUID, sinceDays int) (int, error) {
	if sinceDays <= 0 {
		sinceDays = 14
	}
	var n int32
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*)::int4
		   FROM mock_sessions
		  WHERE user_id = $1
		    AND status = 'abandoned'
		    AND created_at >= now() - ($2 || ' days')::interval`,
		sharedpg.UUID(userID), fmt.Sprintf("%d", sinceDays),
	).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("intelligence.MockReader.RecentAbandonedCount: %w", err)
	}
	return int(n), nil
}

// ── QueueReader: services/hone Focus Queue domain ──

// QueueReader implements domain.QueueReader over hone_queue_items.
type QueueReader struct{ pool *pgxpool.Pool }

// NewQueueReader wraps a pool.
func NewQueueReader(pool *pgxpool.Pool) *QueueReader { return &QueueReader{pool: pool} }

func (r *QueueReader) TodaySnapshot(ctx context.Context, userID uuid.UUID) (domain.QueueSnapshot, error) {
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
		return domain.QueueSnapshot{}, fmt.Errorf("intelligence.QueueReader: %w", err)
	}
	defer rows.Close()
	snap := domain.QueueSnapshot{Items: make([]domain.QueueLine, 0)}
	for rows.Next() {
		var line domain.QueueLine
		if err := rows.Scan(&line.Title, &line.Source, &line.Status, &line.SkillKey); err != nil {
			return domain.QueueSnapshot{}, fmt.Errorf("intelligence.QueueReader: scan: %w", err)
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
		return snap, fmt.Errorf("intelligence.QueueReader rows: %w", err)
	}
	return snap, nil
}

// ── SkillReader: Skill Atlas weakest nodes ──
//
// Uses skill_progress table directly (mirror hone.SkillAtlasReader).
// Lower progress = weaker. Take top-N ascending.

// SkillReader implements domain.SkillReader over skill_progress + skills.
type SkillReader struct{ pool *pgxpool.Pool }

// NewSkillReader wraps a pool.
func NewSkillReader(pool *pgxpool.Pool) *SkillReader { return &SkillReader{pool: pool} }

func (r *SkillReader) WeakestN(ctx context.Context, userID uuid.UUID, n int) ([]domain.SkillWeak, error) {
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
	out := make([]domain.SkillWeak, 0, n)
	for rows.Next() {
		var w domain.SkillWeak
		var prog int32
		if err := rows.Scan(&w.SkillKey, &w.Title, &prog); err != nil {
			return nil, fmt.Errorf("intelligence.SkillReader: scan: %w", err)
		}
		w.Progress = int(prog)
		out = append(out, w)
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("intelligence reader rows: %w", err)
	}
	return out, nil
}

// ── DailyNoteReader: hone_notes с title prefix='Daily ' ──

// DailyNoteReader implements domain.DailyNoteReader over hone_notes.
type DailyNoteReader struct{ pool *pgxpool.Pool }

// NewDailyNoteReader wraps a pool.
func NewDailyNoteReader(pool *pgxpool.Pool) *DailyNoteReader { return &DailyNoteReader{pool: pool} }

func (r *DailyNoteReader) RecentDailyNotes(ctx context.Context, userID uuid.UUID, n int) ([]domain.DailyNoteHead, error) {
	if n <= 0 || n > 14 {
		n = 3
	}
	// v2: archived_at column dropped (hard delete only) — фильтр не нужен.
	rows, err := r.pool.Query(ctx,
		`SELECT updated_at, LEFT(body_md, 400)
		   FROM hone_notes
		  WHERE user_id=$1 AND title LIKE 'Daily %'
		    AND body_md IS NOT NULL AND body_md != ''
		  ORDER BY updated_at DESC
		  LIMIT $2`,
		sharedpg.UUID(userID), n,
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.DailyNoteReader: %w", err)
	}
	defer rows.Close()
	out := make([]domain.DailyNoteHead, 0, n)
	for rows.Next() {
		var h domain.DailyNoteHead
		if err := rows.Scan(&h.Day, &h.Excerpt); err != nil {
			return nil, fmt.Errorf("intelligence.DailyNoteReader: scan: %w", err)
		}
		out = append(out, h)
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("intelligence reader rows: %w", err)
	}
	return out, nil
}

// ── MockMessagesReader: keyword-frequency analysis ──
//
// Извлекает top-N keywords из user-content'а mock_messages за окно
// withinDays. Алгоритм: split по non-letter, lowercase, отсекаем
// stop-words + слова <3 символов, группируем по terms, top-N по count.
//
// Это не embeddings-based topic-model, но достаточно для prompt'а:
// нужны hot topics юзера, не глубокий cluster analysis.

// MockMessagesReader implements domain.MockMessagesReader over mock_messages.
type MockMessagesReader struct{ pool *pgxpool.Pool }

// NewMockMessagesReader wraps a pool.
func NewMockMessagesReader(pool *pgxpool.Pool) *MockMessagesReader {
	return &MockMessagesReader{pool: pool}
}

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

func (r *MockMessagesReader) TopKeywords(ctx context.Context, userID uuid.UUID, withinDays, topN int) ([]domain.MockKeywords, error) {
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
		return nil, fmt.Errorf("intelligence.MockMessagesReader: %w", err)
	}
	defer rows.Close()
	freq := map[string]int{}
	for rows.Next() {
		var content string
		if err := rows.Scan(&content); err != nil {
			return nil, fmt.Errorf("intelligence.MockMessagesReader: scan: %w", err)
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
		return nil, fmt.Errorf("intelligence.MockMessagesReader rows: %w", err)
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
	out := make([]domain.MockKeywords, 0, topN)
	for i := 0; i < topN && len(all) > 0; i++ {
		best := 0
		for j := range all {
			if all[j].c > all[best].c {
				best = j
			}
		}
		out = append(out, domain.MockKeywords{Keyword: all[best].k, Count: all[best].c})
		all = append(all[:best], all[best+1:]...)
	}
	return out, nil
}

// ── TrackReader: services/tracks user_tracks + track_steps ──

// TrackReader implements domain.TrackReader over user_tracks +
// track_steps. Adapter lives here (not in services/tracks/infra) so
// intelligence stays the single owner of cross-product reads.
type TrackReader struct{ pool *pgxpool.Pool }

// NewTrackReader wires the adapter.
func NewTrackReader(pool *pgxpool.Pool) *TrackReader {
	return &TrackReader{pool: pool}
}

// ActiveTracks returns the user's non-completed tracks with current-step
// info + days-since-last-touch.
func (r *TrackReader) ActiveTracks(ctx context.Context, userID uuid.UUID) ([]domain.ActiveTrack, error) {
	rows, err := r.pool.Query(ctx, `
        SELECT
            t.id, t.slug, t.name,
            ut.current_step,
            COALESCE((SELECT COUNT(*) FROM track_steps ts WHERE ts.track_id = t.id), 0) AS steps_total,
            COALESCE(s.title, '')                  AS step_title,
            COALESCE(s.skill_keys, '{}'::text[])   AS step_skill_keys,
            COALESCE(s.estimated_minutes, 0)       AS step_minutes,
            ut.paused_at IS NOT NULL               AS is_paused,
            (
                SELECT EXTRACT(EPOCH FROM (now() - MAX(fs.ended_at)))::int / 86400
                  FROM hone_focus_sessions fs
                 WHERE fs.user_id = $1
                   AND s.skill_keys IS NOT NULL
                   AND s.skill_keys && ARRAY[fs.skill_key]
            ) AS days_since
          FROM user_tracks ut
          JOIN tracks t ON t.id = ut.track_id
          LEFT JOIN track_steps s
                 ON s.track_id   = ut.track_id
                AND s.step_index = ut.current_step
         WHERE ut.user_id = $1
           AND ut.completed_at IS NULL
         ORDER BY ut.paused_at IS NOT NULL ASC, ut.joined_at DESC
         LIMIT 5`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.TrackReader: %w", err)
	}
	defer rows.Close()
	out := make([]domain.ActiveTrack, 0, 4)
	for rows.Next() {
		var (
			tID                   pgtype.UUID
			slug, name, stepTitle string
			currentStep           int16
			stepsTotal            int64
			skillKeys             []string
			stepMinutes           int32
			isPaused              bool
			days                  pgtype.Int4
		)
		if err := rows.Scan(&tID, &slug, &name, &currentStep, &stepsTotal,
			&stepTitle, &skillKeys, &stepMinutes, &isPaused, &days); err != nil {
			return nil, fmt.Errorf("intelligence.TrackReader: scan: %w", err)
		}
		daysSince := 999
		if days.Valid {
			daysSince = int(days.Int32)
			if daysSince < 0 {
				daysSince = 0
			}
		}
		out = append(out, domain.ActiveTrack{
			TrackID:            sharedpg.UUIDFrom(tID),
			Slug:               slug,
			Name:               name,
			CurrentStep:        int(currentStep),
			StepsTotal:         int(stepsTotal),
			CurrentStepTitle:   stepTitle,
			CurrentStepSkills:  skillKeys,
			EstimatedMinutes:   int(stepMinutes),
			IsPaused:           isPaused,
			DaysSinceLastTouch: daysSince,
		})
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("intelligence.TrackReader: rows: %w", err)
	}
	return out, nil
}

// Compile-time guard.
var _ domain.TrackReader = (*TrackReader)(nil)

// ── ClubReader: services/clubs club_attendees + club_sessions (Phase 3) ──

// ClubReader implements domain.ClubReader over club_attendees +
// club_sessions. Live в этом пакете (а не в services/clubs/infra) — same
// reasoning как у TrackReader: intelligence сам владеет cross-product
// reads, чтобы клубы не тащили intelligence/domain.
type ClubReader struct{ pool *pgxpool.Pool }

// NewClubReader wires the adapter.
func NewClubReader(pool *pgxpool.Pool) *ClubReader {
	return &ClubReader{pool: pool}
}

// GhostedSessions — past windowDays сессии где user RSVP'd_yes но
// статус остался rsvp_yes (никто не проставил attended). Только сессии
// в статусе 'done' — cancelled не считаем (там не было шанса dropout'нуть).
func (r *ClubReader) GhostedSessions(ctx context.Context, userID uuid.UUID, windowDays int) ([]domain.GhostedClubSession, error) {
	if windowDays <= 0 || windowDays > 60 {
		windowDays = 7
	}
	rows, err := r.pool.Query(ctx, `
		SELECT c.name, s.topic_title,
		       (EXTRACT(EPOCH FROM (now() - s.scheduled_at))::int / 86400) AS days_ago
		  FROM club_attendees a
		  JOIN club_sessions s ON s.id = a.session_id
		  JOIN clubs c         ON c.id = s.club_id
		 WHERE a.user_id = $1
		   AND a.status  = 'rsvp_yes'
		   AND s.status  = 'done'
		   AND s.scheduled_at >= now() - ($2 || ' days')::interval
		   AND s.scheduled_at < now()
		 ORDER BY s.scheduled_at DESC
		 LIMIT 5`,
		sharedpg.UUID(userID), fmt.Sprintf("%d", windowDays),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.ClubReader: %w", err)
	}
	defer rows.Close()
	out := make([]domain.GhostedClubSession, 0, 4)
	for rows.Next() {
		var (
			club, topic string
			ago         int32
		)
		if err := rows.Scan(&club, &topic, &ago); err != nil {
			return nil, fmt.Errorf("intelligence.ClubReader: scan: %w", err)
		}
		if ago < 0 {
			ago = 0
		}
		out = append(out, domain.GhostedClubSession{
			ClubName: club, TopicTitle: topic, HappenedAgo: int(ago),
		})
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("intelligence.ClubReader: rows: %w", err)
	}
	return out, nil
}

// Compile-time guard.
var _ domain.ClubReader = (*ClubReader)(nil)

// ── GoalsReader: services/intelligence user_goals (Phase 4.3) ──

// GoalsReader implements domain.GoalsReader over user_goals. Lives here
// (а не в services/<owner>/infra) потому что user_goals — собственная
// таблица intelligence-context'а: цели читает только coach, других
// потребителей нет.
type GoalsReader struct{ pool *pgxpool.Pool }

// NewGoalsReader wires the adapter.
func NewGoalsReader(pool *pgxpool.Pool) *GoalsReader {
	return &GoalsReader{pool: pool}
}

// ActiveGoals returns up to 8 active user goals, ordered by deadline
// (NULLS LAST так что job_target с дедлайном перевешивает skill_target
// без срока). DaysToDeadline pre-computed:
//   - -1 если deadline NULL,
//   - 0 если deadline = today,
//   - N если deadline через N days,
//   - отрицательное N если deadline просрочен (coach всё равно увидит,
//     это сигнал «надо подбить итог или сдвинуть»).
func (r *GoalsReader) ActiveGoals(ctx context.Context, userID uuid.UUID) ([]domain.UserGoal, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, kind, title, notes_md, deadline, track_id, skill_keys, created_at,
		       CASE
		         WHEN deadline IS NULL THEN -1
		         ELSE (deadline - CURRENT_DATE)::int
		       END AS days_to_deadline
		  FROM user_goals
		 WHERE user_id = $1
		   AND status  = 'active'
		 ORDER BY deadline NULLS LAST, created_at DESC
		 LIMIT 8`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.GoalsReader: %w", err)
	}
	defer rows.Close()
	out := make([]domain.UserGoal, 0, 4)
	for rows.Next() {
		var (
			id, trackID    pgtype.UUID
			kind, title    string
			notesMD        string
			deadline       *time.Time
			skillKeys      []string
			createdAt      time.Time
			daysToDeadline int32
		)
		if err := rows.Scan(&id, &kind, &title, &notesMD, &deadline,
			&trackID, &skillKeys, &createdAt, &daysToDeadline); err != nil {
			return nil, fmt.Errorf("intelligence.GoalsReader: scan: %w", err)
		}
		g := domain.UserGoal{
			ID:             sharedpg.UUIDFrom(id),
			Kind:           domain.UserGoalKind(kind),
			Status:         "active", // ActiveGoals filters by status; не из row.
			Title:          title,
			NotesMD:        notesMD,
			Deadline:       deadline,
			DaysToDeadline: int(daysToDeadline),
			SkillKeys:      skillKeys,
			CreatedAt:      createdAt,
		}
		if trackID.Valid {
			tid := sharedpg.UUIDFrom(trackID)
			g.TrackID = &tid
		}
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.GoalsReader: rows: %w", err)
	}
	return out, nil
}

var _ domain.GoalsReader = (*GoalsReader)(nil)
var _ domain.GoalsRepo = (*GoalsReader)(nil)

// ListByUser — full goals list (any status), newest first. Used by the
// /goals page to render archive/paused goals alongside active.
func (r *GoalsReader) ListByUser(ctx context.Context, userID uuid.UUID) ([]domain.UserGoal, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, kind, title, notes_md, deadline, track_id, skill_keys, created_at,
		       CASE WHEN deadline IS NULL THEN -1
		            ELSE (deadline - CURRENT_DATE)::int END AS days_to_deadline,
		       status
		  FROM user_goals
		 WHERE user_id = $1
		 ORDER BY (status = 'active') DESC,
		          deadline NULLS LAST,
		          created_at DESC`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.GoalsReader.ListByUser: %w", err)
	}
	defer rows.Close()
	out := make([]domain.UserGoal, 0, 8)
	for rows.Next() {
		var (
			id, trackID    pgtype.UUID
			kind, title    string
			notesMD        string
			deadline       *time.Time
			skillKeys      []string
			createdAt      time.Time
			daysToDeadline int32
			status         string
		)
		if err := rows.Scan(&id, &kind, &title, &notesMD, &deadline,
			&trackID, &skillKeys, &createdAt, &daysToDeadline, &status); err != nil {
			return nil, fmt.Errorf("intelligence.GoalsReader.ListByUser: scan: %w", err)
		}
		g := domain.UserGoal{
			ID:             sharedpg.UUIDFrom(id),
			Kind:           domain.UserGoalKind(kind),
			Status:         status,
			Title:          title,
			NotesMD:        notesMD,
			Deadline:       deadline,
			DaysToDeadline: int(daysToDeadline),
			SkillKeys:      skillKeys,
			CreatedAt:      createdAt,
		}
		if trackID.Valid {
			tid := sharedpg.UUIDFrom(trackID)
			g.TrackID = &tid
		}
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.GoalsReader.ListByUser: rows: %w", err)
	}
	return out, nil
}

// Create inserts an active goal. Status defaults to 'active' on the SQL
// side (column default). Skill_keys + deadline + track_id all nullable —
// caller передаёт zero values когда нужно.
func (r *GoalsReader) Create(ctx context.Context, in domain.CreateGoalInput) (domain.UserGoal, error) {
	if in.Title == "" {
		return domain.UserGoal{}, fmt.Errorf("intelligence.GoalsReader.Create: empty title")
	}
	if !goalKindIsValid(in.Kind) {
		return domain.UserGoal{}, fmt.Errorf("intelligence.GoalsReader.Create: invalid kind %q", in.Kind)
	}
	skillKeys := in.SkillKeys
	if skillKeys == nil {
		skillKeys = []string{}
	}
	var trackID pgtype.UUID
	if in.TrackID != nil {
		trackID = sharedpg.UUID(*in.TrackID)
	}
	var (
		id        pgtype.UUID
		createdAt time.Time
		updatedAt time.Time
	)
	err := r.pool.QueryRow(ctx, `
		INSERT INTO user_goals (user_id, kind, title, notes_md, deadline, track_id, skill_keys)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at, updated_at`,
		sharedpg.UUID(in.UserID), string(in.Kind), in.Title, in.NotesMD,
		nullableDate(in.Deadline), trackID, skillKeys,
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		return domain.UserGoal{}, fmt.Errorf("intelligence.GoalsReader.Create: %w", err)
	}
	out := domain.UserGoal{
		ID:        sharedpg.UUIDFrom(id),
		Kind:      in.Kind,
		Status:    "active",
		Title:     in.Title,
		NotesMD:   in.NotesMD,
		Deadline:  in.Deadline,
		SkillKeys: skillKeys,
		CreatedAt: createdAt,
	}
	if in.Deadline != nil {
		days := int(in.Deadline.UTC().Truncate(24*time.Hour).Sub(time.Now().UTC().Truncate(24*time.Hour)).Hours() / 24)
		out.DaysToDeadline = days
	} else {
		out.DaysToDeadline = -1
	}
	if in.TrackID != nil {
		tid := *in.TrackID
		out.TrackID = &tid
	}
	return out, nil
}

// UpdateStatus changes status (active/paused/done/abandoned). Done flips
// completed_at; transitions back to active clear it.
func (r *GoalsReader) UpdateStatus(ctx context.Context, userID, goalID uuid.UUID, status string) (domain.UserGoal, error) {
	if !goalStatusIsValid(status) {
		return domain.UserGoal{}, fmt.Errorf("intelligence.GoalsReader.UpdateStatus: invalid status %q", status)
	}
	var completedExpr string
	if status == "done" {
		completedExpr = "now()"
	} else {
		completedExpr = "NULL"
	}
	cmd, err := r.pool.Exec(ctx, fmt.Sprintf(`
		UPDATE user_goals
		   SET status       = $3,
		       completed_at = %s,
		       updated_at   = now()
		 WHERE id = $1 AND user_id = $2`, completedExpr),
		sharedpg.UUID(goalID), sharedpg.UUID(userID), status,
	)
	if err != nil {
		return domain.UserGoal{}, fmt.Errorf("intelligence.GoalsReader.UpdateStatus: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.UserGoal{}, domain.ErrNotFound
	}
	// Re-read updated row for caller convenience.
	rows, err := r.pool.Query(ctx, `
		SELECT id, kind, title, notes_md, deadline, track_id, skill_keys, created_at,
		       CASE WHEN deadline IS NULL THEN -1
		            ELSE (deadline - CURRENT_DATE)::int END AS days_to_deadline,
		       status
		  FROM user_goals WHERE id = $1`,
		sharedpg.UUID(goalID),
	)
	if err != nil {
		return domain.UserGoal{}, fmt.Errorf("intelligence.GoalsReader.UpdateStatus: re-read: %w", err)
	}
	defer rows.Close()
	if !rows.Next() {
		return domain.UserGoal{}, domain.ErrNotFound
	}
	var (
		id, trackID    pgtype.UUID
		kind, title    string
		notesMD        string
		deadline       *time.Time
		skillKeys      []string
		createdAt      time.Time
		daysToDeadline int32
		newStatus      string
	)
	if err := rows.Scan(&id, &kind, &title, &notesMD, &deadline,
		&trackID, &skillKeys, &createdAt, &daysToDeadline, &newStatus); err != nil {
		return domain.UserGoal{}, fmt.Errorf("intelligence.GoalsReader.UpdateStatus: scan: %w", err)
	}
	out := domain.UserGoal{
		ID:             sharedpg.UUIDFrom(id),
		Kind:           domain.UserGoalKind(kind),
		Status:         newStatus,
		Title:          title,
		NotesMD:        notesMD,
		Deadline:       deadline,
		DaysToDeadline: int(daysToDeadline),
		SkillKeys:      skillKeys,
		CreatedAt:      createdAt,
	}
	if trackID.Valid {
		tid := sharedpg.UUIDFrom(trackID)
		out.TrackID = &tid
	}
	return out, nil
}

// Delete removes a goal. Scoped to the owner so no cross-user deletes.
func (r *GoalsReader) Delete(ctx context.Context, userID, goalID uuid.UUID) error {
	cmd, err := r.pool.Exec(ctx,
		`DELETE FROM user_goals WHERE id = $1 AND user_id = $2`,
		sharedpg.UUID(goalID), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("intelligence.GoalsReader.Delete: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ── helpers ──────────────────────────────────────────────────────────

func goalKindIsValid(k domain.UserGoalKind) bool {
	switch k {
	case domain.UserGoalKindJob, domain.UserGoalKindSkill, domain.UserGoalKindTrack:
		return true
	}
	return false
}

func goalStatusIsValid(s string) bool {
	switch s {
	case "active", "paused", "done", "abandoned":
		return true
	}
	return false
}

func nullableDate(t *time.Time) any {
	if t == nil {
		return nil
	}
	return *t
}

// ── ExternalActivityReader: services/hone external_activity (миграция 00037) ──

// ExternalActivityReader реализует domain.ExternalActivityReader поверх
// external_activity-таблицы. Используется DailyBrief'ом и ai_tutor
// SnapshotProvider'ом для cross-track recall (Sergey учится SQL на
// LeetCode, math на Coursera, python где-то ещё — coach должен видеть).
type ExternalActivityReader struct{ pool *pgxpool.Pool }

func NewExternalActivityReader(pool *pgxpool.Pool) *ExternalActivityReader {
	return &ExternalActivityReader{pool: pool}
}

func (r *ExternalActivityReader) SummaryWindow(
	ctx context.Context,
	userID uuid.UUID,
	days int,
) (domain.ExternalActivitySummary, error) {
	if days <= 0 || days > 90 {
		days = 7
	}
	since := time.Now().UTC().Add(-time.Duration(days) * 24 * time.Hour)

	// Single row aggregate + 2 small lists. Делать один JOIN ради
	// «top topics» дороже чем три коротких запроса по индексу
	// idx_external_activity_user_date.
	const aggSQL = `
		SELECT
		    COALESCE(SUM(duration_min), 0)::int AS total_min,
		    COALESCE(array_agg(DISTINCT source) FILTER (WHERE source IS NOT NULL), '{}') AS sources
		FROM external_activity
		WHERE user_id = $1 AND occurred_at >= $2`
	out := domain.ExternalActivitySummary{}
	err := r.pool.QueryRow(ctx, aggSQL, pgtype.UUID{Bytes: userID, Valid: true}, since).
		Scan(&out.MinutesWindow, &out.Sources)
	if err != nil {
		return domain.ExternalActivitySummary{}, fmt.Errorf("ExternalActivityReader.SummaryWindow agg: %w", err)
	}
	if out.MinutesWindow == 0 {
		return out, nil
	}

	// Top-3 topics: prefer atlas-node title (JOIN на atlas_nodes для
	// title); если ничего, fallback на topic_free_text. Группируем по
	// (atlas_node_id, free_text), сортируем по total minutes за окно.
	const topicsSQL = `
		SELECT COALESCE(an.title, e.topic_free_text) AS label,
		       SUM(e.duration_min) AS mins
		FROM external_activity e
		LEFT JOIN atlas_nodes an ON an.id = e.topic_atlas_node_id
		WHERE e.user_id = $1 AND e.occurred_at >= $2
		GROUP BY label
		ORDER BY mins DESC
		LIMIT 3`
	rows, err := r.pool.Query(ctx, topicsSQL, pgtype.UUID{Bytes: userID, Valid: true}, since)
	if err != nil {
		return out, fmt.Errorf("ExternalActivityReader.SummaryWindow topics: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var label string
		var mins int
		if err := rows.Scan(&label, &mins); err != nil {
			return out, fmt.Errorf("ExternalActivityReader.SummaryWindow topics scan: %w", err)
		}
		if label == "" {
			continue
		}
		out.TopTopics = append(out.TopTopics, label)
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("ExternalActivityReader.SummaryWindow topics rows: %w", err)
	}
	return out, nil
}

// ── ResourceEngagementReader: services/learning-companion user_resource_log (00055) ──
//
// Phase 1.7c. Источник для RESOURCE TRAIL prompt block + resource_engagement
// producer (Phase 1.7d). _ = json чтобы не дёргать драйверов (см ниже:
// reflection_text — обычная text-колонка, не jsonb).

type ResourceEngagementReader struct{ pool *pgxpool.Pool }

func NewResourceEngagementReader(pool *pgxpool.Pool) *ResourceEngagementReader {
	return &ResourceEngagementReader{pool: pool}
}

func (r *ResourceEngagementReader) EngagementWindow(
	ctx context.Context,
	userID uuid.UUID,
	days, keepRecent int,
) (domain.ResourceEngagement, error) {
	if days <= 0 {
		days = 7
	}
	if keepRecent <= 0 || keepRecent > 25 {
		keepRecent = 5
	}
	since := time.Now().Add(-time.Duration(days) * 24 * time.Hour)

	out := domain.ResourceEngagement{}

	// Per-kind sweep — single query, фильтруем по kind на app уровне.
	const eventsSQL = `
		SELECT resource_url, COALESCE(atlas_node_id, ''), kind, occurred_at,
		       COALESCE(reflection_text, '')
		  FROM user_resource_log
		 WHERE user_id = $1 AND occurred_at >= $2
		 ORDER BY occurred_at DESC`
	rows, err := r.pool.Query(ctx, eventsSQL, sharedpg.UUID(userID), since)
	if err != nil {
		return domain.ResourceEngagement{}, fmt.Errorf("ResourceEngagementReader.EngagementWindow: %w", err)
	}
	defer rows.Close()

	now := time.Now()
	clickedURLs := make(map[string]struct{})
	finishedURLs := make(map[string]struct{})
	skippedURLs := make(map[string]struct{})

	for rows.Next() {
		var (
			url, nodeID, kind, refl string
			occ                     time.Time
		)
		if err := rows.Scan(&url, &nodeID, &kind, &occ, &refl); err != nil {
			return domain.ResourceEngagement{}, fmt.Errorf("ResourceEngagementReader scan: %w", err)
		}
		touch := domain.ResourceTouch{
			URL:         url,
			AtlasNodeID: nodeID,
			Kind:        kind,
			OccurredAt:  occ,
			HoursAgo:    int(now.Sub(occ).Hours()),
			Reflection:  refl,
		}
		switch kind {
		case "clicked":
			clickedURLs[url] = struct{}{}
		case "finished":
			finishedURLs[url] = struct{}{}
			if len(out.FinishedRecent) < keepRecent {
				out.FinishedRecent = append(out.FinishedRecent, touch)
			}
		case "skipped":
			skippedURLs[url] = struct{}{}
		case "unhelpful":
			if len(out.MarkedUnhelpful) < keepRecent {
				out.MarkedUnhelpful = append(out.MarkedUnhelpful, touch)
			}
		case "reflection_submitted":
			if refl != "" && len(out.RecentReflections) < keepRecent {
				out.RecentReflections = append(out.RecentReflections, touch)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return domain.ResourceEngagement{}, fmt.Errorf("ResourceEngagementReader rows: %w", err)
	}

	// UnfinishedCount: clicked но не finished/skipped в окне.
	for url := range clickedURLs {
		if _, fin := finishedURLs[url]; fin {
			continue
		}
		if _, sk := skippedURLs[url]; sk {
			continue
		}
		out.UnfinishedCount++
	}
	return out, nil
}

// ── ForkProgressReader: services/learning_state + mock_sessions cross-ref ──
//
// Phase 1.7c. Источник для FORK STATUS prompt block (только при mode=='explore')
// + fork_progress producer (Phase 1.7d) + admin learning-state tab.
//
// Branch scoring rule:
//   - "mle": mock_sessions.section IN ('ml_eng')
//   - "de":  mock_sessions.section IN ('de')
// Voluntary-deep-dive count — number of distinct atlas_nodes под fork-cluster
// touched через user_resource_log (kind='clicked'|'finished') за explore окно.
//
// _ = json (no jsonb-decode здесь).

type ForkProgressReader struct{ pool *pgxpool.Pool }

func NewForkProgressReader(pool *pgxpool.Pool) *ForkProgressReader {
	return &ForkProgressReader{pool: pool}
}

func (r *ForkProgressReader) Snapshot(
	ctx context.Context,
	userID uuid.UUID,
) (domain.ForkProgressSnapshot, error) {
	out := domain.ForkProgressSnapshot{}

	// learning_state row (lazy-create в services/learning_state). Здесь
	// читаем напрямую — UC может быть не вызван ещё.
	var (
		mode             string
		fork             *string
		exploreStartedAt time.Time
	)
	err := r.pool.QueryRow(ctx,
		`SELECT mode, fork_branch, explore_started_at
		   FROM learning_state WHERE user_id = $1`,
		sharedpg.UUID(userID),
	).Scan(&mode, &fork, &exploreStartedAt)
	if err != nil {
		// Если строки нет — юзер default-explore, ExploreWeekIndex=1.
		// Проще вернуть empty snapshot чем валить prompt.
		if strings.Contains(err.Error(), "no rows") {
			return domain.ForkProgressSnapshot{
				Mode:             "explore",
				ExploreWeekIndex: 1,
			}, nil
		}
		return domain.ForkProgressSnapshot{}, fmt.Errorf("ForkProgressReader.Snapshot learning_state: %w", err)
	}
	out.Mode = mode
	if fork != nil {
		out.CurrentBranch = *fork
	}
	if mode == "explore" {
		weeks := int(time.Since(exploreStartedAt).Hours()/(24*7)) + 1
		if weeks < 1 {
			weeks = 1
		}
		out.ExploreWeekIndex = weeks
	}

	// Per-branch mock scores — последние finished mock_sessions с section
	// 'ml_eng' / 'de'. ai_report.overall_score сохраняем как float (0..100).
	const mocksSQL = `
		SELECT section, COALESCE((ai_report->>'overall_score')::float, 0) AS score
		  FROM mock_sessions
		 WHERE user_id = $1
		   AND status = 'finished'
		   AND section IN ('ml_eng', 'de')`
	rows, err := r.pool.Query(ctx, mocksSQL, sharedpg.UUID(userID))
	if err != nil {
		return out, fmt.Errorf("ForkProgressReader mocks: %w", err)
	}
	defer rows.Close()

	branchScores := map[string]*domain.ForkBranchScore{
		"mle": {Branch: "mle"},
		"de":  {Branch: "de"},
	}
	for rows.Next() {
		var section string
		var score float64
		if scanErr := rows.Scan(&section, &score); scanErr != nil {
			return out, fmt.Errorf("ForkProgressReader mocks scan: %w", scanErr)
		}
		key := "mle"
		if section == "de" {
			key = "de"
		}
		bs := branchScores[key]
		bs.MockCount++
		bs.AvgScore += score
	}
	if rerr := rows.Err(); rerr != nil {
		return out, fmt.Errorf("ForkProgressReader mocks iter: %w", rerr)
	}

	// Voluntary deep-dives — distinct atlas-nodes под cluster (ml/de),
	// touched через user_resource_log за explore окно.
	const dedupSQL = `
		SELECT COALESCE(an.cluster, ''), COUNT(DISTINCT url.atlas_node_id) AS dives
		  FROM user_resource_log url
		  JOIN atlas_nodes an ON an.id = url.atlas_node_id
		 WHERE url.user_id = $1
		   AND url.kind IN ('clicked', 'finished')
		   AND url.occurred_at >= $2
		   AND an.cluster IN ('ml', 'de', 'ml_platform')
		 GROUP BY an.cluster`
	since := exploreStartedAt
	if mode != "explore" {
		since = time.Now().Add(-30 * 24 * time.Hour) // последний месяц для commit/deep
	}
	dRows, err := r.pool.Query(ctx, dedupSQL, sharedpg.UUID(userID), since)
	if err != nil {
		return out, fmt.Errorf("ForkProgressReader deep-dives: %w", err)
	}
	defer dRows.Close()
	for dRows.Next() {
		var cluster string
		var dives int
		if err := dRows.Scan(&cluster, &dives); err != nil {
			return out, fmt.Errorf("ForkProgressReader deep-dives scan: %w", err)
		}
		key := "mle"
		if cluster == "de" {
			key = "de"
		}
		// ml + ml_platform оба считаются под "mle".
		branchScores[key].VoluntaryDeepDives += dives
	}
	if err := dRows.Err(); err != nil {
		return out, fmt.Errorf("ForkProgressReader deep-dives iter: %w", err)
	}

	// Финализируем avg + ordering.
	for _, bs := range branchScores {
		if bs.MockCount > 0 {
			bs.AvgScore /= float64(bs.MockCount)
		}
	}
	out.ScoresByBranch = []domain.ForkBranchScore{
		*branchScores["mle"],
		*branchScores["de"],
	}
	return out, nil
}

// keep unused import _ = json в reach (на случай если в reader'ах далее
// добавим jsonb-decode); не дёргает компилятор.
var _ = json.RawMessage(nil)
