-- Phase-4 ADR-002 F-1 — sysdesign seed: 2 system-design tasks + interviewer
-- follow-ups, plus rewire Yandex company_stages to include sysdesign before
-- behavioral.
--
-- Goal: a fresh dev DB lets a user run the full Yandex pipeline end-to-end:
--   hr → algo → sysdesign → behavioral
-- without admin manually populating the sysdesign content.
--
-- Random mode (company_id=NULL) also benefits — pickTaskForStage falls back
-- to "any active mock_task with stage_kind='sysdesign'" when no company_stage
-- restricts the pool.
--
-- Idempotent: ON CONFLICT DO NOTHING / DO UPDATE.

-- +goose Up

-- ─── sysdesign task 1: URL shortener (classic warm-up) ────────────────────
INSERT INTO mock_tasks (
  stage_kind, language, difficulty, title, body_md, sample_io_md,
  reference_criteria, reference_solution_md, functional_requirements_md,
  time_limit_min, active
)
VALUES (
  'sysdesign', 'any', 2,
  'URL Shortener',
  '# URL Shortener

Спроектируй сервис коротких ссылок (как bit.ly).

Пользователь отправляет длинный URL — получает короткий вида `druz.ly/abc123`. По клику на короткий — редирект 302 на оригинальный URL. Доступна базовая аналитика (количество кликов).

Нарисуй высокоуровневую архитектуру: компоненты, БД, кэш, балансер. В правом блоке "Контекст" объясни выбор технологий и trade-offs.',
  '',
  '{"must_mention":["base62 / hash для генерации короткого id","read-heavy профиль (read >> write)","кэш для горячих ссылок (Redis/Memcached)","key-value БД или relational с index на short_id","CDN/edge для редиректа"],"nice_to_have":["bloom filter для проверки существования id","rate-limit на write (anti-abuse)","TTL для просроченных ссылок","analytics через async event-stream (Kafka)"],"common_pitfalls":["один SQL-запрос на каждый редирект без кэша","auto-increment id (легко предсказывается)","UUID как short_id (слишком длинный)","полная синхронная аналитика на горячем пути"]}'::jsonb,
  '## Reference architecture

```
[Client] → [CDN / Edge] → [LB] → [Web tier (stateless)]
                                        ↓
                                [Redis cache: short_id → long_url]
                                        ↓ (cache miss)
                                [DB: PG / Cassandra / DynamoDB]
                                        ↓ (на write)
                                [Kafka] → [Analytics consumer] → [ClickHouse]
```

**Generation**: counter (Snowflake/Redis INCR) → base62 → 6-7 символов. Даёт ~56B IDs до collision при 7 chars.

**Cache**: write-through на create, LRU eviction. Hit-rate 95%+ на горячих ссылках (Pareto: 20% URLs дают 80% redirects).

**DB**: PG достаточно до ~10M URLs, потом sharding по short_id или переход на key-value (Cassandra / DynamoDB). Index на `short_id`, partition по `short_id`. Read-heavy → можно read-replicas + eventual consistency приемлемо.

**Analytics**: redirect handler пишет event в Kafka (fire-and-forget), отдельный consumer агрегирует в ClickHouse. Аналитика в read-side не блокирует hot path.

**Trade-offs**:
- Hash vs counter: hash защищает от перебора, но collision check = extra read. Snowflake-counter быстрее но предсказуем — компромисс через base62 + случайный suffix 2-3 chars.
- Strong vs eventual consistency: для редиректа eventual OK (если только что создал — допустимо 200ms лаг). Для analytics — eventual норма.
- DB choice: PG для MVP, Cassandra/DynamoDB при > 100M URLs.

**Edge cases**: TTL на ссылки (TTL в Redis + cleanup-job в DB), коллизии в base62 (retry с suffix), abuse (rate-limit per IP / API key).',
  '## Функциональные требования

- POST /shorten {long_url} → {short_url}
- GET /{short_id} → 302 redirect на long_url
- GET /{short_id}/stats → {click_count, last_click_at}

**Нагрузка**: 100M URLs total, 1B redirects/day (peak ~50K RPS), 10M new URLs/day. p99 redirect latency < 50ms.

**Нет**: custom aliases, expiration UI, user accounts (anonymous create).',
  60,
  true
)
ON CONFLICT DO NOTHING;

