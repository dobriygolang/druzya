-- +goose Up
-- +goose StatementBegin
-- ============================================================
-- 00048  Canvas scene JSON in Postgres (replaces MinIO PNG)
-- ============================================================
-- F-3 v2: store the Excalidraw scene as jsonb on the attempt row instead
-- of pushing a rendered PNG to MinIO. The PNG is still produced client-
-- side for the vision-judge call but discarded after judging — the source
-- of truth is the scene JSON, which the frontend re-renders in viewMode.
--
-- Why: avoids unbounded MinIO growth (~125GB/yr at low usage) plus the
-- presign / lifecycle / TTL machinery. Scene JSON is 5–50KB vs 100KB-1MB
-- PNG, fits comfortably inline. Legacy rows that already hold a data URL
-- in user_excalidraw_image_url keep working — frontend prefers scene
-- JSON and falls back to the URL.

ALTER TABLE pipeline_attempts
  ADD COLUMN IF NOT EXISTS user_excalidraw_scene_json jsonb;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE pipeline_attempts DROP COLUMN IF EXISTS user_excalidraw_scene_json;
-- +goose StatementEnd
