# druz9 migrations

Goose SQL поверх Postgres. Один консолидированный файл `00001_baseline.sql` — финальная схема + все Phase 1-4 / Wave 0-6 patches inline.

## Как это работает

`make migrate-up` прогоняет `00001_baseline.sql` за один проход. Если БД пустая (новый dev / restore из бэкапа) — получается финальное состояние. На проде prod-БД дропается и пересоздаётся из этого файла, никакой replay-истории не делаем.

## Когда добавлять новый файл

Любая новая миграция — отдельным файлом `0000N_<snake_name>.sql`. Создаётся через:

```bash
make migrate-new NAME=add_foo_table
```

Helper подбирает следующий свободный номер и создаёт пустой шаблон с `+goose Up/Down`. **Не используй `goose create` напрямую** — после первого `make migrate-new` номера перестают быть прозрачными.

Когда patch-миграций накопится много (~10-15) — сжать в новый baseline, см ниже.

## Соглашения

- **Down-блоки — `SELECT 1;`** Не катаем назад; если что-то не так — `make migrate-up` поверх фикса. Прод дропается и пересоздаётся.
- **Один patch — одна фича.** Не группируем «calendar + insights» в один файл.
- **Goose pragma `+goose StatementBegin/StatementEnd`** обязателен вокруг блоков с `;` внутри (DO $$, функции).
- **Seed отдельным файлом** (например `xxxx_atlas_seed.sql`) — schema-changes и data-fills не смешиваем.
- **CHECK на ENUM-полях** — `CREATE TYPE foo_status AS ENUM(...)` через отдельную секцию, потом референс в столбце.

## Команды

```bash
make migrate-up                    # прокатить всё вверх
make migrate-status                # показать какие применены
make migrate-new NAME=add_foo      # создать новую с auto-incremented уникальным номером
make seed                          # загрузить seed-data поверх

# Ручной rollback (на staging — не на проде):
goose -dir backend/migrations postgres "$POSTGRES_DSN" down
```

## Как сжать в новый baseline (когда понадобится)

Когда patches накапливаются и история становится нечитаемой:

```bash
# 1. Поднять чистую postgres
docker compose up -d postgres
make migrate-up

# 2. Дамп схемы
docker compose exec postgres pg_dump -U druz9 -d druz9 \
  --schema-only --no-owner --no-acl > /tmp/schema.sql

# 3. Дамп seed-данных (если seed-таблицы есть)
docker compose exec postgres pg_dump -U druz9 -d druz9 \
  --data-only --no-owner --no-acl \
  -t atlas_nodes -t atlas_edges -t llm_models -t personas -t podcast_categories -t tracks \
  > /tmp/seed.sql

# 4. Завернуть в +goose Up/Down блоки, заменить 00001_baseline.sql, удалить остальные.
```

Текущий baseline собран consolidation'ом 19 файлов (1 baseline + 18 patches), без pg_dump — каждый блок последовательно идёт в одном `+goose Up`. При первой возможности (как поднимется prod-БД) рекомендуется пересоздать через pg_dump для чистоты.
