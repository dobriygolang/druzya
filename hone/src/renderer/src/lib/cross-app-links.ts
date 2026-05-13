// cross-app-links — deep-link helpers для перехода из Hone в web (druz9.online)
// и Cue. Hone — desktop focus cockpit; serious mock practice / curriculum
// browsing / live interview copilot живут в других surfaces.
//
//   - Hone  = тихая ежедневная работа (этот процесс)
//   - Web   = практика, мок-собеседования, atlas — druz9.online
//   - Cue   = live interview/meeting stealth copilot — отдельный desktop
//
// Helpers здесь — единственный entry point для cross-app navigation. Это
// важно: query params (`?source=hone`, `?stage=...`, `?track=...`) служат
// attribution-сигналом для backend analytics. Если кто-то откроет URL
// руками без helper'а — мы потеряем источник.
//
// shell.openExternal — через preload bridge (см. shared/ipc.ts). В Electron
// renderer'е прямые window.open() / location.href блокируются — это
// security-feature чтобы untrusted ссылки не открывались в-process.

import { WEB_BASE_URL } from '../api/config';

/** Base URL для web druz9 — `https://druz9.online` в prod, `http://localhost:5173` в dev. */
export const druz9WebURL = WEB_BASE_URL;

/** Source tag для attribution — backend записывает откуда пришёл юзер. */
const SOURCE_TAG = 'hone';

function buildURL(path: string, params?: Record<string, string | undefined>): string {
  const url = new URL(path, druz9WebURL);
  url.searchParams.set('source', SOURCE_TAG);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'string' && v.length > 0) url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

function openExternal(url: string): void {
  const bridge = typeof window !== 'undefined' ? window.hone : undefined;
  if (bridge?.shell) {
    void bridge.shell.openExternal(url).catch(() => {
      /* swallow — pop-up blocker / shell отказался; не fatal */
    });
    return;
  }
  // Fallback для non-Electron контекста (tests / SSR-prerender) — просто
  // открываем new tab. Production renderer всегда имеет bridge.
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Открыть web AI-mock pipeline. opts позволяют pre-select stage / track
 * (algo / sysd / behavioural / english) если уже знаем что юзер хочет.
 */
export function openWebMock(opts?: { stage?: string; track?: string }): void {
  openExternal(buildURL('/mock', { stage: opts?.stage, track: opts?.track }));
}

/**
 * Открыть Skill Atlas — главная curriculum/graph surface в web. `nodeId`
 * фокусирует на конкретный topic node при загрузке.
 */
export function openWebAtlas(opts?: { nodeId?: string }): void {
  openExternal(buildURL('/atlas', { focus: opts?.nodeId }));
}

/**
 * Открыть AI-coach chat в web. У web и Hone разные coach surfaces:
 * web — full chat thread, Hone — single next-action card.
 */
export function openWebCoach(): void {
  openExternal(buildURL('/coach'));
}

/**
 * Открыть web Codex (curated resource library с opinion). Hone имеет
 * только in-place Atlas tasks; deep curation browsing — web feature.
 */
export function openWebCodex(): void {
  openExternal(buildURL('/codex'));
}

/**
 * Открыть Whiteboard для collaborative drawing. D4 (2026-05-12) перенёс
 * SharedBoards из Hone в web; Hone hotkey B уже использует этот helper
 * pattern.
 */
export function openWebWhiteboard(opts?: { roomId?: string }): void {
  const path = opts?.roomId ? `/whiteboard/${opts.roomId}` : '/whiteboard/new';
  openExternal(buildURL(path));
}

/**
 * Открыть web code Editor — code rooms / shared code sessions.
 */
export function openWebEditor(opts?: { roomId?: string }): void {
  const path = opts?.roomId ? `/editor/${opts.roomId}` : '/editor/new';
  openExternal(buildURL(path));
}

/**
 * Открыть Cue download / install page. Если у юзера ещё нет Cue desktop
 * app — он попадёт сюда из identity intro / Settings ecosystem section.
 */
export function openCueInstall(): void {
  openExternal(buildURL('/cue/download'));
}

/**
 * Открыть druz9 web root — общий «open druz9.online» action для
 * Settings ecosystem card.
 */
export function openDruz9Web(): void {
  openExternal(buildURL('/'));
}

// Bidirectional handoff — Hone → web for surfaces that Hone deliberately
// doesn't host:
//   • web /mock pipeline stage continuation (когда юзер finished focus в
//     Hone на pinned mock-stage и хочет вернуться к full pipeline)
//   • web /profile/memory — central «what AI remembers about me» surface
//     (Hone Settings → Memory тоже доступен но web has fuller view)
//   • web /insights — Insight stream timeline
//   • web /atlas struggle context — направление юзера в Atlas с focus
//     на конкретный struggle node после reflection

/**
 * Открыть web Mock pipeline на конкретном stage'е. Используется в Hone
 * Coach когда AI-action mentions mock + Hone знает active mock pipeline.
 */
export function openWebMockStage(opts: { pipelineId?: string; stage?: string; track?: string }): void {
  openExternal(
    buildURL('/mock', {
      pipeline: opts.pipelineId,
      stage: opts.stage,
      track: opts.track,
    }),
  );
}

/**
 * Открыть web /profile/memory — full memory timeline surface. Hone имеет
 * mini-version в Settings → Memory, но full edit + bulk operations живут
 * в web (mobile/larger screen чтобы scroll'ить дольше).
 */
export function openWebProfileMemory(): void {
  openExternal(buildURL('/profile/memory'));
}

/**
 * Открыть web Insights stream. Hone показывает 3 insight chip'а на Coach;
 * full timeline + filter по surface — на web /insights.
 */
export function openWebInsights(opts?: { surface?: string }): void {
  openExternal(buildURL('/insights', { surface: opts?.surface }));
}

/**
 * Открыть web Atlas с focus на конкретный struggle node. Используется
 * после Hone reflection с low grade — юзер кликает «review on Atlas →»
 * чтобы посмотреть curated resources для своего stuck topic'а.
 */
export function openWebAtlasStruggle(nodeId: string): void {
  openExternal(buildURL('/atlas/explore', { focus: nodeId, highlight: 'struggle' }));
}

/**
 * Открыть web Settings/Billing — Hone имеет тонкий Subscriptions tab,
 * full upgrade flow живёт на web (Stripe Checkout не работает в Electron
 * webview без extra config'а).
 */
export function openWebBilling(): void {
  openExternal(buildURL('/settings/billing'));
}
