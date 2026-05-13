// api/intelligence.ts — typed wrappers around IntelligenceService.
//
// Two RPCs:
//   getDailyBrief(force?) — returns the (cached or freshly synthesised)
//                           morning brief. force=true rate-limited 1/h
//                           backend-side.
//   askNotes(question)    — RAG over the user's notes corpus with
//                           citation parsing.
import { createPromiseClient } from '@connectrpc/connect';
import { Timestamp } from '@bufbuild/protobuf';
import { IntelligenceService } from '@generated/pb/druz9/v1/intelligence_connect';
import { BriefRecommendationKind, InsightSeverity } from '@generated/pb/druz9/v1/intelligence_pb';

import { API_BASE_URL, DEV_BEARER_TOKEN } from './config';
import { useSessionStore } from '../stores/session';
import { transport } from './transport';

// ─── Domain-shaped POJOs ────────────────────────────────────────────────────

export type RecommendationKind = 'tiny_task' | 'schedule' | 'review_note' | 'unblock';

export interface Recommendation {
  kind: RecommendationKind;
  title: string;
  rationale: string;
  // targetId is opaque: note_id for "review_note", plan_item_id for
  // "unblock", empty otherwise.
  targetId: string;
}

// CoachSeverity — Phase 4.4 wire enum mirror.
export type CoachSeverity = 'cruise' | 'nudge' | 'warn' | 'critical';

export interface DailyBrief {
  briefId: string;
  headline: string;
  narrative: string;
  recommendations: Recommendation[];
  generatedAt: Date | null;
  severity: CoachSeverity;
  severityReason: string;
}

export interface MemoryStats {
  total30d: number;
  byKind: Record<string, number>;
}

// Mirrors proto MemoryEntry; source = 'hone' | 'cue' | 'mock' | 'coach'
// for grouping. importance reserved для будущей weighting (0 = unscored).
export interface MemoryEntry {
  id: string;
  kind: string;
  content: string;
  source: string;
  importance: number;
  occurredAt: Date | null;
  expiresAt: Date | null;
  editedAt: Date | null;
}

export interface Citation {
  noteId: string;
  title: string;
  snippet: string;
}

export interface AskAnswer {
  answerMd: string;
  citations: Citation[];
}

// ─── Internals ──────────────────────────────────────────────────────────────

const client = createPromiseClient(IntelligenceService, transport);

function protoTs(ts: { seconds: bigint; nanos: number } | undefined): Date | null {
  if (!ts) return null;
  const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
  return new Date(ms);
}

function unwrapKind(k: BriefRecommendationKind): RecommendationKind {
  switch (k) {
    case BriefRecommendationKind.TINY_TASK:
      return 'tiny_task';
    case BriefRecommendationKind.SCHEDULE:
      return 'schedule';
    case BriefRecommendationKind.REVIEW_NOTE:
      return 'review_note';
    case BriefRecommendationKind.UNBLOCK:
      return 'unblock';
    default:
      return 'tiny_task';
  }
}

function unwrapSeverity(s: InsightSeverity): CoachSeverity {
  switch (s) {
    case InsightSeverity.CRITICAL:
      return 'critical';
    case InsightSeverity.WARN:
      return 'warn';
    case InsightSeverity.NUDGE:
      return 'nudge';
    default:
      return 'cruise';
  }
}

// ─── Daily Brief ────────────────────────────────────────────────────────────

// In-flight dedup + 429-backoff: HomePage / DailyBriefPanel могут
// перерендерить mount/unmount подряд (React StrictMode dev / route flips
// / focus-listener'ы), и Connect-RPC начинает спамить getDailyBrief →
// backend rate-limit (429). Делаем idempotent на client-side:
//   - inflightBrief: Promise<DailyBrief> | null — параллельные вызовы
//     без force получают тот же promise.
//   - rateLimitedUntilMs: при 429-ответе блокируем new requests на 60s;
//     возвращаем sentinel-error который caller обработает (cache stays).
let inflightBrief: Promise<DailyBrief> | null = null;
let rateLimitedUntilMs = 0;
const DAILY_BRIEF_CACHE_PREFIX = 'hone:daily-brief:cache:';

export function invalidateDailyBriefCache(): void {
  inflightBrief = null;
  if (typeof window === 'undefined') return;
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(DAILY_BRIEF_CACHE_PREFIX)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    /* localStorage unavailable — cache invalidation is best-effort */
  }
}

