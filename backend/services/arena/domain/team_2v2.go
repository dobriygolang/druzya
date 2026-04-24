// Package domain — логика 2v2 (duo) матчмейкинга и результатов.
//
// Phase 5 вводит командную игру. Чтобы сузить blast radius, выносим это в
// отдельный файл, а не нагружаем entity.go / service.go:
//
//   - Формирование команды (formFour): при ≥4 кандидатах выбираем 4
//     ближайших по ELO и делим на две команды так, чтобы минимизировать
//     разницу сумм ELO.
//   - QueueTimeout: duo-тикет, висящий дольше DuoQueueTimeout, снимается
//     диспетчером из матчмейкинга.
//   - Результат 2v2: матч выигрывает team_id (1 или 2), а не user_id.
//     Победа объявляется, когда оба участника команды отправили решение.
//
// На 1v1-вызывающих это НЕ влияет — существующие экспорты не меняются.
package domain

import (
	"cmp"
	"slices"
	"time"

	"github.com/google/uuid"
)

// ID команд для 2v2-матчей. 0 зарезервирован под «нет команды» / дефолт
// 1v1 в arena_participants.team — чтобы не трогать строки истории 1v1.
const (
	Team1 = 1
	Team2 = 2
)

// DuoTeamSize — число игроков на одной стороне в duo-матче.
const DuoTeamSize = 2

// DuoMatchSize — общее число участников в duo-матче.
const DuoMatchSize = DuoTeamSize * 2 // 4

// DuoQueueTimeout — максимальное ожидание до отмены duo-тикета из
// очереди. Bible требует «≈5 минут». Вынесено, чтобы диспетчер и тесты
// сходились в значении порога.
const DuoQueueTimeout = 5 * time.Minute

// DuoEloSpreadCap — мягкий потолок на (max - min) ELO среди четырёх
// выбранных кандидатов. Если превышен — всё равно матчим (отсутствие
// матча = UX хуже, чем матч с широким разбросом), но диспетчер пишет
// warning, чтобы это было видно в мониторинге.
const DuoEloSpreadCap = 600

// Quad — набор из четырёх игроков, которых matchmaker решил свести в один
// duo-матч. Порядок: Players[0..1] = Team1, Players[2..3] = Team2.
type Quad struct {
	Players [DuoMatchSize]QueueTicket
}

// Team1Tickets возвращает два тикета, назначенных в team 1.
func (q Quad) Team1Tickets() [DuoTeamSize]QueueTicket {
	return [DuoTeamSize]QueueTicket{q.Players[0], q.Players[1]}
}

// Team2Tickets возвращает два тикета, назначенных в team 2.
func (q Quad) Team2Tickets() [DuoTeamSize]QueueTicket {
	return [DuoTeamSize]QueueTicket{q.Players[2], q.Players[3]}
}

// MeanElo возвращает округлённое среднее ELO всех четверых (используется
// для выбора сложности задачи по аналогии с 1v1).
func (q Quad) MeanElo() int {
	sum := 0
	for _, p := range q.Players {
		sum += p.Elo
	}
	return sum / DuoMatchSize
}

// EloSpread возвращает max(Elo) - min(Elo) по всему quad. Используется
// диспетчером для решения, писать ли warning о широком матче.
func (q Quad) EloSpread() int {
	min, max := q.Players[0].Elo, q.Players[0].Elo
	for _, p := range q.Players[1:] {
		if p.Elo < min {
			min = p.Elo
		}
		if p.Elo > max {
			max = p.Elo
		}
	}
	return max - min
}

// PickQuads жадно группирует тикеты duo-очереди в матчи по четыре.
//
// Стратегия (оставлена простой — bible §3.4 говорит «balanced split», а не
// «global optimum»):
//  1. Сортируем тикеты по ELO по возрастанию.
//  2. Идём по срезу окнами из четырёх подряд (ближайших по ELO) тикетов.
//  3. Для каждого окна находим сплит команд, минимизирующий |sumA - sumB|.
//     При 4 игроках различных разбиений всего C(4,2)/2 = 3, поэтому это
//     O(1) на окно.
//  4. Помечаем четвёрку как взятую и идём дальше. Остаток (<4) остаётся в очереди.
//
// Просроченные тикеты (старше DuoQueueTimeout) отсеиваются перед группировкой —
// диспетчер отдельно отвечает за их снятие из Redis
// (см. Matchmaker.cancelStaleDuo).
func PickQuads(tickets []QueueTicket, now time.Time) []Quad {
	if len(tickets) < DuoMatchSize {
		return nil
	}
	// Выбрасываем просроченные тикеты, чтобы не собрать матч с «призраком».
	live := make([]QueueTicket, 0, len(tickets))
	for _, t := range tickets {
		if !IsDuoTicketExpired(t, now) {
			live = append(live, t)
		}
	}
	if len(live) < DuoMatchSize {
		return nil
	}
	slices.SortStableFunc(live, func(a, b QueueTicket) int {
		if c := cmp.Compare(a.Elo, b.Elo); c != 0 {
			return c
		}
		return a.EnqueuedAt.Compare(b.EnqueuedAt)
	})

	quads := make([]Quad, 0, len(live)/DuoMatchSize)
	for i := 0; i+DuoMatchSize <= len(live); i += DuoMatchSize {
		window := [DuoMatchSize]QueueTicket{live[i], live[i+1], live[i+2], live[i+3]}
		quads = append(quads, balanceQuad(window))
	}
	return quads
}

