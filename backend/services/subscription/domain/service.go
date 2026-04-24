package domain

// TierRank даёт монотонный int для сравнения tier'ов: 0 = free, 1 = seeker,
// 2 = ascendant. Неизвестные значения трактуются как 0 (safe default — никогда
// не повышаем доступ для странного input'а).
func TierRank(t Tier) int {
	switch t {
	case TierFree:
		return 0
	case TierSeeker:
		return 1
	case TierAscended:
		return 2
	}
	return 0
}

// HasAccess проверяет что user имеет tier >= required. Используется как
// гейт для paywall'ов (LLM-роутер, premium-фичи).
//
// Пример:
//
//	if !domain.HasAccess(userTier, domain.TierSeeker) {
//	    return ErrUpgradeRequired
//	}
func HasAccess(userTier, required Tier) bool {
	return TierRank(userTier) >= TierRank(required)
}
