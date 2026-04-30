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
