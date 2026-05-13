// Package infra holds the Postgres repositories + llmchain adapters for Hone.
//
// Hand-rolled pgx — `hone_daily_plans.items` (jsonb) still evolves with the
// plan-generation prompt, so sqlc would mean regen on each shape tweak. See
// queries/hone.sql for the sqlc-ready source.
//
// Each repository lives in its own file (postgres_<domain>.go); this file
// centralises interface-guard checks so adding a new repo is one place.
package infra

import "druz9/hone/domain"

// Compile-time interface guards. Drift between a repo and its interface
// surfaces here before any caller breaks.
var (
	_ domain.PlanRepo       = (*Plans)(nil)
	_ domain.FocusRepo      = (*Focus)(nil)
	_ domain.StreakRepo     = (*Streaks)(nil)
	_ domain.NoteRepo       = (*Notes)(nil)
	_ domain.WhiteboardRepo = (*Whiteboards)(nil)
	_ domain.ResistanceRepo = (*Resistance)(nil)
	_ domain.QueueRepo      = (*Queue)(nil)
	_ domain.CueSessionRepo = (*CueSessions)(nil)
	_ domain.JournalRepo    = (*Journal)(nil)
)
