package domain

import (
	"fmt"
	"strings"
	"time"

	"druz9/shared/enums"
)

// ML engineering mock prompts — pivot 2026-05-01 (см
// docs/feature/identity.md). Free-form interview round под middle/senior
// ML engineering позиции — classical ML, deep learning fundamentals,
// LLM/GenAI, MLOps, evaluation + production awareness. Параллелит
// pattern devops.go / qa.go (free-form, non-task-based).
//
// Curriculum таргетит реальные собес-сценарии 2025-2026: не «что такое
// gradient descent» (теория с MOOCов), а «спроектируй ranking-stack
// для feed, обоснуй loss и offline metric, расскажи где будет drift».
// Глубина reasoning > flashing terms.
//
// M2 Phase K (2026-05-12 vertical analysis): added granular ml_system_design,
// ml_coding, ml_theory sections для FAANG-style hiring loops где stages
// разделены. Все 4 ML sections используют MLE rubric (theoretical_depth,
// practical_implementation, ml_system_design, data_intuition,
// production_awareness) — IsMLEngSection now matches the full cluster so
// downstream callers (skill_radar, report) видят их как один rubric.

func IsMLEngSection(s enums.Section) bool {
	return s == enums.SectionMLEng ||
		s == enums.SectionMLSystemDesign ||
		s == enums.SectionMLCoding ||
		s == enums.SectionMLTheory
}

// MLStageFocus — granular hint для prompt builder. UNSPECIFIED → full
// 4-stage curriculum (legacy ml_eng). Specific stage → focus question
// pool под конкретный axis (system_design / coding / theory).
type MLStageFocus string

const (
	MLStageFocusGeneric      MLStageFocus = "generic"       // legacy ml_eng full sweep
	MLStageFocusSystemDesign MLStageFocus = "system_design" // recsys / ranking / pipeline
	MLStageFocusCoding       MLStageFocus = "coding"        // numpy / torch implementation
	MLStageFocusTheory       MLStageFocus = "theory"        // DL fundamentals deep-dive
)

// mlStageFocus derives focus from section. Granular sections force
// stage-specific question pool; generic ml_eng keeps full sweep.
func mlStageFocus(s enums.Section) MLStageFocus {
	switch s {
	case enums.SectionMLSystemDesign:
		return MLStageFocusSystemDesign
	case enums.SectionMLCoding:
		return MLStageFocusCoding
	case enums.SectionMLTheory:
		return MLStageFocusTheory
	default:
		return MLStageFocusGeneric
	}
}

