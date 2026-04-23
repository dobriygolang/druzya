// Package infra contains Postgres adapters, the LLM provider client, and
// the default config provider for the copilot domain.
package infra

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	copilotdb "druz9/copilot/infra/db"
	"druz9/copilot/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─────────────────────────────────────────────────────────────────────────
// Conversations
// ─────────────────────────────────────────────────────────────────────────

// Conversations is the persistence adapter for copilot_conversations.
type Conversations struct {
	pool *pgxpool.Pool
	q    *copilotdb.Queries
}

// NewConversations wraps a pool.
func NewConversations(pool *pgxpool.Pool) *Conversations {
	return &Conversations{pool: pool, q: copilotdb.New(pool)}
}

// Create inserts a new conversation row and returns the hydrated entity.
func (r *Conversations) Create(ctx context.Context, userID uuid.UUID, title, model string) (domain.Conversation, error) {
	row, err := r.q.CreateCopilotConversation(ctx, copilotdb.CreateCopilotConversationParams{
		UserID: pgUUID(userID),
		Title:  title,
		Model:  model,
	})
	if err != nil {
		return domain.Conversation{}, fmt.Errorf("copilot.Conversations.Create: %w", err)
	}
	return conversationFromRow(row), nil
}

// Get loads a conversation by id.
func (r *Conversations) Get(ctx context.Context, id uuid.UUID) (domain.Conversation, error) {
	row, err := r.q.GetCopilotConversation(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Conversation{}, fmt.Errorf("copilot.Conversations.Get: %w", domain.ErrNotFound)
		}
		return domain.Conversation{}, fmt.Errorf("copilot.Conversations.Get: %w", err)
	}
	return conversationFromRow(row), nil
}

