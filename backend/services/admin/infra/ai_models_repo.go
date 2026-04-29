// ai_models_repo.go — Postgres adapter for the llm_models catalogue.
//
// Hosts both the admin write surface (list/create/update/toggle/delete)
// and the public read-through (`/api/v1/ai/models`). SQL preserved
// verbatim from the original chi-direct handlers in
// cmd/monolith/services/admin so behaviour is byte-for-byte identical.
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/admin/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AIModels is the persistence adapter for llm_models.
type AIModels struct {
	pool *pgxpool.Pool
}

// NewAIModels wraps a pool.
func NewAIModels(pool *pgxpool.Pool) *AIModels { return &AIModels{pool: pool} }

const adminLLMModelCols = `
	id, model_id, label, provider, tier, is_enabled,
	context_window, cost_per_1k_input_usd, cost_per_1k_output_usd,
	use_for_arena, use_for_insight, use_for_mock, sort_order,
	to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
	to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`

// allowedUseSurfaces — `?use=...` filter values mapped to DB columns.
var allowedUseSurfaces = map[string]string{
	"arena":     "use_for_arena",
	"insight":   "use_for_insight",
	"mock":      "use_for_mock",
	"vacancies": "use_for_vacancies",
}

func scanAIModel(row pgx.Row) (domain.AIModel, error) {
	var d domain.AIModel
	err := row.Scan(
		&d.ID, &d.ModelID, &d.Label, &d.Provider, &d.Tier, &d.IsEnabled,
		&d.ContextWindow, &d.CostPerKInputUSD, &d.CostPerKOutputUSD,
		&d.UseForArena, &d.UseForInsight, &d.UseForMock, &d.SortOrder,
		&d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return d, fmt.Errorf("scan llm_model: %w", err)
	}
	return d, nil
}

// List returns every llm_models row, including disabled ones.
func (a *AIModels) List(ctx context.Context) ([]domain.AIModel, error) {
	rows, err := a.pool.Query(ctx,
		`SELECT `+adminLLMModelCols+` FROM llm_models ORDER BY sort_order ASC, model_id ASC`)
	if err != nil {
		return nil, fmt.Errorf("admin.AIModels.List: %w", err)
	}
	defer rows.Close()
	out := make([]domain.AIModel, 0, 16)
	for rows.Next() {
		row, err := scanAIModel(rows)
		if err != nil {
			continue
		}
		out = append(out, row)
	}
	return out, nil
}

// Create inserts a new llm_models row.
func (a *AIModels) Create(ctx context.Context, in domain.AIModelUpsert) (domain.AIModel, error) {
	tier := normalizeModelTier(in.Tier)
	if tier == "" {
		tier = "free"
	}
	enabled := true
	if in.IsEnabled != nil {
		enabled = *in.IsEnabled
	}
	useArena, useInsight, useMock := true, true, true
	if in.UseForArena != nil {
		useArena = *in.UseForArena
	}
	if in.UseForInsight != nil {
		useInsight = *in.UseForInsight
	}
	if in.UseForMock != nil {
		useMock = *in.UseForMock
	}
	sortOrder := 0
	if in.SortOrder != nil {
		sortOrder = *in.SortOrder
	}
	row := a.pool.QueryRow(ctx, `
		INSERT INTO llm_models (
			model_id, label, provider, tier, is_enabled,
			context_window, cost_per_1k_input_usd, cost_per_1k_output_usd,
			use_for_arena, use_for_insight, use_for_mock, sort_order
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING `+adminLLMModelCols,
		in.ModelID, in.Label, in.Provider, tier, enabled,
		in.ContextWindow, in.CostPerKInputUSD, in.CostPerKOutputUSD,
		useArena, useInsight, useMock, sortOrder)
	out, err := scanAIModel(row)
	if err != nil {
		return domain.AIModel{}, fmt.Errorf("admin.AIModels.Create: %w", err)
	}
	return out, nil
}

