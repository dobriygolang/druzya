package metrics

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
)

// ConnectInterceptor возвращает connect.Interceptor, который пишет
// per-procedure latency + count по code в ConnectRequestsTotal /
// ConnectRequestDuration. ChiMiddleware (shared/pkg/metrics) уже ловит
// HTTP-слой, но там path — это route pattern (`/api/v1/hone/plan/*` →
// одна метка), а по-процедурная гранулярность нужна для Connect-RPC,
// где клиенты попадают напрямую на `/druz9.v1.HoneService/GeneratePlan`.
//
// Применение:
//
//	path, h := druz9v1connect.NewHoneServiceHandler(
//	    srv, connect.WithInterceptors(metrics.ConnectInterceptor()))
//
// Стримы (server-streaming) тоже считаются — latency меряется до закрытия
// стрима вызывающей стороной. Клиентские стримы игнорируются (монолит —
// серверная сторона).
func ConnectInterceptor() connect.Interceptor {
	return &connectMetricsInterceptor{}
}

type connectMetricsInterceptor struct{}

// WrapUnary — оборачивает unary-вызовы. Код ошибки:
//   - nil err → "ok"
//   - connect.Error → lowercase Code() (invalid_argument, unavailable, …)
//   - прочее → "unknown"
func (i *connectMetricsInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		start := time.Now()
		resp, err := next(ctx, req)
		record(req.Spec().Procedure, err, time.Since(start))
		return resp, err
	}
}

// WrapStreamingClient — noop: монолит не ходит к себе как client.
func (i *connectMetricsInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next
}

// WrapStreamingHandler — оборачивает server-streaming handlers.
// Latency = время от входа в handler до выхода (finalizer стрима).
func (i *connectMetricsInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, stream connect.StreamingHandlerConn) error {
		start := time.Now()
		err := next(ctx, stream)
		record(stream.Spec().Procedure, err, time.Since(start))
		return err
	}
}

func record(procedure string, err error, dur time.Duration) {
	code := "ok"
	if err != nil {
		var cerr *connect.Error
		if errors.As(err, &cerr) {
			code = cerr.Code().String() // "invalid_argument", "unavailable", …
		} else {
			code = "unknown"
		}
	}
	ConnectRequestsTotal.WithLabelValues(procedure, code).Inc()
	ConnectRequestDuration.WithLabelValues(procedure).Observe(dur.Seconds())
}
