// Package app — telemetry use cases.
package app

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"druz9/telemetry/domain"

	"github.com/google/uuid"
)

// RecordEvents — single batch-write UC. Validates каждый event independently
// и записывает только valid ones. Invalid events silently dropped — telemetry
// best-effort, не должен ломать user flow при bad client payload.
type RecordEvents struct {
	Repo     domain.EventRepo
	Consent  domain.ConsentRepo // optional — когда nil, consent gate отключён (legacy)
	Sink     domain.AnalyticsSink
	Anon     domain.IDAnonymizer
	Log      *slog.Logger
	Now      func() time.Time // injectable для тестов
}

// EventInput — нормализованный input от ports/server.go (proto → domain).
type EventInput struct {
	Name       string
	Surface    string
	OccurredAt time.Time
	Properties map[string]string
}

// Do записывает batch. Returns count accepted (0..len(in)).
//
// Consent gate: для каждого event'а проверяем opt-in запись в
// telemetry_consent. Если row есть и opted_in=false → drop (silently;
// client мог не успеть подтянуть свежий consent state). Если row нет →
// дефолт зависит от surface:
//   - hone/web — fire (banner показывает client, мы трактуем отсутствие
//     явного opt-out как «банер ещё не закрыт, но пользователь юзает app»;
//     telemetry старается измерить ровно тех кто banner ещё видит — иначе
//     мы не получим signal на early-funnel events до consent click);
//   - cue — drop (stealth-first; нет explicit opt-in — нет events).
//
// Это компромисс: web/hone defaultу trust'им client'у, cue не trust'им.
// Документация в Privacy section CLAUDE.md разъясняет behavior пользователю.
func (r *RecordEvents) Do(ctx context.Context, userID uuid.UUID, in []EventInput) (int, error) {
	now := time.Now().UTC()
	if r.Now != nil {
		now = r.Now().UTC()
	}
	pastCutoff := now.Add(-domain.OccurredAtPastWindow)
	futureCutoff := now.Add(domain.OccurredAtFutureSkew)

	// Cache consent lookups per-surface чтобы не дёргать DB на каждый
	// event одного юзера. Один RecordEvents — короткий call, кэш не
	// устаревает между event'ами.
	type consentDecision struct {
		allowed bool
		fetched bool
	}
	consentCache := make(map[domain.Surface]consentDecision)

	resolveConsent := func(surface domain.Surface) bool {
		if r.Consent == nil {
			// Backwards-compat: когда ConsentRepo не wired — fallback на
			// legacy behavior (всё allowed). В prod это не должно
			// случаться — wirer всегда даёт repo.
			return true
		}
		if d, ok := consentCache[surface]; ok {
			return d.allowed
		}
		c, exists, err := r.Consent.Get(ctx, userID, surface)
		if err != nil {
			if r.Log != nil {
				r.Log.WarnContext(ctx, "telemetry.consent_lookup_failed",
					slog.String("user_id", userID.String()),
					slog.String("surface", string(surface)),
					slog.Any("err", err))
			}
			// Fail-open для web/hone (consistent with banner-default);
			// fail-closed для cue (stealth default опт-аут).
			d := surface != domain.SurfaceCue
			consentCache[surface] = consentDecision{allowed: d, fetched: true}
			return d
		}
		var allowed bool
		switch {
		case exists:
			allowed = c.OptedIn
		case surface == domain.SurfaceCue:
			allowed = false
		default:
			allowed = true
		}
		consentCache[surface] = consentDecision{allowed: allowed, fetched: true}
		return allowed
	}

	out := make([]domain.Event, 0, len(in))
	for _, ev := range in {
		surface := domain.Surface(strings.ToLower(strings.TrimSpace(ev.Surface)))
		if !surface.IsValid() {
			continue
		}
		if !resolveConsent(surface) {
			continue
		}
		name := strings.TrimSpace(ev.Name)
		if name == "" || len(name) > domain.MaxNameLen {
			continue
		}
		// Clamp occurred_at в acceptable window. Clock skew tolerated до
		// FutureSkew; всё что дальше — likely bad client clock, drop.
		occurred := ev.OccurredAt
		if occurred.IsZero() || occurred.Before(pastCutoff) || occurred.After(futureCutoff) {
			continue
		}
		props := sanitizeProps(ev.Properties)
		out = append(out, domain.Event{
			ID:         uuid.New(),
			UserID:     userID,
			Surface:    surface,
			Name:       name,
			OccurredAt: occurred.UTC(),
			ReceivedAt: now,
			Properties: props,
		})
	}
	if len(out) == 0 {
		return 0, nil
	}
	accepted, err := r.Repo.InsertBatch(ctx, out)
	if err != nil {
		return 0, err
	}
	// Mirror в PostHog — best-effort. Sink сам решит buffer / batch /
	// network. Errors логируем, не возвращаем — client'у важен только
	// local INSERT.
	if r.Sink != nil {
		if serr := r.Sink.Track(ctx, out); serr != nil && r.Log != nil {
			r.Log.WarnContext(ctx, "telemetry.sink_track_failed",
				slog.Int("batch_size", len(out)),
				slog.Any("err", serr))
		}
	}
	return accepted, nil
}

// sanitizeProps clamps map к MaxPropertyKeys и truncate'ит длинные values.
// Order по map iteration не deterministic — если client прислал >32 keys,
// какие 32 dropped — undefined. Это accept'ed: client должен сам respect cap.
//
// PII guard: regex'ом ищем email/phone patterns в values и заменяем на
// [redacted]. Не perfect (free-form text может содержать что угодно), но
// catches typical leaks (auto-fill, copy-paste).
func sanitizeProps(in map[string]string) map[string]string {
	if len(in) == 0 {
		return map[string]string{}
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		if len(out) >= domain.MaxPropertyKeys {
			break
		}
		key := strings.TrimSpace(k)
		if key == "" {
			continue
		}
		v = redactPII(v)
		if len(v) > domain.MaxPropertyValueLen {
			v = v[:domain.MaxPropertyValueLen]
		}
		out[key] = v
	}
	return out
}
