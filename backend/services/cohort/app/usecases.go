// Package app holds use cases for the cohort bounded context.
//
// Phase 1 MVP: real Postgres-backed flows for create / get / list / join /
// leave / leaderboard. Token-based invite remains stubbed (returns
// ErrNotImplemented) — Phase 2.
package app

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/cohort/domain"
	sharedDomain "druz9/shared/domain"

	"github.com/google/uuid"
)

// CreateCohortInput — параметры создания.
type CreateCohortInput struct {
	OwnerID    uuid.UUID
	Slug       string
	Name       string
	StartsAt   time.Time
	EndsAt     time.Time
	Visibility domain.Visibility
}

// CreateCohort use case.
type CreateCohort struct {
	Repo domain.Repo
	Bus  sharedDomain.Bus
	Log  *slog.Logger
}

// NewCreateCohort constructs the use case. Panics on nil logger.
func NewCreateCohort(r domain.Repo, log *slog.Logger) *CreateCohort {
	if log == nil {
		panic("cohort/app: nil logger passed to NewCreateCohort")
	}
	return &CreateCohort{Repo: r, Log: log}
}

// Do — обратная-совместимая обёртка вокруг DoFull (signature тестов).
func (uc *CreateCohort) Do(ctx context.Context, ownerID uuid.UUID, name string, endsAt time.Time) (uuid.UUID, error) {
	if uc.Repo == nil {
		return uuid.Nil, domain.ErrNotImplemented
	}
	return uc.DoFull(ctx, CreateCohortInput{
		OwnerID:    ownerID,
		Slug:       slugify(name),
		Name:       name,
		StartsAt:   time.Now().UTC(),
		EndsAt:     endsAt,
		Visibility: domain.VisibilityPublic,
	})
}

// DoFull — полная форма с явными параметрами.
func (uc *CreateCohort) DoFull(ctx context.Context, in CreateCohortInput) (uuid.UUID, error) {
	if uc.Repo == nil {
		return uuid.Nil, domain.ErrNotImplemented
	}
	in.Slug = strings.TrimSpace(in.Slug)
	in.Name = strings.TrimSpace(in.Name)
	if in.Slug == "" {
		in.Slug = slugify(in.Name)
	}
	if l := len([]rune(in.Name)); l < 3 || l > 64 {
		return uuid.Nil, fmt.Errorf("cohort.Create: name must be 3..64 chars: %w", errInvalidInput)
	}
	if !in.EndsAt.After(in.StartsAt) {
		return uuid.Nil, fmt.Errorf("cohort.Create: ends_at must be after starts_at: %w", errInvalidInput)
	}
	if in.Visibility == "" {
		in.Visibility = domain.VisibilityPublic
	}
	c := domain.Cohort{
		ID:         uuid.New(),
		Slug:       in.Slug,
		Name:       in.Name,
		OwnerID:    in.OwnerID,
		StartsAt:   in.StartsAt,
		EndsAt:     in.EndsAt,
		Status:     domain.StatusActive,
		Visibility: in.Visibility,
	}
	id, err := uc.Repo.Create(ctx, c)
	if err != nil {
		return uuid.Nil, fmt.Errorf("cohort.Create: %w", err)
	}
	// Owner автоматически становится участником с ролью owner.
	if err := uc.Repo.AddMember(ctx, domain.CohortMember{
		CohortID: id,
		UserID:   in.OwnerID,
		Role:     domain.RoleOwner,
		JoinedAt: time.Now().UTC(),
	}); err != nil {
		return uuid.Nil, fmt.Errorf("cohort.Create: addMember(owner): %w", err)
	}
	publishMemberJoined(ctx, uc.Bus, uc.Log, id, in.OwnerID, domain.RoleOwner)
	return id, nil
}

// ErrInvalidInput — sentinel для портов (различение 400 vs 500).
// Use errors.Is для проверки.
var ErrInvalidInput = errors.New("invalid input")

// errInvalidInput — internal alias чтобы не ломать существующие call sites.
var errInvalidInput = ErrInvalidInput

// GetCohort — read-by-slug use case.
type GetCohort struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewGetCohort constructor.
func NewGetCohort(r domain.Repo, log *slog.Logger) *GetCohort {
	if log == nil {
		panic("cohort/app: nil logger passed to NewGetCohort")
	}
	return &GetCohort{Repo: r, Log: log}
}

