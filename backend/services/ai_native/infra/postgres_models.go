// postgres_models.go — pgx adapter for the llm_models registry
// (migration 00033). Hand-rolled (no sqlc) so admin can hot-add a
// column later without re-running the codegen pipeline; the table is
// small (~5-50 rows) and the queries are trivial CRUD.
//
// Errors are wrapped with the package + method context per the
// "Wrap interface-method errors" convention used elsewhere in this
// service. pgx unique-violation (23505) is translated into
// domain.ErrLLMModelConflict so callers don't need to import jackc/pgx.
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/ai_native/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// LLMModels is the persistence adapter for the llm_models table.
type LLMModels struct {
	pool *pgxpool.Pool
}

// NewLLMModels wraps a pool. Caller passes the same pgxpool used by the
// rest of ai_native — no separate connection needed.
func NewLLMModels(pool *pgxpool.Pool) *LLMModels {
	if pool == nil {
		panic("ai_native.infra.NewLLMModels: pool is required")
	}
	return &LLMModels{pool: pool}
}

const llmModelColumns = `id, model_id, label, provider, provider_id, is_virtual, tier, is_enabled,
    context_window, cost_per_1k_input_usd, cost_per_1k_output_usd,
    use_for_arena, use_for_insight, use_for_mock, use_for_vacancies, sort_order,
    created_at, updated_at`

// List returns rows ordered by (sort_order, label) so admin and public
// callers see a stable order. Filter knobs are AND'd together.
func (r *LLMModels) List(ctx context.Context, f domain.LLMModelFilter) ([]domain.LLMModel, error) {
	q := `SELECT ` + llmModelColumns + ` FROM llm_models WHERE 1=1`
	args := make([]any, 0, 2)
	if f.OnlyEnabled {
		q += ` AND is_enabled = TRUE`
	}
	if f.Use != "" {
		switch f.Use {
		case domain.LLMModelUseArena:
			q += ` AND use_for_arena = TRUE`
		case domain.LLMModelUseInsight:
			q += ` AND use_for_insight = TRUE`
		case domain.LLMModelUseMock:
			q += ` AND use_for_mock = TRUE`
		case domain.LLMModelUseVacancies:
			q += ` AND use_for_vacancies = TRUE`
		default:
			return nil, fmt.Errorf("ai_native.LLMModels.List: %w: unknown use %q", domain.ErrLLMModelInvalid, f.Use)
		}
	}
	q += ` ORDER BY sort_order ASC, label ASC`

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("ai_native.LLMModels.List: %w", err)
	}
	defer rows.Close()

	out := make([]domain.LLMModel, 0, 16)
	for rows.Next() {
		m, err := scanLLMModel(rows)
		if err != nil {
			return nil, fmt.Errorf("ai_native.LLMModels.List: scan: %w", err)
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ai_native.LLMModels.List: rows: %w", err)
	}
	return out, nil
}

// GetByID looks up a row by its UNIQUE model_id (NOT the PK).
func (r *LLMModels) GetByID(ctx context.Context, modelID string) (domain.LLMModel, error) {
	if modelID == "" {
		return domain.LLMModel{}, fmt.Errorf("ai_native.LLMModels.GetByID: %w: empty model_id", domain.ErrLLMModelInvalid)
	}
	row := r.pool.QueryRow(ctx,
		`SELECT `+llmModelColumns+` FROM llm_models WHERE model_id = $1`,
		modelID,
	)
	m, err := scanLLMModel(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.LLMModel{}, fmt.Errorf("ai_native.LLMModels.GetByID: %w", domain.ErrLLMModelNotFound)
		}
		return domain.LLMModel{}, fmt.Errorf("ai_native.LLMModels.GetByID: %w", err)
	}
	return m, nil
}

// Create inserts a new row. Returns ErrLLMModelConflict on UNIQUE
// violation so the HTTP layer can map to 409.
func (r *LLMModels) Create(ctx context.Context, m domain.LLMModel) (domain.LLMModel, error) {
	if err := validateLLMModel(m); err != nil {
		return domain.LLMModel{}, fmt.Errorf("ai_native.LLMModels.Create: %w", err)
	}
	row := r.pool.QueryRow(ctx,
		`INSERT INTO llm_models (
            model_id, label, provider, provider_id, is_virtual, tier, is_enabled,
            context_window, cost_per_1k_input_usd, cost_per_1k_output_usd,
            use_for_arena, use_for_insight, use_for_mock, use_for_vacancies, sort_order
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING `+llmModelColumns,
		m.ModelID, m.Label, m.Provider, m.ProviderID, m.IsVirtual, string(m.Tier), m.IsEnabled,
		m.ContextWindow, m.CostPer1KInputUSD, m.CostPer1KOutputUSD,
		m.UseForArena, m.UseForInsight, m.UseForMock, m.UseForVacancies, m.SortOrder,
	)
	out, err := scanLLMModel(row)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.LLMModel{}, fmt.Errorf("ai_native.LLMModels.Create: %w", domain.ErrLLMModelConflict)
		}
		return domain.LLMModel{}, fmt.Errorf("ai_native.LLMModels.Create: %w", err)
	}
	return out, nil
}

