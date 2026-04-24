package llmcache

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync/atomic"
	"testing"

	"druz9/shared/pkg/llmchain"
)

// fakeChain — реализует llmchain.ChatClient.
type fakeChain struct {
	chatCalls   int32
	streamCalls int32
	chatResp    llmchain.Response
	chatErr     error
}

func (f *fakeChain) Chat(_ context.Context, _ llmchain.Request) (llmchain.Response, error) {
	atomic.AddInt32(&f.chatCalls, 1)
	return f.chatResp, f.chatErr
}

func (f *fakeChain) ChatStream(_ context.Context, _ llmchain.Request) (<-chan llmchain.StreamEvent, error) {
	atomic.AddInt32(&f.streamCalls, 1)
	ch := make(chan llmchain.StreamEvent)
	close(ch)
	return ch, nil
}

// fakeCache — контролируемый mock Cache.
type fakeCache struct {
	lookupHit    bool
	lookupResp   llmchain.Response
	lookupErr    error
	lookupCalls  int32
	storeCalls   int32
	lastStoreKey string
	closeCalls   int32
}

func (f *fakeCache) Lookup(_ context.Context, _ llmchain.Task, _ string) (llmchain.Response, bool, error) {
	atomic.AddInt32(&f.lookupCalls, 1)
	return f.lookupResp, f.lookupHit, f.lookupErr
}

func (f *fakeCache) Store(_ context.Context, _ llmchain.Task, key string, _ llmchain.Response) error {
	atomic.AddInt32(&f.storeCalls, 1)
	f.lastStoreKey = key
	return nil
}

func (f *fakeCache) Close() error {
	atomic.AddInt32(&f.closeCalls, 1)
	return nil
}

func discardLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestCachingChain_HitReturnsCache(t *testing.T) {
	cached := llmchain.Response{Content: "from cache"}
	chain := &fakeChain{}
	cache := &fakeCache{lookupHit: true, lookupResp: cached}
	cc := &CachingChain{Chain: chain, Cache: cache, Log: discardLog()}

	resp, err := cc.Chat(context.Background(), llmchain.Request{
		Task:     llmchain.TaskVacanciesJSON,
		Messages: []llmchain.Message{{Role: llmchain.RoleUser, Content: "hello"}},
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if resp.Content != "from cache" {
		t.Fatalf("want cached content, got %q", resp.Content)
	}
	if atomic.LoadInt32(&chain.chatCalls) != 0 {
		t.Fatalf("underlying chain must not be called on hit")
	}
	if atomic.LoadInt32(&cache.storeCalls) != 0 {
		t.Fatalf("must not store on hit")
	}
}

func TestCachingChain_MissDelegatesAndStores(t *testing.T) {
	chain := &fakeChain{chatResp: llmchain.Response{Content: "from llm"}}
	cache := &fakeCache{lookupHit: false}
	cc := &CachingChain{Chain: chain, Cache: cache, Log: discardLog()}

	resp, err := cc.Chat(context.Background(), llmchain.Request{
		Task:     llmchain.TaskVacanciesJSON,
		Messages: []llmchain.Message{{Role: llmchain.RoleUser, Content: "hello"}},
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if resp.Content != "from llm" {
		t.Fatalf("want llm content, got %q", resp.Content)
	}
	if atomic.LoadInt32(&chain.chatCalls) != 1 {
		t.Fatalf("chain must be called on miss")
	}
	if atomic.LoadInt32(&cache.storeCalls) != 1 {
		t.Fatalf("cache store must be called on miss+success")
	}
}

func TestCachingChain_LookupErrorFallsThrough(t *testing.T) {
	chain := &fakeChain{chatResp: llmchain.Response{Content: "from llm"}}
	cache := &fakeCache{lookupErr: errors.New("embed down")}
	cc := &CachingChain{Chain: chain, Cache: cache, Log: discardLog()}

	resp, err := cc.Chat(context.Background(), llmchain.Request{
		Task:     llmchain.TaskVacanciesJSON,
		Messages: []llmchain.Message{{Role: llmchain.RoleUser, Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("lookup error must NOT bubble; got %v", err)
	}
	if resp.Content != "from llm" {
		t.Fatalf("want llm content, got %q", resp.Content)
	}
	if atomic.LoadInt32(&chain.chatCalls) != 1 {
		t.Fatalf("chain must be called when lookup errors")
	}
}

func TestCachingChain_ModelOverrideSkipsCache(t *testing.T) {
	chain := &fakeChain{chatResp: llmchain.Response{Content: "pinned"}}
	cache := &fakeCache{}
	cc := &CachingChain{Chain: chain, Cache: cache, Log: discardLog()}

	_, err := cc.Chat(context.Background(), llmchain.Request{
		ModelOverride: "groq/llama-3.3-70b-versatile",
		Messages:      []llmchain.Message{{Role: llmchain.RoleUser, Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if atomic.LoadInt32(&cache.lookupCalls) != 0 {
		t.Fatalf("must not lookup when ModelOverride set")
	}
	if atomic.LoadInt32(&cache.storeCalls) != 0 {
		t.Fatalf("must not store when ModelOverride set")
	}
}

func TestCachingChain_StreamNeverTouchesCache(t *testing.T) {
	chain := &fakeChain{}
	cache := &fakeCache{}
	cc := &CachingChain{Chain: chain, Cache: cache, Log: discardLog()}

	_, err := cc.ChatStream(context.Background(), llmchain.Request{
		Task:     llmchain.TaskCopilotStream,
		Messages: []llmchain.Message{{Role: llmchain.RoleUser, Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if atomic.LoadInt32(&cache.lookupCalls) != 0 {
		t.Fatalf("ChatStream must not consult cache")
	}
	if atomic.LoadInt32(&chain.streamCalls) != 1 {
		t.Fatalf("ChatStream must delegate to chain")
	}
}

func TestCachingChain_ChainErrorSkipsStore(t *testing.T) {
	chain := &fakeChain{chatErr: errors.New("boom")}
	cache := &fakeCache{}
	cc := &CachingChain{Chain: chain, Cache: cache, Log: discardLog()}

	_, err := cc.Chat(context.Background(), llmchain.Request{
		Task:     llmchain.TaskVacanciesJSON,
		Messages: []llmchain.Message{{Role: llmchain.RoleUser, Content: "x"}},
	})
	if err == nil {
		t.Fatalf("want chain error to bubble")
	}
	if atomic.LoadInt32(&cache.storeCalls) != 0 {
		t.Fatalf("must not cache on chain error")
	}
}

func TestBuildCacheKey_Deterministic(t *testing.T) {
	req := llmchain.Request{
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: "you are a helper"},
			{Role: llmchain.RoleUser, Content: "parse this vacancy"},
		},
	}
	k1 := BuildCacheKey(req)
	k2 := BuildCacheKey(req)
	if k1 != k2 {
		t.Fatalf("BuildCacheKey must be deterministic")
	}
	if k1 == "" {
		t.Fatalf("BuildCacheKey must produce non-empty key")
	}
}

func TestNoopCache_AllMiss(t *testing.T) {
	c := NoopCache{}
	_, hit, err := c.Lookup(context.Background(), llmchain.TaskVacanciesJSON, "anything")
	if err != nil {
		t.Fatalf("noop lookup must not error: %v", err)
	}
	if hit {
		t.Fatalf("noop lookup must never hit")
	}
	if err := c.Store(context.Background(), llmchain.TaskVacanciesJSON, "k", llmchain.Response{}); err != nil {
		t.Fatalf("noop store must not error: %v", err)
	}
	if err := c.Close(); err != nil {
		t.Fatalf("noop close: %v", err)
	}
}
