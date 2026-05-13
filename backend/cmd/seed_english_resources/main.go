// seed_english_resources — CLI для bulk-seed Sergey-curated English
// content в external_resources jsonb на atlas_nodes eng_*.
//
// druz9 = ranking-proxy (memory/project_curation_model): не клонируем
// content в БД, линкуем external resources на atlas_nodes. Этот CLI —
// фиксированный seed Sergey-verified кураторского списка для English
// vertical (Tech-English reading / CS articles / podcasts / speaking
// scenarios / writing prompts).
//
// Идемпотентность: merge by URL (case-insensitive). Если URL уже есть в
// external_resources — оставляем существующий entry as-is (не перезаписываем —
// Sergey мог за-tweak'ать `why` или `priority` через seed_resources).
// Новые URLs добавляются в конец массива. Pre-existing порядок preserved.
//
// Usage:
//
//	export PG_DSN='postgres://druz9:druz9@localhost:5432/druz9?sslmode=disable'
//	go run ./backend/cmd/seed_english_resources
//	# or with --dry-run печатает SQL UPDATE'ы без выполнения.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"slices"
	"strings"
	"time"

	"druz9/curation/domain"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	dsn := flag.String("dsn", os.Getenv("PG_DSN"), "Postgres DSN (overrides PG_DSN env)")
	dryRun := flag.Bool("dry-run", false, "print SQL UPDATE statements without executing")
	flag.Parse()

	if *dsn == "" && !*dryRun {
		fmt.Fprintln(os.Stderr, "seed_english_resources: PG_DSN env or --dsn required (use --dry-run to skip DB)")
		os.Exit(2)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if *dryRun {
		printDryRun()
		return
	}

	pool, err := pgxpool.New(ctx, *dsn)
	if err != nil {
		fmt.Fprintf(os.Stderr, "seed_english_resources: connect: %v\n", err)
		os.Exit(2)
	}
	defer pool.Close()

	totalAdded := 0
	totalSkipped := 0
	for _, b := range curated() {
		added, skipped, err := upsertNode(ctx, pool, b.nodeID, b.resources)
		if err != nil {
			fmt.Fprintf(os.Stderr, "seed_english_resources: node %s: %v\n", b.nodeID, err)
			os.Exit(1)
		}
		fmt.Printf("seed_english_resources: %s — added %d, skipped %d (already present)\n", //nolint:forbidigo // CLI status output
			b.nodeID, added, skipped)
		totalAdded += added
		totalSkipped += skipped
	}
	fmt.Printf("seed_english_resources: done — %d new resources, %d already present, %d nodes touched\n", //nolint:forbidigo // CLI summary
		totalAdded, totalSkipped, len(curated()))
}

// upsertNode merge'ит supplied list в node's external_resources by URL.
// Существующие entries оставляются untouched (preserve Sergey tweaks).
// Возвращает (added, skipped).
func upsertNode(ctx context.Context, pool *pgxpool.Pool, nodeID string, incoming domain.ResourceList) (int, int, error) {
	if err := incoming.Validate(); err != nil {
		return 0, 0, fmt.Errorf("validate incoming: %w", err)
	}

	var raw []byte
	err := pool.QueryRow(ctx,
		`SELECT external_resources FROM atlas_nodes WHERE id = $1`,
		nodeID,
	).Scan(&raw)
	if err != nil {
		return 0, 0, fmt.Errorf("load node: %w", err)
	}

	existing, err := domain.Unmarshal(raw)
	if err != nil {
		return 0, 0, fmt.Errorf("unmarshal existing: %w", err)
	}

	seen := make(map[string]struct{}, len(existing))
	for _, r := range existing {
		seen[strings.ToLower(r.URL)] = struct{}{}
	}

	added := 0
	skipped := 0
	merged := slices.Clone(existing)
	for _, r := range incoming {
		key := strings.ToLower(r.URL)
		if _, dup := seen[key]; dup {
			skipped++
			continue
		}
		seen[key] = struct{}{}
		merged = append(merged, r)
		added++
	}

	if added == 0 {
		return 0, skipped, nil
	}

	body, err := merged.Marshal()
	if err != nil {
		return 0, 0, fmt.Errorf("marshal merged: %w", err)
	}

	_, err = pool.Exec(ctx,
		`UPDATE atlas_nodes SET external_resources = $1::jsonb WHERE id = $2`,
		string(body), nodeID,
	)
	if err != nil {
		return 0, 0, fmt.Errorf("update: %w", err)
	}
	return added, skipped, nil
}

