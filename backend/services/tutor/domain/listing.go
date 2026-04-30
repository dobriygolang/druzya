package domain

import (
	"context"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Wave 9.1 — Tutor marketplace listings. Storefront rows that surface
// tutors on the public `/marketplace` page. Payment is Boosty-only:
// `BoostyURL` is the outbound deep-link the student clicks; we never
// touch money flow ourselves.

// TrackKind mirrors the SQL `track_kind` ENUM. Listing.Validate accepts
// any value the SQL side accepts; we don't re-encode the whitelist
// here so adding a new track (e.g. via ALTER TYPE) doesn't require a
// Go-side change.
type TrackKind string

// PackageKind enumerates the pricing tier kinds the use case layer
// accepts. SQL stores it as TEXT (free-form) — the whitelist lives
// here so `golangci-lint` can flag stale references when we extend it.
type PackageKind string

const (
	PackageKindSingleHour       PackageKind = "single_hour"
	PackageKindPack4            PackageKind = "pack_4"
	PackageKindPack10           PackageKind = "pack_10"
	PackageKindMonthlyUnlimited PackageKind = "monthly_unlimited"
)

func (k PackageKind) IsValid() bool {
	switch k {
	case PackageKindSingleHour, PackageKindPack4, PackageKindPack10, PackageKindMonthlyUnlimited:
		return true
	}
	return false
}

// Currency mirrors the SQL CHECK on tutor_listings.currency.
type Currency string

const (
	CurrencyRUB Currency = "RUB"
	CurrencyUSD Currency = "USD"
	CurrencyEUR Currency = "EUR"
)

func (c Currency) IsValid() bool {
	switch c {
	case CurrencyRUB, CurrencyUSD, CurrencyEUR:
		return true
	}
	return false
}

// Listing mirrors a row in tutor_listings. Money fields are minor
// units (kopecks for RUB, cents for USD/EUR) — int64-clean math from
// API surface to DB.
type Listing struct {
	ID              uuid.UUID
	TutorID         uuid.UUID
	Slug            string
	Title           string
	Summary         string
	BodyMD          string
	TrackKind       TrackKind
	Languages       []string
	HourlyRateMinor int64
	Currency        Currency
	BoostyURL       string
	PublishedAt     *time.Time
	ArchivedAt      *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// IsPublished — visible on the public marketplace.
func (l Listing) IsPublished() bool {
	return l.PublishedAt != nil && l.ArchivedAt == nil
}

// ListingPackage mirrors a row in tutor_listing_packages.
type ListingPackage struct {
	ID          uuid.UUID
	ListingID   uuid.UUID
	Kind        PackageKind
	Hours       int
	PriceMinor  int64
	Description string
	ArchivedAt  *time.Time
	CreatedAt   time.Time
}

// slugRE matches the marketplace URL slug grammar: lowercase
// alphanumerics + dashes, length policed by SQL (3..64).
var slugRE = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// Validate covers the invariants the use case enforces before the
// repo. Doesn't require BoostyURL to be set — that's a publish-time
// gate, not a draft-time one.
func (l Listing) Validate() error {
	if l.TutorID == uuid.Nil {
		return ErrInvalidInput
	}
	if !slugRE.MatchString(l.Slug) || len(l.Slug) < 3 || len(l.Slug) > 64 {
		return ErrInvalidInput
	}
	if strings.TrimSpace(l.Title) == "" || len(l.Title) > 200 {
		return ErrInvalidInput
	}
	if l.TrackKind == "" {
		return ErrInvalidInput
	}
	if l.HourlyRateMinor <= 0 {
		return ErrInvalidInput
	}
	if l.Currency == "" {
		l.Currency = CurrencyRUB
	}
	if !l.Currency.IsValid() {
		return ErrInvalidInput
	}
	if len(l.Languages) == 0 {
		return ErrInvalidInput
	}
	return nil
}

// ValidateForPublish layers the publish-time checks on top of base
// invariants: BoostyURL must be a non-empty https URL.
func (l Listing) ValidateForPublish() error {
	if err := l.Validate(); err != nil {
		return err
	}
	u := strings.TrimSpace(l.BoostyURL)
	if u == "" {
		return ErrInvalidInput
	}
	if !strings.HasPrefix(u, "https://") {
		return ErrInvalidInput
	}
	return nil
}

// Validate for ListingPackage — kind must be in whitelist, hours +
// price strictly positive.
func (p ListingPackage) Validate() error {
	if p.ListingID == uuid.Nil {
		return ErrInvalidInput
	}
	if !p.Kind.IsValid() {
		return ErrInvalidInput
	}
	if p.Hours <= 0 || p.Hours > 100 {
		return ErrInvalidInput
	}
	if p.PriceMinor <= 0 {
		return ErrInvalidInput
	}
	return nil
}

// BrowseFilter — public marketplace browse. All fields optional; zero
// value = no filter for that field. TrackKinds applies an `IN (...)`
// when non-empty.
type BrowseFilter struct {
	TrackKinds   []TrackKind
	MaxRateMinor int64 // 0 = no cap
	Languages    []string
	Limit        int
}

// ListingRepo is the persistence surface for listings. *Postgres in
// the infra package satisfies it alongside Repo / SnapshotRepo /
// AssignmentRepo / EventRepo (one struct, five interfaces).
type ListingRepo interface {
	CreateListing(ctx context.Context, l Listing) (Listing, error)
	UpdateListing(ctx context.Context, l Listing) (Listing, error)
	GetListing(ctx context.Context, id uuid.UUID) (Listing, error)
	GetListingBySlug(ctx context.Context, slug string) (Listing, error)
	ListListingsByTutor(ctx context.Context, tutorID uuid.UUID) ([]Listing, error)
	BrowseListings(ctx context.Context, f BrowseFilter) ([]Listing, error)

	PublishListing(ctx context.Context, tutorID, listingID uuid.UUID, now time.Time) error
	ArchiveListing(ctx context.Context, tutorID, listingID uuid.UUID, now time.Time) error

	AddPackage(ctx context.Context, p ListingPackage) (ListingPackage, error)
	ArchivePackage(ctx context.Context, tutorID, packageID uuid.UUID, now time.Time) error
	ListPackagesByListing(ctx context.Context, listingID uuid.UUID) ([]ListingPackage, error)
}
