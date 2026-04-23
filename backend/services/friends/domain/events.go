package domain

import (
	"time"

	"github.com/google/uuid"
)

// События friends-домена. Тонкие, потому что notify слушает их для
// генерации UserNotification (см. notify/app/handlers).
//
// Реализуем shared/domain.Event interface (Topic + OccurredAt).

// FriendRequestReceived — addressee получил входящую заявку.
//
// Реализует duck-typed interface notify.app.friendRequestPayloader через
// методы Requester/Addressee/FriendshipID — это позволяет notify-feed
// потреблять событие, не импортируя friends/domain (избегаем cycle).
type FriendRequestReceived struct {
	At              time.Time
	RequesterID     uuid.UUID
	AddresseeID     uuid.UUID
	FriendshipIDVal int64
}

// Topic стабильное имя топика.
func (FriendRequestReceived) Topic() string { return "friends.RequestReceived" }

// OccurredAt — время события.
func (e FriendRequestReceived) OccurredAt() time.Time { return e.At }

// Requester accessor (для notify-feed).
func (e FriendRequestReceived) Requester() uuid.UUID { return e.RequesterID }

// Addressee accessor (для notify-feed).
func (e FriendRequestReceived) Addressee() uuid.UUID { return e.AddresseeID }

// FriendshipID accessor (для notify-feed).
func (e FriendRequestReceived) FriendshipID() int64 { return e.FriendshipIDVal }

// FriendRequestAccepted — пара стала accepted.
type FriendRequestAccepted struct {
	At          time.Time
	RequesterID uuid.UUID
	AddresseeID uuid.UUID
}

// Topic стабильное имя.
func (FriendRequestAccepted) Topic() string { return "friends.RequestAccepted" }

// OccurredAt время.
func (e FriendRequestAccepted) OccurredAt() time.Time { return e.At }
