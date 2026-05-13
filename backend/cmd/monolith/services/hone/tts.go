// tts.go — Phase K Wave 9 (E4 P1) TTS provider + MinIO store wiring.
//
// Free-tier cascade: Cloudflare MeloTTS only пока (`@cf/myshell-ai/melotts`)
// — Sergey's rule "free LLM only", cascade в feedback_providers.md
// ставит cloudflare на 4-м месте и MeloTTS уже работает на shared 10k
// neurons/day. Groq PlayAI TTS и Google TTS — future drop-in
// implementations того же `tts.Provider` interface.
//
// Returns nil-safe components: если CF/MinIO не сконфигурены — UC получит
// Unconfigured provider / nil store и вернёт 503 с понятным сообщением.
package hone

import (
	"context"
	"log/slog"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	"druz9/shared/pkg/tts"
)

// buildTTSProvider — cascade picker. На данном этапе только Cloudflare;
// добавление Groq PlayAI / Google = same Provider interface, wire'ить
// тут в order'е по cfg.LLMChain.ChainOrder.
func buildTTSProvider(d monolithServices.Deps) tts.Provider {
	if cf := tts.NewCloudflare(
		d.Cfg.LLMChain.CloudflareAPIKey,
		d.Cfg.LLMChain.CloudflareAccountID,
	); cf != nil {
		d.Log.Info("hone: TTS provider wired (Cloudflare MeloTTS)")
		return cf
	}
	d.Log.Warn("hone: TTS provider unwired (CLOUDFLARE_API_KEY + CLOUDFLARE_ACCOUNT_ID required) — speaking exercise audio_url regen will return 503")
	return tts.NewUnconfigured()
}

// buildTTSStore — MinIO bucket store for `tts-audio`. Bootstrap-time
// EnsureBucket call removes the «operator must `mc mb minio/tts-audio`
// manually» foot-gun (same pattern as podcast minio store). Returns nil
// when MinIO unwired; caller passes nil into UC which returns 503.
func buildTTSStore(d monolithServices.Deps) tts.AudioStore {
	if d.Cfg.MinIO.AccessKey == "" || d.Cfg.MinIO.SecretKey == "" || d.Cfg.MinIO.Endpoint == "" {
		d.Log.Warn("hone: TTS store unwired (MINIO_* envs required) — speaking exercise audio regen will return 503")
		return nil
	}
	store := tts.NewMinIOStore(
		d.Cfg.MinIO.Endpoint,
		d.Cfg.MinIO.PublicEndpoint,
		d.Cfg.MinIO.AccessKey,
		d.Cfg.MinIO.SecretKey,
		"tts-audio",
		d.Cfg.MinIO.UseSSL,
	)
	bootCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := store.EnsureBucket(bootCtx); err != nil {
		d.Log.Warn("hone: TTS minio EnsureBucket failed; manual `mc mb` may be required",
			slog.String("bucket", "tts-audio"),
			slog.Any("err", err))
	}
	d.Log.Info("hone: TTS storage wired (MinIO bucket `tts-audio`)")
	return store
}
