// Subcommand `migrate` для бинаря monolith. Используется compose-сервисом
// `migrate` в проде: `docker compose run --rm migrate` ровно один раз
// прокатывает все pending-миграции по тому же POSTGRES_DSN, что и API,
// и завершается с кодом 0/1.
//
// Поддерживаемые формы:
//
//	monolith migrate up        — применить все pending
//	monolith migrate down      — откатить последнюю
//	monolith migrate status    — показать состояние
//	monolith migrate redo      — откатить и заново применить последнюю
//
// Источник миграций — каталог /app/migrations внутри образа (см. api.Dockerfile,
// строка `COPY backend/migrations /app/migrations`). Локально путь
// переопределяется флагом MIGRATIONS_DIR.
package main

import (
	"context"
	"database/sql"
	"log/slog"
	"os"

	"druz9/shared/pkg/config"

	_ "github.com/jackc/pgx/v5/stdlib" // database/sql драйвер pgx — нужен goose
	"github.com/pressly/goose/v3"
)

// runMigrate выполняется ДО bootstrap.New, поэтому никакие модули и Redis
// не поднимаются. Падаем сразу — миграции должны быть детерминированы.
func runMigrate(args []string) {
	if len(args) == 0 {
		args = []string{"up"}
	}
	cmd := args[0]

	cfg, err := config.Load()
	if err != nil {
		slog.Error("migrate: config load failed", "err", err)
		os.Exit(1)
	}

	dir := os.Getenv("MIGRATIONS_DIR")
	if dir == "" {
		dir = "/app/migrations"
	}

	db, err := sql.Open("pgx", cfg.PostgresDSN)
	if err != nil {
		slog.Error("migrate: open db failed", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := db.PingContext(context.Background()); err != nil {
		slog.Error("migrate: ping failed", "err", err)
		os.Exit(1)
	}

	if err := goose.SetDialect("postgres"); err != nil {
		slog.Error("migrate: set dialect failed", "err", err)
		os.Exit(1)
	}
	goose.SetTableName("goose_db_version")

	slog.Info("migrate: running", "cmd", cmd, "dir", dir)
	if err := goose.RunContext(context.Background(), cmd, db, dir, args[1:]...); err != nil {
		slog.Error("migrate: failed", "cmd", cmd, "err", err)
		os.Exit(1)
	}

	// Кратко покажем финальный статус — удобно в CI-логах.
	if cmd != "status" {
		_ = goose.Status(db, dir)
	}
	slog.Info("migrate: done", "cmd", cmd)
}
