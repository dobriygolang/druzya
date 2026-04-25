// Package app — Cue's "should I be quiet right now?" gate.
//
// CheckBlock is the unary RPC the desktop client polls before every consult
// (and the server-side defense-in-depth check inside Analyze/Chat). The data
// source is ai_mock's mock_sessions table, queried via domain.MockSessionGate
// — see infra/mock_gate.go for the SQL.
package app

import (
	"context"
	"fmt"
	"time"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// CheckBlock — implements POST /api/v1/copilot/check-block (and the matching
// Connect RPC). Returns blocked=true while the caller has a live mock-session
// with ai_assist=FALSE.
type CheckBlock struct {
	Gate domain.MockSessionGate
}

// CheckBlockInput carries the authenticated caller. Pulled from the auth
// middleware — there is no body shape on the wire.
type CheckBlockInput struct {
	UserID uuid.UUID
}

// CheckBlockResult is the use-case-shaped response. The ports layer maps it
// to pb.CheckBlockResponse.
type CheckBlockResult struct {
	Blocked bool
	Reason  string
	Until   time.Time
}

const reasonMockNoAssist = "mock_no_assist"

// Do checks the gate and assembles the response. nil-safe Gate (returns
// blocked=false) so test wiring without ai_mock still compiles.
func (uc *CheckBlock) Do(ctx context.Context, in CheckBlockInput) (CheckBlockResult, error) {
	if uc.Gate == nil {
		return CheckBlockResult{}, nil
	}
	blocked, until, err := uc.Gate.HasActiveBlockingSession(ctx, in.UserID)
	if err != nil {
		return CheckBlockResult{}, fmt.Errorf("copilot.CheckBlock: %w", err)
	}
	if !blocked {
		return CheckBlockResult{}, nil
	}
	return CheckBlockResult{
		Blocked: true,
		Reason:  reasonMockNoAssist,
		Until:   until,
	}, nil
}
