package services

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"

	"druz9/shared/pkg/compaction"
	"druz9/shared/pkg/llmchain"
)

// compactionEnvCfg — снимок ENV'ов для конфигурации context-compaction.
// Общий для copilot и ai_mock: оба сервиса читают одни и те же ключи,
// различаются только SummaryStore'ы. Держим один парсер, чтобы не
// дублировать дефолты в двух местах.
//
// Валидация в BuildCompactionWorker; Config.Validate() вызывается перед
// созданием воркера — битый env приводит к фатальной ошибке инициализации
// (anti-fallback), а не к молчаливому degrade.
type compactionEnvCfg struct {
	Window    int
	Threshold int
	Workers   int
	Buffer    int
}

// loadCompactionEnv читает COMPACTION_* из окружения с дефолтами
// (10 / 15 / 2 / 128 — см. задачу). Возвращает сразу и Config, и
// WorkerConfig для передачи в compaction.NewWorker.
func loadCompactionEnv() (compaction.Config, compaction.WorkerConfig) {
	c := compactionEnvCfg{
		Window:    atoiOr(os.Getenv("COMPACTION_WINDOW"), 10),
		Threshold: atoiOr(os.Getenv("COMPACTION_THRESHOLD"), 15),
		Workers:   atoiOr(os.Getenv("COMPACTION_WORKERS"), 2),
		Buffer:    atoiOr(os.Getenv("COMPACTION_BUFFER"), 128),
	}
	return compaction.Config{WindowSize: c.Window, Threshold: c.Threshold},
		compaction.WorkerConfig{Workers: c.Workers, BufferSize: c.Buffer}
}

// BuildCompactionWorker — фабрика воркера для конкретного SummaryStore.
// Возвращает ошибку, если chain==nil (ни один provider не поднят) — в
// этом случае сервис должен жить в disabled-ветке: окно всё равно
// обрезается (BuildWindow), но фоновой суммаризации не будет.
func BuildCompactionWorker(
	chain llmchain.ChatClient,
	store compaction.SummaryStore,
	log *slog.Logger,
) (*compaction.Worker, compaction.Config, error) {
	if chain == nil {
		return nil, compaction.Config{}, fmt.Errorf("compaction: llmchain is nil — worker disabled")
	}
	cfg, wcfg := loadCompactionEnv()
	if err := cfg.Validate(); err != nil {
		return nil, compaction.Config{}, fmt.Errorf("compaction: invalid env: %w", err)
	}
	w, err := compaction.NewWorker(chain, store, log, wcfg)
	if err != nil {
		return nil, compaction.Config{}, fmt.Errorf("compaction: new worker: %w", err)
	}
	return w, cfg, nil
}

func atoiOr(s string, def int) int {
	if s == "" {
		return def
	}
	v, err := strconv.Atoi(s)
	if err != nil || v <= 0 {
		return def
	}
	return v
}
