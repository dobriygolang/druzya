package infra

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"druz9/notify/domain"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/google/uuid"
)

// ── fakes ─────────────────────────────────────────────────────────────────

type fakeAPI struct {
	sent []tgbotapi.Chattable
}

func (f *fakeAPI) Send(c tgbotapi.Chattable) (tgbotapi.Message, error) {
	f.sent = append(f.sent, c)
	return tgbotapi.Message{}, nil
}
func (f *fakeAPI) Request(c tgbotapi.Chattable) (*tgbotapi.APIResponse, error) {
	f.sent = append(f.sent, c)
	return &tgbotapi.APIResponse{Ok: true}, nil
}

// lastText pulls the plain text out of the last queued MessageConfig. It panics
// on mis-use (test helper only).
func (f *fakeAPI) lastText() string {
	if len(f.sent) == 0 {
		return ""
	}
	if m, ok := f.sent[len(f.sent)-1].(tgbotapi.MessageConfig); ok {
		return m.Text
	}
	return ""
}

type fakePrefs struct {
	set   map[uuid.UUID]string
	clear map[uuid.UUID]bool
}

func newFakePrefs() *fakePrefs {
	return &fakePrefs{set: map[uuid.UUID]string{}, clear: map[uuid.UUID]bool{}}
}

func (f *fakePrefs) Get(context.Context, uuid.UUID) (domain.Preferences, error) {
	return domain.Preferences{}, domain.ErrNotFound
}
func (f *fakePrefs) Upsert(_ context.Context, p domain.Preferences) (domain.Preferences, error) {
	return p, nil
}
func (f *fakePrefs) SetTelegramChatID(_ context.Context, u uuid.UUID, chatID string) error {
	f.set[u] = chatID
	return nil
}
func (f *fakePrefs) ClearTelegramChatID(_ context.Context, u uuid.UUID) error {
	f.clear[u] = true
	return nil
}
func (f *fakePrefs) ListWeeklyReportEnabled(context.Context) ([]uuid.UUID, error) {
	return nil, nil
}

type fakeUsers struct {
	byUsername map[string]uuid.UUID
}

func (f *fakeUsers) FindIDByUsername(_ context.Context, name string) (uuid.UUID, error) {
	id, ok := f.byUsername[name]
	if !ok {
		return uuid.Nil, domain.ErrNotFound
	}
	return id, nil
}
func (f *fakeUsers) GetLocale(context.Context, uuid.UUID) (string, error) { return "ru", nil }

// ── helpers ───────────────────────────────────────────────────────────────

func newTestBot(api *fakeAPI, prefs *fakePrefs, users *fakeUsers) *TelegramBot {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	bot := &TelegramBot{
		api:   api,
		cfg:   TelegramBotConfig{Replies: RussianReplies, MaxSendRetries: 0},
		log:   log,
		prefs: prefs,
		users: users,
	}
	bot.dispatch = NewCommandDispatcher(bot)
	return bot
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
	api := &fakeAPI{}
	bot := newTestBot(api, newFakePrefs(), &fakeUsers{})
	msg := makeMsg("start", "", "alice", 42)
	if err := bot.dispatch.Dispatch(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	if api.lastText() != RussianReplies.Welcome {
		t.Fatalf("want welcome, got %q", api.lastText())
	}
}

func TestDispatch_Start_WithDeepLinkToken(t *testing.T) {
	api := &fakeAPI{}
	bot := newTestBot(api, newFakePrefs(), &fakeUsers{})
	msg := makeMsg("start", "token_abc123", "alice", 42)
	if err := bot.dispatch.Dispatch(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	if api.lastText() != RussianReplies.WelcomeDeepLink {
		t.Fatalf("want deep-link stub, got %q", api.lastText())
	}
}

func TestDispatch_Help(t *testing.T) {
	api := &fakeAPI{}
	bot := newTestBot(api, newFakePrefs(), &fakeUsers{})
	msg := makeMsg("help", "", "alice", 42)
	_ = bot.dispatch.Dispatch(context.Background(), msg)
	if api.lastText() != RussianReplies.Help {
		t.Fatalf("got %q", api.lastText())
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
			api := &fakeAPI{}
			prefs := newFakePrefs()
			uid := uuid.New()
			users := &fakeUsers{byUsername: map[string]uuid.UUID{"alice": uid}}
			bot := newTestBot(api, prefs, users)
			msg := makeMsg("link", tc.arg, "alice_tg", 1234)
			_ = bot.dispatch.Dispatch(context.Background(), msg)
			if api.lastText() != RussianReplies.LinkDisabled {
				t.Fatalf("want LinkDisabled reply, got %q", api.lastText())
			}
			// Главное: prefs НЕ модифицированы — никакого chat_id не записано.
			if len(prefs.set) != 0 {
				t.Fatalf("handleLink must not call SetTelegramChatID; got %+v", prefs.set)
			}
		})
	}
}

