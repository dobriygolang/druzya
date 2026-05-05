// api/insights.ts — Connect-RPC wrapper for the insight stream.
//
// Hone uses just two operations: list (per-surface) and ack
// (follow / dismiss). The full schema lives on web; mutations like
// generation aren't exposed here.
import { createPromiseClient } from '@connectrpc/connect';
import { IntelligenceService } from '@generated/pb/druz9/v1/intelligence_connect';
import { InsightSeverity } from '@generated/pb/druz9/v1/intelligence_pb';

import { transport } from './transport';

export type Severity = 'cruise' | 'nudge' | 'warn' | 'critical';

export interface Insight {
  id: string;
  surface: string;
  severity: Severity;
  anchor: string;
  headline: string;
  evidence: string;
  interpret: string;
  lever: string;
  deepLink: string;
  skillKey: string;
  codexSlug: string;
}

const client = createPromiseClient(IntelligenceService, transport);

function severityFromProto(s: InsightSeverity): Severity {
  switch (s) {
    case InsightSeverity.CRITICAL: return 'critical';
    case InsightSeverity.WARN: return 'warn';
    case InsightSeverity.NUDGE: return 'nudge';
    default: return 'cruise';
  }
}

export async function listInsights(surface = 'today', limit = 5): Promise<Insight[]> {
  const page = await listInsightsPage({ surface, limit });
  return page.items;
}

/** Offset-paginated variant. Severity-ranked feed = offset+limit beats
 *  cursor (the CASE-derived sort key has no monotonic anchor). Returns
 *  rows + total live count for «N of M» UI. UI-side page controls
 *  deferred to a UX pass — this helper exposes the wire shape. */
export async function listInsightsPage(args: {
  surface?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: Insight[]; total: number }> {
  try {
    const resp = await client.listInsights({
      surface: args.surface ?? 'today',
      limit: args.limit ?? 5,
      offset: args.offset ?? 0,
    });
    return {
      items: resp.items.map((p) => ({
        id: p.id,
        surface: p.surface,
        severity: severityFromProto(p.severity),
        anchor: p.anchor,
        headline: p.headline,
        evidence: p.evidence,
        interpret: p.interpret,
        lever: p.lever,
        deepLink: p.deepLink,
        skillKey: p.skillKey,
        codexSlug: p.codexSlug,
      })),
      total: resp.total,
    };
  } catch {
    return { items: [], total: 0 };
  }
}

export async function ackInsight(id: string, action: 'follow' | 'dismiss'): Promise<void> {
  try {
    await client.ackInsight({ id, action });
  } catch {
    /* swallow — UI already removed the card optimistically */
  }
}
