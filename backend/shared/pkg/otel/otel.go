// Package otel wires OpenTelemetry traces for druz9 services.
//
// Один InitTracer() на бинарь, экспорт OTLP/HTTP. По умолчанию шлёт в
// локальный jaeger:4318, но в проде целится в Grafana Cloud Tempo через
// OTEL_EXPORTER_OTLP_ENDPOINT + OTEL_EXPORTER_OTLP_HEADERS (Basic auth).
//
// Конфиг через стандартные OTEL env vars:
//
//	OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-XX.grafana.net/otlp
//	OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64(user:token)>
//
// Префикс /v1/traces SDK добавит сам (otlptracehttp использует UrlPath="/v1/traces").
package otel

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	// SDK 1.39 detector'ы (Process / Host / FromEnv) hard-baked на schema
	// v1.37.0 — раньше у нас был v1.26.0, и `resource.New` падал с
	// «conflicting Schema URL: 1.26.0 vs 1.37.0». Унифицируем на v1.37.0
	// чтобы merge с автодетектами не конфликтовал.
	semconv "go.opentelemetry.io/otel/semconv/v1.37.0"
	"go.opentelemetry.io/otel/trace"
)

// DefaultEndpoint is used when OTEL_EXPORTER_OTLP_ENDPOINT is unset.
// Bare host:port — otlptracehttp will append /v1/traces.
const DefaultEndpoint = "jaeger:4318"

// InitTracer initialises the global tracer provider with an OTLP/HTTP
// exporter. Endpoint и опциональные headers берутся из OTEL_EXPORTER_OTLP_*.
//
// Возвращает shutdown — defer'ить из main(), чтобы SIGTERM не потерял
// последние spans.
func InitTracer(serviceName, version string) (func(), error) {
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		endpoint = "http://" + DefaultEndpoint
	}

	host := endpoint
	urlPath := ""
	insecure := true
	if strings.HasPrefix(host, "http://") {
		host = strings.TrimPrefix(host, "http://")
	} else if strings.HasPrefix(host, "https://") {
		host = strings.TrimPrefix(host, "https://")
		insecure = false
	}
	// Поддержка endpoint'а с path-префиксом, как у Grafana Cloud:
	// https://otlp-gateway-prod-XX.grafana.net/otlp → host=...grafana.net, path=/otlp
	if i := strings.IndexByte(host, '/'); i >= 0 {
		urlPath = host[i:]
		host = host[:i]
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	opts := []otlptracehttp.Option{otlptracehttp.WithEndpoint(host)}
	if urlPath != "" {
		// otlptracehttp прибавит "/v1/traces" к этому пути сам.
		opts = append(opts, otlptracehttp.WithURLPath(strings.TrimSuffix(urlPath, "/")+"/v1/traces"))
	}
	if insecure {
		opts = append(opts, otlptracehttp.WithInsecure())
	}
	if hdrs := parseOTLPHeaders(os.Getenv("OTEL_EXPORTER_OTLP_HEADERS")); len(hdrs) > 0 {
		opts = append(opts, otlptracehttp.WithHeaders(hdrs))
	}
	exp, err := otlptrace.New(ctx, otlptracehttp.NewClient(opts...))
	if err != nil {
		return nil, fmt.Errorf("otel: create otlp http exporter: %w", err)
	}

	// Все детекторы и наш semconv pin теперь на v1.37.0 (см. import block) —
	// merge'и не конфликтуют, host/process/SDK атрибуты доезжают до Tempo.
	ctxRes, cancelRes := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelRes()
	res, err := resource.New(ctxRes,
		resource.WithSchemaURL(semconv.SchemaURL),
		resource.WithAttributes(
			semconv.ServiceName(serviceName),
			semconv.ServiceVersion(version),
			semconv.DeploymentEnvironmentName(os.Getenv("APP_ENV")),
		),
		resource.WithFromEnv(),      // OTEL_RESOURCE_ATTRIBUTES
		resource.WithProcess(),      // process.{pid, executable, ...}
		resource.WithHost(),         // host.name
		resource.WithTelemetrySDK(), // telemetry.sdk.{name, language, version}
	)
	if err != nil {
		return nil, fmt.Errorf("otel: build resource: %w", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.AlwaysSample())),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	shutdown := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = tp.Shutdown(ctx)
	}
	return shutdown, nil
}

// parseOTLPHeaders разбирает строку формата "k1=v1,k2=v2" из стандартной
// переменной OTEL_EXPORTER_OTLP_HEADERS. Пустая строка → nil.
func parseOTLPHeaders(s string) map[string]string {
	if s == "" {
		return nil
	}
	out := make(map[string]string)
	for _, kv := range strings.Split(s, ",") {
		eq := strings.IndexByte(kv, '=')
		if eq <= 0 {
			continue
		}
		k := strings.TrimSpace(kv[:eq])
		v := strings.TrimSpace(kv[eq+1:])
		if k != "" {
			out[k] = v
		}
	}
	return out
}

// Tracer returns a named tracer from the global provider.
func Tracer(name string) trace.Tracer {
	return otel.Tracer(name)
}
