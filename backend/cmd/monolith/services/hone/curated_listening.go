// curated_listening.go — plain chi handler for the Sergey-curated
// "ready-made library" of English listening tracks. Sits alongside the
// user-owned listening materials API (transcoder-backed RPC). Catalog is
// in-process (see hone/app/listening_catalog.go); the handler is a thin
// JSON shim. No DB, no LLM, no proto round-trip — keeps this Phase K
// Wave 15 work shippable without forcing `make generate`.
//
// Route: GET /api/v1/hone/listening/curated?level=B1|B2|C1
//
// Response shape (matches honeApp.ListeningTrack):
//   {
//     "items": [
//       { "id":"…","title":"…","speaker":"…","url":"…",
//         "level":"B2","estimated_minutes":60,
//         "topic":"…","tags":["…"],"source":"…","why":"…" },
//       …
//     ]
//   }
package hone

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	honeApp "druz9/hone/app"
)

// curatedListeningHandler — http.Handler рендерит фильтрованный slice.
// log: nil-safe (если nil — silent).
type curatedListeningHandler struct {
	log *slog.Logger
}

// ServeHTTP реализует http.Handler. Только GET; неподдерживаемые методы
// возвращают 405. Уровни нормализуются (b2 → B2); пустой / unknown
// возвращает all.
func (h *curatedListeningHandler) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	raw := strings.TrimSpace(req.URL.Query().Get("level"))
	level := honeApp.ListeningTrackLevel(strings.ToUpper(raw))
	// Unknown / invalid level — treat as "no filter" rather than 400. We
	// errrr toward the user-facing "show me something" behaviour rather
	// than failing the request; UI sends only B1/B2/C1 anyway.
	if level != "" && !level.IsValid() {
		level = ""
	}

	tracks := honeApp.FilterListeningTracksByLevel(level)

	type wireResponse struct {
		Items []honeApp.ListeningTrack `json:"items"`
	}
	body, err := json.Marshal(wireResponse{Items: tracks})
	if err != nil {
		if h.log != nil {
			h.log.Error("hone.curatedListening: marshal", slog.Any("err", err))
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"marshal failed"}`))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	// 5-минутный cache на стороне CDN/клиента — каталог статичен, обновляется
	// только git'ом + redeploy'ем; короткое окно убирает уши при первом
	// заходе нескольких юзеров одновременно.
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
