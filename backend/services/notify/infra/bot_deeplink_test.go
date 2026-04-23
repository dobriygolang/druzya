package infra

import (
	"context"
	"errors"
	"testing"

	"druz9/notify/domain"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

// fakeCodeFiller records calls and returns a configurable error.
type fakeCodeFiller struct {
	gotCode    string
	gotPayload domain.TelegramAuthPayload
	called     bool
	err        error
}

func (f *fakeCodeFiller) Fill(_ context.Context, code string, p domain.TelegramAuthPayload) error {
	f.called = true
	f.gotCode = code
	f.gotPayload = p
	return f.err
}

func makeStartMsg(code string, fromID int64, fromUsername, firstName string, chatID int64) *tgbotapi.Message {
	text := "/start " + code
	return &tgbotapi.Message{
		From: &tgbotapi.User{
			ID:        fromID,
			UserName:  fromUsername,
			FirstName: firstName,
		},
		Chat: &tgbotapi.Chat{ID: chatID, Type: "private"},
		Text: text,
		Date: 1_700_000_000,
		Entities: []tgbotapi.MessageEntity{
			{Type: "bot_command", Offset: 0, Length: len("/start")},
		},
	}
}

func TestStart_DeepLink_NoCodeFiller_ReplyStub(t *testing.T) {
	api := &fakeAPI{}
	bot := newTestBot(api, newFakePrefs(), &fakeUsers{})
	// codes is nil
	msg := makeStartMsg("ABCDEF23", 99, "alice", "Alice", 42)
	if err := bot.dispatch.Dispatch(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	if api.lastText() != RussianReplies.WelcomeDeepLink {
		t.Fatalf("got %q want stub", api.lastText())
	}
}

func TestStart_DeepLink_HappyFill_ReplyOK(t *testing.T) {
	api := &fakeAPI{}
	filler := &fakeCodeFiller{}
	bot := newTestBot(api, newFakePrefs(), &fakeUsers{})
	bot.SetCodeFiller(filler)
	msg := makeStartMsg("ABCDEF23", 99, "alice", "Alice", 42)
	if err := bot.dispatch.Dispatch(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	if !filler.called {
		t.Fatal("expected Fill call")
	}
	if filler.gotCode != "ABCDEF23" {
		t.Fatalf("code %q", filler.gotCode)
	}
	if filler.gotPayload.ID != 99 || filler.gotPayload.Username != "alice" || filler.gotPayload.FirstName != "Alice" {
		t.Fatalf("bad payload %+v", filler.gotPayload)
	}
	if api.lastText() != RussianReplies.DeepLinkOK {
		t.Fatalf("reply %q want OK", api.lastText())
	}
}

func TestStart_DeepLink_NotFound_ReplyInvalid(t *testing.T) {
	api := &fakeAPI{}
	filler := &fakeCodeFiller{err: domain.ErrNotFound}
	bot := newTestBot(api, newFakePrefs(), &fakeUsers{})
	bot.SetCodeFiller(filler)
	msg := makeStartMsg("ZZZZZZZZ", 1, "x", "X", 1)
	_ = bot.dispatch.Dispatch(context.Background(), msg)
	if api.lastText() != RussianReplies.DeepLinkInvalidCode {
		t.Fatalf("reply %q want InvalidCode", api.lastText())
	}
}

func TestStart_DeepLink_OtherError_ReplyFailed(t *testing.T) {
	api := &fakeAPI{}
	filler := &fakeCodeFiller{err: errors.New("redis down")}
	bot := newTestBot(api, newFakePrefs(), &fakeUsers{})
	bot.SetCodeFiller(filler)
	msg := makeStartMsg("ABCDEF23", 1, "x", "X", 1)
	_ = bot.dispatch.Dispatch(context.Background(), msg)
	if api.lastText() != RussianReplies.DeepLinkFailed {
		t.Fatalf("reply %q want Failed", api.lastText())
	}
}

func TestStart_DeepLink_NoFromUser_ReplyInvalid(t *testing.T) {
	api := &fakeAPI{}
	filler := &fakeCodeFiller{}
	bot := newTestBot(api, newFakePrefs(), &fakeUsers{})
	bot.SetCodeFiller(filler)
	msg := &tgbotapi.Message{
		Chat:     &tgbotapi.Chat{ID: 1, Type: "private"},
		Text:     "/start ABCDEF23",
		Date:     1_700_000_000,
		Entities: []tgbotapi.MessageEntity{{Type: "bot_command", Offset: 0, Length: len("/start")}},
	}
	_ = bot.dispatch.Dispatch(context.Background(), msg)
	if api.lastText() != RussianReplies.DeepLinkInvalidCode {
		t.Fatalf("reply %q want InvalidCode (msg.From=nil)", api.lastText())
	}
	if filler.called {
		t.Fatal("Fill should NOT have been called when From is nil")
	}
}
