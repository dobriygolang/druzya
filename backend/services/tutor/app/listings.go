// listings.go — Wave 9.1 marketplace use cases.
//
// Boosty-only payment: PublishListing rejects when boosty_url is empty
// (validated via domain.ValidateForPublish). The student's path is:
// browse → /tutors/{slug} → click «Subscribe via Boosty» → outbound
// redirect to BoostyURL. Tutor receives the new subscriber via Boosty,
// then issues an invite-code through the existing tutor_invites flow.
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// CreateListing — tutor scaffolds a new draft listing. Slug + title +
// hourly rate are required; everything else can be filled in later
// before publish.
type CreateListing struct {
	Repo domain.ListingRepo
	Now  func() time.Time
}

type CreateListingInput struct {
	TutorID         uuid.UUID
	Slug            string
	Title           string
	Summary         string
	BodyMD          string
	TrackKind       domain.TrackKind
	Languages       []string
	HourlyRateMinor int64
	Currency        domain.Currency
	BoostyURL       string
}

func (uc *CreateListing) Do(ctx context.Context, in CreateListingInput) (domain.Listing, error) {
	langs := in.Languages
	if len(langs) == 0 {
		langs = []string{"ru"}
	}
	cur := in.Currency
	if cur == "" {
		cur = domain.CurrencyRUB
	}
	l := domain.Listing{
		TutorID:         in.TutorID,
		Slug:            strings.ToLower(strings.TrimSpace(in.Slug)),
		Title:           strings.TrimSpace(in.Title),
		Summary:         in.Summary,
		BodyMD:          in.BodyMD,
		TrackKind:       in.TrackKind,
		Languages:       langs,
		HourlyRateMinor: in.HourlyRateMinor,
		Currency:        cur,
		BoostyURL:       strings.TrimSpace(in.BoostyURL),
	}
	if err := l.Validate(); err != nil {
		return domain.Listing{}, fmt.Errorf("tutor.CreateListing: %w", err)
	}
	saved, err := uc.Repo.CreateListing(ctx, l)
	if err != nil {
		return domain.Listing{}, fmt.Errorf("tutor.CreateListing: %w", err)
	}
	return saved, nil
}

// UpdateListing — tutor edits draft or published listing fields. The
// repo gates by tutor_id; we additionally re-validate via domain.
type UpdateListing struct {
	Repo domain.ListingRepo
	Now  func() time.Time
}

type UpdateListingInput struct {
	TutorID         uuid.UUID
	ListingID       uuid.UUID
	Slug            string
	Title           string
	Summary         string
	BodyMD          string
	TrackKind       domain.TrackKind
	Languages       []string
	HourlyRateMinor int64
	Currency        domain.Currency
	BoostyURL       string
}

func (uc *UpdateListing) Do(ctx context.Context, in UpdateListingInput) (domain.Listing, error) {
	cur := in.Currency
	if cur == "" {
		cur = domain.CurrencyRUB
	}
	l := domain.Listing{
		ID:              in.ListingID,
		TutorID:         in.TutorID,
		Slug:            strings.ToLower(strings.TrimSpace(in.Slug)),
		Title:           strings.TrimSpace(in.Title),
		Summary:         in.Summary,
		BodyMD:          in.BodyMD,
		TrackKind:       in.TrackKind,
		Languages:       in.Languages,
		HourlyRateMinor: in.HourlyRateMinor,
		Currency:        cur,
		BoostyURL:       strings.TrimSpace(in.BoostyURL),
	}
	if err := l.Validate(); err != nil {
		return domain.Listing{}, fmt.Errorf("tutor.UpdateListing: %w", err)
	}
	saved, err := uc.Repo.UpdateListing(ctx, l)
	if err != nil {
		return domain.Listing{}, fmt.Errorf("tutor.UpdateListing: %w", err)
	}
	return saved, nil
}

// PublishListing — surface the listing publicly. Requires non-empty
// https BoostyURL; the repo also enforces this at SQL level.
type PublishListing struct {
	Repo domain.ListingRepo
	Now  func() time.Time
}

func (uc *PublishListing) Do(ctx context.Context, tutorID, listingID uuid.UUID) error {
	if tutorID == uuid.Nil || listingID == uuid.Nil {
		return fmt.Errorf("tutor.PublishListing: %w", domain.ErrInvalidInput)
	}
	cur, err := uc.Repo.GetListing(ctx, listingID)
	if err != nil {
		return fmt.Errorf("tutor.PublishListing: %w", err)
	}
	if cur.TutorID != tutorID {
		return fmt.Errorf("tutor.PublishListing: %w", domain.ErrNotFound)
	}
	if err := cur.ValidateForPublish(); err != nil {
		return fmt.Errorf("tutor.PublishListing: %w", err)
	}
	if err := uc.Repo.PublishListing(ctx, tutorID, listingID, nowOr(uc.Now)); err != nil {
		return fmt.Errorf("tutor.PublishListing: %w", err)
	}
	return nil
}

