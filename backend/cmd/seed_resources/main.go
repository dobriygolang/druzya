// seed_resources — CLI для bulk-курации external_resources на atlas_nodes
// и track_steps (Phase 1b learning-companion 2026-05-04).
//
// Two-pass flow (curation principle: druz9 = ranking-proxy, не курсовая):
//
//	1) `seed_resources prompt --node <id> [--kind theory|practice|reading] [--count 5]`
//	   читает строку из atlas_nodes и эмитит prompt-template на stdout.
//	   Sergey копирует в Groq Console / Cerebras / OpenRouter playground
//	   (любой free-tier из feedback_providers), забирает JSON-ответ.
//
//	2) `seed_resources apply --node <id> --response <file.json>`
//	   читает LLM-вывод (массив Resource), валидирует через
//	   curation/domain.ResourceList.Validate, эмитит SQL UPDATE на stdout.
//	   Sergey ревьюит → `psql < update.sql`.
//
// CLI намеренно не зовёт LLM сам — Sergey хочет каждую node пройти
// глазами перед apply (project_curation_model: «дроп тухлые / переставить
// порядок / переписать why»). Integrated-mode добавим позже если поток
// curation станет постоянным (300 entries Phase 1 — one-shot).
//
// Требует PG_DSN env (или --dsn flag) для prompt-команды (читает
// atlas_nodes), apply-команда вообще без БД — печатает SQL.
//
// Usage:
//
//	export PG_DSN='postgres://druz9:druz9@localhost:5432/druz9?sslmode=disable'
//	seed_resources prompt --node de_etl_pipelines --kind theory --count 5 > prompt.txt
//	# … Sergey copies prompt.txt into LLM, saves response as response.json …
//	seed_resources apply --node de_etl_pipelines --response response.json > update.sql
//	psql $PG_DSN < update.sql
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"druz9/curation/domain"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "prompt":
		cmdPrompt(os.Args[2:])
	case "apply":
		cmdApply(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: seed_resources <prompt|apply> [flags]")
	fmt.Fprintln(os.Stderr, "  prompt --node <id> [--kind theory|practice|reading] [--count N] [--dsn ...]")
	fmt.Fprintln(os.Stderr, "  apply  --node <id> --response <file.json> [--target atlas|step] [--step-id <track_step PK>]")
}

// ─────────────────────── prompt ─────────────────────────

type atlasNodeRow struct {
	ID          string
	Title       string
	Section     string
	Cluster     string
	Description string
	TrackKind   string
}

func cmdPrompt(argv []string) {
	fs := flag.NewFlagSet("prompt", flag.ExitOnError)
	nodeID := fs.String("node", "", "atlas_nodes.id (e.g. de_etl_pipelines)")
	kind := fs.String("kind", "theory", "theory | practice | reading")
	count := fs.Int("count", 5, "how many resources to ask for (3-7 sane range)")
	dsn := fs.String("dsn", os.Getenv("PG_DSN"), "Postgres DSN (overrides PG_DSN env)")
	_ = fs.Parse(argv)

	if *nodeID == "" {
		fmt.Fprintln(os.Stderr, "seed_resources prompt: --node is required")
		os.Exit(2)
	}
	if *dsn == "" {
		fmt.Fprintln(os.Stderr, "seed_resources prompt: PG_DSN env or --dsn required")
		os.Exit(2)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, *dsn)
	if err != nil {
		fmt.Fprintf(os.Stderr, "seed_resources prompt: connect: %v\n", err)
		os.Exit(2)
	}
	defer pool.Close()

	row := atlasNodeRow{}
	err = pool.QueryRow(ctx,
		`SELECT id, title, section, cluster, description, track_kind::text
		   FROM atlas_nodes WHERE id = $1`,
		*nodeID,
	).Scan(&row.ID, &row.Title, &row.Section, &row.Cluster, &row.Description, &row.TrackKind)
	if err != nil {
		fmt.Fprintf(os.Stderr, "seed_resources prompt: load node %q: %v\n", *nodeID, err)
		os.Exit(2)
	}

	fmt.Print(buildPrompt(row, *kind, *count))
}

