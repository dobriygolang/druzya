// review_animator.go — choreography for the AI cursor.
//
// When CoachListener decides "settle" or "regress" (driven by a real bus
// event from arena/mock/quiz), it ALSO calls ReviewAnimator.Choreograph
// which publishes a slow-motion sequence of CursorEvents to the
// per-user CursorEventBus:
//
//  1. cursor.move    → fly to the card                ─┐
//  2. card.focus     → highlight                       │  ~1.5–4s
//  3. card.thinking  → spinner (~2s)                   │   pauses
//  4. card.comment   → comment lands in thread         │   between
//  5. card.move      → card slides into the new column ─┘   each
//
// The pauses are intentional: the user perceives "the AI is reading my
// arena result, deciding, then committing" instead of a teleport. The
// animator runs in its own goroutine so the publishing path of the
// triggering event is not blocked.
package app

import (
	"context"
	"log/slog"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ReviewAnimator publishes the AI cursor sequences. Stateless other than
// its dependency wiring.
type ReviewAnimator struct {
	Cursor domain.CursorEventBus
	Log    *slog.Logger

	// Tunables (zeros use defaults).
	StepDelay     time.Duration // 0 → 1500ms — between visible events
	ThinkingDelay time.Duration // 0 → 2000ms — for the explicit "thinking" beat
}

// Choreograph plays a settle (passed=true) or regress (passed=false)
// sequence for the given task. Runs in a fresh goroutine — caller does
// not block.
//
// Why a separate ctx with timeout: the parent context is the bus
// publisher's, which may be cancelled the moment the original event
// completes. The animation must outlive the publisher request.
func (a *ReviewAnimator) Choreograph(userID uuid.UUID, task domain.Task, comment string, passed bool) {
	if a == nil || a.Cursor == nil {
		return
	}
	go a.run(userID, task, comment, passed)
}

func (a *ReviewAnimator) run(userID uuid.UUID, task domain.Task, comment string, passed bool) {
	step := a.StepDelay
	if step <= 0 {
		step = 1500 * time.Millisecond
	}
	thinking := a.ThinkingDelay
	if thinking <= 0 {
		thinking = 2000 * time.Millisecond
	}
	target := domain.TaskStatusDone
	if !passed {
		target = domain.TaskStatusInProgress
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	emit := func(e domain.CursorEvent) {
		e.UserID = userID
		e.OccurredAt = time.Now().UTC()
		a.Cursor.Publish(ctx, e)
	}
	pause := func(d time.Duration) {
		select {
		case <-ctx.Done():
		case <-time.After(d):
		}
	}

	// 1. Move pointer to the card.
	emit(domain.CursorEvent{Kind: domain.CursorMove, TaskID: task.ID, ToColumn: task.Status})
	pause(step)
	// 2. Focus.
	emit(domain.CursorEvent{Kind: domain.CardFocus, TaskID: task.ID})
	pause(step)
	// 3. Thinking spinner — visible work.
	emit(domain.CursorEvent{Kind: domain.CardThinking, TaskID: task.ID})
	pause(thinking)
	// 4. Comment.
	if comment != "" {
		emit(domain.CursorEvent{Kind: domain.CardComment, TaskID: task.ID, Body: comment})
		pause(step)
	}
	// 5. Move card.
	emit(domain.CursorEvent{
		Kind: domain.CardMove, TaskID: task.ID,
		FromColumn: task.Status, ToColumn: target,
	})
}
