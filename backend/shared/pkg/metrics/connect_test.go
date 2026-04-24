package metrics

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

// Лёгкий unary-flow тест через фейковый UnaryFunc — не поднимаем HTTP,
// проверяем что interceptor инкрементит счётчики правильным code'ом.
func TestConnectInterceptor_Unary_OKAndError(t *testing.T) {
	// Reset counters (они общие между тестами — other tests в этом пакете
	// их не трогают, но нашу пару метрик надо почистить чтобы counter был детерминированный).
	ConnectRequestsTotal.Reset()
	ConnectRequestDuration.Reset()

	ic := ConnectInterceptor()

	procedure := "/druz9.v1.HoneService/GenerateDailyPlan"
	spec := connect.Spec{Procedure: procedure, StreamType: connect.StreamTypeUnary}

	okFn := ic.WrapUnary(func(_ context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
		time.Sleep(1 * time.Millisecond)
		return nil, nil
	})
	errFn := ic.WrapUnary(func(_ context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
		return nil, connect.NewError(connect.CodeResourceExhausted, errors.New("rate limited"))
	})
	plainFn := ic.WrapUnary(func(_ context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
		return nil, errors.New("plain error")
	})

	req := &fakeRequest{spec: spec}
	_, _ = okFn(context.Background(), req)
	_, _ = errFn(context.Background(), req)
	_, _ = errFn(context.Background(), req)
	_, _ = plainFn(context.Background(), req)

	if got := testutil.ToFloat64(ConnectRequestsTotal.WithLabelValues(procedure, "ok")); got != 1 {
		t.Errorf("ok counter = %v, want 1", got)
	}
	if got := testutil.ToFloat64(ConnectRequestsTotal.WithLabelValues(procedure, "resource_exhausted")); got != 2 {
		t.Errorf("resource_exhausted counter = %v, want 2", got)
	}
	if got := testutil.ToFloat64(ConnectRequestsTotal.WithLabelValues(procedure, "unknown")); got != 1 {
		t.Errorf("unknown counter = %v, want 1", got)
	}
}

// fakeRequest реализует минимальный connect.AnyRequest интерфейс —
// достаточно Spec() для нашего interceptor'а.
type fakeRequest struct {
	connect.AnyRequest
	spec connect.Spec
}

func (r *fakeRequest) Spec() connect.Spec { return r.spec }
