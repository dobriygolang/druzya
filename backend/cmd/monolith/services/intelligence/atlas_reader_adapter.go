// atlas_reader_adapter.go — thin wiring shim. The real adapter +
// scoring heuristic live in druz9/intelligence/infra.AtlasReaderAdapter,
// alongside the rest of the postgres readers for this service.
package intelligence

import (
	intelApp "druz9/intelligence/app"
	intelInfra "druz9/intelligence/infra"

	"github.com/jackc/pgx/v5/pgxpool"
)

// newAtlasReaderAdapter wires the infra adapter into the bootstrap.
func newAtlasReaderAdapter(pool *pgxpool.Pool) intelApp.AtlasReader {
	return intelInfra.NewAtlasReaderAdapter(pool)
}
