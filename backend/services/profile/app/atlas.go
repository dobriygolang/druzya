package app

import (
	"context"
	"fmt"
	"time"

	"druz9/profile/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// AtlasNode is the enriched skill-atlas node passed to ports.
//
// Поля SolvedCount/TotalCount/LastSolvedAt/RecommendedKata добавлены в Wave-2
// вместе с интерактивным drawer'ом на /atlas. Они нужны фронту, чтобы
// показать «Решено 8 из 23» + «давно не решал» + список ката-рекомендаций
// без второго round-trip'а на /daily.
type AtlasNode struct {
	Key             string
	Title           string
	Description     string
	Section         enums.Section
	Kind            string // normal | keystone | ascendant
	Progress        int
	Unlocked        bool
	Decaying        bool
	SolvedCount     int
	TotalCount      int
	LastSolvedAt    *time.Time
	RecommendedKata []KataRef
}

// KataRef — лёгкий референс на рекомендованную ката (см. proto KataRef).
type KataRef struct {
	ID               string
	Title            string
	Difficulty       string // easy | medium | hard
	EstimatedMinutes int
}

// AtlasEdge joins two node keys.
type AtlasEdge struct {
	From string
	To   string
}

// AtlasView is what ports serialises.
type AtlasView struct {
	CenterNode string
	Nodes      []AtlasNode
	Edges      []AtlasEdge
}

// GetAtlas composes the skill tree by joining user's skill_nodes rows with
// a static edge/node catalogue. The catalogue is hard-coded for MVP.
//
// STUB: edge config from admin CMS later — when the admin domain ships the
//
//	nodes/edges editor, replace `catalogueNodes` / `catalogueEdges` with
//	a repo call reading `skill_catalogue` / `skill_edges` tables. Same for
//	`recommendedKataByNode` — должно вычитываться из daily-каталога с
//	фильтрацией по уже решённым пользователем ката (нужен cross-context
//	read, делаем после распила monolith).
type GetAtlas struct{ Repo domain.ProfileRepo }

// Do merges catalogue + per-user progress.
func (uc *GetAtlas) Do(ctx context.Context, userID uuid.UUID) (AtlasView, error) {
	userNodes, err := uc.Repo.ListSkillNodes(ctx, userID)
	if err != nil {
		return AtlasView{}, fmt.Errorf("profile.GetAtlas: list nodes: %w", err)
	}
	progressByKey := make(map[string]domain.SkillNode, len(userNodes))
	for _, n := range userNodes {
		progressByKey[n.NodeKey] = n
	}

	out := AtlasView{
		CenterNode: "class_core",
		Nodes:      make([]AtlasNode, 0, len(catalogueNodes)),
		Edges:      append([]AtlasEdge(nil), catalogueEdges...),
	}
	for _, cn := range catalogueNodes {
		user := progressByKey[cn.Key]
		// solved = round(progress% * total / 100). Это согласуется с тем, как
		// прогресс считается на стороне skill_nodes (каждый ката = +percent).
		// Точное значение увидим, когда заведём `kata_progress.solved_at` в
		// схему, пока — деривация для красивого UI.
		solved := 0
		if cn.TotalCount > 0 {
			solved = (user.Progress * cn.TotalCount) / 100
			if solved > cn.TotalCount {
				solved = cn.TotalCount
			}
		}
		// LastSolvedAt в этом use case = updated_at строки skill_nodes.
		// Если строки нет (zero updated_at) — оставляем nil, чтобы фронт не
		// показывал «решал в 0001-01-01». Когда заведём kata_progress.solved_at
		// — заменим на реальный timestamp последней решённой ката из этой темы.
		var lastSolved *time.Time
		if !user.UpdatedAt.IsZero() {
			t := user.UpdatedAt
			lastSolved = &t
		}
		out.Nodes = append(out.Nodes, AtlasNode{
			Key:             cn.Key,
			Title:           cn.Title,
			Description:     cn.Description,
			Section:         cn.Section,
			Kind:            cn.Kind,
			Progress:        user.Progress,
			Unlocked:        user.UnlockedAt != nil,
			Decaying:        user.DecayedAt != nil,
			SolvedCount:     solved,
			TotalCount:      cn.TotalCount,
			LastSolvedAt:    lastSolved,
			RecommendedKata: append([]KataRef(nil), recommendedKataByNode[cn.Key]...),
		})
	}
	return out, nil
}

// catalogueNodes is the MVP static atlas. See STUB above. TotalCount — сколько
// разнообразных ката эта тема покрывает в текущем daily-каталоге; используется
// для «Решено X из Y». Числа подобраны на глаз по факту (sql:basics — 12
// классических задач JOIN/GROUP BY и т.д.) — когда появится cross-context
// read из daily, заменим на реальный SELECT count(*).
//
// TODO(admin-cms): the skill catalogue is hardcoded in this file because we
// don't yet have admin UI to manage it. Migrate to a `skill_catalogue` table
// with admin CRUD when content team is ready. Tracked in roadmap as P3.
type catalogueNode struct {
	Key         string
	Title       string
	Description string
	Section     enums.Section
	Kind        string
	TotalCount  int
}

var catalogueNodes = []catalogueNode{
	{Key: "class_core", Title: "Ядро класса", Description: "Стартовая точка атласа", Section: enums.SectionAlgorithms, Kind: "keystone", TotalCount: 1},
	{Key: "algo_basics", Title: "Алгоритмы: основы", Description: "Массивы, строки, хеш-таблицы", Section: enums.SectionAlgorithms, Kind: "normal", TotalCount: 23},
	{Key: "algo_graphs", Title: "Алгоритмы: графы", Description: "DFS/BFS, топосорт, Дейкстра", Section: enums.SectionAlgorithms, Kind: "normal", TotalCount: 18},
	{Key: "algo_dp", Title: "Алгоритмы: DP", Description: "Динамическое программирование", Section: enums.SectionAlgorithms, Kind: "keystone", TotalCount: 30},
	{Key: "sql_basics", Title: "SQL: основы", Description: "JOIN, GROUP BY, подзапросы", Section: enums.SectionSQL, Kind: "normal", TotalCount: 14},
	{Key: "sql_perf", Title: "SQL: производительность", Description: "Индексы, EXPLAIN, денормализация", Section: enums.SectionSQL, Kind: "keystone", TotalCount: 9},
	{Key: "go_concurrency", Title: "Go: concurrency", Description: "Горутины, каналы, контексты", Section: enums.SectionGo, Kind: "keystone", TotalCount: 16},
	{Key: "go_idioms", Title: "Go: идиомы", Description: "Интерфейсы, ошибки, дженерики", Section: enums.SectionGo, Kind: "normal", TotalCount: 12},
	{Key: "sd_basics", Title: "System Design: основы", Description: "CAP, кэши, очереди", Section: enums.SectionSystemDesign, Kind: "normal", TotalCount: 8},
	{Key: "sd_scale", Title: "System Design: масштаб", Description: "Шардирование, репликация, consistency", Section: enums.SectionSystemDesign, Kind: "ascendant", TotalCount: 6},
	{Key: "beh_star", Title: "Behavioral: STAR", Description: "Структура ответов на вопросы", Section: enums.SectionBehavioral, Kind: "normal", TotalCount: 10},
}

var catalogueEdges = []AtlasEdge{
	{From: "class_core", To: "algo_basics"},
	{From: "class_core", To: "sql_basics"},
	{From: "class_core", To: "go_idioms"},
	{From: "class_core", To: "beh_star"},
	{From: "class_core", To: "sd_basics"},
	{From: "algo_basics", To: "algo_graphs"},
	{From: "algo_basics", To: "algo_dp"},
	{From: "sql_basics", To: "sql_perf"},
	{From: "go_idioms", To: "go_concurrency"},
	{From: "sd_basics", To: "sd_scale"},
}

// recommendedKataByNode — статический «топ-5» ката для каждой темы. ID'ы
// ведут на реальные slug'и в daily-каталоге (соответствуют /daily/kata/:id).
// При последующей интеграции с daily-сервисом заменим на live-фильтрацию
// «непрешённые / по сложности».
var recommendedKataByNode = map[string][]KataRef{
	"algo_basics": {
		{ID: "two-sum", Title: "Two Sum", Difficulty: "easy", EstimatedMinutes: 10},
		{ID: "valid-anagram", Title: "Valid Anagram", Difficulty: "easy", EstimatedMinutes: 8},
		{ID: "group-anagrams", Title: "Group Anagrams", Difficulty: "medium", EstimatedMinutes: 15},
		{ID: "longest-substring", Title: "Longest Substring Without Repeating", Difficulty: "medium", EstimatedMinutes: 18},
		{ID: "product-of-array-except-self", Title: "Product of Array Except Self", Difficulty: "medium", EstimatedMinutes: 20},
	},
	"algo_graphs": {
		{ID: "number-of-islands", Title: "Number of Islands", Difficulty: "medium", EstimatedMinutes: 18},
		{ID: "course-schedule", Title: "Course Schedule (топосорт)", Difficulty: "medium", EstimatedMinutes: 22},
		{ID: "shortest-path-binary", Title: "Shortest Path in Binary Matrix", Difficulty: "medium", EstimatedMinutes: 20},
		{ID: "network-delay-time", Title: "Network Delay Time (Дейкстра)", Difficulty: "medium", EstimatedMinutes: 25},
		{ID: "word-ladder", Title: "Word Ladder (BFS)", Difficulty: "hard", EstimatedMinutes: 35},
	},
	"algo_dp": {
		{ID: "climbing-stairs", Title: "Climbing Stairs", Difficulty: "easy", EstimatedMinutes: 10},
		{ID: "house-robber", Title: "House Robber", Difficulty: "medium", EstimatedMinutes: 15},
		{ID: "longest-common-subsequence", Title: "Longest Common Subsequence", Difficulty: "medium", EstimatedMinutes: 20},
		{ID: "edit-distance", Title: "Edit Distance", Difficulty: "hard", EstimatedMinutes: 30},
		{ID: "burst-balloons", Title: "Burst Balloons", Difficulty: "hard", EstimatedMinutes: 40},
	},
	"sql_basics": {
		{ID: "second-highest-salary", Title: "Second Highest Salary", Difficulty: "easy", EstimatedMinutes: 8},
		{ID: "duplicate-emails", Title: "Find Duplicate Emails", Difficulty: "easy", EstimatedMinutes: 6},
		{ID: "department-top-three", Title: "Department Top Three Salaries", Difficulty: "medium", EstimatedMinutes: 18},
		{ID: "trips-and-users", Title: "Trips and Users", Difficulty: "medium", EstimatedMinutes: 20},
		{ID: "human-traffic-stadium", Title: "Human Traffic of Stadium", Difficulty: "hard", EstimatedMinutes: 30},
	},
	"sql_perf": {
		{ID: "explain-slow-query", Title: "EXPLAIN slow query", Difficulty: "medium", EstimatedMinutes: 15},
		{ID: "design-index-orders", Title: "Design index for orders.created_at", Difficulty: "medium", EstimatedMinutes: 20},
		{ID: "denormalize-feed", Title: "Денормализуй feed для read-heavy", Difficulty: "hard", EstimatedMinutes: 35},
	},
	"go_idioms": {
		{ID: "errors-wrap", Title: "errors.Is / errors.As / fmt.Errorf %w", Difficulty: "easy", EstimatedMinutes: 10},
		{ID: "interface-segregation", Title: "Принцип I из SOLID на Go", Difficulty: "medium", EstimatedMinutes: 15},
		{ID: "generics-constraint", Title: "Generic Set[T comparable]", Difficulty: "medium", EstimatedMinutes: 18},
		{ID: "ctx-cancellation", Title: "context.Cancel и cleanup", Difficulty: "medium", EstimatedMinutes: 20},
	},
	"go_concurrency": {
		{ID: "rate-limiter", Title: "Token-bucket Rate Limiter", Difficulty: "medium", EstimatedMinutes: 20},
		{ID: "worker-pool", Title: "Worker Pool на каналах", Difficulty: "medium", EstimatedMinutes: 25},
		{ID: "fan-out-fan-in", Title: "Fan-Out / Fan-In", Difficulty: "medium", EstimatedMinutes: 22},
		{ID: "errgroup-cancel", Title: "errgroup с отменой по первой ошибке", Difficulty: "hard", EstimatedMinutes: 30},
		{ID: "deadlock-detect", Title: "Найди и почини дедлок", Difficulty: "hard", EstimatedMinutes: 35},
	},
	"sd_basics": {
		{ID: "url-shortener", Title: "URL Shortener (bit.ly)", Difficulty: "medium", EstimatedMinutes: 30},
		{ID: "cache-invalidation", Title: "Стратегии инвалидации кеша", Difficulty: "medium", EstimatedMinutes: 25},
		{ID: "queue-vs-bus", Title: "Очередь vs шина: когда что", Difficulty: "medium", EstimatedMinutes: 20},
	},
	"sd_scale": {
		{ID: "design-twitter", Title: "Design Twitter timeline", Difficulty: "hard", EstimatedMinutes: 60},
		{ID: "design-uber", Title: "Design Uber dispatch", Difficulty: "hard", EstimatedMinutes: 60},
		{ID: "consistency-tradeoffs", Title: "Strong vs Eventual: trade-offs", Difficulty: "hard", EstimatedMinutes: 40},
	},
	"beh_star": {
		{ID: "tell-me-conflict", Title: "«Расскажи о конфликте» по STAR", Difficulty: "easy", EstimatedMinutes: 12},
		{ID: "biggest-failure", Title: "«Самая большая ошибка» по STAR", Difficulty: "medium", EstimatedMinutes: 15},
		{ID: "leading-without-authority", Title: "«Лидер без авторитета»", Difficulty: "medium", EstimatedMinutes: 18},
	},
	"class_core": {
		{ID: "two-sum", Title: "Two Sum — твой первый ката", Difficulty: "easy", EstimatedMinutes: 10},
	},
}