// Update partially updates an llm_models row identified by model_id.
func (a *AIModels) Update(ctx context.Context, modelID string, in domain.AIModelUpsert) (domain.AIModel, error) {
	tier := normalizeModelTier(in.Tier)
	row := a.pool.QueryRow(ctx, `
		UPDATE llm_models SET
		  label = COALESCE(NULLIF($2,''), label),
		  provider = COALESCE(NULLIF($3,''), provider),
		  tier = COALESCE(NULLIF($4,''), tier),
		  is_enabled = COALESCE($5, is_enabled),
		  context_window = COALESCE($6, context_window),
		  cost_per_1k_input_usd = COALESCE($7, cost_per_1k_input_usd),
		  cost_per_1k_output_usd = COALESCE($8, cost_per_1k_output_usd),
		  use_for_arena = COALESCE($9, use_for_arena),
		  use_for_insight = COALESCE($10, use_for_insight),
		  use_for_mock = COALESCE($11, use_for_mock),
		  sort_order = COALESCE($12, sort_order),
		  updated_at = now()
		WHERE model_id = $1
		RETURNING `+adminLLMModelCols,
		modelID, in.Label, in.Provider, tier, in.IsEnabled,
		in.ContextWindow, in.CostPerKInputUSD, in.CostPerKOutputUSD,
		in.UseForArena, in.UseForInsight, in.UseForMock, in.SortOrder)
	out, err := scanAIModel(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AIModel{}, domain.ErrNotFound
		}
		return domain.AIModel{}, fmt.Errorf("admin.AIModels.Update: %w", err)
	}
	return out, nil
}

func normalizeModelTier(tier string) string {
	switch tier {
	case "free", "pro", "max":
		return tier
	case "premium":
		return "pro"
	default:
		return ""
	}
}

// Toggle flips is_enabled.
func (a *AIModels) Toggle(ctx context.Context, modelID string) (domain.AIModel, error) {
	row := a.pool.QueryRow(ctx, `
		UPDATE llm_models SET is_enabled = NOT is_enabled, updated_at = now()
		WHERE model_id = $1
		RETURNING `+adminLLMModelCols, modelID)
	out, err := scanAIModel(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AIModel{}, domain.ErrNotFound
		}
		return domain.AIModel{}, fmt.Errorf("admin.AIModels.Toggle: %w", err)
	}
	return out, nil
}

// Delete removes a llm_models row.
func (a *AIModels) Delete(ctx context.Context, modelID string) error {
	tag, err := a.pool.Exec(ctx, `DELETE FROM llm_models WHERE model_id = $1`, modelID)
	if err != nil {
		return fmt.Errorf("admin.AIModels.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ListPublic serves the public /ai/models catalogue.
func (a *AIModels) ListPublic(ctx context.Context, f domain.PublicAIModelFilter) ([]domain.PublicAIModel, error) {
	const baseQuery = `
		SELECT model_id, label, provider, tier, COALESCE(is_virtual, FALSE)
		  FROM llm_models
		 WHERE is_enabled = TRUE`
	query := baseQuery
	if f.Surface != "" {
		col, ok := allowedUseSurfaces[f.Surface]
		if !ok {
			return nil, domain.ErrInvalidInput
		}
		// Column name is whitelisted via allowedUseSurfaces so direct
		// interpolation is safe — never reachable from user input.
		query += fmt.Sprintf(" AND %s = TRUE", col)
	}
	query += " ORDER BY sort_order ASC, model_id ASC LIMIT 50"

	rows, err := a.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("admin.AIModels.ListPublic: %w", err)
	}
	defer rows.Close()

	items := make([]domain.PublicAIModel, 0, 16)
	for rows.Next() {
		var (
			modelID, label, provider, tier string
			isVirtual                      bool
		)
		if err := rows.Scan(&modelID, &label, &provider, &tier, &isVirtual); err != nil {
			return nil, fmt.Errorf("admin.AIModels.ListPublic: scan: %w", err)
		}
		items = append(items, domain.PublicAIModel{
			ID:        modelID,
			Label:     label,
			Provider:  provider,
			Tier:      tier,
			Available: true,
			IsVirtual: isVirtual,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("admin.AIModels.ListPublic: rows: %w", err)
	}
	return items, nil
}

var _ domain.AIModelRepo = (*AIModels)(nil)
