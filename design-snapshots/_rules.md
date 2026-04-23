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

_Last updated: Wave-9 (28 апр 2026) после Claude Design review (17 diffs + cheat-sheet)._
