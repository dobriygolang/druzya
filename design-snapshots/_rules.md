# druz9 — design rules cheat-sheet

> Source-of-truth for spacing, type-scale, color semantics, badges и градиентов.
> Curated после Wave-9 design review с Claude Design (см. `Design Review.html`).
> Любая новая страница / снапшот / .pen — должны соответствовать этим правилам.

---

## 🎨 Цвет — семантика

| Token       | Когда используем                                                |
|-------------|-----------------------------------------------------------------|
| `accent`    | Primary CTA · «ты сейчас здесь» · progress bar · selected radio |
| `pink`      | AI / Coach / insight / premium-feature label (НЕ border-карточки) |
| `warn`      | Streak · дедлайн · gold-tier · billing-premium · «сегодня в heat-grid» (но в новых местах используй `accent` как «сейчас») |
| `success`   | W (победа) · +ELO · ✓ · strong section · `● active`             |
| `danger`    | L · leave · delete · failing section · опасная зона             |
| `cyan`      | Neutral highlight · system-design skill · «в процессе»          |

**Не использовать:**
- `border-pink/40` на крупных карточках. Pink — только у label/eyebrow/badge внутри.
- `gradient warn→danger` на progress-bar при «нормальном заполнении» (это лжёт — выглядит как тревога). Use `accent→cyan` или solid `accent`. `warn→danger` — только когда реальная проблема (≥95% от cap).

---

## 📐 Spacing rhythm

| Контекст                       | Token                  |
|--------------------------------|------------------------|
| Card · hero / main             | `p-6`                  |
| Card · secondary / list block  | `p-5`                  |
| Row / dense list item          | `px-3 py-2` or `py-2.5`|
| Grid между карточками          | `gap-5`                |
| Items внутри списка            | `space-y-2` / `space-y-2.5` |
| Inline chips / badge chain     | `gap-2`                |
| Section break (top)            | `mt-12 pt-8 border-t`  |
| Page horizontal padding        | `px-4 sm:px-8 lg:px-20` (with `max-w-7xl mx-auto`) |

---

## 🔠 Type scale

| Slot              | Class                                   |
|-------------------|-----------------------------------------|
| Page H1           | `font-display text-3xl lg:text-[40px] font-bold leading-[1.1]` |
| Section H2        | `font-display text-2xl font-bold`      |
| Card H3           | `font-display text-lg font-bold`       |
| Eyebrow / kicker  | `font-mono text-[11px] uppercase tracking-wider text-text-muted` |
| BIG metric        | `font-display text-5xl font-extrabold leading-none` |
| Small metric      | `font-display text-2xl font-extrabold` |
| Body              | `text-sm text-text-secondary` (or `text-[13px]` in cards) |
| Mono caption      | `font-mono text-[10px]` / `text-[11px]` |

---

## 🏷 Badge / pill — **3 канона, не больше**

> Если нужен 4-й тип — ты сворачиваешь не туда. Вернись к этим трём.

```html
<!-- 1. TAG · meta-source / category — rounded -->
<span class="rounded bg-warn/20 text-warn px-1.5 py-0.5 text-[10px] font-mono font-semibold">HH</span>

<!-- 2. STATUS PILL · live state — rounded-full -->
<span class="rounded-full bg-success/20 px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-success">● active</span>

<!-- 3. CHIP · role / tier — rounded-md -->
<span class="rounded-md bg-accent/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent-hover">ТЫ УЧАСТНИК</span>
```

---

## 👤 Avatar — 5 канонических градиентов

Use `gradientForUser(username)` from `frontend/src/lib/avatarGradients.ts`. Bucket = `hash(username) % 5`. Гарантирует, что один и тот же `@username` всегда рендерится одним градиентом по всему продукту.

| idx | Gradient            | Hex                        |
|-----|---------------------|----------------------------|
| 0   | pink → accent       | `#F472B6 → #582CFF`        |
| 1   | cyan → accent       | `#22D3EE → #582CFF`        |
| 2   | warn → danger       | `#FBBF24 → #EF4444`        |
| 3   | success → cyan      | `#10B981 → #22D3EE`        |
| 4   | warn → pink         | `#FBBF24 → #F472B6`        |

**Не делать** ad-hoc `style="background: linear-gradient(...)"` в каждой странице. Только через утилиту.

---

## 🌈 Hero gradient (на одно слово H1)

| Раздел                 | Recipe              |
|------------------------|---------------------|
| Продуктовый default    | `from-accent to-cyan` |
| AI / контент / эмоции  | `from-pink to-cyan`   |