export async function getDailyBrief(force = false): Promise<DailyBrief> {
  // Если backend рейтлимитнул — короткий cooldown без RPC, чтобы не
  // превратить page-flip в storm 429-ов.
  const now = Date.now();
  if (now < rateLimitedUntilMs) {
    throw new Error('intelligence.getDailyBrief: rate-limited (cooling down)');
  }
  // Dedup: одновременные mount'ы получают тот же in-flight promise.
  // force=true намеренно идёт мимо dedup'а — юзер явно нажал Refresh,
  // ждём свежий ответ.
  if (!force && inflightBrief) return inflightBrief;

  const p = (async () => {
    try {
      const resp = await client.getDailyBrief({ force });
      return {
        briefId: resp.briefId,
        headline: resp.headline,
        narrative: resp.narrative,
        recommendations: resp.recommendations.map((r) => ({
          kind: unwrapKind(r.kind),
          title: r.title,
          rationale: r.rationale,
          targetId: r.targetId,
        })),
        generatedAt: protoTs(resp.generatedAt as unknown as { seconds: bigint; nanos: number } | undefined),
        severity: unwrapSeverity(resp.severity),
        severityReason: resp.severityReason,
      };
    } catch (err) {
      // Connect-RPC мапит HTTP 429 в ResourceExhausted (Code=8). Если
      // backend сказал «too many» — выставляем 60s cooldown, чтобы
      // уменьшить нагрузку и дать backend'у успокоиться.
      const msg = (err as Error)?.message ?? '';
      if (/429|resource_exhausted|rate.?limit/i.test(msg)) {
        rateLimitedUntilMs = Date.now() + 60_000;
      }
      throw err;
    }
  })();

  if (!force) {
    inflightBrief = p;
    // Освобождаем in-flight после resolve/reject — следующий mount
    // попадёт в свежий call (нормальное поведение через ~100ms).
    void p.then(() => {
      if (inflightBrief === p) inflightBrief = null;
    }, () => {
      if (inflightBrief === p) inflightBrief = null;
    });
  }
  return p;
}

// ─── Memory feedback ────────────────────────────────────────────────────────

export async function ackRecommendation(briefId: string, index: number, followed: boolean): Promise<void> {
  if (!briefId) return; // Phase A briefs (без memory) — пропускаем
  await client.ackRecommendation({ briefId, index, followed });
}

export async function getMemoryStats(): Promise<MemoryStats> {
  const resp = await client.getMemoryStats({});
  const byKind: Record<string, number> = {};
  for (const [k, v] of Object.entries(resp.byKind ?? {})) {
    byKind[k] = Number(v);
  }
  return { total30d: resp.total30d, byKind };
}

export async function listMemoryEntries(
  args: { kind?: string; limit?: number; offset?: number } = {},
): Promise<{ items: MemoryEntry[]; total: number }> {
  const resp = await client.listMemoryEntries({
    kind: args.kind ?? '',
    limit: args.limit ?? 50,
    offset: args.offset ?? 0,
  });
  return {
    items: resp.items.map((e) => ({
      id: e.id,
      kind: e.kind,
      content: e.content,
      source: e.source,
      importance: e.importance,
      occurredAt: protoTs(e.occurredAt),
      expiresAt: protoTs(e.expiresAt),
      editedAt: protoTs(e.editedAt),
    })),
    total: resp.total,
  };
}

// deleteMemoryEntry — soft delete (юзер контролирует что AI помнит).
export async function deleteMemoryEntry(id: string): Promise<void> {
  await client.deleteMemoryEntry({ id });
}

// editMemoryEntry — юзер уточняет formulation entry'и (например, mock summary
// был сгенерирован LLM и нужна правка). Server валидирует content [1..2000].
export async function editMemoryEntry(id: string, content: string): Promise<void> {
  await client.editMemoryEntry({ id, content });
}

// ─── Ask Notes ──────────────────────────────────────────────────────────────

export async function askNotes(question: string): Promise<AskAnswer> {
  const resp = await client.askNotes({ question });
  return {
    answerMd: resp.answerMd,
    citations: resp.citations.map((c) => ({
      noteId: c.noteId,
      title: c.title,
      snippet: c.snippet,
    })),
  };
}

