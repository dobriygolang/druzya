// api/tutor.ts — Hone-side mirror of Wave 5.1 tutor assignment RPCs.
// Hone speaks Connect-RPC directly via the @generated/pb client; the web
// frontend uses the REST transcoder (see lib/queries/tutor.ts there).
// Same backend — different transports.
import { createPromiseClient } from '@connectrpc/connect';
import { TutorService } from '@generated/pb/druz9/v1/tutor_connect';

import { transport } from './transport';

export interface TutorAssignment {
  id: string;
  tutorId: string;
  studentId: string;
  title: string;
  bodyMd: string;
  dueAt: Date | null;
  createdAt: Date | null;
  completedAt: Date | null;
  archivedAt: Date | null;
}

const client = createPromiseClient(TutorService, transport);

function protoTs(ts: { seconds: bigint; nanos: number } | undefined): Date | null {
  if (!ts) return null;
  const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
  if (ms <= 0) return null; // proto3 zero-stamp == «not set»
  return new Date(ms);
}

type ProtoAssignment = {
  id: string;
  tutorId: string;
  studentId: string;
  title: string;
  bodyMd: string;
  dueAt?: { seconds: bigint; nanos: number };
  createdAt?: { seconds: bigint; nanos: number };
  completedAt?: { seconds: bigint; nanos: number };
  archivedAt?: { seconds: bigint; nanos: number };
};

function unwrapAssignment(a: ProtoAssignment): TutorAssignment {
  return {
    id: a.id,
    tutorId: a.tutorId,
    studentId: a.studentId,
    title: a.title,
    bodyMd: a.bodyMd,
    dueAt: protoTs(a.dueAt),
    createdAt: protoTs(a.createdAt),
    completedAt: protoTs(a.completedAt),
    archivedAt: protoTs(a.archivedAt),
  };
}

/** Student-side: fetch all pending assignments authored by my tutor(s). */
export async function listPendingAssignments(limit = 25): Promise<TutorAssignment[]> {
  const resp = await client.listPendingAssignments({ limit });
  return resp.items.map((a) => unwrapAssignment(a as unknown as ProtoAssignment));
}

/** Student stamps `completed_at`. Server is idempotent — re-call after the
 *  fact returns FailedPrecondition; the caller treats that as a no-op. */
export async function completeAssignment(assignmentId: string): Promise<void> {
  await client.completeAssignment({ assignmentId });
}

// ── Events (Wave 5.2b) ────────────────────────────────────────────────

export type TutorEventStatus = 'scheduled' | 'cancelled' | 'completed' | string;

