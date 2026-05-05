# druz9 migrations

Goose SQL поверх Postgres. Один консолидированный baseline `00001_baseline.sql` (~3.1k строк, финальная схема + Phase 1-4 / Wave 0-6 inline) + ~60 patch-миграций сверху.

Текущее состояние (2026-05-05): **64 `.sql` файла**, последний номер — `00081`. Гэпы (00002-15, 00053, 00069-71) — следствие consolidations и переименований; goose их игнорирует. Дубликат `00068` (focus_mode_check + drop_anticheat_attribute_columns) — оба уже применены на проде, ПЕРЕИМЕНОВЫВАТЬ НЕЛЬЗЯ (сломаешь goose).

## Как это работает

`make migrate-up` (или `goose -dir backend/migrations postgres "$DSN" up`) прогоняет всё снизу вверх, начиная с baseline. Если БД пустая (новый dev / restore из бэкапа) — получается финальное состояние. На проде prod-БД дропается и пересоздаётся; replay-истории не делаем.

Apply'ит миграции CI deploy-step (`infra/deploy.sh` → `make migrate-up`) или разработчик вручную при `make start`.

## Высокоуровневая структура

| Слой | Где | Ключевые таблицы |
|---|---|---|
| **Baseline (00001)** | финальная схема ядра | `users`, `profiles`, `user_xp`, `atlas_nodes`/`atlas_edges`, `tasks`/`test_cases`, `mock_sessions`/`mock_messages`, `podcasts`/`podcast_progress`, `subscriptions`, `friendships`, `circles`, `dynamic_config`, `embedding_models`, `notifications` |
| **Tutor (16-22, 38-41, 45, 62)** | tutor события, materials, briefs, RSVP, session-notes | `tutor_events`, `tutor_event_rsvps`, `tutor_listings`, `tutor_session_notes`, `tutor_shared_materials`, `tutor_brief_share_links` (dropped в 67) |
| **Atlas seeds (18-19, 22, 24, 49)** | Skill atlas content | `atlas_nodes` rows: analyst / qa-devops / data-engineering / codex articles |
| **Tracks (23, 27, 33, 48, 50, 52)** | Учебные треки + steps | `tracks`, `track_steps`, ML-/DE-/Go-curated tracks |
| **AI / personas (30, 36, 54, 57-58)** | AI-tutor, AI-mock, persona system | `ai_tutor_*`, `mock_pipelines`, `personas`, `persona_prompts` |
| **Hone (35, 42)** | Desktop кокпит | `hone_user_settings`, `hone_focus_sessions` |
| **External resources (43, 47, 51, 55, 65)** | Curation / ranking-proxy слой | `external_resources`, `user_resource_log`, `user_resource_overrides`, `resource_promotion_signals`, `domain_reputation` |
| **Atlas user-state (44, 64)** | Per-user Atlas | `user_atlas_nodes`, `user_atlas_node_prefs` |
| **Learning state (47, 56)** | Track progress | `learning_state`, `step_checkpoint_attempts` |
| **Collab rooms (66)** | Editor / whiteboard | `editor_rooms` / `whiteboard_rooms` ALTER + `user_room_quota` |
| **Observability (60, 63)** | Admin dashboards | `observability_*`, `admin_audit_log` (dropped в 67) |
| **Cleanup / drops (29, 31-32, 34, 46, 67-68, 74-81)** | Удаление выпиленных модулей | drop arena/lobby/marketplace/slot/rating/review/events/anticheat/dead_schema/ai_credits/career_stage/daily_kata/orphans/personal_events/xp_events |
| **Misc (25-26, 28, 37, 39, 59, 61, 72-73)** | company stages, tasks/mock seed, external_activity, ai_chat_quota, onboarding_version, perf_indexes, status_enums |

## Когда добавлять новый файл

Любая новая миграция — отдельным файлом `0000N_<snake_name>.sql`. Создаётся через:

```bash
make migrate-new NAME=add_foo_table
```

Helper подбирает следующий свободный номер и создаёт пустой шаблон с `+goose Up/Down`. **Не используй `goose create` напрямую** — после первого `make migrate-new` номера перестают быть прозрачными.

Когда patch-миграций накопится много (~10-15) — сжать в новый baseline (см ниже).

## Соглашения

- **Down-блоки.** Для дроп-таблиц / DESTRUCTIVE миграций — `SELECT 1;` с комментом `-- IRRECOVERABLE: ...`. Не катаем назад; если что-то не так — `make migrate-up` поверх фикса. Прод дропается и пересоздаётся.
- **Каждая миграция ОБЯЗАНА иметь `-- +goose Up` и `-- +goose Down` блоки.** Аудит 2026-05-05: все 64 файла валидны.
- **Один patch — одна фича.** Не группируем «calendar + insights» в один файл.
- **Goose pragma `+goose StatementBegin/StatementEnd`** обязателен вокруг блоков с `;` внутри (DO $$, функции).
- **Seed отдельным файлом** (`xxxx_atlas_seed.sql`) — schema-changes и data-fills не смешиваем.
- **CHECK на ENUM-полях** — `CREATE TYPE foo_status AS ENUM(...)` через отдельную секцию, потом референс в столбце.
- **НЕ переименовывать applied миграции.** goose отслеживает их по filename в `goose_db_version`.

## Команды

```bash
make migrate-up                    # прокатить всё вверх
make migrate-status                # показать какие применены
make migrate-new NAME=add_foo      # создать новую с auto-incremented уникальным номером
make seed                          # загрузить seed-data поверх

# Ручной rollback (на staging — не на проде):
goose -dir backend/migrations postgres "$POSTGRES_DSN" down
```

## Baseline plan: squash до v1.0

После того как Phase 12+ застабилизируется и patch-список перевалит за ~80-100 файлов:

```bash
# 1. Поднять чистую postgres
docker compose up -d postgres
make migrate-up

# 2. Дамп схемы
docker compose exec postgres pg_dump -U druz9 -d druz9 \
  --schema-only --no-owner --no-acl > /tmp/schema.sql

# 3. Дамп seed-данных
docker compose exec postgres pg_dump -U druz9 -d druz9 \
  --data-only --no-owner --no-acl \
  -t atlas_nodes -t atlas_edges -t llm_models -t personas -t podcast_categories -t tracks \
  > /tmp/seed.sql

# 4. Завернуть в +goose Up/Down блоки, заменить 00001_baseline.sql, удалить остальные.
# 5. Truncate `goose_db_version` на проде, заново вставить запись о baseline.
```

Текущий baseline собран consolidation'ом 19 файлов (1 baseline + 18 patches), без pg_dump. При первой возможности (как поднимется prod-БД с инвариантной схемой) рекомендуется пересоздать через pg_dump для чистоты.
