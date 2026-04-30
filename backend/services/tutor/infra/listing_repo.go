// listing_repo.go — Wave 9.1 of docs/feature/plan.md.
// Hand-rolled pgx over tutor_listings + tutor_listing_packages.
// Same per-feature struct pattern: methods on the existing *Postgres
// so the monolith wiring keeps a single dependency.
//
// Payment is Boosty-only — this repo never touches money flow. The
// `boosty_url` column is just an outbound deep-link surfaced on the
// public marketplace card; the student's click leaves our system.
package infra

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// CreateListing inserts a draft row. PublishedAt stays NULL until the
// tutor explicitly calls PublishListing.
func (p *Postgres) CreateListing(ctx context.Context, l domain.Listing) (domain.Listing, error) {
	const q = `
		INSERT INTO tutor_listings
			(tutor_id, slug, title, summary, body_md, track_kind,
			 languages, hourly_rate_minor, currency, boosty_url)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, created_at, updated_at`
	var (
		id      pgtype.UUID
		created pgtype.Timestamptz
		updated pgtype.Timestamptz
	)
	cur := string(l.Currency)
	if cur == "" {
		cur = string(domain.CurrencyRUB)
	}
	if err := p.pool.QueryRow(ctx, q,
		pgUUID(l.TutorID), l.Slug, l.Title, l.Summary, l.BodyMD,
		string(l.TrackKind), l.Languages, l.HourlyRateMinor, cur, l.BoostyURL,
	).Scan(&id, &created, &updated); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.Listing{}, fmt.Errorf("tutor.CreateListing: %w (slug taken)", domain.ErrInvalidInput)
		}
		return domain.Listing{}, fmt.Errorf("tutor.CreateListing: %w", err)
	}
	l.ID = uuidFrom(id)
	l.Currency = domain.Currency(cur)
	if created.Valid {
		l.CreatedAt = created.Time
	}
	if updated.Valid {
		l.UpdatedAt = updated.Time
	}
	return l, nil
}

// UpdateListing rewrites all editable fields. Owner-gated by tutor_id
// in the WHERE clause — caller's tutor_id is part of `l`.
func (p *Postgres) UpdateListing(ctx context.Context, l domain.Listing) (domain.Listing, error) {
	const q = `
		UPDATE tutor_listings
		SET slug = $1,
		    title = $2,
		    summary = $3,
		    body_md = $4,
		    track_kind = $5,
		    languages = $6,
		    hourly_rate_minor = $7,
		    currency = $8,
		    boosty_url = $9,
		    updated_at = now()
		WHERE id = $10 AND tutor_id = $11 AND archived_at IS NULL
		RETURNING updated_at`
	var updated pgtype.Timestamptz
	cur := string(l.Currency)
	if cur == "" {
		cur = string(domain.CurrencyRUB)
	}
	err := p.pool.QueryRow(ctx, q,
		l.Slug, l.Title, l.Summary, l.BodyMD,
		string(l.TrackKind), l.Languages, l.HourlyRateMinor, cur, l.BoostyURL,
		pgUUID(l.ID), pgUUID(l.TutorID),
	).Scan(&updated)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Listing{}, fmt.Errorf("tutor.UpdateListing: %w", domain.ErrNotFound)
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.Listing{}, fmt.Errorf("tutor.UpdateListing: %w (slug taken)", domain.ErrInvalidInput)
		}
		return domain.Listing{}, fmt.Errorf("tutor.UpdateListing: %w", err)
	}
	if updated.Valid {
		l.UpdatedAt = updated.Time
	}
	l.Currency = domain.Currency(cur)
	return l, nil
}

const listingSelectCols = `id, tutor_id, slug, title, summary, body_md, track_kind,
	languages, hourly_rate_minor, currency, boosty_url,
	published_at, archived_at, created_at, updated_at`

func scanListing(row pgx.Row) (domain.Listing, error) {
	var (
		l         domain.Listing
		id        pgtype.UUID
		tutorID   pgtype.UUID
		track     string
		cur       string
		published pgtype.Timestamptz
		archived  pgtype.Timestamptz
		created   pgtype.Timestamptz
		updated   pgtype.Timestamptz
	)
	if err := row.Scan(&id, &tutorID, &l.Slug, &l.Title, &l.Summary, &l.BodyMD,
		&track, &l.Languages, &l.HourlyRateMinor, &cur, &l.BoostyURL,
		&published, &archived, &created, &updated,
	); err != nil {
		return domain.Listing{}, fmt.Errorf("scanListing: %w", err)
	}
	l.ID = uuidFrom(id)
	l.TutorID = uuidFrom(tutorID)
	l.TrackKind = domain.TrackKind(track)
	l.Currency = domain.Currency(cur)
	l.PublishedAt = nullableTime(published)
	l.ArchivedAt = nullableTime(archived)
	if created.Valid {
		l.CreatedAt = created.Time
	}
	if updated.Valid {
		l.UpdatedAt = updated.Time
	}
	return l, nil
}