// ─── Recent briefs feed (Phase 5) ───────────────────────────────────────

export interface RecentBrief {
  briefId: string;
  headline: string;
  narrative: string;
  recommendations: Recommendation[];
  generatedAt: Date | null;
  severity: CoachSeverity;
  severityReason: string;
}

interface RecentBriefsWire {
  items: Array<{
    brief_id: string;
    headline: string;
    narrative: string;
    generated_at: string;
    severity: string;
    severity_reason: string;
    recommendations: Array<{
      kind: string;
      title: string;
      rationale: string;
      target_id?: string;
    }>;
  }>;
}

function severityFromString(s: string): CoachSeverity {
  const v = (s ?? '').toLowerCase();
  if (v.includes('critical')) return 'critical';
  if (v.includes('warn')) return 'warn';
  if (v.includes('nudge')) return 'nudge';
  return 'cruise';
}

function recKindFromString(s: string): RecommendationKind {
  switch (s) {
    case 'tiny_task':
    case 'schedule':
    case 'review_note':
    case 'unblock':
      return s;
    default:
      return 'tiny_task';
  }
}

// listRecentBriefs — Hone /coach feed source. Fetch /intelligence/briefs/
// recent?days=N с Bearer-токеном из sessionStore. Backend hard-cap'ит
// limit на 60; days clamped к [1,60] на сервере.
export async function listRecentBriefs(days = 30): Promise<RecentBrief[]> {
  const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const resp = await fetch(
      `${API_BASE_URL}/api/v1/intelligence/briefs/recent?days=${encodeURIComponent(String(days))}`,
      { headers },
    );
    if (!resp.ok) {
      // 401 / 5xx — feed не критичен, возвращаем пустой массив.
      return [];
    }
    const body = (await resp.json()) as RecentBriefsWire;
    return (body.items ?? []).map((b) => ({
      briefId: b.brief_id ?? '',
      headline: b.headline ?? '',
      narrative: b.narrative ?? '',
      generatedAt: b.generated_at ? new Date(b.generated_at) : null,
      severity: severityFromString(b.severity ?? ''),
      severityReason: b.severity_reason ?? '',
      recommendations: (b.recommendations ?? []).map((r) => ({
        kind: recKindFromString(r.kind),
        title: r.title ?? '',
        rationale: r.rationale ?? '',
        targetId: r.target_id ?? '',
      })),
    }));
  } catch {
    return [];
  }
}


export type ActionKind =
  | 'focus_block'
  | 'start_mock'
  | 'review_resource'
  | 'reflection'
  | 'checkpoint'
  | 'graduation_mock';

export interface NextAction {
  actionKind: ActionKind;
  target: string;
  rationale: string;
  estimatedMinutes: number;
}

export interface ForkBranchView {
  branch: string;
  mockCount: number;
  avgScore: number;
  voluntaryDeepDives: number;
  compositeScore: number;
}

export interface ForkSnapshot {
  mode: 'explore' | 'commit' | 'deep' | string;
  exploreWeekIndex: number;
  currentBranch: string;
  branches: ForkBranchView[];
  leanBranch: string;
  confidence: number;
}

export type ResourceLogKind =
  | 'clicked'
  | 'finished'
  | 'skipped'
  | 'unhelpful'
  | 'reflection_submitted';

export interface LogResourceArgs {
  resourceUrl: string;
  atlasNodeId?: string;
  kind: ResourceLogKind;
  reflectionText?: string;
}

export interface LogResourceResult {
  id: string;
  reflectionNoteId: string; // empty when no Note created
  noteCreateFailed: boolean;
}

// getNextAction — Coach hero «one daily action».
export async function getNextAction(force = false): Promise<NextAction> {
  const r = await client.getNextAction({ force });
  return {
    actionKind: (r.actionKind as ActionKind) || 'focus_block',
    target: r.target ?? '',
    rationale: r.rationale ?? '',
    estimatedMinutes: r.estimatedMinutes ?? 0,
  };
}

