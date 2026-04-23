package services

import (
	"context"
	"fmt"

	friendsApp "druz9/friends/app"
	friendsInfra "druz9/friends/infra"
	friendsPorts "druz9/friends/ports"
	sharedDomain "druz9/shared/domain"

	"github.com/go-chi/chi/v5"
)

// publisher — узкий контракт, которому удовлетворяет eventbus.InProcess.
// Вынесли в именованный тип, чтобы gofmt не пытался ужать длинную inline
// interface{...} декларацию ниже в одну строку (gofmt-violation в CI).
type publisher interface {
	Publish(ctx context.Context, e sharedDomain.Event) error
}

// busAdapter — обёртка publisher под friendsApp.Bus (избегает импорта
// eventbus в friends/app).
type busAdapter struct{ b publisher }

func (a busAdapter) Publish(ctx context.Context, e sharedDomain.Event) error {
	if err := a.b.Publish(ctx, e); err != nil {
		return fmt.Errorf("services.friends.busAdapter.Publish: %w", err)
	}
	return nil
}

// NewFriends wires the friends bounded context: friendships table,
// friend_codes, кеш ListAccepted в Redis. Anti-fallback: the AlwaysOffline
// presence stub was removed — presence is no longer plumbed through. When
// a real presence module exists, restore PresenceProvider as a separate
// port and wire it here. Do NOT reintroduce a hard-coded stub.
func NewFriends(d Deps) *Module {
	pg := friendsInfra.NewPostgres(d.Pool)
	codes := friendsInfra.NewCodePostgres(d.Pool, friendsInfra.DefaultCodeTTL)
	kv := friendsInfra.NewRedisKV(d.Redis)
	cached := friendsInfra.NewCachedRepo(pg, kv, friendsInfra.DefaultListTTL, d.Log)

	bus := busAdapter{b: d.Bus}

	add := &friendsApp.AddFriend{Repo: cached, Codes: codes, Bus: bus, Log: d.Log, Now: d.Now}
	accept := &friendsApp.AcceptFriend{Repo: cached, Bus: bus, Log: d.Log, Now: d.Now}
	decline := &friendsApp.DeclineFriend{Repo: cached}
	block := &friendsApp.BlockUser{Repo: cached}
	unblock := &friendsApp.UnblockUser{Repo: cached}
	unfriend := &friendsApp.Unfriend{Repo: cached}
	myCode := &friendsApp.GetMyCode{Codes: codes}
	list := &friendsApp.ListFriends{Repo: cached}
	incoming := &friendsApp.ListIncoming{Repo: cached}
	outgoing := &friendsApp.ListOutgoing{Repo: cached}
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