// CohortView — детальная карточка для /c/{slug}.
type CohortView struct {
	Cohort  domain.Cohort
	Members []domain.CohortMember
}

// Do возвращает (Cohort, members[]).
func (uc *GetCohort) Do(ctx context.Context, slug string) (CohortView, error) {
	if uc.Repo == nil {
		return CohortView{}, domain.ErrNotImplemented
	}
	c, err := uc.Repo.GetBySlug(ctx, slug)
	if err != nil {
		return CohortView{}, fmt.Errorf("cohort.Get: %w", err)
	}
	members, err := uc.Repo.ListMembers(ctx, c.ID)
	if err != nil {
		return CohortView{}, fmt.Errorf("cohort.Get: members: %w", err)
	}
	return CohortView{Cohort: c, Members: members}, nil
}

// ListCohorts — публичный список с фильтрами.
type ListCohorts struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewListCohorts constructor.
func NewListCohorts(r domain.Repo, log *slog.Logger) *ListCohorts {
	if log == nil {
		panic("cohort/app: nil logger passed to NewListCohorts")
	}
	return &ListCohorts{Repo: r, Log: log}
}

// Do возвращает страницу публичных когорт.
func (uc *ListCohorts) Do(ctx context.Context, f domain.ListFilter) (domain.ListPage, error) {
	if uc.Repo == nil {
		return domain.ListPage{}, domain.ErrNotImplemented
	}
	if f.Page < 1 {
		f.Page = 1
	}
	if f.PageSize < 1 || f.PageSize > 50 {
		f.PageSize = 20
	}
	page, err := uc.Repo.ListPublic(ctx, f)
	if err != nil {
		return domain.ListPage{}, fmt.Errorf("cohort.List: %w", err)
	}
	if page.Items == nil {
		page.Items = []domain.CohortWithCount{}
	}
	return page, nil
}

// JoinCohort — присоединение к когорте по cohort_id (Phase 1: без токенов).
type JoinCohort struct {
	Repo domain.Repo
	Bus  sharedDomain.Bus
	Log  *slog.Logger
}

// NewJoinCohort constructor.
func NewJoinCohort(r domain.Repo, log *slog.Logger) *JoinCohort {
	if log == nil {
		panic("cohort/app: nil logger passed to NewJoinCohort")
	}
	return &JoinCohort{Repo: r, Log: log}
}

// Do — обратная-совместимая обёртка для тестов: signature (ctx, _id, _token).
// Phase 1 MVP не использует токены, поэтому второй аргумент игнорируется,
// если Repo == nil — возвращает ErrNotImplemented.
func (uc *JoinCohort) Do(ctx context.Context, userID uuid.UUID, _ string) (uuid.UUID, error) {
	if uc.Repo == nil {
		return uuid.Nil, domain.ErrNotImplemented
	}
	_ = ctx
	_ = userID
	return uuid.Nil, fmt.Errorf("cohort.Join: token-based invite is Phase 2: %w", domain.ErrNotImplemented)
}

// DoByID — основной flow Phase 1: вступить в когорту по её id.
func (uc *JoinCohort) DoByID(ctx context.Context, cohortID, userID uuid.UUID) error {
	if uc.Repo == nil {
		return domain.ErrNotImplemented
	}
	c, err := uc.Repo.Get(ctx, cohortID)
	if err != nil {
		return fmt.Errorf("cohort.Join: load: %w", err)
	}
	if c.Status != domain.StatusActive {
		return fmt.Errorf("cohort.Join: cohort is %s: %w", c.Status, errInvalidInput)
	}
	already, err := uc.Repo.HasMember(ctx, cohortID, userID)
	if err != nil {
		return fmt.Errorf("cohort.Join: check member: %w", err)
	}
	if already {
		return domain.ErrAlreadyMember
	}
	count, err := uc.Repo.CountMembers(ctx, cohortID)
	if err != nil {
		return fmt.Errorf("cohort.Join: count: %w", err)
	}
	if count >= domain.MaxMembersPhase1 {
		return domain.ErrCohortFull
	}
	if err := uc.Repo.AddMember(ctx, domain.CohortMember{
		CohortID: cohortID,
		UserID:   userID,
		Role:     domain.RoleMember,
		JoinedAt: time.Now().UTC(),
	}); err != nil {
		return fmt.Errorf("cohort.Join: insert: %w", err)
	}
	publishMemberJoined(ctx, uc.Bus, uc.Log, cohortID, userID, domain.RoleMember)
	return nil
}

