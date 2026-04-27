// Package infra — Postgres adapters for the sync domain.
//
// Three concerns split across files:
//   - catalog.go       table whitelist + per-table column / cursor metadata
//   - devices_repo.go  device CRUD + heartbeat revocation check
//   - replication_repo.go  pull/push table reads, tombstone writes & GC
package infra

import (
	"sort"

	"druz9/sync/domain"
)

// allTables — таблицы которые мы синкаем в Phase C-4. notes/whiteboards
// здесь как LWW — это temporary до C-6 когда их заменит Yjs sync.
// Таблица называется hone_daily_plans (см. migrations/00013_hone_focus.sql),
// раньше тут было ошибочное "hone_plans" → 500 на каждый pull. Cursor
// column = regenerated_at (когда AI-синтез последний раз перегенерил план).
var allTables = []string{
	"hone_notes",
	"hone_whiteboards",
	"hone_focus_sessions",
	"hone_daily_plans",
	"coach_episodes",
}

// pullColumns — list per table колонок которые отдаём клиенту. Не *
// (защита от случайного раскрытия sensitive колонок типа embedding'ов
// которые должны оставаться сервер-side только).
var pullColumns = map[string]string{
	"hone_notes":       "id, title, body_md, size_bytes, archived_at, published_at, public_slug, created_at, updated_at",
	"hone_whiteboards": "id, title, state_json, version, archived_at, created_at, updated_at",
	// hone_focus_sessions schema (см. migrations/00013_hone_focus.sql):
	// нет planned_duration_seconds / actual_duration_seconds. Реальная факт-
	// длительность хранится в seconds_focused, mode различает pomodoro vs
	// stopwatch. Фикс предыдущего bug'а где /api/v1/sync/pull возвращал 500
	// «column does not exist» каждый раз когда клиент тянул focus_sessions.
	"hone_focus_sessions": "id, started_at, ended_at, mode, pomodoros_completed, seconds_focused, plan_item_id, pinned_title",
	"hone_daily_plans":    "id, plan_date, items, regenerated_at, created_at, updated_at",
	"coach_episodes":      "id, kind, summary, payload, occurred_at, created_at",
}

// pullCursorColumn — какое поле использовать для cursor-фильтра. Для
// большинства — updated_at; для append-only (focus_sessions, episodes) —
// created_at; для plans — regenerated_at.
var pullCursorColumn = map[string]string{
	"hone_notes":          "updated_at",
	"hone_whiteboards":    "updated_at",
	"hone_focus_sessions": "started_at", // append-only by start
	"hone_daily_plans":    "regenerated_at",
	"coach_episodes":      "created_at",
}

// Catalog — adapter satisfying domain.TableCatalog over the static maps
// above. Single instance is enough; no state.
type Catalog struct{}

// NewCatalog returns the default sync catalog.
func NewCatalog() *Catalog { return &Catalog{} }

// AllTables returns the canonical sync table list, copy to keep callers
// from mutating the package-level slice.
func (Catalog) AllTables() []string {
	out := make([]string, len(allTables))
	copy(out, allTables)
	return out
}

// Known reports whether a table is part of the sync catalog.
func (Catalog) Known(table string) bool {
	_, ok := pullColumns[table]
	return ok
}

// Names — debug helper, sorted copy.
func (Catalog) Names() []string {
	out := make([]string, 0, len(pullColumns))
	for k := range pullColumns {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

var _ domain.TableCatalog = (*Catalog)(nil)
