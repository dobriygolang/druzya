-- +goose Up
-- +goose StatementBegin
--
-- Events — встречи внутри circles (bible §9 Phase 6.5.3). Book Club Fridays,
-- демо-сессии, online-лекции. Если у event'а указан editor_room_id или
-- whiteboard_room_id — Hone Join открывает соответствующую комнату; иначе
-- просто календарная отметка.
--
-- recurrence_rule: для MVP enum-like строка ('none' | 'weekly_friday'). Если
-- захочется RFC 5545 RRULE — расширим без миграции (free-form text).
CREATE TABLE events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circle_id           UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    starts_at           TIMESTAMPTZ NOT NULL,
    duration_min        INT NOT NULL DEFAULT 60,
    editor_room_id      UUID REFERENCES editor_rooms(id) ON DELETE SET NULL,
    whiteboard_room_id  UUID REFERENCES whiteboard_rooms(id) ON DELETE SET NULL,
    recurrence_rule     TEXT NOT NULL DEFAULT 'none',
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_circle ON events(circle_id);
CREATE INDEX idx_events_starts_at ON events(starts_at);

CREATE TABLE event_participants (
    event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, user_id)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS event_participants;
DROP TABLE IF EXISTS events;
-- +goose StatementEnd
