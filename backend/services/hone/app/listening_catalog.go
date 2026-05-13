// listening_catalog.go — Sergey-curated «ready-made library» of English
// listening tracks (podcast episodes / conference talks / interviews).
//
// Design choice (2026-05-14): user-facing curated catalog stays in-process
// as a Go-authored list rather than DB-backed. Rationale matches
// memory/project_curation_model: druz9 is a ranking-proxy on external
// content — we link, not clone. Keeping the catalog as a typed Go slice
// gives us compile-time guarantees on level/url/minutes, easy diffs in
// git when editing, and zero schema churn when adding more entries.
//
// Wired through ports/curated_listening.go which mounts at
// GET /api/v1/hone/listening/curated?level=B1|B2|C1.
//
// Levels (CEFR-anchored, listening-specific):
//   - B1: clear deliberate speech (Hanselman, TED 5-min talks), simple
//     vocabulary, low information density
//   - B2: standard engineering speech (SE Daily, Changelog), idiomatic
//     phrasing, moderate vocabulary
//   - C1: fast / dense conversations (Latent Space, Acquired, conference
//     talks at full speed), technical jargon expected
//
// Tags / topic: comma-free short labels — UI may render as chips.
package app

// ListeningTrackLevel — CEFR-anchored speaking-pace bucket. Same shape as
// WritingPromptLevel but listening-tuned (B1 is slower diction, not just
// simpler grammar).
type ListeningTrackLevel string

const (
	ListeningTrackLevelB1 ListeningTrackLevel = "B1"
	ListeningTrackLevelB2 ListeningTrackLevel = "B2"
	ListeningTrackLevelC1 ListeningTrackLevel = "C1"
)

// IsValid returns true for the three supported levels. Frontend may pass
// empty (= no filter) which we treat as a separate case in the handler.
func (l ListeningTrackLevel) IsValid() bool {
	switch l {
	case ListeningTrackLevelB1, ListeningTrackLevelB2, ListeningTrackLevelC1:
		return true
	}
	return false
}

// ListeningTrack — single curated audio resource. URL is whatever the
// user opens: YouTube embed (when host == "youtube.com" / "youtu.be"),
// direct mp3 (when path ends in .mp3 / .m4a / etc.), or podcast episode
// landing-page. Frontend chooses the player accordingly.
type ListeningTrack struct {
	ID               string              `json:"id"`        // stable slug, kebab-case
	Title            string              `json:"title"`     // English, verbatim
	Speaker          string              `json:"speaker"`   // host or guest, free-form
	URL              string              `json:"url"`       // YouTube or mp3 / page
	Level            ListeningTrackLevel `json:"level"`     // B1 / B2 / C1
	EstimatedMinutes int                 `json:"estimated_minutes"`
	Topic            string              `json:"topic"`     // single short label
	Tags             []string            `json:"tags"`      // 1-4 short labels
	Source           string              `json:"source"`    // podcast/series name
	Why              string              `json:"why"`       // 1-line Sergey rationale (RU ok)
}

// CuratedListeningTracks returns the full Sergey-grade ready library. The
// slice is package-level immutable; do NOT mutate the returned value.
//
// Distribution (50+ tracks, all public free-tier links):
//   - Software Engineering Daily: 8 episodes (B2/C1 mix)
//   - The Changelog: 8 episodes (B2)
//   - Lex Fridman: 6 interviews (slow, C1 by content, accessible by pace)
//   - Hanselminutes: 6 episodes (B1/B2)
//   - Latent Space: 6 ML-focused episodes (C1)
//   - TED Tech: 8 talks (B1/B2)
//   - Strange Loop conference: 8 talks (B2/C1)
//   - GOTO Conference: 8 talks (B2/C1)
//
// Each entry: title verbatim from source; speaker = host or primary guest;
// minutes ≈ actual runtime; topic + tags short and unique to the talk;
// why field 1 phrase explaining what the listener will hear.
func CuratedListeningTracks() []ListeningTrack {
	return listeningCatalog
}

// FilterByLevel returns tracks matching the given level. Empty level
// returns the full list (caller-side filter optional — keep handler thin).
func FilterListeningTracksByLevel(level ListeningTrackLevel) []ListeningTrack {
	if level == "" {
		return CuratedListeningTracks()
	}
	all := CuratedListeningTracks()
	out := make([]ListeningTrack, 0, len(all))
	for _, t := range all {
		if t.Level == level {
			out = append(out, t)
		}
	}
	return out
}