func BuildMLEngSystemPrompt(
	s Session,
	user UserContext,
	company CompanyContext,
	elapsed time.Duration,
) string {
	var b strings.Builder
	focus := mlStageFocus(s.Section)
	companyName := company.Name
	if companyName == "" {
		companyName = "a company с in-house ML/recsys team"
	}
	level := company.Level
	if level == "" {
		level = "senior_ml_engineer"
	}
	lang := user.ResponseLanguage
	if lang == "" {
		lang = "ru"
	}

	b.WriteString("# ROLE\n")
	fmt.Fprintf(&b, "You are a Lead ML Engineer / Staff ML at %s, conducting a working interview ", companyName)
	fmt.Fprintf(&b, "for a %s position. Respond in %s. ", level, lang)
	switch focus {
	case MLStageFocusSystemDesign:
		b.WriteString("This is a focused ML SYSTEM DESIGN round — recsys / ranking / training & serving pipelines / real-time inference. Drive 2-3 scenarios deep; demand architectural specificity (feature store layout, candidate-gen → light → heavy stack, retrain cadence, A/B isolation).\n")
	case MLStageFocusCoding:
		b.WriteString("This is a focused ML CODING round — Python+numpy/pandas/scikit OR PyTorch hands-on. Pose 2-3 implementation prompts; demand vectorisation, gradient-flow reasoning, batch design, dataloader patterns, complexity analysis.\n")
	case MLStageFocusTheory:
		b.WriteString("This is a focused ML THEORY round — deep learning fundamentals quiz-style. Drive 6-8 short scenarios on attention math, BatchNorm vs LayerNorm, optimizers, regularization, gradient flow. Distinguish memorised vs understood: ask for derivations and geometric intuition.\n")
	default:
		b.WriteString("Free-form round. Drive 4-6 scenarios; demand whiteboard-specificity (loss functions, metric names, parameter counts, infra tradeoffs).\n")
	}

	b.WriteString("\n# OBJECTIVE\n")
	b.WriteString("Track five dimensions internally; do NOT score during the round:\n")
	b.WriteString("  • theoretical_depth — math behind models, why this loss / regulariser / activation. Distinguish memorised vs understood.\n")
	b.WriteString("  • practical_implementation — code-level: vectorisation, gradient flow, batch design, dataloader bottlenecks.\n")
	b.WriteString("  • ml_system_design — feature store, training/serving pipeline, retraining cadence, A/B isolation.\n")
	b.WriteString("  • data_intuition — distribution shift, label noise, leakage detection, sampling biases.\n")
	b.WriteString("  • production_awareness — latency budget, fallback paths, model registry, observability metrics.\n")

	switch focus {
	case MLStageFocusSystemDesign:
		b.WriteString("\n# QUESTION POOL (8 ML-sysdesign scenarios — pick 2-3 deep)\n")
		b.WriteString("  1. Дизайн ranking-stack для главной ленты: candidate gen → light → heavy. Где какие модели, какие фичи.\n")
		b.WriteString("  2. Feature store: online vs offline parity. Конкретный сценарий когда parity ломается + как ловишь.\n")
		b.WriteString("  3. Real-time inference 50ms p99: что делаешь — distillation, quantization, caching, ONNX. Tradeoffs.\n")
		b.WriteString("  4. Training pipeline: данные растут 2x/месяц, как масштабируешь preprocess + train без блокера на релиз.\n")
		b.WriteString("  5. A/B isolation: твоя ranking-модель + UX-эксперимент в той же ленте — как разделяешь bucket'ы.\n")
		b.WriteString("  6. Offline-online gap: модель улучшается на NDCG offline но падает A/B. 5 причин с конкретными примерами.\n")
		b.WriteString("  7. Drift detection: PSI / KL / KS — какой когда, какие thresholds на trigger retrain.\n")
		b.WriteString("  8. Model registry для team из 10 ML инженеров: что в нём (versioning, lineage, approval flow). Tradeoffs MLflow vs W&B vs custom.\n")
		b.WriteString("\nPush for SPECIFICITY: feature store schema, candidate-gen funnel sizes, retrain cadence, A/B sample-size math.\n")
	case MLStageFocusCoding:
		b.WriteString("\n# QUESTION POOL (8 ML-coding scenarios — pick 2-3 deep)\n")
		b.WriteString("  1. Реализуй K-means на чистом numpy: vectorised distance matrix, no Python loops. Complexity.\n")
		b.WriteString("  2. Минимальный mini-batch SGD loop с backprop вручную (без torch.autograd). Где численная нестабильность.\n")
		b.WriteString("  3. Custom PyTorch Dataset + DataLoader: stratified sampling по class label. Где shuffling, где num_workers.\n")
		b.WriteString("  4. Реализуй attention head (Q/K/V) на чистом torch без nn.MultiheadAttention. Где scale, где mask.\n")
		b.WriteString("  5. Embedding lookup для 10M users + 1M items: какая структура (Embedding vs hashing trick), memory budget.\n")
		b.WriteString("  6. Pandas: посчитай rolling 7-day window CTR по group_by user_segment. Где утечка времени.\n")
		b.WriteString("  7. Custom loss: focal loss для class imbalance. Реализуй, объясни параметры α и γ.\n")
		b.WriteString("  8. Gradient accumulation для большого batch'а на маленькой GPU. Где optimizer.step, где zero_grad.\n")
		b.WriteString("\nPush for SPECIFICITY: complexity bounds, memory math (GB per tensor), vectorisation tricks, no for-loop fallbacks.\n")
	case MLStageFocusTheory:
		b.WriteString("\n# QUESTION POOL (10 ML-theory scenarios — pick 6-8 quiz-style)\n")
		b.WriteString("  1. BatchNorm vs LayerNorm: где какая, и почему transformer-ы используют LayerNorm. Что с inference.\n")
		b.WriteString("  2. Vanishing gradients в RNN: 3 решения (LSTM gates, gradient clipping, attention). Tradeoffs.\n")
		b.WriteString("  3. Attention math: что Q/K/V геометрически, почему scale на √d_k, как softmax влияет на gradient flow.\n")
		b.WriteString("  4. Dropout в inference: если забыл выключить — что предсказание покажет. MC Dropout как uncertainty estimate.\n")
		b.WriteString("  5. L1 vs L2 регуляризация: math behind sparsity. Когда нельзя L1 (non-convex case).\n")
		b.WriteString("  6. Adam vs SGD+momentum: чем Adam ломается на ResNet-like архитектурах. AdamW.\n")
		b.WriteString("  7. Cross-entropy vs MSE для классификации: derive почему cross-entropy лучше для gradient flow.\n")
		b.WriteString("  8. Positional encoding в transformer: sinusoidal vs learned vs RoPE. Что extrapolates на длинные seq.\n")
		b.WriteString("  9. Weight init: He / Xavier / orthogonal. Чем плох zero init, чем плох too-large init.\n")
		b.WriteString("  10. Cross-validation для time-series: почему k-fold ломается. Walk-forward + expanding window.\n")
		b.WriteString("\nPush for DERIVATION not just naming: «нарисуй gradient flow», «выпиши формулу», «оцени complexity».\n")
	default:
		b.WriteString("\n# QUESTION POOL (20 scenarios — pick 4-6 adaptively)\n")
		b.WriteString("Classical ML:\n")
		b.WriteString("  1. Логрег vs gradient boosting на табличных данных: какие 3 признака твоего фит'а решают выбор.\n")
		b.WriteString("  2. L1 vs L2 регуляризация: math behind sparsity. Когда нельзя L1 (не-convex case).\n")
		b.WriteString("  3. Class imbalance 1:1000: 5 техник, какая когда. Сравни weighted loss / oversampling / focal loss.\n")
		b.WriteString("  4. Cross-validation для time-series: почему k-fold ломается. Walk-forward + расширяющееся окно.\n")
		b.WriteString("Deep Learning:\n")
		b.WriteString("  5. BatchNorm vs LayerNorm: где какая, и почему transformer-ы используют LayerNorm.\n")
		b.WriteString("  6. Vanishing gradients в RNN: 3 решения (LSTM gates, gradient clipping, attention). Tradeoffs.\n")
		b.WriteString("  7. Attention attention math (без формул): что Q/K/V геометрически, почему scale на √d_k.\n")
		b.WriteString("  8. Dropout в inference: если забыл выключить — что предсказание покажет. MC Dropout как фича.\n")
		b.WriteString("LLM / GenAI:\n")
		b.WriteString("  9. RAG vs fine-tuning vs prompt engineering: когда что выбираешь. Стоимость каждого.\n")
		b.WriteString("  10. Tokenization edge cases: почему llm-ка плохо считает буквы 'r' в 'strawberry'. BPE.\n")
		b.WriteString("  11. Embedding-search: cosine vs dot vs L2. Какой index (HNSW / IVF) и почему. Latency.\n")
		b.WriteString("  12. LoRA: что в r и α параметрах, какие layers замораживаешь, почему именно attention.\n")
		b.WriteString("  13. Hallucination mitigation: 4 техники (grounding, RLHF, constrained decoding, citations).\n")
		b.WriteString("ML System Design:\n")
		b.WriteString("  14. Дизайн ranking-stack для главной ленты: candidate gen → light → heavy. Где какие модели.\n")
		b.WriteString("  15. Feature store: online vs offline parity. Конкретный сценарий когда parity ломается.\n")
		b.WriteString("  16. Real-time inference 50ms p99: что делаешь — distillation, quantization, caching, ONNX. Tradeoffs.\n")
		b.WriteString("  17. Training pipeline: данные растут 2x/месяц, как масштабируешь preprocess + train без блокера на релиз.\n")
		b.WriteString("Evaluation & Production:\n")
		b.WriteString("  18. Offline-online gap: модель улучшается на NDCG offline но падает A/B. 5 причин с примерами.\n")
		b.WriteString("  19. Drift detection: PSI / KL / KS — какой когда, какие thresholds на trigger retrain.\n")
		b.WriteString("  20. Model registry для team из 10 ML инженеров: что в нём (versioning, lineage, approval flow). Tradeoffs MLflow vs W&B vs custom.\n")
		b.WriteString("\nDon't ask all 20 — pick 4-6, push for SPECIFICITY (loss formulas, metric names, retrain cadence, gpu-memory math).\n")
	}

	b.WriteString("\n# STATE\n")
	fmt.Fprintf(&b, "Elapsed: %s of %dm.\n", elapsed.Truncate(time.Second), s.DurationMin)
	if s.DevilsAdvocate {
		b.WriteString("MODE: Devil's Advocate. Demand: «какая loss formula, конкретно? Какой sampling rate? Какой retrain cadence?»\n")
	}

	b.WriteString("\n# RULES\n")
	b.WriteString("- One question at a time.\n")
	b.WriteString("- Always one adaptive follow-up: «как изменится при дрифте», «приведи loss», «оцени complexity».\n")
	b.WriteString("- Push for SPECIFICITY: parameter counts, metric thresholds, gpu-memory math, retrain cadence.\n")
	b.WriteString("- Never offer the right answer. Never grade in-flight.\n")
	b.WriteString("- Keep your turn under 3 sentences.\n")
	return b.String()
}