Sanctum «Дмитрий», cohorts «druz9», profile name → accent→cyan. Podcasts «интервью», weekly «отчёт» → pink→cyan (pink-якорь стоит слева и подсвечивает следующее слово).

---

## 🔘 Radio-row vs card-grid

- **card-grid** (2–4 шт., визуальные варианты): тема (Авто/Тёмная/Светлая), язык, шаблон. Используй `<OptionCard>`.
- **radio-row** (4–20 шт., текст + метаданные): AI модели, языки транскрипта, timezone. Используй `<AIModelRow>` (см. `frontend/src/components/AIModelRow.tsx`).

**Правило:** не миксовать в одной секции. И не использовать обе для одной природы выбора.

---

## 📝 Form input

Use `<FormField>` from `frontend/src/components/FormField.tsx`. Все поля одной формы должны иметь одинаковый shape — даже если `prefix` отсутствует. Это решает проблему «Username с `@`-slot выглядит сложнее остальных».

```tsx
<FormField label="Username"     defaultValue="dmitry.s"     prefix="@" />
<FormField label="Display name" defaultValue="Дмитрий С."              />
<FormField label="Email"        defaultValue="..."                      />
<FormField label="Город"        defaultValue="Алматы"                  />
```

---

## 🚫 Anti-patterns (не предлагать никогда)

- **Light theme как primary** — мы dark-first.
- **Glassmorphism** — мы flat + subtle gradients only.
- **Cute SaaS-onboarding иллюстрации** — мы esports / analytics.
- **Замена Geist/Inter** на «более тёплый» шрифт — брендовое.
- **Emoji в navigation** — emoji живёт в *контенте* (ачивки, эпизоды), не в nav. В nav — Lucide stroke-icons.
- **`opacity-50` как «locked» state** — нужен полноценный stateful UI: lock-icon вместо radio + tooltip + hover-tint.

---

## ✓ Что уже хорошо — НЕ трогать

- **Page header pattern**: mono-eyebrow uppercase + gradient-slice на одном слове H1 + серый subline. Это сильнейшая editorial-rhythm вещь продукта.
- **Strong vs Weak sections** в weekly: side-by-side scoreboard с одинаковой грамматикой (label-left, mono-% справа, h-1.5 fill).
- **Gradient cover art с «9»-моногра́ммой** в podcasts: 3-color mesh `pink→accent→cyan`. Будущий hero-asset бренда.
- **Auto-save hint** «сохранено · 2 мин назад» в правом верхнем углу секции — rare и приятный штрих.

---

## 📦 Component library (shared)

| Component           | Файл                                         | Когда                   |
|---------------------|----------------------------------------------|-------------------------|
| `<Card>`            | `frontend/src/components/Card.tsx`           | Любой островок UI       |
| `<Button>`          | `frontend/src/components/Button.tsx`         | CTA / actions           |
| `<FormField>`       | `frontend/src/components/FormField.tsx`      | Любой labelled input    |
| `<AIModelRow>`      | `frontend/src/components/AIModelRow.tsx`     | Radio-row pattern       |
| `gradientForUser()` | `frontend/src/lib/avatarGradients.ts`        | Любой avatar fill       |
| `humanize*`         | `frontend/src/lib/labels.ts`                 | Proto enum → RU label   |

---

## 📐 Breakpoints (Wave-10 append from Design Review v2)

Эти правила **дополняют** базовые spacing/type-scale; они не переопределяют десктопные токены, а дают коэффициенты «при смене брейкпоинта».

### Padding ladder

| Контекст           | desktop → tablet → mobile (320) |
|--------------------|---------------------------------|
| Hero card          | `p-6` → `p-5` → `p-4`           |
| Secondary card     | `p-5` → `p-4` → `p-3`           |
| Row item           | `py-2.5` → `py-2` → `py-1.5`    |
| Page container     | `px-20` → `px-8` → `px-4`       |

Tailwind читается справа налево: `lg:p-6 sm:p-5 p-4` = «mobile → tablet → desktop».

### Type-scale ladder

| Slot           | desktop → tablet → mobile |
|----------------|---------------------------|
| H1 page        | 40 → 28 → 22              |
| H2 section     | 24 → 20 → 17              |
| Card title     | 18 → 15 → 13              |
| BIG metric     | 48 → 32 → 28              |
| Body           | 14 → 13 → 12              |
| Eyebrow / mono | 11 → 10 → 9               |

