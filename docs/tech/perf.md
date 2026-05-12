# perf.md — Performance baseline + recommendations

Live as of 2026-05-12 (Phase I launch readiness). Focused on web frontend; Hone/Cue Electron desktop have separate perf profiles (native renderer, no network round-trip on most surfaces).

## Capture pipeline

- `frontend/src/lib/perfMetrics.ts` — Core Web Vitals (LCP / INP / CLS / TTFB) via native `PerformanceObserver` (no `web-vitals` npm dep — same primitives, zero install).
- Mounted in `frontend/src/main.tsx` via `startCWV()` before App render.
- **Dev:** `console.debug('[CWV]', metric)` — open DevTools console, see metrics fire on page hide.
- **Prod:** `navigator.sendBeacon('/api/v1/telemetry/cwv', body)` — silent on failure; backend endpoint stub OK.

Metric thresholds (CWV 2025-04 guidance):

| Metric | Good | Needs-improvement | Poor |
|---|---|---|---|
| LCP | ≤ 2.5s | ≤ 4s | > 4s |
| INP | ≤ 200ms | ≤ 500ms | > 500ms |
| CLS | ≤ 0.1 | ≤ 0.25 | > 0.25 |
| TTFB | ≤ 800ms | ≤ 1.8s | > 1.8s |

## Hot-path audit (2026-05-12)

### `/today` — landing for authed user

- **Stack:** Hero + ProactiveInsightsBanner + GoalReadinessCard + DailyPlanCard + MilestonesCard + WeeklySnapshotCard + TrajectoryCard + ActivityFeed + CueSessionsSection + 2x2 grid of mini-cards (Mock / CoachInsight / DailyBrief / AtlasWeakSpots).
- **Findings:**
  - 9 cards stack vertically; only first 2-3 visible above fold on 1440x900.
  - Each card lazy-loads its own RPC query (no waterfall — TanStack Query fires в parallel).
  - All cards have ErrorBoundary fallback → degraded mode keeps page mounted.
  - No memoization issues; cards are pure components, props stable.
- **Recommendation:**
  - **DEFER** below-fold lazy-load (TrajectoryCard / WeeklySnapshot / CueSessionsSection) → measure first; if TTI < 2s on real prod, не fix.
  - If LCP > 2.5s in prod telemetry: virtualize 2x2 mini-card grid via `content-visibility: auto`. Single-line CSS, no JS.

### `/codex` — articles list

- **Size:** 485 LOC, useMemo'd filtering + sorting on `articles` array.
- **Article count:** mocked < 50 in MSW; prod ~100-200 expected.
- **Recommendation:** **SKIP virtualization** at this size (react-window would add bundle bloat without measurable gain for < 200 items). Re-check if articles cross 500 items.

### `/atlas/explore` — skill atlas canvas

- **Size:** 539 LOC, custom canvas / SVG render of node graph.
- **Findings:** canvas re-renders on filter change (no DOM thrash — SVG-native diff).
- **Recommendation:** **DEFER** until prod telemetry shows LCP > 3s. If yes — switch to `<canvas>` raster (lose CSS hover, gain 10x render speed).

### `/mock/pipeline/:id` — multi-stage interview

- **Findings:** stages lazy-loaded via React.lazy; each stage owns its own RPC. Editor monaco chunk (~2.5MB) loads только when user reaches CodingStage. Good.

## Bundle audit

| Heavy dep | Size | Status |
|---|---|---|
| `@monaco-editor/react` | ~2.5MB | Lazy-loaded only on `/mock/pipeline/:id` coding stage |
| `@excalidraw/excalidraw` | ~1.2MB | Lazy-loaded only on `/whiteboard/:id` |
| `recharts` | ~400KB | Used on `/insights` + `/profile/weekly` — acceptable |
| `framer-motion` | ~120KB | Shipped everywhere — acceptable (motion-presets, prefers-reduced-motion respected) |
| `@sentry/react` | ~80KB | Dynamic import — chunk loads only when `VITE_SENTRY_DSN` set |

**No actions needed** — code-splitting already aggressive (React.lazy on every route in App.tsx).

## What Sergey should do

1. **Smoke run prod build** + open DevTools console → verify `[CWV]` lines appear on visibilitychange.
2. **Backend stub `/api/v1/telemetry/cwv`** — if it doesn't exist yet, returns 404; sendBeacon silently drops. Acceptable for now. If you want metrics aggregation: add a column in `clickhouse.web_metrics` and a thin POST handler in `services/telemetry/`.
3. **After 1 week of prod traffic:** check p75 LCP / INP / CLS in your ClickHouse dashboard. If LCP > 2.5s on `/today` → kick TrajectoryCard / WeeklySnapshotCard below-fold via `loading="lazy"` IntersectionObserver pattern.

## Deferred (low priority)

- [ ] Lighthouse CI in GitHub Actions on PR (cost: minor; gain: catch regressions). Add post-launch when telemetry baseline is set.
- [ ] Bundle visualizer (`vite-bundle-visualizer`) on every build — defer, current code-splitting clean enough.
- [ ] Server-timing headers for backend RPC latency — backend ticket, see `docs/tech/observability.md`.
