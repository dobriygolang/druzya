// Command monolith boots every domain as an in-process service.
// When a domain is extracted to its own deployment, only this file (and
// the matching services/<domain>.go wirer) changes — domain code stays
// identical.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"druz9/cmd/monolith/bootstrap"
	"druz9/shared/pkg/config"
)

func main() {
	// Subcommand-диспатч. Сейчас единственная команда — `migrate`,
	// которая прогоняет goose по POSTGRES_DSN и выходит. Без аргументов
	// бинарь, как и раньше, поднимает полный API.
	if len(os.Args) > 1 && os.Args[1] == "migrate" {
		runMigrate(os.Args[2:])
		return
	}

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config load failed", "err", err)
		os.Exit(1)
	}

	rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	app, otelShutdown, err := bootstrap.New(rootCtx, &cfg)
	if err != nil {
		slog.Error("bootstrap failed", "err", err)
		os.Exit(1)
	}
	defer otelShutdown()

	if err := app.Run(rootCtx); err != nil {
		slog.Error("http server failed", "err", err)
		os.Exit(1)
	}

	shCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := app.Shutdown(shCtx); err != nil {
		slog.Error("shutdown failed", "err", err)
		os.Exit(1)
	}
}
