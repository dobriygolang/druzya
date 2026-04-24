// current_match.go — `GET /api/v1/arena/match/current` возвращает последний
// незавершённый матч пользователя (searching|confirming|active), чтобы SPA
// мог поллить /arena, находясь в очереди, и перейти на /arena/match/:id в
// момент, когда matchmaker составит пару.
//
// Почему chi-прямой REST handler, а не Connect-RPC метод:
//   - Proto-контракт `arena.ArenaService` уже содержит 6 RPC; добавить
//     седьмой — значит прогнать `make gen-proto` по всем Connect-бандлам
//     ради фактически одного SELECT. То же обоснование — у practice.go и
//     streak_calendar_handler.go в daily/.
//   - Polling-endpoint'ы хотят минимум накладных расходов на сериализацию
//     и крошечную JSON-форму, точно совпадающую с тем, что рисует SPA —
//     эволюционировать проще здесь, чем через proto.
//
// Auth: bearer через существующий chi auth middleware (роут смонтирован под
// защищённым префиксом /api/v1; не в publicPaths).
//
// Anti-fallback policy:
//   - Ошибки repo пропускаются как 500 (никаких «тихих» пустых fallback'ов).
//   - «Нет текущего матча» = 404, а не 200+empty — SPA явно трактует 404
//     как «ещё ищем», а 200 — как «переходим в матч».
package ports

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"druz9/arena/domain"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
)

// CurrentMatchFinder — узкий порт, который handler ждёт от repo.
// Реализуется *infra.Postgres через новый метод FindCurrentMatch.
type CurrentMatchFinder interface {
	// FindCurrentMatch возвращает последний незавершённый матч пользователя
	// (searching/confirming/active). Возвращает domain.ErrNotFound, если
	// такого матча нет.
	FindCurrentMatch(ctx context.Context, userID uuid.UUID) (domain.Match, error)
}

// CurrentMatchHandler — http.Handler для GET /api/v1/arena/match/current.
type CurrentMatchHandler struct {
	Repo CurrentMatchFinder
	Log  *slog.Logger
}

// NewCurrentMatchHandler собирает handler. log обязателен (anti-fallback).
func NewCurrentMatchHandler(repo CurrentMatchFinder, log *slog.Logger) *CurrentMatchHandler {
	if log == nil {
		panic("arena.ports.NewCurrentMatchHandler: log is required (anti-fallback policy: no silent slog.Default fallback)")
	}
	if repo == nil {
		panic("arena.ports.NewCurrentMatchHandler: repo is required")
	}
	return &CurrentMatchHandler{Repo: repo, Log: log}
}

type currentMatchResponse struct {
	MatchID string `json:"match_id"`
	Status  string `json:"status"`
	Mode    string `json:"mode"`
	Section string `json:"section"`
}

// ServeHTTP реализует http.Handler.
func (h *CurrentMatchHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	match, err := h.Repo.FindCurrentMatch(r.Context(), uid)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeJSONError(w, http.StatusNotFound, "no current match")
			return
		}
		h.Log.ErrorContext(r.Context(), "arena.current_match: repo failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "lookup failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	// Cache-Control: no-store — мы ХОТИМ, чтобы SPA поллил свежие данные;
	// этот endpoint — точка polling'а.
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(currentMatchResponse{
		MatchID: match.ID.String(),
		Status:  string(match.Status),
		Mode:    string(match.Mode),
		Section: string(match.Section),
	})
	_ = enums.MatchStatusActive // держим импорт enums под будущий remap имён статусов
}

// writeJSONError повторяет хелпер, используемый соседними chi-прямыми
// handler'ами (discovery_handler.go и т.д.). Оставлен локальным, чтобы
// файл был самодостаточным — вынос в общий http-util отдельной уборкой.
func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{"message": msg},
	})
}