// Update overwrites every editable column. The model_id in the path
// (first arg) is the lookup key; the m.ModelID in the struct may be a
// rename (we allow it — provider may rebrand a route).
func (r *LLMModels) Update(ctx context.Context, modelID string, m domain.LLMModel) (domain.LLMModel, error) {
	if modelID == "" {
		return domain.LLMModel{}, fmt.Errorf("ai_native.LLMModels.Update: %w: empty model_id", domain.ErrLLMModelInvalid)
	}
	if err := validateLLMModel(m); err != nil {
		return domain.LLMModel{}, fmt.Errorf("ai_native.LLMModels.Update: %w", err)
	}
	row := r.pool.QueryRow(ctx,
		`UPDATE llm_models SET
             model_id = $1, label = $2, provider = $3, provider_id = $4, is_virtual = $5,
             tier = $6, is_enabled = $7, context_window = $8,
             cost_per_1k_input_usd = $9, cost_per_1k_output_usd = $10,
             use_for_arena = $11, use_for_insight = $12, use_for_mock = $13,
             use_for_vacancies = $14, sort_order = $15, updated_at = now()
         WHERE model_id = $16
         RETURNING `+llmModelColumns,
		m.ModelID, m.Label, m.Provider, m.ProviderID, m.IsVirtual, string(m.Tier),
		m.IsEnabled, m.ContextWindow,
		m.CostPer1KInputUSD, m.CostPer1KOutputUSD,
		m.UseForArena, m.UseForInsight, m.UseForMock, m.UseForVacancies,
		m.SortOrder, modelID,
	)
	out, err := scanLLMModel(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.LLMModel{}, fmt.Errorf("ai_native.LLMModels.Update: %w", domain.ErrLLMModelNotFound)
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.LLMModel{}, fmt.Errorf("ai_native.LLMModels.Update: %w", domain.ErrLLMModelConflict)
		}
		return domain.LLMModel{}, fmt.Errorf("ai_native.LLMModels.Update: %w", err)
	}
	return out, nil
}

// Delete hard-removes a row. Callers preferring soft-delete should call
// SetEnabled(modelID, false) instead. Admin UI exposes both.
func (r *LLMModels) Delete(ctx context.Context, modelID string) error {
	if modelID == "" {
		return fmt.Errorf("ai_native.LLMModels.Delete: %w: empty model_id", domain.ErrLLMModelInvalid)
	}
	tag, err := r.pool.Exec(ctx, `DELETE FROM llm_models WHERE model_id = $1`, modelID)
	if err != nil {
		return fmt.Errorf("ai_native.LLMModels.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("ai_native.LLMModels.Delete: %w", domain.ErrLLMModelNotFound)
	}
	return nil
}

// SetEnabled flips just the is_enabled boolean. Cheap inline toggle for
// the admin grid — avoids a full Update round-trip.
func (r *LLMModels) SetEnabled(ctx context.Context, modelID string, enabled bool) error {
	if modelID == "" {
		return fmt.Errorf("ai_native.LLMModels.SetEnabled: %w: empty model_id", domain.ErrLLMModelInvalid)
	}
	tag, err := r.pool.Exec(ctx,
		`UPDATE llm_models SET is_enabled = $1, updated_at = now() WHERE model_id = $2`,
		enabled, modelID,
	)
	if err != nil {
		return fmt.Errorf("ai_native.LLMModels.SetEnabled: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("ai_native.LLMModels.SetEnabled: %w", domain.ErrLLMModelNotFound)
	}
	return nil
}

// scannable is the subset of pgx.Row / pgx.Rows we use — accepting both
// keeps List() and the single-row helpers sharing one scanner.
type scannable interface {
	Scan(dest ...any) error
}

func scanLLMModel(s scannable) (domain.LLMModel, error) {
	var (
		m       domain.LLMModel
		tierRaw string
	)
	if err := s.Scan(
		&m.ID, &m.ModelID, &m.Label, &m.Provider, &m.ProviderID, &m.IsVirtual, &tierRaw, &m.IsEnabled,
		&m.ContextWindow, &m.CostPer1KInputUSD, &m.CostPer1KOutputUSD,
		&m.UseForArena, &m.UseForInsight, &m.UseForMock, &m.UseForVacancies, &m.SortOrder,
		&m.CreatedAt, &m.UpdatedAt,
	); err != nil {
		return domain.LLMModel{}, fmt.Errorf("ai_native.scanLLMModel: %w", err)
	}
	m.Tier = domain.LLMModelTier(tierRaw)
	return m, nil
}

// validateLLMModel enforces invariants the table also checks (tier
// CHECK, NOT NULL fields). Done in Go too so the API returns a 400 with
// a useful message instead of a generic 500 from pg.
func validateLLMModel(m domain.LLMModel) error {
	if m.ModelID == "" {
		return fmt.Errorf("%w: model_id is required", domain.ErrLLMModelInvalid)
	}
	if m.Label == "" {
		return fmt.Errorf("%w: label is required", domain.ErrLLMModelInvalid)
	}
	if m.Provider == "" {
		return fmt.Errorf("%w: provider is required", domain.ErrLLMModelInvalid)
	}
	if !m.Tier.IsValid() {
		return fmt.Errorf("%w: tier must be 'free' or 'premium' (got %q)", domain.ErrLLMModelInvalid, m.Tier)
	}
	return nil
}

// Interface guard.
var _ domain.LLMModelRepo = (*LLMModels)(nil)
