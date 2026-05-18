// Package domain — доменная модель централизованного subscription-сервиса.
//
// Назначение: единый источник правды о tier'е (free/pro/max) для всей
// экосистемы. Хранит статус подписки, срок действия, провайдера оплаты.
//
// Ключевые решения:
//
//   - Tier = alias на shared/enums.SubscriptionPlan; не создаём дубль —
//     enum уже используется profile/ai_mock/ai_native.
//
//   - Grace period 24h поверх current_period_end — sync-задержка провайдера
//     не должна давать внезапный 403 легитимно оплатившему юзеру.
//
//   - GetTier НЕ бросает ErrNotFound — возвращает TierFree. Отсутствие записи
//     эквивалентно free-плану; не плодим if-ветки у callers.
package domain