func printDryRun() {
	for _, b := range curated() {
		if err := b.resources.Validate(); err != nil {
			fmt.Fprintf(os.Stderr, "dry-run validation failed for %s: %v\n", b.nodeID, err)
			os.Exit(1)
		}
		body, err := b.resources.Marshal()
		if err != nil {
			fmt.Fprintf(os.Stderr, "dry-run marshal failed for %s: %v\n", b.nodeID, err)
			os.Exit(1)
		}
		fmt.Printf("-- seed_english_resources DRY-RUN · node=%s · %d resources to merge\n", b.nodeID, len(b.resources)) //nolint:forbidigo // dry-run output
		fmt.Printf("-- (actual merge is idempotent: skips URLs already present)\n")                                     //nolint:forbidigo // dry-run output
		fmt.Printf("-- payload: %s\n\n", string(body))                                                                  //nolint:forbidigo // dry-run output
	}
}

// nodeBundle — curated resources targeted на конкретный atlas_node.
type nodeBundle struct {
	nodeID    string
	resources domain.ResourceList
}

// curated возвращает Sergey-grade English curated content для всех eng_* nodes.
// Distribution:
//   - eng_read_tech     : 8 articles (PG, Joel, Stripe, GitHub, Vercel)
//   - eng_read_fiction  : 3 patio11 / classic CS reading entries
//   - eng_read_news     : 2 HN-oriented entries
//   - eng_listen_pods   : 5 podcasts
//   - eng_listen_tech   : 4 conf-talk feeds
//   - eng_listen_conv   : 2 conversational shows
//   - eng_speak_mock    : 5 sysdesign / mock interview scenarios
//   - eng_write_tech    : 3 prompts с rubric link
//   - eng_write_summ    : 2 summary-writing references
//   - eng_write_casual  : 2 email/Slack guides
//
// Все URLs free-tier, English-language. Author / why fields написаны
// Sergey-style (Tradeoff > вода).
func curated() []nodeBundle {
	return []nodeBundle{
		{
			nodeID: "eng_read_tech",
			resources: domain.ResourceList{
				{
					URL:      "http://www.paulgraham.com/hp.html",
					Title:    "Hackers and Painters",
					Author:   "Paul Graham",
					Kind:     domain.KindArticle,
					Minutes:  25,
					Level:    domain.LevelB,
					Priority: domain.PriorityCore,
					Why:      "Каноничный tech-essay с лексикой, которой меряют senior — «taste», «make», «hack» в правильных коннотациях.",
					Depth:    domain.DepthIntuition,
					Summary:  "PG про творческую природу разработки, аналогии с живописью. Образцовый стиль tech-prose: короткие предложения, контрастные claims, ноль buzzwords.",
				},
				{
					URL:      "http://www.paulgraham.com/ds.html",
					Title:    "Do Things That Don't Scale",
					Author:   "Paul Graham",
					Kind:     domain.KindArticle,
					Minutes:  15,
					Level:    domain.LevelB,
					Priority: domain.PriorityCore,
					Why:      "Самый цитируемый PG-essay — лексика startup-talk («unscalable», «manual», «recruit») понадобится на любом интервью в продукт.",
					Depth:    domain.DepthIntuition,
					Summary:  "Почему early-stage стартапы должны делать руками то, что не масштабируется. Текст-источник идиом ‘do unscalable things’ в продуктовом English.",
				},
				{
					URL:      "http://www.paulgraham.com/makersschedule.html",
					Title:    "Maker's Schedule, Manager's Schedule",
					Author:   "Paul Graham",
					Kind:     domain.KindArticle,
					Minutes:  10,
					Level:    domain.LevelB,
					Priority: domain.PrioritySupplement,
					Why:      "Foundational ‘deep work’ vocabulary — ‘maker’s schedule’ / ‘context switch’ — без этих идиом не обсудить focus в interview.",
					Depth:    domain.DepthIntuition,
					Summary:  "Различие maker’s vs manager’s schedule и почему встречи токсичны для инженеров. Источник терминологии для разговоров про focus / productivity.",
				},
				{
					URL:      "https://www.joelonsoftware.com/2000/08/09/the-joel-test-12-steps-to-better-code/",
					Title:    "The Joel Test: 12 Steps to Better Code",
					Author:   "Joel Spolsky",
					Kind:     domain.KindArticle,
					Minutes:  12,
					Level:    domain.LevelA,
					Priority: domain.PriorityCore,
					Why:      "Каноничный engineering-process language — daily build, bug database, source control. Лексика, которая всплывает в HR-screening.",
					Depth:    domain.DepthIntro,
					Summary:  "12 yes/no вопросов о инженерной зрелости команды (build, VCS, specs, testing). Foundational chunk eng-process English.",
				},
				{
					URL:      "https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/",
					Title:    "Things You Should Never Do, Part I (Big Rewrite)",
					Author:   "Joel Spolsky",
					Kind:     domain.KindArticle,
					Minutes:  15,
					Level:    domain.LevelB,
					Priority: domain.PrioritySupplement,
					Why:      "Архивный essay про rewrite vs refactor — лексика будет нужна, когда interviewer спросит «have you ever rewritten a system?».",
					Depth:    domain.DepthIntuition,
					Summary:  "Почему Netscape проиграл от ‘big rewrite’. Источник engineering-folklore vocabulary: legacy code, refactor, incremental.",
				},
				{
					URL:      "https://www.joelonsoftware.com/2002/11/11/the-law-of-leaky-abstractions/",
					Title:    "The Law of Leaky Abstractions",
					Author:   "Joel Spolsky",
					Kind:     domain.KindArticle,
					Minutes:  12,
					Level:    domain.LevelB,
					Priority: domain.PrioritySupplement,
					Why:      "Термин ‘leaky abstraction’ — entry в любое архитектурное обсуждение на английском. Без него senior-talk звучит пусто.",
					Depth:    domain.DepthIntuition,
					Summary:  "Почему любая абстракция течёт. Источник идиомы leaky abstraction; полезен на sysdesign rounds.",
				},
				{
					URL:      "https://stripe.com/blog/online-migrations",
					Title:    "Online Migrations at Scale",
					Author:   "Stripe Engineering",
					Kind:     domain.KindArticle,
					Minutes:  20,
					Level:    domain.LevelC,
					Priority: domain.PriorityCore,
					Why:      "Stripe engineering blog — golden standard tech-writing на английском. Используйте как образец RFC-стиля.",
					Depth:    domain.DepthDeep,
					Summary:  "Как Stripe мигрирует таблицы без downtime: 4-step pattern (dual-write, backfill, dual-read, cleanup). Образцовый tech-narrative.",
				},
				{
					URL:      "https://github.blog/engineering/architecture-optimization/how-we-ship-code-at-github/",
					Title:    "How we ship code at GitHub",
					Author:   "GitHub Engineering",
					Kind:     domain.KindArticle,
					Minutes:  18,
					Level:    domain.LevelB,
					Priority: domain.PrioritySupplement,
					Why:      "Лексика deployment / shipping / rollouts в нативе. Pull-request English там же — все термины повседневной работы.",
					Depth:    domain.DepthIntuition,
					Summary:  "GitHub describes own deploy process: ChatOps, feature flags, gradual rollouts. Лучший source для словаря ‘ship code’.",
				},
				{
					URL:      "https://www.kalzumeus.com/2011/10/28/dont-call-yourself-a-programmer/",
					Title:    "Don't Call Yourself a Programmer (and Other Career Advice)",
					Author:   "Patrick McKenzie",
					Kind:     domain.KindArticle,
					Minutes:  30,
					Level:    domain.LevelB,
					Priority: domain.PriorityCore,
					Why:      "Источник English-language framing своей роли — ‘I solve problems that make $X for the business’. Must read перед любым job interview.",
					Depth:    domain.DepthIntuition,
					Summary:  "patio11 о том, как программисту позиционировать себя: business value language, negotiation. Образец persuasive English для cover letters.",
				},
				{
					URL:      "https://www.kalzumeus.com/2012/01/23/salary-negotiation/",
					Title:    "Salary Negotiation: Make More Money, Be More Valued",
					Author:   "Patrick McKenzie",
					Kind:     domain.KindArticle,
					Minutes:  45,
					Level:    domain.LevelB,
					Priority: domain.PrioritySupplement,
					Why:      "Полный vocabulary negotiation-разговора на английском: ‘range’, ‘compensation package’, ‘counteroffer’.",
					Depth:    domain.DepthDeep,
					Summary:  "Pragmatic guide к salary negotiation. Source для фраз ‘that’s below my expectations’, ‘I’d like to discuss the full package’ etc.",
				},
				{
					URL:      "https://martinfowler.com/articles/microservices.html",
					Title:    "Microservices",
					Author:   "Martin Fowler & James Lewis",
					Kind:     domain.KindArticle,
					Minutes:  40,
					Level:    domain.LevelB,
					Priority: domain.PriorityCore,
					Why:      "Каноничное определение микросервисов на английском — все термины (‘bounded context’, ‘smart endpoints’) приходят отсюда.",
					Depth:    domain.DepthDeep,
					Summary:  "Fowler systematic микросервисный architecture overview. Vocabulary backbone для любого distributed-systems interview.",
				},
				{
					URL:      "https://www.allthingsdistributed.com/2007/12/eventually_consistent.html",
					Title:    "Eventually Consistent",
					Author:   "Werner Vogels (AWS CTO)",
					Kind:     domain.KindArticle,
					Minutes:  15,
					Level:    domain.LevelC,
					Priority: domain.PrioritySupplement,
					Why:      "Werner Vogels coined ‘eventual consistency’ term — узнайте источник, который нужен в любом distributed-сис обсуждении.",
					Depth:    domain.DepthDeep,
					Summary:  "Canonical write-up на CAP / eventual consistency vocabulary. Authoritative source для distributed-talk на английском.",
				},
			},
		},
		{
			nodeID: "eng_read_fiction",
			resources: domain.ResourceList{
				{
					URL:      "https://www.gutenberg.org/files/2814/2814-h/2814-h.htm",
					Title:    "Dubliners",
					Author:   "James Joyce",
					Kind:     domain.KindBook,
					Minutes:  300,
					Level:    domain.LevelC,
					Priority: domain.PriorityOptional,
					Why:      "Образцовая short-story collection, рекомендуется как exposure к narrative voice в идиоматическом английском.",
					Depth:    domain.DepthDeep,
					Summary:  "15 рассказов Joyce о повседневной жизни в Дублине. Free Gutenberg текст для narrative-voice/idiomatic reading.",
				},
				{
					URL:      "https://www.gutenberg.org/files/64317/64317-h/64317-h.htm",
					Title:    "The Great Gatsby",
					Author:   "F. Scott Fitzgerald",
					Kind:     domain.KindBook,
					Minutes:  360,
					Level:    domain.LevelB,
					Priority: domain.PriorityOptional,
					Why:      "Free Gutenberg edition — classic American prose с rich vocabulary, базовый reference для idiom range.",
					Depth:    domain.DepthDeep,
					Summary:  "Каноничный American novel, free public-domain text. Хорошо для vocab expansion и narrative-tense awareness.",
				},
				{
					URL:      "http://www.paulgraham.com/words.html",
					Title:    "Writing, Briefly",
					Author:   "Paul Graham",
					Kind:     domain.KindArticle,
					Minutes:  5,
					Level:    domain.LevelA,
					Priority: domain.PrioritySupplement,
					Why:      "Минимальный essay про writing prose — relevant для fiction reading lens: что отличает живой текст от газетного.",
					Depth:    domain.DepthIntro,
					Summary:  "5-минутный PG-чеклист про prose writing. Применимо к чтению fiction — какие приёмы замечать.",
				},
			},
		},
		{
			nodeID: "eng_read_news",
			resources: domain.ResourceList{
				{
					URL:      "https://news.ycombinator.com/news",
					Title:    "Hacker News (front page)",
					Author:   "Y Combinator",
					Kind:     domain.KindArticle,
					Minutes:  20,
					Level:    domain.LevelB,
					Priority: domain.PriorityCore,
					Why:      "Daily English tech-news + комменты — самый efficient способ оставаться в современном tech-vocab.",
					Depth:    domain.DepthReference,
					Summary:  "Front-page tech news aggregator. Чтение top stories + 30 comments в день — sustained exposure к natural eng-style.",
					FormatNotes: "ranked comment threads",
				},
				{
					URL:      "https://newsletter.pragmaticengineer.com/",
					Title:    "The Pragmatic Engineer Newsletter",
					Author:   "Gergely Orosz",
					Kind:     domain.KindArticle,
					Minutes:  30,
					Level:    domain.LevelB,
					Priority: domain.PrioritySupplement,
					Why:      "Lengthy industry-focused newsletter — образцовый pragmatic eng tone, без hype-vocabulary.",
					Depth:    domain.DepthDeep,
					Summary:  "Free + paid posts. Free portion даёт regular exposure к structured journalistic English в tech domain.",
					FormatNotes: "free posts; paid tier paywalled",
				},
			},
		},
		{
			nodeID: "eng_listen_pods",
			resources: domain.ResourceList{
				{
					URL:      "https://softwareengineeringdaily.com/",
					Title:    "Software Engineering Daily",
					Author:   "Jeff Meyerson (founder) / current host",
					Kind:     domain.KindPodcast,
					Minutes:  60,
					Level:    domain.LevelB,
					Priority: domain.PriorityCore,
					Why:      "Ежедневные tech-interviews — длинный native-speed pace, перфектно для listening stamina.",
					Depth:    domain.DepthDeep,
					Summary:  "60-min interviews с tech CEO/engineers. Slow-to-medium pace, clear diction, free archive — workhorse listening source.",
				},
				{
					URL:      "https://changelog.com/podcast",
					Title:    "The Changelog",
					Author:   "Adam Stacoviak, Jerod Santo",
					Kind:     domain.KindPodcast,
					Minutes:  60,
					Level:    domain.LevelB,
					Priority: domain.PriorityCore,
					Why:      "Open-source community podcast — informal banter перемежается с tech depth, отличная exposure к колоквиальному tech English.",
					Depth:    domain.DepthIntuition,
					Summary:  "Long-form conversations с OSS maintainers. Mix formal + informal English, free transcripts available.",
				},
				{
					URL:      "https://hanselminutes.com/",
					Title:    "Hanselminutes Podcast",
					Author:   "Scott Hanselman",
					Kind:     domain.KindPodcast,
					Minutes:  30,
					Level:    domain.LevelB,
					Priority: domain.PrioritySupplement,
					Why:      "30-min формат с богатой articulation Hanselman'а — образцовая native pronunciation + tech vocab.",
					Depth:    domain.DepthIntuition,
					Summary:  "Weekly 30-min interviews. Hanselman speaks deliberately and clearly — useful для intermediate listeners.",
				},
				{
					URL:      "https://stackoverflow.blog/podcast/",
					Title:    "The Stack Overflow Podcast",
					Author:   "Stack Overflow",
					Kind:     domain.KindPodcast,
					Minutes:  40,
					Level:    domain.LevelA,
					Priority: domain.PrioritySupplement,
					Why:      "Approachable casual style, прозрачные accents — entry-level English listening.",
					Depth:    domain.DepthIntro,
					Summary:  "Casual eng culture podcast: career, tooling, community topics. Clear American English, free archive.",
				},
				{
					URL:      "https://lexfridman.com/podcast/",
					Title:    "Lex Fridman Podcast",
					Author:   "Lex Fridman",
					Kind:     domain.KindPodcast,
					Minutes:  180,
					Level:    domain.LevelC,
					Priority: domain.PrioritySupplement,
					Why:      "Long-form (2-4h) tech / AI / science interviews — Lex non-native (RU origin) speaks slowly, accessible for РУ learners.",
					Depth:    domain.DepthDeep,
					Summary:  "Marathon interviews с CS / ML / science figures. Lex’s pace = comfort zone для русскоязычных. Full free archive + transcripts.",
					FormatNotes: "very long episodes; pick by topic",
				},
				{
					URL:      "https://www.latent.space/podcast",
					Title:    "Latent Space",
					Author:   "swyx, Alessio Fanelli",
					Kind:     domain.KindPodcast,
					Minutes:  90,
					Level:    domain.LevelC,
					Priority: domain.PrioritySupplement,
					Why:      "AI engineering podcast — modern ML deployment vocabulary (RAG, agents, eval), которое ML-coach trek будет нужен.",
					Depth:    domain.DepthDeep,
					Summary:  "Top-rated AI engineering podcast 2024-2025. Cutting-edge ML vocabulary в native English. Transcripts available.",
				},
			},
		},
		{
			nodeID: "eng_listen_tech",
			resources: domain.ResourceList{
				{
					URL:      "https://www.youtube.com/c/StrangeLoopConf/videos",
					Title:    "Strange Loop Conference (YouTube archive)",
					Author:   "Strange Loop",
					Kind:     domain.KindVideo,
					Minutes:  45,
					Level:    domain.LevelC,
					Priority: domain.PriorityCore,
					Why:      "Каноничный CS conference со speakers высочайшего уровня — образцовый academic-tech English с substantive content.",
					Depth:    domain.DepthDeep,
					Summary:  "Multi-year archive of CS / PL / distributed talks. Free YouTube captions help при изучении. Discontinued 2023 но архив остаётся.",
					FormatNotes: "video; closed captions available",
				},
				{
					URL:      "https://www.youtube.com/@GOTO-/videos",
					Title:    "GOTO Conferences",
					Author:   "GOTO",
					Kind:     domain.KindVideo,
					Minutes:  45,
					Level:    domain.LevelB,
					Priority: domain.PrioritySupplement,
					Why:      "European tech conf — variety of accents (Danish, UK, German) для exposure к non-American English.",
					Depth:    domain.DepthDeep,
					Summary:  "EU-based conf talks. Wider accent range = good listening robustness training.",
					FormatNotes: "video; mixed accents",
				},
				{
					URL:      "https://www.usenix.org/conferences/byname/177",
					Title:    "USENIX OSDI / NSDI Conference Talks",
					Author:   "USENIX",
					Kind:     domain.KindVideo,
					Minutes:  20,
					Level:    domain.LevelD,
					Priority: domain.PriorityOptional,
					Why:      "Top-tier systems research talks — academic English at peak density. Stretch goal для advanced listeners.",
					Depth:    domain.DepthDeep,
					Summary:  "Free OSDI/NSDI conference recordings (academic systems research). Use for stretch listening + research paper vocab.",
					FormatNotes: "academic register; dense terminology",
				},
				{
					URL:      "https://www.ted.com/topics/technology",
					Title:    "TED Talks: Technology",
					Author:   "TED",
					Kind:     domain.KindVideo,
					Minutes:  15,
					Level:    domain.LevelA,
					Priority: domain.PrioritySupplement,
					Why:      "15-min формат + interactive transcripts + multi-language subtitles — best entry point для listening practice.",
					Depth:    domain.DepthIntro,
					Summary:  "Curated TED talks по technology. Free transcripts с word-level timing — perfect для слово-в-слово listening drill.",
					FormatNotes: "interactive transcripts available",
				},
			},
		},
		{
			nodeID: "eng_listen_conv",
			resources: domain.ResourceList{
				{
					URL:      "https://acquired.fm/episodes",
					Title:    "Acquired",
					Author:   "Ben Gilbert, David Rosenthal",
					Kind:     domain.KindPodcast,
					Minutes:  180,
					Level:    domain.LevelC,
					Priority: domain.PrioritySupplement,
					Why:      "Tech business deep-dives — narrative English storytelling, фразовая лексика на бизнес-стороне tech.",
					Depth:    domain.DepthDeep,
					Summary:  "3-4h episodes на companies (Nvidia, Microsoft, etc.). Conversational pacing, business + tech vocab mix. Free.",
				},
				{
					URL:      "https://www.npr.org/podcasts/510289/planet-money",
					Title:    "Planet Money (NPR)",
					Author:   "NPR",
					Kind:     domain.KindPodcast,
					Minutes:  25,
					Level:    domain.LevelB,
					Priority: domain.PriorityOptional,
					Why:      "Образцовый mainstream American English — broadcast-quality clarity, narrative storytelling.",
					Depth:    domain.DepthIntuition,
					Summary:  "25-min NPR show о экономике в narrative format. Best-in-class American English diction для casual learning.",
				},
			},
		},
		{
			nodeID: "eng_speak_mock",
			resources: domain.ResourceList{
				{
					URL:      "https://github.com/donnemartin/system-design-primer",
					Title:    "System Design Primer",
					Author:   "Donne Martin",
					Kind:     domain.KindTool,
					Minutes:  600,
					Level:    domain.LevelC,
					Priority: domain.PriorityCore,
					Why:      "Канонический English-language sysdesign vocabulary — все термины (sharding, hot-shard, fanout) сгруппированы там.",
					Depth:    domain.DepthReference,
					Summary:  "Massive open-source sysdesign reference. Используйте как vocab gym: читайте раздел вслух, потом try формулировать тот же design в своих словах на recording.",
				},
				{
					URL:      "https://www.pramp.com/",
					Title:    "Pramp — Free Mock Interviews",
					Author:   "Pramp",
					Kind:     domain.KindTool,
					Minutes:  60,
					Level:    domain.LevelB,
					Priority: domain.PriorityCore,
					Why:      "Free peer-to-peer mock interviews — natural English under pressure. Critical exposure к real-time interview vocabulary.",
					Depth:    domain.DepthDeep,
					Summary:  "Free platform для peer mock interviews (coding + sysdesign). 60-min sessions, English-only by default. Best practice ground.",
					FormatNotes: "scheduled peer-pairing; not always available",
				},
				{
					URL:      "https://interviewing.io/recordings",
					Title:    "interviewing.io Public Recordings",
					Author:   "interviewing.io",
					Kind:     domain.KindVideo,
					Minutes:  60,
					Level:    domain.LevelB,
					Priority: domain.PrioritySupplement,
					Why:      "Real anonymized FAANG-level mock interviews — слушайте formulation паттерны senior candidates по-английски.",
					Depth:    domain.DepthDeep,
					Summary:  "Free archive of real mock interview recordings. Includes failed + successful sessions. Listen для clarification language patterns.",
					FormatNotes: "video; mixed quality recordings",
				},
				{
					URL:      "https://github.com/checkcheckzz/system-design-interview",
					Title:    "System Design Interview Question Bank",
					Author:   "checkcheckzz (community)",
					Kind:     domain.KindTool,
					Minutes:  120,
					Level:    domain.LevelC,
					Priority: domain.PrioritySupplement,
					Why:      "Curated sysdesign questions с answers — используйте как verbal exercises (выберите 1 → solo speaking 15 min).",
					Depth:    domain.DepthReference,
					Summary:  "Open-source list of sysdesign interview questions with reference answers. Combine с self-recording для drill.",
				},
				{
					URL:      "https://www.tryexponent.com/courses/system-design-interview",
					Title:    "Exponent System Design Course (Free Lessons)",
					Author:   "Exponent",
					Kind:     domain.KindCourse,
					Minutes:  90,
					Level:    domain.LevelC,
					Priority: domain.PriorityOptional,
					Why:      "Free preview lessons с verbal walkthroughs — slow-paced English voice-over для тренировки.",
					Depth:    domain.DepthIntuition,
					Summary:  "Selected free lessons на sysdesign questions. Voice walkthroughs полезны для shadowing technique.",
					FormatNotes: "free tier limited; paid tier paywalled",
				},
			},
		},
		{
			nodeID: "eng_write_tech",
			resources: domain.ResourceList{
				{
					URL:      "https://developers.google.com/tech-writing",
					Title:    "Google Technical Writing Courses",
					Author:   "Google Developers",
					Kind:     domain.KindCourse,
					Minutes:  240,
					Level:    domain.LevelB,
					Priority: domain.PriorityCore,
					Why:      "Free Google course на tech writing — rubric для self-evaluation. Применяйте к собственным RFC / design doc drafts.",
					Depth:    domain.DepthDeep,
					Summary:  "Free 2-course series (one-day + advanced). Включает interactive exercises и principles applicable к engineering writing.",
				},
				{
					URL:      "https://www.industrialempathy.com/posts/design-docs-at-google/",
					Title:    "Design Docs at Google",
					Author:   "Malte Ubl",
					Kind:     domain.KindArticle,
					Minutes:  20,
					Level:    domain.LevelB,
					Priority: domain.PriorityCore,
					Why:      "Каноничный English template для design docs — структура, lexica, register. Drafttable starting point.",
					Depth:    domain.DepthDeep,
					Summary:  "Google staff engineer explains internal design-doc culture и template. Use как model для своих docs.",
				},
				{
					URL:      "https://stripe.com/blog/api-versioning",
					Title:    "API Versioning at Stripe",
					Author:   "Stripe Engineering",
					Kind:     domain.KindArticle,
					Minutes:  18,
					Level:    domain.LevelC,
					Priority: domain.PrioritySupplement,
					Why:      "Pinnacle tech blog write-up — analyze sentence structure as template для собственного blog post.",
					Depth:    domain.DepthDeep,
					Summary:  "Stripe writes до how they version their API. Образцовая tech-blog narrative для модельного следования.",
				},
				{
					URL:      "https://www.julian.com/guide/write/intro",
					Title:    "Julian Shapiro — How to Write Well",
					Author:   "Julian Shapiro",
					Kind:     domain.KindArticle,
					Minutes:  45,
					Level:    domain.LevelB,
					Priority: domain.PrioritySupplement,
					Why:      "Принципы lucid writing — все эссе короткие, applicable к tech-prose. Use как rubric.",
					Depth:    domain.DepthIntuition,
					Summary:  "Practical guide к clear writing. Coverage: structure, voice, editing. Применимо к tech-blog и RFC drafting.",
				},
			},
		},
		{
			nodeID: "eng_write_summ",
			resources: domain.ResourceList{
				{
					URL:      "https://www.scotthyoung.com/blog/2020/10/29/how-to-take-better-notes/",
					Title:    "How to Take Better Notes (Feynman Technique)",
					Author:   "Scott H. Young",
					Kind:     domain.KindArticle,
					Minutes:  15,
					Level:    domain.LevelA,
					Priority: domain.PriorityCore,
					Why:      "Practical English-language framework для summary writing — Feynman vocabulary должна быть в твоей armoury.",
					Depth:    domain.DepthIntuition,
					Summary:  "Article на active-recall note taking с примерами. Foundation для summary-style English writing.",
				},
				{
					URL:      "https://gwern.net/note/note",
					Title:    "Notes on Note-Taking (Gwern)",
					Author:   "Gwern Branwen",
					Kind:     domain.KindArticle,
					Minutes:  30,
					Level:    domain.LevelC,
					Priority: domain.PriorityOptional,
					Why:      "Gwern style = образцовый dense academic English — extreme exposure к sophisticated phrasing.",
					Depth:    domain.DepthDeep,
					Summary:  "Long-form essay на note-taking system. Stretch reading: vocabulary density high, modeled English at PhD-level.",
					FormatNotes: "very dense prose",
				},
			},
		},
		{
			nodeID: "eng_write_casual",
			resources: domain.ResourceList{
				{
					URL:      "https://hbr.org/2016/11/how-to-write-email-with-military-precision",
					Title:    "How to Write Email with Military Precision",
					Author:   "Kabir Sehgal (Harvard Business Review)",
					Kind:     domain.KindArticle,
					Minutes:  10,
					Level:    domain.LevelA,
					Priority: domain.PriorityCore,
					Why:      "Subject-line discipline + body structure — обязательный baseline для work email на английском.",
					Depth:    domain.DepthIntuition,
					Summary:  "HBR practical framework для email subjects + structure. Foundation для work-email English.",
				},
				{
					URL:      "https://slack.com/blog/collaboration/etiquette-tips-in-slack",
					Title:    "Slack Etiquette Tips",
					Author:   "Slack",
					Kind:     domain.KindArticle,
					Minutes:  8,
					Level:    domain.LevelA,
					Priority: domain.PrioritySupplement,
					Why:      "Slack-specific conventions — thread / DM / channel norms на English-speaking teams. Avoid faux-pas.",
					Depth:    domain.DepthIntro,
					Summary:  "Quick guide к Slack communication norms в US-speaking teams. Polishes async work-English.",
				},
			},
		},
	}
}
