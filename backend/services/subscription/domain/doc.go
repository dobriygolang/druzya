// Package domain — доменная модель централизованного subscription-сервиса.
//
// Назначение: единый источник правды о tier'е (free/seeker/ascendant) для
// всей экосистемы (druz9, Hone, будущие). Хранит статус подписки, срок
// действия, провайдера оплаты.
//
// Ключевые решения:
//
//   - Tier = alias на shared/enums.SubscriptionPlan. Не создаём дубль —
//     enum живёт в shared и уже используется profile/ai_mock/ai_native.
//
//   - Grace period 24h поверх current_period_end. Boosty sync делается
//     polling'ом раз в 30 мин (M3) → до суток latency возможно. Grace
//     гарантирует что легитимно оплативший юзер не получит внезапный
//     403 пока наш worker не подтянул renewal.
//
//   - UseCase.GetTier НЕ бросает ErrNotFound — возвращает TierFree. Юзер
//     без строки в subscriptions = фактически free-план. Это упрощает
//     каллер-код: нет разветвления на "нет записи" vs "free-запись".
//
//   - AdminSetTier — единственный runtime-писатель до M3. M3 добавит
//     BoostySyncWorker как второго писателя (та же Upsert семантика).
package domain
