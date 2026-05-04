// adapters.go — cross-domain adapters owned by hone wiring.
//
// Three thin shims:
//   - NewHoneSkillAtlasAdapter — wraps honeInfra.NewSkillAtlasReader so
//     bootstrap doesn't need to know about hone-infra packages directly.
//   - NewHoneTierAdapter        — same for the subscription-tier reader.
//   - NewHoneNotificationAdapter — bridges the notify TG-bot onto
//     hone.domain.NotificationSender for the Cue-followup feature.
//
// Used to live in monolith services/adapters.go; moved here so hone
// owns its own outbound adapters (microservice-extraction friendly).
package hone

import (
	"context"
	"errors"
	"fmt"
	"time"

	honeApp "druz9/hone/app"
	honeDomain "druz9/hone/domain"
	honeInfra "druz9/hone/infra"
	intelligenceApp "druz9/intelligence/app"
	notifyDomain "druz9/notify/domain"
	notifyInfra "druz9/notify/infra"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewHoneSkillAtlasAdapter — thin wrapper preserving bootstrap-API.
func NewHoneSkillAtlasAdapter(pool *pgxpool.Pool) honeDomain.SkillAtlasReader {
	return honeInfra.NewSkillAtlasReader(pool)
}

// NewHoneTierAdapter — thin wrapper preserving bootstrap-API.
func NewHoneTierAdapter(pool *pgxpool.Pool) honeDomain.TierReader {
	return honeInfra.NewTierReader(pool)
}

// honeNotificationAdapter implements hone.domain.NotificationSender. Used
// for one feature: SendCueSessionToTelegram — push markdown summary of a
// meeting from the Hone app to the user's personal TG chat.
//
// Why not via notifyApp.SendNotification.Do (the full pipeline):
//   - SendNotification requires a cuekey'ed NotificationType + ready
//     Template — but here body is dynamic (user markdown). Re-flowing
//     pipeline for one call isn't worth it.
//   - For feature-degradation (user not linked to TG) we want a
//     user-facing message ("telegram not linked"), not a silent skip.
//
// Resolves chat_id via PreferencesRepo (same place /start <code> writes).
// If chat_id is empty → ok=false, message="telegram not linked".
// Send errors (network/429/etc) bubble up — caller returns 5xx.
type honeNotificationAdapter struct {
	bot   *notifyInfra.TelegramBot
	prefs notifyDomain.PreferencesRepo
}

// NewHoneNotificationAdapter — constructor for monolith bootstrap.
// nil-safe: if bot or prefs are nil returns nil — Hone treats that
// as "TG follow-up disabled" (see types.go HoneNotificationSender doc).
func NewHoneNotificationAdapter(bot *notifyInfra.TelegramBot, prefs notifyDomain.PreferencesRepo) honeDomain.NotificationSender {
	if bot == nil || prefs == nil {
		return nil
	}
	return &honeNotificationAdapter{bot: bot, prefs: prefs}
}

// SendCueFollowup sends a meeting-summary markdown to the user's personal
// TG chat AS A .md FILE ATTACHMENT (not as plain text). Reasons:
//   - cue notes commonly run 5–50KB; TG plain-text limit is 4096 chars,
//     so long bodies get truncated.
//   - .md attachment'ом юзер видит filename, открывает в Obsidian /
//     Notes.app, может переслать.
//   - inline markdown TG отображает как литералы («**bold**» вместо
//     жирного), что в файле — норма, а в чате — мусор.
//
// Fallback: если document send fail'нул (бот заблокирован для files в
// группе и т.п.) — отправляем text-msg c обрезкой до 3500 char'ов. Лучше
// частичный текст чем silent failure.
func (a *honeNotificationAdapter) SendCueFollowup(ctx context.Context, userID uuid.UUID, title, bodyMD string) (bool, string, error) {
	pref, err := a.prefs.Get(ctx, userID)
	if err != nil {
		if errors.Is(err, notifyDomain.ErrNotFound) {
			return false, "telegram not linked", nil
		}
		return false, "", fmt.Errorf("hone.notificationAdapter: prefs: %w", err)
	}
	if pref.TelegramChatID == "" {
		return false, "telegram not linked", nil
	}

	caption := title
	if caption == "" {
		caption = "Cue session"
	}
	body := bodyMD
	if body == "" {
		body = "(empty)"
	}

	slug := slugifyForFilename(title)
	if slug == "" {
		slug = "cue-session"
	}
	fileName := slug + ".md"
	fileContent := "# " + caption + "\n\n" + body

	if err := a.bot.SendDocument(ctx, userID, pref.TelegramChatID, fileName, caption, []byte(fileContent)); err != nil {
		if errors.Is(err, notifyDomain.ErrNoTarget) {
			return false, "telegram not linked", nil
		}
		// Fallback: text-msg c truncation. Не падаем silent — лучше
		// дать юзеру хоть что-то, чем 500.
		text := caption
		if body != "" {
			snippet := body
			if len(snippet) > 3500 {
				snippet = snippet[:3500] + "\n\n…(truncated, full version в .md attachment'е)"
			}
			text = text + "\n\n" + snippet
		}
		if textErr := a.bot.Send(ctx, userID, pref.TelegramChatID, notifyDomain.Template{Text: text}); textErr != nil {
			return false, "", fmt.Errorf("hone.notificationAdapter: doc+text fallback failed: doc=%v text=%w", err, textErr)
		}
		return true, "Sent as text (attachment blocked)", nil
	}
	return true, "", nil
}

// slugifyForFilename — filename-safe transform для TG document'а.
// Lowercase'ить НЕ нужно (TG отдаёт filename как есть юзеру), но
// non-alphanumeric → dash. Cyrillic оставляем — modern TG это поддерживает.
func slugifyForFilename(s string) string {
	if s == "" {
		return ""
	}
	out := make([]rune, 0, len(s))
	prevDash := false
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r >= 0x0400 && r <= 0x04FF: // cyrillic
			out = append(out, r)
			prevDash = false
		default:
			if !prevDash {
				out = append(out, '-')
				prevDash = true
			}
		}
	}
	res := string(out)
	for len(res) > 0 && res[0] == '-' {
		res = res[1:]
	}
	for len(res) > 0 && res[len(res)-1] == '-' {
		res = res[:len(res)-1]
	}
	if len(res) > 80 {
		res = res[:80]
	}
	return res
}

