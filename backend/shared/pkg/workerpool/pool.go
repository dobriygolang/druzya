// Package workerpool — простой bounded worker pool для detached goroutines.
//
// Используется чтобы fan-out side-effect work (LLM calls, embeddings,
// background sweeps) не превращался в неконтролируемый goroutine spawn:
// при 1000 параллельных юзеров мы не хотим 1000 одновременных insight
// generations или Categoriser hits.
//
// Семантика:
//   - Submit — non-blocking attempt: либо запустит fn в pool worker'е,
//     либо вернёт false (caller должен log+drop). Никогда не блокирует
//     запрос-handler'а; deadlines RPC соблюдаются.
//   - SubmitWait — short-deadline submit: ждёт до timeout слот в пуле,
//     после чего drop'ает (используется когда работа достаточно важная
//     чтобы посидеть пару сотен ms, но не критичная).
//   - Close — graceful drain: ждёт пока все running fn завершатся, затем
//     запрещает новые submit'ы.
//
// Sizing rule of thumb: maxConcurrent ≈ pool_workers_for_LLM_provider × 2.
// Free-tier groq/cerebras ходят с rate-limit ≈ 30 RPM на регион, так что
// pool на 20-30 — здоровый предел для LLM-driven background задач.
package workerpool

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

// Pool — bounded worker pool на основе semaphore'а (chan struct{}).
//
// Не пере-spawn'ит worker'ов: каждая Submit-задача сама запускает свой
// goroutine, semaphore лимитирует число одновременно-запущенных. Это
// проще чем classic worker pool с long-living workers и подходит для
// short-lived async-job'ов (insight generation 5-15s, Categoriser 1-3s).
type Pool struct {
	name   string
	sem    chan struct{}
	log    *slog.Logger
	wg     sync.WaitGroup
	closed chan struct{}
	once   sync.Once
}

// New создаёт пул с заданным concurrency limit'ом. log nil-safe (no-op).
// name используется только для логов — короткое имя ("insights" / "categorise").
func New(name string, maxConcurrent int, log *slog.Logger) *Pool {
	if maxConcurrent <= 0 {
		maxConcurrent = 1
	}
	return &Pool{
		name:   name,
		sem:    make(chan struct{}, maxConcurrent),
		log:    log,
		closed: make(chan struct{}),
	}
}

// Submit пытается запустить fn в worker'е НЕ блокируясь. Возвращает true
// если задача принята, false если pool full (caller должен залогировать
// drop). Если pool закрыт — возвращает false.
//
// fn будет вызван с параметром ctx (caller обычно передаёт background
// или request-detached ctx с timeout'ом).
func (p *Pool) Submit(ctx context.Context, fn func(ctx context.Context)) bool {
	select {
	case <-p.closed:
		return false
	default:
	}
	select {
	case p.sem <- struct{}{}:
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			defer func() { <-p.sem }()
			defer func() {
				// Recover чтобы panic в fn не убил pool (и сам процесс).
				if r := recover(); r != nil && p.log != nil {
					p.log.Error("workerpool: panic in worker",
						slog.String("pool", p.name),
						slog.Any("recover", r))
				}
			}()
			fn(ctx)
		}()
		return true
	default:
		// Pool full → drop. Caller logs warn.
		return false
	}
}

// SubmitWait — как Submit, но с timeout'ом. Возвращает nil если задача
// принята, ошибку (ctxErr или ErrPoolFull) если нет.
//
// Используется когда мы готовы заблокировать caller'а на короткое
// timeout (200-500ms) ради чуть бОльшей вероятности принятия. Не
// рекомендуется для request-handler'ов — там Submit + drop надёжнее.
func (p *Pool) SubmitWait(ctx context.Context, timeout time.Duration, fn func(ctx context.Context)) error {
	select {
	case <-p.closed:
		return ErrPoolClosed
	default:
	}
	tCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	select {
	case <-tCtx.Done():
		return ErrPoolFull
	case p.sem <- struct{}{}:
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			defer func() { <-p.sem }()
			defer func() {
				if r := recover(); r != nil && p.log != nil {
					p.log.Error("workerpool: panic in worker",
						slog.String("pool", p.name),
						slog.Any("recover", r))
				}
			}()
			fn(ctx)
		}()
		return nil
	}
}

// Close блокирует новые Submit'ы и ждёт завершения running задач.
// Идемпотентен.
func (p *Pool) Close() error {
	p.once.Do(func() {
		close(p.closed)
	})
	p.wg.Wait()
	return nil
}

// Inflight возвращает текущее число running worker'ов. Для метрик.
func (p *Pool) Inflight() int {
	return len(p.sem)
}

// Capacity возвращает максимум одновременных задач.
func (p *Pool) Capacity() int {
	return cap(p.sem)
}

// Errors.
var (
	ErrPoolFull   = errors.New("workerpool: pool full, task dropped")
	ErrPoolClosed = errors.New("workerpool: pool closed")
)
