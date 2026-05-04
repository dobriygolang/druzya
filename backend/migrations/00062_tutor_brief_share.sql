-- 00062_tutor_brief_share.sql — Phase 8 (Tutor pages upgrade · 2026-05-04).
--
-- Тутор может расшарить snapshot-brief студента отдельной ссылкой:
-- read-only public URL с TTL. Используется для (a) внешнего ревью между
-- ментором и студентом, (b) admin-аналитики «как туторы структурируют
-- 1:1». Похож на Notion-style share — slug в URL, expires_at limit'ит
-- доступ.
--
-- Brief-content snapshot сохраняется (а не computed live), чтобы
-- ссылка оставалась стабильной даже если данные студента изменились
-- после share'а. Тутор может re-generate'ить при необходимости.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE tutor_brief_share_links (
    slug         TEXT          PRIMARY KEY,
    tutor_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id   UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brief_md     TEXT          NOT NULL,
    expires_at   TIMESTAMPTZ   NOT NULL,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_tutor_brief_share_links_tutor
    ON tutor_brief_share_links (tutor_id, created_at DESC);

-- Полный (non-partial) индекс: predicate `expires_at > now()` нельзя — now() не immutable.
-- Запросы делают `WHERE slug = $1 AND expires_at > now()` — индекс по slug (PK)
-- эффективен сам по себе; expires_at-фильтр сэкономит copy/scan только при
-- очень широком выборе, что admin-tab делает редко.
CREATE INDEX idx_tutor_brief_share_links_expires
    ON tutor_brief_share_links (expires_at);

COMMENT ON TABLE tutor_brief_share_links IS 'Tutor-shared frozen snapshot of student brief (Phase 8). Public read by slug + expiry; tutor-write only.';
COMMENT ON COLUMN tutor_brief_share_links.slug IS 'URL-safe short id, generated client-side (≥10 chars random base62). Hash collisions blocked by PK.';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS tutor_brief_share_links;
-- +goose StatementEnd
