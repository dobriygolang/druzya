// api/tracks.ts — Hone-side wrapper для curated learning tracks (Phase 2e).
//
// Используется только на чтение для Today chip: «Track: <name> · step
// N/M». Мутации (Join/Pause/Advance) живут на web /atlas/track/:slug —
// Hone не дублирует UI, чтобы оставаться lightweight surface'ом.
import { createPromiseClient } from '@connectrpc/connect';
import { TracksService } from '@generated/pb/druz9/v1/tracks_connect';

import { transport } from './transport';

export interface ActiveTrack {
  trackId: string;
  slug: string;
  name: string;
  accentColor: string;
  currentStep: number;
  stepsTotal: number;
}

const client = createPromiseClient(TracksService, transport);

// activeTrack — первый non-paused / non-completed enrolment. Подходит
// для chip, который показывает один статус: «вот этим я сейчас занят».
export async function activeTrack(): Promise<ActiveTrack | null> {
  try {
    const resp = await client.listUserTracks({});
    for (const item of resp.items) {
      const enrol = item.enrolment;
      if (!enrol) continue;
      if (enrol.pausedAt) continue;
      if (enrol.completedAt) continue;
      const tr = item.track;
      if (!tr) continue;
      return {
        trackId: tr.id,
        slug: tr.slug,
        name: tr.name,
        accentColor: tr.accentColor || '#A78BFA',
        currentStep: enrol.currentStep,
        stepsTotal: item.stepsTotal,
      };
    }
    return null;
  } catch {
    return null;
  }
}