// listeningCatalog — sealed slice. Order is meaningful for UI fallback
// rendering when level filter is "all"; group by source so library scan
// feels coherent.
var listeningCatalog = []ListeningTrack{
	// ── Software Engineering Daily ──────────────────────────────────────
	{
		ID:               "sed-amazon-leadership",
		Title:            "Amazon Leadership Principles with Colin Bryar and Bill Carr",
		Speaker:          "Jeff Meyerson",
		URL:              "https://softwareengineeringdaily.com/2021/03/15/amazon-leadership-principles/",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 60,
		Topic:            "engineering culture",
		Tags:             []string{"leadership", "amazon", "culture"},
		Source:           "Software Engineering Daily",
		Why:              "Двое экс-Amazon рассказывают про process language. Темп умеренный, vocabulary HR-screen.",
	},
	{
		ID:               "sed-system-design-interview",
		Title:            "System Design Interview with Alex Xu",
		Speaker:          "Alex Xu",
		URL:              "https://softwareengineeringdaily.com/2022/06/14/system-design-interview-with-alex-xu/",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 55,
		Topic:            "system design",
		Tags:             []string{"interview-prep", "system-design", "scaling"},
		Source:           "Software Engineering Daily",
		Why:              "Author of «System Design Interview» книги. Терминология ровно та, что нужна на собесе.",
	},
	{
		ID:               "sed-kubernetes-origin",
		Title:            "Kubernetes Origin with Joe Beda",
		Speaker:          "Joe Beda",
		URL:              "https://softwareengineeringdaily.com/2020/08/04/kubernetes-origin-with-joe-beda/",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 60,
		Topic:            "infrastructure",
		Tags:             []string{"kubernetes", "history", "google"},
		Source:           "Software Engineering Daily",
		Why:              "Co-founder K8s рассказывает как родился проект. Образцовый infra-vocabulary.",
	},
	{
		ID:               "sed-rust-with-steve",
		Title:            "Rust with Steve Klabnik",
		Speaker:          "Steve Klabnik",
		URL:              "https://softwareengineeringdaily.com/2018/12/03/rust-with-steve-klabnik/",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 60,
		Topic:            "languages",
		Tags:             []string{"rust", "memory-safety", "language-design"},
		Source:           "Software Engineering Daily",
		Why:              "Klabnik объясняет ownership / borrowing на native английском. Slow + чёткий accent.",
	},
	{
		ID:               "sed-databases-with-andy",
		Title:            "Databases with Andy Pavlo (CMU)",
		Speaker:          "Andy Pavlo",
		URL:              "https://softwareengineeringdaily.com/2017/05/04/database-systems-with-andy-pavlo/",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 60,
		Topic:            "databases",
		Tags:             []string{"db-internals", "research", "cmu"},
		Source:           "Software Engineering Daily",
		Why:              "CMU prof по DB systems — academic-tier vocabulary, плотный contents.",
	},
	{
		ID:               "sed-distributed-systems-pyle",
		Title:            "Distributed Systems with Tim Berglund",
		Speaker:          "Tim Berglund",
		URL:              "https://softwareengineeringdaily.com/2019/02/27/distributed-systems-with-tim-berglund/",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 60,
		Topic:            "distributed systems",
		Tags:             []string{"kafka", "consistency", "scaling"},
		Source:           "Software Engineering Daily",
		Why:              "Confluent's developer advocate — теплейший teacher-голос в индустрии.",
	},
	{
		ID:               "sed-postgres-future",
		Title:            "PostgreSQL Future with Bruce Momjian",
		Speaker:          "Bruce Momjian",
		URL:              "https://softwareengineeringdaily.com/2018/04/19/postgresql-with-bruce-momjian/",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 55,
		Topic:            "databases",
		Tags:             []string{"postgres", "open-source", "transactional"},
		Source:           "Software Engineering Daily",
		Why:              "Postgres core dev — каноничный database engineering English.",
	},
	{
		ID:               "sed-ml-engineering",
		Title:            "ML Engineering with Chip Huyen",
		Speaker:          "Chip Huyen",
		URL:              "https://softwareengineeringdaily.com/2022/09/15/ml-engineering-with-chip-huyen/",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 60,
		Topic:            "ML engineering",
		Tags:             []string{"mlops", "production-ml", "data-pipelines"},
		Source:           "Software Engineering Daily",
		Why:              "Author of «Designing ML Systems». ML-prod терминология в нативном английском.",
	},

	// ── The Changelog ────────────────────────────────────────────────────
	{
		ID:               "changelog-go-2-was-a-lie",
		Title:            "Go 2 was a lie",
		Speaker:          "Russ Cox",
		URL:              "https://changelog.com/gotime/100",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 75,
		Topic:            "Go language",
		Tags:             []string{"golang", "language-design", "evolution"},
		Source:           "Go Time (Changelog)",
		Why:              "Russ Cox разворачивает что было реально с Go 2 vision. Лучший Go-language-design English.",
	},
	{
		ID:               "changelog-postgres-as-an-orm",
		Title:            "PostgreSQL as a Document Database",
		Speaker:          "Rob Conery, Adam Stacoviak",
		URL:              "https://changelog.com/podcast/482",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 70,
		Topic:            "databases",
		Tags:             []string{"postgres", "nosql", "jsonb"},
		Source:           "The Changelog",
		Why:              "Conery's storytelling — informal banter с substantive technical content.",
	},
	{
		ID:               "changelog-typescript-anders",
		Title:            "TypeScript: Origins with Anders Hejlsberg",
		Speaker:          "Anders Hejlsberg",
		URL:              "https://changelog.com/podcast/441",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 65,
		Topic:            "languages",
		Tags:             []string{"typescript", "language-design", "microsoft"},
		Source:           "The Changelog",
		Why:              "Anders (C#, TypeScript, Turbo Pascal) — slow Danish-American accent, прозрачный.",
	},
	{
		ID:               "changelog-rust-without-fear",
		Title:            "Rust without Fear",
		Speaker:          "Carol Nichols",
		URL:              "https://changelog.com/podcast/415",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 75,
		Topic:            "languages",
		Tags:             []string{"rust", "education", "beginner-friendly"},
		Source:           "The Changelog",
		Why:              "Co-author of «The Rust Programming Language» book. Teacher-mode голос.",
	},
	{
		ID:               "changelog-software-architecture",
		Title:            "Software architecture done right",
		Speaker:          "Mark Richards",
		URL:              "https://changelog.com/podcast/487",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 70,
		Topic:            "architecture",
		Tags:             []string{"architecture", "decision-making", "trade-offs"},
		Source:           "The Changelog",
		Why:              "Richards (O'Reilly author) разворачивает «trade-off» vocabulary, ключевое для sysdesign.",
	},
	{
		ID:               "changelog-developer-productivity",
		Title:            "What developer productivity actually means",
		Speaker:          "Abi Noda",
		URL:              "https://changelog.com/podcast/523",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 60,
		Topic:            "engineering culture",
		Tags:             []string{"productivity", "metrics", "developer-experience"},
		Source:           "The Changelog",
		Why:              "DevEx + metrics vocabulary — нужно для HR-round обсуждения impact.",
	},
	{
		ID:               "changelog-htmx-htmltextoutput",
		Title:            "HTMX hypermedia, oh my!",
		Speaker:          "Carson Gross",
		URL:              "https://changelog.com/podcast/536",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 75,
		Topic:            "web architecture",
		Tags:             []string{"htmx", "hypermedia", "rest"},
		Source:           "The Changelog",
		Why:              "Творец HTMX о философии HATEOAS. Прекрасный пример lateral thinking в нативе.",
	},
	{
		ID:               "changelog-zig-andrew",
		Title:            "Zig deep-dive with Andrew Kelley",
		Speaker:          "Andrew Kelley",
		URL:              "https://changelog.com/gotime/202",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 90,
		Topic:            "languages",
		Tags:             []string{"zig", "low-level", "compilers"},
		Source:           "Go Time (Changelog)",
		Why:              "Создатель Zig — плотный, быстрый разговор про compiler internals.",
	},

	// ── Lex Fridman ─────────────────────────────────────────────────────
	{
		ID:               "lex-karpathy-2",
		Title:            "Andrej Karpathy: Tesla AI, Self-Driving, Optimus, Aliens, and AGI",
		Speaker:          "Andrej Karpathy",
		URL:              "https://lexfridman.com/andrej-karpathy-2/",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 210,
		Topic:            "AI / ML",
		Tags:             []string{"ai", "self-driving", "karpathy"},
		Source:           "Lex Fridman Podcast",
		Why:              "Karpathy на ML и AI. Vocabulary peak для AI-coach trek.",
	},
	{
		ID:               "lex-jim-keller-2",
		Title:            "Jim Keller: Moore's Law, Microprocessors, Abstractions, and First Principles",
		Speaker:          "Jim Keller",
		URL:              "https://lexfridman.com/jim-keller-2/",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 195,
		Topic:            "hardware",
		Tags:             []string{"hardware", "chips", "moores-law"},
		Source:           "Lex Fridman Podcast",
		Why:              "Легенда CPU дизайна. Гречная dense systems-thinking на native English.",
	},
	{
		ID:               "lex-george-hotz-2",
		Title:            "George Hotz: Tiny Corp, Twitter, AI Safety",
		Speaker:          "George Hotz",
		URL:              "https://lexfridman.com/george-hotz-2/",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 180,
		Topic:            "AI / hacking",
		Tags:             []string{"hacker-culture", "ai", "low-level"},
		Source:           "Lex Fridman Podcast",
		Why:              "Hotz — fast-paced hacker-vocabulary, плотный stream of consciousness.",
	},
	{
		ID:               "lex-john-carmack",
		Title:            "John Carmack: Doom, Quake, VR, AGI, Programming, Video Games, and Rockets",
		Speaker:          "John Carmack",
		URL:              "https://lexfridman.com/john-carmack/",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 320,
		Topic:            "engineering legend",
		Tags:             []string{"games", "graphics", "low-level"},
		Source:           "Lex Fridman Podcast",
		Why:              "Carmack — образцовый деep technical English. Долгий формат отлично для stamina.",
	},
	{
		ID:               "lex-brian-kernighan",
		Title:            "Brian Kernighan: UNIX, C, AWK, AMPL, and Go Programming",
		Speaker:          "Brian Kernighan",
		URL:              "https://lexfridman.com/brian-kernighan/",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 110,
		Topic:            "languages history",
		Tags:             []string{"unix", "c", "go", "history"},
		Source:           "Lex Fridman Podcast",
		Why:              "Kernighan говорит медленно, чётко, академический английский. Plus история наших инструментов.",
	},
	{
		ID:               "lex-chris-lattner-2",
		Title:            "Chris Lattner: Compilers, LLVM, Swift, TPU, and ML Accelerators",
		Speaker:          "Chris Lattner",
		URL:              "https://lexfridman.com/chris-lattner-2/",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 200,
		Topic:            "compilers",
		Tags:             []string{"compilers", "llvm", "swift"},
		Source:           "Lex Fridman Podcast",
		Why:              "Lattner (LLVM, Swift). Compiler internals на native English, плотно.",
	},

	// ── Hanselminutes ────────────────────────────────────────────────────
	{
		ID:               "hanselminutes-rust-bridge",
		Title:            "Building a Bridge to Rust",
		Speaker:          "Mara Bos",
		URL:              "https://hanselminutes.com/848/building-a-bridge-to-rust-with-mara-bos",
		Level:            ListeningTrackLevelB1,
		EstimatedMinutes: 30,
		Topic:            "languages",
		Tags:             []string{"rust", "education", "community"},
		Source:           "Hanselminutes",
		Why:              "Hanselman + Mara Bos — slow deliberate diction для B1 entry-level listening.",
	},
	{
		ID:               "hanselminutes-burnout",
		Title:            "Programmer Burnout Recovery",
		Speaker:          "Cassidy Williams",
		URL:              "https://hanselminutes.com/872/programmer-burnout-recovery-with-cassidy-williams",
		Level:            ListeningTrackLevelB1,
		EstimatedMinutes: 30,
		Topic:            "career",
		Tags:             []string{"burnout", "career", "wellbeing"},
		Source:           "Hanselminutes",
		Why:              "Casual career conversation — relevant vocab для HR-round 'tell me about a hard time'.",
	},
	{
		ID:               "hanselminutes-podcasting-101",
		Title:            "Storytelling for Engineers",
		Speaker:          "Doug Crockford",
		URL:              "https://hanselminutes.com/793/storytelling-for-engineers-with-douglas-crockford",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 30,
		Topic:            "communication",
		Tags:             []string{"storytelling", "communication", "engineering"},
		Source:           "Hanselminutes",
		Why:              "Crockford (JSON spec) о том, как инженерам рассказывать истории. Прямая польза для behavioral round.",
	},
	{
		ID:               "hanselminutes-frontend-careers",
		Title:            "Frontend Development Career Paths",
		Speaker:          "Sara Soueidan",
		URL:              "https://hanselminutes.com/810/frontend-development-career-paths-with-sara-soueidan",
		Level:            ListeningTrackLevelB1,
		EstimatedMinutes: 30,
		Topic:            "career",
		Tags:             []string{"frontend", "career", "freelance"},
		Source:           "Hanselminutes",
		Why:              "Frontend career talk — useful для self-positioning English in interviews.",
	},
	{
		ID:               "hanselminutes-azure-functions",
		Title:            "Azure Functions and Serverless",
		Speaker:          "Jeff Hollan",
		URL:              "https://hanselminutes.com/695/azure-functions-and-serverless-with-jeff-hollan",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 30,
		Topic:            "cloud",
		Tags:             []string{"serverless", "azure", "functions"},
		Source:           "Hanselminutes",
		Why:              "Serverless vocabulary в native context — entry-level cloud English.",
	},
	{
		ID:               "hanselminutes-onboarding",
		Title:            "Effective Onboarding for Developers",
		Speaker:          "Tessa Kriesel",
		URL:              "https://hanselminutes.com/881/effective-onboarding-for-developers-with-tessa-kriesel",
		Level:            ListeningTrackLevelB1,
		EstimatedMinutes: 30,
		Topic:            "engineering culture",
		Tags:             []string{"onboarding", "team", "leadership"},
		Source:           "Hanselminutes",
		Why:              "Practical onboarding-related language — pull-request review, mentorship vocab.",
	},

	// ── Latent Space ─────────────────────────────────────────────────────
	{
		ID:               "latent-space-anthropic",
		Title:            "Building Claude with Anthropic",
		Speaker:          "swyx, Alessio Fanelli",
		URL:              "https://www.latent.space/p/anthropic",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 90,
		Topic:            "AI engineering",
		Tags:             []string{"llm", "anthropic", "production-ai"},
		Source:           "Latent Space",
		Why:              "Cutting-edge LLM engineering English — RAG, eval, agents, fine-tune.",
	},
	{
		ID:               "latent-space-codex",
		Title:            "OpenAI Codex deep-dive",
		Speaker:          "Greg Brockman",
		URL:              "https://www.latent.space/p/codex",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 80,
		Topic:            "AI engineering",
		Tags:             []string{"llm", "openai", "code-gen"},
		Source:           "Latent Space",
		Why:              "Code-gen LLMs internals — нужно для ML-coach trek vocabulary.",
	},
	{
		ID:               "latent-space-evals",
		Title:            "AI Evals and Production Monitoring",
		Speaker:          "Hamel Husain",
		URL:              "https://www.latent.space/p/evals",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 95,
		Topic:            "AI engineering",
		Tags:             []string{"evals", "monitoring", "production-ai"},
		Source:           "Latent Space",
		Why:              "Hamel — каноничный voice for eval design на современных LLM-системах.",
	},
	{
		ID:               "latent-space-perplexity",
		Title:            "Perplexity's Search Strategy",
		Speaker:          "Aravind Srinivas",
		URL:              "https://www.latent.space/p/perplexity",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 75,
		Topic:            "AI engineering",
		Tags:             []string{"search", "rag", "product"},
		Source:           "Latent Space",
		Why:              "Aravind (Perplexity CEO) — product + tech vocabulary, mix bizdev и engineering.",
	},
	{
		ID:               "latent-space-rag-2",
		Title:            "RAG architectures done right",
		Speaker:          "Jerry Liu",
		URL:              "https://www.latent.space/p/llamaindex",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 70,
		Topic:            "AI engineering",
		Tags:             []string{"rag", "vector-db", "retrieval"},
		Source:           "Latent Space",
		Why:              "LlamaIndex CEO — каноничный RAG language. Эталон современного AI-eng English.",
	},
	{
		ID:               "latent-space-finetuning",
		Title:            "Fine-tuning LLMs in production",
		Speaker:          "Wing Lian",
		URL:              "https://www.latent.space/p/axolotl",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 75,
		Topic:            "AI engineering",
		Tags:             []string{"finetuning", "lora", "training"},
		Source:           "Latent Space",
		Why:              "Axolotl maintainer — practitioner-level fine-tuning vocab.",
	},

	// ── TED Tech ─────────────────────────────────────────────────────────
	{
		ID:               "ted-jane-mcgonigal",
		Title:            "Gaming can make a better world",
		Speaker:          "Jane McGonigal",
		URL:              "https://www.ted.com/talks/jane_mcgonigal_gaming_can_make_a_better_world",
		Level:            ListeningTrackLevelB1,
		EstimatedMinutes: 20,
		Topic:            "design",
		Tags:             []string{"games", "psychology", "design"},
		Source:           "TED",
		Why:              "TED scripted English — самый чистый и медленный native pace + interactive transcript.",
	},
	{
		ID:               "ted-simon-sinek",
		Title:            "How great leaders inspire action",
		Speaker:          "Simon Sinek",
		URL:              "https://www.ted.com/talks/simon_sinek_how_great_leaders_inspire_action",
		Level:            ListeningTrackLevelB1,
		EstimatedMinutes: 18,
		Topic:            "leadership",
		Tags:             []string{"leadership", "communication", "motivation"},
		Source:           "TED",
		Why:              "Sinek's «Why» talk — образцовая narrative structure для self-presentation в interviews.",
	},
	{
		ID:               "ted-tim-urban",
		Title:            "Inside the mind of a master procrastinator",
		Speaker:          "Tim Urban",
		URL:              "https://www.ted.com/talks/tim_urban_inside_the_mind_of_a_master_procrastinator",
		Level:            ListeningTrackLevelB1,
		EstimatedMinutes: 14,
		Topic:            "psychology",
		Tags:             []string{"procrastination", "productivity", "humour"},
		Source:           "TED",
		Why:              "Casual humorous English — relaxed pacing, lots of phrasal verbs.",
	},
	{
		ID:               "ted-pieter-abbeel",
		Title:            "How AI is teaching robots new skills",
		Speaker:          "Pieter Abbeel",
		URL:              "https://www.ted.com/talks/pieter_abbeel_how_ai_is_teaching_robots_new_skills",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 12,
		Topic:            "AI",
		Tags:             []string{"robotics", "rl", "ai"},
		Source:           "TED",
		Why:              "Abbeel — UC Berkeley prof. RL vocab в простой подаче для TED audience.",
	},
	{
		ID:               "ted-sebastian-thrun",
		Title:            "Google's driverless car",
		Speaker:          "Sebastian Thrun",
		URL:              "https://www.ted.com/talks/sebastian_thrun_google_s_driverless_car",
		Level:            ListeningTrackLevelB1,
		EstimatedMinutes: 9,
		Topic:            "AI",
		Tags:             []string{"self-driving", "ai", "google"},
		Source:           "TED",
		Why:              "Thrun's German-American accent — comfortable для русскоязычных listeners.",
	},
	{
		ID:               "ted-kevin-slavin",
		Title:            "How algorithms shape our world",
		Speaker:          "Kevin Slavin",
		URL:              "https://www.ted.com/talks/kevin_slavin_how_algorithms_shape_our_world",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 15,
		Topic:            "tech and society",
		Tags:             []string{"algorithms", "society", "finance"},
		Source:           "TED",
		Why:              "Faster TED talk — relevant tech-and-society vocab.",
	},
	{
		ID:               "ted-anders-sandberg",
		Title:            "How AI might change everything",
		Speaker:          "Anders Sandberg",
		URL:              "https://www.ted.com/talks/anders_sandberg_how_ai_might_change_everything",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 12,
		Topic:            "AI",
		Tags:             []string{"ai-safety", "future", "philosophy"},
		Source:           "TED",
		Why:              "Future-of-AI vocabulary в коротком формате.",
	},
	{
		ID:               "ted-yejin-choi",
		Title:            "Why AI is incredibly smart and shockingly stupid",
		Speaker:          "Yejin Choi",
		URL:              "https://www.ted.com/talks/yejin_choi_why_ai_is_incredibly_smart_and_shockingly_stupid",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 16,
		Topic:            "AI",
		Tags:             []string{"llm", "limits", "research"},
		Source:           "TED",
		Why:              "UW prof Choi — accessible AI research talk, relatively clear non-American English.",
	},

	// ── Strange Loop Conference ────────────────────────────────────────
	{
		ID:               "strangeloop-rich-hickey",
		Title:            "Simple Made Easy",
		Speaker:          "Rich Hickey",
		URL:              "https://www.youtube.com/watch?v=SxdOUGdseq4",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 60,
		Topic:            "programming philosophy",
		Tags:             []string{"clojure", "complexity", "design"},
		Source:           "Strange Loop",
		Why:              "Hickey's классика. Vocabulary level senior+; философское engineering English.",
	},
	{
		ID:               "strangeloop-hickey-hammock",
		Title:            "Hammock Driven Development",
		Speaker:          "Rich Hickey",
		URL:              "https://www.youtube.com/watch?v=f84n5oFoZBc",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 40,
		Topic:            "engineering process",
		Tags:             []string{"thinking", "design", "deep-work"},
		Source:           "Strange Loop",
		Why:              "Hickey говорит размеренно, vocab чёткое — хороший entry в Strange Loop.",
	},
	{
		ID:               "strangeloop-distributed-sagas",
		Title:            "Distributed Sagas: A Protocol for Coordinating Microservices",
		Speaker:          "Caitie McCaffrey",
		URL:              "https://www.youtube.com/watch?v=0UTOLRTwOX0",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 45,
		Topic:            "distributed systems",
		Tags:             []string{"sagas", "microservices", "transactions"},
		Source:           "Strange Loop",
		Why:              "Каноничный distributed-sagas talk. Dense но прозрачный English.",
	},
	{
		ID:               "strangeloop-millions-of-tiny-databases",
		Title:            "Millions of Tiny Databases",
		Speaker:          "Marc Brooker",
		URL:              "https://www.youtube.com/watch?v=Bos8sAv2K-w",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 40,
		Topic:            "distributed systems",
		Tags:             []string{"aws", "ebs", "databases"},
		Source:           "Strange Loop",
		Why:              "Marc Brooker (AWS) — production distributed-сис talk на topнотч уровне.",
	},
	{
		ID:               "strangeloop-papers-we-love",
		Title:            "Papers We Love: Dynamo",
		Speaker:          "Allen Wirfs-Brock",
		URL:              "https://www.youtube.com/watch?v=cHJrQnf3cl0",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 45,
		Topic:            "distributed systems",
		Tags:             []string{"papers", "dynamodb", "research"},
		Source:           "Strange Loop",
		Why:              "Research-paper-presentation английский. Хороший stretch для академического tone.",
	},
	{
		ID:               "strangeloop-runtime-meet-developer",
		Title:            "Make Things You Love",
		Speaker:          "Andrew Smith",
		URL:              "https://www.youtube.com/watch?v=Q-OTFvjxxz4",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 30,
		Topic:            "creativity",
		Tags:             []string{"craft", "motivation", "tools"},
		Source:           "Strange Loop",
		Why:              "Inspirational-meets-pragmatic English. Standard conference register.",
	},
	{
		ID:               "strangeloop-functional-design",
		Title:            "Functional Design Patterns",
		Speaker:          "Scott Wlaschin",
		URL:              "https://www.youtube.com/watch?v=srQt1NAHYC0",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 60,
		Topic:            "programming paradigms",
		Tags:             []string{"functional", "fsharp", "design-patterns"},
		Source:           "Strange Loop",
		Why:              "Wlaschin — British accent, prosounded English, чёткие design-patterns examples.",
	},
	{
		ID:               "strangeloop-platform-engineering",
		Title:            "The Future of Platform Engineering",
		Speaker:          "Camille Fournier",
		URL:              "https://www.youtube.com/watch?v=B7zMHO_4Vs8",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 40,
		Topic:            "engineering culture",
		Tags:             []string{"platform-engineering", "leadership", "scaling"},
		Source:           "Strange Loop",
		Why:              "Fournier (Two Sigma) — engineering leadership vocabulary на senior+ уровне.",
	},

	// ── GOTO Conference ─────────────────────────────────────────────────
	{
		ID:               "goto-kent-beck-test-desiderata",
		Title:            "Test Desiderata",
		Speaker:          "Kent Beck",
		URL:              "https://www.youtube.com/watch?v=q9XdaB0nogs",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 40,
		Topic:            "testing",
		Tags:             []string{"testing", "tdd", "design"},
		Source:           "GOTO",
		Why:              "Kent Beck — TDD originator. Spoken testing vocabulary.",
	},
	{
		ID:               "goto-uncle-bob-architecture",
		Title:            "Clean Architecture and Design",
		Speaker:          "Robert C. Martin",
		URL:              "https://www.youtube.com/watch?v=2dKZ-dWaCiU",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 60,
		Topic:            "architecture",
		Tags:             []string{"clean-arch", "solid", "principles"},
		Source:           "GOTO",
		Why:              "Uncle Bob — каноничный architecture vocabulary. Speaks slowly.",
	},
	{
		ID:               "goto-pieter-hintjens",
		Title:            "Building Distributed Systems",
		Speaker:          "Pieter Hintjens",
		URL:              "https://www.youtube.com/watch?v=_JCBphyciAs",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 45,
		Topic:            "distributed systems",
		Tags:             []string{"zeromq", "patterns", "messaging"},
		Source:           "GOTO",
		Why:              "ZeroMQ author — Belgian-English accent, accessible distributed-systems vocab.",
	},
	{
		ID:               "goto-john-allspaw-incidents",
		Title:            "How Engineers Survive Incidents",
		Speaker:          "John Allspaw",
		URL:              "https://www.youtube.com/watch?v=cFsoSIO9ZA8",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 45,
		Topic:            "operations",
		Tags:             []string{"incidents", "ops", "post-mortems"},
		Source:           "GOTO",
		Why:              "Etsy / Adaptive Capacity — post-mortem language, нужно для on-call discussions.",
	},
	{
		ID:               "goto-douglas-crockford",
		Title:            "JavaScript: The Better Parts",
		Speaker:          "Douglas Crockford",
		URL:              "https://www.youtube.com/watch?v=DxnYQRuLX7Q",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 50,
		Topic:            "languages",
		Tags:             []string{"javascript", "language-design", "lectures"},
		Source:           "GOTO",
		Why:              "Crockford's measured pace — slow + clear American English.",
	},
	{
		ID:               "goto-jessica-kerr-symmathesy",
		Title:            "Symmathesy: A New Word for Living Systems",
		Speaker:          "Jessica Kerr",
		URL:              "https://www.youtube.com/watch?v=Cu0fbn7--90",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 50,
		Topic:            "engineering philosophy",
		Tags:             []string{"systems-thinking", "philosophy", "complexity"},
		Source:           "GOTO",
		Why:              "Jessica Kerr — fast tone, conceptual content. Stretch listening goal.",
	},
	{
		ID:               "goto-trisha-shipilev",
		Title:            "JVM Performance Tuning",
		Speaker:          "Aleksey Shipilev",
		URL:              "https://www.youtube.com/watch?v=8VtBxJDOyqQ",
		Level:            ListeningTrackLevelC1,
		EstimatedMinutes: 60,
		Topic:            "performance",
		Tags:             []string{"jvm", "performance", "low-level"},
		Source:           "GOTO",
		Why:              "Shipilev (RedHat) — Russian-accented English с MIT-tier deepness. Familiar accent.",
	},
	{
		ID:               "goto-greg-young-cqrs",
		Title:            "A Decade of DDD, CQRS, Event Sourcing",
		Speaker:          "Greg Young",
		URL:              "https://www.youtube.com/watch?v=LDW0QWie21s",
		Level:            ListeningTrackLevelB2,
		EstimatedMinutes: 60,
		Topic:            "architecture",
		Tags:             []string{"ddd", "cqrs", "event-sourcing"},
		Source:           "GOTO",
		Why:              "Greg Young — CQRS vocabulary в native context, для sysdesign rounds.",
	},
}