func buildPrompt(n atlasNodeRow, kind string, count int) string {
	var b strings.Builder
	b.WriteString("# ROLE\n")
	b.WriteString("You are a senior IT-curator picking the BEST FREE external resources ")
	b.WriteString("for a senior engineer studying a specific topic. ")
	b.WriteString("druz9 — ranking-proxy: we link, we don't build.\n\n")

	b.WriteString("# TOPIC\n")
	fmt.Fprintf(&b, "Atlas node id: %s\nTitle: %s\nSection: %s | Cluster: %s | Track: %s\n",
		n.ID, n.Title, n.Section, n.Cluster, n.TrackKind)
	if n.Description != "" {
		fmt.Fprintf(&b, "Description: %s\n", n.Description)
	}
	fmt.Fprintf(&b, "\nKind requested: %s\n", kind)

	b.WriteString("\n# WHITELIST (prefer these authors / sources)\n")
	b.WriteString("- Theory: Strang LA · ods.ai mlcourse · deeplearning.ai · DDIA (Kleppmann) · ")
	b.WriteString("Kleinberg-Tardos · Sebastian Raschka blog · Lilian Weng · HuggingFace course\n")
	b.WriteString("- Practice: LeetCode (по тегам) · NeetCode · Kaggle · HackerRank SQL · DataLemur\n")
	b.WriteString("- Reading: arxiv papers · canonical blog-posts (engineering-blogs of FAANG/big tech) · ")
	b.WriteString("YouTube lectures from университетов или Yandex/ШАД\n")
	b.WriteString("AVOID: paid courses · low-quality blog aggregators · medium articles без автора · ")
	b.WriteString("LinkedIn posts · Telegram-каналы.\n")

	fmt.Fprintf(&b, "\n# TASK\nReturn %d best free resources в правильном порядке освоения "+
		"(easier → harder). Each resource MUST include `why` — одно предложение, ", count)
	b.WriteString("объясняющее unique relevance именно к этой topic'е (не «это хорошая книга»).\n")

	b.WriteString(`
# OUTPUT
Return ONLY a JSON array (no markdown fencing, no commentary). Each element:
[
  {
    "url":              "<absolute http(s) url>",
    "title":            "<short title>",
    "author":           "<author or org>",
    "kind":             "course | video | book | paper | article | tool | kata | podcast",
    "minutes":          <int, 0 if unknown>,
    "level":            "A | B | C | D",
    "priority":         "core | supplement | optional",
    "why":              "<1 sentence — unique relevance>",
    "topics_covered":   ["<atlas_node id>", ...],
    "prereqs":          ["<atlas_node id>", ...],
    "summary":          "<2-3 sentences — what this resource teaches and how>",
    "depth":            "intro | intuition | deep | reference",
    "format_notes":     "<optional UI hint: interactive | paywalled | video-no-transcript | code-only-no-prose | empty if standard>",
    "reflection_prompt": "<optional 1-line question we'll ask the user after they finish; empty for generic>"
  }
]

Levels:    A entry · B middle · C senior/staff · D research.
Priority:  core (must-have) · supplement (deepens) · optional (extra).
Depth:     intro · intuition · deep · reference (orthogonal to level — intuition can be senior-level).
topics_covered/prereqs use atlas_node IDs (e.g. "ml_classical", "de_etl_pipelines"). Pull from the topic above + obvious neighbours. Empty array if uncertain — DO NOT invent IDs.
First items = lower level / core. Order matters — sequence reflects intended consumption order.
`)
	return b.String()
}

// ─────────────────────── apply ─────────────────────────

func cmdApply(argv []string) {
	fs := flag.NewFlagSet("apply", flag.ExitOnError)
	nodeID := fs.String("node", "", "atlas_nodes.id (target=atlas)")
	respPath := fs.String("response", "", "path to LLM JSON response")
	target := fs.String("target", "atlas", "atlas | step")
	stepKey := fs.String("step-id", "", "track_step composite key 'track_uuid:step_index' (target=step)")
	_ = fs.Parse(argv)

	if *respPath == "" {
		fmt.Fprintln(os.Stderr, "seed_resources apply: --response is required")
		os.Exit(2)
	}
	raw, err := os.ReadFile(*respPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "seed_resources apply: read response: %v\n", err)
		os.Exit(2)
	}
	cleaned := stripCodeFences(raw)

	var list domain.ResourceList
	if err := json.Unmarshal(cleaned, &list); err != nil {
		fmt.Fprintf(os.Stderr, "seed_resources apply: parse JSON: %v\n", err)
		os.Exit(1)
	}
	if err := list.Validate(); err != nil {
		fmt.Fprintf(os.Stderr, "seed_resources apply: validate: %v\n", err)
		os.Exit(1)
	}
	body, err := list.Marshal()
	if err != nil {
		fmt.Fprintf(os.Stderr, "seed_resources apply: marshal: %v\n", err)
		os.Exit(1)
	}

	switch *target {
	case "atlas":
		if *nodeID == "" {
			fmt.Fprintln(os.Stderr, "seed_resources apply: --node required for target=atlas")
			os.Exit(2)
		}
		fmt.Printf("-- seed_resources apply · node=%s · %d resources\n", *nodeID, len(list))
		fmt.Printf("UPDATE atlas_nodes SET external_resources = %s\n WHERE id = %s;\n",
			sqlJSONB(body), sqlString(*nodeID))
	case "step":
		if *stepKey == "" {
			fmt.Fprintln(os.Stderr, "seed_resources apply: --step-id 'track_uuid:step_index' required for target=step")
			os.Exit(2)
		}
		parts := strings.SplitN(*stepKey, ":", 2)
		if len(parts) != 2 {
			fmt.Fprintln(os.Stderr, "seed_resources apply: --step-id must be 'track_uuid:step_index'")
			os.Exit(2)
		}
		fmt.Printf("-- seed_resources apply · step=%s · %d resources\n", *stepKey, len(list))
		fmt.Printf("UPDATE track_steps SET external_resources = %s\n WHERE track_id = %s AND step_index = %s;\n",
			sqlJSONB(body), sqlString(parts[0]), parts[1])
	default:
		fmt.Fprintf(os.Stderr, "seed_resources apply: unknown --target %q\n", *target)
		os.Exit(2)
	}
}

// stripCodeFences удаляет ```json … ``` если LLM не послушался "no markdown".
func stripCodeFences(raw []byte) []byte {
	s := strings.TrimSpace(string(raw))
	if !strings.HasPrefix(s, "```") {
		return []byte(s)
	}
	// drop opening ``` (with optional language)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[i+1:]
	}
	s = strings.TrimSuffix(strings.TrimSpace(s), "```")
	return []byte(strings.TrimSpace(s))
}

// sqlString — Postgres single-quoted literal с doubled quotes.
func sqlString(v string) string {
	return "'" + strings.ReplaceAll(v, "'", "''") + "'"
}

// sqlJSONB — '<json>'::jsonb с doubled single quotes.
func sqlJSONB(body []byte) string {
	return sqlString(string(body)) + "::jsonb"
}
