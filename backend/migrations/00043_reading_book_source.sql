-- 00043_reading_book_source.sql — Book source для Reading.
--
-- Sergey 2026-05-03: «у меня есть книги, видео-уроки из ютуба и репетитор.
-- Хочу удобства мне и репетитору». Books — твёрдая физическая копия,
-- паста полного текста не нужна; tracking прогресса по chapter'ам полезен.
--
-- Изменения:
--   1. ALTER CHECK source_kind: добавляем 'book'.
--   2. ADD column book_chapter INT — current chapter (nullable).
--   3. ADD column book_total_chapters INT — total (если юзер знает).
-- body_md остаётся, но для books может быть пустой (юзер читает оффлайн).

-- +goose Up
-- +goose StatementBegin
ALTER TABLE hone_reading_materials
    DROP CONSTRAINT IF EXISTS hone_reading_materials_source_kind_check;

ALTER TABLE hone_reading_materials
    ADD CONSTRAINT hone_reading_materials_source_kind_check
        CHECK (source_kind IN ('paste','url','pdf','epub','book'));

ALTER TABLE hone_reading_materials
    ADD COLUMN IF NOT EXISTS book_chapter         INT,
    ADD COLUMN IF NOT EXISTS book_total_chapters  INT;

ALTER TABLE hone_reading_materials
    ADD CONSTRAINT hone_reading_materials_chapter_bounds
        CHECK (
            (book_chapter IS NULL OR book_chapter >= 0) AND
            (book_total_chapters IS NULL OR book_total_chapters > 0) AND
            (book_chapter IS NULL OR book_total_chapters IS NULL OR book_chapter <= book_total_chapters)
        );
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE hone_reading_materials
    DROP CONSTRAINT IF EXISTS hone_reading_materials_chapter_bounds;
ALTER TABLE hone_reading_materials
    DROP COLUMN IF EXISTS book_chapter,
    DROP COLUMN IF EXISTS book_total_chapters;
ALTER TABLE hone_reading_materials
    DROP CONSTRAINT IF EXISTS hone_reading_materials_source_kind_check;
ALTER TABLE hone_reading_materials
    ADD CONSTRAINT hone_reading_materials_source_kind_check
        CHECK (source_kind IN ('paste','url','pdf','epub'));
-- +goose StatementEnd
