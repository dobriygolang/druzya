// Package app — Phase 3.5 personal resource library use cases.
//
// Pattern: thin UCs над OverrideRepo + (optional) PromotionTracker +
// (optional) DomainReputationRepo. Каждая UC одна операция:
//
//   - AddResource     — user добавляет свой ресурс (full Resource shape).
//     Bumps promotion_signals + domain_reputation.
//   - HideResource    — скрыть curated ресурс из своего списка.
//   - MarkUnhelpful   — flag + бамп reputation.
//   - ReplaceResource — atomic hide(original) + add(replacement).
//   - ReorderResource — change ordering relative to siblings.
//   - ApplyOverrides  — merge curated.external_resources с user overrides
//     в один ordered list per user.
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/curation"
	"druz9/curation/domain"

	"github.com/google/uuid"
)

// OverrideAction — enum (matches DB CHECK).
type OverrideAction string

const (
	ActionAdded     OverrideAction = "added"
	ActionHidden    OverrideAction = "hidden"
	ActionReplaced  OverrideAction = "replaced"
	ActionReordered OverrideAction = "reordered"
	ActionUnhelpful OverrideAction = "unhelpful"
)

// Target — atlas-node OR track-step (один из двух must быть set).
type Target struct {
	AtlasNodeID string     // "" если step-target
	StepTrackID *uuid.UUID // nil если node-target
	StepIndex   *int16
}

func (t Target) Valid() bool {
	hasNode := strings.TrimSpace(t.AtlasNodeID) != ""
	hasStep := t.StepTrackID != nil && t.StepIndex != nil
	return hasNode || hasStep
}

// Override — row in user_resource_overrides.
type Override struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	Target         Target
	URL            string
	Action         OverrideAction
	Payload        []byte // raw JSON
	AutoPromotedAt *time.Time
	CreatedAt      time.Time
}

// OverrideRepo — write-side для user_resource_overrides.
type OverrideRepo interface {
	Insert(ctx context.Context, ov Override) (Override, error)
	List(ctx context.Context, userID uuid.UUID, t Target) ([]Override, error)
	DeleteByURL(ctx context.Context, userID uuid.UUID, t Target, url string, action OverrideAction) error
}

// PromotionTracker — upsert в resource_promotion_signals при add/finish.
type PromotionTracker interface {
	BumpAdded(ctx context.Context, url, atlasNodeID string) error
	UpdateQuality(ctx context.Context, url string, quality float32) error
}

// DomainReputationRepo — bump unhelpful_count при mark-unhelpful.
type DomainReputationRepo interface {
	BumpUnhelpful(ctx context.Context, domainHost string) error
	IsBlocked(ctx context.Context, domainHost string) (bool, error)
}

// AddResource UC.
type AddResource struct {
	Repo      OverrideRepo
	Promotion PromotionTracker
	Now       func() time.Time
}

// AddResourceInput.
type AddResourceInput struct {
	UserID   uuid.UUID
	Target   Target
	Resource domain.Resource
}

func (uc *AddResource) Do(ctx context.Context, in AddResourceInput) (Override, error) {
	if !in.Target.Valid() {
		return Override{}, fmt.Errorf("curation.AddResource: invalid target")
	}
	if err := in.Resource.Validate(); err != nil {
		return Override{}, fmt.Errorf("curation.AddResource: %w", err)
	}
	payload, err := domain.ResourceList{in.Resource}.Marshal()
	if err != nil {
		return Override{}, fmt.Errorf("curation.AddResource: marshal: %w", err)
	}
	ov := Override{
		UserID:    in.UserID,
		Target:    in.Target,
		URL:       in.Resource.URL,
		Action:    ActionAdded,
		Payload:   payload,
		CreatedAt: uc.now(),
	}
	saved, err := uc.Repo.Insert(ctx, ov)
	if err != nil {
		return Override{}, fmt.Errorf("curation.AddResource: %w", err)
	}
	// Bump promotion-signals — best-effort. Failures не ломают AddResource.
	if uc.Promotion != nil && in.Target.AtlasNodeID != "" {
		_ = uc.Promotion.BumpAdded(ctx, in.Resource.URL, in.Target.AtlasNodeID)
	}
	return saved, nil
}