// publishMemberJoined emits sharedDomain.CohortMemberJoined best-effort —
// failure to publish must never fail the join. Centralised so JoinCohort,
// JoinByToken, and CreateCohort share the same semantics.
func publishMemberJoined(ctx context.Context, bus sharedDomain.Bus, log *slog.Logger, cohortID, userID uuid.UUID, role domain.Role) {
	if bus == nil {
		return
	}
	if err := bus.Publish(ctx, sharedDomain.CohortMemberJoined{
		CohortID: cohortID,
		UserID:   userID,
		Role:     string(role),
	}); err != nil && log != nil {
		log.WarnContext(ctx, "cohort: publish CohortMemberJoined", slog.Any("err", err))
	}
}

// LeaveCohort — выход из когорты, авто-распуск при последнем участнике.
type LeaveCohort struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewLeaveCohort constructor.
func NewLeaveCohort(r domain.Repo, log *slog.Logger) *LeaveCohort {
	if log == nil {
		panic("cohort/app: nil logger passed to NewLeaveCohort")
	}
	return &LeaveCohort{Repo: r, Log: log}
}

// LeaveResult — что произошло после Leave.
type LeaveResult struct {
	Status string // "left" | "disbanded"
}

// Do удаляет membership; если это был последний — распускает когорту.
func (uc *LeaveCohort) Do(ctx context.Context, cohortID, userID uuid.UUID) (LeaveResult, error) {
	if uc.Repo == nil {
		return LeaveResult{}, domain.ErrNotImplemented
	}
	has, err := uc.Repo.HasMember(ctx, cohortID, userID)
	if err != nil {
		return LeaveResult{}, fmt.Errorf("cohort.Leave: check: %w", err)
	}
	if !has {
		return LeaveResult{}, domain.ErrNotFound
	}
	if rerr := uc.Repo.RemoveMember(ctx, cohortID, userID); rerr != nil {
		return LeaveResult{}, fmt.Errorf("cohort.Leave: remove: %w", rerr)
	}
	count, err := uc.Repo.CountMembers(ctx, cohortID)
	if err != nil {
		return LeaveResult{}, fmt.Errorf("cohort.Leave: count: %w", err)
	}
	if count == 0 {
		if err := uc.Repo.Disband(ctx, cohortID); err != nil {
			return LeaveResult{}, fmt.Errorf("cohort.Leave: disband: %w", err)
		}
		return LeaveResult{Status: "disbanded"}, nil
	}
	return LeaveResult{Status: "left"}, nil
}

// GetLeaderboard use case.
type GetLeaderboard struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewGetLeaderboard constructor.
func NewGetLeaderboard(r domain.Repo, log *slog.Logger) *GetLeaderboard {
	if log == nil {
		panic("cohort/app: nil logger passed to NewGetLeaderboard")
	}
	return &GetLeaderboard{Repo: r, Log: log}
}

// Do — leaderboard по cohort_id.
//
// Anti-fallback: для пустой когорты возвращаем []; никаких платформенных средних.
func (uc *GetLeaderboard) Do(ctx context.Context, cohortID uuid.UUID, weekISO string) ([]domain.MemberStanding, error) {
	if uc.Repo == nil {
		return nil, domain.ErrNotImplemented
	}
	out, err := uc.Repo.Leaderboard(ctx, cohortID, weekISO)
	if err != nil {
		return nil, fmt.Errorf("cohort.Leaderboard: %w", err)
	}
	if out == nil {
		out = []domain.MemberStanding{}
	}
	return out, nil
}

// IssueInvite — owner/coach generates a one-time-or-multi-use invite token.
// MaxUses = 0 means unlimited. ttl = 0 means no expiry.
type IssueInvite struct {
	Repo domain.Repo
	Log  *slog.Logger
}

func NewIssueInvite(r domain.Repo, log *slog.Logger) *IssueInvite {
	if r == nil {
		panic("cohort/app: nil repo passed to NewIssueInvite")
	}
	if log == nil {
		panic("cohort/app: nil logger passed to NewIssueInvite")
	}
	return &IssueInvite{Repo: r, Log: log}
}

