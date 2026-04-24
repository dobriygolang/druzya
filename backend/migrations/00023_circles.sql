-- +goose Up
-- +goose StatementBegin
--
-- Circles — community-layer (bible §9 Phase 6.5.3). Users join circles
-- by interest (book club, study group, hackathon team) and create events
-- inside them. Hone отображает календарь events'ов из всех моих circles.
--
-- В web Sergey сам сделает CRUD-UI для circles; backend контракт здесь.
CREATE TABLE circles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_circles_owner ON circles(owner_id);

CREATE TABLE circle_members (
    circle_id  UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 'admin' могут редактировать circle и создавать events; 'member' только
    -- участвует. Owner авто-admin (seed на CreateCircle).
    role       TEXT NOT NULL DEFAULT 'member',
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (circle_id, user_id),
    CONSTRAINT circle_role_valid CHECK (role IN ('admin','member'))
);

CREATE INDEX idx_circle_members_user ON circle_members(user_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS circle_members;
DROP TABLE IF EXISTS circles;
-- +goose StatementEnd