// HideResource UC.
type HideResource struct {
	Repo OverrideRepo
	Now  func() time.Time
}

func (uc *HideResource) Do(ctx context.Context, userID uuid.UUID, target Target, url string) error {
	if !target.Valid() {
		return fmt.Errorf("curation.HideResource: invalid target")
	}
	if strings.TrimSpace(url) == "" {
		return fmt.Errorf("curation.HideResource: empty url")
	}
	ov := Override{
		UserID:    userID,
		Target:    target,
		URL:       url,
		Action:    ActionHidden,
		Payload:   []byte(`{}`),
		CreatedAt: nowOr(uc.Now),
	}
	_, err := uc.Repo.Insert(ctx, ov)
	if err != nil {
		return fmt.Errorf("curation.HideResource: %w", err)
	}
	return nil
}

// MarkUnhelpful UC.
type MarkUnhelpful struct {
	Repo       OverrideRepo
	Reputation DomainReputationRepo
	Now        func() time.Time
}

func (uc *MarkUnhelpful) Do(ctx context.Context, userID uuid.UUID, target Target, url, reason string) error {
	if !target.Valid() {
		return fmt.Errorf("curation.MarkUnhelpful: invalid target")
	}
	if strings.TrimSpace(url) == "" {
		return fmt.Errorf("curation.MarkUnhelpful: empty url")
	}
	payload := []byte(`{"reason":` + jsonString(reason) + `}`)
	ov := Override{
		UserID:    userID,
		Target:    target,
		URL:       url,
		Action:    ActionUnhelpful,
		Payload:   payload,
		CreatedAt: nowOr(uc.Now),
	}
	if _, err := uc.Repo.Insert(ctx, ov); err != nil {
		return fmt.Errorf("curation.MarkUnhelpful: %w", err)
	}
	if uc.Reputation != nil {
		host := curation.DomainOf(url)
		if host != "" {
			_ = uc.Reputation.BumpUnhelpful(ctx, host)
		}
	}
	return nil
}

// ReplaceResource UC — hide original + add replacement, в одной transaction'е
// (repo decides). MVP — две последовательные операции с tolerance к partial.
type ReplaceResource struct {
	Repo OverrideRepo
	Now  func() time.Time
}

type ReplaceResourceInput struct {
	UserID      uuid.UUID
	Target      Target
	OriginalURL string
	Replacement domain.Resource
	Reason      string
}

func (uc *ReplaceResource) Do(ctx context.Context, in ReplaceResourceInput) error {
	if !in.Target.Valid() {
		return fmt.Errorf("curation.ReplaceResource: invalid target")
	}
	if strings.TrimSpace(in.OriginalURL) == "" {
		return fmt.Errorf("curation.ReplaceResource: empty original url")
	}
	if err := in.Replacement.Validate(); err != nil {
		return fmt.Errorf("curation.ReplaceResource: %w", err)
	}
	now := nowOr(uc.Now)
	hidePayload := []byte(`{"original_url":` + jsonString(in.OriginalURL) +
		`,"reason":` + jsonString(in.Reason) + `}`)
	if _, err := uc.Repo.Insert(ctx, Override{
		UserID: in.UserID, Target: in.Target,
		URL: in.OriginalURL, Action: ActionReplaced,
		Payload: hidePayload, CreatedAt: now,
	}); err != nil {
		return fmt.Errorf("curation.ReplaceResource: replace mark: %w", err)
	}
	addPayload, _ := domain.ResourceList{in.Replacement}.Marshal()
	if _, err := uc.Repo.Insert(ctx, Override{
		UserID: in.UserID, Target: in.Target,
		URL: in.Replacement.URL, Action: ActionAdded,
		Payload: addPayload, CreatedAt: now,
	}); err != nil {
		return fmt.Errorf("curation.ReplaceResource: add: %w", err)
	}
	return nil
}

