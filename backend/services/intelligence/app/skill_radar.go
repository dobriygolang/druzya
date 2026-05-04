// skill_radar.go — Phase 2 5-axis radar derived from mock_sessions.ai_report.
//
// Каждый mock-section (de / ml_eng / system_design_senior / english_hr / etc)
// у нас grade'ится с 5-axis rubric (см services/ai_mock/domain/<section>.go).
// Radar UC агрегирует scores per-axis за recent finished mocks одного rubric'а.
//
// Strategy:
//   1. Caller передаёт rubric ('de' | 'dev_senior' | 'mle' | 'english').
//   2. UC фильтрует mocks по соответствующему section (или fallback'ит на
//      learning_state mode для derive'а).
//   3. Для каждой axis из rubric definition — averages из ai_report.sections[axis].score.
//   4. Normalizes 0..100 → 0..1 для UI.
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// RadarRubric — статически известный набор axes per-rubric.
type RadarRubric struct {
	Key   string
	Axes  []RadarAxisDef
	// Sections — какие mock_sessions.section попадают в этот rubric.
	Sections []string
}

// RadarAxisDef — axis с stable key + UI label.
type RadarAxisDef struct {
	Key   string
	Label string
}

// SkillRadarAxis — one axis with averaged score.
type SkillRadarAxis struct {
	Key       string
	Label     string
	Score     float64 // 0..1
	MockCount int
}

// SkillRadarSnapshot — full 5-axis result.
type SkillRadarSnapshot struct {
	Rubric string
	Axes   []SkillRadarAxis
}

// Хардкодим rubrics — синхронно с services/ai_mock/domain/*.go.
var rubrics = map[string]RadarRubric{
	"de": {
		Key: "de",
		Axes: []RadarAxisDef{
			{Key: "etl_design", Label: "etl"},
			{Key: "distributed", Label: "dist"},
			{Key: "sql_modeling", Label: "sql"},
			{Key: "streaming", Label: "stream"},
			{Key: "production_ops", Label: "ops"},
		},
		Sections: []string{"de"},
	},
	"mle": {
		Key: "mle",
		Axes: []RadarAxisDef{
			{Key: "theoretical_depth", Label: "theory"},
			{Key: "practical_implementation", Label: "code"},
			{Key: "ml_system_design", Label: "sysd"},
			{Key: "data_intuition", Label: "data"},
			{Key: "production_awareness", Label: "ops"},
		},
		Sections: []string{"ml_eng"},
	},
	"dev_senior": {
		Key: "dev_senior",
		Axes: []RadarAxisDef{
			{Key: "problem_solving", Label: "algo"},
			{Key: "code_quality", Label: "code"},
			{Key: "communication", Label: "comm"},
			{Key: "stress_handling", Label: "stress"},
			// Filler axis to keep 5-shape геометрию.
			{Key: "system_design", Label: "sysd"},
		},
		Sections: []string{"algorithms", "sql", "go", "system_design", "system_design_senior"},
	},
}

// GetSkillRadar — UC.
type GetSkillRadar struct {
	Mocks domain.MockReader
}

// GetSkillRadarInput.
type GetSkillRadarInput struct {
	UserID uuid.UUID
	Rubric string // optional override; if empty, default 'dev_senior'
}

// Do reads recent finished mocks, picks rubric, agg'регирует scores.
func (uc *GetSkillRadar) Do(ctx context.Context, in GetSkillRadarInput) (SkillRadarSnapshot, error) {
	rubricKey := in.Rubric
	if rubricKey == "" {
		rubricKey = "dev_senior"
	}
	rub, ok := rubrics[rubricKey]
	if !ok {
		return SkillRadarSnapshot{}, fmt.Errorf("intelligence.GetSkillRadar: unknown rubric %q", rubricKey)
	}

	mocks, err := uc.Mocks.LastNFinished(ctx, in.UserID, 25)
	if err != nil {
		return SkillRadarSnapshot{}, fmt.Errorf("intelligence.GetSkillRadar: %w", err)
	}

	// Filter по sections rubric'а.
	relevant := mocks[:0]
	for _, m := range mocks {
		if sectionInRubric(m.Section, rub.Sections) {
			relevant = append(relevant, m)
		}
	}

	out := SkillRadarSnapshot{Rubric: rubricKey}
	for _, ax := range rub.Axes {
		score, count := avgAxis(relevant, ax.Key)
		out.Axes = append(out.Axes, SkillRadarAxis{
			Key:       ax.Key,
			Label:     ax.Label,
			Score:     score,
			MockCount: count,
		})
	}
	return out, nil
}

func sectionInRubric(section string, rubricSections []string) bool {
	for _, s := range rubricSections {
		if s == section {
			return true
		}
	}
	return false
}

// avgAxis — извлекает per-axis score из ai_report JSONB и усредняет.
// ai_report shape ожидается:
//   { "overall_score": int, "sections": {"<axis_key>": {"score": int, ...}, ...} }
// Empty / malformed reports → score 0, count 0.
func avgAxis(mocks []domain.MockSessionSummary, axisKey string) (float64, int) {
	var sum float64
	var cnt int
	for _, m := range mocks {
		if len(m.AIReportRaw) == 0 {
			continue
		}
		var rep struct {
			Sections map[string]struct {
				Score int `json:"score"`
			} `json:"sections"`
		}
		if err := json.Unmarshal(m.AIReportRaw, &rep); err != nil {
			continue
		}
		if sec, ok := rep.Sections[axisKey]; ok {
			sum += float64(sec.Score)
			cnt++
		}
	}
	if cnt == 0 {
		return 0, 0
	}
	avg := sum / float64(cnt) / 100.0
	if avg < 0 {
		avg = 0
	}
	if avg > 1 {
		avg = 1
	}
	return avg, cnt
}

// SortedAxes — стабильный output order (по rubric definition).
func (s SkillRadarSnapshot) SortedAxes() []SkillRadarAxis {
	out := make([]SkillRadarAxis, len(s.Axes))
	copy(out, s.Axes)
	sort.SliceStable(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out
}
