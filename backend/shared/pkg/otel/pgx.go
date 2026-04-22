package otel

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

// queryTracer is a minimal pgx.QueryTracer that emits an OTel span around
// every query. Equivalent to pgx-contrib/pgxotel but vendor-free.
type queryTracer struct {
	tracer trace.Tracer
}

type queryTracerSpanKey struct{}

// TraceQueryStart implements pgx.QueryTracer.
func (t *queryTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	ctx, span := t.tracer.Start(ctx, "pgx.query",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			semconv.DBSystemPostgreSQL,
			attribute.String("db.statement", truncate(data.SQL, 1024)),
		),
	)
	return context.WithValue(ctx, queryTracerSpanKey{}, span)
}

// TraceQueryEnd implements pgx.QueryTracer.
func (t *queryTracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	span, ok := ctx.Value(queryTracerSpanKey{}).(trace.Span)
	if !ok {
		return
	}
	if data.Err != nil {
		span.RecordError(data.Err)
		span.SetStatus(codes.Error, data.Err.Error())
	}
	span.End()
}

// NewTracedPool builds a pgxpool from a DSN with the OTel query tracer
// pre-installed on the connection config. Use this instead of
// pgxpool.New(ctx, dsn) when you want span-per-query instrumentation.
//
// Equivalent to pgx-contrib/pgxotel without the extra dependency.
func NewTracedPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("otel.NewTracedPool: parse dsn: %w", err)
	}
	cfg.ConnConfig.Tracer = &queryTracer{tracer: otel.Tracer("druz9/pgx")}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("otel.NewTracedPool: create pool: %w", err)
	}
	return pool, nil
}

// WrapPool is a no-op kept for API symmetry with the spec. pgxpool.Config()
// returns a *copy*, so post-construction tracer injection cannot work — use
// NewTracedPool instead. Returns the same pool unchanged.
//
// Deprecated: prefer NewTracedPool.
func WrapPool(pool *pgxpool.Pool) *pgxpool.Pool {
	return pool
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