func (p *Postgres) GetListing(ctx context.Context, id uuid.UUID) (domain.Listing, error) {
	q := `SELECT ` + listingSelectCols + ` FROM tutor_listings WHERE id = $1`
	row := p.pool.QueryRow(ctx, q, pgUUID(id))
	out, err := scanListing(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Listing{}, fmt.Errorf("tutor.GetListing: %w", domain.ErrNotFound)
		}
		return domain.Listing{}, fmt.Errorf("tutor.GetListing: %w", err)
	}
	return out, nil
}

// GetListingBySlug — public marketplace single-page lookup. Only
// returns published, non-archived rows so guests can't enumerate
// drafts by URL guessing.
func (p *Postgres) GetListingBySlug(ctx context.Context, slug string) (domain.Listing, error) {
	q := `SELECT ` + listingSelectCols + `
		FROM tutor_listings
		WHERE slug = $1 AND published_at IS NOT NULL AND archived_at IS NULL`
	row := p.pool.QueryRow(ctx, q, slug)
	out, err := scanListing(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Listing{}, fmt.Errorf("tutor.GetListingBySlug: %w", domain.ErrNotFound)
		}
		return domain.Listing{}, fmt.Errorf("tutor.GetListingBySlug: %w", err)
	}
	return out, nil
}

