// Package domain — типы для curated external resources.
//
// druz9 — ranking-proxy на чужой контент (Strang LA, mlcourse, DDIA,
// Kaggle, etc.). Этот пакет описывает каноничный shape элемента
// external_resources jsonb (миграция 00051) — единая структура для
// atlas_nodes.external_resources и track_steps.external_resources.
//
// Validation evolves вне DB: jsonb CHECK constraint быстро устаревает
// (новые kind'ы, новые priority levels). Все правила — здесь, в
// `Validate()`. Cmd/seed_resources валидирует output LLM перед записью
// SQL UPDATE'а.
package domain

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// Kind — тип ресурса. Соответствует таксономии в memory/project_curation_model.
type Kind string

const (
	KindCourse  Kind = "course"
	KindVideo   Kind = "video"
	KindBook    Kind = "book"
	KindPaper   Kind = "paper"
	KindArticle Kind = "article"
	KindTool    Kind = "tool"
	KindKata    Kind = "kata"
	KindPodcast Kind = "podcast"
)

func (k Kind) IsValid() bool {
	switch k {
	case KindCourse, KindVideo, KindBook, KindPaper, KindArticle, KindTool, KindKata, KindPodcast:
		return true
	}
	return false
}

// Level — глубина / сложность материала.
//
//	A — entry / preparation
//	B — middle / standard
//	C — senior / staff
//	D — research / esoteric
type Level string

const (
	LevelA Level = "A"
	LevelB Level = "B"
	LevelC Level = "C"
	LevelD Level = "D"
)

func (l Level) IsValid() bool {
	switch l {
	case LevelA, LevelB, LevelC, LevelD:
		return true
	}
	return false
}

// Priority — насколько ресурс обязателен в цепочке.
type Priority string

const (
	// PriorityCore — обязателен, без него собес/skill не закрыт.
	PriorityCore Priority = "core"
	// PrioritySupplement — углубление поверх core.
	PrioritySupplement Priority = "supplement"
	// PriorityOptional — для тех, кто хочет "ещё".
	PriorityOptional Priority = "optional"
)

func (p Priority) IsValid() bool {
	switch p {
	case PriorityCore, PrioritySupplement, PriorityOptional:
		return true
	}
	return false
}

// Depth — насколько глубоко ресурс копает тему. Ortho к Level (Level —
// expected reader, Depth — content shape).
//
//	intro     — первое знакомство, surface coverage
//	intuition — building intuition, без полной формализации
//	deep      — formal / detailed / production-grade
//	reference — справочник / cheat-sheet, не reading-from-zero
type Depth string

const (
	DepthIntro     Depth = "intro"
	DepthIntuition Depth = "intuition"
	DepthDeep      Depth = "deep"
	DepthReference Depth = "reference"
)

func (d Depth) IsValid() bool {
	switch d {
	case DepthIntro, DepthIntuition, DepthDeep, DepthReference:
		return true
	}
	return false
}

// Resource — единичный curated линк.
//
// JSON-ключи snake_case, чтобы matchить shape в jsonb-колонках и output
// LLM-задачи TaskCurateResource.
//
// Расширения 2026-05-04 (Sergey patch — anchor ресурса на atlas-ontology):
//   - TopicsCovered / Prereqs — atlas_node ids; нужны TaskReflectionExtract
//     (как expected concepts) и resource-engagement producer (gap-detection).
//   - Summary — 2-3 sentences; AI-tutor вытаскивает чтобы прокомментить
//     без чтения целого ресурса.
//   - Depth — content shape (intro/intuition/deep/reference); ortho к Level.
//   - FormatNotes — UI-hint каверы («interactive», «paywalled», «video-no-transcript»).
//   - ReflectionPrompt — optional 1-line вопрос, который step UX покажет
//     юзеру после core resource. Если пусто — UI берёт generic «1 sentence — главное?».
type Resource struct {
	URL      string   `json:"url"`
	Title    string   `json:"title"`
	Author   string   `json:"author"`
	Kind     Kind     `json:"kind"`
	Minutes  int      `json:"minutes"`
	Level    Level    `json:"level"`
	Priority Priority `json:"priority"`
	// Why — зачем этот ресурс именно здесь, в одном предложении. Это
	// наш unique value поверх ranking — не «прочитай Strang», а
	// «прочитай Strang ch.3 потому что лучшая интуиция импьюрити-
	// сплитов без кода».
	Why string `json:"why"`

	// Anchor на atlas-ontology — atlas_node ids (e.g. "ml_classical").
	TopicsCovered []string `json:"topics_covered,omitempty"`
	Prereqs       []string `json:"prereqs,omitempty"`

	// 2-3 sentence summary для AI-tutor / coach hero.
	Summary string `json:"summary,omitempty"`

	// Content shape (intro / intuition / deep / reference). Optional —
	// если пусто, UI fallback на Level + Kind.
	Depth Depth `json:"depth,omitempty"`

	// UI/UX-hint строкой: "interactive", "paywalled", "video-no-transcript",
	// "code-only-no-prose", etc. Не enum — formats разнообразны.
	FormatNotes string `json:"format_notes,omitempty"`

	// Optional 1-line reflection-prompt. Если пусто — generic UX prompt.
	ReflectionPrompt string `json:"reflection_prompt,omitempty"`
}

