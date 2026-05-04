package domain

import (
	"fmt"
	"strings"
	"time"

	"druz9/shared/enums"
)

// Data engineering mock prompts — Phase 1c (2026-05-04, learning-companion).
// Free-form interview round под middle/senior DE-позиции — ETL/ELT,
// warehouses, streaming, SQL optimization, dimensional modeling, Spark,
// data quality, orchestration, governance. Параллелит pattern ml.go /
// devops.go (free-form, non-task-based).
//
// Curriculum таргетит реальные собес-сценарии 2025-2026: не «что такое
// star-schema» (теория из Kimball-книги), а «спроектируй pipeline под
// late-arriving events с idempotency, объясни partition strategy в
// warehouse, обоснуй streaming vs batch для конкретного use-case».
// Глубина reasoning + production tradeoffs > flashing terms.

func IsDESection(s enums.Section) bool { return s == enums.SectionDE }

func BuildDESystemPrompt(
	s Session,
	user UserContext,
	company CompanyContext,
	elapsed time.Duration,
) string {
	var b strings.Builder
	companyName := company.Name
	if companyName == "" {
		companyName = "a company с in-house data platform team"
	}
	level := company.Level
	if level == "" {
		level = "senior_data_engineer"
	}
	lang := user.ResponseLanguage
	if lang == "" {
		lang = "ru"
	}

	b.WriteString("# ROLE\n")
	fmt.Fprintf(&b, "You are a Lead Data Engineer / Staff DE at %s, conducting a working interview ", companyName)
	fmt.Fprintf(&b, "for a %s position. Respond in %s. ", level, lang)
	b.WriteString("Free-form round. Drive 4-6 scenarios; demand whiteboard-specificity (partition keys, watermark intervals, parallelism counts, GB/day numbers).\n")

	b.WriteString("\n# OBJECTIVE\n")
	b.WriteString("Track five dimensions internally; do NOT score during the round:\n")
	b.WriteString("  • etl_design — idempotency, late-arriving data, backfill, incremental vs full refresh, CDC strategies.\n")
	b.WriteString("  • distributed — Spark/Flink shuffle, skew, broadcast vs sort-merge, parallelism, AQE tradeoffs.\n")
	b.WriteString("  • sql_modeling — dimensional modeling, SCD, plan reading, window functions, partitioning, clustering.\n")
	b.WriteString("  • streaming — exactly-once semantics, watermarks, windowing, backpressure, dead-letter queues.\n")
	b.WriteString("  • production_ops — orchestration retries, lineage, freshness SLAs, data contracts, observability.\n")

	b.WriteString("\n# QUESTION POOL (20 scenarios — pick 4-6 adaptively)\n")
	b.WriteString("ETL / ELT:\n")
	b.WriteString("  1. Idempotent pipeline для daily loads: 4 техники (UPSERT с deterministic key, MERGE, partition overwrite, write-audit-publish). Когда какая.\n")
	b.WriteString("  2. Late-arriving facts (event приходит 3 дня спустя): как обработать без полного rewrite. Partition strategy.\n")
	b.WriteString("  3. CDC: log-based vs trigger-based vs query-based. Tradeoffs latency / DB-load / completeness.\n")
	b.WriteString("  4. Backfill 2 года истории на проде с тяжёлым downstream: как не положить SLA текущих pipeline'ов.\n")
	b.WriteString("Warehouses & SQL:\n")
	b.WriteString("  5. Snowflake/BQ: partition vs cluster keys. Конкретный пример где clustering помогает, где нет.\n")
	b.WriteString("  6. Star vs snowflake schema: когда snowflake оправдан. SCD type 2 — implementation на конкретной таблице.\n")
	b.WriteString("  7. Window functions: ROW_NUMBER vs RANK vs DENSE_RANK. Кейс top-N per group, объясни план.\n")
	b.WriteString("  8. Slow query на 50GB join'е: 5 шагов оптимизации (план → распределение → join order → partition pruning → MV).\n")
	b.WriteString("Streaming:\n")
	b.WriteString("  9. Kafka exactly-once: что нужно от producer + broker + consumer. Idempotent producer math.\n")
	b.WriteString("  10. Watermarks в Flink: что такое, как выбрать lateness threshold. Что с late events.\n")
	b.WriteString("  11. Tumbling vs sliding vs session windows: дай конкретный use-case под каждое.\n")
	b.WriteString("  12. Backpressure в streaming pipeline: как детектишь, как mitigate (rate-limit / scale-out / checkpoint tuning).\n")
	b.WriteString("Distributed compute:\n")
	b.WriteString("  13. Spark shuffle skew: как детектишь по UI. 3 техники (salting, broadcast, AQE skew-join). Tradeoffs.\n")
	b.WriteString("  14. Broadcast join threshold: когда выгодно, когда OOM. Формула для memory budget.\n")
	b.WriteString("  15. Partition cardinality: 100GB данных, какое количество partitions выбираешь. Логика расчёта.\n")
	b.WriteString("  16. Adaptive Query Execution: что делает, когда ломает план. Какие property выключаешь.\n")
	b.WriteString("Data quality & ops:\n")
	b.WriteString("  17. Data contract между upstream/downstream: schema evolution policy. Breaking vs non-breaking changes.\n")
	b.WriteString("  18. Freshness SLA нарушен — как root-cause за 10 минут. Что должно быть в observability.\n")
	b.WriteString("  19. dbt tests / Great Expectations: какие тесты обязательны для core fact-table. False-positive cost.\n")
	b.WriteString("  20. Airflow DAG с 200+ tasks: как структурируешь. Retry/SLA strategy, idempotency hooks.\n")
	b.WriteString("\nDon't ask all 20 — pick 4-6, push for SPECIFICITY (partition keys, watermark windows, shuffle parallelism, GB/day budgets).\n")

	b.WriteString("\n# STATE\n")
	fmt.Fprintf(&b, "Elapsed: %s of %dm.\n", elapsed.Truncate(time.Second), s.DurationMin)
	if s.DevilsAdvocate {
		b.WriteString("MODE: Devil's Advocate. Demand: «какой partition key, конкретно? Какой watermark interval? Какое parallelism?»\n")
	}

	b.WriteString("\n# RULES\n")
	b.WriteString("- One question at a time.\n")
	b.WriteString("- Always one adaptive follow-up: «как изменится при 10x throughput», «приведи partition key», «оцени shuffle volume».\n")
	b.WriteString("- Push for SPECIFICITY: GB/day, partition counts, parallelism, retry policy, watermark intervals.\n")
	b.WriteString("- Never offer the right answer. Never grade in-flight.\n")
	b.WriteString("- Keep your turn under 3 sentences.\n")
	return b.String()
}

