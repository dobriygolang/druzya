// llmchain_config.go — thin re-export wrapper.
package admin

import (
	adminInfra "druz9/admin/infra"

	"github.com/jackc/pgx/v5/pgxpool"
)

// llmConfigSource is now a type alias to the admin-domain implementation.
type llmConfigSource = adminInfra.LLMChainConfig

// newLLMConfigSource — конструктор. Delegates to adminInfra.
func newLLMConfigSource(pool *pgxpool.Pool) *llmConfigSource {
	return adminInfra.NewLLMChainConfig(pool)
}
