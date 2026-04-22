package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Handler returns the http.Handler that renders metrics in Prometheus format.
//
// Mount at /metrics in the root chi router. Access MUST be restricted —
// production nginx (infra/nginx/nginx.prod.conf) only allows private IPs.
// Never expose /metrics on the public internet: it leaks stack traces, build
// info and (by inspecting series counts) traffic patterns.
func Handler() http.Handler {
	return promhttp.HandlerFor(Registry, promhttp.HandlerOpts{
		Registry:          Registry,
		EnableOpenMetrics: true,
	})
}
