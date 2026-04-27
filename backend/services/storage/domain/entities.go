package domain

// Quota описывает текущее storage-использование юзера и его тариф.
// UsedBytes пересчитывается hourly cron'ом (см. RecomputeUsage); QuotaBytes
// и Tier приходят из subscription-домена через колонки в users.
type Quota struct {
	UsedBytes  int64
	QuotaBytes int64
	Tier       string
}
