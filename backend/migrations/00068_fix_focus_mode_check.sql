-- 00067_fix_focus_mode_check.sql — Phase 9-recovery: domain/code mismatch.
--
-- Domain `hone/domain/entity.go::FocusMode` = pomodoro|stopwatch.
-- DB CHECK на 00001_baseline.sql = free|plan|pinned (legacy schema).
-- Расхождение приводило к 500 на StartFocusSession (CHECK violation).
--
-- Fix: replace CHECK constraint to match domain. Existing rows
-- (likely zero — feature не работала) могут быть с любыми
-- значениями; для safety широкий enum.

-- +goose Up
-- +goose StatementBegin
ALTER TABLE hone_focus_sessions DROP CONSTRAINT IF EXISTS hone_focus_mode_valid;
ALTER TABLE hone_focus_sessions
    ADD CONSTRAINT hone_focus_mode_valid
    CHECK (mode IN ('pomodoro','stopwatch','free','plan','pinned','countdown'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE hone_focus_sessions DROP CONSTRAINT IF EXISTS hone_focus_mode_valid;
ALTER TABLE hone_focus_sessions
    ADD CONSTRAINT hone_focus_mode_valid
    CHECK (mode IN ('free','plan','pinned'));
-- +goose StatementEnd
