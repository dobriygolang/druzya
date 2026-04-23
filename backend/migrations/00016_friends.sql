-- +goose Up
-- friendships — стандартная двунаправленная связь.
-- Hard-CHECK: requester != addressee, иначе self-friend.
-- UNIQUE (requester, addressee) защищает от дублей; обратная пара (b,a)
-- допустима как отдельная строка — но логика app не позволяет создавать,
-- если уже есть accepted в любом направлении (см. friends/app/add).
CREATE TABLE IF NOT EXISTS friendships (
    id            BIGSERIAL PRIMARY KEY,
    requester_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','accepted','blocked')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at   TIMESTAMPTZ,
    CHECK (requester_id <> addressee_id),
    UNIQUE (requester_id, addressee_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_addr_status
    ON friendships (addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_req_status
    ON friendships (requester_id, status);

-- friend_codes — короткие 8-char invite-коды.
-- Один код на user'а; expired строки overwrite'ятся при Generate.
CREATE TABLE IF NOT EXISTS friend_codes (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL
);

-- +goose Down
DROP TABLE IF EXISTS friend_codes;
DROP INDEX IF EXISTS idx_friendships_req_status;
DROP INDEX IF EXISTS idx_friendships_addr_status;
DROP TABLE IF EXISTS friendships;
