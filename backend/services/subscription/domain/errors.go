package domain

import "errors"

// ErrNotFound — подписка для user'а не найдена. Use-case слой трактует это
// как TierFree (не ошибка UX), но infra возвращает для возможности маршрута
// на Insert vs Update в Upsert-сценариях.
var ErrNotFound = errors.New("subscription: not found")

// ErrInvalidTier — значение Tier не входит в enum. Защищает Admin-path от
// записи мусора в БД.
var ErrInvalidTier = errors.New("subscription: invalid tier")
