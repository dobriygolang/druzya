// api/listening.ts — Wave 6.1 Listening-модуль API client.
// Parallel to api/reading.ts; same POJO-unwrapping conventions.
import { createPromiseClient } from '@connectrpc/connect';
import { HoneService } from '@generated/pb/druz9/v1/hone_connect';

import { transport } from './transport';

export interface ListeningMaterial {
  id: string;
  title: string;
  audioUrl: string;
  transcriptMd: string; // empty in list responses
  archivedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

const client = createPromiseClient(HoneService, transport);

function protoTs(ts: { seconds: bigint; nanos: number } | undefined): Date | null {
  if (!ts) return null;
  const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
  if (ms <= 0) return null;
  return new Date(ms);
}

type ProtoMaterial = {
  id: string;
  title: string;
  audioUrl: string;
  transcriptMd: string;
  archivedAt?: { seconds: bigint; nanos: number };
  createdAt?: { seconds: bigint; nanos: number };
  updatedAt?: { seconds: bigint; nanos: number };
};

function unwrap(m: ProtoMaterial): ListeningMaterial {
  return {
    id: m.id,
    title: m.title,
    audioUrl: m.audioUrl,
    transcriptMd: m.transcriptMd,
    archivedAt: protoTs(m.archivedAt),
    createdAt: protoTs(m.createdAt),
    updatedAt: protoTs(m.updatedAt),
  };
}

export async function listListeningMaterials(limit = 100): Promise<ListeningMaterial[]> {
  const resp = await client.listListeningMaterials({ limit });
  return resp.items.map((m) => unwrap(m as unknown as ProtoMaterial));
}

export async function getListeningMaterial(id: string): Promise<ListeningMaterial> {
  const resp = await client.getListeningMaterial({ id });
  return unwrap(resp as unknown as ProtoMaterial);
}

export async function addListeningMaterial(args: {
  title: string;
  audioUrl: string;
  transcriptMd: string;
}): Promise<ListeningMaterial> {
  const resp = await client.addListeningMaterial({
    title: args.title,
    audioUrl: args.audioUrl,
    transcriptMd: args.transcriptMd,
  });
  return unwrap(resp as unknown as ProtoMaterial);
}

export async function archiveListeningMaterial(id: string): Promise<void> {
  await client.archiveListeningMaterial({ id });
}
