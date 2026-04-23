// Package domain — tier.go: маппинг ELO → текстовый тариф (Bronze, Silver,
// Gold, Platinum, Diamond, Master). Используется на /match/:id/end, чтобы
// показать игроку текущий тариф и сколько LP до следующего, без дублирования
// арифметики на фронте.
//
// Шаги тарифов жёстко зашиты на стороне домена — это контракт MVP. В будущем
// они переедут в dynamic_config (см. bible §6).
package domain

import "fmt"

// tierStep описывает одну ступень внутри тира — например, Diamond III ⇒ 2400.
type tierStep struct {
	Name      string // "Diamond III"
	Threshold int    // ELO нижняя граница (включительно)
}

// tierLadder упорядочен по возрастанию Threshold; первая запись — самый
// низкий тир. Названия совпадают с UI-словарём frontend (Bronze … Master).
var tierLadder = []tierStep{
	{"Bronze IV", 0},
	{"Bronze III", 800},
	{"Bronze II", 900},
	{"Bronze I", 1000},
	{"Silver IV", 1100},
	{"Silver III", 1175},
	{"Silver II", 1250},
	{"Silver I", 1325},
	{"Gold IV", 1400},
	{"Gold III", 1475},
	{"Gold II", 1550},
	{"Gold I", 1625},
	{"Platinum IV", 1700},
	{"Platinum III", 1775},
	{"Platinum II", 1850},
	{"Platinum I", 1925},
	{"Diamond IV", 2000},
	{"Diamond III", 2100},
	{"Diamond II", 2200},
	{"Diamond I", 2300},
	{"Master", 2400},
}

// TierLabel возвращает имя тира для данного ELO и подпись «следующий тир ·
// сколько LP до него». Если игрок уже на максимальном тире, nextLabel пуст.
func TierLabel(elo int) (current string, nextLabel string) {
	if elo < 0 {
		elo = 0
	}
	idx := 0
	for i, step := range tierLadder {
		if elo >= step.Threshold {
			idx = i
		}
	}
	current = tierLadder[idx].Name
	if idx >= len(tierLadder)-1 {
		return current, ""
	}
	next := tierLadder[idx+1]
	delta := next.Threshold - elo
	if delta < 0 {
		delta = 0
	}
	return current, fmt.Sprintf("%s · %d LP", next.Name, delta)
}

// ── XP breakdown for finished match ────────────────────────────────────────
//
// XP-награды за матч стандартизированы на уровне домена (bible §3.6 — MVP
// табличка). В будущем переедут в dynamic_config; сейчас зашиты как чистая
// функция, чтобы фронт перестал хардкодить "Победа +120 / Под 5 минут +80".

// XPItem — одна строка breakdown (label + amount).
type XPItem struct {
	Label  string
	Amount int
}

// XP-константы (bible §3.6 MVP defaults).
const (
	XPWin            = 120
	XPWinFastSeconds = 300 // под 5 минут
	XPWinFast        = 80
	XPWinFirstTry    = 40
	XPLoss           = 20 // утешительный — за участие
	XPDraw           = 60
	XPStreak5Bonus   = 100 // 5-WIN STREAK
)

// ComputeXP считает breakdown для участника по итогам матча.
//
// Параметры:
//   - won: победил ли участник
//   - draw: ничья (winnerID == nil, status=finished)
//   - solveSeconds: время решения в секундах (0 = не решил)
//   - firstTry: только одна попытка submit (нет провалов)
//   - winStreak: текущая серия побед игрока ВКЛЮЧАЯ этот матч
//
// Возвращает (total, breakdown).
func ComputeXP(won, draw bool, solveSeconds int, firstTry bool, winStreak int) (int, []XPItem) {
	out := []XPItem{}
	total := 0
	switch {
	case won:
		out = append(out, XPItem{Label: "Победа в матче", Amount: XPWin})
		total += XPWin
		if solveSeconds > 0 && solveSeconds <= XPWinFastSeconds {
			out = append(out, XPItem{Label: "Под 5 минут", Amount: XPWinFast})
			total += XPWinFast
		}
		if firstTry {
			out = append(out, XPItem{Label: "Все тесты с 1 раза", Amount: XPWinFirstTry})
			total += XPWinFirstTry
		}
		if winStreak >= 5 {
			out = append(out, XPItem{Label: fmt.Sprintf("%d-WIN STREAK", winStreak), Amount: XPStreak5Bonus})
			total += XPStreak5Bonus
		}
	case draw:
		out = append(out, XPItem{Label: "Ничья", Amount: XPDraw})
		total += XPDraw
	default:
		out = append(out, XPItem{Label: "За участие", Amount: XPLoss})
		total += XPLoss
	}
	return total, out
}

// StreakLabel возвращает строку для UI ("5-WIN STREAK · +100 XP") или пустую,
// если стрика недостаточно (<5).
func StreakLabel(winStreak int) string {
	if winStreak < 5 {
		return ""
	}
	return fmt.Sprintf("%d-WIN STREAK · +%d XP", winStreak, XPStreak5Bonus)
}
