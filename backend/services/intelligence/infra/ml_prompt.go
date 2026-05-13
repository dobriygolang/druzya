// Package infra — ML-aware system-prompt overlay.
//
// Applied поверх стандартного briefSystemPrompt
// когда MLProfile.IsML=true (primary_goal=ml_offer ИЛИ active_track=ml). Тот
// же pattern что и personaToneOverlay / variantPromptOverlay: коротенький
// hint, добавляемый отдельным system message — НЕ переписываем base prompt.
//
// Rationale: длинный полный «ML prompt» вместо overlay'я перетянул бы attention
// модели и привёл бы к prompt-leak («Hi! As an ML coach…»). Short overlay
// меняет наклон без переписывания output-контракта (JSON envelope identical
// для default + ML; downstream parser один).
//
// Canonical ML prompt body хранится в coach_prompts table (migration 00116,
// slug='daily_brief_ml') — admin может править через /admin/coach UI. Overlay
// constant ниже — hot-path mirror того prompt-а, чтобы brief synth не делал
// extra DB roundtrip per call. См PickCoachPromptKey() для slug selection
// logic (admin /coach analytics / future overlay-hot-reload).
package infra

import (
	"druz9/intelligence/domain"
)

// mlBriefOverlay — system overlay для daily brief'а ML-юзера. Mirror of
// daily_brief_ml prompt (migration 00116) compressed to overlay form.
//
// Не дублирует output-схему base prompt'а — caller (synth) кладёт base
// briefSystemPrompt первым, ML overlay вторым, и base уже задал JSON envelope.
const mlBriefOverlay = `ML-COACH OVERLAY (user committed to ML offer track):
- Reframe «algorithms» → ML algorithms (gradient descent / attention / sampling / optimization).
- Reframe «system design» → ML system design (recsys / ranking / training pipeline / feature store / inference SLO).
- Reframe «code-review» → numpy broadcasting / pytorch tensor ops / sklearn Pipeline idioms / data leakage detection.
- Weak axes mapping: theoretical_depth / practical_implementation / ml_system_design / data_intuition / production_awareness (5-axis ML radar — replaces generic algo/sysdesign/communication/behavior/problem_solving).
- Relevant resource references (cite ONLY when topic matches; never namedrop generically): Lilian Weng's blog (attention / RL / alignment), Sebastian Raschka «ML Q and AI», Chip Huyen «Designing ML Systems» (production), Andrej Karpathy zero-to-hero (backprop / transformers from scratch), Hugging Face course (NLP), Papers with Code (replicate SOTA), fast.ai (applied DL).
- FORBIDDEN — generic Go senior tropes for ML users: «practice algorithms» (без ML context), «read DDIA» (use Chip Huyen instead), leetcode-only recs.
- Rationale must cite ML-specific signal (e.g. «last ml_coding mock 4/10 on gradient implementation», «skill_key=backprop progress 18/100»).`

// mlNextActionOverlay — system overlay для NextAction UC. Тот же spirit что
// и mlBriefOverlay, но короче (NextAction output is single action, не 3-item
// list).
const mlNextActionOverlay = `ML-COACH OVERLAY (user committed to ML offer track):
- Reframe action targets to ML (numpy/pytorch coding drill > algo kata; recsys/ranking sysdesign > generic distributed-systems).
- Rationale must cite ML-specific signal (last ml_coding mock weak topic, ML radar axis with progress<30, named ML resource user has been engaging with).
- For action_kind=review_resource — prefer Lilian Weng / Karpathy / Chip Huyen / HF course / Papers with Code over generic CS textbooks.
- For action_kind=start_mock — ML stage_kinds (ml_coding / ml_system_design / ml_theory), не algorithms/coding/sysdesign.`

// mlMockGradeOverlay — system overlay для mock_grade. Hot-path mirror of
// mock_grade_ml prompt (migration 00116). Not yet wired (judge.go already
// has pass2MLCodeReviewSystemPrompt для StageMLCoding — он самостоятелен).
// Reserved для downstream HR/behavioral grading где same model нужна с ML lens.
const mlMockGradeOverlay = `ML-INTERVIEWER OVERLAY (user mock-targets ML company):
- Grade on 5-axis ML radar: theoretical_depth / practical_implementation / ml_system_design / data_intuition / production_awareness.
- Cite ML-specific weak signals: missing vectorisation, data leakage, wrong loss formula, missing seed control, hand-rolled vs library idioms.
- next_drill must be ML-flavoured (derive softmax cross-entropy gradient / replace python loop on line N with numpy.dot / add KFold cross-validation with stratify=y / read Chip Huyen ch6).`

// PickCoachPromptKey resolves the coach_prompts.slug to use for a given
// (action, ml_profile) pair. Caller passes the «default» slug; if user is
// on ML track and an ML variant exists, the ML slug is returned.
//
// Slug catalogue (см migrations 00097 + 00116):
//
//	daily_brief_baseline     → daily_brief_ml       (when IsML)
//	mock_grade_baseline      → mock_grade_ml        (when IsML)
//	insight_baseline         → (no ML variant yet)
//	reflection_grade_baseline → (no ML variant yet)
//	cue_summary_baseline     → (no ML variant yet)
//	milestones_gen_baseline  → (no ML variant yet)
//
// Returns the default slug unchanged when no ML variant exists or
// profile.IsML is false. Pure-function — fits in unit tests without DI.
func PickCoachPromptKey(defaultSlug string, profile domain.MLProfile) string {
	if !profile.IsML {
		return defaultSlug
	}
	switch defaultSlug {
	case "daily_brief_baseline":
		return "daily_brief_ml"
	case "mock_grade_baseline":
		return "mock_grade_ml"
	}
	return defaultSlug
}

// MLBriefOverlay returns the daily-brief overlay system message body, or
// empty string when profile.IsML is false. Exposed для use in synth layer
// (LLMChainBriefSynthesiser injects it as second system message).
func MLBriefOverlay(profile domain.MLProfile) string {
	if !profile.IsML {
		return ""
	}
	return mlBriefOverlay
}

// MLNextActionOverlay returns the next-action overlay system message body.
// Same fail-soft contract as MLBriefOverlay.
func MLNextActionOverlay(profile domain.MLProfile) string {
	if !profile.IsML {
		return ""
	}
	return mlNextActionOverlay
}

// MLMockGradeOverlay returns the mock-grade overlay. Currently unused
// (judge.go uses pass2MLCodeReviewSystemPrompt directly для StageMLCoding);
// kept here for future HR/behavioral-stage ML-aware grading at ML companies.
func MLMockGradeOverlay(profile domain.MLProfile) string {
	if !profile.IsML {
		return ""
	}
	return mlMockGradeOverlay
}