// ─── CoachEpisodeAppender adapter (hone external_activity → coach memory) ──

// honeCoachEpisodeAppender adapts intelligence Memory.AppendAsync to the
// hone-domain CoachEpisodeAppender interface. Each AddExternalActivity call
// fires a fire-and-forget episode write so AI-tutor recall + DailyBrief
// see external learning as part of coach memory.
type honeCoachEpisodeAppender struct {
	memory honeMemoryAppender
}

// honeMemoryAppender — narrow shim around intelligence app.Memory (only
// AppendAsync needed). Defined as interface чтобы adapters.go не
// импортил intelligence/app напрямую — bootstrap.go хранит конкретный
// тип и conform'ит к этому при wiring'е.
type honeMemoryAppender interface {
	AppendExternal(ctx context.Context, userID uuid.UUID, summary string, payload map[string]any, occurredAt time.Time)
}

// NewHoneCoachEpisodeAppender wraps a memory-appender shim into the
// hone CoachEpisodeAppender interface. nil-safe: when m == nil (intelligence
// not wired), every call is a no-op.
func NewHoneCoachEpisodeAppender(m honeMemoryAppender) honeDomain.CoachEpisodeAppender {
	return &honeCoachEpisodeAppender{memory: m}
}

func (a *honeCoachEpisodeAppender) AppendExternalActivity(
	ctx context.Context,
	userID uuid.UUID,
	summary string,
	payload map[string]any,
	occurredAt time.Time,
) error {
	if a == nil || a.memory == nil {
		return nil
	}
	a.memory.AppendExternal(ctx, userID, summary, payload, occurredAt)
	return nil
}

// ─── LinkSuggester adapter (hone Notes → intelligence rerank UC) ───────────

// honeLinkSuggester adapts intelligence app.SuggestNoteLinks (the LLM
// rerank UC) onto hone.app.LinkSuggester so the Notes panel's
// "AI suggestions" can run a per-edge `reason` re-rank without hone
// importing intelligence directly. Pure pass-through — no caching here
// (UC owns its own determinism via CacheKey, caller wraps if needed).
type honeLinkSuggester struct {
	uc *intelligenceApp.SuggestNoteLinks
}

