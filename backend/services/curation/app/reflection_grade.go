// reflection_grade.go — Phase 5 multi-takeaway reflection grading.
//
// Input: takeaways[] (3-5 user-written points) + optional confusion_text
// + Resource.topics_covered (expected concepts из curation.Resource).
// Output: {quality_score 0..1, extracted_topics, confusion_flag}.
//
// Storage flow:
//  1. Caller сохраняет user_resource_log row с reflection_takeaways
//     (raw JSON), reflection_text (legacy 1-line, может быть takeaways[0]).
//  2. UC заполняет reflection_quality_score / extracted_topics /
//     confusion_flag via UPDATE.
//  3. Hone bootstrap NoteCreator (Phase 5 native) уже создаёт hone_notes
//     row из reflection_text — multi-takeaway просто пишется в body
//     вместо single line.
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"druz9/shared/pkg/llmchain"
)

// ReflectionGrade UC.
type ReflectionGrade struct {
	Chain   llmchain.ChatClient
	Timeout time.Duration
}

// ReflectionGradeInput.
type ReflectionGradeInput struct {
	Takeaways      []string
	ConfusionText  string
	ExpectedTopics []string // resource.topics_covered
	AllowedNodes   []string // atlas-node ids для filtering
}

// ReflectionGradeOutput.
type ReflectionGradeOutput struct {
	QualityScore    float32  `json:"quality_score"`
	ExtractedTopics []string `json:"extracted_topics"`
	ConfusionFlag   bool     `json:"confusion_flag"`
}

func (uc *ReflectionGrade) Do(ctx context.Context, in ReflectionGradeInput) (ReflectionGradeOutput, error) {
	clean := make([]string, 0, len(in.Takeaways))
	for _, t := range in.Takeaways {
		if s := strings.TrimSpace(t); s != "" {
			clean = append(clean, s)
		}
	}
	if len(clean) == 0 {
		return ReflectionGradeOutput{}, fmt.Errorf("curation.ReflectionGrade: no non-empty takeaways")
	}
	if uc.Chain == nil {
		// Fallback — наивная эвристика: quality по числу takeaway'ев,
		// confusion_flag по наличию confusion_text.
		out := ReflectionGradeOutput{
			QualityScore:    naiveQuality(clean),
			ExtractedTopics: in.ExpectedTopics,
			ConfusionFlag:   strings.TrimSpace(in.ConfusionText) != "",
		}
		return out, nil
	}
	timeout := uc.Timeout
	if timeout == 0 {
		timeout = 8 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	prompt := buildReflectionGradePrompt(in, clean)
	resp, err := uc.Chain.Chat(ctx, llmchain.Request{
		Task:        llmchain.TaskReflectionGrade,
		JSONMode:    true,
		Temperature: 0.2,
		MaxTokens:   400,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: gradeSystemPrompt},
			{Role: llmchain.RoleUser, Content: prompt},
		},
	})
	if err != nil {
		// Fail-soft — fallback на наивную оценку чтобы UI не блокировался.
		return ReflectionGradeOutput{
			QualityScore:    naiveQuality(clean),
			ExtractedTopics: in.ExpectedTopics,
			ConfusionFlag:   strings.TrimSpace(in.ConfusionText) != "",
		}, nil
	}
	out, perr := parseReflectionGrade(resp.Content)
	if perr != nil {
		return ReflectionGradeOutput{
			QualityScore:    naiveQuality(clean),
			ExtractedTopics: in.ExpectedTopics,
			ConfusionFlag:   strings.TrimSpace(in.ConfusionText) != "",
		}, nil
	}
	if len(in.AllowedNodes) > 0 {
		set := make(map[string]struct{}, len(in.AllowedNodes))
		for _, id := range in.AllowedNodes {
			set[id] = struct{}{}
		}
		out.ExtractedTopics = filterAllowed(out.ExtractedTopics, set)
	}
	if out.QualityScore < 0 {
		out.QualityScore = 0
	}
	if out.QualityScore > 1 {
		out.QualityScore = 1
	}
	return out, nil
}

const gradeSystemPrompt = `You grade a learning reflection for druz9, a senior developer learning platform.

Output strict JSON ONLY:
{
  "quality_score": <float 0..1>,
  "extracted_topics": ["<atlas_node_id>", ...],
  "confusion_flag": <bool>
}

Rules:
- quality_score reflects depth + specificity:
  · 0.0-0.3 generic ("got it", "interesting") — low signal
  · 0.3-0.6 surface — names a concept без specifics
  · 0.6-0.85 specific — explains mechanism / trade-off
  · 0.85-1.0 deep — connects to other concepts, identifies edge cases
- extracted_topics: only atlas_node_ids actually mentioned (semantic match, not lexical)
- confusion_flag: true if user expresses doubt, "didn't get", "still confused", or asks a question
- Be strict on quality — false-positive promotes shallow reading`

func buildReflectionGradePrompt(in ReflectionGradeInput, clean []string) string {
	var b strings.Builder
	b.WriteString("TAKEAWAYS:\n")
	for i, t := range clean {
		fmt.Fprintf(&b, "%d. %s\n", i+1, t)
	}
	if c := strings.TrimSpace(in.ConfusionText); c != "" {
		fmt.Fprintf(&b, "\nCONFUSION: %s\n", c)
	}
	if len(in.ExpectedTopics) > 0 {
		fmt.Fprintf(&b, "\nEXPECTED TOPICS (from resource): %s\n",
			strings.Join(in.ExpectedTopics, ", "))
	}
	if len(in.AllowedNodes) > 0 {
		fmt.Fprintf(&b, "\nALLOWED atlas_node_ids: %s\n",
			strings.Join(in.AllowedNodes, ", "))
	}
	b.WriteString("\nGrade strictly. Return JSON only.")
	return b.String()
}

func parseReflectionGrade(raw string) (ReflectionGradeOutput, error) {
	cleaned := stripFences(raw)
	var out ReflectionGradeOutput
	if err := json.Unmarshal([]byte(cleaned), &out); err != nil {
		return out, fmt.Errorf("unmarshal: %w", err)
	}
	return out, nil
}

func naiveQuality(takeaways []string) float32 {
	if len(takeaways) == 0 {
		return 0
	}
	totalLen := 0
	for _, t := range takeaways {
		totalLen += len(t)
	}
	avg := totalLen / len(takeaways)
	// 0 takeaways=0, 1=0.3, 2=0.5, 3=0.65, 4=0.75, 5=0.8 + длина.
	base := float32(len(takeaways)) * 0.15
	if base > 0.8 {
		base = 0.8
	}
	if avg > 80 {
		base += 0.1
	}
	if base > 0.95 {
		base = 0.95
	}
	return base
}
