// Package app — curated writing prompts library use cases. Three orchestrators:
//   1. ListWritingPrompts — user-facing, level-filtered.
//   2. AddWritingPrompt — admin-only, slug-keyed create.
//   3. ArchiveWritingPrompt — admin-only soft-delete.
//
// Admin gating happens at the REST router (not here). The use cases
// only enforce domain invariants (slug format, level enum, non-empty body).
package app

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"druz9/hone/domain"
)

// slugRe — kebab-case, lowercase, 1-80 chars. Enforces deterministic
// admin-authored ids that survive URL embedding.
var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,79}$`)

// ─── ListWritingPrompts ───────────────────────────────────────────────────

type ListWritingPrompts struct {
	Repo domain.WritingPromptRepo
}

type ListWritingPromptsInput struct {
	Level string // empty = all levels
}

func (uc *ListWritingPrompts) Do(ctx context.Context, in ListWritingPromptsInput) ([]domain.WritingPrompt, error) {
	level := domain.WritingPromptLevel(strings.ToUpper(strings.TrimSpace(in.Level)))
	if level != "" && !level.IsValid() {
		return nil, fmt.Errorf("hone.ListWritingPrompts: invalid level %q: %w", in.Level, domain.ErrInvalidInput)
	}
	items, err := uc.Repo.List(ctx, level)
	if err != nil {
		return nil, fmt.Errorf("hone.ListWritingPrompts: %w", err)
	}
	return items, nil
}

// ─── AddWritingPrompt ─────────────────────────────────────────────────────

type AddWritingPrompt struct {
	Repo domain.WritingPromptRepo
}

type AddWritingPromptInput struct {
	ID       string
	Level    string
	Topic    string
	Prompt   string
	RubricMD string
}

func (uc *AddWritingPrompt) Do(ctx context.Context, in AddWritingPromptInput) (domain.WritingPrompt, error) {
	id := strings.TrimSpace(in.ID)
	if !slugRe.MatchString(id) {
		return domain.WritingPrompt{}, fmt.Errorf("hone.AddWritingPrompt: invalid slug %q (need lowercase kebab-case, 1-80 chars): %w", id, domain.ErrInvalidInput)
	}
	level := domain.WritingPromptLevel(strings.ToUpper(strings.TrimSpace(in.Level)))
	if !level.IsValid() {
		return domain.WritingPrompt{}, fmt.Errorf("hone.AddWritingPrompt: invalid level %q (need B1/B2/C1): %w", in.Level, domain.ErrInvalidInput)
	}
	topic := strings.TrimSpace(in.Topic)
	if topic == "" {
		return domain.WritingPrompt{}, fmt.Errorf("hone.AddWritingPrompt: topic required: %w", domain.ErrInvalidInput)
	}
	if len(topic) > 80 {
		return domain.WritingPrompt{}, fmt.Errorf("hone.AddWritingPrompt: topic too long (max 80): %w", domain.ErrInvalidInput)
	}
	prompt := strings.TrimSpace(in.Prompt)
	if prompt == "" {
		return domain.WritingPrompt{}, fmt.Errorf("hone.AddWritingPrompt: prompt required: %w", domain.ErrInvalidInput)
	}
	if len(prompt) > 4_000 {
		return domain.WritingPrompt{}, fmt.Errorf("hone.AddWritingPrompt: prompt too long (max 4000 chars): %w", domain.ErrInvalidInput)
	}
	rubric := strings.TrimSpace(in.RubricMD)
	if len(rubric) > 4_000 {
		return domain.WritingPrompt{}, fmt.Errorf("hone.AddWritingPrompt: rubric_md too long (max 4000 chars): %w", domain.ErrInvalidInput)
	}

	out, err := uc.Repo.Add(ctx, domain.WritingPrompt{
		ID:       id,
		Level:    level,
		Topic:    topic,
		Prompt:   prompt,
		RubricMD: rubric,
	})
	if err != nil {
		return domain.WritingPrompt{}, fmt.Errorf("hone.AddWritingPrompt: %w", err)
	}
	return out, nil
}

// ─── ArchiveWritingPrompt ─────────────────────────────────────────────────

type ArchiveWritingPrompt struct {
	Repo domain.WritingPromptRepo
}

type ArchiveWritingPromptInput struct {
	ID string
}

func (uc *ArchiveWritingPrompt) Do(ctx context.Context, in ArchiveWritingPromptInput) error {
	id := strings.TrimSpace(in.ID)
	if id == "" {
		return fmt.Errorf("hone.ArchiveWritingPrompt: id required: %w", domain.ErrInvalidInput)
	}
	if err := uc.Repo.Archive(ctx, id); err != nil {
		return fmt.Errorf("hone.ArchiveWritingPrompt: %w", err)
	}
	return nil
}
