// Judge tests — pin down the score math + JSON parser.
package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"druz9/mock_interview/domain"
	"druz9/shared/pkg/llmchain"
)

// fakeChain — canned responses keyed by call index. The judge calls Chat
// twice per JudgeAnswer (pass1 then pass2).
type fakeChain struct {
	responses []llmchain.Response
	err       error
	calls     int
}

func (f *fakeChain) Chat(_ context.Context, _ llmchain.Request) (llmchain.Response, error) {
	if f.err != nil {
		return llmchain.Response{}, f.err
	}
	if f.calls >= len(f.responses) {
		return llmchain.Response{}, errors.New("fake: out of responses")
	}
	r := f.responses[f.calls]
	f.calls++
	return r, nil
}

func (f *fakeChain) ChatStream(context.Context, llmchain.Request) (<-chan llmchain.StreamEvent, error) {
	return nil, errors.New("not used")
}

// helper — canned pass1 + pass2 JSON.
func cannedPass1(water int) llmchain.Response {
	return llmchain.Response{Content: `{"water_score":` + itoa(water) + `}`}
}
func cannedPass2(score int, missing []string, feedback string) llmchain.Response {
	miss := "[]"
	if len(missing) > 0 {
		miss = `["` + missing[0] + `"]`
		for i := 1; i < len(missing); i++ {
			miss = miss[:len(miss)-1] + `,"` + missing[i] + `"]`
		}
	}
	return llmchain.Response{Content: `{"score":` + itoa(score) +
		`,"matched_must_mention":[],"matched_nice_to_have":[],"missing_points":` + miss +
		`,"feedback":"` + feedback + `"}`}
}

// itoa without strconv import noise.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	buf := []byte{}
	for n > 0 {
		buf = append([]byte{byte('0' + n%10)}, buf...)
		n /= 10
	}
	if neg {
		buf = append([]byte{'-'}, buf...)
	}
	return string(buf)
}

func TestLLMJudge_Roundtrip(t *testing.T) {
	chain := &fakeChain{
		responses: []llmchain.Response{
			cannedPass1(20),
			cannedPass2(80, nil, "ok"),
		},
	}
	j := NewLLMJudge(chain, nil)
	out, err := j.JudgeAnswer(context.Background(), JudgeInput{
		QuestionBody: "q", UserAnswer: "a",
		StrictnessProfile: domain.AIStrictnessProfile{OffTopicPenalty: 0.30},
	})
	if err != nil {
		t.Fatalf("JudgeAnswer: %v", err)
	}
	// final = 80 × (1 - 0.20 × 0.30) = 80 × 0.94 = 75.2
	if out.Score < 75.1 || out.Score > 75.3 {
		t.Errorf("score=%v, want ~75.2", out.Score)
	}
	if out.Verdict != domain.AttemptVerdictPass {
		t.Errorf("verdict=%s, want pass", out.Verdict)
	}
	if out.WaterScore != 20 {
		t.Errorf("waterScore=%v, want 20", out.WaterScore)
	}
}

func TestLLMJudge_PitfallHalving(t *testing.T) {
	chain := &fakeChain{
		responses: []llmchain.Response{
			cannedPass1(0),
			cannedPass2(80, nil, "ok"),
		},
	}
	j := NewLLMJudge(chain, nil)
	out, err := j.JudgeAnswer(context.Background(), JudgeInput{
		QuestionBody: "q", UserAnswer: "это типичная ошибка senioров",
		StrictnessProfile: domain.AIStrictnessProfile{OffTopicPenalty: 0.30},
		ReferenceCriteria: domain.ReferenceCriteria{
			CommonPitfalls: []string{"типичная ошибка"},
		},
	})
	if err != nil {
		t.Fatalf("JudgeAnswer: %v", err)
	}
	// 80 × 1 (water=0) × 0.5 (pitfall) = 40
	if out.Score < 39 || out.Score > 41 {
		t.Errorf("score=%v, want ~40", out.Score)
	}
	if out.Verdict != domain.AttemptVerdictFail {
		t.Errorf("verdict=%s, want fail", out.Verdict)
	}
}