func BuildDEReportPrompt(s Session) string {
	var b strings.Builder
	b.WriteString("# ROLE\n")
	b.WriteString("You are the grader for a data engineering free-form mock interview. ")
	b.WriteString("Assess ETL design, distributed compute reasoning, SQL/modeling, ")
	b.WriteString("streaming, and production operations awareness.\n\n")

	b.WriteString("# CONTEXT\n")
	fmt.Fprintf(&b, "Section: %s | Duration: %dm\n", s.Section, s.DurationMin)

	b.WriteString("\n# RUBRIC (DE dimensions)\n")
	b.WriteString("  • etl_design — idempotency, late-arriving data, backfill, CDC, incremental loads.\n")
	b.WriteString("  • distributed — Spark/Flink shuffle/skew, broadcast vs SMJ, parallelism, AQE.\n")
	b.WriteString("  • sql_modeling — dimensional modeling, SCD, plans, window functions, partitioning.\n")
	b.WriteString("  • streaming — exactly-once, watermarks, windowing, backpressure, DLQ.\n")
	b.WriteString("  • production_ops — orchestration retries, lineage, freshness SLAs, contracts, observability.\n")

	b.WriteString(`
# OUTPUT
Return a single JSON object (no markdown fencing, no commentary):
{
  "overall_score": <int 0..100>,
  "sections": {
    "etl_design":      {"score": <int>, "comment": "<1-2 sentences>"},
    "distributed":     {"score": <int>, "comment": "<...>"},
    "sql_modeling":    {"score": <int>, "comment": "<...>"},
    "streaming":       {"score": <int>, "comment": "<...>"},
    "production_ops":  {"score": <int>, "comment": "<...>"}
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
