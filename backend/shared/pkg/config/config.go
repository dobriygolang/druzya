package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config — статическая конфигурация приложения, загружаемая на старте.
// Параметры, изменяемые в runtime, живут в dynamic_config (PostgreSQL + Redis Pub/Sub).
type Config struct {
	Env         string
	HTTPAddr    string
	PostgresDSN string
	RedisAddr   string
	RedisPass   string

	MinIO struct {
		Endpoint  string
		AccessKey string
		SecretKey string
		UseSSL    bool
	}

	ClickHouse struct {
		Addr     string
		Database string
		Username string
		Password string
	}

	Judge0 struct {
		URL string
	}

	Auth struct {
		JWTSecret        string
		AccessTokenTTL   int // секунды
		RefreshTokenTTL  int
		YandexClientID   string
		YandexSecret     string
		TelegramBotToken string
		TelegramBotName  string // имя бота без @, используется в deep-link `https://t.me/<name>?start=<code>`
		TelegramCodeTTL  int    // TTL deep-link кода в секундах (default 300)
	}

	LLM struct {
		OpenRouterAPIKey string
		DefaultModelFree string
		DefaultModelPaid string
	}

	// LLMChain is the multi-provider routing config. Any/all API keys
	// may be empty — the chain's wirer skips drivers without a key and
	// emits a startup WARN. OpenRouter key is re-read from LLM above
	// (kept separate there for back-compat with legacy callers).
	//
	// ChainOrder is a comma-separated priority list: front = primary.
	// Empty defaults to "groq,cerebras,openrouter" — Mistral omitted
	// unless the operator explicitly opts in, because its free tier
	// has tighter limits than Groq/Cerebras.
	Subscription struct {
		// Boosty — long-lived creator access_token (получен вручную в личном
		// кабинете boosty.to/{creator}/settings/apps и положен в env). Если
		// пусто — sync worker не стартует, tier выставляется только через
		// admin-endpoint.
		BoostyAccessToken string
		BoostyBlogSlug    string // URL-slug блога (boosty.to/{this_slug})
		// TierMapping — формат "Поддержка:seeker,Вознёсшийся:ascendant".
		// Ключ — exact имя уровня у Boosty (Cyrillic sensitive), значение —
		// наш tier free|seeker|ascendant. Пустое → sync не сможет маппить
		// tier'ы и будет все их пропускать с bad_tier-инкрементом.
		BoostyTierMapping string
	}

	LLMChain struct {
		GroqAPIKey     string
		CerebrasAPIKey string
		MistralAPIKey  string
		// DeepSeekAPIKey — платный provider для paid-lane (deepseek-chat
		// V3 и deepseek-reasoner R1). Используется в virtual-chain'ах
		// druz9/pro и druz9/reasoning. Пустая строка → driver не регится,
		// pro/reasoning chain работает только через OpenRouter paid-models.
		DeepSeekAPIKey string
		// OllamaHost — base URL локального Ollama sidecar'а
		// ("http://ollama:11434" в docker-compose). Пустая строка —
		// сервис не зарегистрирован, всё работает как раньше (cloud-only).
		// Self-hosted safety net против исчерпания free-tier cloud квот.
		OllamaHost string
		ChainOrder string
	}

	Notify struct {
		TelegramBotToken      string
		TelegramWebhookSecret string
		PublicBaseURL         string
		SMTPHost              string
		SMTPPort              int
		SMTPUser              string
		SMTPPass              string
	}
}