// Do issues an invite token. ActorID must be a coach or owner of the cohort.
// Returns the freshly-minted token (caller renders it as druz9.online/c/join/{token}).
func (uc *IssueInvite) Do(ctx context.Context, cohortID, actorID uuid.UUID, maxUses int, ttl time.Duration) (string, error) {
	if cohortID == uuid.Nil || actorID == uuid.Nil {
		return "", ErrForbidden
	}
	if maxUses < 0 || maxUses > 100 {
		return "", ErrInvalidMaxUses
	}
	role, err := uc.Repo.GetMemberRole(ctx, cohortID, actorID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return "", ErrForbidden
		}
		return "", fmt.Errorf("cohort.IssueInvite: load role: %w", err)
	}
	if role != domain.RoleCoach && role != domain.RoleOwner {
		return "", ErrForbidden
	}
	token, err := newInviteToken()
	if err != nil {
		return "", fmt.Errorf("cohort.IssueInvite: token: %w", err)
	}
	inv := domain.CohortInvite{
		Token:     token,
		CohortID:  cohortID,
		CreatedBy: actorID,
		MaxUses:   maxUses,
	}
	if ttl > 0 {
		inv.ExpiresAt = time.Now().Add(ttl).UTC()
	}
	if err := uc.Repo.IssueInvite(ctx, inv); err != nil {
		return "", fmt.Errorf("cohort.IssueInvite: %w", err)
	}
	return token, nil
}

// JoinByToken consumes an invite token + adds the user as a member.
// Idempotent on re-use of an active token only when the user wasn't yet a
// member; otherwise returns ErrAlreadyMember without consuming a slot.
type JoinByToken struct {
	Repo domain.Repo
	Bus  sharedDomain.Bus
	Log  *slog.Logger
}

func NewJoinByToken(r domain.Repo, log *slog.Logger) *JoinByToken {
	if r == nil {
		panic("cohort/app: nil repo passed to NewJoinByToken")
	}
	if log == nil {
		panic("cohort/app: nil logger passed to NewJoinByToken")
	}
	return &JoinByToken{Repo: r, Log: log}
}

func (uc *JoinByToken) Do(ctx context.Context, token string, userID uuid.UUID) (uuid.UUID, error) {
	if token == "" || userID == uuid.Nil {
		return uuid.Nil, ErrInvalidToken
	}
	cohortID, err := uc.Repo.ConsumeInvite(ctx, token)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return uuid.Nil, ErrInvalidToken
		}
		return uuid.Nil, fmt.Errorf("cohort.JoinByToken: consume: %w", err)
	}
	// Already-a-member is a benign success path — return the cohort_id so
	// the frontend can navigate to it without a confusing error.
	if has, _ := uc.Repo.HasMember(ctx, cohortID, userID); has {
		return cohortID, nil
	}
	if err := uc.Repo.AddMember(ctx, domain.CohortMember{
		CohortID: cohortID,
		UserID:   userID,
		Role:     domain.RoleMember,
		JoinedAt: time.Now().UTC(),
	}); err != nil {
		if errors.Is(err, domain.ErrAlreadyMember) {
			return cohortID, nil
		}
		return uuid.Nil, fmt.Errorf("cohort.JoinByToken: add member: %w", err)
	}
	publishMemberJoined(ctx, uc.Bus, uc.Log, cohortID, userID, domain.RoleMember)
	return cohortID, nil
}

var (
	ErrInvalidMaxUses = errors.New("cohort: max_uses must be 0 (unlimited) or 1..100")
	ErrInvalidToken   = errors.New("cohort: invalid or expired invite token")
)

// newInviteToken — 16 random bytes → URL-safe base64 (≈22 chars).
func newInviteToken() (string, error) {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", fmt.Errorf("cohort.newInviteToken: %w", err)
	}
	// base64-url, no padding — keeps the link copy-paste friendly.
	return base64.RawURLEncoding.EncodeToString(buf[:]), nil
}

