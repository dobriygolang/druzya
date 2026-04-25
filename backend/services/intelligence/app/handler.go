package app

import "log/slog"

// Handler bundles the use cases for the ports layer. Keeps the server
// constructor lean (one struct, two pointers).
type Handler struct {
	GetDailyBrief *GetDailyBrief
	AskNotes      *AskNotes
	Log           *slog.Logger
}

// NewHandler — explicit constructor, mirrors hone.app.NewHandler.
func NewHandler(h Handler) *Handler { return &h }
