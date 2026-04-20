package enums

type Difficulty string

const (
	DifficultyEasy   Difficulty = "easy"
	DifficultyMedium Difficulty = "medium"
	DifficultyHard   Difficulty = "hard"
)

func (d Difficulty) IsValid() bool {
	switch d {
	case DifficultyEasy, DifficultyMedium, DifficultyHard:
		return true
	}
	return false
}

func (d Difficulty) String() string { return string(d) }

type DungeonTier string

const (
	DungeonTierNormal DungeonTier = "normal"
	DungeonTierHard   DungeonTier = "hard"
	DungeonTierBoss   DungeonTier = "boss"
)

func (t DungeonTier) IsValid() bool {
	switch t {
	case DungeonTierNormal, DungeonTierHard, DungeonTierBoss:
		return true
	}
	return false
}

func (t DungeonTier) String() string { return string(t) }
