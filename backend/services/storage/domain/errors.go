// Package domain holds the storage bounded context's entities, repository
// interfaces and sentinel errors. Pure Go — no infrastructure imports.
package domain

import "errors"

// ErrNotFound is returned when an archive/restore target row does not exist
// (or does not belong to the caller). Infra-слой маппит pgx.ErrNoRows и
// ноль-affected-rows сюда; HTTP-слой превращает в 404.
var ErrNotFound = errors.New("storage: not found")
