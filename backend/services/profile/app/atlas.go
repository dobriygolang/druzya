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
//
// Wave-10 (migration 00034) — PoE-passive-tree vocabulary:
//   - Kind ∈ {"hub","keystone","notable","small"} — different visual grammar
//     per kind (hub = big circle center, keystone = diamond, notable = sigil,
//     small = simple disk).
//   - Cluster groups dense designer-laid blobs of related skills.
//   - PosX/PosY are designer-pinned (admin CMS); nil → frontend defaults to a
//     simple ring layout for unpinned nodes (graceful degrade).
//   - Reachable expresses PoE allocation semantics: there exists a path from
//     hub through mastered nodes to this node. Computed server-side; the
//     frontend uses it to dim/hide unreachable nodes during planning.
type AtlasNode struct {
	Key             string
	Title           string
	Description     string
	Section         enums.Section
	Kind            string // hub | keystone | notable | small
	Cluster         string // designer-grouped cluster id
	PosX            *int   // designer-pinned coord; nil → client auto-place
	PosY            *int
	Progress        int
	Unlocked        bool
	Decaying        bool
	Reachable       bool // PoE pathing: can be allocated given current mastery
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
//
// Wave-10: Kind ∈ {"prereq","suggested","crosslink"} drives the rendered
// visual grammar (thick-arrow / thin-line / dashed-faded).
type AtlasEdge struct {
	From string
	To   string
	Kind string // prereq | suggested | crosslink
}

// AtlasView is what ports serialises.
type AtlasView struct {
	CenterNode string
	Nodes      []AtlasNode
	Edges      []AtlasEdge
}

// GetAtlas composes the skill tree by joining user's skill_nodes rows with
// the (now admin-editable) catalogue.
//
// Catalogue source:
//   - When `Catalogue` is wired (production: cmd/monolith/services/profile.go),
//     nodes & edges come from atlas_nodes / atlas_edges (migration 00031).
//     The admin CMS at /admin → Atlas controls those tables.
//   - When `Catalogue` is nil (legacy unit tests in ports/server_test.go),
//     the use case falls back to the in-file static catalogue. This keeps
//     existing test wiring compiling without a behaviour change.
//
// The static catalogue lives at the bottom of this file and is the SAME
// data the migration's seed inserts into atlas_nodes — they will not
// drift apart by construction (the seed is generated from this slice).
type GetAtlas struct {
	Repo      domain.ProfileRepo
	Catalogue domain.AtlasCatalogueRepo // optional; nil → static fallback
}

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

	cat, edges, centerKey, err := uc.loadCatalogue(ctx)
	if err != nil {
		return AtlasView{}, fmt.Errorf("profile.GetAtlas: catalogue: %w", err)
	}

	out := AtlasView{
		CenterNode: centerKey,
		Nodes:      make([]AtlasNode, 0, len(cat)),
		Edges:      edges,
	}
	for _, cn := range cat {
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
			Cluster:         cn.Cluster,
			PosX:            cn.PosX,
			PosY:            cn.PosY,
			Progress:        user.Progress,
			Unlocked:        user.UnlockedAt != nil,
			Decaying:        user.DecayedAt != nil,
			SolvedCount:     solved,
			TotalCount:      cn.TotalCount,
			LastSolvedAt:    lastSolved,
			RecommendedKata: append([]KataRef(nil), recommendedKataByNode[cn.Key]...),
		})
	}
	// PoE allocation semantics — compute reachability after the slice is
	// fully populated (we need the set of mastered keys + edge graph to
	// run a BFS from the hub).
	annotateReachable(out.Nodes, out.Edges, centerKey)
	return out, nil
}