-- task_questions для URL Shortener — interviewer follow-ups
INSERT INTO task_questions (task_id, body, expected_answer_md, reference_criteria, sort_order)
SELECT t.id, body, expected_answer_md, reference_criteria::jsonb, sort_order
FROM (VALUES
  ('Как обработаешь "горячие" ссылки которые внезапно вирусные (1M RPS на одну ссылку)?',
   'Edge-cache + CDN. Если короткая ссылка вирусится — она автоматически попадёт в hot-set Redis и потом на CDN-уровень. Origin-сервер вообще не увидит трафик. Без CDN: pin-in-cache + circuit-breaker на DB чтобы lookup не лёг.',
   '{"must_mention":["CDN / edge cache","Redis hot-set","нагрузка не дойдёт до DB"],"common_pitfalls":["упомянуть только rate-limit","DB scale-up как единственное решение"]}',
   10),
  ('Какую БД выбрал и почему именно её? Что бы взял для 1B URLs?',
   'PG для MVP (ACID, простое индексирование, известные ops). При росте до 100M+ → шардинг по hash(short_id) или переход на key-value: Cassandra (write-heavy) или DynamoDB (managed). Главное — partition по short_id чтобы читать одной партиции.',
   '{"must_mention":["конкретный выбор","причина (read-heavy / write-heavy / scale)","когда мигрировать"],"common_pitfalls":["один MongoDB на всё","NoSQL без обоснования"]}',
   20),
  ('Что произойдёт если Redis-cluster упадёт целиком?',
   'Hot path деградирует: каждый redirect → DB read. RPS на DB вырастет в ~20x (1 - cache hit rate). Защита: circuit-breaker на DB (degraded response с throttle), graceful 503 на части запросов, alerting в первые секунды. Recovery: warm-up cache из popular_urls table при подъёме.',
   '{"must_mention":["fall back to DB","circuit breaker / throttle","cache warm-up на recovery"],"common_pitfalls":["сервис продолжит работать без проблем","перейдём на другой кэш"]}',
   30)
) AS v(body, expected_answer_md, reference_criteria, sort_order)
CROSS JOIN mock_tasks t
WHERE t.title = 'URL Shortener' AND t.stage_kind = 'sysdesign'
ON CONFLICT DO NOTHING;

-- ─── sysdesign task 2: Notification system (harder) ──────────────────────
INSERT INTO mock_tasks (
  stage_kind, language, difficulty, title, body_md, sample_io_md,
  reference_criteria, reference_solution_md, functional_requirements_md,
  time_limit_min, active
)
VALUES (
  'sysdesign', 'any', 3,
  'Notification System',
  '# Notification System

Спроектируй систему доставки уведомлений: push (mobile), email, SMS. Сервисы нашей платформы публикуют события — система доставляет уведомления конкретным юзерам по их preferences (push/email/SMS, частота, тихие часы).

Нарисуй компоненты: pub/sub, queue per channel, rate-limiter, dead-letter, persistence событий, аналитика доставки.',
  '',
  '{"must_mention":["pub/sub или event bus (Kafka / NATS)","разделение очередей по channel (push/email/SMS)","retry policy с exponential backoff","dead-letter queue","user preferences storage (БД)","rate-limiting per user (anti-spam)"],"nice_to_have":["DigestService — батчинг уведомлений","quiet hours (tz-aware)","provider abstraction (FCM / APNs / SES / Twilio)","delivery analytics через event-stream","circuit breaker на провайдер"],"common_pitfalls":["синхронная доставка в hot path события","один queue на все channels","retry бесконечный без DLQ","не учёл часовые пояса для quiet hours","нет dedup на producer (одно событие = N notifications)"]}'::jsonb,
  '## Reference architecture

```
[Producers]                     [Notification Service]
  arena ─┐                          ↓
  daily  ├→ [Kafka events] → [Dispatcher (consumer)]
  hone  ─┘                          ↓
                                [Preferences DB lookup]
                                    ↓
                            [Per-channel queues]
                            ┌───────┼─────────┐
                          push    email     SMS
                            ↓       ↓        ↓
                          FCM/APNs SES    Twilio
                            ↓       ↓        ↓
                            └→ [DLQ] ←─┘ ──┘
                                ↓
                          [Manual retry / observability]

[Delivery events] → [Kafka] → [Analytics consumer] → [ClickHouse]
```

**Dispatcher** читает события из общего bus, lookup user preferences (cache → DB), filter по quiet hours, publish в per-channel queue.

**Per-channel queues**: разные SLA. Push = real-time (< 5s), email = batched (минуты OK), SMS = critical-only.

**Rate-limit**: token bucket per (user, channel). Например 10 push/day, 3 email/day. Превышение → digest или drop.

**Retries**: per-channel exponential backoff (push: 1m → 5m → 30m → DLQ; email: 5m → 30m → 2h → DLQ).

**Persistence**: событие сохраняется в БД на producer-стороне (outbox pattern) чтобы при сбое consumer не потерять. Notification service хранит delivery_log для analytics.

**Trade-offs**:
- At-least-once vs exactly-once: at-least-once приемлемо если notification idempotent (dedup на consumer через event_id). Exactly-once требует transactional outbox + dedup.
- Push vs pull: push для realtime, pull (websocket) для in-app. Hybrid OK.
- Centralized vs federated: centralized service проще, federated масштабируется лучше но сложно с rate-limit cross-channel.

**Edge cases**: provider-down (circuit breaker → fallback channel), spam (rate-limit), unsubscribe в реальном времени (cache invalidation), tz-aware quiet hours, user удалил аккаунт (cascade на pending notifications).',
  '## Функциональные требования

- Producer publishes event: `{user_id, type, payload, priority}`
- System resolves channels per user prefs: push / email / SMS / in-app
- Honor quiet hours (per user timezone)
- Rate-limit per user per channel
- Delivery status tracking + retry on failure

**Нагрузка**: 50M users, 100M events/day (avg ~1200 RPS, peak ~10K RPS), p99 push delivery < 5s, email < 2 min, SMS critical-only.

**Compliance**: GDPR delete cascade, unsubscribe ≤ 5 min propagation.',
  60,
  true
)
ON CONFLICT DO NOTHING;

