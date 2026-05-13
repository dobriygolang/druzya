// Package infra holds the Postgres repositories + llmchain adapters for Hone.
//
// MVP policy: hand-rolled pgx. We move to sqlc once the queries stabilise —
// until then the shape of hone_daily_plans.items (jsonb array) is still
// evolving as we iterate on the plan-generation prompt, and regenerating
// sqlc types on every shape tweak is friction we don't need during MVP.
// See queries/hone.sql for the sqlc-ready source once we flip the switch.
//
// Wave 10 split (2026-05-13): the original ~2000-line postgres.go was split
// into per-domain files inside this package. Each repository now lives in
// its own file (postgres_<domain>.go) — same package, no API change.
//
//	postgres_plans.go         — Plans       (hone_daily_plans)
//	postgres_focus.go         — Focus       (hone_focus_sessions)
//	postgres_streaks.go       — Streaks     (hone_streak_*)
//	postgres_notes.go         — Notes       (hone_notes + cursor helpers)
//	postgres_folders.go       — Folders     (hone_note_folders)
//	postgres_whiteboards.go   — Whiteboards (hone_whiteboards)
//	postgres_resistance.go    — Resistance  (hone_plan_skips)
//	postgres_queue.go         — Queue       (hone_queue_items)
//	postgres_cue.go           — CueSessions (hone_notes WHERE kind='cue')
//
// This file remains as the package overview and centralised interface-guard
// compile-time checks so adding a new repo file is one place to register it.
package infra

import "druz9/hone/domain"

// ── interface guards ──────────────────────────────────────────────────────
//
// Compile-time assertions that the per-file repository types still satisfy
// their domain interfaces. Drift between a repo and its interface surfaces
// here before any caller breaks.
var (
	_ domain.PlanRepo       = (*Plans)(nil)
	_ domain.FocusRepo      = (*Focus)(nil)
	_ domain.StreakRepo     = (*Streaks)(nil)
	_ domain.NoteRepo       = (*Notes)(nil)
	_ domain.WhiteboardRepo = (*Whiteboards)(nil)
	_ domain.ResistanceRepo = (*Resistance)(nil)
	_ domain.QueueRepo      = (*Queue)(nil)
	_ domain.CueSessionRepo = (*CueSessions)(nil)
)
