package services

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
)

func WriteJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Default().Error("response write failed", slog.Any("err", err))
	}
}

func WritePubJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Default().Error("response write failed", slog.Any("err", err))
	}
}

func WritePubJSONError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if _, err := fmt.Fprintf(w, `{"error":{"code":%q,"message":%q}}`, code, message); err != nil {
		slog.Default().Error("response write failed", slog.Any("err", err))
	}
}
