// Package subclient — тонкий Go-клиент для централизованного subscription-
// сервиса druz9.
//
// Назначение: внешние проекты (Hone, будущие) должны уметь спросить tier
// пользователя, не зная деталей БД и SubscriptionRepo. Клиент ходит в
// Connect-RPC endpoint druz9-monolith'а (или отдельный subscription-сервис
// в будущем) через сеть.
//
// Endpoint: `{base}/druz9.v1.SubscriptionService/GetTierByUserID` (Connect
// wire protocol, JSON). Bearer-token в заголовке, cross-service SSL обязателен
// при cross-VPS деплое; для within-app-net достаточно http+секрета.
//
// Fail-open: любая сетевая ошибка → TierFree + log WARN. Мотивация: tier —
// non-critical для ядра продукта. Юзер не должен получить 500 из-за того
// что subscription-сервис недоступен; деградация до free — приемлема, а
// оплативший пользователь получит tier обратно при следующем запросе
// когда связь восстановится.
//
// Пример использования:
//
//	client := subclient.New("http://druz9-api:8080", os.Getenv("DRUZ9_INTERNAL_TOKEN"))
//	tier, _ := client.GetTier(ctx, userID.String())
//	if !subclient.HasAccess(tier, subclient.TierSeeker) {
//	    return errUpgradeRequired
//	}
package subclient
