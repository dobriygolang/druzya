// Zustand store that owns:
//   - wizard step state (cv / jd / review / launch);
//   - parsed CV / JD shapes (filled by ParseCV / ParseJD calls);
//   - raw text inputs (so we can re-parse on tweaks without re-uploading);
//   - the user's CURRENT active prep (refreshed via interviewPrep.getActive).
//
// The wizard component subscribes; the Settings + Compact / Expanded
// surfaces read `active` to render a "Prep mode: Google L4 Backend"
// chip and an "End prep" button.

import { create } from 'zustand';

import type {
  ActivePrepDTO,
  ParsedCVDTO,
  ParsedJDDTO,
} from '@shared/ipc';

// EMPTY_PARSED_CV / EMPTY_PARSED_JD are stable references so the
// wizard's `useEffect` reset doesn't trigger spurious re-renders.
export const EMPTY_PARSED_CV: ParsedCVDTO = {
  name: '',
  experienceYears: 0,
  currentRole: '',
  topSkills: [],
  summary: '',
  education: '',
};
export const EMPTY_PARSED_JD: ParsedJDDTO = {
  company: '',
  role: '',
  seniority: '',
  keySkills: [],
  descriptionSummary: '',
  language: '',
};
export const EMPTY_ACTIVE: ActivePrepDTO = {
  active: false,
  sessionId: '',
  parsedCV: EMPTY_PARSED_CV,
  parsedJD: EMPTY_PARSED_JD,
  startedAt: '',
  company: '',
  role: '',
};

export type WizardStep = 'cv' | 'jd' | 'review' | 'launch';

interface InterviewPrepState {
  // Wizard local state — lives until the user closes the window.
  step: WizardStep;
  cvText: string;
  cvFilename: string;
  parsedCV: ParsedCVDTO;
  cvParseError: string;
  cvParsing: boolean;

  jdText: string;
  jdURL: string;
  parsedJD: ParsedJDDTO;
  jdParseError: string;
  jdParsing: boolean;

  starting: boolean;
  startError: string;

  // Current server-side state. Bootstrapped on window mount + refreshed
  // after start / end.
  active: ActivePrepDTO;
  activeLoading: boolean;
}

interface InterviewPrepActions {
  setStep: (s: WizardStep) => void;
  setCV: (text: string, filename?: string) => void;
  setJDText: (text: string) => void;
  setJDURL: (url: string) => void;
  parseCV: () => Promise<void>;
  parseJD: () => Promise<void>;
  pickCVFile: () => Promise<void>;
  start: () => Promise<{ sessionId: string }>;
  reset: () => void;
  bootstrap: () => Promise<void>;
  end: () => Promise<void>;
}

