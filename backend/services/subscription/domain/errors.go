package domain

import "errors"

// ErrNotFound — подписка для user'а не найдена. Use-case слой трактует это
// как TierFree (не ошибка UX), но infra возвращает для возможности маршрута
// на Insert vs Update в Upsert-сценариях.
var ErrNotFound = errors.New("subscription: not found")

// ErrInvalidTier — значение Tier не входит в enum. Защищает Admin-path от
// записи мусора в БД.
var ErrInvalidTier = errors.New("subscription: invalid tier")

// ErrInvalidBYOKProvider — provider не входит в whitelist BYOK-providers.
var ErrInvalidBYOKProvider = errors.New("subscription: invalid byok provider")

// ErrBYOKValidationFailed — provider отверг присланный ключ (401/403/rate-limit).
var ErrBYOKValidationFailed = errors.New("subscription: byok validation failed")

// ErrBYOKEncryption — failure внутри Encrypt/Decrypt. Signals infra issue.
var ErrBYOKEncryption = errors.New("subscription: byok encryption error")

// ErrInvalidWebhookSignature — Stripe webhook payload signature mismatch.
// Caller возвращает 400 (а не 401), потому что Stripe ретраит на 5xx.
var ErrInvalidWebhookSignature = errors.New("subscription: invalid stripe webhook signature")

// ErrStripeAPI — failure из Stripe HTTP API (non-2xx). Caller трактует
// как infra-проблему.
var ErrStripeAPI = errors.New("subscription: stripe api error")

// ErrStripeNotConfigured — required env vars пусты. Caller возвращает 503.
var ErrStripeNotConfigured = errors.New("subscription: stripe not configured")
