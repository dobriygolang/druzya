package llmchain

import (
	"context"
	"fmt"
)

// Cloudflare Workers AI (https://developers.cloudflare.com/workers-ai/)
// exposes an OpenAI-compatible chat-completions shim at
// /accounts/{ACCOUNT_ID}/ai/v1/chat/completions. The account-scoped URL
// plus a Bearer token are both required — one without the other is
// always 401.
//
// ⚠️  ВАЖНО: free-tier = 10k neurons/day per account. Для Llama-70B
// один inference ~50-400 neurons, что даёт реально **50-200 запросов/день
// суммарно на весь аккаунт** — для prod-scale с 10k MAU это копейки.
// Практически CF Workers AI — **платный** для любого серьёзного
// использования. Драйвер остаётся как **опциональное расширение**:
// регистрируется только если оператор задал оба секрета (ACCOUNT_ID +
// TOKEN) в env и готов платить за overage. В DefaultTaskModelMap CF НЕ
// включён — чтобы не вводить операторов в заблуждение о "бесплатности".
//
// Model id format: Cloudflare uses `@cf/<vendor>/<model>` — the leading
// "@cf/" is part of the id, not a prefix we strip. We deliberately do
// NOT use ModelOverride with CF ids because the openAIDriver's
// stripProviderPrefix would strip "@cf" and break the call; task-based
// routing (Task → TaskModelMap lookup) is the only supported path.
//
// Rate-limit headers: CF emits Cloudflare-proprietary quota headers
// (`x-cloudflare-ai-quota-*`) rather than the OpenAI `x-ratelimit-*`
// family. ratelimit.go's generic branch silently ignores them, which
// means we get REACTIVE-only cooldown (on 429) for this provider. That
// is acceptable — the chain's post-429 cooldown is the same 30s window
// we use for Mistral (which also lacks usable proactive headers).
//
// cloudflareEndpointTemplate has one printf verb: the account ID.
const cloudflareEndpointTemplate = "https://api.cloudflare.com/client/v4/accounts/%s/ai/v1/chat/completions"

// NewCloudflareAIDriver constructs the Cloudflare Workers AI driver.
// BOTH accountID and apiToken are required. Empty either ⇒ the wirer
// must skip registration — we do not silently construct a driver that
// will only ever return 404 (missing accountID) or 401 (missing token),
// as that would waste one chain hop per request.
func NewCloudflareAIDriver(accountID, apiToken string) Driver {
	endpoint := fmt.Sprintf(cloudflareEndpointTemplate, accountID)
	d := newOpenAIDriver(ProviderCloudflareAI, apiToken, endpoint)
	d.supportsJSONMode = true
	d.supportsVision = false
	return &cloudflareDriver{openAIDriver: d}
}

type cloudflareDriver struct{ *openAIDriver }

// Chat / ChatStream deliberately bypass the shared
// stripProviderPrefix logic by zeroing ModelOverride on a local copy —
// CF model ids start with `@cf/<vendor>/<model>` and the leading
// segment is semantically part of the id, not a routing prefix we can
// strip. Same trick the OpenRouter driver uses.
func (c *cloudflareDriver) Chat(ctx context.Context, model string, req Request) (Response, error) {
	reqCopy := req
	reqCopy.ModelOverride = ""
	return c.openAIDriver.Chat(ctx, model, reqCopy)
}

func (c *cloudflareDriver) ChatStream(ctx context.Context, model string, req Request) (<-chan StreamEvent, error) {
	reqCopy := req
	reqCopy.ModelOverride = ""
	return c.openAIDriver.ChatStream(ctx, model, reqCopy)
}
