.DEFAULT_GOAL := help
SHELL := /bin/bash

GOOSE_DSN ?= host=localhost port=5432 user=druz9 password=druz9 dbname=druz9 sslmode=disable
MIGRATIONS_DIR := backend/migrations

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: start
start: ## Run backend stack: deps up → migrations → api (postgres, redis, minio, clickhouse, judge0)
	docker compose up -d postgres redis minio clickhouse judge0-db judge0-redis
	@echo ""
	@echo "  waiting for postgres to be ready..."
	@until docker compose exec -T postgres pg_isready -U druz9 -d druz9 >/dev/null 2>&1; do sleep 1; done
	@echo "  postgres ready, applying migrations..."
	GOWORK=off go run github.com/pressly/goose/v3/cmd/goose@v3.19.2 -dir $(MIGRATIONS_DIR) postgres "host=localhost port=5432 user=druz9 password=druz9 dbname=druz9 sslmode=disable" up
	docker compose up --build -d api judge0-server judge0-workers
	@echo ""
	@echo "  Backend is up:"
	@echo "    API         http://localhost:8080"
	@echo "    /health     http://localhost:8080/health"
	@echo "    /ws/feed    ws://localhost:8080/ws/feed  (public, no auth)"
	@echo "    MinIO UI    http://localhost:9001"
	@echo ""
	@echo "  Logs:  make logs"
	@echo "  Stop:  make stop"

.PHONY: front
front: ## Run frontend natively (MSW mocks enabled by default)
	cd frontend && VITE_USE_MSW=true npm run dev -- --host

.PHONY: dev
dev: ## Run the full stack (backend + frontend) in docker
	docker compose up --build

.PHONY: stop
stop: ## Stop every container
	docker compose down

.PHONY: logs
logs: ## Tail api logs
	docker compose logs -f api

.PHONY: lint
lint: lint-go lint-ts ## Run all linters

.PHONY: lint-go
lint-go: ## Run golangci-lint across all Go modules
	cd backend && golangci-lint run ./...

.PHONY: lint-ts
lint-ts: ## Run ESLint + tsc on frontend
	cd frontend && npm run lint && npm run typecheck

.PHONY: test
test: test-go test-ts ## Run all tests

.PHONY: test-go
test-go: ## Run Go tests with race detector
	cd backend && go test -race ./...

.PHONY: test-ts
test-ts: ## Run frontend tests
	cd frontend && npm test -- --run

.PHONY: build
build: ## Build backend + frontend
	cd frontend && npm run build
	cd backend && go build -o ../bin/monolith ./cmd/monolith

.PHONY: gen
gen: gen-proto gen-sqlc gen-mocks gen-ts ## Run all code generators

.PHONY: gen-proto
gen-proto: ## Generate Go + TS stubs from proto/*.proto via buf (all 14 services)
	@# Buf CLI + Go plugins come from backend/tools module; TS plugins come from frontend node_modules.
	cd backend/tools && GOWORK=off go build -o ../../bin/buf github.com/bufbuild/buf/cmd/buf
	cd backend/tools && GOWORK=off go build -o ../../bin/protoc-gen-go google.golang.org/protobuf/cmd/protoc-gen-go
	cd backend/tools && GOWORK=off go build -o ../../bin/protoc-gen-connect-go connectrpc.com/connect/cmd/protoc-gen-connect-go
	cd proto && PATH="$(CURDIR)/bin:$$PATH" GOWORK=off ../bin/buf generate

.PHONY: gen-ts
gen-ts: ## Generate TypeScript types for frontend from OpenAPI
	# Tolerant: если openapi-spec отсутствует — пропускаем без падения.
	# Спека пока stub (см. docs/legacy/openapi-v1.yaml). Когда переедем
	# на полноценную OpenAPI из бэка — таргет начнёт реально что-то генерировать.
	@if [ -f docs/legacy/openapi-v1.yaml ]; then \
		cd frontend && npm run gen:api; \
	else \
		echo "skip gen-ts: docs/legacy/openapi-v1.yaml not found"; \
	fi

.PHONY: gen-sqlc
gen-sqlc: ## Generate sqlc typed queries per-domain
	cd backend/tools && GOWORK=off go build -o ../../bin/sqlc github.com/sqlc-dev/sqlc/cmd/sqlc
	cd backend && ../bin/sqlc generate

.PHONY: gen-mocks
gen-mocks: ## Generate mockgen mocks from //go:generate directives
	# go generate должен запускаться ВНУТРИ Go-модуля. backend/ — не модуль
	# (модули — services/<svc>/), поэтому cd внутрь каждого сервиса перед запуском.
	@for svc in auth profile daily rating arena ai_mock ai_native editor guild season notify slot podcast admin feed; do \
		[ -d "backend/services/$$svc/domain" ] && \
			(cd backend/services/$$svc && GOWORK=off GOFLAGS= go generate ./domain/...) \
			|| true; \
	done

.PHONY: gen-check
gen-check: gen ## Fail if codegen output drifted from committed files (CI)
	@git diff --exit-code -- backend/shared/generated backend/services/*/infra/db backend/services/*/domain/mocks frontend/src/api/generated \
		|| (echo "codegen drift — run 'make gen' and commit" && exit 1)

.PHONY: migrate-up
migrate-up: ## Apply all pending migrations
	goose -dir $(MIGRATIONS_DIR) postgres "$(GOOSE_DSN)" up

.PHONY: migrate-down
migrate-down: ## Roll back last migration
	goose -dir $(MIGRATIONS_DIR) postgres "$(GOOSE_DSN)" down

.PHONY: migrate-status
migrate-status: ## Show migration status
	goose -dir $(MIGRATIONS_DIR) postgres "$(GOOSE_DSN)" status

.PHONY: seed
seed: ## Load seed data (tasks, companies)
	cd backend && go run ./scripts/seed

.PHONY: check-stubs
check-stubs: ## Warn about STUB comments (CI advisory)
	@grep -rn "// STUB:" backend frontend/src || echo "no STUB comments found"
