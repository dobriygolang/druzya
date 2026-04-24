package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/shared/pkg/llmchain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// llmConfigSource — Postgres-реализация llmchain.ConfigSource. Singleton
// строка в llm_runtime_config (id=1). JSONB поля сериализуем/десериализуем
// ручками — тут простые map'ы, sqlc generic-не выгоден.
type llmConfigSource struct {
	pool *pgxpool.Pool
}

// newLLMConfigSource — конструктор.
func newLLMConfigSource(pool *pgxpool.Pool) *llmConfigSource {
	return &llmConfigSource{pool: pool}
}

// Load читает singleton row и парсит JSONB поля в typed llmchain-структуры.
// ErrNoRows (свежая БД без INSERT через миграцию) → возвращает пустой
// RuntimeConfig чтобы loader просто не обновлял snapshot.
func (s *llmConfigSource) Load(ctx context.Context) (*llmchain.RuntimeConfig, error) {
	const q = `
        SELECT version, chain_order, task_map, virtual_chains
          FROM llm_runtime_config
         WHERE id = 1`
	var (
		version     int64
		chainOrder  []string
		taskMapJSON []byte
		virtualJSON []byte
	)
	err := s.pool.QueryRow(ctx, q).Scan(&version, &chainOrder, &taskMapJSON, &virtualJSON)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &llmchain.RuntimeConfig{}, nil
		}
		return nil, fmt.Errorf("llmchain.cfg.Load: %w", err)
	}

	cfg := &llmchain.RuntimeConfig{
		Version: version,
	}
	for _, p := range chainOrder {
		cfg.ChainOrder = append(cfg.ChainOrder, llmchain.Provider(p))
	}

	if len(taskMapJSON) > 0 && string(taskMapJSON) != "{}" {
		// JSON shape: {"task_name":{"provider":"model_id",...}}
		raw := map[string]map[string]string{}
		if jerr := json.Unmarshal(taskMapJSON, &raw); jerr != nil {
			return nil, fmt.Errorf("llmchain.cfg.Load: task_map decode: %w", jerr)
		}
		cfg.TaskMap = make(llmchain.TaskModelMap, len(raw))
		for task, inner := range raw {
			byProv := make(map[llmchain.Provider]string, len(inner))
			for prov, model := range inner {
				byProv[llmchain.Provider(prov)] = model
			}
			cfg.TaskMap[llmchain.Task(task)] = byProv
		}
	}

	if len(virtualJSON) > 0 && string(virtualJSON) != "{}" {
		// JSON shape: {"druz9/pro":[{"provider":"groq","model":"..."},...]}
		raw := map[string][]struct {
			Provider string `json:"provider"`
			Model    string `json:"model"`
		}{}
		if jerr := json.Unmarshal(virtualJSON, &raw); jerr != nil {
			return nil, fmt.Errorf("llmchain.cfg.Load: virtual_chains decode: %w", jerr)
		}
		cfg.VirtualChains = make(map[string][]llmchain.VirtualCandidate, len(raw))
		for virt, chain := range raw {
			out := make([]llmchain.VirtualCandidate, 0, len(chain))
			for _, step := range chain {
				out = append(out, llmchain.VirtualCandidate{
					Provider: llmchain.Provider(step.Provider),
					Model:    step.Model,
				})
			}
			cfg.VirtualChains[virt] = out
		}
	}
	return cfg, nil
}

// Save — optimistic lock через expectedVersion. UPDATE ... WHERE version=expected,
// если 0 rows affected → конфликт (админ работал на stale-view → 409).
func (s *llmConfigSource) Save(ctx context.Context, cfg *llmchain.RuntimeConfig, expectedVersion int64) error {
	chainOrder := make([]string, 0, len(cfg.ChainOrder))
	for _, p := range cfg.ChainOrder {
		chainOrder = append(chainOrder, string(p))
	}

	taskMapRaw := map[string]map[string]string{}
	for task, inner := range cfg.TaskMap {
		byProv := make(map[string]string, len(inner))
		for prov, model := range inner {
			byProv[string(prov)] = model
		}
		taskMapRaw[string(task)] = byProv
	}
	taskMapJSON, err := json.Marshal(taskMapRaw)
	if err != nil {
		return fmt.Errorf("llmchain.cfg.Save: task_map encode: %w", err)
	}

	virtualRaw := map[string][]struct {
		Provider string `json:"provider"`
		Model    string `json:"model"`
	}{}
	for virt, chain := range cfg.VirtualChains {
		steps := make([]struct {
			Provider string `json:"provider"`
			Model    string `json:"model"`
		}, 0, len(chain))
		for _, c := range chain {
			steps = append(steps, struct {
				Provider string `json:"provider"`
				Model    string `json:"model"`
			}{Provider: string(c.Provider), Model: c.Model})
		}
		virtualRaw[virt] = steps
	}
	virtualJSON, err := json.Marshal(virtualRaw)
	if err != nil {
		return fmt.Errorf("llmchain.cfg.Save: virtual_chains encode: %w", err)
	}

	const q = `
        UPDATE llm_runtime_config
           SET version        = version + 1,
               chain_order    = $1,
               task_map       = $2::jsonb,
               virtual_chains = $3::jsonb,
               updated_at     = $4
         WHERE id = 1 AND version = $5`
	tag, err := s.pool.Exec(ctx, q, chainOrder, taskMapJSON, virtualJSON, time.Now().UTC(), expectedVersion)
	if err != nil {
		return fmt.Errorf("llmchain.cfg.Save: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("llmchain.cfg.Save: version conflict (expected %d)", expectedVersion)
	}
	return nil
}

// Compile-time assertion.
var _ llmchain.ConfigSource = (*llmConfigSource)(nil)
