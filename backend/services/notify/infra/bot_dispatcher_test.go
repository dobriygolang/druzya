package infra

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"

	"druz9/notify/domain"
	mocks "druz9/notify/domain/mocks"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// ── fakeAPI ──────────────────────────────────────────────────────────────
//
// fakeAPI обёртывает external github.com/go-telegram-bot-api/telegram-bot-api/v5
// — для него нет mockgen-generated mock (вне нашего proto/domain контракта).
// Оставляем как minimal record-tap для assertion'ов "что отправил бот".

type fakeAPI struct {
	mu   sync.Mutex
	sent []tgbotapi.Chattable
}

func (f *fakeAPI) Send(c tgbotapi.Chattable) (tgbotapi.Message, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, c)
	return tgbotapi.Message{}, nil
}
func (f *fakeAPI) Request(c tgbotapi.Chattable) (*tgbotapi.APIResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, c)
	return &tgbotapi.APIResponse{Ok: true}, nil
}

// lastText pulls the plain text out of the last queued MessageConfig. It panics
// on mis-use (test helper only).
func (f *fakeAPI) lastText() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.sent) == 0 {
		return ""
	}
	if m, ok := f.sent[len(f.sent)-1].(tgbotapi.MessageConfig); ok {
		return m.Text
	}
	return ""
}

// ── prefsStore + wireMockPreferencesRepo ────────────────────────────────
//
// State-машина для PreferencesRepo: ловит SetTelegramChatID / ClearTelegramChatID
// в maps + проброс через mock.

type prefsStore struct {
	mu    sync.Mutex
	set   map[uuid.UUID]string
	clear map[uuid.UUID]bool
}

func newPrefsStore() *prefsStore {
	return &prefsStore{set: map[uuid.UUID]string{}, clear: map[uuid.UUID]bool{}}
}

func wireMockPreferencesRepo(ctrl *gomock.Controller, s *prefsStore) *mocks.MockPreferencesRepo {
	m := mocks.NewMockPreferencesRepo(ctrl)
	m.EXPECT().Get(gomock.Any(), gomock.Any()).Return(domain.Preferences{}, domain.ErrNotFound).AnyTimes()
	m.EXPECT().Upsert(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, p domain.Preferences) (domain.Preferences, error) { return p, nil },
	).AnyTimes()
	m.EXPECT().SetTelegramChatID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, u uuid.UUID, chatID string) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.set[u] = chatID
			return nil
		},
	).AnyTimes()
	m.EXPECT().ClearTelegramChatID(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, u uuid.UUID) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.clear[u] = true
			return nil
		},
	).AnyTimes()
	m.EXPECT().ListWeeklyReportEnabled(gomock.Any()).Return(nil, nil).AnyTimes()
	return m
}

// ── usersStore + wireMockUserLookup ─────────────────────────────────────

type usersStore struct {
	byUsername map[string]uuid.UUID
}

func wireMockUserLookup(ctrl *gomock.Controller, s *usersStore) *mocks.MockUserLookup {
	m := mocks.NewMockUserLookup(ctrl)
	m.EXPECT().FindIDByUsername(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, name string) (uuid.UUID, error) {
			id, ok := s.byUsername[name]
			if !ok {
				return uuid.Nil, domain.ErrNotFound
			}
			return id, nil
		},
	).AnyTimes()
	m.EXPECT().GetLocale(gomock.Any(), gomock.Any()).Return("ru", nil).AnyTimes()
	return m
}

// ── helpers ───────────────────────────────────────────────────────────────

type botHarness struct {
	bot   *TelegramBot
	api   *fakeAPI
	prefs *prefsStore
	users *usersStore
}

