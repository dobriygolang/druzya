package llmcache

import "context"

// Embedder — единственный контракт между кешем и векторизатором. Внедряется
// через Options при конструировании SemanticCache. Unit-тесты пакета
// подменяют его fake-реализацией (детерминированный псевдо-вектор от
// seed(prompt)) — реальный OllamaEmbedder тестируется через httptest.
//
// Контракт:
//   - Embed возвращает L2-нормализованный float32 вектор длины Dim().
//     Нормализация важна: косинусную близость мы считаем как dot-product,
//     что корректно ТОЛЬКО для unit-length векторов. bge-small-en и так
//     возвращает нормализованные векторы, но OllamaEmbedder re-normalize
//     на выходе на всякий случай (invariant cheap, ~1µs).
//   - Dim() — константа, известная без сетевого вызова. Для bge-small-en
//     это 384. Конструктор embedder'а НЕ должен ходить в сеть — инициа-
//     лизация пакета должна быть sync-safe.
//   - Любая ошибка (network/timeout/5xx) возвращается из Embed наверх.
//     SemanticCache.Lookup при ошибке embedder'а возвращает (_, false, err),
//     CachingChain трактует это как miss и делегирует Chain'у.
type Embedder interface {
	Embed(ctx context.Context, text string) ([]float32, error)
	Dim() int
}