// ListListingsByTutor returns all listings (any state) owned by tutor.
func (p *Postgres) ListListingsByTutor(ctx context.Context, tutorID uuid.UUID) ([]domain.Listing, error) {
	q := `SELECT ` + listingSelectCols + `
		FROM tutor_listings
		WHERE tutor_id = $1
		ORDER BY created_at DESC`
	rows, err := p.pool.Query(ctx, q, pgUUID(tutorID))
	if err != nil {
		return nil, fmt.Errorf("tutor.ListListingsByTutor: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Listing, 0, 8)
	for rows.Next() {
		l, err := scanListing(rows)
		if err != nil {
			return nil, fmt.Errorf("tutor.ListListingsByTutor: %w", err)
		}
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tutor.ListListingsByTutor: %w", err)
	}
	return out, nil
}

// BrowseListings is the public marketplace query. Only published,
// non-archived rows. Filter args are dynamically composed; SQL
// concatenation is safe here because we only build static fragments
// and append placeholders for user-controlled values.
func (p *Postgres) BrowseListings(ctx context.Context, f domain.BrowseFilter) ([]domain.Listing, error) {
	var (
		conds = []string{"published_at IS NOT NULL", "archived_at IS NULL"}
		args  = []any{}
	)
	if len(f.TrackKinds) > 0 {
		tracks := make([]string, 0, len(f.TrackKinds))
		for _, t := range f.TrackKinds {
			tracks = append(tracks, string(t))
		}
		args = append(args, tracks)
		conds = append(conds, fmt.Sprintf("track_kind::text = ANY($%d)", len(args)))
	}
	if f.MaxRateMinor > 0 {
		args = append(args, f.MaxRateMinor)
		conds = append(conds, fmt.Sprintf("hourly_rate_minor <= $%d", len(args)))
	}
	if len(f.Languages) > 0 {
		args = append(args, f.Languages)
		conds = append(conds, fmt.Sprintf("languages && $%d", len(args)))
	}
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	args = append(args, limit)
	q := `SELECT ` + listingSelectCols + `
		FROM tutor_listings
		WHERE ` + strings.Join(conds, " AND ") + `
		ORDER BY published_at DESC
		LIMIT $` + fmt.Sprint(len(args))
	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("tutor.BrowseListings: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Listing, 0, 16)
	for rows.Next() {
		l, err := scanListing(rows)
		if err != nil {
			return nil, fmt.Errorf("tutor.BrowseListings: %w", err)
		}
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tutor.BrowseListings: %w", err)
	}
	return out, nil
}

// PublishListing stamps published_at on a draft. Idempotent re-publish
// is allowed (re-stamps the timestamp) — UI shows «published since X»
// as a soft signal, so tutors can re-publish a listing they archived.
func (p *Postgres) PublishListing(ctx context.Context, tutorID, listingID uuid.UUID, now time.Time) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE tutor_listings
		SET published_at = $1, archived_at = NULL, updated_at = $1
		WHERE id = $2 AND tutor_id = $3
		  AND length(boosty_url) > 0`,
		pgtype.Timestamptz{Time: now, Valid: true},
		pgUUID(listingID), pgUUID(tutorID),
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return fmt.Errorf("tutor.PublishListing: %w (slug already taken among published)", domain.ErrInvalidInput)
		}
		return fmt.Errorf("tutor.PublishListing: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Either the row doesn't belong to this tutor, or boosty_url is empty.
		var hasURL bool
		err := p.pool.QueryRow(ctx, `
			SELECT length(boosty_url) > 0 FROM tutor_listings
			WHERE id = $1 AND tutor_id = $2`,
			pgUUID(listingID), pgUUID(tutorID),
		).Scan(&hasURL)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("tutor.PublishListing: %w", domain.ErrNotFound)
		}
		if err != nil {
			return fmt.Errorf("tutor.PublishListing: %w", err)
		}
		if !hasURL {
			return fmt.Errorf("tutor.PublishListing: %w (boosty_url required)", domain.ErrInvalidInput)
		}
		return fmt.Errorf("tutor.PublishListing: %w", domain.ErrNotFound)
	}
	return nil
}

func (p *Postgres) ArchiveListing(ctx context.Context, tutorID, listingID uuid.UUID, now time.Time) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE tutor_listings
		SET archived_at = $1, updated_at = $1
		WHERE id = $2 AND tutor_id = $3 AND archived_at IS NULL`,
		pgtype.Timestamptz{Time: now, Valid: true},
		pgUUID(listingID), pgUUID(tutorID),
	)
	if err != nil {
		return fmt.Errorf("tutor.ArchiveListing: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("tutor.ArchiveListing: %w", domain.ErrNotFound)
	}
	return nil
}

// AddPackage attaches a pricing tier to a listing the caller owns.
// Ownership is resolved through tutor_listings.tutor_id — the tutor
// id arrives implicitly because the use case validates first via a
// GetListing call.
func (p *Postgres) AddPackage(ctx context.Context, pkg domain.ListingPackage) (domain.ListingPackage, error) {
	const q = `
		INSERT INTO tutor_listing_packages
			(listing_id, kind, hours, price_minor, description)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at`
	var (
		id        pgtype.UUID
		createdAt pgtype.Timestamptz
	)
	if err := p.pool.QueryRow(ctx, q,
		pgUUID(pkg.ListingID), string(pkg.Kind), pkg.Hours, pkg.PriceMinor, pkg.Description,
	).Scan(&id, &createdAt); err != nil {
		return domain.ListingPackage{}, fmt.Errorf("tutor.AddPackage: %w", err)
	}
	pkg.ID = uuidFrom(id)
	if createdAt.Valid {
		pkg.CreatedAt = createdAt.Time
	}
	return pkg, nil
}

// ArchivePackage soft-deletes via archived_at. Owner gate is the
// JOIN to tutor_listings.tutor_id — caller passes their tutorID.
func (p *Postgres) ArchivePackage(ctx context.Context, tutorID, packageID uuid.UUID, now time.Time) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE tutor_listing_packages p
		SET archived_at = $1
		FROM tutor_listings l
		WHERE p.id = $2 AND p.archived_at IS NULL
		  AND p.listing_id = l.id AND l.tutor_id = $3`,
		pgtype.Timestamptz{Time: now, Valid: true},
		pgUUID(packageID), pgUUID(tutorID),
	)
	if err != nil {
		return fmt.Errorf("tutor.ArchivePackage: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("tutor.ArchivePackage: %w", domain.ErrNotFound)
	}
	return nil
}

func (p *Postgres) ListPackagesByListing(ctx context.Context, listingID uuid.UUID) ([]domain.ListingPackage, error) {
	const q = `
		SELECT id, listing_id, kind, hours, price_minor, description, archived_at, created_at
		FROM tutor_listing_packages
		WHERE listing_id = $1 AND archived_at IS NULL
		ORDER BY hours ASC`
	rows, err := p.pool.Query(ctx, q, pgUUID(listingID))
	if err != nil {
		return nil, fmt.Errorf("tutor.ListPackagesByListing: %w", err)
	}
	defer rows.Close()
	out := make([]domain.ListingPackage, 0, 4)
	for rows.Next() {
		var (
			pkg       domain.ListingPackage
			id        pgtype.UUID
			lid       pgtype.UUID
			kind      string
			archived  pgtype.Timestamptz
			createdAt pgtype.Timestamptz
		)
		if err := rows.Scan(&id, &lid, &kind, &pkg.Hours, &pkg.PriceMinor, &pkg.Description, &archived, &createdAt); err != nil {
			return nil, fmt.Errorf("tutor.ListPackagesByListing: %w", err)
		}
		pkg.ID = uuidFrom(id)
		pkg.ListingID = uuidFrom(lid)
		pkg.Kind = domain.PackageKind(kind)
		pkg.ArchivedAt = nullableTime(archived)
		if createdAt.Valid {
			pkg.CreatedAt = createdAt.Time
		}
		out = append(out, pkg)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tutor.ListPackagesByListing: %w", err)
	}
	return out, nil
}
