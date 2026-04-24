package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// LinkBoosty — use-case для кнопки "Привязать Boosty" в Settings. Принимает
// boosty_username, сохраняет link. verified_at остаётся nil до первого
// успешного sync'а (чтобы UI показывал бейдж "Ожидаем подтверждения").
type LinkBoosty struct {
	Links domain.LinkRepo
	Clock domain.Clock
	Log   *slog.Logger
}

func NewLinkBoosty(links domain.LinkRepo, clk domain.Clock, log *slog.Logger) *LinkBoosty {
	if log == nil {
		panic("subscription.NewLinkBoosty: logger is required (anti-fallback policy)")
	}
	if clk == nil {
		clk = domain.RealClock{}
	}
	return &LinkBoosty{Links: links, Clock: clk, Log: log}
}

// LinkBoostyInput — минимальный payload для /subscription/boosty/link.
type LinkBoostyInput struct {
	UserID         uuid.UUID
	BoostyUsername string
}

// Do валидирует username (не пустой, без ведущего @, допустимые символы
// — буквы/цифры/._-) и upsert'ит link. Дубли по external_id (два druz9-
// юзера на один boosty_username) перехватываются БД-constraint'ом.
func (uc *LinkBoosty) Do(ctx context.Context, in LinkBoostyInput) error {
	u := strings.TrimPrefix(strings.TrimSpace(in.BoostyUsername), "@")
	if u == "" {
		return fmt.Errorf("subscription.LinkBoosty: empty username")
	}
	// Boosty допускает латиницу+цифры+подчёркивание/точку. Убираем очевидно
	// мусорные символы, чтобы не писать в БД что-то с пробелами/unicode'ом.
	for _, r := range u {
		ok := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '_' || r == '.' || r == '-'
		if !ok {
			return fmt.Errorf("subscription.LinkBoosty: invalid username %q", in.BoostyUsername)
		}
	}

	link := domain.ProviderLink{
		UserID:     in.UserID,
		Provider:   domain.ProviderBoosty,
		ExternalID: u,
		UpdatedAt:  uc.now(),
	}
	if err := uc.Links.Upsert(ctx, link); err != nil {
		return fmt.Errorf("subscription.LinkBoosty: %w", err)
	}
	uc.Log.InfoContext(ctx, "subscription.boosty.linked",
		slog.String("user_id", in.UserID.String()),
		slog.String("boosty_username", u))
	return nil
}

func (uc *LinkBoosty) now() time.Time {
	if uc.Clock != nil {
		return uc.Clock.Now()
	}
	return time.Now().UTC()
}
