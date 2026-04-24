// api/events.ts — Connect-RPC wrapper для events bounded-context.
// Calendar в Hone аггрегирует events из всех circles пользователя.
import { createPromiseClient } from '@connectrpc/connect';
import { EventsService } from '@generated/pb/druz9/v1/events_connect';
import { EventRecurrence } from '@generated/pb/druz9/v1/events_pb';
import { Timestamp } from '@bufbuild/protobuf';

import { transport } from './transport';

export type Recurrence = 'none' | 'weekly_friday' | 'unspecified';

export interface EventParticipant {
  userId: string;
  username: string;
  joinedAt: Date | null;
}

export interface CalendarEvent {
  id: string;
  circleId: string;
  circleName: string;
  title: string;
  description: string;
  startsAt: Date | null;
  durationMin: number;
  editorRoomId: string;
  whiteboardRoomId: string;
  recurrence: Recurrence;
  createdBy: string;
  createdAt: Date | null;
  participants: EventParticipant[];
}

function protoTs(ts: { seconds: bigint; nanos: number } | undefined): Date | null {
  if (!ts) return null;
  if (ts.seconds === 0n && ts.nanos === 0) return null;
  return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000));
}

function recurrenceLabel(r: EventRecurrence): Recurrence {
  switch (r) {
    case EventRecurrence.NONE:
      return 'none';
    case EventRecurrence.WEEKLY_FRIDAY:
      return 'weekly_friday';
    default:
      return 'unspecified';
  }
}

function unwrap(e: {
  id: string;
  circleId: string;
  circleName: string;
  title: string;
  description: string;
  startsAt?: { seconds: bigint; nanos: number };
  durationMin: number;
  editorRoomId: string;
  whiteboardRoomId: string;
  recurrence: EventRecurrence;
  createdBy: string;
  createdAt?: { seconds: bigint; nanos: number };
  participants: { userId: string; username: string; joinedAt?: { seconds: bigint; nanos: number } }[];
}): CalendarEvent {
  return {
    id: e.id,
    circleId: e.circleId,
    circleName: e.circleName,
    title: e.title,
    description: e.description,
    startsAt: protoTs(e.startsAt),
    durationMin: e.durationMin,
    editorRoomId: e.editorRoomId,
    whiteboardRoomId: e.whiteboardRoomId,
    recurrence: recurrenceLabel(e.recurrence),
    createdBy: e.createdBy,
    createdAt: protoTs(e.createdAt),
    participants: e.participants.map((p) => ({
      userId: p.userId,
      username: p.username,
      joinedAt: protoTs(p.joinedAt),
    })),
  };
}

const client = createPromiseClient(EventsService, transport);

export async function listMyEvents(window?: { from?: Date; to?: Date }): Promise<CalendarEvent[]> {
  const req: Parameters<typeof client.listMyEvents>[0] = {};
  if (window?.from) req.from = Timestamp.fromDate(window.from);
  if (window?.to) req.to = Timestamp.fromDate(window.to);
  const resp = await client.listMyEvents(req);
  return (resp.items ?? []).map((i) => unwrap(i as never));
}

export async function getEvent(eventId: string): Promise<CalendarEvent> {
  const resp = await client.getEvent({ eventId });
  return unwrap(resp as never);
}

export async function joinEvent(eventId: string): Promise<CalendarEvent> {
  const resp = await client.joinEvent({ eventId });
  return unwrap(resp as never);
}

export async function leaveEvent(eventId: string): Promise<boolean> {
  const resp = await client.leaveEvent({ eventId });
  return resp.ok;
}