func TestLLMJudge_BiasTowardFail(t *testing.T) {
	chain := &fakeChain{
		responses: []llmchain.Response{
			cannedPass1(0),
			cannedPass2(60, nil, "ok"),
		},
	}
	j := NewLLMJudge(chain, nil)
	out, err := j.JudgeAnswer(context.Background(), JudgeInput{
		QuestionBody: "q", UserAnswer: "a",
		StrictnessProfile: domain.AIStrictnessProfile{
			OffTopicPenalty: 0.30, BiasTowardFail: true,
		},
	})
	if err != nil {
		t.Fatalf("JudgeAnswer: %v", err)
	}
	// 60 × 1 = 60 → borderline range, but bias_toward_fail flips to fail
	if out.Verdict != domain.AttemptVerdictFail {
		t.Errorf("verdict=%s, want fail (bias)", out.Verdict)
	}
}

func TestLLMJudge_ParseFailure_FallsBackToError(t *testing.T) {
	chain := &fakeChain{
		responses: []llmchain.Response{
			{Content: "this is not json at all"},
			{Content: "garbage"},
		},
	}
	j := NewLLMJudge(chain, nil)
	out, err := j.JudgeAnswer(context.Background(), JudgeInput{
		QuestionBody: "q", UserAnswer: "a",
	})
	if err != nil {
		t.Fatalf("JudgeAnswer should not propagate: got err=%v", err)
	}
	// errorFallback() returns 'fail' (not 'pending') so the row settles
	// terminally — the frontend reads ai_verdict='pending' as "judge
	// still working" and would spin forever otherwise.
	if out.Verdict != domain.AttemptVerdictFail {
		t.Errorf("verdict=%s, want fail (terminal fallback)", out.Verdict)
	}
	if out.Score != 0 {
		t.Errorf("score=%v, want 0", out.Score)
	}
	if out.Feedback == "" {
		t.Errorf("expected non-empty fallback feedback")
	}
}

// Smoke: parseLLMJSON tolerates surrounding text via regex extraction.
func TestParseLLMJSON_RegexFallback(t *testing.T) {
	var got struct {
		Score float64 `json:"score"`
	}
	if err := parseLLMJSON("here you go: {\"score\": 42} — done.", &got); err != nil {
		t.Fatalf("regex fallback: %v", err)
	}
	if got.Score != 42 {
		t.Errorf("score=%v, want 42", got.Score)
	}
}

// ── Phase C.1 — code-aware judge ────────────────────────────────────────

func TestLLMJudge_TaskSolve_UsesCodeTemplate(t *testing.T) {
	// task_solve skips Pass-1 → only one chain.Chat call expected.
	chain := &fakeChain{
		responses: []llmchain.Response{
			cannedPass2(85, nil, "корректное решение"),
		},
	}
	j := NewLLMJudge(chain, nil)
	out, err := j.JudgeAnswer(context.Background(), JudgeInput{
		Kind:                domain.AttemptTaskSolve,
		QuestionBody:        "Two Sum",
		ReferenceSolutionMD: "func twoSum(...) {}",
		UserAnswer:          "```go\nfunc twoSum(nums []int, t int) []int { return nil }\n```",
		StrictnessProfile:   domain.AIStrictnessProfile{OffTopicPenalty: 0.30},
	})
	if err != nil {
		t.Fatalf("JudgeAnswer: %v", err)
	}
	if chain.calls != 1 {
		t.Errorf("expected 1 chain call (no pass-1 for code), got %d", chain.calls)
	}
	if out.WaterScore != 0 {
		t.Errorf("waterScore=%v, want 0 for code", out.WaterScore)
	}
	// no off-topic penalty applied → final == 85
	if out.Score < 84.9 || out.Score > 85.1 {
		t.Errorf("score=%v, want ~85", out.Score)
	}
	if out.Verdict != domain.AttemptVerdictPass {
		t.Errorf("verdict=%s, want pass", out.Verdict)
	}
}

func TestLLMJudge_TaskSolve_PitfallHalving_StillApplies(t *testing.T) {
	chain := &fakeChain{
		responses: []llmchain.Response{
			cannedPass2(80, nil, "ok"),
		},
	}
	j := NewLLMJudge(chain, nil)
	out, err := j.JudgeAnswer(context.Background(), JudgeInput{
		Kind:       domain.AttemptTaskSolve,
		UserAnswer: "// O(n^2) brute force\nfor i { for j { ... } }",
		ReferenceCriteria: domain.ReferenceCriteria{
			CommonPitfalls: []string{"O(n^2) brute force"},
		},
		StrictnessProfile: domain.AIStrictnessProfile{OffTopicPenalty: 0.30},
	})
	if err != nil {
		t.Fatalf("JudgeAnswer: %v", err)
	}
	// 80 × 1 (no water penalty for code) × 0.5 (pitfall) = 40
	if out.Score < 39 || out.Score > 41 {
		t.Errorf("score=%v, want ~40 (pitfall halving still applies)", out.Score)
	}
}

