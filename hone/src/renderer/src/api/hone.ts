// api/hone.ts — thin typed wrappers around the generated HoneService
// client. Two things this layer owns:
//
//   1. Keep proto-world types out of the UI. The generated message
//      shapes have classes, nullable sub-objects and timestamp proto
//      envelopes; the UI wants plain POJOs. We unwrap here, once.
//
//   2. A single place to add error normalisation when we start caring
//      about connect.CodeUnavailable → "AI offline" banners.
import { ConnectError, Code, createPromiseClient } from '@connectrpc/connect';
import { HoneService } from '@generated/pb/druz9/v1/hone_connect';

import { transport } from './transport';
import { emitConflict } from '../components/ConflictModal';

// ─── Domain-shaped POJOs ────────────────────────────────────────────────────

export interface FocusDay {
  date: string; // ISO YYYY-MM-DD
  seconds: number;
  sessions: number;
}

export interface HoneStats {
  currentStreakDays: number;
  longestStreakDays: number;
  totalFocusedSeconds: number;
  heatmap: FocusDay[];
  lastSevenDays: FocusDay[];
  queue: QueueStats;
}

export interface QueueStats {
  todayTotal: number;
  todayDone: number;
  // 0..1, доли сделанных за 7 дней по source. Сумма = 1 если есть данные,
  // 0/0 если нет done items.
  aiShare: number;
  userShare: number;
}

// PlanItem — один ряд в дневном плане. rationale / skillKey — новые поля
// Phase 5b: rationale отображается вторая строка мотивации, skillKey —
// opaque тег для бэкенд-resistance-tracker'а (фронту не нужен в UI).
export interface PlanItem {
  id: string;
  kind: 'solve' | 'mock' | 'review' | 'read' | 'custom';
  title: string;
  subtitle: string;
  rationale: string;
  skillKey: string;
  targetRef: string;
  deepLink: string;
  estimatedMin: number;
  dismissed: boolean;
  completed: boolean;
}

export interface Plan {
  id: string;
  date: string;
  regeneratedAt: Date | null;
  items: PlanItem[];
}

