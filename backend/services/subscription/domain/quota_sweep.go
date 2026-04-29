package domain

import "context"

// QuotaSweepRepo owns the auto-downgrade / auto-archive operations that the
// quota subsystem runs against shared rooms and notes for free-tier users.
//
// Each method is a single bounded SQL statement; the runner schedules them.
// No method enforces tier resolution — the queries scope themselves with
// `subscriptions.plan = 'free' OR no row` directly.
type QuotaSweepRepo interface {
	// DowngradeExpiredWhiteboards flips visibility = 'private' for shared
	// whiteboard_rooms whose expires_at has passed AND owner is free-tier.
	DowngradeExpiredWhiteboards(ctx context.Context) (int64, error)

	// DowngradeOverflowWhiteboards keeps the most recently created shared
	// room per free-tier owner; older shared rooms are demoted to private.
	DowngradeOverflowWhiteboards(ctx context.Context) (int64, error)

	// DowngradeExpiredEditorRooms — same as whiteboards, for editor_rooms.
	DowngradeExpiredEditorRooms(ctx context.Context) (int64, error)

	// DowngradeOverflowEditorRooms — same as whiteboards, for editor_rooms.
	DowngradeOverflowEditorRooms(ctx context.Context) (int64, error)

	// ArchiveOverflowNotes archives notes beyond the free-tier limit
	// (oldest first by updated_at). The limit is passed in by the runner.
	ArchiveOverflowNotes(ctx context.Context, freeTierLimit int) (int64, error)
}