// getForkSnapshot — fork view (active when mode='explore').
export async function getForkSnapshot(): Promise<ForkSnapshot> {
  const r = await client.getForkSnapshot({});
  return {
    mode: r.mode ?? 'explore',
    exploreWeekIndex: r.exploreWeekIndex ?? 0,
    currentBranch: r.currentBranch ?? '',
    branches: (r.branches ?? []).map((b) => ({
      branch: b.branch ?? '',
      mockCount: b.mockCount ?? 0,
      avgScore: b.avgScore ?? 0,
      voluntaryDeepDives: b.voluntaryDeepDives ?? 0,
      compositeScore: b.compositeScore ?? 0,
    })),
    leanBranch: r.leanBranch ?? '',
    confidence: r.confidence ?? 0,
  };
}

// logResource — fire-and-forget event ingest. Возвращает id; reflection
// flow возвращает note_id если создана.
export async function logResource(args: LogResourceArgs): Promise<LogResourceResult> {
  const r = await client.logResource({
    resourceUrl: args.resourceUrl,
    atlasNodeId: args.atlasNodeId ?? '',
    kind: args.kind,
    reflectionText: args.reflectionText ?? '',
  });
  return {
    id: r.id ?? '',
    reflectionNoteId: r.reflectionNoteId ?? '',
    noteCreateFailed: r.noteCreateFailed ?? false,
  };
}

// ── Phase 2 mode persistence ────────────────────────────────────────────

export interface LearningStateView {
  mode: 'explore' | 'commit' | 'deep' | string;
  forkBranch: string; // '' if not chosen
  exploreWeekIndex: number;
  committedTrackId: string;
}

export async function setLearningMode(
  mode: 'explore' | 'commit' | 'deep',
  trackId?: string,
): Promise<LearningStateView> {
  const r = await client.setLearningMode({ mode, trackId: trackId ?? '' });
  return {
    mode: r.mode ?? 'explore',
    forkBranch: r.forkBranch ?? '',
    exploreWeekIndex: r.exploreWeekIndex ?? 0,
    committedTrackId: r.committedTrackId ?? '',
  };
}

export async function setForkBranch(branch: 'de' | 'mle' | 'none' | ''): Promise<LearningStateView> {
  const r = await client.setForkBranch({ branch });
  return {
    mode: r.mode ?? 'explore',
    forkBranch: r.forkBranch ?? '',
    exploreWeekIndex: r.exploreWeekIndex ?? 0,
    committedTrackId: r.committedTrackId ?? '',
  };
}

// ── Phase 2 finishers (resource trail + skill radar) ────────────────────

export type ResourceTouchKind =
  | 'clicked'
  | 'finished'
  | 'skipped'
  | 'unhelpful'
  | 'reflection_submitted'
  | string;

export interface ResourceTouch {
  url: string;
  atlasNodeId: string;
  kind: ResourceTouchKind;
  occurredAt: Date | null;
  hoursAgo: number;
  reflectionText: string;
}

export interface ResourceTrail {
  finishedRecent: ResourceTouch[];
  unfinishedCount: number;
  markedUnhelpful: ResourceTouch[];
  recentReflections: ResourceTouch[];
}

export async function getResourceTrail(days = 7, keepRecent = 5): Promise<ResourceTrail> {
  const r = await client.getResourceTrail({ days, keepRecent });
  const map = (t: typeof r.finishedRecent[number]): ResourceTouch => ({
    url: t.url ?? '',
    atlasNodeId: t.atlasNodeId ?? '',
    kind: t.kind ?? 'clicked',
    occurredAt: t.occurredAt ? t.occurredAt.toDate() : null,
    hoursAgo: t.hoursAgo ?? 0,
    reflectionText: t.reflectionText ?? '',
  });
  return {
    finishedRecent: (r.finishedRecent ?? []).map(map),
    unfinishedCount: r.unfinishedCount ?? 0,
    markedUnhelpful: (r.markedUnhelpful ?? []).map(map),
    recentReflections: (r.recentReflections ?? []).map(map),
  };
}

export type SkillRadarConfidence = 'empty' | 'low' | 'medium' | 'high';

export interface SkillRadarAxis {
  key: string;
  label: string;
  score: number; // 0..1
  mockCount: number;
  // confidence — derived from mockCount: 0 = empty, 1 = low, 2-3 = medium, 4+ = high.
  // UI uses this to render low-confidence axes with dashed outline / pill.
  confidence: SkillRadarConfidence;
}

export interface SkillRadar {
  rubric: string;
  axes: SkillRadarAxis[];
}

