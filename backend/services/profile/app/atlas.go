package app

import (
	"context"
	"fmt"

	"druz9/profile/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// AtlasNode is the enriched skill-atlas node passed to ports.
type AtlasNode struct {
	Key         string
	Title       string
	Description string
	Section     enums.Section
	Kind        string // normal | keystone | ascendant
	Progress    int
	Unlocked    bool
	Decaying    bool
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
//       nodes/edges editor, replace `catalogueNodes` / `catalogueEdges` with
//       a repo call reading `skill_catalogue` / `skill_edges` tables.
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
		out.Nodes = append(out.Nodes, AtlasNode{
			Key:         cn.Key,
			Title:       cn.Title,
			Description: cn.Description,
			Section:     cn.Section,
			Kind:        cn.Kind,
			Progress:    user.Progress,
			Unlocked:    user.UnlockedAt != nil,
			Decaying:    user.DecayedAt != nil,
		})
	}
	return out, nil
}

// catalogueNodes is the MVP static atlas. See STUB above.
type catalogueNode struct {
	Key         string
	Title       string
	Description string
	Section     enums.Section
	Kind        string
}

var catalogueNodes = []catalogueNode{
	{Key: "class_core", Title: "Ядро класса", Description: "Стартовая точка атласа", Section: enums.SectionAlgorithms, Kind: "keystone"},
	{Key: "algo_basics", Title: "Алгоритмы: основы", Description: "Массивы, строки, хеш-таблицы", Section: enums.SectionAlgorithms, Kind: "normal"},
	{Key: "algo_graphs", Title: "Алгоритмы: графы", Description: "DFS/BFS, топосорт, Дейкстра", Section: enums.SectionAlgorithms, Kind: "normal"},
	{Key: "algo_dp", Title: "Алгоритмы: DP", Description: "Динамическое программирование", Section: enums.SectionAlgorithms, Kind: "keystone"},
	{Key: "sql_basics", Title: "SQL: основы", Description: "JOIN, GROUP BY, подзапросы", Section: enums.SectionSQL, Kind: "normal"},
	{Key: "sql_perf", Title: "SQL: производительность", Description: "Индексы, EXPLAIN, денормализация", Section: enums.SectionSQL, Kind: "keystone"},
	{Key: "go_concurrency", Title: "Go: concurrency", Description: "Горутины, каналы, контексты", Section: enums.SectionGo, Kind: "keystone"},
	{Key: "go_idioms", Title: "Go: идиомы", Description: "Интерфейсы, ошибки, дженерики", Section: enums.SectionGo, Kind: "normal"},
	{Key: "sd_basics", Title: "System Design: основы", Description: "CAP, кэши, очереди", Section: enums.SectionSystemDesign, Kind: "normal"},
	{Key: "sd_scale", Title: "System Design: масштаб", Description: "Шардирование, репликация, consistency", Section: enums.SectionSystemDesign, Kind: "ascendant"},
	{Key: "beh_star", Title: "Behavioral: STAR", Description: "Структура ответов на вопросы", Section: enums.SectionBehavioral, Kind: "normal"},
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
