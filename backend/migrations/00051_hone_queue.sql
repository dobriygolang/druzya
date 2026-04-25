-- +goose Up
-- +goose StatementBegin
--
-- Focus Queue — per-day actionable list. Расширяет Plan-генерацию: AI план
-- материализуется в queue_items (source='ai'), плюс юзер сам может
-- докидывать ручные таски (source='user'). Today страница рендерит этот
-- список с тремя секциями: in_progress / todo / done.
--
-- skill_key опционален — для AI items копируется из PlanItem.SkillKey
-- (для аналитики «work tasks vs growth tasks» по навыкам). Для user items
-- nullable.
--
-- date — день, к которому таск относится. INDEX (user_id, date, status)
-- покрывает hot-path ListByDate + GetAIShareLast7Days.

CREATE TABLE hone_queue_items (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT        NOT NULL,
    source      TEXT        NOT NULL CHECK (source IN ('ai', 'user')),
    status      TEXT        NOT NULL DEFAULT 'todo'
                            CHECK (status IN ('todo', 'in_progress', 'done')),
    date        DATE        NOT NULL DEFAULT CURRENT_DATE,
    skill_key   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hone_queue_user_date_status ON hone_queue_items (user_id, date, status);

-- Покрытие SyncAIItems-идемпотентности: lookup «есть ли AI item с таким
-- title на сегодня». Без этого индекса дедуп-запрос делает sequential scan.
CREATE INDEX idx_hone_queue_user_date_title ON hone_queue_items (user_id, date, title);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS hone_queue_items;
-- +goose StatementEnd
