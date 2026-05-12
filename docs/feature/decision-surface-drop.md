# Decision: какой surface дроп? (web vs hone vs cue)

**Status:** open · awaiting Sergey decision
**Created:** 2026-05-12 (brainstorm follow-up)
**Trigger:** 3 surfaces × solo founder × 26-week roadmap = math не сходится. Каждый surface заслуживает full team в comparable startup.

## Контекст

Brainstorm-doc 2026-05-12 ([happy-twirling-parrot.md](../../../.claude/plans/happy-twirling-parrot.md)) подсветил: roadmap A→I расходует ресурс одинаково на web / Hone / Cue, что = квазиравномерно underinvest. Нужно решить **что дроп**, не **если**.

## Опции

### A. Drop web как product, оставить landing-only
**Action:** Удалить из web всё кроме `/welcome` (landing) + `/atlas` (curation reads, public). Перенести Coach / AI-tutor / AI-mock / Codex в Hone (uniform desktop experience).

**Плюсы:**
- Hone становится единым cockpit'ом — mental model unified
- 30-40% времени free'тся на углубление Hone (event tracking gives data, можно итерировать)
- Atlas остаётся web-доступным для discovery (SEO + share)
- Web bundle становится крошечным → instant load

**Минусы:**
- AI-mock 5-axis radar лучше работает на large screen — pushing в Hone (на 13" laptop) constrains UX
- Tutor toolkit (interview prep marketplace adjacent) теряет web-shareability
- Migration cost — fronend `/codex`, `/mock-session`, `/profile`, `/insights` already shipped и rendered в web

**Риск:** Web уже main entry-point по Yandex search ranking. Drop web = drop user acquisition channel.

### B. Drop Cue как separate product, integrate в Hone
**Action:** Cue features (stealth windows, voice transcript, suggestions) интегрировать в Hone опционально через Settings toggle. Один installer.

**Плюсы:**
- Один desktop binary вместо двух
- Stealth tech уже macOS-only — Hone тоже macOS — lower deployment overhead
- Coach unification становится trivial — оба runner живут в одном process

**Минусы:**
- Cue's value prop = «всегда сверху, всегда невидимое» — tied to compact floating window. Hone — full-screen cockpit. UX models incompatible.
- Stealth = liability surface. Если Hone имеет stealth toggle → Hone становится «cheating tool» по PR perception
- Phase F (Cue masquerade tech) уже в roadmap — drop = sunk cost

**Риск:** Cue это самая uniqe technology в твоем stack. Drop = lose differentiator.

### C. Drop одного из 3 треков (Go/ML/English), focus 1
**Action:** Не surface-drop, а audience-drop. English (или ML) → отдельный продукт или «later». Сохраняем 3 surfaces, но они serve narrow audience.

**Плюсы:**
- Reduce content depth requirement (1 трек × 3 surface < 3 трека × 3 surface)
- English audience структурно разная (B1→B2 students vs senior IT) — sell отдельно даёт price discrimination
- Curation-proxy model легче для одного skillset

**Минусы:**
- English module уже built (Reading/Writing/Listening/Vocab SRS) — sunk cost
- Identity «multi-track AI-coach» = differentiator vs Skyeng (English-only) и LeetCode (algo-only)
- Drop English может оттолкнуть current users которые именно за English пришли

**Риск:** Если Sergey сам в core audience (готовится к senior IT role с English component), drop English = drop personal use case → motivation drop.

### D. Не дропать ничего, sequential delivery
**Action:** Roadmap A→I сохраняется, но redistribute weeks: Phase B-D → Hone-only deep work. Phase E-G → mock + Atlas + Cue. Phase H → web subscription. Strict ordering.

**Плюсы:**
- Сохраняет 3-product positioning (важно для investor pitch если есть)
- Не drops sunk cost
- Каждый surface получает focused window (3-month sprint depth)

**Минусы:**
- 26 weeks предполагает sequential delivery work — но 3 surfaces всё ещё нуждаются в maintenance, bugfixes, dep updates параллельно
- «3 sprints одного продукта» это still 3 products' overhead
- Math не лучше — просто distributed по времени

**Риск:** Underestimate maintenance burden. Phase B (Hone deep) won't be 100% Hone — Cue/web bug могут tear focus.

## Recommendation

**B** — drop Cue с предупреждением. Reasoning:

1. **Cue stealth = liability.** Brainstorm уже identified «Cluely-clone» PR risk. Honest positioning rewrite (done — 2026-05-12) softens но не устраняет.
2. **Stealth tech valuable only для interview cheating use case.** Other use cases (open-plan office, meeting transcript) не require stealth — обычное app достаточно.
3. **Cue 6-month roadmap requires significant effort** (Windows WASAPI, masquerade, audio reconnect resilience, suggestion quality)
4. **Hone уже has compact mode mockup capability** — basic «coach pill» surface достижим без Cue's full architecture
5. **Drop frees 30% time для Hone+web depth** где investment compounds (memory-as-UX shipped, telemetry shipped — нужно итерировать)

**Альтернатива если B неприемлем:** A (drop web как product). Migration cost высокий но identity «Hone = единый desktop cockpit» становится cleaner.

**НЕ recommend:** D (всё как есть). Math не сходится — это будет mediocre everything.

## Что нужно от Sergey

- [ ] Какая опция (A / B / C / D / другая)?
- [ ] Если B — приемлемая timeline для Cue sunset (announce → 30d → freeze)?
- [ ] Если A — готов перенести AI-mock в Hone (impact: 13" laptop UX)?
- [ ] Если drop — что делать с current users того surface'а?
