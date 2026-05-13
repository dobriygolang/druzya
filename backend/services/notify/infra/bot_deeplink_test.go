package infra

import (
	"context"
	"errors"
	"sync"
	"testing"

	"druz9/notify/domain"
	mocks "druz9/notify/domain/mocks"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"go.uber.org/mock/gomock"
)

// codeFillerTap — closure-state для MockCodeFiller, ловит вызовы.
type codeFillerTap struct {
	mu         sync.Mutex
	gotCode    string
	gotPayload domain.TelegramAuthPayload
	called     bool
	err        error
}

func wireMockCodeFiller(ctrl *gomock.Controller, tap *codeFillerTap) *mocks.MockCodeFiller {
	m := mocks.NewMockCodeFiller(ctrl)
	m.EXPECT().Fill(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, code string, p domain.TelegramAuthPayload) error {
			tap.mu.Lock()
			defer tap.mu.Unlock()
			tap.called = true
			tap.gotCode = code
			tap.gotPayload = p
			return tap.err
		},
	).AnyTimes()
	return m
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
	h := newTestBot(t, nil)
	// codes is nil
	msg := makeStartMsg("ABCDEF23", 99, "alice", "Alice", 42)
	if err := h.bot.dispatch.Dispatch(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	if h.api.lastText() != RussianReplies.WelcomeDeepLink {
		t.Fatalf("got %q want stub", h.api.lastText())
	}
}

func TestStart_DeepLink_HappyFill_ReplyOK(t *testing.T) {
	ctrl := gomock.NewController(t)
	h := newTestBot(t, nil)
	tap := &codeFillerTap{}
	h.bot.SetCodeFiller(wireMockCodeFiller(ctrl, tap))
	msg := makeStartMsg("ABCDEF23", 99, "alice", "Alice", 42)
	if err := h.bot.dispatch.Dispatch(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	tap.mu.Lock()
	defer tap.mu.Unlock()
	if !tap.called {
		t.Fatal("expected Fill call")
	}
	if tap.gotCode != "ABCDEF23" {
		t.Fatalf("code %q", tap.gotCode)
	}
	if tap.gotPayload.ID != 99 || tap.gotPayload.Username != "alice" || tap.gotPayload.FirstName != "Alice" {
		t.Fatalf("bad payload %+v", tap.gotPayload)
	}
	if h.api.lastText() != RussianReplies.DeepLinkOK {
		t.Fatalf("reply %q want OK", h.api.lastText())
	}
}

func TestStart_DeepLink_NotFound_ReplyInvalid(t *testing.T) {
	ctrl := gomock.NewController(t)
	h := newTestBot(t, nil)
	tap := &codeFillerTap{err: domain.ErrNotFound}
	h.bot.SetCodeFiller(wireMockCodeFiller(ctrl, tap))
	msg := makeStartMsg("ZZZZZZZZ", 1, "x", "X", 1)
	_ = h.bot.dispatch.Dispatch(context.Background(), msg)
	if h.api.lastText() != RussianReplies.DeepLinkInvalidCode {
		t.Fatalf("reply %q want InvalidCode", h.api.lastText())
	}
}

func TestStart_DeepLink_OtherError_ReplyFailed(t *testing.T) {
	ctrl := gomock.NewController(t)
	h := newTestBot(t, nil)
	tap := &codeFillerTap{err: errors.New("redis down")}
	h.bot.SetCodeFiller(wireMockCodeFiller(ctrl, tap))
	msg := makeStartMsg("ABCDEF23", 1, "x", "X", 1)
	_ = h.bot.dispatch.Dispatch(context.Background(), msg)
	if h.api.lastText() != RussianReplies.DeepLinkFailed {
		t.Fatalf("reply %q want Failed", h.api.lastText())
	}
}

func TestStart_DeepLink_NoFromUser_ReplyInvalid(t *testing.T) {
	ctrl := gomock.NewController(t)
	h := newTestBot(t, nil)
	tap := &codeFillerTap{}
	h.bot.SetCodeFiller(wireMockCodeFiller(ctrl, tap))
	msg := &tgbotapi.Message{
		Chat:     &tgbotapi.Chat{ID: 1, Type: "private"},
		Text:     "/start ABCDEF23",
		Date:     1_700_000_000,
		Entities: []tgbotapi.MessageEntity{{Type: "bot_command", Offset: 0, Length: len("/start")}},
	}
	_ = h.bot.dispatch.Dispatch(context.Background(), msg)
	if h.api.lastText() != RussianReplies.DeepLinkInvalidCode {
		t.Fatalf("reply %q want InvalidCode (msg.From=nil)", h.api.lastText())
	}
	tap.mu.Lock()
	defer tap.mu.Unlock()
	if tap.called {
		t.Fatal("Fill should NOT have been called when From is nil")
	}
}
