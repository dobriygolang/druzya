// regen_speaking_tts — bulk regenerate reference TTS audio для speaking
// exercises. Phase K Wave 9 (E4 P1) — admin-trigger CLI; not part of
// boot path, runs manually когда:
//
//   - 15 baseline rows seeded в migration 00105 (initial audio_url=NULL);
//   - admin меняет TTS provider (Cloudflare → Google) и хочет refresh;
//   - admin changes prompt text (rare) и хочет нового TTS клипа.
//
// Идемпотентен: skip'ает rows которые уже имеют audio_url, unless
// `--force`. На каждой row'е reuses в same Provider + AudioStore которые
// monolith bootstrap'ит — никаких отдельных API key configurations.
//
// Usage:
//
//	export POSTGRES_DSN='postgres://druz9:druz9@localhost:5432/druz9?sslmode=disable'
//	export CLOUDFLARE_API_KEY='...'
//	export CLOUDFLARE_ACCOUNT_ID='...'
//	export MINIO_ENDPOINT='localhost:9000'
//	export MINIO_ACCESS_KEY='minioadmin'
//	export MINIO_SECRET_KEY='minioadmin'
//	export MINIO_PUBLIC_ENDPOINT='http://localhost:9000'
//
//	regen_speaking_tts            # generates только missing audio_url
//	regen_speaking_tts --force    # rewrites ВСЕХ rows
//	regen_speaking_tts --id algo-1 --force  # одна row
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	honeApp "druz9/hone/app"
	honeInfra "druz9/hone/infra"
	"druz9/shared/pkg/tts"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	var (
		force      = flag.Bool("force", false, "regenerate even when audio_url already set")
		onlyID     = flag.String("id", "", "regen only this exercise id (default: all rows)")
		dsn        = flag.String("dsn", env("POSTGRES_DSN", ""), "Postgres DSN")
		cfAPIKey   = flag.String("cf-api-key", env("CLOUDFLARE_API_KEY", ""), "Cloudflare API key")
		cfAcct     = flag.String("cf-account-id", env("CLOUDFLARE_ACCOUNT_ID", ""), "Cloudflare account ID")
		minioEP    = flag.String("minio-endpoint", env("MINIO_ENDPOINT", ""), "MinIO endpoint (e.g. minio:9000)")
		minioPub   = flag.String("minio-public", env("MINIO_PUBLIC_ENDPOINT", ""), "MinIO public endpoint (for presigned URLs)")
		minioAK    = flag.String("minio-access-key", env("MINIO_ACCESS_KEY", ""), "MinIO access key")
		minioSK    = flag.String("minio-secret-key", env("MINIO_SECRET_KEY", ""), "MinIO secret key")
		minioSSL   = flag.Bool("minio-ssl", envBool("MINIO_USE_SSL", false), "MinIO endpoint over HTTPS")
		ctxTimeout = flag.Duration("timeout", 5*time.Minute, "overall timeout for the run")
	)
	flag.Parse()

	if *dsn == "" {
		log.Fatal("POSTGRES_DSN required (env or --dsn)")
	}
	if *cfAPIKey == "" || *cfAcct == "" {
		log.Fatal("CLOUDFLARE_API_KEY + CLOUDFLARE_ACCOUNT_ID required")
	}
	if *minioEP == "" || *minioAK == "" || *minioSK == "" {
		log.Fatal("MINIO_ENDPOINT + MINIO_ACCESS_KEY + MINIO_SECRET_KEY required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), *ctxTimeout)
	defer cancel()

	pool, err := pgxpool.New(ctx, *dsn)
	if err != nil {
		log.Fatalf("pgxpool: %v", err)
	}
	defer pool.Close()

	repo := honeInfra.NewSpeakingExerciseRepo(pool)
	provider := tts.NewCloudflare(*cfAPIKey, *cfAcct)
	if provider == nil {
		log.Fatal("cloudflare provider creation failed (empty key/account)")
	}
	store := tts.NewMinIOStore(*minioEP, *minioPub, *minioAK, *minioSK, "tts-audio", *minioSSL)
	if err := store.EnsureBucket(ctx); err != nil {
		log.Fatalf("minio EnsureBucket: %v", err)
	}

	uc := &honeApp.GenerateSpeakingTTS{
		Exercises: repo,
		Provider:  provider,
		Store:     store,
	}

	items, err := repo.List(ctx, "")
	if err != nil {
		log.Fatalf("list speaking_exercises: %v", err)
	}
	if *onlyID != "" {
		filtered := items[:0]
		for _, it := range items {
			if it.ID == *onlyID {
				filtered = append(filtered, it)
			}
		}
		items = filtered
		if len(items) == 0 {
			log.Fatalf("no exercise with id=%q found", *onlyID)
		}
	}

	var ok, skipped, failed int
	for i, ex := range items {
		if !*force && ex.AudioURL != "" {
			fmt.Printf("[%d/%d] %s — skip (audio_url present, --force to overwrite)\n",
				i+1, len(items), ex.ID)
			skipped++
			continue
		}
		fmt.Printf("[%d/%d] %s — synthesise (%d chars, level=%s)…\n",
			i+1, len(items), ex.ID, len(ex.Prompt), ex.Level)
		res, err := uc.Do(ctx, honeApp.GenerateSpeakingTTSInput{
			ExerciseID: ex.ID,
			Force:      *force,
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "  ERROR: %v\n", err)
			failed++
			if errors.Is(err, tts.ErrUnavailable) {
				// Hard stop — последующие тоже упадут.
				break
			}
			continue
		}
		fmt.Printf("  ok: %s\n", trimURL(res.AudioURL))
		ok++
	}
	fmt.Printf("\nDone: ok=%d skipped=%d failed=%d total=%d\n", ok, skipped, failed, len(items))
	if failed > 0 {
		os.Exit(1)
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	v := os.Getenv(key)
	switch v {
	case "1", "true", "TRUE", "True", "yes", "on":
		return true
	case "0", "false", "FALSE", "False", "no", "off":
		return false
	}
	return def
}

// trimURL — keep stdout readable; presigned URLs могут быть длинные.
func trimURL(u string) string {
	if len(u) < 96 {
		return u
	}
	return u[:80] + "…(" + fmt.Sprint(len(u)) + " chars)"
}