export interface TutorEvent {
  id: string;
  tutorId: string;
  studentId: string; // empty for circle (group) events — V1 always set
  circleId: string;  // V2; always empty in V1
  title: string;
  bodyMd: string;
  scheduledAt: Date | null;
  durationMin: number;
  meetUrl: string;
  capacity: number;
  status: TutorEventStatus;
  cancellationReason: string;
  /** Wave 5.2d — non-empty iff status='completed'. Tutor's session
   *  write-up; visible to the student so they can review what was
   *  covered. ListUpcomingEvents excludes completed events server-side,
   *  so this field is empty on the Calendar feed — kept on the type
   *  for forward-compat with a future «past sessions» endpoint. */
  sessionNote: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

type ProtoEvent = {
  id: string;
  tutorId: string;
  studentId: string;
  circleId: string;
  title: string;
  bodyMd: string;
  scheduledAt?: { seconds: bigint; nanos: number };
  durationMin: number;
  meetUrl: string;
  capacity: number;
  status: string;
  cancellationReason: string;
  sessionNote: string;
  createdAt?: { seconds: bigint; nanos: number };
  updatedAt?: { seconds: bigint; nanos: number };
};

function unwrapEvent(e: ProtoEvent): TutorEvent {
  return {
    id: e.id,
    tutorId: e.tutorId,
    studentId: e.studentId,
    circleId: e.circleId,
    title: e.title,
    bodyMd: e.bodyMd,
    scheduledAt: protoTs(e.scheduledAt),
    durationMin: e.durationMin,
    meetUrl: e.meetUrl,
    capacity: e.capacity,
    status: e.status,
    cancellationReason: e.cancellationReason,
    sessionNote: e.sessionNote,
    createdAt: protoTs(e.createdAt),
    updatedAt: protoTs(e.updatedAt),
  };
}

// ── Multi-tutor (Wave 9.4) ────────────────────────────────────────────

export interface MyTutor {
  relationshipId: string;
  tutorId: string;
  startedAt: Date | null;
  note: string;
}

type ProtoRelationship = {
  id: string;
  tutorId: string;
  studentId: string;
  inviteId: string;
  startedAt?: { seconds: bigint; nanos: number };
  endedAt?: { seconds: bigint; nanos: number };
  note: string;
};

/** Student-side: list active tutors (multi-tutor support). */
export async function listMyTutors(): Promise<MyTutor[]> {
  const resp = await client.listMyTutors({});
  return resp.items.map((r) => {
    const proto = r as unknown as ProtoRelationship;
    return {
      relationshipId: proto.id,
      tutorId: proto.tutorId,
      startedAt: protoTs(proto.startedAt),
      note: proto.note,
    };
  });
}

// ── Tutor activity social-proof (Phase K T6, 2026-05-12) ──────────────

export interface MyTutorActivitySummary {
  tutorUserId: string;
  tutorDisplayName: string;
  tutorUsername: string;
  tutorAvatarUrl: string;
  lastActiveAt: Date | null;
  activeStudentCountOther: number;
  recentEventsCount: number;
}

type ProtoMyTutorActivitySummary = {
  tutorUserId: string;
  tutorDisplayName: string;
  tutorUsername: string;
  tutorAvatarUrl: string;
  lastActiveAt?: { seconds: bigint; nanos: number };
  activeStudentCountOther: number;
  recentEventsCount: number;
};

/** Student-side: tutor activity summary for the «who's around today» rail.
 *  Privacy-aware aggregate — no other-student names or event titles. */
export async function listMyTutorsActivity(
  recentWindowDays = 7,
): Promise<MyTutorActivitySummary[]> {
  const resp = await client.listMyTutorsActivity({ recentWindowDays });
  return resp.items.map((it) => {
    const proto = it as unknown as ProtoMyTutorActivitySummary;
    return {
      tutorUserId: proto.tutorUserId,
      tutorDisplayName: proto.tutorDisplayName,
      tutorUsername: proto.tutorUsername,
      tutorAvatarUrl: proto.tutorAvatarUrl,
      lastActiveAt: protoTs(proto.lastActiveAt),
      activeStudentCountOther: proto.activeStudentCountOther,
      recentEventsCount: proto.recentEventsCount,
    };
  });
}

/** Student-side: scheduled events whose end time hasn't passed yet. */
export async function listUpcomingEvents(limit = 25): Promise<TutorEvent[]> {
  const resp = await client.listUpcomingEventsForStudent({ limit });
  return resp.items.map((ev) => unwrapEvent(ev as unknown as ProtoEvent));
}

// ── Group events (Wave 5.2) ──────────────────────────────────────────

/** Student-side group event feed: events on circles the student is a
 *  member of. They render with JOIN buttons; once joined, the row also
 *  appears in listUpcomingEvents through the rsvp UNION. */
export async function listUpcomingGroupEvents(): Promise<TutorEvent[]> {
  const resp = await client.listUpcomingGroupEventsForStudent({});
  return resp.items.map((ev) => unwrapEvent(ev as unknown as ProtoEvent));
}

export async function joinEvent(eventId: string): Promise<void> {
  await client.joinEvent({ eventId });
}

export async function leaveEvent(eventId: string): Promise<void> {
  await client.leaveEvent({ eventId });
}

export async function getEventRSVPCount(eventId: string): Promise<number> {
  const resp = await client.getEventRSVPCount({ eventId });
  return resp.count;
}

// ── Path assignments (Phase K T2+T3, 2026-05-12) ──────────────────────

export interface PathAssignment {
  id: string;
  pathId: string;
  tutorId: string;
  studentId: string;
  currentStep: number;
  totalSteps: number;
  assignedAt: Date | null;
  completedAt: Date | null;
  archivedAt: Date | null;
  snapshotAtlasNodeKeys: string[];
  snapshotResourceIds: string[];
  pathName: string;
  tutorDisplayName: string;
}

type ProtoPathAssignment = {
  id: string;
  pathId: string;
  tutorId: string;
  studentId: string;
  currentStep: number;
  totalSteps: number;
  assignedAt?: { seconds: bigint; nanos: number };
  completedAt?: { seconds: bigint; nanos: number };
  archivedAt?: { seconds: bigint; nanos: number };
  snapshotAtlasNodeKeys: string[];
  snapshotResourceIds: string[];
  pathName: string;
  tutorDisplayName: string;
};

function unwrapPathAssignment(a: ProtoPathAssignment): PathAssignment {
  return {
    id: a.id,
    pathId: a.pathId,
    tutorId: a.tutorId,
    studentId: a.studentId,
    currentStep: a.currentStep,
    totalSteps: a.totalSteps,
    assignedAt: protoTs(a.assignedAt),
    completedAt: protoTs(a.completedAt),
    archivedAt: protoTs(a.archivedAt),
    snapshotAtlasNodeKeys: a.snapshotAtlasNodeKeys ?? [],
    snapshotResourceIds: a.snapshotResourceIds ?? [],
    pathName: a.pathName ?? '',
    tutorDisplayName: a.tutorDisplayName ?? '',
  };
}

/** Student-side: which curated paths am I currently working on? */
export async function listMyActivePathAssignments(): Promise<PathAssignment[]> {
  const resp = await client.listMyActivePathAssignments({});
  return resp.items.map((it) => unwrapPathAssignment(it as unknown as ProtoPathAssignment));
}

/** Bump current_step by 1. Server stamps completed_at when step == total.
 *  Returns the updated assignment + a flag indicating whether THIS call
 *  crossed the finish line (so the UI can fire a «completed» toast). */
export async function advancePathStep(assignmentId: string): Promise<{
  assignment: PathAssignment;
  completed: boolean;
}> {
  const resp = await client.advancePathStep({ assignmentId });
  return {
    assignment: unwrapPathAssignment(resp.assignment as unknown as ProtoPathAssignment),
    completed: resp.completed,
  };
}

// ── Shared session notes (Phase K T4, 2026-05-13) ─────────────────────

export interface SharedSessionNote {
  eventId: string;
  eventTitle: string;
  tutorId: string;
  tutorDisplayName: string;
  tutorAvatarUrl: string;
  scheduledAt: Date | null;
  sharedAt: Date | null;
  sharedContentMd: string;
}

type ProtoSharedSessionNote = {
  eventId: string;
  eventTitle: string;
  tutorId: string;
  tutorDisplayName: string;
  tutorAvatarUrl: string;
  scheduledAt?: { seconds: bigint; nanos: number };
  sharedAt?: { seconds: bigint; nanos: number };
  sharedContentMd: string;
};

function unwrapSharedSessionNote(n: ProtoSharedSessionNote): SharedSessionNote {
  return {
    eventId: n.eventId,
    eventTitle: n.eventTitle,
    tutorId: n.tutorId,
    tutorDisplayName: n.tutorDisplayName ?? '',
    tutorAvatarUrl: n.tutorAvatarUrl ?? '',
    scheduledAt: protoTs(n.scheduledAt),
    sharedAt: protoTs(n.sharedAt),
    sharedContentMd: n.sharedContentMd ?? '',
  };
}

/** Student-side: completed events whose tutors opted to share the
 *  session note. Most-recently-shared first. */
export async function listSharedSessionNotes(limit = 25): Promise<SharedSessionNote[]> {
  const resp = await client.listSharedSessionNotesForStudent({ limit });
  return resp.items.map((it) =>
    unwrapSharedSessionNote(it as unknown as ProtoSharedSessionNote),
  );
}