// slugify — простая транслитерация: lower, пробелы → "-", оставляем
// латиницу/цифры/дефис. Cyrillic/прочие unicode сжимаются в "-".
func slugify(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	prevDash := false
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash && b.Len() > 0 {
				b.WriteRune('-')
				prevDash = true
			}
		}
	}
	out := strings.TrimRight(b.String(), "-")
	if out == "" {
		// fallback: random suffix чтобы не создавать пустой slug.
		var buf [4]byte
		_, _ = rand.Read(buf[:])
		out = "c-" + hex.EncodeToString(buf[:])
	}
	return out
}

// ── M5c: owner-side cohort moderation ─────────────────────────────────────

// UpdateCohort lets the owner rewrite name / ends_at / visibility.
// Returns the freshly-loaded row.
type UpdateCohort struct {
	repo domain.Repo
	log  *slog.Logger
}

func NewUpdateCohort(repo domain.Repo, log *slog.Logger) *UpdateCohort {
	if repo == nil {
		panic("cohort.UpdateCohort: nil repo")
	}
	if log == nil {
		panic("cohort.UpdateCohort: nil log")
	}
	return &UpdateCohort{repo: repo, log: log}
}

type UpdateCohortInput struct {
	CohortID   uuid.UUID
	ActorID    uuid.UUID
	Name       *string
	EndsAt     *time.Time
	Visibility *domain.Visibility
}

// Do checks ownership then writes the patch.
func (uc *UpdateCohort) Do(ctx context.Context, in UpdateCohortInput) (domain.Cohort, error) {
	c, err := uc.repo.Get(ctx, in.CohortID)
	if err != nil {
		return domain.Cohort{}, fmt.Errorf("cohort.UpdateCohort: load: %w", err)
	}
	if c.OwnerID != in.ActorID {
		return domain.Cohort{}, ErrForbidden
	}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return domain.Cohort{}, ErrInvalidName
		}
		in.Name = &name
	}
	if in.EndsAt != nil && in.EndsAt.Before(time.Now()) {
		return domain.Cohort{}, ErrInvalidEnd
	}
	if in.Visibility != nil {
		switch *in.Visibility {
		case domain.VisibilityPublic, domain.VisibilityInvite:
			// ok
		default:
			return domain.Cohort{}, ErrInvalidVisibility
		}
	}
	out, err := uc.repo.UpdateMeta(ctx, in.CohortID, domain.CohortPatch{
		Name:       in.Name,
		EndsAt:     in.EndsAt,
		Visibility: in.Visibility,
	})
	if err != nil {
		return domain.Cohort{}, fmt.Errorf("cohort.UpdateCohort: %w", err)
	}
	return out, nil
}

// GraduateCohort flips status active → graduated AND emits a
// sharedDomain.CohortGraduated event for the achievements service to
// award badges to every member. Owner-only.
type GraduateCohort struct {
	repo domain.Repo
	bus  sharedDomain.Bus
	log  *slog.Logger
}

func NewGraduateCohort(repo domain.Repo, bus sharedDomain.Bus, log *slog.Logger) *GraduateCohort {
	if repo == nil {
		panic("cohort.GraduateCohort: nil repo")
	}
	if log == nil {
		panic("cohort.GraduateCohort: nil log")
	}
	return &GraduateCohort{repo: repo, bus: bus, log: log}
}

func (uc *GraduateCohort) Do(ctx context.Context, cohortID, actorID uuid.UUID) (domain.Cohort, error) {
	c, err := uc.repo.Get(ctx, cohortID)
	if err != nil {
		return domain.Cohort{}, fmt.Errorf("cohort.GraduateCohort: load: %w", err)
	}
	if c.OwnerID != actorID {
		return domain.Cohort{}, ErrForbidden
	}
	if c.Status != domain.StatusActive {
		// Already graduated/cancelled — idempotent: return as-is, no event.
		return c, nil
	}
	members, err := uc.repo.ListMembers(ctx, cohortID)
	if err != nil {
		return domain.Cohort{}, fmt.Errorf("cohort.GraduateCohort: members: %w", err)
	}
	// Atomic: flip the status via UpdateMeta with a status-aware patch.
	graduatedStatus := domain.StatusGraduated
	out, err := uc.repo.UpdateMeta(ctx, cohortID, domain.CohortPatch{Status: &graduatedStatus})
	if err != nil {
		return domain.Cohort{}, fmt.Errorf("cohort.GraduateCohort: %w", err)
	}
	// Publish event — handler failures must not fail the graduation.
	if uc.bus != nil {
		ids := make([]uuid.UUID, 0, len(members))
		for _, m := range members {
			ids = append(ids, m.UserID)
		}
		ev := sharedDomain.CohortGraduated{
			CohortID:    out.ID,
			CohortSlug:  out.Slug,
			CohortName:  out.Name,
			MemberIDs:   ids,
			GraduatedAt: time.Now().UTC(),
		}
		if perr := uc.bus.Publish(ctx, ev); perr != nil && uc.log != nil {
			uc.log.WarnContext(ctx, "cohort.GraduateCohort: publish CohortGraduated", slog.Any("err", perr))
		}
	}
	return out, nil
}

