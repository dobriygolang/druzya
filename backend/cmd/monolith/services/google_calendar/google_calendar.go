// Package google_calendar wires the google_calendar bounded context into
// the monolith. Owns env-driven OAuth/encryption config + 5-min periodic
// pull cron (sync_cron.go).
package google_calendar

import (
	"crypto/rand"
	"encoding/hex"
	"os"

	monolithServices "druz9/cmd/monolith/services"
	gcApp "druz9/google_calendar/app"
	gcInfra "druz9/google_calendar/infra"
	gcPorts "druz9/google_calendar/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
)

// NewGoogleCalendar wires repos + Google API client + Connect/REST surface.
// Env vars:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET           — OAuth app credentials
//   GOOGLE_TOKEN_ENCRYPTION_KEY                       — AES-256-GCM secret
//
// При отсутствии CLIENT_ID/SECRET модуль регистрируется в "disabled" state:
// все RPC отдают FailedPrecondition. Это позволяет деплоить в окружения без
// готового Google Cloud OAuth-app'а (local dev) без падений boot'а.
func NewGoogleCalendar(d monolithServices.Deps) *monolithServices.Module {
	clientID := os.Getenv("GOOGLE_CLIENT_ID")
	clientSecret := os.Getenv("GOOGLE_CLIENT_SECRET")
	encKey := os.Getenv("GOOGLE_TOKEN_ENCRYPTION_KEY")

	if encKey == "" {
		// Fallback: random secret. После рестарта старые токены не расшифруются.
		// Warning log + продолжение работы — для local-dev'а ок.
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		encKey = hex.EncodeToString(b)
		if d.Log != nil {
			d.Log.Warn("google_calendar: GOOGLE_TOKEN_ENCRYPTION_KEY unset — using ephemeral random key (tokens won't survive restart)")
		}
	}

	enc, err := gcInfra.NewEncryptor(encKey)
	if err != nil {
		// Fail-fast — без encrypt'а не имеем права писать токены.
		panic("google_calendar: encryptor init failed: " + err.Error())
	}

	credsRepo := gcInfra.NewCredentialsRepo(d.Pool, enc)
	eventsRepo := gcInfra.NewEventsRepo(d.Pool)
	stateStore := gcInfra.NewStateStore(d.Redis)
	gapi := gcInfra.NewGoogleAPI(clientID, clientSecret, nil)

	handlers := gcApp.New(credsRepo, eventsRepo, gapi, stateStore, d.Log)
	server := gcPorts.New(handlers, d.Log)

	connectPath, connectHandler := druz9v1connect.NewGoogleCalendarServiceHandler(server)
	transcoder := monolithServices.MustTranscode("google_calendar", connectPath, connectHandler)

	mod := &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Get("/google_calendar/status", transcoder.ServeHTTP)
			r.Post("/google_calendar/oauth/start", transcoder.ServeHTTP)
			r.Post("/google_calendar/oauth/callback", transcoder.ServeHTTP)
			r.Post("/google_calendar/disconnect", transcoder.ServeHTTP)
			r.Post("/google_calendar/sync", transcoder.ServeHTTP)
			r.Get("/google_calendar/events", transcoder.ServeHTTP)
		},
	}

	// Periodic pull cron (5 min). Skips when CLIENT_ID/SECRET absent — without
	// them no user can have ever connected, so the cron has nothing to do.
	if clientID != "" && clientSecret != "" {
		cron := newSyncCron(handlers, credsRepo, d.Log)
		mod.Background = append(mod.Background, cron.Run)
		mod.Shutdown = append(mod.Shutdown, cron.Stop)
	}

	return mod
}
