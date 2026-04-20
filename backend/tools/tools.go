//go:build tools
// +build tools

// Package tools pins the versions of codegen binaries used across the repo.
// Invoke via `go run` from this module — e.g.
//
//	cd backend/tools && go run github.com/sqlc-dev/sqlc/cmd/sqlc ...
//
// TypeScript codegen plugins for the proto contract (protoc-gen-es,
// protoc-gen-connect-es) are pinned in frontend/package.json devDeps and
// invoked from frontend/node_modules/.bin via buf.gen.yaml.
//
// oapi-codegen has been retired: every domain is now served by Connect-RPC
// out of proto/druz9/v1/*.proto. See docs/contract-first-with-buf.md for
// the full pipeline.
package tools

import (
	// SQL → typed Go queries (per-domain).
	_ "github.com/sqlc-dev/sqlc/cmd/sqlc"

	// Mock generator (from //go:generate directives in domain/ repos).
	_ "go.uber.org/mock/mockgen"

	// ── Proto / Connect-RPC codegen pipeline ──
	// Buf CLI drives linting + generation via proto/buf.yaml + proto/buf.gen.yaml.
	_ "github.com/bufbuild/buf/cmd/buf"
	// Core protobuf Go message codegen.
	_ "google.golang.org/protobuf/cmd/protoc-gen-go"
	// Connect-RPC server/client Go codegen.
	_ "connectrpc.com/connect/cmd/protoc-gen-connect-go"
)