**Mono 9px — минимум.** Никогда 8 и меньше.

### Grid/gap ladder

| Контекст       | Token                                  |
|----------------|----------------------------------------|
| Between cards  | `gap-5` → `gap-4` → `gap-3`            |
| Inside list    | `space-y-2.5` → `space-y-2` → `space-y-1.5` |
| Chips          | `gap-2` (constant)                     |

### Touch targets (320)

- Минимум tap-target: **44×44**.
- CTA button: `h-10` (40) — на грани, предпочитай `py-2.5` + полноширина.
- Sticky bottom bar: `min-h-12` + `safe-area-inset-bottom` (iOS).

### 3 паттерна схлопывания (выбирать ОДИН на секцию)

| Паттерн                | Когда                                  |
|------------------------|----------------------------------------|
| **Segment control**    | 3+ родственных секции (Strong/Weak/All) — экономит вертикаль, сохраняет доступ |
| **Horizontal scroll**  | 5+ элементов одного типа (avatars, chapters, cards) — всегда с `fade-b` справа |
| **Progressive disclosure** | Accordion / "показать все" — KPI 3+4, длинный список членов когорты |

### Header adaptation per breakpoint

| Breakpoint | Composition                                                          |
|------------|----------------------------------------------------------------------|
| 1920 desktop | logo + 6-nav + search + lang + avatar. Full H1 + 72px bar           |
| 768 tablet | logo + 3-nav + ⋯-more + avatar. Search → icon-only. Lang скрыт      |
| 320 phone  | logo (small) + section-title + search-icon + avatar. Nav → hamburger + slide-over (или, для главных секций — bottom-nav, см. mobile-nav гайд) |

---

## 🌌 Atlas — PoE-passive-tree grammar (Wave-10, design-review v2 P0)

### Vocabulary

| Token       | Meaning                                                       |
|-------------|---------------------------------------------------------------|
| **hub**     | Character class / focus. 1 per atlas. Always reachable. Big violet circle 88px. See `<AtlasHub />` |
| **keystone**| Cluster signature, "сигнатурная перка". 1 per cluster. Diamond shape 18px. See `<AtlasKeystone />` |
| **notable** | Cluster milestone (3-5 per cluster). Sigil-framed circle 14px. |
| **small**   | Incremental drill nodes (the bulk). Simple disk 8px.          |
| **cluster** | Designer-grouped dense gathering. Renders cluster aura behind. |

### Edge grammar — **3 канона, не больше**

| Kind         | Visual                                | Semantic                       |
|--------------|---------------------------------------|--------------------------------|
| `prereq`     | Solid 2px + arrow. Bright when both endpoints mastered (allocated path) | Gates allocation               |
| `suggested`  | Solid 1px cyan, no arrow              | Logical next step              |
| `crosslink`  | Dashed 1px faded grey                 | Related from another cluster   |

### Node states (orthogonal to kind)

- `mastered` — solid cluster-color fill + white ✓
- `active` — solid fill at /85 alpha
- `decaying` — pulsing warn ring around (kind-glyph inside untouched)
- `not_started` — hollow with cluster-color stroke
- `locked` — hollow with dashed bg-2 stroke + lock-glyph **(NEVER opacity-50)**

### Hover vs select — different visual channels

- Hover → `transform: scale(1.15)` (CSS transition)
- Selected → `outline 3px accent + offset 3px` (ring channel)

They never fight. **Don't use `transform` for selection** — it conflicts with hover.

### Layout

- Designer pins `pos_x/pos_y` in admin CMS (kept hand-tuned because clusters are organic blobs, not 72° sectors).
- Fallback when unpinned: ring-by-kind around hub (see `frontend/src/components/atlas/layout.ts::layoutAtlas`).
- ViewBox: 1400×1400.

### Mobile

- 320px ⇒ NO canvas. Use `<AtlasMobileRoadmap />` (vertical stack of cluster-sections).
- "↗ Полная карта" button opens canvas in fullscreen modal with native pinch-zoom (only for users who really want it).

### Empty state — onboarding beacon

- 0 mastered nodes → 3 hub-adjacent `prereq` neighbours pulse with accent ring (`<animate>` r/opacity).
- "Начни здесь ↓" caption under hub.
- **Don't dim the rest of the graph with opacity-50** — they're future state, not unreachable.

---

_Last updated: Wave-10 (29 апр 2026) после Claude Design review v2 (Atlas + Responsive)._
