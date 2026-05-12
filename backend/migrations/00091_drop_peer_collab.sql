-- 00091_drop_peer_collab.sql — D4 Stream F (2026-05-12).
--
-- Hone Whiteboard / Editor migrated to web в solo-mode. Peer-collab WS
-- (Yjs / awareness / presence) dropped at the wiring layer (см.
-- backend/cmd/monolith/services/{editor,whiteboard_rooms}/*.go).
--
-- DB schema changes — minimum viable: добавляем editor_rooms.code TEXT
-- column для solo persistence. Остальные peer-collab columns остаются
-- intact для backwards-compat — они просто перестают апдейтиться (никто
-- больше не зовёт FreezeRoom / CreateInvite / Replay use cases с
-- frontend'а; backend RPC handlers wirings'ом stranded'ы).
--
-- Presence / ws-session tables никогда не существовали — presence жила
-- только в Hub.go в RAM, кладбища нет, drop'ать нечего.
--
-- Idempotent через IF EXISTS — safe для свежей DB и для existing rooms.
BEGIN;

-- editor_rooms.code — solo TEXT persistence. NULL не разрешаем, default
-- empty string чтобы старые rooms без сохранённого кода читались как пустой
-- editor. Limit размера enforce'ится в application layer (handler caps
-- body at 2 MiB).
ALTER TABLE editor_rooms
  ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT '';

COMMIT;

-- +goose Down
-- Drop the new column. Note: utenant'у rollback'у — данные code uterian.
BEGIN;

ALTER TABLE editor_rooms
  DROP COLUMN IF EXISTS code;

COMMIT;
