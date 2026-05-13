// briefer.go — adapter that turns a tutor.StudentSnapshot into a
// short Russian markdown narrative via llmchain. Lives in the wirer
// (not in services/tutor) so the tutor module's go.mod stays free of
// llmchain — keeping the bounded context's import graph small.
//
// The prompt deliberately stays numbers-only: snapshot has no PII
// (note bodies, message text, etc.)
// and the brief MUST not invent any.
package tutor

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/shared/pkg/llmchain"
	tutorApp "druz9/tutor/app"
	tutorDomain "druz9/tutor/domain"
)

// llmChainBriefer satisfies app.PreSessionBriefer. It's the only spot
// where llmchain.Chain talks to a snapshot — the tutor module itself
// never imports llmchain. Implements graceful degradation: empty
// string + nil error when chain is unavailable, so the use-case
// returns the raw snapshot to the dashboard instead of erroring out.
type llmChainBriefer struct {
	chain llmchain.ChatClient
	log   *slog.Logger
	now   func() time.Time
}

// Compile-time guard against drift in PreSessionBriefer.
var _ tutorApp.PreSessionBriefer = (*llmChainBriefer)(nil)

// NewBriefer constructs a PreSessionBriefer over an llmchain client.
// chain may be nil — in that case the briefer's Render returns
// ("", nil) and the use-case falls back to snapshot-only output.
func NewBriefer(chain llmchain.ChatClient, log *slog.Logger, now func() time.Time) tutorApp.PreSessionBriefer {
	if chain == nil {
		return nil
	}
	if now == nil {
		now = time.Now
	}
	return &llmChainBriefer{chain: chain, log: log, now: now}
}

// Render returns 1-page Russian markdown summary. Returns ("", nil)
// when chain is nil or fails; the use-case treats it as «brief
// unavailable, render snapshot anyway».
func (b *llmChainBriefer) Render(ctx context.Context, snap tutorDomain.StudentSnapshot) (string, error) {
	if b == nil || b.chain == nil {
		return "", nil
	}
	if snap.WindowDays == 0 {
		// Defensive: an empty snapshot would only produce a vacuous
		// brief. Prefer returning empty so the dashboard renders the
		// «no activity yet» state from the raw struct.
		return "", nil
	}
	prompt := buildBriefPrompt(snap, b.now())
	resp, err := b.chain.Chat(ctx, llmchain.Request{
		Task: llmchain.TaskTutorPreSessionBrief,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: prompt.system},
			{Role: llmchain.RoleUser, Content: prompt.user},
		},
		Temperature: 0.3, // narrative — slight creativity, not factual drift
		MaxTokens:   600, // ~250 Russian words
	})
	if err != nil {
		if b.log != nil {
			b.log.WarnContext(ctx, "tutor.brief: chain failed",
				slog.String("student_id", snap.StudentID.String()),
				slog.Any("err", err),
			)
		}
		return "", nil
	}
	return strings.TrimSpace(resp.Content), nil
}

// briefPrompt is internal; Build* helpers are not exported so tests
// poke at the result via the briefer's behaviour, not the templates.
type briefPrompt struct {
	system string
	user   string
}

func buildBriefPrompt(s tutorDomain.StudentSnapshot, now time.Time) briefPrompt {
	var sys strings.Builder
	sys.WriteString("Ты — assistant тутра английского. Тутор готовится к 1:1 со своим студентом. ")
	sys.WriteString("Твоя задача — написать краткий (≤ 250 слов) markdown-конспект «как прошла неделя у этого студента». ")
	sys.WriteString("Стиль: профессиональный, без воды и комплиментов. На русском.\n\n")
	sys.WriteString("Структура:\n")
	sys.WriteString("- 2 предложения о фокусе и активности (focus-минуты, mock-сессии).\n")
	sys.WriteString("- Список из 1–3 weak-spots по English Atlas (если есть в данных).\n")
	sys.WriteString("- 1 предложение «что предложить начать в начале занятия».\n\n")
	sys.WriteString("ОГРАНИЧЕНИЯ:\n")
	sys.WriteString("- Не выдумывай цифры, которых нет в данных. Если поле = 0, явно скажи «активности нет».\n")
	sys.WriteString("- Не цитируй содержимое заметок, mock-ответов, AI-coach реплик. У тебя их нет — только агрегаты.\n")
	sys.WriteString("- Не упоминай имени студента (его нет в данных).\n")
	sys.WriteString("- Не используй смайлики, эмодзи, восклицательные знаки в каждой строке. Это рабочий конспект.\n")
	sys.WriteString("- Если данные пустые (нет активности за окно), скажи это в одной строке и не фантазируй.\n")

	var u strings.Builder
	fmt.Fprintf(&u, "## Snapshot за %d дней (now=%s UTC)\n", s.WindowDays, now.UTC().Format("2006-01-02"))
	if !s.LastActiveAt.IsZero() {
		fmt.Fprintf(&u, "- last_active_at: %s\n", s.LastActiveAt.UTC().Format(time.RFC3339))
	} else {
		u.WriteString("- last_active_at: (нет активности в окне)\n")
	}
	fmt.Fprintf(&u, "- focus_minutes: %d\n", s.FocusMinutesWindow)
	fmt.Fprintf(&u, "- focus_sessions_count: %d\n", s.FocusSessionsCount)
	fmt.Fprintf(&u, "- english_mocks_count: %d\n", s.EnglishMocksCount)
	if s.EnglishMocksCount > 0 {
		fmt.Fprintf(&u, "- english_mocks_avg_score: %d/100\n", s.EnglishMocksAvgScore)
		fmt.Fprintf(&u, "- english_mocks_last_score: %d/100\n", s.EnglishMocksLastScore)
	}
	fmt.Fprintf(&u, "- notes_count: %d\n", s.NotesCount)
	if len(s.WeakSpots) == 0 {
		u.WriteString("- weak_spots: (Atlas не покрыт или все skill ≥ 60%)\n")
	} else {
		u.WriteString("- weak_spots:\n")
		for _, w := range s.WeakSpots {
			fmt.Fprintf(&u, "  · %s — %s — progress %d/100\n", w.NodeKey, w.Title, w.Progress)
		}
	}

	return briefPrompt{system: sys.String(), user: u.String()}
}
