package ports

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"druz9/guild/app"
	"druz9/guild/domain"
)

// TopGuildsHandler is a tiny REST endpoint serving the global guild
// leaderboard. It lives outside the Connect-RPC surface because the OpenAPI
// proto contract has not been regenerated to include `ListTopGuilds` — the
// frontend consumes it directly via fetch. The shape is intentionally
// stable and documented inline so a future Connect migration is mechanical.
//
// GET /api/v1/guilds/top?limit=20  → 200 application/json
//
//	{
//	  "items": [
//	    {
//	      "guild_id":      "uuid",
//	      "name":          "string",
//	      "emblem":        "string",
//	      "members_count": 0,
//	      "elo_total":     0,
//	      "wars_won":      0,
//	      "rank":          1
//	    }
//	  ]
//	}
type TopGuildsHandler struct {
	UC  *app.ListTopGuilds
	Log *slog.Logger
}

// topGuildItemDTO matches the JSON shape consumed by the frontend
// `useTopGuildsQuery`. Field names mirror the planned proto contract so a
// later Connect-RPC migration becomes a drop-in replacement.
type topGuildItemDTO struct {
	GuildID      string `json:"guild_id"`
	Name         string `json:"name"`
	Emblem       string `json:"emblem"`
	MembersCount int    `json:"members_count"`
	EloTotal     int    `json:"elo_total"`
	WarsWon      int    `json:"wars_won"`
	Rank         int    `json:"rank"`
}

type topGuildsResponseDTO struct {
	Items []topGuildItemDTO `json:"items"`
}

// ServeHTTP implements http.Handler. Errors are logged with the Log field
// (if set) and surfaced as a generic 500 — never the underlying message —
// because this endpoint is unauthenticated and we don't want to leak
// internals into the response body.
func (h *TopGuildsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	limit := domain.DefaultTopGuildsLimit
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	out, err := h.UC.Do(r.Context(), limit)
	if err != nil {
		if h.Log != nil {
			h.Log.ErrorContext(r.Context(), "guild.top: use case failed",
				slog.Any("err", err))
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	dto := topGuildsResponseDTO{Items: make([]topGuildItemDTO, 0, len(out))}
	for _, g := range out {
		dto.Items = append(dto.Items, topGuildItemDTO{
			GuildID:      g.GuildID.String(),
			Name:         g.Name,
			Emblem:       g.Emblem,
			MembersCount: g.MembersCount,
			EloTotal:     g.EloTotal,
			WarsWon:      g.WarsWon,
			Rank:         g.Rank,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(dto); err != nil && h.Log != nil {
		h.Log.WarnContext(r.Context(), "guild.top: encode failed",
			slog.Any("err", err))
	}
}