// Load читает конфигурацию из переменных окружения. Падает сразу, если обязательные поля отсутствуют.
func Load() (Config, error) {
	c := Config{
		Env:         env("APP_ENV", "local"),
		HTTPAddr:    env("HTTP_ADDR", ":8080"),
		PostgresDSN: mustEnv("POSTGRES_DSN"),
		RedisAddr:   env("REDIS_ADDR", "redis:6379"),
		RedisPass:   env("REDIS_PASSWORD", ""),
	}

	// MinIO is optional at Load() — migrate-only invocations of the binary
	// have no business requiring object-storage config. Modules that
	// actually use MinIO (replay storage, attachments, …) must validate
	// Endpoint/AccessKey/SecretKey at their own constructor and fail loudly
	// there if the operator forgot to set them in production.
	c.MinIO.Endpoint = env("MINIO_ENDPOINT", "")
	c.MinIO.AccessKey = env("MINIO_ACCESS_KEY", "")
	c.MinIO.SecretKey = env("MINIO_SECRET_KEY", "")
	c.MinIO.UseSSL = envBool("MINIO_USE_SSL", false)

	c.ClickHouse.Addr = env("CLICKHOUSE_ADDR", "clickhouse:9000")
	c.ClickHouse.Database = env("CLICKHOUSE_DB", "druz9")
	c.ClickHouse.Username = env("CLICKHOUSE_USER", "default")
	c.ClickHouse.Password = env("CLICKHOUSE_PASSWORD", "")

	c.Judge0.URL = env("JUDGE0_URL", "http://judge0-server:2358")

	c.Auth.JWTSecret = mustEnv("JWT_SECRET")
	// Default access TTL bumped from 15 min → 24 h: the previous 900s window
	// caused users to be silently kicked out mid-session ("постоянно
	// авторизация спадает") because the SPA had no transparent refresh path.
	// The frontend now also runs a silent-refresh timer at ~80% of TTL, so a
	// 24 h floor gives a comfortable buffer even with intermittent networks.
	c.Auth.AccessTokenTTL = envInt("JWT_ACCESS_TTL", 86400)
	c.Auth.RefreshTokenTTL = envInt("JWT_REFRESH_TTL", 2592000)
	c.Auth.YandexClientID = env("YANDEX_CLIENT_ID", "")
	c.Auth.YandexSecret = env("YANDEX_CLIENT_SECRET", "")
	c.Auth.TelegramBotToken = env("TELEGRAM_BOT_TOKEN", "")
	c.Auth.TelegramBotName = env("TELEGRAM_BOT_NAME", "")
	c.Auth.TelegramCodeTTL = envInt("TELEGRAM_CODE_TTL", 300)

	c.LLM.OpenRouterAPIKey = env("OPENROUTER_API_KEY", "")
	c.LLM.DefaultModelFree = env("LLM_DEFAULT_FREE", "openai/gpt-4o-mini")
	c.LLM.DefaultModelPaid = env("LLM_DEFAULT_PAID", "openai/gpt-4o")

	c.LLMChain.GroqAPIKey = env("GROQ_API_KEY", "")
	c.LLMChain.CerebrasAPIKey = env("CEREBRAS_API_KEY", "")
	c.LLMChain.MistralAPIKey = env("MISTRAL_API_KEY", "")
	c.LLMChain.DeepSeekAPIKey = env("DEEPSEEK_API_KEY", "")
	c.Subscription.BoostyAccessToken = env("BOOSTY_ACCESS_TOKEN", "")
	c.Subscription.BoostyBlogSlug = env("BOOSTY_BLOG_SLUG", "")
	c.Subscription.BoostyTierMapping = env("BOOSTY_TIER_MAPPING", "")
	c.LLMChain.OllamaHost = env("OLLAMA_HOST", "")
	c.LLMChain.ChainOrder = env("LLM_CHAIN_ORDER", "groq,cerebras,openrouter")

	c.Notify.TelegramBotToken = c.Auth.TelegramBotToken
	c.Notify.TelegramWebhookSecret = env("TELEGRAM_WEBHOOK_SECRET", "")
	c.Notify.PublicBaseURL = env("PUBLIC_BASE_URL", "")
	c.Notify.SMTPHost = env("SMTP_HOST", "")
	c.Notify.SMTPPort = envInt("SMTP_PORT", 587)
	c.Notify.SMTPUser = env("SMTP_USER", "")
	c.Notify.SMTPPass = env("SMTP_PASS", "")

	return c, nil
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return v
	}
	return def
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if strings.TrimSpace(v) == "" {
		panic(fmt.Sprintf("config: required env variable %q is not set", key))
	}
	return v
}

func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func envBool(key string, def bool) bool {
	v := strings.ToLower(os.Getenv(key))
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return def
}
