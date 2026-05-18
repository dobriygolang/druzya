package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/ai_tutor/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// RecordUserMessage атомарно увеличивает счётчики thread'а и аппендит
// user-episode (плюс optional context-note system-episode) в одной
// транзакции. Если IncrementCounters упирается в DailyMessageLimit, tx
// откатывается и метод возвращает ErrRateLimited — counter в БД не
// инкрементнётся, episode не вставится.
func (p *Postgres) RecordUserMessage(
	ctx context.Context,
	threadID uuid.UUID,
	content, contextNote string,
	now time.Time,
) (domain.Thread, domain.Episode, error) {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domain.Thread{}, domain.Episode{}, fmt.Errorf("ai_tutor.RecordUserMessage: begin: %w", err)
	}
	defer func() {
		// Rollback идемпотентен после Commit'а — pgx вернёт ErrTxClosed,
		// который мы намеренно дропаем.
		_ = tx.Rollback(ctx)
	}()

	thread, err := incrementCountersTx(ctx, tx, threadID, now)
	rateLimited := errors.Is(err, domain.ErrRateLimited)
	if err != nil && !rateLimited {
		return domain.Thread{}, domain.Episode{}, fmt.Errorf("ai_tutor.RecordUserMessage: %w", err)
	}
	if rateLimited {
		// Лимит исчерпан — counter мы не персистим: откат произойдёт через
		// defer. Возвращаем актуальный thread (пред-инкрементное состояние
		// уже отскейлено в `thread`, но всё равно tx откатится).
		return thread, domain.Episode{}, domain.ErrRateLimited
	}

	// Context-note (system-episode) — append'ится ДО user-episode чтобы LLM
	// recall видел его в хронологическом порядке. Best-effort внутри tx:
	// ошибка ноты не должна блокировать ход.
	if contextNote != "" {
		_, _ = appendEpisodeTx(ctx, tx, domain.Episode{
			ThreadID: threadID,
			Role:     domain.RoleSystem,
			Content:  contextNote,
		})
	}

	userEp, err := appendEpisodeTx(ctx, tx, domain.Episode{
		ThreadID: threadID,
		Role:     domain.RoleUser,
		Content:  content,
	})
	if err != nil {
		return domain.Thread{}, domain.Episode{}, fmt.Errorf("ai_tutor.RecordUserMessage: episode: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.Thread{}, domain.Episode{}, fmt.Errorf("ai_tutor.RecordUserMessage: commit: %w", err)
	}
	return thread, userEp, nil
}

// incrementCountersTx — versions IncrementCounters работающая на pgx.Tx,
// чтобы можно было разделить инкремент и append'ы внутри одного tx.
func incrementCountersTx(ctx context.Context, tx pgx.Tx, threadID uuid.UUID, now time.Time) (domain.Thread, error) {
	today := now.UTC().Truncate(24 * time.Hour)
	q := `
		UPDATE ai_tutor_threads
		SET message_count = message_count + 1,
		    daily_msg_count = CASE
		        WHEN daily_msg_reset_date < $2 THEN 1
		        ELSE daily_msg_count + 1
		    END,
		    daily_msg_reset_date = CASE
		        WHEN daily_msg_reset_date < $2 THEN $2
		        ELSE daily_msg_reset_date
		    END,
		    updated_at = now()
		WHERE id = $1
		RETURNING ` + threadCols
	row := tx.QueryRow(ctx, q, pgUUID(threadID), pgtype.Date{Time: today, Valid: true})
	out, err := scanThread(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Thread{}, domain.ErrNotFound
		}
		return domain.Thread{}, err
	}
	if out.DailyMsgCount > domain.DailyMessageLimit {
		return out, domain.ErrRateLimited
	}
	return out, nil
}

func appendEpisodeTx(ctx context.Context, tx pgx.Tx, e domain.Episode) (domain.Episode, error) {
	if !e.Role.Valid() {
		return domain.Episode{}, domain.ErrInvalidInput
	}
	const q = `
		INSERT INTO ai_tutor_episodes (thread_id, role, content, model_used, tokens_in, tokens_out)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, occurred_at`
	var (
		id         pgtype.UUID
		occurredAt pgtype.Timestamptz
	)
	if err := tx.QueryRow(ctx, q,
		pgUUID(e.ThreadID), string(e.Role), e.Content, e.ModelUsed, e.TokensIn, e.TokensOut,
	).Scan(&id, &occurredAt); err != nil {
		return domain.Episode{}, err
	}
	e.ID = uuidFrom(id)
	if occurredAt.Valid {
		e.OccurredAt = occurredAt.Time
	}
	return e, nil
}
