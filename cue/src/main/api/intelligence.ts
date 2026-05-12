// intelligence.ts — Cue Electron client for druz9 Intelligence service.
// F10 (Phase D 2026-05-12): после ready'd analysis Cue POST'ит session
// + transcript + per-stage notes к backend
// /api/v1/intelligence/interview-sessions/ingest.
//
// Wire shape mirrors `intelligence.proto` `IngestInterviewSessionRequest`:
//   company / persona / stages[{stage, self_rating, notes}] / ai_summary /
//   raw_transcript / completed_at (RFC3339, optional).
//
// Auth via Bearer token из session storage (same flow as sessions.ts).

import type { SessionAnalysis } from '@shared/types';

import { getValidSession } from '../auth/refresh';
import type { RuntimeConfig } from '../config/bootstrap';

export interface IntelligenceClient {
  ingestInterviewSession: (analysis: SessionAnalysis, persona?: string) => Promise<{ ok: boolean; error?: string }>;
}

export function createIntelligenceClient(cfg: RuntimeConfig): IntelligenceClient {
  const url = (p: string) => `${cfg.apiBaseURL.replace(/\/+$/, '')}${p}`;
  const authHeaders = async (): Promise<Record<string, string>> => {
    const s = await getValidSession({ apiBaseURL: cfg.apiBaseURL });
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (s) h.Authorization = `Bearer ${s.accessToken}`;
    return h;
  };

  return {
    async ingestInterviewSession(analysis, persona) {
      const stages = analysisToStages(analysis);
      const body = {
        // Cue analysis не привязан к company в стандартном flow — оставляем
        // пустым, backend сохранит без company-tag. Юзер сможет добавить
        // через web /tutor surface or future Cue UI.
        company: '',
        persona: persona ?? '',
        stages,
        ai_summary: composeSummary(analysis),
        raw_transcript: composeTranscript(analysis),
        completed_at: new Date().toISOString(),
      };
      try {
        const resp = await fetch(url('/api/v1/intelligence/interview-sessions/ingest'), {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          return { ok: false, error: `${resp.status}: ${text.slice(0, 200)}` };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

// ── Mappers ─────────────────────────────────────────────────────────────

// Cue's analysis section_scores → InterviewStage entries. Cue uses arbitrary
// keys like 'algorithms' / 'system_design' / 'behavioral'; we pass them
// через verbatim (backend accepts free-form `stage` string).
function analysisToStages(a: SessionAnalysis): Array<{ stage: string; self_rating: number; notes: string }> {
  const out: Array<{ stage: string; self_rating: number; notes: string }> = [];
  for (const [key, score] of Object.entries(a.sectionScores ?? {})) {
    // Map Cue 0..100 score → 1..5 self-rating bucket. 0 stays 0 (unrated).
    let rating = 0;
    if (typeof score === 'number' && score > 0) {
      rating = Math.max(1, Math.min(5, Math.round((score / 100) * 5)));
    }
    out.push({ stage: key, self_rating: rating, notes: '' });
  }
  return out;
}

function composeSummary(a: SessionAnalysis): string {
  const parts: string[] = [];
  if (a.weaknesses && a.weaknesses.length > 0) {
    parts.push(`Weaknesses: ${a.weaknesses.slice(0, 5).join(', ')}`);
  }
  if (a.overallScore > 0) {
    parts.push(`Overall ${a.overallScore}/100`);
  }
  return parts.join(' · ');
}

function composeTranscript(a: SessionAnalysis): string {
  // Cue's analysis structured fields don't carry raw transcript directly;
  // юзер может extend это позже. Для MVP — собираем доступный текст.
  const parts: string[] = []
  if (Array.isArray(a.actionItems) && a.actionItems.length > 0) {
    parts.push('Action items:')
    for (const it of a.actionItems) parts.push(`- ${String((it as { title?: string }).title ?? '')}: ${String((it as { detail?: string }).detail ?? '')}`)
  }
  if (Array.isArray(a.terminology) && a.terminology.length > 0) {
    parts.push('\nGlossary:')
    for (const t of a.terminology) parts.push(`- ${t.term}: ${t.definition}`)
  }
  return parts.join('\n')
}
