// Desktop-side wrapper for the Cue interview-prep RPCs.
//
// Phase J / C6 (P1) — single-active per user. Cue's main process owns
// the bearer auth; the renderer goes through these REST endpoints via
// IPC so the renderer never sees the token.
//
// REST (not Connect-RPC) for the same reason sessions.ts does: four
// small endpoints don't justify regenerating Connect-TS stubs inside
// the desktop bundle. Translation happens at this boundary
// (snake_case → camelCase).

import type {
  ActivePrepDTO,
  ParseCVResultDTO,
  ParseJDResultDTO,
  ParsedCVDTO,
  ParsedJDDTO,
  StartPrepResultDTO,
} from '@shared/ipc';

import type { RuntimeConfig } from '../config/bootstrap';
import { getValidSession } from '../auth/refresh';

export interface InterviewPrepClient {
  parseCV: (text: string, filename?: string) => Promise<ParseCVResultDTO>;
  parseJD: (text?: string, url?: string) => Promise<ParseJDResultDTO>;
  start: (
    parsedCV: ParsedCVDTO,
    parsedJD: ParsedJDDTO,
    cvText: string,
    jdText: string,
  ) => Promise<StartPrepResultDTO>;
  getActive: () => Promise<ActivePrepDTO>;
  end: () => Promise<void>;
}

export function createInterviewPrepClient(cfg: RuntimeConfig): InterviewPrepClient {
  const url = (p: string) => `${cfg.apiBaseURL.replace(/\/+$/, '')}${p}`;

  const authHeaders = async (): Promise<Record<string, string>> => {
    const s = await getValidSession({ apiBaseURL: cfg.apiBaseURL });
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
      throw new Error(`${method} ${path}: ${resp.status} ${text.slice(0, 240)}`);
    }
    return (await resp.json()) as T;
  };

  // Wire payloads come back snake_case. Translate at the seam so
  // renderer code can work in camelCase.
  const parsedCVFromRaw = (raw: Record<string, unknown> | null | undefined): ParsedCVDTO => ({
    name: String(raw?.name ?? ''),
    experienceYears: Number(raw?.experience_years ?? raw?.experienceYears ?? 0),
    currentRole: String(raw?.current_role ?? raw?.currentRole ?? ''),
    topSkills: ((raw?.top_skills ?? raw?.topSkills ?? []) as string[]).map((s) => String(s)),
    summary: String(raw?.summary ?? ''),
    education: String(raw?.education ?? ''),
  });

  const parsedJDFromRaw = (raw: Record<string, unknown> | null | undefined): ParsedJDDTO => ({
    company: String(raw?.company ?? ''),
    role: String(raw?.role ?? ''),
    seniority: String(raw?.seniority ?? ''),
    keySkills: ((raw?.key_skills ?? raw?.keySkills ?? []) as string[]).map((s) => String(s)),
    descriptionSummary: String(raw?.description_summary ?? raw?.descriptionSummary ?? ''),
    language: String(raw?.language ?? ''),
  });

  const parsedCVToRaw = (p: ParsedCVDTO): Record<string, unknown> => ({
    name: p.name,
    experience_years: p.experienceYears,
    current_role: p.currentRole,
    top_skills: p.topSkills,
    summary: p.summary,
    education: p.education,
  });
  const parsedJDToRaw = (p: ParsedJDDTO): Record<string, unknown> => ({
    company: p.company,
    role: p.role,
    seniority: p.seniority,
    key_skills: p.keySkills,
    description_summary: p.descriptionSummary,
    language: p.language,
  });

  return {
    parseCV: async (text, filename) => {
      const raw = await call<Record<string, unknown>>(
        'POST',
        '/api/v1/copilot/interview-prep/parse-cv',
        { cv_text: text, filename: filename ?? '' },
      );
      return {
        parsed: parsedCVFromRaw(raw.parsed as Record<string, unknown> | undefined),
        model: String(raw.model ?? ''),
      };
    },
    parseJD: async (text, urlInput) => {
      const raw = await call<Record<string, unknown>>(
        'POST',
        '/api/v1/copilot/interview-prep/parse-jd',
        { jd_text: text ?? '', jd_url: urlInput ?? '' },
      );
      return {
        parsed: parsedJDFromRaw(raw.parsed as Record<string, unknown> | undefined),
        model: String(raw.model ?? ''),
      };
    },
    start: async (parsedCV, parsedJD, cvText, jdText) => {
      const raw = await call<Record<string, unknown>>(
        'POST',
        '/api/v1/copilot/interview-prep/start',
        {
          parsed_cv: parsedCVToRaw(parsedCV),
          parsed_jd: parsedJDToRaw(parsedJD),
          cv_text: cvText,
          jd_text: jdText,
        },
      );
      return {
        sessionId: String(raw.session_id ?? raw.sessionId ?? ''),
        startedAt: String(raw.started_at ?? raw.startedAt ?? ''),
        prepPromptPreview: String(raw.prep_prompt_preview ?? raw.prepPromptPreview ?? ''),
      };
    },
    getActive: async () => {
      const raw = await call<Record<string, unknown>>(
        'GET',
        '/api/v1/copilot/interview-prep/active',
      );
      const active = Boolean(raw.active);
      if (!active) {
        return {
          active: false,
          sessionId: '',
          parsedCV: parsedCVFromRaw(undefined),
          parsedJD: parsedJDFromRaw(undefined),
          startedAt: '',
          company: '',
          role: '',
        };
      }
      return {
        active: true,
        sessionId: String(raw.session_id ?? raw.sessionId ?? ''),
        parsedCV: parsedCVFromRaw(raw.parsed_cv as Record<string, unknown> | undefined),
        parsedJD: parsedJDFromRaw(raw.parsed_jd as Record<string, unknown> | undefined),
        startedAt: String(raw.started_at ?? raw.startedAt ?? ''),
        company: String(raw.company ?? ''),
        role: String(raw.role ?? ''),
      };
    },
    end: async () => {
      await call<Record<string, unknown>>(
        'POST',
        '/api/v1/copilot/interview-prep/end',
        {},
      );
    },
  };
}