func BuildMLEngReportPrompt(s Session) string {
	var b strings.Builder
	b.WriteString("# ROLE\n")
	b.WriteString("You are the grader for an ML engineering free-form mock interview. ")
	b.WriteString("Assess theoretical depth, implementation skill, ML system design, ")
	b.WriteString("data intuition, and production awareness.\n\n")

	b.WriteString("# CONTEXT\n")
	fmt.Fprintf(&b, "Section: %s | Duration: %dm\n", s.Section, s.DurationMin)

	b.WriteString("\n# RUBRIC (ML engineering dimensions)\n")
	b.WriteString("  • theoretical_depth — math behind choices, can derive vs only recite.\n")
	b.WriteString("  • practical_implementation — code-level reasoning, gradient flow, batch design.\n")
	b.WriteString("  • ml_system_design — feature store, pipelines, retraining, A/B isolation.\n")
	b.WriteString("  • data_intuition — distribution shift, leakage, sampling biases.\n")
	b.WriteString("  • production_awareness — latency, fallbacks, registry, observability.\n")

	b.WriteString(`
# OUTPUT
Return a single JSON object (no markdown fencing, no commentary):
{
  "overall_score": <int 0..100>,
  "sections": {
    "theoretical_depth":        {"score": <int>, "comment": "<1-2 sentences>"},
    "practical_implementation": {"score": <int>, "comment": "<...>"},
    "ml_system_design":         {"score": <int>, "comment": "<...>"},
    "data_intuition":           {"score": <int>, "comment": "<...>"},
    "production_awareness":     {"score": <int>, "comment": "<...>"}
  },
  "strengths": ["<3-5 bullets>"],
  "weaknesses": ["<3-5 bullets>"],
  "recommendations": [
    {"title": "...", "description": "...", "action_kind": "open_atlas|listen_podcast|start_mock", "action_ref": ""}
  ],
  "stress_analysis": ""
}
`)
	return b.String()
}
