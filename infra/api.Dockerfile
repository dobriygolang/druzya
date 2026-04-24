# syntax=docker/dockerfile:1.7-labs
# API-образ: только Go-монолит. Фронт собирается отдельно
# (см. infra/web.Dockerfile → ghcr.io/.../druz9-web).
#
# BuildKit >=1.4 cache mounts are used for GOMODCACHE and GOCACHE so that
# consecutive builds reuse downloaded modules + compiled packages without
# requiring a separately cached layer. This dramatically cuts cold-start
# builds on CI runners where the actions/cache entry is gone.
FROM golang:1.25-alpine AS build
WORKDIR /src

RUN apk add --no-cache git ca-certificates

# ── Layer 1: dependency manifests only. Changes to any .go file don't bust
# this layer, so `go mod download` runs once per go.sum change. We copy
# each go.mod / go.sum explicitly to keep the dependency-only layer tight.
COPY go.work go.work.sum* ./
# Copying backend/**/go.{mod,sum} via a single glob into the tree — Dockerfile
# COPY with --parents (BuildKit 1.7+) preserves directory structure.
COPY --parents backend/**/go.mod backend/**/go.sum ./

# Pre-fetch modules using BuildKit cache mount. The mount persists across
# builds on the same runner; the COPY above still invalidates the layer
# when any go.sum changes, which is the correct trigger for re-download.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go work sync

# ── Layer 2: source code. This is what changes on every PR.
COPY backend ./backend

# Build with cache mounts so incremental rebuilds reuse compiled package
# objects from the previous build of the same monolith.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/monolith ./backend/cmd/monolith

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/monolith /app/monolith
# Миграции лежат рядом с бинарём — subcommand `monolith migrate up` ищет их
# в /app/migrations (см. backend/cmd/monolith/migrate.go).
COPY backend/migrations /app/migrations
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/app/monolith"]
