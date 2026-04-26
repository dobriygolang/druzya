package infra

import (
	"context"
	"fmt"

	"druz9/mock_interview/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CompanyStages struct{ pool *pgxpool.Pool }

func NewCompanyStages(pool *pgxpool.Pool) *CompanyStages { return &CompanyStages{pool: pool} }

const companyStageCols = `company_id, stage_kind, ordinal, optional, language_pool, task_pool_ids, ai_strictness_profile_id, default_question_limit, company_question_limit`

func scanCompanyStage(row pgx.Row) (domain.CompanyStage, error) {
	var (
		companyID, profID pgtype.UUID
		stageKind         string
		ordinal           int16
		optional          bool
		langPool          []string
		taskPool          []pgtype.UUID
		defaultLimit      pgtype.Int4
		companyLimit      pgtype.Int4
	)
	if err := row.Scan(&companyID, &stageKind, &ordinal, &optional, &langPool, &taskPool, &profID, &defaultLimit, &companyLimit); err != nil {
		return domain.CompanyStage{}, fmt.Errorf("row.Scan company_stages: %w", err)
	}
	out := domain.CompanyStage{
		CompanyID: sharedpg.UUIDFrom(companyID),
		StageKind: domain.StageKind(stageKind),
		Ordinal:   int(ordinal),
		Optional:  optional,
	}
	out.LanguagePool = make([]domain.TaskLanguage, 0, len(langPool))
	for _, l := range langPool {
		out.LanguagePool = append(out.LanguagePool, domain.TaskLanguage(l))
	}
	out.TaskPoolIDs = make([]uuid.UUID, 0, len(taskPool))
	for _, t := range taskPool {
		out.TaskPoolIDs = append(out.TaskPoolIDs, sharedpg.UUIDFrom(t))
	}
	if profID.Valid {
		v := sharedpg.UUIDFrom(profID)
		out.AIStrictnessProfileID = &v
	}
	if defaultLimit.Valid {
		v := int(defaultLimit.Int32)
		out.DefaultQuestionLimit = &v
	}
	if companyLimit.Valid {
		v := int(companyLimit.Int32)
		out.CompanyQuestionLimit = &v
	}
	return out, nil
}

// nullableInt unwraps an *int into pgtype.Int4 for inserts/updates.
func nullableInt(v *int) pgtype.Int4 {
	if v == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: int32(*v), Valid: true}
}

func (r *CompanyStages) GetForCompany(ctx context.Context, companyID uuid.UUID) ([]domain.CompanyStage, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+companyStageCols+` FROM company_stages WHERE company_id=$1 ORDER BY ordinal ASC`,
		sharedpg.UUID(companyID))
	if err != nil {
		return nil, fmt.Errorf("mock_interview.CompanyStages.GetForCompany: %w", err)
	}
	defer rows.Close()
	var out []domain.CompanyStage
	for rows.Next() {
		s, err := scanCompanyStage(rows)
		if err != nil {
			return nil, fmt.Errorf("mock_interview.CompanyStages.GetForCompany scan: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows.Err company_stages.list: %w", err)
	}
	return out, nil
}

func (r *CompanyStages) Upsert(ctx context.Context, s domain.CompanyStage) error {
	langPool := make([]string, 0, len(s.LanguagePool))
	for _, l := range s.LanguagePool {
		langPool = append(langPool, string(l))
	}
	taskPool := make([]pgtype.UUID, 0, len(s.TaskPoolIDs))
	for _, t := range s.TaskPoolIDs {
		taskPool = append(taskPool, sharedpg.UUID(t))
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO company_stages (company_id, stage_kind, ordinal, optional, language_pool, task_pool_ids, ai_strictness_profile_id, default_question_limit, company_question_limit)
		VALUES ($1,$2,$3,$4,$5::mock_task_language[],$6,$7,$8,$9)
		ON CONFLICT (company_id, stage_kind) DO UPDATE SET
			ordinal=EXCLUDED.ordinal,
			optional=EXCLUDED.optional,
			language_pool=EXCLUDED.language_pool,
			task_pool_ids=EXCLUDED.task_pool_ids,
			ai_strictness_profile_id=EXCLUDED.ai_strictness_profile_id,
			default_question_limit=EXCLUDED.default_question_limit,
			company_question_limit=EXCLUDED.company_question_limit`,
		sharedpg.UUID(s.CompanyID), string(s.StageKind), s.Ordinal, s.Optional,
		langPool, taskPool, nullableUUID(s.AIStrictnessProfileID),
		nullableInt(s.DefaultQuestionLimit), nullableInt(s.CompanyQuestionLimit))
	if err != nil {
		return fmt.Errorf("mock_interview.CompanyStages.Upsert: %w", err)
	}
	return nil
}

func (r *CompanyStages) Delete(ctx context.Context, companyID uuid.UUID, stage domain.StageKind) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM company_stages WHERE company_id=$1 AND stage_kind=$2`,
		sharedpg.UUID(companyID), string(stage))
	if err != nil {
		return fmt.Errorf("mock_interview.CompanyStages.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *CompanyStages) ReplaceAll(ctx context.Context, companyID uuid.UUID, stages []domain.CompanyStage) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("mock_interview.CompanyStages.ReplaceAll begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM company_stages WHERE company_id=$1`, sharedpg.UUID(companyID)); err != nil {
		return fmt.Errorf("mock_interview.CompanyStages.ReplaceAll delete: %w", err)
	}
	for _, s := range stages {
		s.CompanyID = companyID
		langPool := make([]string, 0, len(s.LanguagePool))
		for _, l := range s.LanguagePool {
			langPool = append(langPool, string(l))
		}
		taskPool := make([]pgtype.UUID, 0, len(s.TaskPoolIDs))
		for _, t := range s.TaskPoolIDs {
			taskPool = append(taskPool, sharedpg.UUID(t))
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO company_stages (company_id, stage_kind, ordinal, optional, language_pool, task_pool_ids, ai_strictness_profile_id, default_question_limit, company_question_limit)
			VALUES ($1,$2,$3,$4,$5::mock_task_language[],$6,$7,$8,$9)`,
			sharedpg.UUID(s.CompanyID), string(s.StageKind), s.Ordinal, s.Optional,
			langPool, taskPool, nullableUUID(s.AIStrictnessProfileID),
			nullableInt(s.DefaultQuestionLimit), nullableInt(s.CompanyQuestionLimit)); err != nil {
			return fmt.Errorf("mock_interview.CompanyStages.ReplaceAll insert: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("mock_interview.CompanyStages.ReplaceAll commit: %w", err)
	}
	return nil
}

var _ domain.CompanyStageRepo = (*CompanyStages)(nil)