export async function getSkillRadar(rubric?: string): Promise<SkillRadar> {
  const r = await client.getSkillRadar({ rubric: rubric ?? '' });
  return {
    rubric: r.rubric ?? '',
    axes: (r.axes ?? []).map((a) => ({
      key: a.key ?? '',
      label: a.label ?? '',
      score: a.score ?? 0,
      mockCount: a.mockCount ?? 0,
      confidence: ((a.confidence ?? 'empty') as SkillRadarConfidence),
    })),
  };
}

// ── Phase 2 finalizer: snapshot stats ──────────────────────────────────

// The "next mock" snapshot tile collapsed to a static placeholder client-side.
export interface CoachStats {
  focusTodayMin: number;
  lastMockScore: number; // 0..100
  lastMockSection: string;
}

export async function getCoachStats(): Promise<CoachStats> {
  const r = await client.getCoachStats({});
  return {
    focusTodayMin: r.focusTodayMin ?? 0,
    lastMockScore: r.lastMockScore ?? 0,
    lastMockSection: r.lastMockSection ?? '',
  };
}

// Mirror web's lib/queries/primaryGoal.ts: hits chi-direct REST endpoints
// (google.api.http transcoding) с snake_case wire shape. 404 на active GET
// → null (no goal yet). Connect-RPC client намеренно не использется — wire
// shape совпадает с web для shared cache/migration path.

export type PrimaryGoalKind =
  | 'GOAL_KIND_TOP_TIER_CO'
  | 'GOAL_KIND_ANY_SENIOR'
  | 'GOAL_KIND_ML_OFFER'
  | 'GOAL_KIND_ENGLISH_TARGET'
  | 'GOAL_KIND_CUSTOM';

