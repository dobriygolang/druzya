// Package infra will host:
//   - the Postgres adapter against migration 00029_tg_coach.sql,
//   - the Telegram bot client wrapper around `gopkg.in/telebot.v3`,
//   - the OpenRouter LLM client (extracted in Phase 2 from
//     backend/services/profile/infra/openrouter_insight.go to
//     backend/shared/pkg/openrouter/).
//
// STRATEGIC SCAFFOLD: empty by design. See ../README.md.
package infra
