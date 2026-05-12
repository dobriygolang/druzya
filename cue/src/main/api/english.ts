// Desktop wrapper for POST /api/v1/hone/writing/grade — Wave 6.2 Cue
// English mode. Same bearer-from-keychain REST pattern as the other
// main-side API clients (suggestion.ts, etc.). The endpoint itself
// landed in Wave 4.4; we just call it from Cue's main process and
// surface the structured feedback on the EnglishPolish window.

import type { EnglishPolishCategory, EnglishPolishResult } from '@shared/ipc';

import { getValidSession } from '../auth/refresh';
import type { RuntimeConfig } from '../config/bootstrap';

export interface EnglishPolishClient {
  polish: (text: string) => Promise<EnglishPolishResult>;
}

const KNOWN_CATEGORIES: ReadonlySet<EnglishPolishCategory> = new Set([
  'grammar',
  'vocab',
  'style',
  'clarity',
]);

function normalizeCategory(c: unknown): EnglishPolishCategory {
  if (typeof c === 'string' && KNOWN_CATEGORIES.has(c as EnglishPolishCategory)) {
    return c as EnglishPolishCategory;
  }
  // Backend already coerces unknowns to 'style'; mirror here as defence
  // in depth for older deployments / proxy mangling.
  return 'style';
}

export function createEnglishPolishClient(cfg: RuntimeConfig): EnglishPolishClient {
  const url = (p: string) => `${cfg.apiBaseURL.replace(/\/+$/, '')}${p}`;

  return {
    polish: async (text) => {
      const trimmed = text.trim();
      if (trimmed === '') {
        // Avoid a round-trip when there's nothing to grade — backend
        // would return InvalidArgument anyway.
        return { overallScore: 0, issues: [] };
      }
      const s = await getValidSession({ apiBaseURL: cfg.apiBaseURL });
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (s) headers.Authorization = `Bearer ${s.accessToken}`;

      const resp = await fetch(url('/api/v1/hone/writing/grade'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          // Cue users haven't authored a «title» — leave empty; backend
          // grader is fine without it.
          title: '',
          text: trimmed,
        }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`POST /hone/writing/grade: ${resp.status} ${body.slice(0, 200)}`);
      }
      const raw = (await resp.json()) as Record<string, unknown>;
      const issuesRaw = Array.isArray(raw.issues) ? (raw.issues as unknown[]) : [];
      const issues = issuesRaw
        .map((it) => (typeof it === 'object' && it !== null ? (it as Record<string, unknown>) : null))
        .filter((it): it is Record<string, unknown> => it !== null)
        .map((it) => ({
          excerpt: String(it.excerpt ?? ''),
          category: normalizeCategory(it.category),
          suggestion: String(it.suggestion ?? ''),
          explanation: String(it.explanation ?? ''),
        }));
      const score = Number(raw.overall_score ?? raw.overallScore ?? 0);
      return {
        overallScore: Math.max(0, Math.min(100, isFinite(score) ? Math.round(score) : 0)),
        issues,
      };
    },
  };
}