export interface PrimaryGoal {
  id: string;
  kind: PrimaryGoalKind;
  target_company?: string;
  target_level?: string;
  target_text?: string;
  target_date?: string; // ISO yyyy-mm-dd
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreatePrimaryGoalBody {
  kind: PrimaryGoalKind;
  target_company?: string;
  target_level?: string;
  target_text?: string;
  target_date?: string;
}

export interface UpdatePrimaryGoalBody extends CreatePrimaryGoalBody {
  id: string;
}

function goalAuthHeaders(): Record<string, string> {
  const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

// getActiveGoal — 404 → null (юзер ещё не поставил цель). Любая другая
// ошибка пробрасывается caller'у.
export async function getActiveGoal(): Promise<PrimaryGoal | null> {
  const resp = await fetch(
    `${API_BASE_URL}/api/v1/intelligence/goals/primary/active`,
    { headers: goalAuthHeaders() },
  );
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`getActiveGoal: ${resp.status}`);
  return (await resp.json()) as PrimaryGoal;
}

export async function createGoal(body: CreatePrimaryGoalBody): Promise<PrimaryGoal> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/intelligence/goals/primary`, {
    method: 'POST',
    headers: goalAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`createGoal: ${resp.status}`);
  return (await resp.json()) as PrimaryGoal;
}

export async function updateGoal(body: UpdatePrimaryGoalBody): Promise<PrimaryGoal> {
  const resp = await fetch(
    `${API_BASE_URL}/api/v1/intelligence/goals/primary/update`,
    {
      method: 'POST',
      headers: goalAuthHeaders(),
      body: JSON.stringify(body),
    },
  );
  if (!resp.ok) throw new Error(`updateGoal: ${resp.status}`);
  return (await resp.json()) as PrimaryGoal;
}

// Hone end-of-pomodoro reflection prompt раньше собирал grade + notes,
// но они не сохранялись. Эти wrappers закрывают loop: save через RPC
// (online) или outbox (offline → retry on reconnect), list для grade-trend
// chart на /stats.

export type FocusMode =
  | 'pomodoro'
  | 'stopwatch'
  | 'free'
  | 'plan'
  | 'pinned'
  | 'countdown';

export interface SaveFocusReflectionArgs {
  sessionId: string;
  focusMode: FocusMode;
  durationSeconds: number;
  // grade ∈ [1,5]; 0 = no rating (only notes submitted).
  grade: number;
  notes: string;
  taskPinned?: string;
  startedAt: Date;
  endedAt: Date;
}

export interface SaveFocusReflectionResult {
  reflectionId: string;
}

export interface FocusReflectionEntry {
  reflectionId: string;
  endedAt: Date | null;
  grade: number; // 0 = no grade
  focusMode: FocusMode | string;
  durationSeconds: number;
}

// saveFocusReflection — direct online RPC. Caller обычно использует
// queue-aware wrapper (см. App.tsx) который шлёт через outbox для
// offline-first semantics. Этот wrapper — base call'ом.
export async function saveFocusReflection(
  args: SaveFocusReflectionArgs,
): Promise<SaveFocusReflectionResult> {
  const resp = await client.saveFocusReflection({
    sessionId: args.sessionId,
    focusMode: args.focusMode,
    durationSeconds: Math.max(0, Math.floor(args.durationSeconds)),
    grade: clampGrade(args.grade),
    notes: args.notes,
    taskPinned: args.taskPinned ?? '',
    startedAt: Timestamp.fromDate(args.startedAt),
    endedAt: Timestamp.fromDate(args.endedAt),
  });
  return { reflectionId: resp.reflectionId ?? '' };
}

export async function listFocusReflections(windowDays = 30): Promise<FocusReflectionEntry[]> {
  const resp = await client.listFocusReflections({ windowDays });
  return (resp.items ?? []).map((it) => ({
    reflectionId: it.reflectionId ?? '',
    endedAt: it.endedAt ? it.endedAt.toDate() : null,
    grade: it.grade ?? 0,
    focusMode: (it.focusMode ?? '') as FocusMode | string,
    durationSeconds: it.durationSeconds ?? 0,
  }));
}

function clampGrade(g: number): number {
  if (!Number.isFinite(g)) return 0;
  const r = Math.round(g);
  if (r < 0) return 0;
  if (r > 5) return 5;
  return r;
}

// Hone fires `recordAppInstall` once on startup (after auth) so the
// backend knows the user actually launched the desktop app. First call
// across all 3 surfaces (web/hone/cue) issues a 7-day Pro trial; the
// server returns trial_pro_granted=true and Hone can show a celebratory
// toast. Heartbeat is idempotent — subsequent launches just bump
// last_seen_at.

import { ProfileService } from '@generated/pb/druz9/v1/profile_connect';
import { AppSurface } from '@generated/pb/druz9/v1/profile_pb';

const profileClient = createPromiseClient(ProfileService, transport);

export interface InstalledApp {
  app: 'web' | 'hone' | 'cue';
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  appVersion: string;
}

export interface RecordAppInstallResult {
  app: 'web' | 'hone' | 'cue';
  trialProGranted: boolean;
  // RFC3339 string from server; empty when no trial issued. Caller can
  // parse via `new Date(trialProUntil)` if non-empty.
  trialProUntil: string;
}

function appSurfaceFromString(a: string): AppSurface {
  switch (a) {
    case 'web':
      return AppSurface.WEB;
    case 'hone':
      return AppSurface.HONE;
    case 'cue':
      return AppSurface.CUE;
    default:
      return AppSurface.UNSPECIFIED;
  }
}

function appSurfaceToString(a: AppSurface): 'web' | 'hone' | 'cue' {
  switch (a) {
    case AppSurface.WEB:
      return 'web';
    case AppSurface.HONE:
      return 'hone';
    case AppSurface.CUE:
      return 'cue';
    default:
      // Fall back to 'web' for unknown values — used only as a label,
      // never as wire shape, so a misclassification is cosmetic.
      return 'web';
  }
}

export async function recordAppInstall(
  app: 'web' | 'hone' | 'cue',
  version: string,
): Promise<RecordAppInstallResult> {
  const resp = await profileClient.recordAppInstall({
    app: appSurfaceFromString(app),
    appVersion: version,
  });
  return {
    app: resp.install ? appSurfaceToString(resp.install.app) : app,
    trialProGranted: resp.trialProGranted,
    trialProUntil: resp.trialProUntil ?? '',
  };
}

export async function getInstalledApps(): Promise<InstalledApp[]> {
  const resp = await profileClient.getInstalledApps({});
  return (resp.installs ?? []).map((it) => ({
    app: appSurfaceToString(it.app),
    firstSeenAt: it.firstSeenAt ? it.firstSeenAt.toDate() : null,
    lastSeenAt: it.lastSeenAt ? it.lastSeenAt.toDate() : null,
    appVersion: it.appVersion ?? '',
  }));
}
