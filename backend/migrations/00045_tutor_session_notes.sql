-- 00045_tutor_session_notes.sql — Phase 3.3 tutor session notes-pad.
--
-- Sergey 2026-05-04: «English session notes для тутора (TutorStudentPage)».
-- Тутору нужен writeable notepad по студенту: «на сессии 2026-05-04
-- работали над present perfect, дома — task 1 IELTS». TL;DR — это
-- не auto-generated brief (тот уже есть в TutorPreSessionBrief), а
-- личные заметки тутора, которые видит только он.
--
-- Скоп V1: один markdown-блок per (tutor, student), auto-save с
-- updated_at, без ревизий. Когда понадобится журнал по сессиям —
-- заведём отдельный child-table tutor_session_log с FK сюда.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS tutor_session_notes (
    tutor_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body_md     TEXT         NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (tutor_id, student_id)
);

CREATE INDEX IF NOT EXISTS tutor_session_notes_tutor_idx
    ON tutor_session_notes (tutor_id, updated_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS tutor_session_notes;
-- +goose StatementEnd