// DisbandCohort marks the cohort cancelled. Owner-only.
type DisbandCohort struct {
	repo domain.Repo
	log  *slog.Logger
}

func NewDisbandCohort(repo domain.Repo, log *slog.Logger) *DisbandCohort {
	if repo == nil {
		panic("cohort.DisbandCohort: nil repo")
	}
	if log == nil {
		panic("cohort.DisbandCohort: nil log")
	}
	return &DisbandCohort{repo: repo, log: log}
}

func (uc *DisbandCohort) Do(ctx context.Context, cohortID, actorID uuid.UUID) error {
	c, err := uc.repo.Get(ctx, cohortID)
	if err != nil {
		return fmt.Errorf("cohort.DisbandCohort: load: %w", err)
	}
	if c.OwnerID != actorID {
		return ErrForbidden
	}
	if err := uc.repo.Disband(ctx, cohortID); err != nil {
		return fmt.Errorf("cohort.DisbandCohort: %w", err)
	}
	return nil
}

// SetMemberRole — owner-only role change (member ↔ coach).
type SetMemberRole struct {
	repo domain.Repo
	log  *slog.Logger
}

func NewSetMemberRole(repo domain.Repo, log *slog.Logger) *SetMemberRole {
	if repo == nil {
		panic("cohort.SetMemberRole: nil repo")
	}
	if log == nil {
		panic("cohort.SetMemberRole: nil log")
	}
	return &SetMemberRole{repo: repo, log: log}
}

func (uc *SetMemberRole) Do(ctx context.Context, cohortID, actorID, targetID uuid.UUID, role domain.Role) error {
	c, err := uc.repo.Get(ctx, cohortID)
	if err != nil {
		return fmt.Errorf("cohort.SetMemberRole: load: %w", err)
	}
	if c.OwnerID != actorID {
		return ErrForbidden
	}
	// Don't let the owner demote themselves through this path — they have
	// to use disband or transfer-ownership (out of scope for M5c).
	if targetID == c.OwnerID {
		return ErrForbidden
	}
	if role != domain.RoleMember && role != domain.RoleCoach {
		return ErrInvalidRole
	}
	return fmt.Errorf("cohort.SetMemberRole: %w", uc.repo.UpdateMemberRole(ctx, cohortID, targetID, role))
}

var (
	ErrForbidden         = errors.New("cohort: forbidden")
	ErrInvalidName       = errors.New("cohort: invalid name")
	ErrInvalidEnd        = errors.New("cohort: ends_at must be in the future")
	ErrInvalidVisibility = errors.New("cohort: invalid visibility")
	ErrInvalidRole       = errors.New("cohort: invalid role")
)

// GetStreakHeatmap returns the per-cohort daily-kata streak grid for the
// «Streak» tab. days is clamped 1..30 in the repo. Public — anyone can
// see how active a cohort is.
type GetStreakHeatmap struct {
	repo domain.Repo
	log  *slog.Logger
}

func NewGetStreakHeatmap(repo domain.Repo, log *slog.Logger) *GetStreakHeatmap {
	if repo == nil {
		panic("cohort.GetStreakHeatmap: nil repo")
	}
	if log == nil {
		panic("cohort.GetStreakHeatmap: nil log")
	}
	return &GetStreakHeatmap{repo: repo, log: log}
}

func (uc *GetStreakHeatmap) Do(ctx context.Context, cohortID uuid.UUID, days int) ([]domain.StreakHeatmapRow, error) {
	out, err := uc.repo.StreakHeatmap(ctx, cohortID, days)
	if err != nil {
		return nil, fmt.Errorf("cohort.GetStreakHeatmap: %w", err)
	}
	return out, nil
}