// UpdateTitle writes a new title and bumps updated_at.
func (r *Conversations) UpdateTitle(ctx context.Context, id uuid.UUID, title string) error {
	affected, err := r.q.UpdateCopilotConversationTitle(ctx, copilotdb.UpdateCopilotConversationTitleParams{
		ID:    pgUUID(id),
		Title: title,
	})
	if err != nil {
		return fmt.Errorf("copilot.Conversations.UpdateTitle: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("copilot.Conversations.UpdateTitle: %w", domain.ErrNotFound)
	}
	return nil
}

// Touch bumps updated_at without otherwise modifying the row.
func (r *Conversations) Touch(ctx context.Context, id uuid.UUID) error {
	affected, err := r.q.TouchCopilotConversation(ctx, pgUUID(id))
	if err != nil {
		return fmt.Errorf("copilot.Conversations.Touch: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("copilot.Conversations.Touch: %w", domain.ErrNotFound)
	}
	return nil
}

// Delete hard-deletes the conversation and cascades to messages. Forbids
// deletion by anyone other than the owner via the (id, user_id) pair.
func (r *Conversations) Delete(ctx context.Context, id, userID uuid.UUID) error {
	affected, err := r.q.DeleteCopilotConversation(ctx, copilotdb.DeleteCopilotConversationParams{
		ID:     pgUUID(id),
		UserID: pgUUID(userID),
	})
	if err != nil {
		return fmt.Errorf("copilot.Conversations.Delete: %w", err)
	}
	if affected == 0 {
		// Could be not-found or wrong owner — we deliberately do not
		// distinguish so enumeration attacks can't probe IDs.
		return fmt.Errorf("copilot.Conversations.Delete: %w", domain.ErrNotFound)
	}
	return nil
}

// ListForUser returns paginated history, newest first. Empty cursor →
// first page; the returned Cursor is empty when there are no more pages.
func (r *Conversations) ListForUser(ctx context.Context, userID uuid.UUID, cursor domain.Cursor, limit int) ([]domain.ConversationSummary, domain.Cursor, error) {
	if limit <= 0 {
		limit = 20
	} else if limit > 50 {
		limit = 50
	}

	isFirstPage := cursor == ""
	cursorUpdatedAt := time.Time{}
	cursorID := uuid.Nil
	if !isFirstPage {
		u, id, err := decodeCursor(cursor)
		if err != nil {
			return nil, "", fmt.Errorf("copilot.Conversations.ListForUser: %w: %w", domain.ErrInvalidInput, err)
		}
		cursorUpdatedAt = u
		cursorID = id
	}

	rows, err := r.q.ListCopilotConversationsForUser(ctx, copilotdb.ListCopilotConversationsForUserParams{
		UserID:          pgUUID(userID),
		IsFirstPage:     isFirstPage,
		CursorUpdatedAt: pgTimestamptz(cursorUpdatedAt),
		CursorID:        pgUUID(cursorID),
		PageSize:        int32(limit + 1), // fetch N+1 to detect a next page
	})
	if err != nil {
		return nil, "", fmt.Errorf("copilot.Conversations.ListForUser: %w", err)
	}

	out := make([]domain.ConversationSummary, 0, limit)
	for i, row := range rows {
		if i == limit {
			break
		}
		out = append(out, domain.ConversationSummary{
			Conversation: domain.Conversation{
				ID:        fromPgUUID(row.ID),
				UserID:    fromPgUUID(row.UserID),
				Title:     row.Title,
				Model:     row.Model,
				CreatedAt: row.CreatedAt.Time,
				UpdatedAt: row.UpdatedAt.Time,
			},
			MessageCount: int(row.MessageCount),
		})
	}

	var next domain.Cursor
	if len(rows) > limit {
		last := out[len(out)-1]
		next = encodeCursor(last.UpdatedAt, last.ID)
	}
	return out, next, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────────────

// Messages is the persistence adapter for copilot_messages.
type Messages struct {
	pool *pgxpool.Pool
	q    *copilotdb.Queries
}

// NewMessages wraps a pool.
func NewMessages(pool *pgxpool.Pool) *Messages {
	return &Messages{pool: pool, q: copilotdb.New(pool)}
}

// Insert writes a new message and returns the hydrated entity.
func (r *Messages) Insert(ctx context.Context, m domain.Message) (domain.Message, error) {
	row, err := r.q.InsertCopilotMessage(ctx, copilotdb.InsertCopilotMessageParams{
		ConversationID: pgUUID(m.ConversationID),
		Role:           string(m.Role),
		Content:        m.Content,
		HasScreenshot:  m.HasScreenshot,
		TokensIn:       int32(m.TokensIn),
		TokensOut:      int32(m.TokensOut),
		LatencyMs:      int32(m.LatencyMs),
	})
	if err != nil {
		return domain.Message{}, fmt.Errorf("copilot.Messages.Insert: %w", err)
	}
	return messageFromRow(row), nil
}

// UpdateAssistant commits final content and token accounting onto a
// placeholder assistant row created when the stream opened.
func (r *Messages) UpdateAssistant(ctx context.Context, id uuid.UUID, content string, tokensIn, tokensOut, latencyMs int) error {
	affected, err := r.q.UpdateCopilotAssistantMessage(ctx, copilotdb.UpdateCopilotAssistantMessageParams{
		ID:        pgUUID(id),
		Content:   content,
		TokensIn:  int32(tokensIn),
		TokensOut: int32(tokensOut),
		LatencyMs: int32(latencyMs),
	})
	if err != nil {
		return fmt.Errorf("copilot.Messages.UpdateAssistant: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("copilot.Messages.UpdateAssistant: %w", domain.ErrNotFound)
	}
	return nil
}

// List returns all messages for a conversation in creation order.
func (r *Messages) List(ctx context.Context, conversationID uuid.UUID) ([]domain.Message, error) {
	rows, err := r.q.ListCopilotMessagesForConversation(ctx, pgUUID(conversationID))
	if err != nil {
		return nil, fmt.Errorf("copilot.Messages.List: %w", err)
	}
	out := make([]domain.Message, 0, len(rows))
	for _, row := range rows {
		out = append(out, messageFromRow(row))
	}
	return out, nil
}

// Rate sets the rating on an assistant message. Ownership is enforced by
// the caller via OwnerOf.
func (r *Messages) Rate(ctx context.Context, messageID uuid.UUID, rating int8) error {
	affected, err := r.q.RateCopilotMessage(ctx, copilotdb.RateCopilotMessageParams{
		ID:     pgUUID(messageID),
		Rating: pgInt2(int16(rating)),
	})
	if err != nil {
		return fmt.Errorf("copilot.Messages.Rate: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("copilot.Messages.Rate: %w", domain.ErrNotFound)
	}
	return nil
}

// OwnerOf returns the user_id of the conversation owning a message.
func (r *Messages) OwnerOf(ctx context.Context, messageID uuid.UUID) (uuid.UUID, error) {
	owner, err := r.q.GetCopilotMessageOwner(ctx, pgUUID(messageID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, fmt.Errorf("copilot.Messages.OwnerOf: %w", domain.ErrNotFound)
		}
		return uuid.Nil, fmt.Errorf("copilot.Messages.OwnerOf: %w", err)
	}
	return fromPgUUID(owner), nil
}

// ─────────────────────────────────────────────────────────────────────────
// Quotas
// ─────────────────────────────────────────────────────────────────────────

// Quotas is the persistence adapter for copilot_quotas.
type Quotas struct {
	pool *pgxpool.Pool
	q    *copilotdb.Queries
}

// NewQuotas wraps a pool.
func NewQuotas(pool *pgxpool.Pool) *Quotas {
	return &Quotas{pool: pool, q: copilotdb.New(pool)}
}

// GetOrInit loads the quota row, creating a free-tier default on first use.
func (r *Quotas) GetOrInit(ctx context.Context, userID uuid.UUID) (domain.Quota, error) {
	row, err := r.q.UpsertCopilotQuotaDefault(ctx, pgUUID(userID))
	if err != nil {
		return domain.Quota{}, fmt.Errorf("copilot.Quotas.GetOrInit: %w", err)
	}
	return quotaFromRow(row), nil
}

// IncrementUsage bumps requests_used by 1. Callers must have already
// verified HasBudget; this adapter does not enforce the cap.
func (r *Quotas) IncrementUsage(ctx context.Context, userID uuid.UUID) error {
	affected, err := r.q.IncrementCopilotQuotaUsage(ctx, pgUUID(userID))
	if err != nil {
		return fmt.Errorf("copilot.Quotas.IncrementUsage: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("copilot.Quotas.IncrementUsage: %w", domain.ErrNotFound)
	}
	return nil
}

// ResetWindow zeros the counter and shifts resets_at 24h into the future.
func (r *Quotas) ResetWindow(ctx context.Context, userID uuid.UUID) error {
	affected, err := r.q.ResetCopilotQuotaWindow(ctx, pgUUID(userID))
	if err != nil {
		return fmt.Errorf("copilot.Quotas.ResetWindow: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("copilot.Quotas.ResetWindow: %w", domain.ErrNotFound)
	}
	return nil
}

// UpdatePlan writes a new plan + its derived cap and allow-list.
func (r *Quotas) UpdatePlan(ctx context.Context, userID uuid.UUID, plan enums.SubscriptionPlan, cap int, modelsAllowed []string) error {
	affected, err := r.q.UpdateCopilotQuotaPlan(ctx, copilotdb.UpdateCopilotQuotaPlanParams{
		UserID:        pgUUID(userID),
		Plan:          string(plan),
		RequestsCap:   int32(cap),
		ModelsAllowed: modelsAllowed,
	})
	if err != nil {
		return fmt.Errorf("copilot.Quotas.UpdatePlan: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("copilot.Quotas.UpdatePlan: %w", domain.ErrNotFound)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// Row → domain conversions
// ─────────────────────────────────────────────────────────────────────────

func conversationFromRow(r copilotdb.CopilotConversation) domain.Conversation {
	return domain.Conversation{
		ID:        fromPgUUID(r.ID),
		UserID:    fromPgUUID(r.UserID),
		Title:     r.Title,
		Model:     r.Model,
		CreatedAt: r.CreatedAt.Time,
		UpdatedAt: r.UpdatedAt.Time,
	}
}

func messageFromRow(r copilotdb.CopilotMessage) domain.Message {
	m := domain.Message{
		ID:             fromPgUUID(r.ID),
		ConversationID: fromPgUUID(r.ConversationID),
		Role:           enums.MessageRole(r.Role),
		Content:        r.Content,
		HasScreenshot:  r.HasScreenshot,
		TokensIn:       int(r.TokensIn),
		TokensOut:      int(r.TokensOut),
		LatencyMs:      int(r.LatencyMs),
		CreatedAt:      r.CreatedAt.Time,
	}
	if r.Rating.Valid {
		v := int8(r.Rating.Int16)
		m.Rating = &v
	}
	return m
}

func quotaFromRow(r copilotdb.CopilotQuota) domain.Quota {
	return domain.Quota{
		UserID:        fromPgUUID(r.UserID),
		Plan:          enums.SubscriptionPlan(r.Plan),
		RequestsUsed:  int(r.RequestsUsed),
		RequestsCap:   int(r.RequestsCap),
		ResetsAt:      r.ResetsAt.Time,
		ModelsAllowed: append([]string(nil), r.ModelsAllowed...),
		UpdatedAt:     r.UpdatedAt.Time,
	}
}

// ─────────────────────────────────────────────────────────────────────────
// pg helpers
// ─────────────────────────────────────────────────────────────────────────

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func fromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

func pgTimestamptz(t time.Time) pgtype.Timestamptz {
	if t.IsZero() {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: t, Valid: true}
}

func pgInt2(v int16) pgtype.Int2 { return pgtype.Int2{Int16: v, Valid: true} }

// ─────────────────────────────────────────────────────────────────────────
// Cursor codec
// ─────────────────────────────────────────────────────────────────────────

// encodeCursor packs (updated_at, id) into an opaque base64 token.
// Format (before base64): "<rfc3339nano>|<uuid>".
func encodeCursor(updatedAt time.Time, id uuid.UUID) domain.Cursor {
	raw := updatedAt.UTC().Format(time.RFC3339Nano) + "|" + id.String()
	return domain.Cursor(base64.RawURLEncoding.EncodeToString([]byte(raw)))
}

// decodeCursor is the inverse of encodeCursor.
func decodeCursor(c domain.Cursor) (time.Time, uuid.UUID, error) {
	b, err := base64.RawURLEncoding.DecodeString(string(c))
	if err != nil {
		return time.Time{}, uuid.Nil, fmt.Errorf("invalid cursor encoding: %w", err)
	}
	parts := strings.SplitN(string(b), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, uuid.Nil, errors.New("invalid cursor shape")
	}
	ts, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, uuid.Nil, fmt.Errorf("invalid cursor timestamp: %w", err)
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return time.Time{}, uuid.Nil, fmt.Errorf("invalid cursor uuid: %w", err)
	}
	return ts, id, nil
}

// Interface guards.
var (
	_ domain.ConversationRepo = (*Conversations)(nil)
	_ domain.MessageRepo      = (*Messages)(nil)
	_ domain.QuotaRepo        = (*Quotas)(nil)
)