export interface FocusSession {
  id: string;
  planItemId: string;
  pinnedTitle: string;
  startedAt: Date | null;
  endedAt: Date | null;
  pomodorosCompleted: number;
  secondsFocused: number;
  mode: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface Note {
  id: string;
  title: string;
  bodyMd: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  sizeBytes: number;
  folderId: string | null;
  encrypted: boolean;
}

export interface NoteSummary {
  id: string;
  title: string;
  updatedAt: Date | null;
  sizeBytes: number;
  folderId: string | null;
}

export interface Whiteboard {
  id: string;
  title: string;
  stateJson: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  version: number;
}

export interface WhiteboardSummary {
  id: string;
  title: string;
  updatedAt: Date | null;
}

export interface CritiquePacket {
  section: 'strengths' | 'concerns' | 'missing' | 'closing' | string;
  delta: string;
  done: boolean;
}

export interface NoteConnection {
  kind: 'note' | 'pr' | 'task' | 'session' | 'book' | string;
  targetId: string;
  displayTitle: string;
  snippet: string;
  similarity: number;
}

export interface StandupResult {
  note: Note;
  plan: Plan | null; // null когда плана ещё нет (beckend не возвращает proto)
}

// ─── Internals ──────────────────────────────────────────────────────────────

// Module-private Connect client. Intentionally not exported — call sites
// use the named async wrappers below so the UI layer has no direct proto
// surface.
const client = createPromiseClient(HoneService, transport);

// protoTs — google.protobuf.Timestamp → JS Date. proto-ES возвращает
// bigint seconds + nanos; мы теряем sub-ms разрешение сознательно (у UI
// нет кейса где nanos нужны).
function protoTs(ts: { seconds: bigint; nanos: number } | undefined): Date | null {
  if (!ts) return null;
  const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
  return new Date(ms);
}

// normalizePlanItemKind — бекенд присылает string, нормализуем в union.
function normalizePlanItemKind(k: string): PlanItem['kind'] {
  switch (k) {
    case 'solve':
    case 'mock':
    case 'review':
    case 'read':
    case 'custom':
      return k;
    default:
      return 'custom';
  }
}

function unwrapPlanItem(it: {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  rationale: string;
  skillKey: string;
  targetRef: string;
  deepLink: string;
  estimatedMin: number;
  dismissed: boolean;
  completed: boolean;
}): PlanItem {
  return {
    id: it.id,
    kind: normalizePlanItemKind(it.kind),
    title: it.title,
    subtitle: it.subtitle,
    rationale: it.rationale,
    skillKey: it.skillKey,
    targetRef: it.targetRef,
    deepLink: it.deepLink,
    estimatedMin: it.estimatedMin,
    dismissed: it.dismissed,
    completed: it.completed,
  };
}

// Narrow type для proto Plan — proto-es message classes имеют больше полей
// (getType и т.п.), но мы ограничиваемся только нужными.
type ProtoPlan = {
  id: string;
  date: string;
  regeneratedAt?: { seconds: bigint; nanos: number };
  items: Parameters<typeof unwrapPlanItem>[0][];
};

function unwrapPlan(p: ProtoPlan): Plan {
  return {
    id: p.id,
    date: p.date,
    regeneratedAt: protoTs(p.regeneratedAt),
    items: p.items.map(unwrapPlanItem),
  };
}

type ProtoFocusSession = {
  id: string;
  planItemId: string;
  pinnedTitle: string;
  startedAt?: { seconds: bigint; nanos: number };
  endedAt?: { seconds: bigint; nanos: number };
  pomodorosCompleted: number;
  secondsFocused: number;
  mode: string;
};

function unwrapFocusSession(s: ProtoFocusSession): FocusSession {
  return {
    id: s.id,
    planItemId: s.planItemId,
    pinnedTitle: s.pinnedTitle,
    startedAt: protoTs(s.startedAt),
    endedAt: protoTs(s.endedAt),
    pomodorosCompleted: s.pomodorosCompleted,
    secondsFocused: s.secondsFocused,
    mode: s.mode,
  };
}

type ProtoNote = {
  id: string;
  title: string;
  bodyMd: string;
  createdAt?: { seconds: bigint; nanos: number };
  updatedAt?: { seconds: bigint; nanos: number };
  sizeBytes: number;
  folderId?: string;
};

// nonEmpty — proto3 не различает «не задано» и «пустая строка». Backend
// возвращает folderId=""/parentId="" для root-level item'ов; нам нужен
// null чтобы Map<string|null, …> и string === null comparisons работали.
function nonEmpty(s: string | undefined | null): string | null {
  return s && s.length > 0 ? s : null;
}

function unwrapNote(n: ProtoNote): Note {
  return {
    id: n.id,
    title: n.title,
    bodyMd: n.bodyMd,
    createdAt: protoTs(n.createdAt),
    updatedAt: protoTs(n.updatedAt),
    sizeBytes: n.sizeBytes,
    folderId: nonEmpty(n.folderId),
    // The proto Note message has no `encrypted` field today (the backend
    // tracks it via the parallel /notes/meta endpoint). Default to false
    // here — UI flows (share/private) resolve the real flag through
    // getNotesMeta() before deciding whether to encrypt or decrypt.
    encrypted: false,
  };
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export async function getStats(upToDate?: string): Promise<HoneStats> {
  const resp = await client.getStats({ upToDate: upToDate ?? '' });
  return {
    currentStreakDays: resp.currentStreakDays,
    longestStreakDays: resp.longestStreakDays,
    totalFocusedSeconds: resp.totalFocusedSeconds,
    heatmap: resp.heatmap.map((d) => ({
      date: d.date,
      seconds: d.seconds,
      sessions: d.sessions,
    })),
    lastSevenDays: resp.lastSevenDays.map((d) => ({
      date: d.date,
      seconds: d.seconds,
      sessions: d.sessions,
    })),
    queue: resp.queue
      ? {
          todayTotal: resp.queue.todayTotal,
          todayDone: resp.queue.todayDone,
          aiShare: resp.queue.aiShare,
          userShare: resp.queue.userShare,
        }
      : { todayTotal: 0, todayDone: 0, aiShare: 0, userShare: 0 },
  };
}

// ─── Focus Queue ────────────────────────────────────────────────────────────

export type QueueItemStatus = 'todo' | 'in_progress' | 'done';
export type QueueItemSource = 'ai' | 'user';

export interface QueueItem {
  id: string;
  title: string;
  source: QueueItemSource;
  status: QueueItemStatus;
  skillKey: string;
  date: string;
}

function unwrapQueueItem(q: { id: string; title: string; source: string; status: string; skillKey: string; date: string }): QueueItem {
  return {
    id: q.id,
    title: q.title,
    source: (q.source === 'ai' ? 'ai' : 'user') as QueueItemSource,
    status: (q.status === 'in_progress' || q.status === 'done' ? q.status : 'todo') as QueueItemStatus,
    skillKey: q.skillKey ?? '',
    date: q.date,
  };
}

export async function listQueue(date?: string): Promise<QueueItem[]> {
  const resp = await client.listQueue({ date: date ?? '' });
  return resp.items.map(unwrapQueueItem);
}

export async function addQueueItem(title: string): Promise<QueueItem> {
  const resp = await client.addQueueItem({ title });
  return unwrapQueueItem(resp);
}

export async function updateQueueItemStatus(id: string, status: QueueItemStatus): Promise<QueueItem> {
  const resp = await client.updateQueueItemStatus({ id, status });
  return unwrapQueueItem(resp);
}

export async function deleteQueueItem(id: string): Promise<void> {
  await client.deleteQueueItem({ id });
}

// ─── Plan ───────────────────────────────────────────────────────────────────

export async function getPlan(): Promise<Plan> {
  const resp = await client.getDailyPlan({});
  return unwrapPlan(resp as unknown as ProtoPlan);
}

export async function generatePlan(force = false): Promise<Plan> {
  const resp = await client.generateDailyPlan({ force });
  return unwrapPlan(resp as unknown as ProtoPlan);
}

export async function dismissPlanItem(itemId: string): Promise<Plan> {
  const resp = await client.dismissPlanItem({ itemId });
  return unwrapPlan(resp as unknown as ProtoPlan);
}

export async function completePlanItem(itemId: string): Promise<Plan> {
  const resp = await client.completePlanItem({ itemId });
  return unwrapPlan(resp as unknown as ProtoPlan);
}

// ─── Focus ──────────────────────────────────────────────────────────────────

export async function startFocusSession(args: {
  planItemId?: string;
  pinnedTitle?: string;
  mode?: 'pomodoro' | 'stopwatch';
}): Promise<FocusSession> {
  const resp = await client.startFocusSession({
    planItemId: args.planItemId ?? '',
    pinnedTitle: args.pinnedTitle ?? '',
    mode: args.mode ?? 'pomodoro',
  });
  return unwrapFocusSession(resp as unknown as ProtoFocusSession);
}

export async function endFocusSession(args: {
  sessionId: string;
  pomodorosCompleted: number;
  secondsFocused: number;
  reflection?: string;
}): Promise<FocusSession> {
  const resp = await client.endFocusSession({
    sessionId: args.sessionId,
    pomodorosCompleted: args.pomodorosCompleted,
    secondsFocused: args.secondsFocused,
    reflection: args.reflection ?? '',
  });
  return unwrapFocusSession(resp as unknown as ProtoFocusSession);
}

// ─── Notes ──────────────────────────────────────────────────────────────────

export async function listNotes(args: { limit?: number; cursor?: string; folderId?: string | null } = {}): Promise<{
  notes: NoteSummary[];
  nextCursor: string;
}> {
  const resp = await client.listNotes({
    limit: args.limit ?? 100,
    cursor: args.cursor ?? '',
    folderId: args.folderId ?? undefined,
  });
  return {
    notes: resp.notes.map((n) => ({
      id: n.id,
      title: n.title,
      updatedAt: protoTs(n.updatedAt),
      sizeBytes: n.sizeBytes,
      folderId: nonEmpty((n as unknown as { folderId?: string }).folderId),
    })),
    nextCursor: resp.nextCursor,
  };
}

export async function getNote(id: string): Promise<Note> {
  const resp = await client.getNote({ id });
  return unwrapNote(resp as unknown as ProtoNote);
}

export async function createNote(title: string, bodyMd: string, folderId?: string | null): Promise<Note> {
  const resp = await client.createNote({ title, bodyMd, folderId: folderId ?? undefined });
  return unwrapNote(resp as unknown as ProtoNote);
}

export async function updateNote(id: string, title: string, bodyMd: string): Promise<Note> {
  const resp = await client.updateNote({ id, title, bodyMd });
  return unwrapNote(resp as unknown as ProtoNote);
}

export async function deleteNote(id: string): Promise<void> {
  await client.deleteNote({ id });
}

export async function moveNote(noteId: string, folderId: string | null): Promise<Note> {
  const resp = await client.moveNote({ noteId, folderId: folderId ?? undefined });
  return unwrapNote(resp as unknown as ProtoNote);
}

// ─── Folders ────────────────────────────────────────────────────────────────

export async function listFolders(): Promise<Folder[]> {
  const resp = await client.listFolders({});
  return resp.folders.map((f) => ({
    id: f.id,
    name: f.name,
    parentId: nonEmpty((f as unknown as { parentId?: string }).parentId),
    createdAt: protoTs(f.createdAt),
    updatedAt: protoTs(f.updatedAt),
  }));
}

export async function createFolder(name: string, parentId?: string | null): Promise<Folder> {
  const resp = await client.createFolder({ name, parentId: parentId ?? undefined });
  const f = resp as unknown as { id: string; name: string; parentId?: string; createdAt?: { seconds: bigint; nanos: number }; updatedAt?: { seconds: bigint; nanos: number } };
  return {
    id: f.id,
    name: f.name,
    parentId: nonEmpty(f.parentId),
    createdAt: protoTs(f.createdAt),
    updatedAt: protoTs(f.updatedAt),
  };
}

export async function deleteFolder(id: string, moveNotesToRoot = true): Promise<void> {
  await client.deleteFolder({ id, moveNotesToRoot });
}

// getNoteConnectionsStream — server-streaming. Для ⌘J панели в Notes
// мы аккумулируем соединения и вызываем onConnection на каждый. Ошибки
// пробрасываем наружу (панель покажет error-state).
export async function getNoteConnectionsStream(
  noteId: string,
  onConnection: (c: NoteConnection) => void,
): Promise<void> {
  for await (const c of client.getNoteConnections({ noteId })) {
    onConnection({
      kind: c.kind,
      targetId: c.targetId,
      displayTitle: c.displayTitle,
      snippet: c.snippet,
      similarity: c.similarity,
    });
  }
}

// suggestNoteLinks — Phase 5: LLM-rerank поверх pgvector top-K. Возвращает
// ≤max suggestions с per-edge `reason` (1 sentence) — Connections panel
// рендерит «AI suggestions» секцию с этими reason'ами.
//
// Cold call ≈ embed + pgvector + LLM rerank → 1-2s на free-tier. UI
// показывает skeleton пока ждёт; на rate-limit'е backend сам fallback'нет
// на embedding-only ranking (reason пустой).
export interface NoteLinkSuggestion {
  targetNoteId: string;
  targetTitle: string;
  snippet: string;
  score: number;
  reason: string;
}

export async function suggestNoteLinks(
  noteId: string,
  max = 5,
): Promise<NoteLinkSuggestion[]> {
  const resp = await client.suggestNoteLinks({ noteId, max });
  return resp.suggestions.map((s) => ({
    targetNoteId: s.targetNoteId,
    targetTitle: s.targetTitle,
    snippet: s.snippet,
    score: s.score,
    reason: s.reason,
  }));
}

// ─── Whiteboards ────────────────────────────────────────────────────────────

export async function listWhiteboards(): Promise<WhiteboardSummary[]> {
  const resp = await client.listWhiteboards({});
  return resp.whiteboards.map((w) => ({
    id: w.id,
    title: w.title,
    updatedAt: protoTs(w.updatedAt),
  }));
}

export async function getWhiteboard(id: string): Promise<Whiteboard> {
  const resp = await client.getWhiteboard({ id });
  return {
    id: resp.id,
    title: resp.title,
    stateJson: resp.stateJson,
    createdAt: protoTs(resp.createdAt),
    updatedAt: protoTs(resp.updatedAt),
    version: resp.version,
  };
}

export async function createWhiteboard(title: string, stateJson = ''): Promise<Whiteboard> {
  const resp = await client.createWhiteboard({ title, stateJson });
  return {
    id: resp.id,
    title: resp.title,
    stateJson: resp.stateJson,
    createdAt: protoTs(resp.createdAt),
    updatedAt: protoTs(resp.updatedAt),
    version: resp.version,
  };
}

export async function updateWhiteboard(args: {
  id: string;
  title: string;
  stateJson: string;
  expectedVersion: number;
}): Promise<Whiteboard> {
  try {
    const resp = await client.updateWhiteboard({
      id: args.id,
      title: args.title,
      stateJson: args.stateJson,
      expectedVersion: args.expectedVersion,
    });
    return {
      id: resp.id,
      title: resp.title,
      stateJson: resp.stateJson,
      createdAt: protoTs(resp.createdAt),
      updatedAt: protoTs(resp.updatedAt),
      version: resp.version,
    };
  } catch (err) {
    // Optimistic-concurrency: backend maps ErrStaleVersion → Code.Aborted
    // (см. backend/services/hone/domain/errors.go + ports/server.go).
    // Pull fresh server snapshot, fire ConflictModal с тремя resolution
    // handler'ами, и пробросим исходную ошибку наверх — caller увидит
    // failure и сможет abort UI-side save. Modal сам выберет path и
    // вернёт результат через handlers.
    if (err instanceof ConnectError && err.code === Code.Aborted) {
      try {
        const server = await getWhiteboard(args.id);
        emitConflict({
          kind: 'whiteboard',
          id: args.id,
          local: {
            title: args.title,
            body: args.stateJson,
          },
          server: {
            title: server.title,
            body: server.stateJson,
            updatedAt: server.updatedAt?.toISOString() ?? '',
          },
          onKeepLocal: async () => {
            // Re-issue update с актуальным server version'ом — local wins.
            await updateWhiteboard({
              id: args.id,
              title: args.title,
              stateJson: args.stateJson,
              expectedVersion: server.version,
            });
          },
          onAcceptServer: async () => {
            // No-op на server-side: server state уже current. Caller
            // должен заново загрузить snapshot — модал не имеет ref'а
            // на caller'ский state. Listener в Whiteboard page может
            // подхватить `hone:whiteboard-refetch` event'ом если нужно.
            window.dispatchEvent(
              new CustomEvent('hone:whiteboard-refetch', { detail: { id: args.id } }),
            );
          },
          onMergeManually: async (merged) => {
            await updateWhiteboard({
              id: args.id,
              title: args.title,
              stateJson: merged,
              expectedVersion: server.version,
            });
          },
        });
      } catch {
        /* fallback — fresh snapshot fetch упал, modal не покажем */
      }
    }
    throw err;
  }
}

export async function deleteWhiteboard(id: string): Promise<void> {
  await client.deleteWhiteboard({ id });
}

// critiqueWhiteboardStream — server-streaming. Клиент передаёт onPacket
// callback — мы аккумулируем packet'ы за клиента (собираем markdown) и
// одновременно передаём их для визуализации по секциям.
export async function critiqueWhiteboardStream(
  id: string,
  onPacket: (p: CritiquePacket) => void,
): Promise<void> {
  for await (const pkt of client.critiqueWhiteboard({ id })) {
    onPacket({
      section: pkt.section,
      delta: pkt.delta,
      done: pkt.done,
    });
  }
}

export async function saveCritiqueAsNote(args: {
  whiteboardId: string;
  title?: string;
  bodyMd: string;
}): Promise<Note> {
  const resp = await client.saveCritiqueAsNote({
    whiteboardId: args.whiteboardId,
    title: args.title ?? '',
    bodyMd: args.bodyMd,
  });
  return unwrapNote(resp as unknown as ProtoNote);
}

// ─── Standup ────────────────────────────────────────────────────────────────

export async function recordStandup(args: {
  yesterday: string;
  today: string;
  blockers: string;
}): Promise<StandupResult> {
  const resp = await client.recordStandup(args);
  return {
    note: unwrapNote((resp.note ?? {}) as unknown as ProtoNote),
    plan: resp.plan ? unwrapPlan(resp.plan as unknown as ProtoPlan) : null,
  };
}

export interface TodayStandupSnapshot {
  recorded: boolean;
  yesterdayDone: string[];
}

// getTodayStandup — снапшот для morning standup banner на Today page.
// Возвращает {recorded, yesterdayDone}: recorded=true → баннер скрыт,
// yesterdayDone — done items вчерашней Focus Queue для prefill'а.
export async function getTodayStandup(): Promise<TodayStandupSnapshot> {
  const resp = await client.getTodayStandup({});
  return {
    recorded: resp.recorded,
    yesterdayDone: resp.yesterdayDone ?? [],
  };
}

// ─── Cue Sessions ───────────────────────────────────────────────────────────
//
// Cue sessions — это импорты из desktop-приложения Cue (отдельный pseudo-
// folder в Hone). Идемпотентны по file_path. См. backend/services/hone/app/
// cue_sessions.go.

export interface CueSession {
  id: string;
  filePath: string;
  title: string;
  bodyMd: string;
  rawAnalysisJson: string;
  startedAt: Date | null;
  importedAt: Date | null;
  updatedAt: Date | null;
}

type ProtoCueSession = {
  id: string;
  filePath: string;
  title: string;
  bodyMd: string;
  rawAnalysisJson: string;
  startedAt?: { seconds: bigint; nanos: number };
  importedAt?: { seconds: bigint; nanos: number };
  updatedAt?: { seconds: bigint; nanos: number };
};

function unwrapCueSession(s: ProtoCueSession): CueSession {
  return {
    id: s.id,
    filePath: s.filePath,
    title: s.title,
    bodyMd: s.bodyMd,
    rawAnalysisJson: s.rawAnalysisJson,
    startedAt: protoTs(s.startedAt),
    importedAt: protoTs(s.importedAt),
    updatedAt: protoTs(s.updatedAt),
  };
}

export async function importCueSession(args: {
  filePath: string;
  title: string;
  bodyMd: string;
  rawAnalysisJson: string;
  startedAt?: Date | null;
}): Promise<CueSession> {
  const startedAt = args.startedAt
    ? { seconds: BigInt(Math.floor(args.startedAt.getTime() / 1000)), nanos: 0 }
    : undefined;
  const resp = await client.importCueSession({
    filePath: args.filePath,
    title: args.title,
    bodyMd: args.bodyMd,
    rawAnalysisJson: args.rawAnalysisJson,
    startedAt,
  } as never);
  return unwrapCueSession(resp as unknown as ProtoCueSession);
}

export async function listCueSessions(): Promise<CueSession[]> {
  const resp = await client.listCueSessions({});
  return (resp.sessions ?? []).map((s) => unwrapCueSession(s as unknown as ProtoCueSession));
}

export async function getCueSession(id: string): Promise<CueSession> {
  const resp = await client.getCueSession({ id });
  return unwrapCueSession(resp as unknown as ProtoCueSession);
}

export async function updateCueSession(id: string, bodyMd: string): Promise<CueSession> {
  const resp = await client.updateCueSession({ id, bodyMd });
  return unwrapCueSession(resp as unknown as ProtoCueSession);
}

export async function deleteCueSession(id: string): Promise<void> {
  await client.deleteCueSession({ id });
}

export interface SendCueSessionToTelegramResult {
  ok: boolean;
  message: string;
}

export async function sendCueSessionToTelegram(id: string): Promise<SendCueSessionToTelegramResult> {
  const resp = await client.sendCueSessionToTelegram({ id });
  return { ok: resp.ok, message: resp.message };
}

// ─── User settings (active study mode) ────────────────────────────────────

// Phase 4.1 (2026-05-04): 'ml' removed. ML стало специализацией внутри
// dev_senior, не отдельный track.
export type ActiveTrack = 'general' | 'dev' | 'english' | 'go';

export interface UserSettings {
  activeTrack: ActiveTrack;
  englishActive: boolean;
}

function coerceTrack(t: string): ActiveTrack {
  switch (t) {
    case 'dev':
    case 'english':
    case 'go':
      return t;
    default:
      // Legacy 'ml' fallback to 'general' (Phase 4.1 ml→dev_senior re-tag).
      return 'general';
  }
}

export async function getUserSettings(): Promise<UserSettings> {
  const resp = await client.getUserSettings({});
  return { activeTrack: coerceTrack(resp.activeTrack), englishActive: resp.englishActive };
}

export async function setActiveTrack(track: ActiveTrack): Promise<UserSettings> {
  const resp = await client.setActiveTrack({ activeTrack: track });
  return { activeTrack: coerceTrack(resp.activeTrack), englishActive: resp.englishActive };
}

export async function setEnglishActive(active: boolean): Promise<UserSettings> {
  const resp = await client.setEnglishActive({ active });
  return { activeTrack: coerceTrack(resp.activeTrack), englishActive: resp.englishActive };
}