func newTestBot(t *testing.T, byUsername map[string]uuid.UUID) *botHarness {
	t.Helper()
	ctrl := gomock.NewController(t)
	api := &fakeAPI{}
	prefs := newPrefsStore()
	users := &usersStore{byUsername: byUsername}
	if users.byUsername == nil {
		users.byUsername = map[string]uuid.UUID{}
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	bot := &TelegramBot{
		api:   api,
		cfg:   TelegramBotConfig{Replies: RussianReplies, MaxSendRetries: 0},
		log:   log,
		prefs: wireMockPreferencesRepo(ctrl, prefs),
		users: wireMockUserLookup(ctrl, users),
	}
	bot.dispatch = NewCommandDispatcher(bot)
	return &botHarness{bot: bot, api: api, prefs: prefs, users: users}
}

// makeMsg builds a minimal Message with /<cmd> [args] and a From.UserName.
func makeMsg(cmd, args, fromUsername string, chatID int64) *tgbotapi.Message {
	text := "/" + cmd
	if args != "" {
		text += " " + args
	}
	return &tgbotapi.Message{
		From: &tgbotapi.User{UserName: fromUsername},
		Chat: &tgbotapi.Chat{ID: chatID, Type: "private"},
		Text: text,
		Entities: []tgbotapi.MessageEntity{
			{Type: "bot_command", Offset: 0, Length: len("/" + cmd)},
		},
	}
}

// ── tests ─────────────────────────────────────────────────────────────────

func TestDispatch_Start_NoArgs(t *testing.T) {
	h := newTestBot(t, nil)
	msg := makeMsg("start", "", "alice", 42)
	if err := h.bot.dispatch.Dispatch(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	if h.api.lastText() != RussianReplies.Welcome {
		t.Fatalf("want welcome, got %q", h.api.lastText())
	}
}

func TestDispatch_Start_WithDeepLinkToken(t *testing.T) {
	h := newTestBot(t, nil)
	msg := makeMsg("start", "token_abc123", "alice", 42)
	if err := h.bot.dispatch.Dispatch(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	if h.api.lastText() != RussianReplies.WelcomeDeepLink {
		t.Fatalf("want deep-link stub, got %q", h.api.lastText())
	}
}

func TestDispatch_Help(t *testing.T) {
	h := newTestBot(t, nil)
	msg := makeMsg("help", "", "alice", 42)
	_ = h.bot.dispatch.Dispatch(context.Background(), msg)
	if h.api.lastText() != RussianReplies.Help {
		t.Fatalf("got %q", h.api.lastText())
	}
}

// TestDispatch_Link_Disabled — /link теперь всегда возвращает LinkDisabled
// и НЕ модифицирует prefs (security hotfix 2026-04). См. комментарий в
// bot_dispatcher.go: старая реализация принимала любой druz9 username без
// верификации владельца, позволяя перехватывать чужие уведомления.
func TestDispatch_Link_Disabled(t *testing.T) {
	for _, tc := range []struct {
		name string
		arg  string
	}{
		{"no_arg", ""},
		{"with_username", "alice"},
		{"with_at_prefix", "@alice"},
		{"nonexistent_user", "ghost"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			uid := uuid.New()
			h := newTestBot(t, map[string]uuid.UUID{"alice": uid})
			msg := makeMsg("link", tc.arg, "alice_tg", 1234)
			_ = h.bot.dispatch.Dispatch(context.Background(), msg)
			if h.api.lastText() != RussianReplies.LinkDisabled {
				t.Fatalf("want LinkDisabled reply, got %q", h.api.lastText())
			}
			h.prefs.mu.Lock()
			defer h.prefs.mu.Unlock()
			if len(h.prefs.set) != 0 {
				t.Fatalf("handleLink must not call SetTelegramChatID; got %+v", h.prefs.set)
			}
		})
	}
}

// TestDispatch_Unlink_Disabled — /unlink тоже отключён.
func TestDispatch_Unlink_Disabled(t *testing.T) {
	uid := uuid.New()
	h := newTestBot(t, map[string]uuid.UUID{"alice": uid})
	msg := makeMsg("unlink", "", "alice", 1234)
	_ = h.bot.dispatch.Dispatch(context.Background(), msg)
	if h.api.lastText() != RussianReplies.LinkDisabled {
		t.Fatalf("want LinkDisabled reply, got %q", h.api.lastText())
	}
	h.prefs.mu.Lock()
	defer h.prefs.mu.Unlock()
	if len(h.prefs.clear) != 0 {
		t.Fatalf("handleUnlink must not call ClearTelegramChatID; got %+v", h.prefs.clear)
	}
}

func TestDispatch_UnknownCommand(t *testing.T) {
	h := newTestBot(t, nil)
	msg := makeMsg("wat", "", "alice", 42)
	_ = h.bot.dispatch.Dispatch(context.Background(), msg)
	if h.api.lastText() != RussianReplies.UnknownCommand {
		t.Fatalf("got %q", h.api.lastText())
	}
}

func TestDispatch_Leaderboard_Stub(t *testing.T) {
	h := newTestBot(t, nil)
	msg := makeMsg("leaderboard", "", "alice", 42)
	_ = h.bot.dispatch.Dispatch(context.Background(), msg)
	if h.api.lastText() != RussianReplies.LeaderboardStub {
		t.Fatalf("got %q", h.api.lastText())
	}
}

// parseArgs edge cases.
func TestParseArgs(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"", nil},
		{"   ", nil},
		{"a", []string{"a"}},
		{"  foo   bar  ", []string{"foo", "bar"}},
	}
	for _, tc := range cases {
		got := parseArgs(tc.in)
		if len(got) != len(tc.want) {
			t.Fatalf("in=%q want %v got %v", tc.in, tc.want, got)
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Fatalf("in=%q want %v got %v", tc.in, tc.want, got)
			}
		}
	}
}

// Sanity: the dispatcher ignores non-command messages.
func TestDispatch_NonCommand(t *testing.T) {
	h := newTestBot(t, nil)
	msg := &tgbotapi.Message{Chat: &tgbotapi.Chat{ID: 1}, Text: "hello"}
	if err := h.bot.dispatch.Dispatch(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	h.api.mu.Lock()
	defer h.api.mu.Unlock()
	if len(h.api.sent) != 0 {
		t.Fatalf("expected no replies, got %d", len(h.api.sent))
	}
}

// Sanity: an error from a handler propagates up but is non-fatal for the
// webhook (the caller logs + returns 200).
func TestDispatch_HandlerError(t *testing.T) {
	h := newTestBot(t, nil)
	// Overwrite the start handler to fail.
	h.bot.dispatch.handlers["start"] = func(ctx context.Context, msg *tgbotapi.Message, args []string) error {
		return errors.New("boom")
	}
	msg := makeMsg("start", "", "alice", 1)
	err := h.bot.dispatch.Dispatch(context.Background(), msg)
	if err == nil || err.Error() != "boom" {
		t.Fatalf("want boom, got %v", err)
	}
}
