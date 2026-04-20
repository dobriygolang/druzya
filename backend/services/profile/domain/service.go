package domain

import (
	"math"

	"druz9/shared/enums"
)

// CareerStage is the derived seniority label shown on the public profile.
type CareerStage string

const (
	CareerStageJunior    CareerStage = "junior"
	CareerStageMiddle    CareerStage = "middle"
	CareerStageSenior    CareerStage = "senior"
	CareerStageStaff     CareerStage = "staff"
	CareerStagePrincipal CareerStage = "principal"
)

// IsValid enforces exhaustive switching in downstream code.
func (c CareerStage) IsValid() bool {
	switch c {
	case CareerStageJunior, CareerStageMiddle, CareerStageSenior, CareerStageStaff, CareerStagePrincipal:
		return true
	}
	return false
}

// String implements fmt.Stringer.
func (c CareerStage) String() string { return string(c) }

// GlobalPowerScore is the weighted average of section ELOs. Sections with
// zero matches contribute the baseline 1000 to avoid rewarding emptiness.
// Formula (bible §3): arithmetic mean across the 5 canonical sections. Made a
// pure domain function so it can be unit-tested without Postgres.
func GlobalPowerScore(ratings []SectionRating) int {
	totals := make(map[enums.Section]int)
	for _, s := range enums.AllSections() {
		totals[s] = 1000 // baseline
	}
	for _, r := range ratings {
		if r.Section.IsValid() {
			totals[r.Section] = r.Elo
		}
	}
	sum := 0
	for _, v := range totals {
		sum += v
	}
	if len(totals) == 0 {
		return 1000
	}
	return sum / len(totals)
}

// XPToNext returns the XP threshold for the next level.
// Formula: 500 * level^1.5 (bible instruction). Returns at least 500.
func XPToNext(level int) int64 {
	if level < 1 {
		level = 1
	}
	v := int64(math.Round(500 * math.Pow(float64(level), 1.5)))
	if v < 500 {
		return 500
	}
	return v
}

// ApplyXP credits `gain` XP onto the profile, promoting the level whenever
// the accumulated XP crosses the threshold. Returns the (newLevel, oldLevel).
// Pure function over the entity — safe for unit tests.
func ApplyXP(p Profile, gain int) (newLevel, oldLevel int, totalXP int64) {
	oldLevel = p.Level
	if oldLevel < 1 {
		oldLevel = 1
	}
	totalXP = p.XP + int64(gain)
	newLevel = oldLevel
	for totalXP >= XPToNext(newLevel) {
		totalXP -= XPToNext(newLevel)
		newLevel++
		if newLevel > 100 { // hard cap to avoid runaway levels from bad input
			break
		}
	}
	return newLevel, oldLevel, totalXP
}

// CareerStageFromPowerScore derives a career label from Global Power Score.
// Thresholds are stubs — in prod they come from dynamic_config (bible §6).
// STUB: replace hardcoded thresholds with values read from dynamic_config
//       keys `career_stage_middle_cutoff`, `_senior_cutoff`, `_staff_cutoff`,
//       `_principal_cutoff`.
func CareerStageFromPowerScore(score int) CareerStage {
	switch {
	case score >= 1800:
		return CareerStagePrincipal
	case score >= 1500:
		return CareerStageStaff
	case score >= 1300:
		return CareerStageSenior
	case score >= 1100:
		return CareerStageMiddle
	default:
		return CareerStageJunior
	}
}

// DeriveAttributes maps section ELOs onto the RPG attributes shown in the atlas.
// Bible §: Интеллект→Алгоритмы, Сила→SystemDesign, Ловкость→SQL/Backend, Воля→Behavioral.
func DeriveAttributes(ratings []SectionRating) Attributes {
	byS := map[enums.Section]int{}
	for _, r := range ratings {
		byS[r.Section] = r.Elo
	}
	cap100 := func(elo int) int {
		// Map ELO 800..2200 → 0..100.
		const min, max = 800, 2200
		if elo <= min {
			return 0
		}
		if elo >= max {
			return 100
		}
		return (elo - min) * 100 / (max - min)
	}
	return Attributes{
		Intellect: cap100(byS[enums.SectionAlgorithms]),
		Strength:  cap100(byS[enums.SectionSystemDesign]),
		// Ловкость берёт максимум SQL/Go (backend proxy).
		Dexterity: cap100(maxInt(byS[enums.SectionSQL], byS[enums.SectionGo])),
		Will:      cap100(byS[enums.SectionBehavioral]),
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