// NewHoneLinkSuggester returns nil-safe адаптер. uc == nil ⇒ Rerank
// возвращает (nil, fmt-error) → UC fallback'нет на embedding-only ranking.
func NewHoneLinkSuggester(uc *intelligenceApp.SuggestNoteLinks) honeApp.LinkSuggester {
	return &honeLinkSuggester{uc: uc}
}

func (a *honeLinkSuggester) Rerank(ctx context.Context, req honeApp.LinkSuggestReq) ([]honeApp.LinkSuggestion, error) {
	if a == nil || a.uc == nil {
		return nil, errors.New("hone.LinkSuggester: not configured")
	}
	cands := make([]intelligenceApp.NotesLinkCandidate, len(req.Candidates))
	for i, c := range req.Candidates {
		cands[i] = intelligenceApp.NotesLinkCandidate{
			NoteID:          c.NoteID,
			Title:           c.Title,
			Snippet:         c.Snippet,
			SimilarityScore: float64(c.Similarity),
		}
	}
	suggs, err := a.uc.Do(ctx, intelligenceApp.SuggestNoteLinksInput{
		TargetNoteID:   req.TargetNoteID,
		TargetTitle:    req.TargetTitle,
		TargetSnippet:  req.TargetSnippet,
		Candidates:     cands,
		MaxSuggestions: req.Max,
	})
	if err != nil {
		return nil, fmt.Errorf("hone.LinkSuggester.Rerank: %w", err)
	}
	out := make([]honeApp.LinkSuggestion, 0, len(suggs))
	for _, s := range suggs {
		out = append(out, honeApp.LinkSuggestion{
			TargetNoteID: s.TargetNoteID,
			Score:        float32(s.Score),
			Reason:       s.Reason,
		})
	}
	return out, nil
}

// ─── ReflectionNoteCreator (intelligence LogResource → hone_notes) ─────────

// NewHoneReflectionNoteCreator returns an intelApp.NoteCreator hook that
// creates a hone_notes row from a reflection-submitted event and triggers
// the standard embed-job — so the new reflection note enters the corpus
// for cosine similarity (GetNoteConnections + SuggestNoteLinks).
//
// Title format: "reflection · YYYY-MM-DD HH:MM" + atlas-node hint when
// present. Body = reflection text as-is. UC LogResource then writes the
// resource_log entry with the returned note_id (FK).
//
// Failure semantics:
//   - notes.Create error → returned to LogResource, which sets
//     NoteCreateFailed=true and still persists the resource_log entry
//     without note_id. Retry job (TODO) closes later.
//   - embedFn is fire-and-forget — failure там не блокирует Create.
func NewHoneReflectionNoteCreator(
	notes honeDomain.NoteRepo,
	embedFn func(ctx context.Context, userID, noteID uuid.UUID, text string),
	log honeReflectionLogger,
	now func() time.Time,
) func(ctx context.Context, userID uuid.UUID, atlasNodeID, reflection string) (uuid.UUID, error) {
	if now == nil {
		now = time.Now
	}
	return func(ctx context.Context, userID uuid.UUID, atlasNodeID, reflection string) (uuid.UUID, error) {
		ts := now().UTC()
		title := "reflection · " + ts.Format("2006-01-02 15:04")
		if atlasNodeID != "" {
			title = title + " · " + atlasNodeID
		}
		n := honeDomain.Note{
			UserID:    userID,
			Title:     title,
			BodyMD:    reflection,
			SizeBytes: len(reflection),
			CreatedAt: ts,
			UpdatedAt: ts,
		}
		created, err := notes.Create(ctx, n)
		if err != nil {
			return uuid.Nil, fmt.Errorf("hone.ReflectionNoteCreator: %w", err)
		}
		if embedFn != nil {
			embedFn(ctx, userID, created.ID, created.Title+"\n\n"+created.BodyMD)
		}
		if log != nil {
			log.Info("hone: reflection note auto-created",
				"user_id", userID.String(),
				"note_id", created.ID.String(),
				"atlas_node", atlasNodeID,
			)
		}
		return created.ID, nil
	}
}

// honeReflectionLogger — narrow shim над *slog.Logger для типизации без
// import'а log/slog (adapters.go уже не импортит его). nil-safe.
type honeReflectionLogger interface {
	Info(msg string, args ...any)
}