// TestDispatch_Unlink_Disabled — /unlink тоже отключён (аналогичный security
// rationale: старая реализация резолвила user_id по Telegram username, что
// не давало гарантии владения druz9-аккаунтом).
func TestDispatch_Unlink_Disabled(t *testing.T) {
	api := &fakeAPI{}
	prefs := newFakePrefs()
	uid := uuid.New()
	users := &fakeUsers{byUsername: map[string]uuid.UUID{"alice": uid}}
	bot := newTestBot(api, prefs, users)
	msg := makeMsg("unlink", "", "alice", 1234)
	_ = bot.dispatch.Dispatch(context.Background(), msg)
	if api.lastText() != RussianReplies.LinkDisabled {
		t.Fatalf("want LinkDisabled reply, got %q", api.lastText())
	}
	if len(prefs.clear) != 0 {
		t.Fatalf("handleUnlink must not call ClearTelegramChatID; got %+v", prefs.clear)
	}
}

func TestDispatch_UnknownCommand(t *testing.T) {
	api := &fakeAPI{}
	bot := newTestBot(api, newFakePrefs(), &fakeUsers{})
	msg := makeMsg("wat", "", "alice", 42)
	_ = bot.dispatch.Dispatch(context.Background(), msg)
	if api.lastText() != RussianReplies.UnknownCommand {
		t.Fatalf("got %q", api.lastText())
	}
}

func TestDispatch_Streak_Stub(t *testing.T) {
	api := &fakeAPI{}
	bot := newTestBot(api, newFakePrefs(), &fakeUsers{})
	msg := makeMsg("streak", "", "alice", 42)
	_ = bot.dispatch.Dispatch(context.Background(), msg)
	if api.lastText() != RussianReplies.StreakStub {
		t.Fatalf("got %q", api.lastText())
	}
}

func TestDispatch_Leaderboard_Stub(t *testing.T) {
	api := &fakeAPI{}
	bot := newTestBot(api, newFakePrefs(), &fakeUsers{})
	msg := makeMsg("leaderboard", "", "alice", 42)
	_ = bot.dispatch.Dispatch(context.Background(), msg)
	if api.lastText() != RussianReplies.LeaderboardStub {
		t.Fatalf("got %q", api.lastText())
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
	api := &fakeAPI{}
	bot := newTestBot(api, newFakePrefs(), &fakeUsers{})
	msg := &tgbotapi.Message{Chat: &tgbotapi.Chat{ID: 1}, Text: "hello"}
	if err := bot.dispatch.Dispatch(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	if len(api.sent) != 0 {
		t.Fatalf("expected no replies, got %d", len(api.sent))
	}
}

// Sanity: an error from a handler propagates up but is non-fatal for the
// webhook (the caller logs + returns 200).
func TestDispatch_HandlerError(t *testing.T) {
	api := &fakeAPI{}
	bot := newTestBot(api, newFakePrefs(), &fakeUsers{})
	// Overwrite the start handler to fail.
	bot.dispatch.handlers["start"] = func(ctx context.Context, msg *tgbotapi.Message, args []string) error {
		return errors.New("boom")
	}
	msg := makeMsg("start", "", "alice", 1)
	err := bot.dispatch.Dispatch(context.Background(), msg)
	if err == nil || err.Error() != "boom" {
		t.Fatalf("want boom, got %v", err)
	}
}
