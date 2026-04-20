package enums

type MatchStatus string

const (
	MatchStatusSearching  MatchStatus = "searching"
	MatchStatusConfirming MatchStatus = "confirming"
	MatchStatusActive     MatchStatus = "active"
	MatchStatusFinished   MatchStatus = "finished"
	MatchStatusCancelled  MatchStatus = "cancelled"
)

func (s MatchStatus) IsValid() bool {
	switch s {
	case MatchStatusSearching, MatchStatusConfirming, MatchStatusActive,
		MatchStatusFinished, MatchStatusCancelled:
		return true
	}
	return false
}

func (s MatchStatus) String() string { return string(s) }

type ArenaMode string

const (
	ArenaModeSolo1v1  ArenaMode = "solo_1v1"
	ArenaModeDuo2v2   ArenaMode = "duo_2v2"
	ArenaModeRanked   ArenaMode = "ranked"
	ArenaModeHardcore ArenaMode = "hardcore"
	ArenaModeCursed   ArenaMode = "cursed"
)

func (m ArenaMode) IsValid() bool {
	switch m {
	case ArenaModeSolo1v1, ArenaModeDuo2v2, ArenaModeRanked, ArenaModeHardcore, ArenaModeCursed:
		return true
	}
	return false
}

func (m ArenaMode) String() string { return string(m) }
