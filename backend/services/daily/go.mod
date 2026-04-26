module druz9/daily

go 1.25.0

require (
	connectrpc.com/connect v1.19.2
	druz9/shared v0.0.0
	github.com/go-playground/validator/v10 v10.22.0
	github.com/google/uuid v1.6.0
	github.com/jackc/pgx/v5 v5.9.2
	github.com/redis/go-redis/v9 v9.6.1
	go.uber.org/mock v0.6.0
	golang.org/x/sync v0.20.0
)

require google.golang.org/genproto/googleapis/api v0.0.0-20260414002931-afd174a4e478 // indirect

require (
	github.com/beorn7/perks v1.0.1 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/dgryski/go-rendezvous v0.0.0-20200823014737-9f7001d12a5f // indirect
	github.com/gabriel-vasile/mimetype v1.4.3 // indirect
	github.com/go-chi/chi/v5 v5.2.5 // indirect
	github.com/go-playground/locales v0.14.1 // indirect
	github.com/go-playground/universal-translator v0.18.1 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/klauspost/compress v1.17.9 // indirect
	github.com/leodido/go-urn v1.4.0 // indirect
	github.com/munnerz/goautoneg v0.0.0-20191010083416-a7dc8b61c822 // indirect
	github.com/prometheus/client_golang v1.20.5 // indirect
	github.com/prometheus/client_model v0.6.1 // indirect
	github.com/prometheus/common v0.55.0 // indirect
	github.com/prometheus/procfs v0.15.1 // indirect
	golang.org/x/crypto v0.50.0 // indirect
	golang.org/x/net v0.53.0 // indirect
	golang.org/x/sys v0.43.0 // indirect
	golang.org/x/text v0.36.0 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
)

replace druz9/shared => ../../shared
