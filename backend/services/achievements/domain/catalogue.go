package domain

// catalogue.go — статичный реестр ачивок druz9.
//
// TODO admin-cms: контент-команда планирует переезд каталога в админку,
// тогда этот slice уезжает в БД, а функции Catalogue/ByCode будут
// читать из репо. До этого момента изменения каталога — это PR
// в этот файл (никаких миграций не требуется, прогресс хранится по code).
//
// Цель ~40 записей: покрыть основные домены (arena, daily, cohort, social,
// profile/mastery), плюс несколько hidden-ачивок для пасхалок.

// catalogue — приватный список. Доступ через Catalogue() / ByCode().
var catalogue = []Achievement{
	// ── Combat / Arena ───────────────────────────────────────────────────────
	{Code: "first-blood", Title: "First Blood", Description: "Выиграть первый ranked-матч в Арене.",
		Category: CategoryCombat, Tier: TierCommon,
		RequirementsText: "1 победа в Ranked 1v1.", RewardText: "+50 XP · значок профиля",
		Target: 1},
	{Code: "arena-veteran", Title: "Arena Veteran", Description: "10 побед в Ranked 1v1.",
		Category: CategoryCombat, Tier: TierCommon,
		RequirementsText: "10 побед в Ranked 1v1.", RewardText: "+200 XP",
		Target: 10},
	{Code: "arena-master", Title: "Arena Master", Description: "100 побед в Ranked 1v1.",
		Category: CategoryCombat, Tier: TierRare,
		RequirementsText: "100 побед в Ranked 1v1.", RewardText: "+1000 XP · title Master",
		Target: 100},
	{Code: "speed-demon", Title: "Speed Demon", Description: "Решить 10 medium-задач < 5 минут каждая.",
		Category: CategoryCombat, Tier: TierLegendary,
		RequirementsText: "10 решений Medium · каждое < 5 мин · без AI/подсказок.",
		RewardText:       "+500 XP · title Speed Demon",
		Target:           10},
	{Code: "ranked-promotion-platinum", Title: "Platinum Climber", Description: "Дойти до Platinum в любой секции.",
		Category: CategoryCombat, Tier: TierRare,
		RequirementsText: "ELO ≥ 2000 в любой секции.", RewardText: "+300 XP",
		Target: 1},
	{Code: "ranked-promotion-diamond", Title: "Diamond Ascendant", Description: "Дойти до Diamond в любой секции.",
		Category: CategoryCombat, Tier: TierRare,
		RequirementsText: "ELO ≥ 2400 в любой секции.", RewardText: "+500 XP",
		Target: 1},
	{Code: "ranked-promotion-master", Title: "Grandmaster", Description: "Дойти до Master в любой секции.",
		Category: CategoryCombat, Tier: TierLegendary,
		RequirementsText: "ELO ≥ 2800 в любой секции.", RewardText: "+1500 XP · title Grandmaster",
		Target: 1},
	{Code: "champion", Title: "Champion", Description: "Победить в турнире",
		Category: CategoryCombat, Tier: TierLegendary,
		RequirementsText: "1 место в любом турнире.", RewardText: "+2000 XP · title Champion",
		Target: 1},
	{Code: "iron-defender", Title: "Iron Defender", Description: "Серия из 10 матчей без проигрышей.",
		Category: CategoryCombat, Tier: TierRare,
		RequirementsText: "10 побед подряд в Ranked.", RewardText: "+400 XP",
		Target: 10},

	// ── Consistency / Daily ──────────────────────────────────────────────────
	{Code: "daily-first", Title: "Daily Hello", Description: "Решить первое Daily.",
		Category: CategoryConsistency, Tier: TierCommon,
		RequirementsText: "1 решённое Daily.", RewardText: "+30 XP",
		Target: 1},
	{Code: "streak-7", Title: "Weekly Habit", Description: "7 дней подряд решать Daily.",
		Category: CategoryConsistency, Tier: TierCommon,
		RequirementsText: "Streak ≥ 7.", RewardText: "+100 XP · 1 Streak Freeze",
		Target: 7},
	{Code: "streak-30", Title: "Monthly Discipline", Description: "30 дней подряд решать Daily.",
		Category: CategoryConsistency, Tier: TierRare,
		RequirementsText: "Streak ≥ 30.", RewardText: "+500 XP · 2 Streak Freeze",
		Target: 30},
	{Code: "streak-100", Title: "Centurion", Description: "100 дней подряд решать Daily.",
		Category: CategoryConsistency, Tier: TierLegendary,
		RequirementsText: "Streak ≥ 100.", RewardText: "+2000 XP · title Centurion",
		Target: 100},
	{Code: "cursed-friday", Title: "Cursed Friday", Description: "Решить cursed Daily в пятницу 13-го.",
		Category: CategoryConsistency, Tier: TierLegendary,
		RequirementsText: "Решить cursed-флаг Daily в пятницу 13-го.",
		RewardText:       "+1000 XP · title Hexbreaker",
		Hidden:           true,
		Target:           1},
	{Code: "boss-kata", Title: "Boss Slayer", Description: "Решить boss-kata.",
		Category: CategoryConsistency, Tier: TierRare,
		RequirementsText: "1 решение Boss Kata.", RewardText: "+400 XP",
		Target: 1},
	{Code: "early-bird", Title: "Early Bird", Description: "Решить Daily до 7:00 утра локального времени.",
		Category: CategoryConsistency, Tier: TierCommon,
		RequirementsText: "Daily со временем submit < 07:00 локального.", RewardText: "+50 XP",
		Target: 1},
	{Code: "night-owl", Title: "Night Owl", Description: "Решить Daily после 23:00 локального.",
		Category: CategoryConsistency, Tier: TierCommon,
		RequirementsText: "Daily со временем submit > 23:00 локального.", RewardText: "+50 XP",
		Target: 1},

	// ── Mastery / Profile / XP / Atlas ──────────────────────────────────────
	{Code: "xp-1k", Title: "Apprentice", Description: "Заработать 1 000 XP.",
		Category: CategoryMastery, Tier: TierCommon,
		RequirementsText: "Total XP ≥ 1000.", RewardText: "+50 XP",
		Target: 1000},
	{Code: "xp-10k", Title: "Journeyman", Description: "Заработать 10 000 XP.",
		Category: CategoryMastery, Tier: TierCommon,
		RequirementsText: "Total XP ≥ 10 000.", RewardText: "+200 XP",
		Target: 10000},
	{Code: "xp-50k", Title: "Sage", Description: "Заработать 50 000 XP.",
		Category: CategoryMastery, Tier: TierRare,
		RequirementsText: "Total XP ≥ 50 000.", RewardText: "+800 XP",
		Target: 50000},
	{Code: "xp-100k", Title: "Archmage", Description: "Заработать 100 000 XP.",
		Category: CategoryMastery, Tier: TierLegendary,
		RequirementsText: "Total XP ≥ 100 000.", RewardText: "+2000 XP · title Archmage",
		Target: 100000},
	{Code: "atlas-half", Title: "Atlas Cartographer", Description: "Открыть 50% узлов Atlas.",
		Category: CategoryMastery, Tier: TierRare,
		RequirementsText: "≥ 50% nodes на Atlas.", RewardText: "+300 XP",
		Target: 50},
	{Code: "atlas-full", Title: "Atlas Complete", Description: "Открыть 100% узлов Atlas.",
		Category: CategoryMastery, Tier: TierLegendary,
		RequirementsText: "100% nodes на Atlas.", RewardText: "+2000 XP · title Cartographer",
		Target: 100},
	{Code: "level-10", Title: "Adept", Description: "Достичь 10 уровня.",
		Category: CategoryMastery, Tier: TierCommon,
		RequirementsText: "Level ≥ 10.", RewardText: "+150 XP",
		Target: 10},
	{Code: "level-25", Title: "Veteran", Description: "Достичь 25 уровня.",
		Category: CategoryMastery, Tier: TierRare,
		RequirementsText: "Level ≥ 25.", RewardText: "+500 XP",
		Target: 25},
	{Code: "level-50", Title: "Mythic", Description: "Достичь 50 уровня.",
		Category: CategoryMastery, Tier: TierLegendary,
		RequirementsText: "Level ≥ 50.", RewardText: "+2000 XP · title Mythic",
		Target: 50},
	{Code: "algo-sage", Title: "Algorithm Sage", Description: "Решить 50 hard-задач.",
		Category: CategoryMastery, Tier: TierLegendary,
		RequirementsText: "50 решений Hard.", RewardText: "+1500 XP · title Algorithm Sage",
		Target: 50},
	{Code: "code-warrior", Title: "Code Warrior", Description: "100 решённых задач любой сложности.",
		Category: CategoryMastery, Tier: TierRare,
		RequirementsText: "100 решений (любых).", RewardText: "+700 XP",
		Target: 100},

	// ── Social / Friends / Cohort ────────────────────────────────────────────
	{Code: "first-friend", Title: "Hello, World", Description: "Добавить первого друга.",
		Category: CategorySocial, Tier: TierCommon,
		RequirementsText: "1 принятая дружба.", RewardText: "+30 XP",
		Target: 1},
	{Code: "social-five", Title: "Squad", Description: "5 друзей в списке.",
		Category: CategorySocial, Tier: TierCommon,
		RequirementsText: "5 принятых дружб.", RewardText: "+100 XP",
		Target: 5},
	{Code: "social-twenty", Title: "Network", Description: "20 друзей в списке.",
		Category: CategorySocial, Tier: TierRare,
		RequirementsText: "20 принятых дружб.", RewardText: "+400 XP",
		Target: 20},
	{Code: "challenger", Title: "Challenger", Description: "Бросить 10 вызовов друзьям.",
		Category: CategorySocial, Tier: TierCommon,
		RequirementsText: "10 challenge-матчей с друзьями.", RewardText: "+150 XP",
		Target: 10},
	{Code: "cohort-joined", Title: "Joined the Cohort", Description: "Вступить в когорту.",
		Category: CategorySocial, Tier: TierCommon,
		RequirementsText: "1 принятое приглашение в когорту.", RewardText: "+50 XP",
		Target: 1},
	{Code: "cohort-war-won", Title: "Cohort War Champion", Description: "Победить в войне когорт.",
		Category: CategorySocial, Tier: TierRare,
		RequirementsText: "1 победа в Cohort War.", RewardText: "+500 XP",
		Target: 1},
	{Code: "cohort-war-mvp", Title: "War MVP", Description: "Стать MVP в Cohort War.",
		Category: CategorySocial, Tier: TierLegendary,
		RequirementsText: "MVP-флаг в Cohort War.", RewardText: "+1500 XP · title MVP",
		Target: 1},
	// ── Secret / hidden ────────────────────────────────────────────────────
	{Code: "secret-night-grind", Title: "Insomniac", Description: "10 решений между 02:00 и 05:00.",
		Category: CategorySecret, Tier: TierRare,
		RequirementsText: "???", RewardText: "+300 XP",
		Hidden: true, Target: 10},
	{Code: "secret-comeback", Title: "Phoenix", Description: "Победить после 5 поражений подряд.",
		Category: CategorySecret, Tier: TierRare,
		RequirementsText: "???", RewardText: "+250 XP",
		Hidden: true, Target: 1},
	{Code: "secret-perfect-week", Title: "Perfect Week", Description: "7 дней без единой проигранной задачи.",
		Category: CategorySecret, Tier: TierLegendary,
		RequirementsText: "???", RewardText: "+1000 XP · title Perfectionist",
		Hidden: true, Target: 1},
	{Code: "secret-no-ai", Title: "Pure Mind", Description: "30 решений подряд без AI-подсказок.",
		Category: CategorySecret, Tier: TierLegendary,
		RequirementsText: "???", RewardText: "+1200 XP",
		Hidden: true, Target: 30},
}

// catalogueIndex — карта code → *Achievement, заполняется лениво.
var catalogueIndex = func() map[string]Achievement {
	m := make(map[string]Achievement, len(catalogue))
	for _, a := range catalogue {
		m[a.Code] = a
	}
	return m
}()

// Catalogue возвращает копию каталога. Мутировать запрещено — slice owned by domain.
func Catalogue() []Achievement {
	out := make([]Achievement, len(catalogue))
	copy(out, catalogue)
	return out
}

// ByCode возвращает ачивку по коду. (Achievement{}, ErrUnknownCode) для miss.
func ByCode(code string) (Achievement, error) {
	if a, ok := catalogueIndex[code]; ok {
		return a, nil
	}
	return Achievement{}, ErrUnknownCode
}