export const useInterviewPrepStore = create<InterviewPrepState & InterviewPrepActions>(
  (set, get) => ({
    step: 'cv',
    cvText: '',
    cvFilename: '',
    parsedCV: EMPTY_PARSED_CV,
    cvParseError: '',
    cvParsing: false,

    jdText: '',
    jdURL: '',
    parsedJD: EMPTY_PARSED_JD,
    jdParseError: '',
    jdParsing: false,

    starting: false,
    startError: '',

    active: EMPTY_ACTIVE,
    activeLoading: false,

    setStep: (s) => set({ step: s }),
    setCV: (text, filename) =>
      set({
        cvText: text,
        cvFilename: filename ?? '',
        cvParseError: '',
        // Reset parsed CV when the source changes — user must re-parse
        // before advancing.
        parsedCV: EMPTY_PARSED_CV,
      }),
    setJDText: (text) =>
      set({
        jdText: text,
        // Keep URL field but clear JD parse + error so the user can
        // re-parse cleanly.
        parsedJD: EMPTY_PARSED_JD,
        jdParseError: '',
      }),
    setJDURL: (url) =>
      set({ jdURL: url, parsedJD: EMPTY_PARSED_JD, jdParseError: '' }),

    parseCV: async () => {
      const { cvText, cvFilename } = get();
      const t = cvText.trim();
      if (!t) {
        set({ cvParseError: 'Загрузите файл или вставьте текст резюме.' });
        return;
      }
      set({ cvParsing: true, cvParseError: '' });
      try {
        const res = await window.druz9.interviewPrep.parseCV({
          text: t,
          filename: cvFilename,
        });
        set({ parsedCV: res.parsed, cvParsing: false });
      } catch (err) {
        set({
          cvParsing: false,
          cvParseError: err instanceof Error ? err.message : 'CV parse failed',
        });
      }
    },

    parseJD: async () => {
      const { jdText, jdURL } = get();
      const t = jdText.trim();
      const u = jdURL.trim();
      if (!t && !u) {
        set({ jdParseError: 'Вставьте текст вакансии или URL.' });
        return;
      }
      set({ jdParsing: true, jdParseError: '' });
      try {
        const res = await window.druz9.interviewPrep.parseJD({
          text: t || undefined,
          url: t ? undefined : u || undefined,
        });
        set({ parsedJD: res.parsed, jdParsing: false });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'JD parse failed';
        // URL-fetch errors are common (LinkedIn / hh.ru bot-block).
        // Surface a clearer fallback hint when the message looks like
        // a fetch failure.
        const friendly =
          /fetch|status|404|403|503|host/i.test(msg) && u
            ? 'Не удалось получить вакансию по ссылке (сайт блокирует ботов). Вставьте текст вручную.'
            : msg;
        set({ jdParsing: false, jdParseError: friendly });
      }
    },

    pickCVFile: async () => {
      const r = await window.druz9.interviewPrep.pickCV();
      if (!r.ok) {
        // r.text is empty either because the user cancelled (no error)
        // or main couldn't extract (e.g. scanned PDF). Distinguish by
        // filename: empty = cancel, non-empty = extract failure.
        if (r.filename) {
          set({
            cvParseError:
              'Не удалось извлечь текст из этого файла (возможно, скан). Вставьте текст резюме вручную.',
          });
        }
        return;
      }
      set({
        cvText: r.text,
        cvFilename: r.filename,
        cvParseError: '',
        parsedCV: EMPTY_PARSED_CV,
      });
    },

    start: async () => {
      const { parsedCV, parsedJD, cvText, jdText, jdURL } = get();
      set({ starting: true, startError: '' });
      try {
        const res = await window.druz9.interviewPrep.start({
          parsedCV,
          parsedJD,
          cvText,
          // When the user pasted a URL only, jdText is empty — we store
          // jdURL as the "source" so the future re-parse path can re-fetch.
          jdText: jdText || jdURL,
        });
        // Refresh active.
        const active = await window.druz9.interviewPrep.getActive();
        set({ starting: false, active, step: 'launch' });
        return { sessionId: res.sessionId };
      } catch (err) {
        set({
          starting: false,
          startError: err instanceof Error ? err.message : 'Start failed',
        });
        throw err;
      }
    },

    reset: () =>
      set({
        step: 'cv',
        cvText: '',
        cvFilename: '',
        parsedCV: EMPTY_PARSED_CV,
        cvParseError: '',
        cvParsing: false,
        jdText: '',
        jdURL: '',
        parsedJD: EMPTY_PARSED_JD,
        jdParseError: '',
        jdParsing: false,
        starting: false,
        startError: '',
      }),

    bootstrap: async () => {
      set({ activeLoading: true });
      try {
        const active = await window.druz9.interviewPrep.getActive();
        set({ active, activeLoading: false });
      } catch {
        set({ active: EMPTY_ACTIVE, activeLoading: false });
      }
    },

    end: async () => {
      try {
        await window.druz9.interviewPrep.end();
      } catch {
        // Idempotent on the server; renderer never blocks on this.
      }
      set({ active: EMPTY_ACTIVE });
    },
  }),
);
