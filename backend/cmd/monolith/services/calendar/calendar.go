// Package calendar wires the personal-calendar bounded context into the
// monolith. UI слой (web /calendar + Hone UpcomingEventsChip + reminder
// dispatcher) удалён 2026-04-30 как low-value (юзер дублировал бы данные
// из Google Calendar). Backend оставлен для (a) intelligence
// CalendarReader severity grader'а, (b) будущей привязки club RSVP к
// personal_events, (c) outcome-записи после mock pipeline'ов. RPC
// endpoints доступны но никем не зовутся с frontend'а.
package calendar

import (
	calendarApp "druz9/calendar/app"
	calendarInfra "druz9/calendar/infra"
	calendarPorts "druz9/calendar/ports"
	monolithServices "druz9/cmd/monolith/services"
	notifyDomain "druz9/notify/domain"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
)

// CalendarDeps оставлен в API для совместимости с текущим bootstrap
// wiring — поля игнорируются после удаления reminder dispatcher.
// Можно убрать вместе с upstream при следующей чистке wiring'а.
type CalendarDeps struct {
	NotifyPrefs    notifyDomain.PreferencesRepo
	NotifyChannels notifyDomain.NotificationPrefsRepo
	NotifySender   notifyDomain.Sender
}

// NewCalendar wires the bounded context.
func NewCalendar(d monolithServices.Deps, _ CalendarDeps) *monolithServices.Module {
	repo := calendarInfra.NewPostgres(d.Pool)
	server := calendarPorts.NewServer(
		&calendarApp.CreateEvent{Repo: repo},
		&calendarApp.UpdateEvent{Repo: repo},
		&calendarApp.DeleteEvent{Repo: repo},
		&calendarApp.ListEvents{Repo: repo},
		&calendarApp.ListUpcoming{Repo: repo},
		&calendarApp.SetEventStatus{Repo: repo},
		&calendarApp.UpsertOutcome{Repo: repo},
		d.Log,
	)
	connectPath, connectHandler := druz9v1connect.NewCalendarServiceHandler(server)
	transcoder := monolithServices.MustTranscode("calendar", connectPath, connectHandler)

	return &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Get("/calendar/events", transcoder.ServeHTTP)
			r.Post("/calendar/events", transcoder.ServeHTTP)
			r.Put("/calendar/events/{id}", transcoder.ServeHTTP)
			r.Delete("/calendar/events/{id}", transcoder.ServeHTTP)
			r.Post("/calendar/events/{id}/status", transcoder.ServeHTTP)
			r.Post("/calendar/events/{id}/outcome", transcoder.ServeHTTP)
		},
	}
}
