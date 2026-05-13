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

.PHONY: setup
setup: ## Bootstrap local dev: install npm deps for frontend / hone / cue (run once)
	cd frontend && npm install
	cd hone && npm install
	cd cue && npm install
	@echo ""
	@echo "  Dev cheat-sheet:"
	@echo "    1. make start            # backend stack (Docker) on localhost:8080"
	@echo "    2. make front            # web on localhost:5173 (MSW mocks on by default)"
	@echo "    3. cd hone && npm run dev"
	@echo "    4. cd cue && npm run dev"
	@echo ""
	@echo "  Hone/Cue defaults already point at http://localhost:8080 in dev."
	@echo "  Override via VITE_DRUZ9_API_BASE (Hone) or DRUZ9_API_BASE_URL (Cue)."

.PHONY: dev-local
dev-local: ## Start backend stack + web frontend (Hone/Cue stay manual — they need their own terminal)
	$(MAKE) start
	@echo ""
	@echo "  Backend up. In another terminal run any of:"
	@echo "    make front                  # web on :5173"
	@echo "    cd hone && npm run dev      # Hone Electron"
	@echo "    cd cue && npm run dev       # Cue Electron"

.PHONY: stop
stop: ## Stop every container
	docker compose down

.PHONY: logs
logs: ## Tail api logs
	docker compose logs -f api

.PHONY: lint
lint: lint-go lint-ts lint-proto lint-tidy ## Mirror CI lint: Go (golangci-lint) + frontend/hone/cue (eslint+tsc) + proto (buf) + go.mod tidy drift

# CI-equivalent — same command list, same flags, same exit semantics.
# Adding `make lint` here so commits don't depend on remembering to also run
# proto/tidy. If CI catches something we don't, that's a Makefile bug.

