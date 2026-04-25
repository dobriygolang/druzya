-- +goose Up
-- +goose StatementBegin
--
-- Phase C-3: devices — registry устройств юзера. Это foundation для
-- sync-протокола между устройствами (multi-device feature, paid tier).
--
-- Free tier: 1 active device (любая регистрация второго → 409 Conflict
--            от register endpoint'а с {error.code:"device_limit_free"}).
-- Pro / Pro+: ∞ устройств.
--
-- Sync protocol сам по себе ещё НЕ написан — нужны отдельные решения:
--   - cursor / sequence (per-device-last-seen vs per-table-vector-clock)
--   - conflict resolution (LWW-by-updated_at vs CRDT)
--   - transport (REST polling vs Connect server-stream vs WS)
--   - encryption (E2E с user-derived key vs trust-server)
-- Все эти выборы нетривиальны и заслуживают отдельной сессии. Здесь
-- только ground floor: device identity + tier-gate.
--
-- last_seen_at апдейтится каждым sync-вызовом; revoked_at — soft-delete
-- (юзер «вышел» с устройства, но история его syncs остаётся).
CREATE TABLE devices (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,                         -- human-readable: "MacBook Pro M3"
    platform      TEXT NOT NULL,                         -- "mac" | "ios" | "android" | "web"
    app_version   TEXT NOT NULL DEFAULT '',              -- "0.4.2"
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT devices_platform_valid CHECK (platform IN ('mac','ios','android','web','linux','windows'))
);

-- Hot-path для register-flow (count active devices per user).
-- Partial — большинство юзеров с одним устройством, только active relevant.
CREATE INDEX idx_devices_user_active
    ON devices(user_id)
    WHERE revoked_at IS NULL;

-- last_seen update'ы хотим эффективно для analytics ("последний onboarded").
CREATE INDEX idx_devices_user_seen
    ON devices(user_id, last_seen_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS devices;
-- +goose StatementEnd