// annotateReachable runs a BFS from the hub through mastered nodes and
// marks each node's Reachable field. PoE-style semantics: a node is
// reachable if there exists a path of mastered nodes from the hub TO an
// adjacent node (i.e. you can "spend a point" on it next).
//
// "Mastered" here = Progress == 100. Anything below is in-flight and does
// not yet propagate reachability to its neighbours; this matches the
// design-review v3 wording «чтобы дойти, надо allocate всё по пути».
//
// The hub itself is always reachable (Progress is irrelevant — it is the
// starting point of the tree).
//
// Complexity: O(|nodes| + |edges|). Edges are treated as undirected since
// AtlasView edges historically lack a sense of direction in the seed.
func annotateReachable(nodes []AtlasNode, edges []AtlasEdge, hubKey string) {
	if len(nodes) == 0 {
		return
	}
	idx := make(map[string]int, len(nodes))
	for i, n := range nodes {
		idx[n.Key] = i
	}
	adj := make(map[string][]string, len(nodes))
	for _, e := range edges {
		adj[e.From] = append(adj[e.From], e.To)
		adj[e.To] = append(adj[e.To], e.From)
	}
	// BFS from hub. Visited = mastered-and-reached. Frontier carries
	// neighbours of visited nodes (those become Reachable=true even if not
	// mastered themselves — the player can spend the next point on them).
	visited := make(map[string]bool, len(nodes))
	queue := []string{hubKey}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if visited[cur] {
			continue
		}
		visited[cur] = true
		// Mark current as Reachable. Then, only walk further from `cur` if
		// it is mastered (or it is the hub — hub is implicitly "allocated").
		i, ok := idx[cur]
		if !ok {
			continue
		}
		nodes[i].Reachable = true
		isHub := cur == hubKey
		isMastered := nodes[i].Progress >= 100
		if !isHub && !isMastered {
			continue
		}
		for _, neighbour := range adj[cur] {
			if !visited[neighbour] {
				queue = append(queue, neighbour)
			}
		}
	}
}

// loadCatalogue resolves the catalogue source.
//   - Catalogue wired → DB-backed (admin-editable atlas_nodes / atlas_edges).
//     The first node with kind="center" becomes the centerNode; if none, we
//     fall back to "class_core" so the legacy progress rows still match.
//   - Catalogue == nil → in-file `catalogueNodes` / `catalogueEdges` slice
//     (used by ports/server_test.go which mocks ProfileRepo only).
//
// Returns the catalogue slice, the edges, and the centerNode key.
func (uc *GetAtlas) loadCatalogue(ctx context.Context) ([]catalogueNode, []AtlasEdge, string, error) {
	if uc.Catalogue == nil {
		return catalogueNodes, append([]AtlasEdge(nil), catalogueEdges...), "class_core", nil
	}
	dbNodes, err := uc.Catalogue.ListNodes(ctx)
	if err != nil {
		return nil, nil, "", fmt.Errorf("list nodes: %w", err)
	}
	dbEdges, err := uc.Catalogue.ListEdges(ctx)
	if err != nil {
		return nil, nil, "", fmt.Errorf("list edges: %w", err)
	}
	out := make([]catalogueNode, 0, len(dbNodes))
	centerKey := ""
	for _, n := range dbNodes {
		out = append(out, catalogueNode{
			Key:         n.ID,
			Title:       n.Title,
			Description: n.Description,
			Section:     enums.Section(n.Section),
			Kind:        n.Kind,
			Cluster:     n.Cluster,
			PosX:        n.PosX,
			PosY:        n.PosY,
			TotalCount:  n.TotalCount,
		})
		// Wave-10: hub kind replaces v1 "center". Accept both during the
		// migration grace period — old "center" rows still resolve until
		// 00034 backfills them to "hub".
		if centerKey == "" && (n.Kind == "hub" || n.Kind == "center") {
			centerKey = n.ID
		}
	}
	if centerKey == "" {
		centerKey = "class_core"
	}
	edges := make([]AtlasEdge, 0, len(dbEdges))
	for _, e := range dbEdges {
		kind := e.Kind
		if kind == "" {
			kind = "prereq"
		}
		edges = append(edges, AtlasEdge{From: e.From, To: e.To, Kind: kind})
	}
	return out, edges, centerKey, nil
}

