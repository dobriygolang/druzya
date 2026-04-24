package llmcache

import (
	"github.com/prometheus/client_golang/prometheus"

	sharedMetrics "druz9/shared/pkg/metrics"
)

// Метрики пакета — пять штук, покрывают весь жизненный цикл entry:
//
//	druz9_llmcache_lookup_total{task,result}
//	    — result ∈ {hit, miss, error, disabled}. "disabled" — это NoopCache-
//	      путь (wirer не собрал полного embedder+redis), "error" — embedder
//	      или Redis сдох. Коэффициент hit / (hit+miss) — KPI пакета.
//
//	druz9_llmcache_store_total{task,result}
//	    — result ∈ {stored, dropped, error}. "dropped" = переполнение
//	      worker-канала (защита от unbounded goroutine). Ненулевой
//	      dropped на проде = сигнал поднять AsyncStoreWorkers.
//
//	druz9_llmcache_eviction_total{task}
//	    — сколько entries выброшено LRU-policy. Рост = cache насыщен,
//	      можно увеличивать MaxEntriesPerTask если Redis вмещает.
//
//	druz9_llmcache_size{task}
//	    — текущее количество entries per task. Gauge для dashboards.
//
//	druz9_llmcache_lookup_duration_seconds{task}
//	    — полная длительность Lookup (embed + MGET + cosine). Histogram
//	      с мелкими бакетами — интересен p95 на уровне 10-100ms.
var (
	cacheLookupTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "druz9_llmcache_lookup_total",
			Help: "Semantic cache lookup attempts grouped by task and outcome.",
		},
		[]string{"task", "result"},
	)

	cacheStoreTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "druz9_llmcache_store_total",
			Help: "Semantic cache store attempts grouped by task and outcome.",
		},
		[]string{"task", "result"},
	)

	cacheEvictionTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "druz9_llmcache_eviction_total",
			Help: "Semantic cache LRU eviction events per task.",
		},
		[]string{"task"},
	)

	cacheSize = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "druz9_llmcache_size",
			Help: "Semantic cache approximate entry count per task.",
		},
		[]string{"task"},
	)

	cacheLookupDur = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "druz9_llmcache_lookup_duration_seconds",
			Help:    "Wall clock for a full Lookup (embed + MGET + cosine).",
			Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2},
		},
		[]string{"task"},
	)
)

func init() {
	sharedMetrics.Registry.MustRegister(cacheLookupTotal)
	sharedMetrics.Registry.MustRegister(cacheStoreTotal)
	sharedMetrics.Registry.MustRegister(cacheEvictionTotal)
	sharedMetrics.Registry.MustRegister(cacheSize)
	sharedMetrics.Registry.MustRegister(cacheLookupDur)
}
