// classify_atlas_todo.go — user-driven atlas.
//
// UC: юзер пишет TODO («изучить транзакции в Postgres»). LLM
// (TaskAtlasClassify через PathLLMDispatcher-подобный adapter)
// classifies в одно из:
//  1. existing curated atlas_node — возвращаем его id, ничего не пишем.
//  2. new node — генерим snake_case node_key, persist в user_atlas_nodes,
//     возвращаем enriched view.
//
// LLM-дispatcher изолирован за интерфейсом, чтобы UC оставался unit-
// testable без живого llmchain. Wiring — в cmd/monolith/services/profile.go.
//
// Контракт JSON-ответа модели (system prompt enforces):
//
//	{
//	  "match_id": "go_concurrency",      // OR ""
//	  "section":  "go",                  // если new
//	  "title":    "Транзакции в Postgres",
//	  "cluster":  "sql",
//	  "kind":     "small"
//	}
package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"

	"druz9/profile/domain"

	"github.com/google/uuid"
)

// AtlasClassification — результат классификации TODO.
type AtlasClassification struct {
	// MatchedKey не пуст → юзеру говорим «добавили в существующий узел».
	// Иначе — был создан новый user_atlas_nodes row, ниже — его поля.
	MatchedKey string

	NewNode *domain.UserAtlasNode // nil if matched
}

// AtlasClassifier — LLM-side dispatcher.
//
// Принимает source TODO + список curated nodes (key + title + section)
// для grounded matching. Должен вернуть строго-JSON по схеме (см. system
// prompt). Реализация — adapter в cmd/monolith.
type AtlasClassifier interface {
	Classify(ctx context.Context, todo string, catalogue []AtlasClassifyCandidate) (AtlasClassifyResult, error)
}

// AtlasClassifyCandidate — то, что мы шлём в prompt модели как контекст.
type AtlasClassifyCandidate struct {
	Key     string
	Title   string
	Section string
}

// AtlasClassifyResult — то, что модель возвращает.
type AtlasClassifyResult struct {
	MatchID string `json:"match_id"`
	Section string `json:"section"`
	Title   string `json:"title"`
	Cluster string `json:"cluster"`
	Kind    string `json:"kind"`
}

// ClassifyAtlasTodo — UC entry point.
type ClassifyAtlasTodo struct {
	Catalogue domain.AtlasCatalogueRepo
	UserAtlas domain.UserAtlasRepo
	LLM       AtlasClassifier
}

const (
	atlasTodoMinLen = 3
	atlasTodoMaxLen = 500
)

// Do classifies a free-form TODO and persists a new user atlas node if
// the LLM didn't find a curated match.
func (uc *ClassifyAtlasTodo) Do(ctx context.Context, userID uuid.UUID, todo string) (AtlasClassification, error) {
	if uc == nil {
		return AtlasClassification{}, errors.New("profile.ClassifyAtlasTodo: nil uc")
	}
	if uc.LLM == nil {
		return AtlasClassification{}, errors.New("profile.ClassifyAtlasTodo: LLM not configured")
	}
	if uc.Catalogue == nil || uc.UserAtlas == nil {
		return AtlasClassification{}, errors.New("profile.ClassifyAtlasTodo: repos required")
	}
	trimmed := strings.TrimSpace(todo)
	if n := len([]rune(trimmed)); n < atlasTodoMinLen || n > atlasTodoMaxLen {
		return AtlasClassification{}, fmt.Errorf("profile.ClassifyAtlasTodo: todo len out of range [%d,%d]", atlasTodoMinLen, atlasTodoMaxLen)
	}

	cat, err := uc.Catalogue.ListNodes(ctx)
	if err != nil {
		return AtlasClassification{}, fmt.Errorf("profile.ClassifyAtlasTodo: catalogue: %w", err)
	}
	cands := make([]AtlasClassifyCandidate, 0, len(cat))
	for _, n := range cat {
		cands = append(cands, AtlasClassifyCandidate{Key: n.ID, Title: n.Title, Section: n.Section})
	}

	res, err := uc.LLM.Classify(ctx, trimmed, cands)
	if err != nil {
		return AtlasClassification{}, fmt.Errorf("profile.ClassifyAtlasTodo: classify: %w", err)
	}

	// match path: проверяем что match_id вообще в каталоге
	if res.MatchID != "" {
		for _, n := range cat {
			if n.ID == res.MatchID {
				return AtlasClassification{MatchedKey: res.MatchID}, nil
			}
		}
		// модель «выдумала» key — fallback в new-node path.
	}

	// new-node path
	title := strings.TrimSpace(res.Title)
	if title == "" {
		title = trimmed
	}
	section := strings.TrimSpace(res.Section)
	if section == "" {
		section = "algorithms"
	}
	cluster := strings.TrimSpace(res.Cluster)
	if cluster == "" {
		cluster = "custom"
	}
	kind := strings.TrimSpace(res.Kind)
	if !validKind(kind) {
		kind = "small"
	}

	nodeKey := makeUserNodeKey(userID, title)
	node := domain.UserAtlasNode{
		NodeKey:     nodeKey,
		Title:       title,
		Description: "",
		Section:     section,
		Kind:        kind,
		Cluster:     cluster,
		SourceText:  trimmed,
		CreatedAt:   time.Now().UTC(),
	}
	if err := uc.UserAtlas.UpsertNode(ctx, userID.String(), node); err != nil {
		return AtlasClassification{}, fmt.Errorf("profile.ClassifyAtlasTodo: upsert: %w", err)
	}
	return AtlasClassification{NewNode: &node}, nil
}