INSERT INTO task_questions (task_id, body, expected_answer_md, reference_criteria, sort_order)
SELECT t.id, body, expected_answer_md, reference_criteria::jsonb, sort_order
FROM (VALUES
  ('Что если FCM (push provider) лежит 30 минут? Какое поведение системы?',
   'Circuit breaker открывается → push queue копится в DLQ или паркуется в retry-queue с backoff. Опционально: fallback на in-app channel (если у юзера активная сессия). Critical notifications → SMS как fallback. Метрики: alert если push-success-rate < 95% за 5 мин.',
   '{"must_mention":["circuit breaker","retry с backoff или DLQ","fallback channel или explicit accept-loss","alerting"],"common_pitfalls":["просто retry бесконечно","потеряем уведомления — норма"]}',
   10),
  ('Как ты гарантируешь что одно событие не превратится в дубликат уведомлений?',
   'Idempotency на двух уровнях: (1) producer пишет событие с idempotency_key (event_id) в outbox table перед публикацией — re-publish не создаёт дубль. (2) Consumer проверяет event_id в delivery_log table перед отправкой — если уже доставлено, skip. Cache 24h для freshness.',
   '{"must_mention":["idempotency_key","dedup на consumer через delivery_log","outbox pattern на producer"],"common_pitfalls":["надеемся что Kafka exactly-once","не предусмотрел дубль вообще"]}',
   20),
  ('Юзер во Владивостоке, quiet hours 22:00-08:00. Событие пришло в 03:00 по его tz. Что делает система?',
   'Dispatcher проверяет current time в user TZ (читает tz из preferences). Если в quiet — сохраняет notification в delayed-queue с deliver_at=08:00 user_tz. В 08:00 cron-задача / scheduler вытаскивает delayed → publish в обычный flow. Critical (security alerts) обходят quiet hours по флагу bypass_quiet_hours=true.',
   '{"must_mention":["tz-aware квалификация","delayed queue с deliver_at","bypass для critical"],"common_pitfalls":["UTC всегда","drop notification во время quiet"]}',
   30),
  ('Юзер unsubscribe-ится от email. Когда система гарантированно перестанет ему слать?',
   'Preferences DB обновляется немедленно. Cache (в dispatcher) — до 5 мин TTL. Опционально pub/sub event "preferences_changed" → cache invalidation в реальном времени → dispatcher всегда читает свежие prefs (< 5 sec). GDPR требует ≤ 5 мин пропагации — и cache TTL и pub/sub оба укладываются.',
   '{"must_mention":["update БД немедленно","cache invalidation strategy","SLA пропагации"],"common_pitfalls":["до следующего deploy","не учёл cache"]}',
   40)
) AS v(body, expected_answer_md, reference_criteria, sort_order)
CROSS JOIN mock_tasks t
WHERE t.title = 'Notification System' AND t.stage_kind = 'sysdesign'
ON CONFLICT DO NOTHING;

-- ─── Yandex stage config: insert sysdesign at ordinal=2, push behavioral to 3 ─
-- Old (00044): hr=0, algo=1, behavioral=2 (optional).
-- New (00045): hr=0, algo=1, sysdesign=2, behavioral=3 (optional).
UPDATE company_stages
SET ordinal = 3
WHERE company_id IN (SELECT id FROM companies WHERE slug = 'yandex')
  AND stage_kind = 'behavioral';

INSERT INTO company_stages (company_id, stage_kind, ordinal, optional, language_pool, task_pool_ids, ai_strictness_profile_id)
SELECT c.id, 'sysdesign', 2, false, ARRAY[]::mock_task_language[], ARRAY[]::uuid[], NULL
FROM companies c WHERE c.slug = 'yandex'
ON CONFLICT (company_id, stage_kind) DO UPDATE SET ordinal = 2, optional = false;

-- +goose Down
DELETE FROM task_questions
WHERE task_id IN (SELECT id FROM mock_tasks WHERE stage_kind='sysdesign'
                  AND title IN ('URL Shortener','Notification System'));
DELETE FROM mock_tasks WHERE stage_kind='sysdesign'
  AND title IN ('URL Shortener','Notification System');
DELETE FROM company_stages
  WHERE company_id IN (SELECT id FROM companies WHERE slug='yandex')
  AND stage_kind = 'sysdesign';
UPDATE company_stages
SET ordinal = 2
WHERE company_id IN (SELECT id FROM companies WHERE slug='yandex')
  AND stage_kind = 'behavioral';
