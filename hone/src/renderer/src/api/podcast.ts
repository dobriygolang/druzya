// api/podcast.ts — RPC wrapper для PodcastService.
// Используется только Hone'ом (из web мы podcast-страницу удаляем в
// отдельном коммите). audio_url приходит уже presigned MinIO'м, TTL 45
// минут — если пользователь держит плеер открытым дольше, рефетчим
// catalog.
import { createPromiseClient } from '@connectrpc/connect';
import { PodcastService } from '@generated/pb/druz9/v1/podcast_connect';
import { Section } from '@generated/pb/druz9/v1/common_pb';

import { transport } from './transport';

export interface Podcast {
  id: string;
  title: string;
  description: string;
  section: Section;
  durationSec: number;
  audioUrl: string;
  progressSec: number;
  completed: boolean;
}

const client = createPromiseClient(PodcastService, transport);

export async function listPodcasts(section?: Section): Promise<Podcast[]> {
  const resp = await client.listCatalog({ section: section ?? Section.UNSPECIFIED });
  return resp.items.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    section: p.section,
    durationSec: p.durationSec,
    audioUrl: p.audioUrl,
    progressSec: p.progressSec,
    completed: p.completed,
  }));
}

export async function updatePodcastProgress(args: {
  podcastId: string;
  progressSec: number;
  completed?: boolean;
}): Promise<{ progressSec: number; completed: boolean }> {
  const resp = await client.updateProgress({
    podcastId: args.podcastId,
    progressSec: args.progressSec,
    completed: args.completed ?? false,
  });
  return { progressSec: resp.progressSec, completed: resp.completed };
}

export { Section };
