// Desktop-side wrapper for the copilot session RPCs.
//
// We go via REST (not Connect-RPC) because sessions are plain unary
// calls and adding them to the generated Connect client would mean
// regenerating TS stubs inside the desktop codebase — not worth it
// for four small endpoints. The payload shapes below mirror the REST
// routes exactly.
//
// All calls attach the user's Druz9 JWT from the keychain (same pattern
// as api/client.ts). BYOK users STILL hit these endpoints: session
// metadata (start/end/list) lives on our server; only the analysis
// itself is BYOK-locally-computed.

import type { RuntimeConfig } from '../config/bootstrap';
import { loadSession } from '../auth/keychain';
import type { Session, SessionAnalysis, SessionKind } from '@shared/types';

export interface SessionsClient {
  start: (kind: SessionKind) => Promise<Session>;
  end: (sessionId: string) => Promise<Session>;
  get: (sessionId: string) => Promise<Session>;
  getAnalysis: (sessionId: string) => Promise<SessionAnalysis>;
  list: (
    cursor: string,
    limit: number,
    kind?: SessionKind,
  ) => Promise<{ sessions: Session[]; nextCursor: string }>;
}

export function createSessionsClient(cfg: RuntimeConfig): SessionsClient {
  const url = (p: string) => `${cfg.apiBaseURL.replace(/\/+$/, '')}${p}`;

  const authHeaders = async (): Promise<Record<string, string>> => {
    const s = await loadSession();
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (s) h.Authorization = `Bearer ${s.accessToken}`;
    return h;
  };

  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const resp = await fetch(url(path), {
      method,
      headers: await authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`${method} ${path}: ${resp.status} ${text.slice(0, 200)}`);
    }
    return (await resp.json()) as T;
  };

  // REST uses snake_case; we translate at the boundary so the renderer
  // sees a consistent camelCase shape.
  const fromRawSession = (raw: Record<string, unknown>): Session => ({
    id: String(raw.id ?? ''),
    kind: String(raw.kind ?? '') as SessionKind,
    startedAt: String(raw.started_at ?? raw.startedAt ?? ''),
    finishedAt: String(raw.finished_at ?? raw.finishedAt ?? ''),
    conversationCount: Number(raw.conversation_count ?? raw.conversationCount ?? 0),
    byokOnly: Boolean(raw.byok_only ?? raw.byokOnly),
  });

  const fromRawAnalysis = (raw: Record<string, unknown>): SessionAnalysis => {
    // Phase 3 structured fields. Connect's JSON serializer emits
    // snake_case on the wire; we also accept camelCase for the (rare)
    // case the server ever switches encoders.
    const usageRaw = (raw.usage ?? null) as Record<string, unknown> | null;
    const usage = usageRaw
      ? {
          turns: Number(usageRaw.turns ?? 0),
          tokensIn: Number(usageRaw.tokens_in ?? usageRaw.tokensIn ?? 0),
          tokensOut: Number(usageRaw.tokens_out ?? usageRaw.tokensOut ?? 0),
          totalLatencyMs: Number(usageRaw.total_latency_ms ?? usageRaw.totalLatencyMs ?? 0),
        }
      : null;

    const asItems = (v: unknown) =>
      ((v as Array<Record<string, unknown>>) ?? []).map((it) => ({
        title: String(it.title ?? ''),
        detail: String(it.detail ?? ''),
      }));
    const asTerms = (v: unknown) =>
      ((v as Array<Record<string, unknown>>) ?? []).map((it) => ({
        term: String(it.term ?? ''),
        definition: String(it.definition ?? ''),
      }));

    return {
      sessionId: String(raw.session_id ?? raw.sessionId ?? ''),
      status: (raw.status as SessionAnalysis['status']) ?? '',
      overallScore: Number(raw.overall_score ?? raw.overallScore ?? 0),
      sectionScores: (raw.section_scores ?? raw.sectionScores ?? {}) as Record<string, number>,
      weaknesses: (raw.weaknesses ?? []) as string[],
      recommendations: (raw.recommendations ?? []) as string[],
      links: ((raw.links ?? []) as Array<{ label: string; url: string }>) ?? [],
      reportMarkdown: String(raw.report_markdown ?? raw.reportMarkdown ?? ''),
      reportUrl: String(raw.report_url ?? raw.reportUrl ?? ''),
      errorMessage: String(raw.error_message ?? raw.errorMessage ?? ''),
      startedAt: String(raw.started_at ?? raw.startedAt ?? ''),
      finishedAt: String(raw.finished_at ?? raw.finishedAt ?? ''),
      title: String(raw.title ?? ''),
      tldr: String(raw.tldr ?? ''),
      keyTopics: ((raw.key_topics ?? raw.keyTopics ?? []) as string[]),
      actionItems: asItems(raw.action_items ?? raw.actionItems),
      terminology: asTerms(raw.terminology),
      decisions: asItems(raw.decisions),
      openQuestions: ((raw.open_questions ?? raw.openQuestions ?? []) as string[]),
      usage,
    };
  };

  return {
    start: async (kind) => {
      const raw = await call<Record<string, unknown>>('POST', '/api/v1/copilot/sessions', { kind });
      return fromRawSession(raw);
    },
    end: async (sessionId) => {
      const raw = await call<Record<string, unknown>>('POST', `/api/v1/copilot/sessions/${sessionId}/end`, {});
      return fromRawSession(raw);
    },
    get: async (sessionId) => {
      // No dedicated "get one" RPC; cheapest is a single-item list.
      const resp = await call<{ sessions?: Record<string, unknown>[] }>(
        'GET',
        `/api/v1/copilot/sessions?limit=1`,
      );
      const first = resp.sessions?.[0];
      if (!first || first.id !== sessionId) {
        throw new Error('session not found');
      }
      return fromRawSession(first);
    },
    getAnalysis: async (sessionId) => {
      const raw = await call<Record<string, unknown>>(
        'GET',
        `/api/v1/copilot/sessions/${sessionId}/analysis`,
      );
      return fromRawAnalysis(raw);
    },
    list: async (cursor, limit, kind) => {
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      if (limit > 0) params.set('limit', String(limit));
      if (kind) params.set('kind', kind);
      const resp = await call<{ sessions?: Record<string, unknown>[]; next_cursor?: string }>(
        'GET',
        `/api/v1/copilot/sessions?${params.toString()}`,
      );
      return {
        sessions: (resp.sessions ?? []).map(fromRawSession),
        nextCursor: String(resp.next_cursor ?? ''),
      };
    },
  };
}
