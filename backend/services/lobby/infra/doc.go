// Package infra is intentionally empty for the Custom-Lobby bounded context.
//
// Per the cohort precedent (see ../../cohort/infra/doc.go), the small Postgres
// adapter for lobby lives in cmd/monolith/services/lobby.go alongside its chi
// handlers — pulling pgx into lobby/go.mod would double the dependency
// surface for negligible gain. The use cases under ../app stay pure (only
// need a domain.Repo) and remain unit-testable with the mock implementations
// under ../app/usecases_test.go.
//
// If this service ever needs to be split into its own process, this is the
// file to delete first; the Postgres adapter then moves here verbatim.
package infra