// ReorderResource UC — записывает intended position. ApplyOverrides
// собирает relative order из всех reordered events (last-wins per URL).
type ReorderResource struct {
	Repo OverrideRepo
	Now  func() time.Time
}

func (uc *ReorderResource) Do(ctx context.Context, userID uuid.UUID, target Target, url string, prevIdx, nextIdx int) error {
	if !target.Valid() {
		return fmt.Errorf("curation.ReorderResource: invalid target")
	}
	payload := fmt.Sprintf(`{"prev_index":%d,"next_index":%d}`, prevIdx, nextIdx)
	_, err := uc.Repo.Insert(ctx, Override{
		UserID: userID, Target: target,
		URL: url, Action: ActionReordered,
		Payload: []byte(payload), CreatedAt: nowOr(uc.Now),
	})
	if err != nil {
		return fmt.Errorf("curation.ReorderResource: %w", err)
	}
	return nil
}

// ApplyOverrides — merge curated list с overrides в final list per user.
//
// Semantics:
//   - hidden URL → отфильтрован
//   - replaced URL → отфильтрован (replacement добавится через 'added')
//   - added URL → appended после curated (если уже в curated — duplicate skip)
//   - reordered → MVP не применяется (UI sends ordered IDs самостоятельно)
//   - unhelpful → не фильтрует (UX-сигнал, но ресурс может остаться в списке)
type ApplyOverrides struct {
	Repo OverrideRepo
}

func (uc *ApplyOverrides) Do(ctx context.Context, userID uuid.UUID, target Target, base domain.ResourceList) (domain.ResourceList, error) {
	if !target.Valid() {
		return base, nil
	}
	overs, err := uc.Repo.List(ctx, userID, target)
	if err != nil {
		return nil, fmt.Errorf("curation.ApplyOverrides: %w", err)
	}
	if len(overs) == 0 {
		return base, nil
	}
	// Build filter sets.
	hidden := make(map[string]struct{})
	added := make([]domain.Resource, 0)
	for _, o := range overs {
		switch o.Action {
		case ActionHidden, ActionReplaced:
			hidden[strings.ToLower(o.URL)] = struct{}{}
		case ActionAdded:
			list, err := domain.Unmarshal(o.Payload)
			if err != nil || len(list) == 0 {
				continue
			}
			added = append(added, list[0])
		case ActionReordered, ActionUnhelpful:
			// reordered: MVP не применяется (UI sends ordered IDs).
			// unhelpful: UX-сигнал, не фильтрует список.
			continue
		}
	}
	out := make(domain.ResourceList, 0, len(base)+len(added))
	for _, r := range base {
		if _, h := hidden[strings.ToLower(r.URL)]; h {
			continue
		}
		out = append(out, r)
	}
	// Append user-added без дублей.
	seen := make(map[string]struct{}, len(out))
	for _, r := range out {
		seen[strings.ToLower(r.URL)] = struct{}{}
	}
	for _, r := range added {
		key := strings.ToLower(r.URL)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, r)
	}
	return out, nil
}

func (uc *AddResource) now() time.Time {
	return nowOr(uc.Now)
}

func nowOr(fn func() time.Time) time.Time {
	if fn == nil {
		return time.Now().UTC()
	}
	return fn().UTC()
}

// jsonString — minimal JSON string escaper для payload assembly. Хватает
// для reason'ов и URLs (никаких user-controlled control chars).
func jsonString(s string) string {
	b := make([]byte, 0, len(s)+2)
	b = append(b, '"')
	for _, r := range s {
		switch r {
		case '"', '\\':
			b = append(b, '\\', byte(r))
		case '\n':
			b = append(b, '\\', 'n')
		case '\r':
			b = append(b, '\\', 'r')
		case '\t':
			b = append(b, '\\', 't')
		default:
			if r < 0x20 {
				continue // strip non-printable
			}
			b = append(b, []byte(string(r))...)
		}
	}
	b = append(b, '"')
	return string(b)
}
