package domain

import (
	"cmp"
	"slices"

	"druz9/shared/enums"
)

// ── weekly report aggregation ────────────────────────────────────────────────
//
// Functions ниже — pure-domain хелперы, которые превращают сырые «строки
// матчей за неделю» в структурированный отчёт для фронта /report. Раньше
// фронт таскал захардкоженные массивы; теперь бэк отдаёт уже посчитанные
// сильные / слабые секции, стрик-метрики и сравнение по неделям.
//
// Не импортируем ничего, кроме shared/enums — слой остаётся unit-тестируемым.

// MatchAggregate — одна строка истории матчей за период, нужная для
// группировки по секциям (см. SectionBreakdown). Win/Loss/XP считаются на
// уровне SQL; здесь мы только агрегируем уже посчитанные значения.
type MatchAggregate struct {
	Section enums.Section
	Win     bool
	XPDelta int
}

// SectionBreakdown — итог по одной секции за период (XP, выигрыши, win-rate).
type SectionBreakdown struct {
	Section    enums.Section
	Matches    int
	Wins       int
	Losses     int
	XPDelta    int
	WinRatePct int
}

// WeekComparison — XP за конкретную неделю (для блока «Последние 4 недели»).
type WeekComparison struct {
	Label string
	XP    int
	// Pct — относительная высота в гистограмме (0..100). Считается так,
	// чтобы максимум среди WeekComparisons был равен 100.
	Pct int
}

// AggregateBySection группирует матчи по секции и возвращает
// (strong, weak) — каждая длиной не больше 3, отсортированные по xp_delta.
// Strong: XPDelta > 0, weak: XPDelta <= 0. Если у секции нет ни одного
// матча — она в выдачу не попадает.
func AggregateBySection(matches []MatchAggregate) (strong, weak []SectionBreakdown) {
	bySection := map[enums.Section]*SectionBreakdown{}
	for _, m := range matches {
		if !m.Section.IsValid() {
			continue
		}
		b, ok := bySection[m.Section]
		if !ok {
			b = &SectionBreakdown{Section: m.Section}
			bySection[m.Section] = b
		}
		b.Matches++
		b.XPDelta += m.XPDelta
		if m.Win {
			b.Wins++
		} else {
			b.Losses++
		}
	}
	all := make([]SectionBreakdown, 0, len(bySection))
	for _, b := range bySection {
		if b.Matches > 0 {
			b.WinRatePct = (b.Wins * 100) / b.Matches
		}
		all = append(all, *b)
	}
	// Strong: XPDelta > 0.
	for _, b := range all {
		if b.XPDelta > 0 {
			strong = append(strong, b)
		} else {
			weak = append(weak, b)
		}
	}
	// Sort: strong desc by xp; weak asc (most painful first).
	slices.SortStableFunc(strong, func(a, b SectionBreakdown) int { return cmp.Compare(b.XPDelta, a.XPDelta) })
	slices.SortStableFunc(weak, func(a, b SectionBreakdown) int { return cmp.Compare(a.XPDelta, b.XPDelta) })
	if len(strong) > 3 {
		strong = strong[:3]
	}
	if len(weak) > 3 {
		weak = weak[:3]
	}
	return strong, weak
}

// BuildWeeklyComparison строит ровно 4 элемента: Эта, -1, -2, -3. На входе —
// массив XP-сумм по неделям, ровно 4 значения (этa, минус-1, минус-2,
// минус-3); если меньше — недостающие будут с нулём. Pct нормализуется так,
// чтобы максимум стал 100 (если все нули — все 0).
func BuildWeeklyComparison(xpByWeek []int) []WeekComparison {
	const N = 4
	labels := []string{"Эта", "-1", "-2", "-3"}
	out := make([]WeekComparison, N)
	max := 0
	for i := 0; i < N; i++ {
		v := 0
		if i < len(xpByWeek) {
			v = xpByWeek[i]
		}
		out[i] = WeekComparison{Label: labels[i], XP: v}
		if v > max {
			max = v
		}
	}
	if max == 0 {
		return out
	}
	for i := range out {
		out[i].Pct = (out[i].XP * 100) / max
	}
	return out
}
