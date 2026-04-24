# druz9 migrations — consolidated set

Prod DB is dropped and rebuilt from this migration set. What used to be 48 incremental
migrations (00001…00054, with gaps) is now 8 domain-scoped files that describe the final
schema shape as of the consolidation. Down blocks are all `SELECT 1;` no-ops — we don't roll
back; if something is wrong, drop the DB and re-apply.

Every `ALTER TABLE ADD COLUMN` from the history is inlined into the originating `CREATE
TABLE`. Tables that were created-then-dropped (legacy `vacancies` in 00014/00041) are gone.
Seed data that was later deleted (fake podcasts from 00009, killed by 00039) is omitted.

## Files

| # | File | Tables (count) | Notes |
|---|------|---------------:|-------|
| 00001 | `00001_auth_users.sql`    |  4 | `users` (+avatar/ai-model/onboarding cols), `oauth_accounts`, `user_bans`, `user_reports`, `incidents` |
| 00002 | `00002_progression.sql`   | 12 | `profiles` (+mentor cols), `ratings`, `skill_nodes`, `seasons`, `season_progress`, `achievements`, `user_achievements`, `atlas_nodes`+`atlas_edges` (+seed), `elo_snapshots_daily`, `weekly_share_tokens`, `mentor_sessions`; seeds current season |
| 00003 | `00003_content.sql`       |  6 | `companies`, `tasks`, `test_cases`, `task_templates`, `follow_up_questions`, `task_ratings` + full seed (5 companies, 50 tasks, test cases, templates, follow-ups) |
| 00004 | `00004_arena.sql`         |  7 | `arena_matches` (+winning_team_id), `arena_participants`, `editor_rooms`, `editor_participants`, `lobbies`, `lobby_members`, `anticheat_signals` |
| 00005 | `00005_daily_mock.sql`    |  7 | `mock_sessions`, `mock_messages`, `native_sessions`, `native_provenance`, `daily_streaks`, `daily_kata_history`, `interview_calendars`, `interview_autopsies` |
| 00006 | `00006_cohort_guild.sql`  |  8 | `guilds`+`guild_members`+`guild_wars` (final shape: public/join_policy, SET NULL winner), `cohorts` (+capacity), `cohort_members`, `cohort_invites`, `cohort_announcements`, `cohort_announcement_reactions` |
| 00007 | `00007_slot_review.sql`   |  4 | `slots` (+meet_url), `bookings`, `reviews` (composite PK, direction + subject_id), `interviewer_applications` |
| 00008 | `00008_social_ops.sql`    | 28 | billing (`boosty_accounts`, `subscriptions`, `ai_credits`), `dynamic_config` (+seed), notifications (`notifications_log`, `notification_preferences`, `user_notifications`, `notification_prefs`), `onboarding_progress`, `llm_configs`, `friendships`+`friend_codes`, `support_tickets`, `saved_vacancies` (snapshot shape), podcasts CMS (`podcast_categories`+`podcasts`+`podcast_progress`, cat seed, no fake podcasts), B2B (`organizations`, `org_members`, `org_seats`), tg (`tg_user_link`, `tg_link_tokens`), `llm_models` (+seed: druz9/turbo + groq + cerebras + mistral + openrouter :free), copilot (`copilot_sessions`, `copilot_conversations`, `copilot_messages`, `copilot_quotas`, `copilot_session_reports` with analysis+title), `personas` (+seed) |

## What changed vs the legacy 48-file tree

- **Dropped entirely**: legacy `vacancies` table (created 00014, dropped 00041). Replacement is
  the self-contained snapshot model in `saved_vacancies` (from 00040).
- **Fake seeds removed**: the 12 placeholder `podcasts/*.mp3` rows from 00009 — 00039 deleted
  them; they never had real audio.
- **RENAMEs collapsed**: `slot_reviews` → `reviews` (00048) is now just `reviews`.
- **Schema churn collapsed**: every `ALTER TABLE ADD COLUMN` / `DROP CONSTRAINT` / `UPDATE
  kind = …` from 00010/00011/00012/00018/00023/00025/00027/00028/00032/00033/00034/00035/00044/00046/00047/00048/00049/00050/00052/00053/00054 is inlined into the appropriate `CREATE TABLE` in the consolidated file.

## Goose notes

- Down blocks are intentionally `SELECT 1;` — we rebuild from scratch, we never roll back.
- File order is also FK order: `users` first → `profiles/ratings` → content → arena uses
  `tasks` → mock uses `companies`/`tasks` → cohort/guild → slot/review reference `bookings`
  chain → social_ops only references `users`.
