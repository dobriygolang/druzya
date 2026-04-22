// Package otel wires OpenTelemetry traces for druz9 services.
//
// It is intentionally tiny: a single InitTracer() call per binary,
// exporting OTLP/HTTP to an OpenTelemetry Collector or Jaeger
// (Jaeger 1.62+ accepts OTLP/HTTP natively on :4318).
//
// The exporter endpoint is taken from OTEL_EXPORTER_OTLP_ENDPOINT.
// Default: http://jaeger:4318  (the docker-compose service DNS name).
package otel

import (
	"context"
	"fmt"
	"os"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

// DefaultEndpoint is used when OTEL_EXPORTER_OTLP_ENDPOINT is unset.
// Bare host:port — otlptracehttp will append /v1/traces.
const DefaultEndpoint = "jaeger:4318"

// InitTracer initialises the global tracer provider with an OTLP/HTTP
// exporter pointing at OTEL_EXPORTER_OTLP_ENDPOINT (or jaeger:4318).
// It returns a shutdown function that flushes pending spans — defer it
// from main() so SIGTERM doesn't lose the last second of traces.
//
// The W3C TraceContext + Baggage propagators are installed globally so
// that incoming `traceparent` / `tracestate` / `baggage` headers are
// honoured on every HTTP request.
func InitTracer(serviceName, version string) (func(), error) {
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		endpoint = "http://" + DefaultEndpoint
	}
	// otlptracehttp.WithEndpoint expects host:port without scheme; strip it.
	host := endpoint
	insecure := true
	if len(host) > 7 && host[:7] == "http://" {
		host = host[7:]
	} else if len(host) > 8 && host[:8] == "https://" {
		host = host[8:]
		insecure = false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	opts := []otlptracehttp.Option{otlptracehttp.WithEndpoint(host)}
	if insecure {
		opts = append(opts, otlptracehttp.WithInsecure())
	}
	exp, err := otlptrace.New(ctx, otlptracehttp.NewClient(opts...))
	if err != nil {
		return nil, fmt.Errorf("otel: create otlp http exporter: %w", err)
	}

	res, err := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName(serviceName),
			semconv.ServiceVersion(version),
			// DeploymentEnvironmentName lives in semconv/v1.27.0+; on v1.26.0 we use legacy attr.
			semconv.DeploymentEnvironment(os.Getenv("APP_ENV")),
		),
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

// Tracer returns a named tracer from the global provider.
// Convenience wrapper so call sites don't import otel themselves.
func Tracer(name string) trace.Tracer {
	return otel.Tracer(name)
}
