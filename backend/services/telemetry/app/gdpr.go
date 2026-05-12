// Package app — GDPR-style data export / delete UCs.
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"druz9/telemetry/domain"

	"github.com/google/uuid"
)

// ExportEvents — собирает все events пользователя в JSON. Возвращает
// (json, count, err). Empty surface = все surfaces.
//
// Single-pass collect → marshal. Для типичного user'а events count ~10k
// записей за 90 дней = ~1MB JSON, marshal в RAM безопасно. Если scale
// зарастёт — переключим на streaming response (deferred).
type ExportEvents struct {
	Repo domain.EventRepo
}

func (uc *ExportEvents) Do(ctx context.Context, userID uuid.UUID, surfaceStr string) ([]byte, int, error) {
	var surface domain.Surface
	if s := strings.TrimSpace(surfaceStr); s != "" {
		surface = domain.Surface(strings.ToLower(s))
		if !surface.IsValid() {
			return nil, 0, fmt.Errorf("telemetry.ExportEvents: %w", domain.ErrInvalidSurface)
		}
	}
	events, err := uc.Repo.ListByUser(ctx, userID, surface)
	if err != nil {
		return nil, 0, fmt.Errorf("telemetry.ExportEvents: list: %w", err)
	}
	// JSON shape — flat array, не proto'шный TelemetryEvent для удобства
	// чтения юзером (он скачивает чтобы посмотреть «что про меня знают»).
	type exportRow struct {
		Surface    string            `json:"surface"`
		Name       string            `json:"name"`
		OccurredAt string            `json:"occurred_at"`
		Properties map[string]string `json:"properties"`
	}
	rows := make([]exportRow, 0, len(events))
	for _, e := range events {
		rows = append(rows, exportRow{
			Surface:    string(e.Surface),
			Name:       e.Name,
			OccurredAt: e.OccurredAt.UTC().Format("2006-01-02T15:04:05Z"),
			Properties: e.Properties,
		})
	}
	payload, err := json.MarshalIndent(rows, "", "  ")
	if err != nil {
		return nil, 0, fmt.Errorf("telemetry.ExportEvents: marshal: %w", err)
	}
	return payload, len(events), nil
}

// DeleteEvents — удаляет все events пользователя (optional surface filter).
// Также best-effort просит analytics sink удалить remote copy. Errors из
// sink не пробрасываем (local cleanup — primary; remote — second).
type DeleteEvents struct {
	Repo domain.EventRepo
	Sink domain.AnalyticsSink
	Anon domain.IDAnonymizer
}

func (uc *DeleteEvents) Do(ctx context.Context, userID uuid.UUID, surfaceStr string) (int, error) {
	var surface domain.Surface
	if s := strings.TrimSpace(surfaceStr); s != "" {
		surface = domain.Surface(strings.ToLower(s))
		if !surface.IsValid() {
			return 0, fmt.Errorf("telemetry.DeleteEvents: %w", domain.ErrInvalidSurface)
		}
	}
	n, err := uc.Repo.DeleteByUser(ctx, userID, surface)
	if err != nil {
		return 0, fmt.Errorf("telemetry.DeleteEvents: %w", err)
	}
	if uc.Sink != nil && uc.Anon != nil {
		_ = uc.Sink.DeleteUser(ctx, uc.Anon.Anonymize(userID))
	}
	return n, nil
}
