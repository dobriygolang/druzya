package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// CustomPathNode — узел сгенерированный AI'ем из юзерской цели. Mirror'ит
// frontend `PresetNode` shape (см frontend/src/pages/onboarding/pathPresets.ts):
//
//	{ id, title, group, hint? }
//
// id мы делаем deterministic'ный из title через slugify, чтобы повторная
// генерация той же цели давала те же id'ы (для идемпотентности).
type CustomPathNode struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Group string `json:"group"`
	Hint  string `json:"hint,omitempty"`
}

// PathLLMDispatcher — узкий port в llmchain.ChatClient. Не таскаем весь
// llmchain в use-case слой ради единственного chat-call'а. Реализация в
// monolith wiring.
type PathLLMDispatcher interface {
	GenerateCustomPath(ctx context.Context, goal string) ([]CustomPathNode, error)
}

// GenerateCustomPath — UC. Юзер ввёл goal text («Senior Go в финтех»),
// LLM возвращает 8-15 nodes structure. UC валидирует input + post-fixes
// LLM output (slugify ids, dedupe, cap count).
type GenerateCustomPath struct {
	LLM PathLLMDispatcher
}

type GenerateCustomPathInput struct {
	Goal string
}

type GenerateCustomPathResult struct {
	Nodes []CustomPathNode
}

const (
	maxCustomPathNodes = 15
	minGoalLen         = 5
	maxGoalLen         = 600
)

func (uc *GenerateCustomPath) Do(ctx context.Context, in GenerateCustomPathInput) (GenerateCustomPathResult, error) {
	goal := strings.TrimSpace(in.Goal)
	if len(goal) < minGoalLen {
		return GenerateCustomPathResult{}, fmt.Errorf("tracks.GenerateCustomPath: goal too short (min %d chars)", minGoalLen)
	}
	if len(goal) > maxGoalLen {
		return GenerateCustomPathResult{}, fmt.Errorf("tracks.GenerateCustomPath: goal too long (max %d chars)", maxGoalLen)
	}
	if uc.LLM == nil {
		return GenerateCustomPathResult{}, fmt.Errorf("tracks.GenerateCustomPath: llm not wired")
	}
	raw, err := uc.LLM.GenerateCustomPath(ctx, goal)
	if err != nil {
		return GenerateCustomPathResult{}, fmt.Errorf("tracks.GenerateCustomPath: llm: %w", err)
	}
	nodes := normalizeNodes(raw)
	if len(nodes) == 0 {
		return GenerateCustomPathResult{}, fmt.Errorf("tracks.GenerateCustomPath: llm returned empty path")
	}
	return GenerateCustomPathResult{Nodes: nodes}, nil
}

// normalizeNodes — post-process LLM output: slugify ids, dedupe by id,
// cap по maxCustomPathNodes, drop empty titles.
func normalizeNodes(in []CustomPathNode) []CustomPathNode {
	seen := make(map[string]struct{}, len(in))
	out := make([]CustomPathNode, 0, len(in))
	for _, n := range in {
		title := strings.TrimSpace(n.Title)
		if title == "" {
			continue
		}
		group := strings.TrimSpace(n.Group)
		if group == "" {
			group = "General"
		}
		id := slugify(title)
		if id == "" {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, CustomPathNode{
			ID:    id,
			Title: title,
			Group: group,
			Hint:  strings.TrimSpace(n.Hint),
		})
		if len(out) >= maxCustomPathNodes {
			break
		}
	}
	return out
}

// slugify — deterministic ASCII slug из title'а. Лимит 60 chars. Не идеально
// для русского (просто оставляем cyrillic letters lowercase'нутыми) — для
// id-key'ев это OK, юзер их не видит.
func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	prevDash := false
	for _, r := range s {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') ||
			(r >= 0x0430 && r <= 0x044F) /* кириллица */ || r == 0x0451 /* ё */ :
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
				prevDash = true
			}
		}
		if b.Len() >= 60 {
			break
		}
	}
	return strings.Trim(b.String(), "-")
}

// PromptCustomPath — exported чтобы monolith adapter мог положить тот же
// текст в llmchain. Kept здесь чтобы prompt + UC жили рядом.
func PromptCustomPath(goal string) string {
	return fmt.Sprintf(`Ты — coach по подготовке senior IT-разработчиков к собеседованию.
Юзер описал свою цель в свободной форме. Сгенерируй initial карту тем (8-15
узлов) для подготовки именно под эту цель.

Каждый узел — это конкретная тема для изучения / тренировки (не abstract «улучшать алгоритмы»,
а «BFS / DFS / Dijkstra»). Группируй узлы в логические категории (Algorithms /
System Design / Distributed / Behavioural / etc.) — каждой категории по 2-5 узлов.

Возвращай ТОЛЬКО JSON-объект формата:
{"nodes":[{"title":"...","group":"...","hint":"..."}, ...]}

— title: 3-8 слов, конкретное название темы
— group: короткое имя категории (1-3 слова)
— hint: 1 предложение «зачем это» (опционально, можно пустым)

Цель юзера:
%s`, goal)
}

// ParseLLMResponse — общий parser tolerant к ```json``` fences.
func ParseLLMResponse(raw string) ([]CustomPathNode, error) {
	s := strings.TrimSpace(raw)
	// Strip ```json fences
	if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```json")
		s = strings.TrimPrefix(s, "```")
		if i := strings.LastIndex(s, "```"); i >= 0 {
			s = s[:i]
		}
		s = strings.TrimSpace(s)
	}
	var blob struct {
		Nodes []CustomPathNode `json:"nodes"`
	}
	if err := json.Unmarshal([]byte(s), &blob); err != nil {
		return nil, fmt.Errorf("parse: %w", err)
	}
	return blob.Nodes, nil
}
