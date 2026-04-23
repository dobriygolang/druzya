// Package ports is intentionally empty for the Custom-Lobby bounded context.
//
// Per the same rationale as ./infra/doc.go, REST handlers live in
// cmd/monolith/services/lobby.go where chi + pgx are already on the import
// list. Lobby surfaces eight chi-direct REST endpoints — proto + Connect
// would be heavier than the wire format deserves.
package ports