// IsDuoTicketExpired сообщает, ждал ли duo-тикет слишком долго.
func IsDuoTicketExpired(t QueueTicket, now time.Time) bool {
	return now.Sub(t.EnqueuedAt) >= DuoQueueTimeout
}

// balanceQuad выбирает сплит команд, минимизирующий |sumA - sumB|.
// Для 4 элементов [a,b,c,d] есть 3 различных разбиения на 2+2:
//
//	(a,b) vs (c,d)   diff = |(a+b) - (c+d)|
//	(a,c) vs (b,d)   diff = |(a+c) - (b+d)|
//	(a,d) vs (b,c)   diff = |(a+d) - (b+c)|
//
// Tie-break: предпочитаем (a,d) vs (b,c), т.к. он кладёт самого «медленного»
// по ELO в пару к самому «быстрому» — эмпирически ощущается честнее.
func balanceQuad(w [DuoMatchSize]QueueTicket) Quad {
	a, b, c, d := w[0], w[1], w[2], w[3]
	type split struct {
		t1A, t1B QueueTicket
		t2A, t2B QueueTicket
		diff     int
	}
	abs := func(x int) int {
		if x < 0 {
			return -x
		}
		return x
	}
	splits := [3]split{
		{a, b, c, d, abs((a.Elo + b.Elo) - (c.Elo + d.Elo))},
		{a, c, b, d, abs((a.Elo + c.Elo) - (b.Elo + d.Elo))},
		{a, d, b, c, abs((a.Elo + d.Elo) - (b.Elo + c.Elo))},
	}
	best := splits[2] // (a,d)/(b,c) — стартовый «лучший» по tie-break выше.
	for _, s := range splits {
		if s.diff < best.diff {
			best = s
		}
	}
	return Quad{Players: [DuoMatchSize]QueueTicket{best.t1A, best.t1B, best.t2A, best.t2B}}
}

// ── Разбор результата 2v2 ─────────────────────────────────────────────────

// TeamResultLabel — строковый итог team-матча с точки зрения одного игрока.
// Повторяет существующий набор MatchResult*.
const (
	TeamResultWin       = MatchResultWin
	TeamResultLoss      = MatchResultLoss
	TeamResultDraw      = MatchResultDraw
	TeamResultAbandoned = MatchResultAbandoned
)

// ResultForTeam возвращает per-player итог завершённого 2v2-матча.
// `myTeam` — team_id запросившего игрока; `winningTeam` — team_id из
// arena_matches.winning_team_id (0 = нет победителя / ничья).
func ResultForTeam(myTeam, winningTeam int) string {
	if winningTeam == 0 {
		return TeamResultDraw
	}
	if myTeam == winningTeam {
		return TeamResultWin
	}
	return TeamResultLoss
}

// ResolveDuoWinner смотрит на отправки участников и возвращает team_id
// победителя, как только его можно определить, или 0, если матч ещё не
// разрешён. Команда побеждает, когда *оба* её участника отправили
// успешное решение раньше, чем это сделала противоположная команда.
//
// `passed` — map userID → отправил ли пользователь успешное решение.
// `parts` — канонический список участников (для определения team_id).
//
// Возвращает (winningTeam, decided):
//   - decided=false → матч ещё идёт.
//   - decided=true, winningTeam ∈ {1,2} → эта команда победила.
//   - decided=true, winningTeam=0 → ничья (обе команды завершили в одном
//     вызове резолва — осмысленно только если SubmitCode пакует несколько).
func ResolveDuoWinner(parts []Participant, passed map[uuid.UUID]bool) (winningTeam int, decided bool) {
	t1, t2 := 0, 0
	t1Done, t2Done := 0, 0
	for _, p := range parts {
		switch p.Team {
		case Team1:
			t1++
			if passed[p.UserID] {
				t1Done++
			}
		case Team2:
			t2++
			if passed[p.UserID] {
				t2Done++
			}
		}
	}
	if t1 != DuoTeamSize || t2 != DuoTeamSize {
		// Битый матч — отказываемся принимать решение.
		return 0, false
	}
	t1Win := t1Done == DuoTeamSize
	t2Win := t2Done == DuoTeamSize
	switch {
	case t1Win && t2Win:
		return 0, true
	case t1Win:
		return Team1, true
	case t2Win:
		return Team2, true
	default:
		return 0, false
	}
}

// IsDuoMode сообщает, является ли режим 2v2-режимом (сейчас это только
// ArenaModeDuo2v2). Вынесено в одно место, чтобы будущие duo-режимы
// могли подключаться здесь.
func IsDuoMode(mode string) bool {
	return mode == "duo_2v2"
}
