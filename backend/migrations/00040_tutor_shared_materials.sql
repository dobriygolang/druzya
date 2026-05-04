-- 00040_tutor_shared_materials.sql — history таблица для tutor reading
-- recommendations.
--
-- TutorDashboardPage'у нужен «Reading library» tab: список прошлых
-- recommendations с датой и опционально student_count (через broadcast
-- ушло N студентов). Per-assignment row живёт в tutor_assignments — но
-- эти вещи concept'уально разные: assignment = задание, shared_material
-- = recommendation. Не агрегируем over assignment.title чтобы не зависеть
-- от строкового префикса '[Reading]'.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS tutor_shared_materials (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tutor_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           TEXT         NOT NULL CHECK (char_length(title) > 0),
    source_url      TEXT         NOT NULL DEFAULT '',
    body_md         TEXT         NOT NULL DEFAULT '',
    student_count   INT          NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tutor_shared_materials_tutor_date
    ON tutor_shared_materials (tutor_id, created_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS tutor_shared_materials;
-- +goose StatementEnd
