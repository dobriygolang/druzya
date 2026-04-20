package domain

import (
	"time"

	sharedDomain "druz9/shared/domain"

	"github.com/google/uuid"
)

// WeeklyReportDue is LOCAL to the notify domain. It is published by the
// internal scheduler each Sunday at cfg.WeeklyReportHour and consumed by the
// notify event handler that triggers the DM.
//
// NOTE: this event is deliberately NOT added to backend/shared/domain/events.go
// because it is a private scheduler-to-handler channel — no other domain has a
// reason to react. If another domain later needs it (e.g. to pre-render a PDF
// report), promote this to shared/domain/events.go then.
type WeeklyReportDue struct {
	At     time.Time `json:"at"`
	UserID uuid.UUID `json:"user_id"`
}

// Topic implements sharedDomain.Event.
func (WeeklyReportDue) Topic() string { return "notify.WeeklyReportDue" }

// OccurredAt implements sharedDomain.Event.
func (e WeeklyReportDue) OccurredAt() time.Time { return e.At }

// Compile-time assertion that the local event satisfies the shared interface.
var _ sharedDomain.Event = WeeklyReportDue{}
