// api/hone.ts — thin typed wrappers around the generated HoneService
// client. Two things this layer owns:
//
//   1. Keep proto-world types out of the UI. The generated message
//      shapes have classes, nullable sub-objects and timestamp proto
//      envelopes; the UI wants plain POJOs. We unwrap here, once.
//
//   2. A single place to add error normalisation when we start caring
//      about connect.CodeUnavailable → "AI offline" banners.
import { createPromiseClient } from '@connectrpc/connect';
import { HoneService } from '@generated/pb/druz9/v1/hone_connect';

import { transport } from './transport';

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

export interface Note {
  id: string;
  title: string;
  bodyMd: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  sizeBytes: number;
}

export interface NoteSummary {
  id: string;
  title: string;
  updatedAt: Date | null;
  sizeBytes: number;
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
};

function unwrapNote(n: ProtoNote): Note {
  return {
    id: n.id,
    title: n.title,
    bodyMd: n.bodyMd,
    createdAt: protoTs(n.createdAt),
    updatedAt: protoTs(n.updatedAt),
    sizeBytes: n.sizeBytes,
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
  };
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

export async function listNotes(args: { limit?: number; cursor?: string } = {}): Promise<{
  notes: NoteSummary[];
  nextCursor: string;
}> {
  const resp = await client.listNotes({
    limit: args.limit ?? 100,
    cursor: args.cursor ?? '',
  });
  return {
    notes: resp.notes.map((n) => ({
      id: n.id,
      title: n.title,
      updatedAt: protoTs(n.updatedAt),
      sizeBytes: n.sizeBytes,
    })),
    nextCursor: resp.nextCursor,
  };
}

export async function getNote(id: string): Promise<Note> {
  const resp = await client.getNote({ id });
  return unwrapNote(resp as unknown as ProtoNote);
}

export async function createNote(title: string, bodyMd: string): Promise<Note> {
  const resp = await client.createNote({ title, bodyMd });
  return unwrapNote(resp as unknown as ProtoNote);
}

export async function updateNote(id: string, title: string, bodyMd: string): Promise<Note> {
  const resp = await client.updateNote({ id, title, bodyMd });
  return unwrapNote(resp as unknown as ProtoNote);
}

export async function deleteNote(id: string): Promise<void> {
  await client.deleteNote({ id });
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
