-- +goose Up
-- +goose StatementBegin
-- Wave-12 / SLOT M2: meet_url moves up to the slot itself so an interviewer
-- can pre-set their own Google Meet room (or any URL) at create time. When
-- non-null/non-empty, BookSlot reuses this URL on the resulting booking
-- instead of asking MeetRoomProvider to mint a fresh mock URL.
ALTER TABLE slots ADD COLUMN meet_url TEXT;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE slots DROP COLUMN IF EXISTS meet_url;
-- +goose StatementEnd
