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

// Domain-shaped POJOs the UI consumes.
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

// Module-private Connect client. Intentionally not exported — call sites
// use the named async wrappers below so the UI layer has no direct proto
// surface.
const client = createPromiseClient(HoneService, transport);

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