// catalogueNode is the in-process shape merged with per-user progress.
// The static `catalogueNodes` slice below mirrors the seed of migration
// 00031 — keep them in sync if you edit one (the canonical source after
// the migration ships is atlas_nodes; this slice exists only for tests).
type catalogueNode struct {
	Key         string
	Title       string
	Description string
	Section     enums.Section
	Kind        string
	Cluster     string
	PosX        *int
	PosY        *int
	TotalCount  int
}

// Wave-10 PoE-vocabulary catalogue (mirrors migration 00034 semantics):
//   - hub: starting node, always reachable
//   - keystone: 1 per cluster, signature perk
//   - notable: cluster milestones
//   - small: incremental drills
//
// Cluster names mirror Section keys for now (designers can divorce later
// in admin CMS).
var catalogueNodes = []catalogueNode{
	{Key: "class_core", Title: "Ядро класса", Description: "Стартовая точка атласа", Section: enums.SectionAlgorithms, Kind: "hub", Cluster: "algorithms", TotalCount: 1},
	{Key: "algo_basics", Title: "Алгоритмы: основы", Description: "Массивы, строки, хеш-таблицы", Section: enums.SectionAlgorithms, Kind: "small", Cluster: "algorithms", TotalCount: 23},
	{Key: "algo_graphs", Title: "Алгоритмы: графы", Description: "DFS/BFS, топосорт, Дейкстра", Section: enums.SectionAlgorithms, Kind: "notable", Cluster: "algorithms", TotalCount: 18},
	{Key: "algo_dp", Title: "Алгоритмы: DP", Description: "Динамическое программирование", Section: enums.SectionAlgorithms, Kind: "keystone", Cluster: "algorithms", TotalCount: 30},
	{Key: "sql_basics", Title: "SQL: основы", Description: "JOIN, GROUP BY, подзапросы", Section: enums.SectionSQL, Kind: "small", Cluster: "sql", TotalCount: 14},
	{Key: "sql_perf", Title: "SQL: производительность", Description: "Индексы, EXPLAIN, денормализация", Section: enums.SectionSQL, Kind: "keystone", Cluster: "sql", TotalCount: 9},
	{Key: "go_concurrency", Title: "Go: concurrency", Description: "Горутины, каналы, контексты", Section: enums.SectionGo, Kind: "keystone", Cluster: "go", TotalCount: 16},
	{Key: "go_idioms", Title: "Go: идиомы", Description: "Интерфейсы, ошибки, дженерики", Section: enums.SectionGo, Kind: "notable", Cluster: "go", TotalCount: 12},
	{Key: "sd_basics", Title: "System Design: основы", Description: "CAP, кэши, очереди", Section: enums.SectionSystemDesign, Kind: "small", Cluster: "system_design", TotalCount: 8},
	{Key: "sd_scale", Title: "System Design: масштаб", Description: "Шардирование, репликация, consistency", Section: enums.SectionSystemDesign, Kind: "keystone", Cluster: "system_design", TotalCount: 6},
	{Key: "beh_star", Title: "Behavioral: STAR", Description: "Структура ответов на вопросы", Section: enums.SectionBehavioral, Kind: "notable", Cluster: "behavioral", TotalCount: 10},
}

// catalogueEdges — Wave-10: prereq edges from hub & in-cluster paths;
// crosslink between sd/algo and go/algo to demonstrate the dashed grammar.
var catalogueEdges = []AtlasEdge{
	{From: "class_core", To: "algo_basics", Kind: "prereq"},
	{From: "class_core", To: "sql_basics", Kind: "prereq"},
	{From: "class_core", To: "go_idioms", Kind: "prereq"},
	{From: "class_core", To: "beh_star", Kind: "suggested"},
	{From: "class_core", To: "sd_basics", Kind: "prereq"},
	{From: "algo_basics", To: "algo_graphs", Kind: "prereq"},
	{From: "algo_basics", To: "algo_dp", Kind: "prereq"},
	{From: "sql_basics", To: "sql_perf", Kind: "prereq"},
	{From: "go_idioms", To: "go_concurrency", Kind: "prereq"},
	{From: "sd_basics", To: "sd_scale", Kind: "prereq"},
	// Cross-cluster suggestion: graphs ↔ system design (BFS shortest paths in distributed search).
	{From: "algo_graphs", To: "sd_basics", Kind: "crosslink"},
}

