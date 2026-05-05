// api/external.ts — External activity logging (Hone Stats / Today).
//
// Wraps HoneService's AddExternalActivity / List / Delete / SearchAtlasTopics
// RPCs into POJO-shaped helpers consumed by the «+ занятие» modal.
import { createPromiseClient } from '@connectrpc/connect';
import { HoneService } from '@generated/pb/druz9/v1/hone_connect';

import { transport } from './transport';

const client = createPromiseClient(HoneService, transport);

export type ExternalSource =
  | 'leetcode'
  | 'coursera'
  | 'hackerrank'
  | 'youtube'
  | 'book'
  | 'article'
  | 'course'
  | 'other';

export const EXTERNAL_SOURCES: { value: ExternalSource; label: string }[] = [
  { value: 'leetcode', label: 'LeetCode' },
  { value: 'coursera', label: 'Coursera' },
  { value: 'hackerrank', label: 'HackerRank' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'book', label: 'Книга' },
  { value: 'article', label: 'Статья' },
  { value: 'course', label: 'Другой курс' },
  { value: 'other', label: 'Другое' },
];

export interface ExternalActivity {
  id: string;
  source: ExternalSource;
  topicAtlasNodeId: string;
  topicFreeText: string;
  durationMin: number;
  notes: string;
  occurredAt: Date | null;
  createdAt: Date | null;
}

function protoTs(ts: { seconds: bigint; nanos: number } | undefined): Date | null {
  if (!ts) return null;
  const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
  if (ms <= 0) return null;
  return new Date(ms);
}

function unwrap(a: {
  id: string;
  source: string;
  topicAtlasNodeId: string;
  topicFreeText: string;
  durationMin: number;
  notes: string;
  occurredAt?: { seconds: bigint; nanos: number };
  createdAt?: { seconds: bigint; nanos: number };
}): ExternalActivity {
  return {
    id: a.id,
    source: a.source as ExternalSource,
    topicAtlasNodeId: a.topicAtlasNodeId,
    topicFreeText: a.topicFreeText,
    durationMin: a.durationMin,
    notes: a.notes,
    occurredAt: protoTs(a.occurredAt),
    createdAt: protoTs(a.createdAt),
  };
}

export async function addExternalActivity(args: {
  source: ExternalSource;
  topicAtlasNodeId?: string;
  topicFreeText: string;
  durationMin: number;
  notes?: string;
  occurredAtIso?: string;
}): Promise<ExternalActivity> {
  const resp = await client.addExternalActivity({
    source: args.source,
    topicAtlasNodeId: args.topicAtlasNodeId ?? '',
    topicFreeText: args.topicFreeText,
    durationMin: args.durationMin,
    notes: args.notes ?? '',
    occurredAtIso: args.occurredAtIso ?? '',
  });
  return unwrap(resp);
}

export async function listExternalActivity(args?: {
  source?: ExternalSource;
  limit?: number;
}): Promise<ExternalActivity[]> {
  const resp = await client.listExternalActivity({
    source: args?.source ?? '',
    limit: args?.limit ?? 0,
  });
  return (resp.items ?? []).map(unwrap);
}

/** Cursor-paginated variant. Empty cursor = first page; the returned
 *  nextCursor (empty when no more) feeds back into the next call.
 *  UI infinite-scroll deferred to a UX pass — wired here so a heavy
 *  Stats page can crawl history without bloating the basic call site. */
export async function listExternalActivityPage(args: {
  source?: ExternalSource;
  limit?: number;
  cursor?: string;
}): Promise<{ items: ExternalActivity[]; nextCursor: string }> {
  const resp = await client.listExternalActivity({
    source: args.source ?? '',
    limit: args.limit ?? 50,
    cursor: args.cursor ?? '',
  });
  return {
    items: (resp.items ?? []).map(unwrap),
    nextCursor: resp.nextCursor,
  };
}

export async function deleteExternalActivity(id: string): Promise<void> {
  await client.deleteExternalActivity({ id });
}

export interface AtlasTopicSuggestion {
  atlasNodeId: string;
  title: string;
  section: string;
}

export async function searchAtlasTopics(prefix: string, limit = 10): Promise<AtlasTopicSuggestion[]> {
  const resp = await client.searchAtlasTopics({ prefix, limit });
  return (resp.items ?? []).map((s) => ({
    atlasNodeId: s.atlasNodeId,
    title: s.title,
    section: s.section,
  }));
}

// listAtlasNodeTracks — bulk lookup для client-side фильтра Plan/Tasks по
// active study mode. Кешируется на ~5 минут в track store'е.
export async function listAtlasNodeTracks(): Promise<Record<string, string>> {
  const resp = await client.listAtlasNodeTracks({});
  const out: Record<string, string> = {};
  for (const it of resp.items ?? []) {
    out[it.atlasNodeId] = it.trackKind;
  }
  return out;
}