// ErrInvalidResource — любая невалидная Resource.
var ErrInvalidResource = errors.New("curation: invalid resource")

// Validate проверяет shape по правилам curation:
//   - URL парсится как абсолютный http(s)
//   - Title/Why непустые после trim
//   - Kind/Level/Priority — валидные enum-значения
//   - Minutes >= 0 (0 = unknown, допустимо)
func (r Resource) Validate() error {
	if strings.TrimSpace(r.Title) == "" {
		return fmt.Errorf("%w: title is empty", ErrInvalidResource)
	}
	if strings.TrimSpace(r.Why) == "" {
		return fmt.Errorf("%w: why is empty (must explain unique relevance)", ErrInvalidResource)
	}
	u, err := url.Parse(r.URL)
	if err != nil || u == nil || !u.IsAbs() || (u.Scheme != "http" && u.Scheme != "https") {
		return fmt.Errorf("%w: url must be absolute http(s), got %q", ErrInvalidResource, r.URL)
	}
	if !r.Kind.IsValid() {
		return fmt.Errorf("%w: kind %q invalid", ErrInvalidResource, r.Kind)
	}
	if !r.Level.IsValid() {
		return fmt.Errorf("%w: level %q invalid", ErrInvalidResource, r.Level)
	}
	if !r.Priority.IsValid() {
		return fmt.Errorf("%w: priority %q invalid", ErrInvalidResource, r.Priority)
	}
	if r.Minutes < 0 {
		return fmt.Errorf("%w: minutes negative (%d)", ErrInvalidResource, r.Minutes)
	}
	if r.Depth != "" && !r.Depth.IsValid() {
		return fmt.Errorf("%w: depth %q invalid", ErrInvalidResource, r.Depth)
	}
	for i, n := range r.TopicsCovered {
		if strings.TrimSpace(n) == "" {
			return fmt.Errorf("%w: topics_covered[%d] is blank", ErrInvalidResource, i)
		}
	}
	for i, n := range r.Prereqs {
		if strings.TrimSpace(n) == "" {
			return fmt.Errorf("%w: prereqs[%d] is blank", ErrInvalidResource, i)
		}
	}
	return nil
}

// ResourceList — упорядоченная коллекция, marshalled как jsonb-массив.
type ResourceList []Resource

// Validate проходит по всем элементам. Дубли по URL запрещены — это
// частая ошибка LLM (один и тот же Strang дважды под разными title'ами).
func (l ResourceList) Validate() error {
	seen := make(map[string]struct{}, len(l))
	for i, r := range l {
		if err := r.Validate(); err != nil {
			return fmt.Errorf("curation: resource[%d]: %w", i, err)
		}
		key := strings.ToLower(r.URL)
		if _, dup := seen[key]; dup {
			return fmt.Errorf("%w: duplicate url %q at index %d", ErrInvalidResource, r.URL, i)
		}
		seen[key] = struct{}{}
	}
	return nil
}

// Marshal возвращает каноничный JSON для записи в jsonb. Пустой list
// сериализуется как `[]`, чтобы соответствовать DEFAULT '[]'::jsonb.
func (l ResourceList) Marshal() ([]byte, error) {
	if l == nil {
		return []byte("[]"), nil
	}
	out, err := json.Marshal(l)
	if err != nil {
		return nil, fmt.Errorf("ResourceList.Marshal: %w", err)
	}
	return out, nil
}

// Unmarshal читает jsonb-bytes (включая null/'[]'/полный массив) в list.
// Невалидные элементы вернут ошибку — caller выбирает skip vs fail.
func Unmarshal(raw []byte) (ResourceList, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var out ResourceList
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("curation: unmarshal: %w", err)
	}
	return out, nil
}
