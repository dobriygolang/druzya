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

func IsMLEngSection(s enums.Section) bool { return s == enums.SectionMLEng }

func BuildMLEngSystemPrompt(
	s Session,
	user UserContext,
	company CompanyContext,
	elapsed time.Duration,
) string {
	var b strings.Builder
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
	b.WriteString("Free-form round. Drive 4-6 scenarios; demand whiteboard-specificity (loss functions, metric names, parameter counts, infra tradeoffs).\n")

	b.WriteString("\n# OBJECTIVE\n")
	b.WriteString("Track five dimensions internally; do NOT score during the round:\n")
	b.WriteString("  • theoretical_depth — math behind models, why this loss / regulariser / activation. Distinguish memorised vs understood.\n")
	b.WriteString("  • practical_implementation — code-level: vectorisation, gradient flow, batch design, dataloader bottlenecks.\n")
	b.WriteString("  • ml_system_design — feature store, training/serving pipeline, retraining cadence, A/B isolation.\n")
	b.WriteString("  • data_intuition — distribution shift, label noise, leakage detection, sampling biases.\n")
	b.WriteString("  • production_awareness — latency budget, fallback paths, model registry, observability metrics.\n")

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
