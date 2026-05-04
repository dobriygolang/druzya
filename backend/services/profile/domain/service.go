package domain

import (
	"math"
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

