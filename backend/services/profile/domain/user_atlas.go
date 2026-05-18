// user_atlas.go — user-driven atlas surface.
//
// Юзер пишет TODO («изучить транзакции»); ClassifyAndAddTodo UC спрашивает
// LLM (TaskAtlasClassify):
//  1. лучше всего ложится в existing curated node X → возвращаем match
//     (UC не создаёт новый row, фронт показывает «добавили в X»).
//  2. тематика свежая → возвращаем new node, persist в user_atlas_nodes.
//
// На /atlas profile.GetAtlas сливает curated + user-owned узлы юзера.
package domain

import (
	"context"
	"time"
)

// UserAtlasNode mirrors a row in user_atlas_nodes.
type UserAtlasNode struct {
	NodeKey     string
	Title       string
	Description string
	Section     string // enums.Section value
	Kind        string // hub | keystone | notable | small
	Cluster     string
	SourceText  string
	CreatedAt   time.Time
}

// UserAtlasRepo is the row-level CRUD surface for user-added nodes.
type UserAtlasRepo interface {
	ListByUser(ctx context.Context, userID string) ([]UserAtlasNode, error)
	UpsertNode(ctx context.Context, userID string, n UserAtlasNode) error
	DeleteNode(ctx context.Context, userID, nodeKey string) error
}

// AtlasNodePref — per-user pin/hide overlay (table user_atlas_node_prefs).
// Mutually exclusive по DB CHECK.
type AtlasNodePref struct {
	NodeKey string
	Pinned  bool
	Hidden  bool
}

// AtlasNodePrefsRepo возвращает все prefs юзера одной выборкой; GetAtlas
// собирает map[node_key] и аннотирует AtlasNode.Pinned/Hidden.
type AtlasNodePrefsRepo interface {
	ListByUser(ctx context.Context, userID string) ([]AtlasNodePref, error)
}