func TestLLMJudge_QuestionAnswer_WithRelatedTask(t *testing.T) {
	// Capture the user message via a closure-style fake chain to verify the
	// related-task block was injected into pass-2.
	captured := ""
	chain := &captureChain{
		inner: &fakeChain{
			responses: []llmchain.Response{
				cannedPass1(0),
				cannedPass2(70, nil, "ok"),
			},
		},
		onUser: func(s string) { captured = s },
	}
	j := NewLLMJudge(chain, nil)
	_, err := j.JudgeAnswer(context.Background(), JudgeInput{
		Kind:              domain.AttemptQuestionAnswer,
		QuestionBody:      "Какова сложность твоего решения?",
		UserAnswer:        "O(n)",
		RelatedTaskMD:     "Two Sum: найди пару чисел…",
		StrictnessProfile: domain.AIStrictnessProfile{OffTopicPenalty: 0.30},
	})
	if err != nil {
		t.Fatalf("JudgeAnswer: %v", err)
	}
	if !strings.Contains(captured, "Two Sum") || !strings.Contains(captured, "Контекст: задача") {
		t.Errorf("expected RelatedTaskMD block in pass-2 user msg, got: %q", captured)
	}
}

// captureChain wraps fakeChain and records the user-role content of the
// SECOND call (pass-2) so tests can assert on prompt composition.
type captureChain struct {
	inner  *fakeChain
	onUser func(string)
}

func (c *captureChain) Chat(ctx context.Context, req llmchain.Request) (llmchain.Response, error) {
	// Pass-2 (the heavy correctness call) is the second one. Capture only
	// then so we don't accidentally record the water-detector message.
	if c.inner.calls == 1 {
		for _, m := range req.Messages {
			if m.Role == llmchain.RoleUser {
				c.onUser(m.Content)
			}
		}
	}
	return c.inner.Chat(ctx, req)
}

func (c *captureChain) ChatStream(ctx context.Context, req llmchain.Request) (<-chan llmchain.StreamEvent, error) {
	return c.inner.ChatStream(ctx, req)
}

// ── Phase D.1 — multimodal canvas judge ────────────────────────────────

// 1×1 transparent PNG in a valid data URL — kept locally so this test file
// doesn't depend on orchestrator_test.go's symbol.
const judgeTinyPNGDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII="

// canvasResp constructs a strict-JSON canvas judge response.
func canvasResp(score int, missing []string, feedback string) llmchain.Response {
	miss := "[]"
	if len(missing) > 0 {
		miss = `["` + missing[0] + `"]`
		for i := 1; i < len(missing); i++ {
			miss = miss[:len(miss)-1] + `,"` + missing[i] + `"]`
		}
	}
	return llmchain.Response{Content: `{"score":` + itoa(score) +
		`,"matched_must_mention":[],"matched_nice_to_have":[],"missing_points":` + miss +
		`,"feedback":"` + feedback + `"}`}
}

// captureVisionChain records the request issued to JudgeCanvas so the test
// can assert that an image content-block was attached and TaskVision was
// selected.
type captureVisionChain struct {
	resp     llmchain.Response
	lastReq  *llmchain.Request
	lastImgs []llmchain.Image
}

func (c *captureVisionChain) Chat(_ context.Context, req llmchain.Request) (llmchain.Response, error) {
	cp := req
	c.lastReq = &cp
	for _, m := range req.Messages {
		if len(m.Images) > 0 {
			c.lastImgs = append(c.lastImgs, m.Images...)
		}
	}
	return c.resp, nil
}
func (c *captureVisionChain) ChatStream(context.Context, llmchain.Request) (<-chan llmchain.StreamEvent, error) {
	return nil, errors.New("not used")
}

