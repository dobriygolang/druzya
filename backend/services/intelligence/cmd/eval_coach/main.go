// Phase 5 — eval_coach CLI.
//
// Static guardrail that loads a JSON dataset of (BriefPromptInput, raw
// LLM response) pairs and runs them through the same parser/sanitizer
// stack production uses. Reports:
//
//	generic_rate_pct   — share of recommendations classified as generic.
//	link_validity_pct  — share of inline-links surviving sanitizer.
//	citation_rate_pct  — share of rationales containing a numeric token.
//	severity_buckets   — counts per severity grade.
//
// Не делает LLM call'ов — все sample'ы offline. CI-friendly.
//
// Usage:
//
//	go run ./cmd/eval_coach -dataset cmd/eval_coach/dataset.json
//	go run ./cmd/eval_coach -dataset cmd/eval_coach/dataset.json -json
//
// Exit code:
//
//	0  — все samples parsed_ok.
//	1  — хотя бы один parse fail (регрессия в parser/anti-fluff filter).
//	2  — I/O / dataset load error.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"druz9/intelligence/infra"
)

func main() {
	dataset := flag.String("dataset", "cmd/eval_coach/dataset.json", "path to JSON dataset")
	asJSON := flag.Bool("json", false, "emit machine-readable JSON report")
	flag.Parse()

	raw, err := os.ReadFile(*dataset)
	if err != nil {
		fmt.Fprintf(os.Stderr, "eval_coach: read dataset: %v\n", err)
		os.Exit(2)
	}
	samples, err := infra.LoadEvalDataset(raw)
	if err != nil {
		fmt.Fprintf(os.Stderr, "eval_coach: parse dataset: %v\n", err)
		os.Exit(2)
	}
	rep := infra.EvalDataset(samples)

	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(rep)
	} else {
		fmt.Print(infra.EvalReportText(rep))
	}
	if rep.ParsedOK < rep.Total {
		os.Exit(1)
	}
}