// recommendedKataByNode — статический «топ-5» ката для каждой темы.
// ID'ы — реальные tasks.slug из миграций 00003 (algorithms/sql/system_design
// + 3 go) и 00058 (расширение go + system_design). Drawer ведёт на
// /arena/kata/{slug}, который ходит в GET /api/v1/daily/kata/{slug} —
// если slug фейковый, фронт ловит 404. Любое изменение здесь должно
// синхронизироваться с tasks-сидами или задача вылетит с 404.
//
// beh_star намеренно опущен: behavioral в Arena не сидится (это
// формат mock-pipeline questions, не tasks). Drawer в этом случае
// показывает «каталог не размечен» — лучше честное «нет», чем 404.
var recommendedKataByNode = map[string][]KataRef{
	"class_core": {
		{ID: "two-sum-transactions", Title: "Две суммы транзакций — твой первый ката", Difficulty: "easy", EstimatedMinutes: 10},
	},
	"algo_basics": {
		{ID: "two-sum-transactions", Title: "Две суммы транзакций", Difficulty: "easy", EstimatedMinutes: 10},
		{ID: "contains-duplicate-uid", Title: "Дубликаты user_id", Difficulty: "easy", EstimatedMinutes: 8},
		{ID: "valid-palindrome-slug", Title: "Палиндромный slug", Difficulty: "easy", EstimatedMinutes: 10},
		{ID: "group-anagram-tags", Title: "Группировка анаграмм-тегов", Difficulty: "medium", EstimatedMinutes: 15},
		{ID: "longest-unique-stream", Title: "Самая длинная уникальная подстрока", Difficulty: "medium", EstimatedMinutes: 18},
	},
	"algo_graphs": {
		{ID: "count-region-islands", Title: "Подсчёт островов регионов", Difficulty: "medium", EstimatedMinutes: 18},
		{ID: "codeword-in-grid", Title: "Поиск кодового слова в сетке", Difficulty: "medium", EstimatedMinutes: 20},
		{ID: "word-ladder-docs", Title: "Словесная лестница (BFS)", Difficulty: "hard", EstimatedMinutes: 35},
		{ID: "n-queens-cluster", Title: "N ферзей на кластере", Difficulty: "hard", EstimatedMinutes: 30},
	},
	"algo_dp": {
		{ID: "climbing-rating-ladder", Title: "Подъём по рейтинговой лестнице", Difficulty: "easy", EstimatedMinutes: 10},
		{ID: "max-subarray-revenue", Title: "Максимальный подотрезок выручки", Difficulty: "easy", EstimatedMinutes: 12},
		{ID: "change-for-coin-drop", Title: "Размен монет дропа", Difficulty: "medium", EstimatedMinutes: 20},
		{ID: "unique-paths-grid-release", Title: "Уникальные пути по сетке релизов", Difficulty: "medium", EstimatedMinutes: 18},
		{ID: "jump-game-matchmaker", Title: "Прыжки матчмейкера", Difficulty: "medium", EstimatedMinutes: 20},
	},
	"sql_basics": {
		{ID: "sql-second-highest-salary", Title: "Вторая по величине зарплата", Difficulty: "easy", EstimatedMinutes: 8},
		{ID: "sql-total-revenue-by-month", Title: "Выручка по месяцам", Difficulty: "easy", EstimatedMinutes: 10},
		{ID: "sql-top-5-users-by-spend", Title: "Топ-5 покупателей", Difficulty: "easy", EstimatedMinutes: 10},
		{ID: "sql-inner-vs-left-join", Title: "INNER vs LEFT JOIN: сироты", Difficulty: "easy", EstimatedMinutes: 12},
		{ID: "sql-day-over-day-diff", Title: "Разница день к дню", Difficulty: "medium", EstimatedMinutes: 15},
	},
	"sql_perf": {
		{ID: "sql-window-moving-avg", Title: "Скользящее среднее 7 дней", Difficulty: "medium", EstimatedMinutes: 15},
		{ID: "sql-rank-per-group", Title: "Ранжирование внутри группы", Difficulty: "medium", EstimatedMinutes: 15},
		{ID: "sql-percentile-latency", Title: "Перцентиль задержки", Difficulty: "medium", EstimatedMinutes: 18},
		{ID: "sql-pivot-by-month", Title: "PIVOT по месяцам", Difficulty: "medium", EstimatedMinutes: 18},
		{ID: "sql-recursive-hierarchy", Title: "Рекурсивная иерархия", Difficulty: "hard", EstimatedMinutes: 25},
	},
	"go_idioms": {
		{ID: "go-defer-order", Title: "Порядок выполнения defer", Difficulty: "easy", EstimatedMinutes: 8},
		{ID: "go-error-wrapping", Title: "Обёртка ошибок (errors.Is/As)", Difficulty: "easy", EstimatedMinutes: 10},
		{ID: "go-zero-values", Title: "Zero values и nil maps", Difficulty: "easy", EstimatedMinutes: 8},
		{ID: "go-slice-aliasing", Title: "Алиасинг слайсов", Difficulty: "easy", EstimatedMinutes: 10},
		{ID: "go-mutex-vs-syncmap", Title: "Mutex vs sync.Map", Difficulty: "medium", EstimatedMinutes: 18},
	},
	"go_concurrency": {
		{ID: "go-rate-limiter-token", Title: "Token-bucket rate limiter", Difficulty: "medium", EstimatedMinutes: 20},
		{ID: "go-worker-pool", Title: "Worker pool с graceful shutdown", Difficulty: "medium", EstimatedMinutes: 22},
		{ID: "go-pipeline-fanin", Title: "Fan-Out / Fan-In пайплайн", Difficulty: "medium", EstimatedMinutes: 20},
		{ID: "go-singleflight", Title: "Дедупликация через singleflight", Difficulty: "medium", EstimatedMinutes: 22},
		{ID: "go-deadlock-channels", Title: "Deadlock на двух каналах", Difficulty: "hard", EstimatedMinutes: 30},
	},
	"sd_basics": {
		{ID: "sd-key-value-cache", Title: "Дизайн in-memory кэша", Difficulty: "easy", EstimatedMinutes: 25},
		{ID: "sd-pastebin", Title: "Дизайн pastebin", Difficulty: "easy", EstimatedMinutes: 30},
		{ID: "sd-news-feed-mvp", Title: "MVP ленты новостей", Difficulty: "easy", EstimatedMinutes: 30},
		{ID: "sd-url-shortener", Title: "URL Shortener (bit.ly)", Difficulty: "hard", EstimatedMinutes: 35},
		{ID: "sd-rate-limiter", Title: "Rate Limiter", Difficulty: "hard", EstimatedMinutes: 35},
	},
	"sd_scale": {
		{ID: "sd-job-queue", Title: "Распределённая очередь задач", Difficulty: "medium", EstimatedMinutes: 40},
		{ID: "sd-image-cdn", Title: "CDN для изображений", Difficulty: "medium", EstimatedMinutes: 40},
		{ID: "sd-search-typeahead", Title: "Search typeahead", Difficulty: "medium", EstimatedMinutes: 35},
		{ID: "sd-chat-app", Title: "1-1 чат realtime", Difficulty: "hard", EstimatedMinutes: 45},
		{ID: "sd-payment-system", Title: "Платёжная система", Difficulty: "hard", EstimatedMinutes: 50},
	},
}
