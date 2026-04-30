---
name: add-migration
description: Add a Goose SQL migration to the druz9 backend — naming, up/down semantics, sqlc query regeneration, and safe rollout. Use when changing schema (new tables, columns, indexes, data backfills).
---

# Добавить миграцию

Goose + Postgres + sqlc. Миграции живут в `backend/migrations/`. Имена строго пронумерованы. Реализуем `up` и `down` для каждой.

## Когда применять

- Новые таблицы / колонки / индексы.
- Бэкфил данных (с осторожностью — большие таблицы пугают replicate-lag).
- Удаление устаревших структур (часть Phase-cleanup).

## Не применять

- Если только меняется query, без схемы — не миграция, это `infra/queries.sql` + `make gen-sqlc`.
- Если меняется `proto/` — это [add-rpc.md](./add-rpc.md), миграция может прийти параллельно.

## Шаги

### 1. Найти текущий номер

```bash
ls backend/migrations/ | grep -v README | tail -3
```

Текущая голова смотри в файле — нумерация инкрементальная поверх baseline (`00001_baseline.sql`). Следующая = последний номер + 1.

Перед созданием — обязательно `ls`, чтобы не словить коллизию (например, `00005` уже занят `insights.sql`).

### 2. Создать файл

Имя: `00005_<short_topic>.sql`. Снейк-кейс, без пробелов, ≤30 символов.

Шаблон (Goose-pragma — обязательно):

```sql
-- +goose Up
-- +goose StatementBegin

-- 00009_<topic>.sql
--
-- Зачем эта миграция (1-2 абзаца WHY, не WHAT). Если меняется
-- существующая таблица — почему именно так, а не ALTER в baseline.
-- Если есть backfill — какова логика и safe ли она на проде.

CREATE TABLE IF NOT EXISTS hone_focus_goals (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    daily_minutes_target INT NOT NULL CHECK (daily_minutes_target > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hone_focus_goals_updated_at
    ON hone_focus_goals (updated_at);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- additive migration; rollback drops the DB (see baseline policy)
-- +goose StatementEnd
```

Правила:
- `IF NOT EXISTS` / `IF EXISTS` везде где имеет смысл (idempotency).
- Имена таблиц с префиксом домена: `hone_*`, `arena_*`, `copilot_*`.
- Внешние ключи на `users(id)` — обязательно `ON DELETE CASCADE` (юзер удалил аккаунт → всё его уходит).
- Индексы создавай явно, не полагайся на implicit.
- Каждый ALTER оборачивай в `+goose StatementBegin / StatementEnd` (необходимо для multi-statement миграций).
- **Down всегда `SELECT 1;`** — реального rollback'а нет, БД пересоздаётся из baseline. См [backend/migrations/README.md](../../backend/migrations/README.md).
- Header-комментарий с WHY обязателен в самом начале Up-блока. Смотри 00003 / 00004 / 00005 как образцы.

### 3. Большие таблицы — concurrent index

Если таблица потенциально с 100k+ строк:

```sql
-- +goose Up
-- +goose NO TRANSACTION
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_huge_table_field ON huge_table (field);

-- +goose Down
-- +goose NO TRANSACTION
DROP INDEX CONCURRENTLY IF EXISTS idx_huge_table_field;
```

`NO TRANSACTION` обязателен для `CONCURRENTLY` — Postgres не позволит внутри транзакции.

### 4. Бэкфил данных

Для backfill отдельная миграция (или отдельный шаг внутри той же):

```sql
-- +goose Up
ALTER TABLE notes ADD COLUMN IF NOT EXISTS sort_index INT NOT NULL DEFAULT 0;

-- Backfill по timestamp
UPDATE notes SET sort_index = EXTRACT(EPOCH FROM created_at)::INT;

-- +goose Down
ALTER TABLE notes DROP COLUMN IF EXISTS sort_index;
```

Если backfill долгий (>5 минут на проде) — раздели на batched UPDATE и запускай отдельным скриптом, не миграцией.

### 5. Применить локально

```bash
make migrate-up
make migrate-status   # проверить, что новая запись появилась
```

Откатить (для проверки down):

```bash
GOWORK=off go run github.com/pressly/goose/v3/cmd/goose@v3.19.2 \
    -dir backend/migrations postgres "$POSTGRES_DSN" down
make migrate-up      # снова поднять
```

### 6. Регенерация sqlc

Если новые таблицы/колонки участвуют в queries — обнови `backend/services/<name>/infra/queries.sql` и запусти:

```bash
make gen-sqlc
```

Это обновит generated query-код. Коммить вместе с миграцией.

### 7. Smoke на staging (для нетривиальных)

Перед merge в main для миграций с DROP / RENAME / data-modification:

```bash
ssh root@$STAGING
docker compose exec api goose -dir /app/migrations postgres "$POSTGRES_DSN" up
# Прогнать smoke-сценарий через web/Hone
```

### 8. Деплой в прод

Происходит автоматически по `infra/scripts/deploy.sh` после merge. Проверка:

```bash
ssh root@$VPS
docker compose exec api goose -dir /app/migrations postgres "$POSTGRES_DSN" status
```

## Anti-patterns

- ❌ **Менять старую миграцию.** Если `00003_x.sql` уже на проде — она immutable. Делай новую.
- ❌ **DROP COLUMN без grace period.** Сначала перестать писать в колонку (deploy code), потом миграция (deploy schema). Не одновременно.
- ❌ **Backfill в транзакции на большой таблице.** Lock на 30 минут = downtime.
- ❌ **Писать реальный Down.** Конвенция проекта: Down = `SELECT 1;`. Rollback делается пересозданием БД из baseline + накатом всех инкрементов. Это записано в [backend/migrations/README.md](../../backend/migrations/README.md).
- ❌ **Хардкодить enum-значения через `text`.** Используй Postgres `enum` или ссылочную таблицу. См `shared/enums/` для соответствия.
- ❌ **Удалять `users(id)` FK без `ON DELETE`.** Будут orphan-записи и нарушение GDPR.
- ❌ **Skip header-comment с WHY.** Migration без объяснения «зачем» — половина её ценности (audit trail для будущего себя).

## Related

- [.ai/skills/add-rpc.md](./add-rpc.md) — если миграция сопровождает новый endpoint
- [docs/tech/backend.md#postgres](../../docs/tech/backend.md#postgres) — общие правила
