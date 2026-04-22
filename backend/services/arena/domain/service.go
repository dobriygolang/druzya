package domain

import (
	"sort"
	"time"

	"druz9/shared/enums"
)

// ELO-окно (bible §3.4): ±200 базово, +200 каждые 30 секунд в очереди, потолок ±600.
const (
	EloWindowBase   = 200
	EloWindowStep   = 200
	EloWindowCap    = 600
	EloWindowStepAt = 30 * time.Second
)

// Clock абстрагирует time.Now, чтобы тесты могли детерминированно крутить Tick().
type Clock interface {
	Now() time.Time
}

// RealClock — продакшн-реализация Clock.
type RealClock struct{}

// Now возвращает time.Now в UTC.
func (RealClock) Now() time.Time { return time.Now().UTC() }

// FixedClock — тестовый Clock, возвращающий зафиксированный момент;
// вызывайте Advance, чтобы сдвинуть его.
type FixedClock struct{ T time.Time }

// Now возвращает зафиксированный момент.
func (c *FixedClock) Now() time.Time { return c.T }

// Advance сдвигает часы вперёд на d.
func (c *FixedClock) Advance(d time.Duration) { c.T = c.T.Add(d) }

// EloWindowAt возвращает допустимую разность |elo_a − elo_b| для тикета,
// поставленного в очередь в `enqueuedAt`, наблюдаемого в момент `now`.
func EloWindowAt(enqueuedAt, now time.Time) int {
	waited := now.Sub(enqueuedAt)
	if waited < 0 {
		waited = 0
	}
	steps := int(waited / EloWindowStepAt)
	win := EloWindowBase + steps*EloWindowStep
	if win > EloWindowCap {
		win = EloWindowCap
	}
	if win < EloWindowBase {
		win = EloWindowBase
	}
	return win
}

// PickPairs жадно матчит соседние тикеты в срезе очереди, отсортированной по ELO.
// Считает, что `tickets` принадлежит вызывающей стороне, и не должен его менять.
//
// Стратегия:
//  1. Отсортировать тикеты по ELO по возрастанию, тай-брейк по времени постановки,
//     чтобы самый старый тикет матчился первым.
//  2. Пройти срез по порядку; для каждого несматченного тикета попробовать
//     спариться со следующим несматченным, чей ELO помещается в динамически
//     расширенное окно *любой* из сторон (берём max, чтобы давно ожидающий
//     расширял сеть).
//
// Возвращает набор сматченных пар; тикеты, не нашедшие пары на этом тике,
// остаются в очереди.
func PickPairs(tickets []QueueTicket, now time.Time) []Pair {
	if len(tickets) < 2 {
		return nil
	}
	ts := append([]QueueTicket(nil), tickets...)
	sort.SliceStable(ts, func(i, j int) bool {
		if ts[i].Elo != ts[j].Elo {
			return ts[i].Elo < ts[j].Elo
		}
		return ts[i].EnqueuedAt.Before(ts[j].EnqueuedAt)
	})

	taken := make([]bool, len(ts))
	pairs := make([]Pair, 0, len(ts)/2)
	for i := 0; i < len(ts); i++ {
		if taken[i] {
			continue
		}
		for j := i + 1; j < len(ts); j++ {
			if taken[j] {
				continue
			}
			delta := ts[j].Elo - ts[i].Elo
			if delta < 0 {
				delta = -delta
			}
			winI := EloWindowAt(ts[i].EnqueuedAt, now)
			winJ := EloWindowAt(ts[j].EnqueuedAt, now)
			win := winI
			if winJ > win {
				win = winJ
			}
			if delta <= win {
				taken[i] = true
				taken[j] = true
				pairs = append(pairs, Pair{A: ts[i], B: ts[j]})
				break
			}
			// Отсортировано по ELO: следующий j будет ещё дальше; пропускаем остаток.
			break
		}
	}
	return pairs
}

// DifficultyForEloBand выбирает сложность задачи по значению ELO. Чистая функция.
func DifficultyForEloBand(elo int) enums.Difficulty {
	switch {
	case elo >= 1800:
		return enums.DifficultyHard
	case elo >= 1300:
		return enums.DifficultyMedium
	default:
		return enums.DifficultyEasy
	}
}

// ReadyCheckDeadline возвращает `now + ReadyCheckWindow`.
func ReadyCheckDeadline(now time.Time) time.Time { return now.Add(ReadyCheckWindow) }

// IsReadyCheckExpired сообщает, истёк ли дедлайн.
func IsReadyCheckExpired(deadline, now time.Time) bool { return !now.Before(deadline) }

// AccumulateSuspicion применяет paste-событие к текущему score, возвращая
// новое значение и факт пересечения порога High.
func AccumulateSuspicion(current, delta float64) (newScore float64, crossedHigh bool) {
	prev := current
	newScore = current + delta
	if prev < SuspicionHighThreshold && newScore >= SuspicionHighThreshold {
		crossedHigh = true
	}
	return
}

// TabSwitchSeverity сопоставляет N-й (1-based) tab-switch с антифрод-severity.
// 1 → Medium, ≥2 → High (bible §3.4).
func TabSwitchSeverity(nth int) enums.SeverityLevel {
	if nth <= 1 {
		return enums.SeverityMedium
	}
	return enums.SeverityHigh
}
