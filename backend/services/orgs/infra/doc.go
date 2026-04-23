// Package infra will host the Postgres adapter for the orgs bounded
// context against migration 00027_orgs.sql.
//
// STRATEGIC SCAFFOLD: empty by design. The first implementation session
// will add `postgres.go` with sqlc-generated queries and a `NewPostgres`
// constructor matching the established profile/guild/season pattern.
//
// See backend/services/orgs/README.md for the next-session checklist.
package infra