// ArchiveListing — soft-removes from marketplace.
type ArchiveListing struct {
	Repo domain.ListingRepo
	Now  func() time.Time
}

func (uc *ArchiveListing) Do(ctx context.Context, tutorID, listingID uuid.UUID) error {
	if tutorID == uuid.Nil || listingID == uuid.Nil {
		return fmt.Errorf("tutor.ArchiveListing: %w", domain.ErrInvalidInput)
	}
	if err := uc.Repo.ArchiveListing(ctx, tutorID, listingID, nowOr(uc.Now)); err != nil {
		return fmt.Errorf("tutor.ArchiveListing: %w", err)
	}
	return nil
}

// ListMyListings — tutor's manage page query.
type ListMyListings struct {
	Repo domain.ListingRepo
}

func (uc *ListMyListings) Do(ctx context.Context, tutorID uuid.UUID) ([]domain.Listing, error) {
	if tutorID == uuid.Nil {
		return nil, fmt.Errorf("tutor.ListMyListings: %w", domain.ErrInvalidInput)
	}
	out, err := uc.Repo.ListListingsByTutor(ctx, tutorID)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListMyListings: %w", err)
	}
	return out, nil
}

// BrowseListings — public marketplace query. No auth required; returns
// only published, non-archived rows.
type BrowseListings struct {
	Repo domain.ListingRepo
}

func (uc *BrowseListings) Do(ctx context.Context, f domain.BrowseFilter) ([]domain.Listing, error) {
	out, err := uc.Repo.BrowseListings(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("tutor.BrowseListings: %w", err)
	}
	return out, nil
}

// GetListingBySlug — public marketplace single-listing query.
type GetListingBySlug struct {
	Repo domain.ListingRepo
}

type ListingWithPackages struct {
	Listing  domain.Listing
	Packages []domain.ListingPackage
}

func (uc *GetListingBySlug) Do(ctx context.Context, slug string) (ListingWithPackages, error) {
	slug = strings.ToLower(strings.TrimSpace(slug))
	if slug == "" {
		return ListingWithPackages{}, fmt.Errorf("tutor.GetListingBySlug: %w", domain.ErrInvalidInput)
	}
	l, err := uc.Repo.GetListingBySlug(ctx, slug)
	if err != nil {
		return ListingWithPackages{}, fmt.Errorf("tutor.GetListingBySlug: %w", err)
	}
	pkgs, err := uc.Repo.ListPackagesByListing(ctx, l.ID)
	if err != nil {
		return ListingWithPackages{}, fmt.Errorf("tutor.GetListingBySlug: %w", err)
	}
	return ListingWithPackages{Listing: l, Packages: pkgs}, nil
}

// AddListingPackage — tutor adds a pricing tier to their listing.
type AddListingPackage struct {
	Repo domain.ListingRepo
}

type AddListingPackageInput struct {
	TutorID     uuid.UUID
	ListingID   uuid.UUID
	Kind        domain.PackageKind
	Hours       int
	PriceMinor  int64
	Description string
}

func (uc *AddListingPackage) Do(ctx context.Context, in AddListingPackageInput) (domain.ListingPackage, error) {
	// Owner gate: load the listing and check tutor_id.
	owner, err := uc.Repo.GetListing(ctx, in.ListingID)
	if err != nil {
		return domain.ListingPackage{}, fmt.Errorf("tutor.AddListingPackage: %w", err)
	}
	if owner.TutorID != in.TutorID {
		return domain.ListingPackage{}, fmt.Errorf("tutor.AddListingPackage: %w", domain.ErrNotFound)
	}
	pkg := domain.ListingPackage{
		ListingID:   in.ListingID,
		Kind:        in.Kind,
		Hours:       in.Hours,
		PriceMinor:  in.PriceMinor,
		Description: in.Description,
	}
	if verr := pkg.Validate(); verr != nil {
		return domain.ListingPackage{}, fmt.Errorf("tutor.AddListingPackage: %w", verr)
	}
	saved, err := uc.Repo.AddPackage(ctx, pkg)
	if err != nil {
		return domain.ListingPackage{}, fmt.Errorf("tutor.AddListingPackage: %w", err)
	}
	return saved, nil
}

// ArchiveListingPackage — soft-deletes a tier.
type ArchiveListingPackage struct {
	Repo domain.ListingRepo
	Now  func() time.Time
}

func (uc *ArchiveListingPackage) Do(ctx context.Context, tutorID, packageID uuid.UUID) error {
	if tutorID == uuid.Nil || packageID == uuid.Nil {
		return fmt.Errorf("tutor.ArchiveListingPackage: %w", domain.ErrInvalidInput)
	}
	if err := uc.Repo.ArchivePackage(ctx, tutorID, packageID, nowOr(uc.Now)); err != nil {
		return fmt.Errorf("tutor.ArchiveListingPackage: %w", err)
	}
	return nil
}
