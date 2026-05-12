# Decision: BYOK как primary monetization (vs escape)?

**Status:** open · awaiting Sergey decision
**Created:** 2026-05-12 (brainstorm follow-up)
**Trigger:** Текущая freemium-модель имеет cascade fragility. BYOK предлагает cleaner alternative.

## Контекст

Текущая модель ([feedback_monetization.md](../../../.claude/projects/-Users-sedorofeevd-Desktop-druzya/memory/feedback_monetization.md)):
- **Free:** AI-coach unlimited, Atlas full, Hone basic, Cue 20 calls/day
- **Pro 990₽/mo:** Unlimited AI-mock, deep analytics, premium personas, unlimited Cue LLM
- **BYOK escape:** User API key → Pro features unlock free

LLM cascade order: `groq → cerebras → google → cloudflare → zai → mistral → openrouter → deepseek → ollama`. Все free-tier providers.

Brainstorm-doc 2026-05-12 risk: **cascade fragility = product-wide single point of failure**. Если top-3 fail одновременно (rate-limit / abuse / TOS-change в free tier — это случается), Cue / Hone Coach / Web mock все умирают сразу.

## Опции

### A. Status quo: BYOK как escape, freemium primary
**Action:** Сохранить текущую модель. Pro 990₽/mo, BYOK для tech audience escape hatch.

**Плюсы:**
- Уже sized — pricing infra in design (Stripe webhook ready, migration 00100)
- Freemium = familiar UX для consumer market
- Pro tier понятен (subscription → unlock features)

**Минусы:**
- Cascade fragility не решена. Free users continue ride free LLMs → outage = global degradation
- Primary monetization (Pro) tied к paid LLM infrastructure → если cost > revenue per user, model breaks
- 990₽/mo tier для русского рынка price point validation требует. Прямые конкуренты (Skyeng) charge ~5-10x

**Риск:** Free user surge на ML / English Eng-cohort выкидывает quota daily, top providers banishment учетки. Domino effect.

### B. BYOK as primary, Pro as «managed cloud» add-on
**Action:** Pivot positioning. Default = «bring your own LLM key — free». Pro = «we manage cascade for you» 990₽/mo. Tech audience first; non-tech onboarded через Pro.

**Плюсы:**
- Cascade fragility solved для primary user — они на собственных keys, провайдер-агностик
- Tech audience pitch sharper: «$0/mo + your key» vs «$20/mo flat». Engineering audience этот pitch instantly понимает
- Pro tier даёт revenue от non-tech users — clearer value prop («don't worry about API keys»)
- BYOK users self-sustain — free tier outage не affects them

**Минусы:**
- Onboarding friction: BYOK requires Anthropic / OpenAI / Groq account creation. Non-trivial для junior devs
- Brand association с paid providers — но мы используем cascade, юзер тоже может через cascade с his keys
- Pro pricing должен оправдать cost (managed cascade = ~$5-10/mo cost, charging $20 = thin margins)

**Риск:** Tech audience small. BYOK pitch не resonate с casual users. Free tier (no key) станет required для acquisition → back к cascade fragility.

### C. Hybrid: BYOK для Pro features, Free still cascade-based
**Action:** BYOK не replaces Pro — он unlocks Pro features without paying. Юзер chooses: pay 990₽ ИЛИ provide own key. Free continues cascade.

**Плюсы:**
- Tech-friendly escape (current model already this)
- Free tier accessibility сохранена
- Pro tier multi-modal (paid OR keys)

**Минусы:**
- Equivalent to status quo. No fundamental change.

### D. Tier-by-feature BYOK
**Action:** Specific features (AI-mock evaluator, Cue suggestions) BYOK-required even на Pro. Hone Coach / brief / curation continue to use cascade. BYOK opens compute-intensive surfaces.

**Плюсы:**
- Surface-specific cost control
- Free tier full cocach experience preserved
- Heavy compute (mock 5-stage) tied к user-paid infra

**Минусы:**
- Confusing pricing matrix («can I use AI-mock free?» → «sometimes»)
- BYOK setup для multiple providers (different feature different model) — UX nightmare
- Cascade fragility partially solved (only heavy features bypass)

## Recommendation

**B** — BYOK as primary, Pro as managed alternative. Reasoning:

1. **Sergey's audience = tech (senior IT prep).** BYOK pitch resonates с their mental model. They уже have OpenAI / Anthropic accounts.
2. **Cascade fragility = real risk.** Free tier providers periodically tighten / shutdown / TOS-change. Solo-founder cannot babysit cascade indefinitely.
3. **Pro tier becomes simpler.** «We manage your cascade routing — pay $X for not-thinking-about-it» is clear value prop для non-tech users.
4. **Honest cost economics.** BYOK transparently shifts compute cost к юзеру. No hidden subsidy from heavy users to light users.
5. **Free OSS image.** «BYOK + open source» позиционирование = authenticity для developer audience. Easier organic growth via GitHub.

**Implementation suggestion:**
- Onboarding step 4 (already added 2026-05-12) modify: instead of «free vs pro», shows «BYOK vs Pro managed» с clearer value prop
- BYOK setup wizard в Settings (paste key → test → save in keychain). Already partial via vault infra
- Pro tier pricing rethink — может быть lower (590₽/mo «managed cascade» less than $20)

**Что НЕ recommend:**
- A (status quo) — does не solve fragility
- D (per-feature BYOK) — confusing UX

## Что нужно от Sergey

- [ ] Согласен ли positioning shift к BYOK-first?
- [ ] Если да — какие providers поддерживать первыми (Anthropic / OpenAI / Groq / open route Mistral)?
- [ ] Pro pricing — оставить 990₽/mo или снизить когда BYOK = primary? 
- [ ] BYOK setup UX — wizard, или просто Settings paste field?
- [ ] Долгосрочно: open-source release для credibility?
