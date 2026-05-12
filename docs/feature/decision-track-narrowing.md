# Decision: 3 трека (Go / ML / English) → 1 трек?

**Status:** open · awaiting Sergey decision
**Created:** 2026-05-12 (brainstorm follow-up)
**Trigger:** Multi-track positioning расходует content depth (curation, prompts, examples) и target audience width.

## Контекст

Текущая identity ([identity.md](identity.md)):
> 3 трека: Go senior · ML engineering · English (opt-in toggle)

Brainstorm-doc 2026-05-12 подсветил: эти аудитории **разная mental model, разные frameworks, разные конкуренты**. Maintaining all three требует depth × 3.

## Аудитории

| Track | Audience | Frameworks | Главный конкурент |
|---|---|---|---|
| **Go senior** | 5+ years backend, готовятся к L5/L6 | LeetCode + system design + concurrency patterns | LeetCode Premium + Educative |
| **ML engineering** | Data scientist → MLE transition | Kaggle + ml-mastery + papers | Coursera Specialisations + DeepLearning.AI |
| **English** | B1→B2 для tech professionals | SRS vocab + grading + listening | Skyeng + Cake + LingQ |

Перекрытие frameworks: ~10% (English completely orthogonal; Go vs ML — partial overlap в system design).

## Опции

### A. Drop English как трек, оставить как «orthogonal modifier»
**Action:** Текущее behavior сохранить — English уже opt-in toggle. Удалить English из onboarding selection (only Go / ML / DE / Other). English module остаётся в Hone Settings как secondary toggle.

**Плюсы:**
- Identity narrowing → «AI-coach для senior IT prep» (без English)
- English module существует, не deleted — current users continue using
- Sergey 2026-05-04 уже decision'нул «English — opt-in, не должен светиться в палитре по умолчанию» — это halfway move

**Минусы:**
- Half-measure. Module still maintained, content still updated
- Для Sergey personally — English важна для personal use case
- English audience drop из onboarding = lose acquisition channel (English-prep is high-intent)

### B. English → standalone product (different domain / brand)
**Action:** English module split в `english.druz9.online` или `lingo.tld`. Полный pipeline: own onboarding, own pricing, own monetization. druz9 = pure senior IT prep.

**Плюсы:**
- Each product targets clean audience
- English может monetize agressively (B2 prep market high willingness-to-pay)
- druz9 mission становится sharp — easier для investor pitch + content marketing

**Минусы:**
- Major split engineering effort. Domain setup, separate auth, separate billing
- Brand split = double marketing
- Backend already shared (English module в Hone) — split требует backend rework

**Риск:** Над split можно работать годы. Solo-founder это не realistic в next 26 weeks.

### C. Drop ML как трек, focus Go-only
**Action:** ML pivot. Go senior — main wedge. ML examples, prompts, curated resources removed. Curation flag `track_id` у Atlas resources только Go.

**Плюсы:**
- Single track = depth × N (а не breadth × N)
- Go senior audience — Sergey's personal expertise (он Go-developer) → high-quality content judgement
- Go market growing (cloud + microservices + Kubernetes)
- ML competition fierce (Coursera + Andrew Ng — hard to compete on free LLM cascade)

**Минусы:**
- ML hype = high inbound interest. Drop = lose discoverability
- Atlas already has ML curation (Strang LA, mlcourse.ai) — sunk content effort
- Sergey personally hyped ML (resume mentions ML engineering)

### D. Sequential focus — Phase B-G Go-only, Phase H+ add ML/English
**Action:** В roadmap A→I, Phase B-G shipping all features Go-only. Phase H («Subscription MVP») expands к ML и English.

**Плюсы:**
- Сохраняет 3-track identity long-term
- Frees Phase B-G от content × 3 burden
- Проверяет product-market fit на одном clean audience first

**Минусы:**
- Identity messaging confused («3 tracks coming Q3» — current users могут не дождаться)
- ML / English audience видит «не для меня сейчас» → leak

## Recommendation

**A** — drop English из onboarding default, keep как opt-in module. Reasoning:

1. **English module already shipped и работает.** Drop = dead code. Keep как opt-in stays cheap.
2. **Sergey persональный use case** для English важен. Hard drop demotivates.
3. **Identity narrowing к «senior IT prep»** автоматически clarifies positioning без full deletion.
4. **ML keep** — это complementary к Go (system design + ML systems = senior IT skill set). Drop ML separate decision later.

**Что НЕ recommend:**
- B (split standalone) — too expensive в 26-week window
- C (drop ML) — strong ML overlap с Go senior at staff level, drop кэстет identity
- D (sequential) — equivalent to current plan, no improvement

## Что нужно от Sergey

- [ ] Согласен с A (English opt-in only, не в onboarding default selection)?
- [ ] Если да — обновить onboarding `STACKS` array (drop `english` option)?
- [ ] Если нет — какой угол?
- [ ] Долгосрочно: split English в standalone product когда will scale (24-month horizon)?
