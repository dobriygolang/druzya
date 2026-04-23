package services

import (
	"context"

	friendsApp "druz9/friends/app"
	friendsDomain "druz9/friends/domain"
	friendsInfra "druz9/friends/infra"
	friendsPorts "druz9/friends/ports"
	sharedDomain "druz9/shared/domain"

	"github.com/go-chi/chi/v5"
)

// busAdapter — узкий обёртка eventbus.InProcess под app.Bus интерфейс
// (избегает импорта eventbus в friends/app).
type busAdapter struct{ b interface{ Publish(context.Context, sharedDomain.Event) error } }

func (a busAdapter) Publish(ctx context.Context, e sharedDomain.Event) error {
	return a.b.Publish(ctx, e)
}

// NewFriends wires the friends bounded context: friendships table,
// friend_codes, кеш ListAccepted в Redis. PresenceProvider — пока
// AlwaysOffline (presence-модуль ещё не вынесен в общий port'ах,
// см. comment в bible). Добавим интеграцию когда presence будет.
func NewFriends(d Deps) *Module {
	pg := friendsInfra.NewPostgres(d.Pool)
	codes := friendsInfra.NewCodePostgres(d.Pool, friendsInfra.DefaultCodeTTL)
	kv := friendsInfra.NewRedisKV(d.Redis)
	cached := friendsInfra.NewCachedRepo(pg, kv, friendsInfra.DefaultListTTL, d.Log)
	presence := friendsDomain.AlwaysOffline{}

	bus := busAdapter{b: d.Bus}

	add := &friendsApp.AddFriend{Repo: cached, Codes: codes, Bus: bus, Log: d.Log, Now: d.Now}
	accept := &friendsApp.AcceptFriend{Repo: cached, Bus: bus, Log: d.Log, Now: d.Now}
	decline := &friendsApp.DeclineFriend{Repo: cached}
	block := &friendsApp.BlockUser{Repo: cached}
	unblock := &friendsApp.UnblockUser{Repo: cached}
	unfriend := &friendsApp.Unfriend{Repo: cached}
	myCode := &friendsApp.GetMyCode{Codes: codes}
	list := &friendsApp.ListFriends{Repo: cached, Presence: presence}
	incoming := &friendsApp.ListIncoming{Repo: cached, Presence: presence}
	outgoing := &friendsApp.ListOutgoing{Repo: cached, Presence: presence}
	blocked := &friendsApp.ListBlocked{Repo: cached}
	suggestions := &friendsApp.ListSuggestions{Repo: cached}

	h := friendsPorts.NewHandler(friendsPorts.Handler{
		List:        list,
		Incoming:    incoming,
		Outgoing:    outgoing,
		Blocked:     blocked,
		Suggestions: suggestions,
		Add:         add,
		Accept:      accept,
		Decline:     decline,
		Block:       block,
		Unblock:     unblock,
		Unfriend:    unfriend,
		Code:        myCode,
		Repo:        cached,
		Log:         d.Log,
	})

	return &Module{
		MountREST: func(r chi.Router) {
			h.Mount(r)
		},
	}
}
