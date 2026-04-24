module druz9/cmd/monolith

go 1.25.0

require (
	connectrpc.com/vanguard v0.3.0
	druz9/achievements v0.0.0-00010101000000-000000000000
	druz9/admin v0.0.0-00010101000000-000000000000
	druz9/ai_mock v0.0.0-00010101000000-000000000000
	druz9/ai_native v0.0.0-00010101000000-000000000000
	druz9/arena v0.0.0-00010101000000-000000000000
	druz9/auth v0.0.0-00010101000000-000000000000
	druz9/cohort v0.0.0-00010101000000-000000000000
	druz9/copilot v0.0.0-00010101000000-000000000000
	druz9/daily v0.0.0-00010101000000-000000000000
	druz9/editor v0.0.0-00010101000000-000000000000
	druz9/feed v0.0.0-00010101000000-000000000000
	druz9/friends v0.0.0-00010101000000-000000000000
	druz9/guild v0.0.0-00010101000000-000000000000
	druz9/lobby v0.0.0-00010101000000-000000000000
	druz9/notify v0.0.0-00010101000000-000000000000
	druz9/podcast v0.0.0-00010101000000-000000000000
	druz9/profile v0.0.0-00010101000000-000000000000
	druz9/rating v0.0.0-00010101000000-000000000000
	druz9/review v0.0.0-00010101000000-000000000000
	druz9/season v0.0.0-00010101000000-000000000000
	druz9/shared v0.0.0
	druz9/slot v0.0.0-00010101000000-000000000000
	druz9/vacancies v0.0.0-00010101000000-000000000000
	github.com/go-chi/chi/v5 v5.2.5
	github.com/google/uuid v1.6.0
	github.com/jackc/pgx/v5 v5.9.2
	github.com/redis/go-redis/v9 v9.6.1
	golang.org/x/crypto v0.50.0
)

require (
	connectrpc.com/connect v1.19.2 // indirect
	github.com/beorn7/perks v1.0.1 // indirect
	github.com/cenkalti/backoff/v4 v4.3.0 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/dgryski/go-rendezvous v0.0.0-20200823014737-9f7001d12a5f // indirect
	github.com/gabriel-vasile/mimetype v1.4.3 // indirect
	github.com/go-logr/logr v1.4.3 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/go-playground/locales v0.14.1 // indirect
	github.com/go-playground/universal-translator v0.18.1 // indirect
	github.com/go-playground/validator/v10 v10.22.0 // indirect
	github.com/go-telegram-bot-api/telegram-bot-api/v5 v5.5.1 // indirect
	github.com/golang-jwt/jwt/v5 v5.2.1 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/grpc-ecosystem/grpc-gateway/v2 v2.22.0 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/klauspost/compress v1.17.9 // indirect
	github.com/leodido/go-urn v1.4.0 // indirect
	github.com/mfridman/interpolate v0.0.2 // indirect
	github.com/munnerz/goautoneg v0.0.0-20191010083416-a7dc8b61c822 // indirect
	github.com/pressly/goose/v3 v3.19.2 // indirect
	github.com/prometheus/client_golang v1.20.5 // indirect
	github.com/prometheus/client_model v0.6.1 // indirect
	github.com/prometheus/common v0.55.0 // indirect
	github.com/prometheus/procfs v0.15.1 // indirect
	github.com/sethvargo/go-retry v0.2.4 // indirect
	go.opentelemetry.io/auto/sdk v1.2.1 // indirect
	go.opentelemetry.io/otel v1.39.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace v1.30.0 // indirect
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.30.0 // indirect
	go.opentelemetry.io/otel/metric v1.39.0 // indirect
	go.opentelemetry.io/otel/sdk v1.39.0 // indirect
	go.opentelemetry.io/otel/trace v1.39.0 // indirect
	go.opentelemetry.io/proto/otlp v1.3.1 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	golang.org/x/net v0.53.0 // indirect
	golang.org/x/sync v0.20.0 // indirect
	golang.org/x/sys v0.43.0 // indirect
	golang.org/x/text v0.36.0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20260414002931-afd174a4e478 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260414002931-afd174a4e478 // indirect
	google.golang.org/grpc v1.79.3 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)

replace druz9/shared => ../../shared

replace druz9/auth => ../../services/auth

replace druz9/profile => ../../services/profile

replace druz9/daily => ../../services/daily

replace druz9/rating => ../../services/rating

replace druz9/arena => ../../services/arena

replace druz9/ai_mock => ../../services/ai_mock

replace druz9/notify => ../../services/notify

replace druz9/feed => ../../services/feed

replace druz9/guild => ../../services/guild

replace druz9/ai_native => ../../services/ai_native

replace druz9/slot => ../../services/slot

replace druz9/editor => ../../services/editor

replace druz9/season => ../../services/season

replace druz9/podcast => ../../services/podcast

replace druz9/admin => ../../services/admin

replace druz9/vacancies => ../../services/vacancies

replace druz9/achievements => ../../services/achievements

replace druz9/friends => ../../services/friends

replace druz9/cohort => ../../services/cohort

replace druz9/copilot => ../../services/copilot

replace druz9/lobby => ../../services/lobby

replace druz9/review => ../../services/review