// PromptAtlasClassify — system prompt для модели. Экспортируем для
// adapter'а в cmd/monolith.
func PromptAtlasClassify(catalogue []AtlasClassifyCandidate) string {
	var b strings.Builder
	b.WriteString("Ты — классификатор учебных TODO. Юзер описал тему которую хочет изучить.\n")
	b.WriteString("Доступные curated узлы атласа (формат key | section | title):\n")
	for _, c := range catalogue {
		fmt.Fprintf(&b, "  %s | %s | %s\n", c.Key, c.Section, c.Title)
	}
	b.WriteString("\nЕсли TODO явно ложится в один из узлов — верни match_id = его key.\n")
	b.WriteString("Иначе верни пустой match_id и предложи новый узел: section ∈ {algorithms, sql, go, system_design, behavioral, ml, english, custom}, kind ∈ {small, notable, keystone}, cluster ∈ section либо тематический string.\n")
	b.WriteString("Title — короткое существительное-словосочетание, ≤ 50 символов.\n")
	b.WriteString("Возвращай ТОЛЬКО валидный JSON: {\"match_id\":\"...\",\"section\":\"...\",\"title\":\"...\",\"cluster\":\"...\",\"kind\":\"...\"}\n")
	return b.String()
}

// ParseAtlasClassifyResponse — strict JSON parser для adapter'а.
func ParseAtlasClassifyResponse(raw string) (AtlasClassifyResult, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return AtlasClassifyResult{}, errors.New("empty response")
	}
	// Strip markdown fence if present.
	if strings.HasPrefix(raw, "```") {
		raw = strings.TrimPrefix(raw, "```json")
		raw = strings.TrimPrefix(raw, "```")
		raw = strings.TrimSuffix(raw, "```")
		raw = strings.TrimSpace(raw)
	}
	var out AtlasClassifyResult
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return AtlasClassifyResult{}, fmt.Errorf("parse atlas classify: %w", err)
	}
	return out, nil
}

func validKind(k string) bool {
	switch k {
	case "small", "notable", "keystone", "hub":
		return true
	}
	return false
}

var nonAlnumRe = regexp.MustCompile(`[^a-z0-9]+`)

// makeUserNodeKey — детерминированный snake-case key с user-prefix'ом,
// чтобы в merge-view гарантировать unique-ность user vs curated.
//
// Format: "u_<short-uuid>_<slug>" (короткий 8-char prefix uuid'а юзера,
// чтобы collision-rate был достаточно низким даже для разных юзеров с
// одинаковыми title'ами).
func makeUserNodeKey(userID uuid.UUID, title string) string {
	slug := strings.ToLower(strings.TrimSpace(title))
	// rune-aware: dropping non-ASCII letters → cyrillic становится "" и
	// fallback в short uuid prefix.
	var b strings.Builder
	for _, r := range slug {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if r < 128 {
				b.WriteRune(r)
			} else {
				b.WriteRune('_')
			}
		} else {
			b.WriteRune('-')
		}
	}
	clean := nonAlnumRe.ReplaceAllString(b.String(), "_")
	clean = strings.Trim(clean, "_")
	if clean == "" {
		clean = "node"
	}
	if len(clean) > 32 {
		clean = clean[:32]
	}
	short := strings.ReplaceAll(userID.String(), "-", "")
	if len(short) > 8 {
		short = short[:8]
	}
	return "u_" + short + "_" + clean
}
