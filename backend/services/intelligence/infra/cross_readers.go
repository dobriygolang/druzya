// Cross-product readers (raw SQL) — Coach prompt объединяет сигналы трёх
// продуктов: Hone (focus, queue, notes), druz9 mock-interview (mock_sessions),
// druz9 arena/codex (arena_matches, daily_kata_history). Все adapter'ы здесь —
// чтобы intelligence-domain не импортировал чужие infra-пакеты.
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
		return nil, fmt.Errorf("intelligence.MockReader: rows: %w", err)
	}
	return out, nil
}

// ── KataReader: services/daily domain ──

// KataReader implements domain.KataReader over daily_streaks + daily_kata_history.
type KataReader struct{ pool *pgxpool.Pool }

// NewKataReader wraps a pool.
func NewKataReader(pool *pgxpool.Pool) *KataReader { return &KataReader{pool: pool} }

func (r *KataReader) GetStreak(ctx context.Context, userID uuid.UUID) (domain.KataStreak, error) {
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
		return domain.KataStreak{}, nil //nolint:nilerr
	}
	return domain.KataStreak{
		Current:      int(current),
		Longest:      int(longest),
		LastKataDate: lastKataDate,
	}, nil
}

func (r *KataReader) LastNAttempts(ctx context.Context, userID uuid.UUID, n int) ([]domain.KataAttempt, error) {
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
		return nil, fmt.Errorf("intelligence.KataReader: %w", err)
	}
	defer rows.Close()
	out := make([]domain.KataAttempt, 0, n)
	for rows.Next() {
		var (
			day         time.Time
			passed      bool
			cursed      bool
			weeklyBoss  bool
			submittedAt *time.Time
		)
		if err := rows.Scan(&day, &passed, &cursed, &weeklyBoss, &submittedAt); err != nil {
			return nil, fmt.Errorf("intelligence.KataReader: scan: %w", err)
		}
		out = append(out, domain.KataAttempt{
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

// ── ArenaReader: services/arena domain ──

// ArenaReader implements domain.ArenaReader over arena_matches + arena_participants.
type ArenaReader struct{ pool *pgxpool.Pool }

// NewArenaReader wraps a pool.
func NewArenaReader(pool *pgxpool.Pool) *ArenaReader { return &ArenaReader{pool: pool} }

func (r *ArenaReader) LastNMatches(ctx context.Context, userID uuid.UUID, n int) ([]domain.ArenaMatchSummary, error) {
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
		return nil, fmt.Errorf("intelligence.ArenaReader: %w", err)
	}
	defer rows.Close()
	out := make([]domain.ArenaMatchSummary, 0, n)
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
			return nil, fmt.Errorf("intelligence.ArenaReader: scan: %w", err)
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
		s := domain.ArenaMatchSummary{
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

// ── CalendarReader: services/daily interview_calendars ──

// CalendarReader implements domain.CalendarReader over interview_calendars + companies.
type CalendarReader struct{ pool *pgxpool.Pool }

// NewCalendarReader wraps a pool.
func NewCalendarReader(pool *pgxpool.Pool) *CalendarReader { return &CalendarReader{pool: pool} }

func (r *CalendarReader) UpcomingInterviews(ctx context.Context, userID uuid.UUID, withinDays int) ([]domain.UpcomingInterview, error) {
	if withinDays <= 0 || withinDays > 365 {
		withinDays = 30
	}
	rows, err := r.pool.Query(ctx,
		`SELECT COALESCE(c.name, '?'), ic.role, ic.interview_date,
		        COALESCE(ic.current_level, ''), ic.readiness_pct,
		        (ic.interview_date - CURRENT_DATE)::int AS days_from_now
		   FROM interview_calendars ic
		   LEFT JOIN companies c ON c.id = ic.company_id
		  WHERE ic.user_id=$1
		    AND ic.interview_date >= CURRENT_DATE
		    AND ic.interview_date <= CURRENT_DATE + $2::int
		  ORDER BY ic.interview_date ASC`,
		sharedpg.UUID(userID), withinDays,
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.CalendarReader: %w", err)
	}
	defer rows.Close()
	out := make([]domain.UpcomingInterview, 0)
	for rows.Next() {
		var ui domain.UpcomingInterview
		var pct int32
		if err := rows.Scan(&ui.CompanyName, &ui.Role, &ui.InterviewDate, &ui.CurrentLevel, &pct, &ui.DaysFromNow); err != nil {
			return nil, fmt.Errorf("intelligence.CalendarReader: scan: %w", err)
		}
		ui.ReadinessPct = int(pct)
		out = append(out, ui)
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("intelligence.CalendarReader rows: %w", err)
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
