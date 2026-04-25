package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/mock_interview/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Strictness struct{ pool *pgxpool.Pool }

func NewStrictness(pool *pgxpool.Pool) *Strictness { return &Strictness{pool: pool} }

const strictnessCols = `id, slug, name, off_topic_penalty, must_mention_penalty,
	hallucination_penalty, bias_toward_fail, COALESCE(custom_prompt_template,''),
	active, created_at, updated_at`

func (r *Strictness) scanRow(row pgx.Row) (domain.AIStrictnessProfile, error) {
	var (
		id         pgtype.UUID
		slug, name string
		offTopic   float32
		mustMen    float32
		hallu      float32
		bias       bool
		custom     string
		active     bool
		createdAt  time.Time
		updatedAt  time.Time
	)
	err := row.Scan(&id, &slug, &name, &offTopic, &mustMen, &hallu, &bias,
		&custom, &active, &createdAt, &updatedAt)
	if err != nil {
		return domain.AIStrictnessProfile{}, fmt.Errorf("row.Scan ai_strictness_profiles: %w", err)
	}
	return domain.AIStrictnessProfile{
		ID:                   sharedpg.UUIDFrom(id),
		Slug:                 slug,
		Name:                 name,
		OffTopicPenalty:      offTopic,
		MustMentionPenalty:   mustMen,
		HallucinationPenalty: hallu,
		BiasTowardFail:       bias,
		CustomPromptTemplate: custom,
		Active:               active,
		CreatedAt:            createdAt,
		UpdatedAt:            updatedAt,
	}, nil
}

func (r *Strictness) List(ctx context.Context, onlyActive bool) ([]domain.AIStrictnessProfile, error) {
	q := `SELECT ` + strictnessCols + ` FROM ai_strictness_profiles`
	if onlyActive {
		q += ` WHERE active = true`
	}
	q += ` ORDER BY name ASC`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("mock_interview.Strictness.List: %w", err)
	}
	defer rows.Close()
	var out []domain.AIStrictnessProfile
	for rows.Next() {
		p, err := r.scanRow(rows)
		if err != nil {
			return nil, fmt.Errorf("mock_interview.Strictness.List scan: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows.Err strictness.list: %w", err)
	}
	return out, nil
}

func (r *Strictness) Get(ctx context.Context, id uuid.UUID) (domain.AIStrictnessProfile, error) {
	p, err := r.scanRow(r.pool.QueryRow(ctx,
		`SELECT `+strictnessCols+` FROM ai_strictness_profiles WHERE id=$1`, sharedpg.UUID(id)))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AIStrictnessProfile{}, domain.ErrNotFound
		}
		return domain.AIStrictnessProfile{}, fmt.Errorf("mock_interview.Strictness.Get: %w", err)
	}
	return p, nil
}

func (r *Strictness) GetBySlug(ctx context.Context, slug string) (domain.AIStrictnessProfile, error) {
	p, err := r.scanRow(r.pool.QueryRow(ctx,
		`SELECT `+strictnessCols+` FROM ai_strictness_profiles WHERE slug=$1`, slug))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AIStrictnessProfile{}, domain.ErrNotFound
		}
		return domain.AIStrictnessProfile{}, fmt.Errorf("mock_interview.Strictness.GetBySlug: %w", err)
	}
	return p, nil
}

func (r *Strictness) Create(ctx context.Context, p domain.AIStrictnessProfile) (domain.AIStrictnessProfile, error) {
	var custom *string
	if p.CustomPromptTemplate != "" {
		v := p.CustomPromptTemplate
		custom = &v
	}
	row := r.pool.QueryRow(ctx, `
		INSERT INTO ai_strictness_profiles (id, slug, name, off_topic_penalty,
			must_mention_penalty, hallucination_penalty, bias_toward_fail,
			custom_prompt_template, active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING `+strictnessCols,
		sharedpg.UUID(p.ID), p.Slug, p.Name, p.OffTopicPenalty, p.MustMentionPenalty,
		p.HallucinationPenalty, p.BiasTowardFail, custom, p.Active)
	out, err := r.scanRow(row)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.AIStrictnessProfile{}, fmt.Errorf("slug already exists: %w", domain.ErrConflict)
		}
		return domain.AIStrictnessProfile{}, fmt.Errorf("mock_interview.Strictness.Create: %w", err)
	}
	return out, nil
}

func (r *Strictness) Update(ctx context.Context, p domain.AIStrictnessProfile) (domain.AIStrictnessProfile, error) {
	var custom *string
	if p.CustomPromptTemplate != "" {
		v := p.CustomPromptTemplate
		custom = &v
	}
	row := r.pool.QueryRow(ctx, `
		UPDATE ai_strictness_profiles SET
			name=$2, off_topic_penalty=$3, must_mention_penalty=$4,
			hallucination_penalty=$5, bias_toward_fail=$6,
			custom_prompt_template=$7, active=$8, updated_at=now()
		WHERE id=$1
		RETURNING `+strictnessCols,
		sharedpg.UUID(p.ID), p.Name, p.OffTopicPenalty, p.MustMentionPenalty,
		p.HallucinationPenalty, p.BiasTowardFail, custom, p.Active)
	out, err := r.scanRow(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AIStrictnessProfile{}, domain.ErrNotFound
		}
		return domain.AIStrictnessProfile{}, fmt.Errorf("mock_interview.Strictness.Update: %w", err)
	}
	return out, nil
}

func (r *Strictness) SetActive(ctx context.Context, id uuid.UUID, active bool) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE ai_strictness_profiles SET active=$2, updated_at=now() WHERE id=$1`,
		sharedpg.UUID(id), active)
	if err != nil {
		return fmt.Errorf("mock_interview.Strictness.SetActive: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

var _ domain.StrictnessRepo = (*Strictness)(nil)
