package compaction

// Turn — один обмен "user → assistant" в истории диалога. Держим минимум
// полей: пакет не хочет знать domain-specific атрибуты (stress snapshot,
// has_screenshot, tokens). Вся семантика сжатия работает с текстом.
type Turn struct {
	Role    string // "user" | "assistant" | "system"
	Content string
}

// Window — итог sliding-window алгоритма для одной LLM-итерации.
//
//   - RunningSummary: конденсат старых turns (пустой если их < WindowSize).
//   - Tail: последние ≤ WindowSize turns, в исходном порядке.
//   - NeedsCompaction: сигнал фоновой компактору, что пора пересчитать
//     running_summary (когда turns > Threshold).
//   - OldTurns: turns, которые предлагается суммаризировать (всё, кроме
//     последних WindowSize). Пустой если NeedsCompaction=false.
type Window struct {
	RunningSummary  string
	Tail            []Turn
	NeedsCompaction bool
	OldTurns        []Turn
}

// Config — параметры окна. Задаются один раз на сервис; читаются из env.
type Config struct {
	// WindowSize — сколько последних turns всегда шлём в LLM. По
	// умолчанию 10 (правило bible §8 у ai_mock).
	WindowSize int
	// Threshold — после какого числа turns включаем компакцию. Должен
	// быть ≥ WindowSize. Рекомендуемое значение — WindowSize + 5.
	Threshold int
}

// Validate — ранняя проверка конфигурации. Возвращает ErrInvalidConfig
// при неадекватных значениях.
func (c Config) Validate() error {
	if c.WindowSize <= 0 {
		return errInvalidConfig("window_size must be > 0")
	}
	if c.Threshold < c.WindowSize {
		return errInvalidConfig("threshold must be >= window_size")
	}
	return nil
}

// DefaultConfig — безопасные значения по умолчанию.
func DefaultConfig() Config {
	return Config{WindowSize: 10, Threshold: 15}
}

// BuildWindow — pure function. Разбивает turns на (summary-worthy old,
// tail) согласно cfg. Не модифицирует вход.
//
// Semantics:
//
//	len(turns) <= WindowSize  -> Tail = turns, NeedsCompaction=false
//	len(turns) <= Threshold   -> Tail = last WindowSize, NeedsCompaction=false
//	len(turns) >  Threshold   -> Tail = last WindowSize, OldTurns = rest,
//	                             NeedsCompaction=true
//
// RunningSummary передаётся отдельно (из persistent store) и просто
// копируется в результат. Пакет не решает когда его очищать — store-
// specific.
func BuildWindow(turns []Turn, runningSummary string, cfg Config) Window {
	if cfg.WindowSize <= 0 {
		// Fail-soft: при битом конфиге шлём всё, ничего не компактим.
		// Политика anti-fallback требует ошибок в конструкторе (см.
		// Validate) — на hot-path мы уже не можем всё сломать.
		return Window{Tail: append([]Turn(nil), turns...)}
	}
	n := len(turns)
	if n <= cfg.WindowSize {
		return Window{
			RunningSummary: runningSummary,
			Tail:           append([]Turn(nil), turns...),
		}
	}
	tailStart := n - cfg.WindowSize
	tail := append([]Turn(nil), turns[tailStart:]...)

	if n <= cfg.Threshold || cfg.Threshold < cfg.WindowSize {
		// Порог ещё не достигнут — срезаем окно, но компакцию не
		// запускаем (running_summary остаётся прежним).
		return Window{
			RunningSummary: runningSummary,
			Tail:           tail,
		}
	}
	old := append([]Turn(nil), turns[:tailStart]...)
	return Window{
		RunningSummary:  runningSummary,
		Tail:            tail,
		NeedsCompaction: true,
		OldTurns:        old,
	}
}