func TestLLMJudge_Canvas_BuildsMultimodalRequest(t *testing.T) {
	chain := &captureVisionChain{resp: canvasResp(75, []string{"cache"}, "ok")}
	j := NewLLMJudge(chain, nil)
	out, err := j.JudgeCanvas(context.Background(), JudgeCanvasInput{
		TaskBody:                 "URL shortener",
		FunctionalRequirementsMD: "writes:1k/s",
		ContextMD:                "Cassandra",
		ImageDataURL:             judgeTinyPNGDataURL,
		ReferenceCriteria: domain.ReferenceCriteria{
			MustMention: []string{"cache"},
		},
		StrictnessProfile: domain.AIStrictnessProfile{},
	})
	if err != nil {
		t.Fatalf("JudgeCanvas: %v", err)
	}
	if chain.lastReq == nil {
		t.Fatalf("vision chain not invoked")
	}
	if chain.lastReq.Task != llmchain.TaskVision {
		t.Errorf("Task=%s, want vision", chain.lastReq.Task)
	}
	if len(chain.lastImgs) == 0 {
		t.Errorf("expected image content-block forwarded to chain")
	} else if chain.lastImgs[0].MimeType != "image/png" {
		t.Errorf("mime=%q, want image/png", chain.lastImgs[0].MimeType)
	}
	// User-message must mention functional reqs verbatim so the judge sees them.
	gotUser := ""
	for _, m := range chain.lastReq.Messages {
		if m.Role == llmchain.RoleUser {
			gotUser = m.Content
		}
	}
	if !strings.Contains(gotUser, "writes:1k/s") {
		t.Errorf("functional reqs missing from user msg: %q", gotUser)
	}
	if out.Score != 75 {
		t.Errorf("score=%v, want 75", out.Score)
	}
	if out.WaterScore != 0 {
		t.Errorf("WaterScore=%v, want 0 for canvases", out.WaterScore)
	}
	if out.Verdict != domain.AttemptVerdictPass {
		t.Errorf("verdict=%s, want pass", out.Verdict)
	}
}

func TestLLMJudge_Canvas_PitfallHalving(t *testing.T) {
	chain := &captureVisionChain{resp: canvasResp(80, nil, "ok")}
	j := NewLLMJudge(chain, nil)
	out, err := j.JudgeCanvas(context.Background(), JudgeCanvasInput{
		TaskBody:     "x",
		ImageDataURL: judgeTinyPNGDataURL,
		// Pitfall match in the user-supplied context — should halve.
		ContextMD: "Решил поставить monolith DB, всё в одной",
		ReferenceCriteria: domain.ReferenceCriteria{
			CommonPitfalls: []string{"monolith DB"},
		},
		StrictnessProfile: domain.AIStrictnessProfile{},
	})
	if err != nil {
		t.Fatalf("JudgeCanvas: %v", err)
	}
	if out.Score < 39 || out.Score > 41 {
		t.Errorf("score=%v, want ~40 (pitfall halving)", out.Score)
	}
	if out.Verdict != domain.AttemptVerdictFail {
		t.Errorf("verdict=%s, want fail", out.Verdict)
	}
}

func TestLLMJudge_Canvas_BadDataURL_FallsBackToError(t *testing.T) {
	chain := &captureVisionChain{resp: canvasResp(80, nil, "ok")}
	j := NewLLMJudge(chain, nil)
	out, err := j.JudgeCanvas(context.Background(), JudgeCanvasInput{
		ImageDataURL: "not a data url at all",
	})
	if err != nil {
		t.Fatalf("should not propagate err: %v", err)
	}
	if out.Verdict != domain.AttemptVerdictFail {
		t.Errorf("verdict=%s, want fail (terminal fallback)", out.Verdict)
	}
}

// Mapping table for verdict edges.
func TestMapVerdict(t *testing.T) {
	cases := []struct {
		score float64
		bias  bool
		want  domain.AttemptVerdict
	}{
		{70, false, domain.AttemptVerdictPass},
		{49.9, false, domain.AttemptVerdictFail},
		{60, false, domain.AttemptVerdictBorderline},
		{60, true, domain.AttemptVerdictFail},
	}
	for _, c := range cases {
		got := mapVerdict(c.score, c.bias)
		if got != c.want {
			t.Errorf("mapVerdict(%v, %v) = %s, want %s", c.score, c.bias, got, c.want)
		}
	}
}