# Parallelism defaults: use all cores, fall back to 4 if nproc missing (macOS).
# Override via `make lint-go JOBS=8`.
JOBS ?= $(shell (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4)

# List of Go modules under backend/, excluding backend/tools (out-of-workspace,
# codegen-only). Computed once so lint/test/build share the same list.
GO_MODULES = $(shell find backend -name go.mod -not -path '*/tools/*' -exec dirname {} \; | sort)

.PHONY: lint-go
lint-go: ## Run golangci-lint across all Go modules (mirrors CI sequentially within shard)
	@# Mirror of .github/workflows/ci.yml `Lint shard` step:
	@#   per module: go mod download && go build ./... && golangci-lint run.
	@#
	@# Sequential на месте, потому что:
	@#  (a) golangci-lint v1.64 держит lock на cache-dir и `parallel
	@#      golangci-lint is running` валит весь run при concurrent invocations;
	@#  (b) ci shard'ы тоже sequential внутри shard'а — разница только в том
	@#      что CI имеет 4 runner'а параллельно. Локально 1 runner = sequential.
	@#  (c) первый build греет module + lint cache; следующие модули
	@#      переиспользуют — total wall ~= 1.5–3 минуты.
	@#
	@# Не прерываемся на первой ошибке — собираем все падения сразу,
	@# чтобы не было «починил один, узнал про следующий» циклов.
	@mkdir -p .cache/golangci-lint
	@export GOLANGCI_LINT_CACHE="$(CURDIR)/.cache/golangci-lint"; \
	 fail=""; \
	 for dir in $(GO_MODULES); do \
	   echo "::group::lint $$dir"; \
	   ( cd "$$dir" && \
	     GOWORK=off GOFLAGS="" go mod download 2>/dev/null && \
	     GOWORK=off GOFLAGS="" go build ./... >/dev/null && \
	     GOWORK=off GOFLAGS="" golangci-lint run \
	       --config="$(CURDIR)/backend/.golangci.yml" --timeout=5m ./... \
	   ) || fail="$$fail $$dir"; \
	   echo "::endgroup::"; \
	 done; \
	 if [ -n "$$fail" ]; then \
	   echo ""; \
	   echo "Failed modules:$$fail"; \
	   echo "(re-run inside one to iterate: cd <mod> && golangci-lint run --config=$(CURDIR)/backend/.golangci.yml ./...)"; \
	   exit 1; \
	 fi

# JS workspaces with their own package.json + lint + typecheck scripts.
# Add a new app here once and `make lint-ts` covers it.
JS_APPS = frontend hone cue

.PHONY: lint-ts
lint-ts: ## Run ESLint + tsc on every JS app (frontend, hone, cue)
	@# Per-app: пытаемся lint (если eslint установлен) + typecheck (всегда).
	@# Не прерываем на первой ошибке — хотим увидеть все падения сразу.
	@failed=""; \
	for app in $(JS_APPS); do \
		if [ ! -f "$$app/package.json" ]; then continue; fi; \
		if [ ! -d "$$app/node_modules" ]; then \
			echo "→ skip $$app (no node_modules — run 'cd $$app && npm install')"; \
			continue; \
		fi; \
		echo "→ $$app: typecheck"; \
		( cd "$$app" && npm run typecheck --silent ) || failed="$$failed $$app(tsc)"; \
		if [ -x "$$app/node_modules/.bin/eslint" ]; then \
			echo "→ $$app: eslint"; \
			( cd "$$app" && npm run lint --silent ) || failed="$$failed $$app(eslint)"; \
		else \
			echo "→ $$app: eslint not installed, skipping (lint script present but eslint missing in deps)"; \
		fi; \
	done; \
	if [ -n "$$failed" ]; then \
		echo ""; \
		echo "Failed:$$failed"; \
		exit 1; \
	fi

.PHONY: lint-proto
lint-proto: ## Run `buf lint` over proto/ (mirrors CI proto-lint job)
	@# CI uses bufbuild/buf-action; локально build buf из tools и зовём lint.
	@# Tolerant: если buf не построен — вернёт код инструмента, не Makefile'а.
	@if [ ! -x bin/buf ]; then \
		echo "→ building bin/buf"; \
		(cd backend/tools && GOWORK=off go build -o ../../bin/buf github.com/bufbuild/buf/cmd/buf); \
	fi
	@cd proto && PATH="$(CURDIR)/bin:$$PATH" $(CURDIR)/bin/buf lint

.PHONY: lint-tidy
lint-tidy: ## Fail if `go mod tidy` would touch any go.mod/go.sum (CI guard, no network)
	@# Snapshot текущего состояния → tidy всё подряд → diff. Вместо запуска
	@# tidy которая проверяет github + кэш (медленно и сетево), используем
	@# trick: GOPROXY=off и GOFLAGS=-mod=readonly — go быстро отвергает любой
	@# дрейф без сетевых вызовов. CI запускает реальный tidy (см. tidy-check),
	@# но локально оптимизируем.
	@for mod in $(GO_MODULES); do \
		(cd "$$mod" && GOFLAGS="-mod=readonly" go build ./... >/dev/null 2>&1) \
			|| { echo "drift in $$mod — run 'make tidy'"; exit 1; }; \
	done
	@echo "→ tidy clean (all $$(echo '$(GO_MODULES)' | wc -w) modules)"

.PHONY: test
test: test-go test-ts ## Run all tests

.PHONY: test-go
test-go: ## Run Go tests with race detector (parallel, per-module)
	@printf '%s\n' $(GO_MODULES) | xargs -P $(JOBS) -I{} bash -c '\
	  set -e; \
	  cd "{}"; \
	  echo "→ test {}"; \
	  GOFLAGS="" go test -race -count=1 ./...'

.PHONY: test-ts
test-ts: ## Run frontend tests
	cd frontend && npm test -- --run

.PHONY: build
build: ## Build backend + frontend
	cd frontend && npm run build
	cd backend && go build -o ../bin/monolith ./cmd/monolith

.PHONY: tidy
tidy: ## Run `go mod tidy` in every Go module (go.work + backend/tools)
	@# Source-of-truth list: each go.mod under backend/. We discover them
	@# dynamically so adding a new service doesn't require touching this
	@# target. backend/tools is OUT of the workspace (see go.work) but
	@# still needs tidy when its codegen deps drift.
	@# Continue on per-module failures (e.g. flaky proxy) so a single
	@# broken module doesn't block tidying the other 25; collect failures
	@# and exit non-zero at the end so CI still catches them.
	@failed=""; \
	for mod in $$(find backend -name go.mod -not -path '*/node_modules/*' | sort); do \
		dir=$$(dirname $$mod); \
		printf "→ tidy %s ... " "$$dir"; \
		if [ "$$dir" = "backend/tools" ]; then \
			(cd $$dir && GOWORK=off go mod tidy) >/dev/null 2>&1 \
				&& echo "ok" || { echo "FAIL"; failed="$$failed $$dir"; }; \
		else \
			(cd $$dir && go mod tidy) >/dev/null 2>&1 \
				&& echo "ok" || { echo "FAIL"; failed="$$failed $$dir"; }; \
		fi; \
	done; \
	if [ -n "$$failed" ]; then \
		echo ""; \
		echo "Failed modules:$$failed"; \
		echo "(re-run inside each dir to see the error — usually a goproxy hiccup)"; \
		exit 1; \
	fi

.PHONY: tidy-check
tidy-check: tidy ## Fail if `go mod tidy` produced changes (CI guard)
	@git diff --exit-code -- '**/go.mod' '**/go.sum' \
		|| (echo "go.mod/go.sum drifted — run 'make tidy' and commit" && exit 1)

.PHONY: generate
generate: gen-proto gen-sqlc gen-mocks gen-ts ## Run all code generators

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
	# Pre-build mockgen из backend/tools/ — там у него полный go.sum.
	# Сервисные go.mod не имеют transitive deps mockgen'а (golang.org/x/mod,
	# golang.org/x/tools), поэтому `go run` из сервиса валится; pre-built
	# bin/mockgen в PATH решает это раз и навсегда.
	cd backend/tools && GOWORK=off go build -o ../../bin/mockgen go.uber.org/mock/mockgen
	# go generate должен запускаться ВНУТРИ Go-модуля. backend/ — не модуль
	# (модули — services/<svc>/), поэтому cd внутрь каждого сервиса перед запуском.
	# List is auto-detected: any services/<svc>/{domain,app}/*.go containing
	# //go:generate. Adding a new service with a //go:generate directive
	# is enough — no Makefile edit needed.
	@for svc in $$(grep -rl --include='*.go' '^//go:generate' backend/services/*/domain/ backend/services/*/app/ 2>/dev/null | sed -E 's|backend/services/([^/]+)/.*|\1|' | sort -u); do \
		echo "==> $$svc"; \
		(cd backend/services/$$svc && PATH="$(CURDIR)/bin:$$PATH" GOWORK=off GOFLAGS= go generate ./domain/... ./app/...) \
			|| (echo "FAILED: $$svc" && exit 1); \
	done

.PHONY: gen-check
gen-check: generate ## Fail if codegen output drifted from committed files (CI)
	@git diff --exit-code -- backend/shared/generated backend/services/*/infra/db backend/services/*/domain/mocks frontend/src/api/generated \
		|| (echo "codegen drift — run 'make generate' and commit" && exit 1)

.PHONY: tokens
tokens: ## Regenerate cross-app design tokens (motion + focus + density + typography) from design/tokens/source.mjs
	@node design/tokens/emit.mjs

.PHONY: regen-speaking-tts
regen-speaking-tts: ## Bulk-regenerate reference TTS audio for speaking_exercises (admin one-shot)
	# Phase K Wave 9 — requires POSTGRES_DSN + CLOUDFLARE_API_KEY +
	# CLOUDFLARE_ACCOUNT_ID + MINIO_* envs. By default skips rows that
	# already have audio_url; pass FORCE=1 to overwrite.
	@cd backend/cmd/regen_speaking_tts && go run . $(if $(FORCE),--force) $(if $(ID),--id $(ID))

.PHONY: check-fixed-widths
check-fixed-widths: ## Lint advisory — flag NEW inline `width: NNNpx` without min/max (responsive-rule guard)
	@tools/check-fixed-widths.sh

.PHONY: tokens-check
tokens-check: tokens ## Fail if `make tokens` produced changes (CI guard for design-token + shared lib drift)
	@git diff --exit-code -- \
		'frontend/src/styles/_tokens.generated.css' 'frontend/src/lib/design-tokens.ts' \
		'frontend/src/lib/focus-trap.ts' 'frontend/src/hooks/useFocusTrap.ts' \
		'frontend/src/components/a11y/VisuallyHidden.tsx' 'frontend/src/components/a11y/LiveRegion.tsx' \
		'hone/src/renderer/src/styles/_tokens.generated.css' 'hone/src/renderer/src/lib/design-tokens.ts' \
		'hone/src/renderer/src/lib/focus-trap.ts' 'hone/src/renderer/src/hooks/useFocusTrap.ts' \
		'hone/src/renderer/src/components/a11y/VisuallyHidden.tsx' 'hone/src/renderer/src/components/a11y/LiveRegion.tsx' \
		'cue/src/renderer/styles/_tokens.generated.css' 'cue/src/renderer/lib/design-tokens.ts' \
		'cue/src/renderer/lib/focus-trap.ts' 'cue/src/renderer/hooks/useFocusTrap.ts' \
		'cue/src/renderer/components/a11y/VisuallyHidden.tsx' 'cue/src/renderer/components/a11y/LiveRegion.tsx' \
		|| (echo "design-tokens drift — run 'make tokens' and commit" && exit 1)

.PHONY: migrate-up
migrate-up: ## Apply all pending migrations
	goose -dir $(MIGRATIONS_DIR) postgres "$(GOOSE_DSN)" up

.PHONY: migrate-down
migrate-down: ## Roll back last migration
	goose -dir $(MIGRATIONS_DIR) postgres "$(GOOSE_DSN)" down

.PHONY: migrate-status
migrate-status: ## Show migration status
	goose -dir $(MIGRATIONS_DIR) postgres "$(GOOSE_DSN)" status

.PHONY: migrate-new
migrate-new: ## Create a new migration with auto-incremented unique number. Usage: make migrate-new NAME=add_foo_table
	@if [ -z "$(NAME)" ]; then echo "Usage: make migrate-new NAME=<snake_name>"; exit 1; fi
	@LAST=$$(ls $(MIGRATIONS_DIR)/[0-9]*.sql 2>/dev/null | sed -E 's|.*/0*([0-9]+)_.*|\1|' | sort -n | tail -1); \
	 NEXT=$$(printf "%05d" $$((LAST + 1))); \
	 FILE="$(MIGRATIONS_DIR)/$${NEXT}_$(NAME).sql"; \
	 if [ -f "$$FILE" ]; then echo "$$FILE already exists"; exit 1; fi; \
	 printf -- "-- +goose Up\n-- +goose StatementBegin\n\n-- +goose StatementEnd\n\n-- +goose Down\n-- +goose StatementBegin\nSELECT 1;\n-- +goose StatementEnd\n" > $$FILE; \
	 echo "created $$FILE"

.PHONY: seed
seed: ## Load seed data (tasks, companies)
	cd backend && go run ./scripts/seed

.PHONY: seed-english
seed-english: ## Phase K Wave 9 — seed Sergey-curated English content на eng_* atlas nodes (idempotent merge by URL)
	cd backend/cmd/seed_english_resources && PG_DSN="postgres://druz9:druz9@localhost:5432/druz9?sslmode=disable" go run .

.PHONY: check-stubs
check-stubs: ## Warn about STUB comments (CI advisory)
	@grep -rn "// STUB:" backend frontend/src || echo "no STUB comments found"

.PHONY: eval-coach
eval-coach: ## Phase 5 — run offline eval over coach brief parser/sanitizer (no LLM calls)
	cd backend/services/intelligence && go run ./cmd/eval_coach -dataset cmd/eval_coach/dataset.json

.PHONY: eval-ai
eval-ai: ## Phase 1.7f — run offline eval over learning-companion AI tasks (next_action / fork_analysis / curate_resource)
	cd backend/services/intelligence && go run ./cmd/eval_ai -dir cmd/eval_ai

.PHONY: cue-install
cue-install: ## Install Cue app npm dependencies
	cd cue && npm install

.PHONY: cue-dev
cue-dev: ## Run Cue in dev mode (requires backend running separately)
	cd cue && npm run dev

.PHONY: cue-build
cue-build: ## Build Cue .app and .dmg for macOS
	cd cue && npm run build:mac

.PHONY: cue-typecheck
cue-typecheck: ## Type-check Cue (renderer + main)
	cd cue && npm run typecheck

.PHONY: cursor-helper-build
cursor-helper-build: ## Build the Swift CursorHelper binary + stage into resources/
	cd cue/native/CursorHelper && swift build -c release
	mkdir -p cue/resources/native
	cp cue/native/CursorHelper/.build/release/CursorHelper cue/resources/native/

.PHONY: cue-build-masquerade
cue-build-masquerade: ## Build alt-branded .dmgs (Notes/Telegram/Xcode/Slack)
	cd cue && node scripts/build-masquerade.mjs
