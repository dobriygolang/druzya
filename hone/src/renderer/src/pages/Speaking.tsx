// Speaking — Phase J / H4 (P1) fourth English modality.
//
// Shadowing exercise loop:
//   1. Pick a prompt from level-filtered catalog (B1/B2/C1).
//   2. Listen to reference (TTS via window.speechSynthesis fallback, or
//      backend audio_url когда оно появится).
//   3. Record 5-15s mic capture.
//   4. Backend STT → LLM grade → pronunciation + fluency + word-diff +
//      coach feedback.
//   5. Sparkline below shows last 14 sessions' pronunciation scores.
//
// Layout: two-pane same shape as Reading / Listening.
//   - left (260px): exercise list filtered by level pill row.
//   - right: welcome OR active exercise (prompt + record + result).
//
// 2026-05-12 v2 visual: B/W only, hairline borders, JetBrains Mono for
// scores. `#FF3B30` shows только как recording-indicator dot в MicRecorder.

import { useCallback, useState } from 'react';

import {
  gradeSpeaking,
  listSpeakingExercises,
  listSpeakingHistory,
  type SpeakingExercise,
  type SpeakingGradeResult,
  type SpeakingLevel,
  type SpeakingSession,
} from '../api/speaking';
import { AudioPlayer, BlobPlayer } from '../components/speaking/AudioPlayer';
import { MicRecorder } from '../components/speaking/MicRecorder';
import { WordDiffView } from '../components/speaking/WordDiff';
import { useDataState } from '../hooks/useDataState';

type Mode =
  | { kind: 'welcome' }
  | { kind: 'exercise'; exercise: SpeakingExercise };

type Grading =
  | { kind: 'idle' }
  | { kind: 'recorded'; blob: Blob; durationMs: number }
  | { kind: 'grading'; blob: Blob; durationMs: number }
  | { kind: 'graded'; blob: Blob; result: SpeakingGradeResult }
  | { kind: 'error'; message: string; blob?: Blob };

const monoFont = "'JetBrains Mono', ui-monospace, monospace";

const captionMonoTiny: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
};

const LEVELS: readonly (SpeakingLevel | 'ALL')[] = ['ALL', 'B1', 'B2', 'C1'];

export function SpeakingPage() {
  const [levelFilter, setLevelFilter] = useState<SpeakingLevel | 'ALL'>('ALL');
  const [mode, setMode] = useState<Mode>({ kind: 'welcome' });
  const [grading, setGrading] = useState<Grading>({ kind: 'idle' });
  const [historyReloadKey, setHistoryReloadKey] = useState(0);

  const exercisesState = useDataState<SpeakingExercise[]>(
    () => listSpeakingExercises(levelFilter === 'ALL' ? undefined : levelFilter),
    [levelFilter],
  );
  const historyState = useDataState<SpeakingSession[]>(
    () => listSpeakingHistory(14),
    [historyReloadKey],
  );

  const exercises = exercisesState.data ?? [];
  const history = historyState.data ?? [];

  const handleSelectExercise = useCallback((ex: SpeakingExercise) => {
    setMode({ kind: 'exercise', exercise: ex });
    setGrading({ kind: 'idle' });
  }, []);

  const handleRecorded = useCallback((blob: Blob, durationMs: number) => {
    setGrading({ kind: 'recorded', blob, durationMs });
  }, []);

  const handleGrade = useCallback(async () => {
    if (grading.kind !== 'recorded' || mode.kind !== 'exercise') return;
    const { blob, durationMs } = grading;
    setGrading({ kind: 'grading', blob, durationMs });
    try {
      const clientSessionId = crypto.randomUUID();
      const result = await gradeSpeaking({
        exerciseId: mode.exercise.id,
        clientSessionId,
        audioBlob: blob,
        durationMs,
      });
      setGrading({ kind: 'graded', blob, result });
      setHistoryReloadKey((k) => k + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setGrading({ kind: 'error', message: msg, blob });
    }
  }, [grading, mode]);

  const handleRetry = useCallback(() => {
    setGrading({ kind: 'idle' });
  }, []);

  return (
    <div
      className="motion-page-in"
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 96,
        display: 'flex',
        overflow: 'hidden',
      }}
    >
      {/* Left rail — level filter + exercise list */}
      <aside
        style={{
          width: 280,
          borderRight: '1px solid var(--hair)',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            padding: '14px 16px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            borderBottom: '1px solid var(--hair)',
          }}
        >
          <div style={captionMonoTiny}>Level</div>
          <div className="flex-wrap-row" style={{ gap: 4 }}>
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLevelFilter(l)}
                className="focus-ring motion-press"
                style={levelChipStyle(levelFilter === l)}
              >
                {l === 'ALL' ? 'All' : l}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 16px' }}>
          {exercisesState.status === 'loading' && exercises.length === 0 && (
            <div style={hintStyle}>Loading exercises…</div>
          )}
          {exercisesState.status === 'error' && (
            <div style={hintStyle}>Failed to load: {exercisesState.error?.message}</div>
          )}
          {exercisesState.status === 'ready' && exercises.length === 0 && (
            <div style={hintStyle}>No prompts at this level.</div>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {exercises.map((ex) => {
              const active = mode.kind === 'exercise' && mode.exercise.id === ex.id;
              return (
                <li key={ex.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectExercise(ex)}
                    className="focus-ring motion-press"
                    style={exerciseRowStyle(active)}
                  >
                    <div
                      style={{
                        ...captionMonoTiny,
                        marginBottom: 4,
                        color: active ? 'var(--ink-90)' : 'var(--ink-40)',
                      }}
                    >
                      {ex.level} · {ex.topic || 'general'}
                    </div>
                    <div style={{ fontSize: 13, color: active ? 'var(--ink)' : 'var(--ink-60)', lineHeight: 1.35 }}>
                      {ex.prompt}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      {/* Right pane — exercise interaction */}
      <main style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 24px 64px' }}>
          {mode.kind === 'welcome' ? (
            <WelcomePanel />
          ) : (
            <ActiveExercise
              exercise={mode.exercise}
              grading={grading}
              onRecorded={handleRecorded}
              onGrade={handleGrade}
              onRetry={handleRetry}
            />
          )}

          <HistorySection history={history} />
        </div>
      </main>
    </div>
  );
}

function WelcomePanel() {
  return (
    <div>
      <header style={{ marginBottom: 24 }}>
        <div style={{ ...captionMonoTiny, marginBottom: 6 }}>SPEAKING</div>
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--type-h1-size)',
            lineHeight: 'var(--type-h1-lh)',
            letterSpacing: 'var(--type-h1-ls)',
            fontWeight: 'var(--type-h1-weight)',
            color: 'var(--ink)',
          }}
        >
          Shadow English aloud.
        </h1>
        <p style={{ marginTop: 8, fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-lh)', color: 'var(--ink-60)' }}>
          Pick a prompt, hear how it sounds, then record yourself. AI scores pronunciation +
          fluency and flags the word that needs work.
        </p>
      </header>
      <ol style={{ paddingLeft: 18, color: 'var(--ink-60)', fontSize: 13, lineHeight: 1.6 }}>
        <li>Pick a prompt on the left — start at B2 for senior-interview phrasing.</li>
        <li>Press Listen to hear the reference.</li>
        <li>Press Record and shadow it back (5-15 seconds).</li>
        <li>Press Stop. We transcribe and grade.</li>
      </ol>
    </div>
  );
}

interface ActiveProps {
  exercise: SpeakingExercise;
  grading: Grading;
  onRecorded: (blob: Blob, durationMs: number) => void;
  onGrade: () => void;
  onRetry: () => void;
}

function ActiveExercise({ exercise, grading, onRecorded, onGrade, onRetry }: ActiveProps) {
  const gradedResult = grading.kind === 'graded' ? grading.result : null;
  const isGrading = grading.kind === 'grading';
  const isError = grading.kind === 'error' ? grading.message : null;
  const recordedBlob = grading.kind === 'recorded' || grading.kind === 'graded' || grading.kind === 'error' ? grading.blob ?? null : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header>
        <div style={{ ...captionMonoTiny, marginBottom: 6 }}>
          {exercise.level} · {exercise.topic || 'general'}
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 'var(--type-h2-size)',
            lineHeight: 1.4,
            color: 'var(--ink)',
            fontWeight: 500,
          }}
        >
          {exercise.prompt}
        </p>
      </header>

      <section
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: 16,
          border: '1px solid var(--hair)',
          borderRadius: 'var(--radius-outer)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={captionMonoTiny}>Reference</div>
          <AudioPlayer src={exercise.audioUrl} prompt={exercise.prompt} disabled={isGrading} />
        </div>
        <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={captionMonoTiny}>Your recording</div>
          <MicRecorder maxSeconds={15} onRecorded={onRecorded} disabled={isGrading} />
        </div>

        {recordedBlob && (
          <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={captionMonoTiny}>Playback</div>
            <BlobPlayer blob={recordedBlob} disabled={isGrading} />
          </div>
        )}

        {grading.kind === 'recorded' && (
          <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 14 }}>
            <button
              type="button"
              onClick={onGrade}
              className="focus-ring motion-press"
              style={primaryBtnStyle()}
            >
              Grade my speaking
            </button>
          </div>
        )}
        {isGrading && (
          <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 14, color: 'var(--ink-60)', fontSize: 12 }}>
            Grading… Whisper transcribes, then the coach scores it. ~5-12s.
          </div>
        )}
        {isError && (
          <div
            role="alert"
            style={{
              borderTop: '1px solid var(--hair)',
              paddingTop: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              color: 'var(--ink-60)',
              fontSize: 12,
            }}
          >
            <span>Grading failed: {isError}</span>
            <button
              type="button"
              onClick={onRetry}
              className="focus-ring motion-press"
              style={secondaryBtnStyle()}
            >
              Try again
            </button>
          </div>
        )}
      </section>

      {gradedResult && (
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            padding: 16,
            border: '1px solid var(--hair-2)',
            borderRadius: 'var(--radius-outer)',
          }}
        >
          <div style={{ ...captionMonoTiny }}>Feedback</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <ScoreTile label="Pronunciation" value={gradedResult.pronunciationScore} />
            <ScoreTile label="Fluency" value={gradedResult.fluencyScore} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>{gradedResult.coachFeedback}</div>
          {gradedResult.userTranscript && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={captionMonoTiny}>Heard</div>
              <div
                style={{
                  fontFamily: monoFont,
                  fontSize: 12,
                  color: 'var(--ink-60)',
                  background: 'transparent',
                  border: '1px solid var(--hair)',
                  borderRadius: 'var(--radius-inner)',
                  padding: '8px 12px',
                  lineHeight: 1.5,
                }}
              >
                {gradedResult.userTranscript}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={captionMonoTiny}>Word-level</div>
            <WordDiffView diffs={gradedResult.wordDiffs} />
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="focus-ring motion-press"
            style={secondaryBtnStyle()}
          >
            Try again
          </button>
        </section>
      )}
    </div>
  );
}

function ScoreTile({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        padding: 12,
        border: '1px solid var(--hair)',
        borderRadius: 'var(--radius-inner)',
        background: 'transparent',
      }}
    >
      <div style={captionMonoTiny}>{label}</div>
      <div
        style={{
          marginTop: 6,
          fontFamily: monoFont,
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: '-0.018em',
          color: 'var(--ink)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
        <span style={{ fontSize: 12, color: 'var(--ink-40)', marginLeft: 4 }}>/100</span>
      </div>
    </div>
  );
}

function HistorySection({ history }: { history: SpeakingSession[] }) {
  if (history.length === 0) return null;
  const max = 100;
  const recent = history.slice(0, 14).reverse(); // oldest-on-left for trend
  const avg =
    Math.round(
      (history.reduce((acc, s) => acc + s.pronunciationScore, 0) / history.length) || 0,
    );
  return (
    <section style={{ marginTop: 32 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={captionMonoTiny}>Last {history.length} sessions</div>
        <div style={{ fontFamily: monoFont, fontSize: 11, color: 'var(--ink-40)' }}>
          avg pronunciation <span style={{ color: 'var(--ink)' }}>{avg}/100</span>
        </div>
      </div>

      {/* Sparkline — simple bar chart, no SVG library needed */}
      <div
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 3,
          padding: 8,
          border: '1px solid var(--hair)',
          borderRadius: 'var(--radius-inner)',
        }}
      >
        {recent.map((s) => {
          const v = Math.max(0, Math.min(max, s.pronunciationScore));
          const pct = v / max;
          return (
            <div
              key={s.id}
              title={`${s.pronunciationScore}/100 — ${s.coachFeedback || s.prompt}`}
              style={{
                flex: 1,
                height: `${Math.max(8, pct * 100)}%`,
                minWidth: 4,
                background: 'rgba(255, 255, 255, 0.55)',
                borderRadius: 1,
              }}
            />
          );
        })}
      </div>
    </section>
  );
}

const hintStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 12,
  color: 'var(--ink-40)',
};

function levelChipStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 10px',
    background: active ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
    color: active ? 'var(--ink)' : 'var(--ink-60)',
    border: '1px solid var(--hair-2)',
    borderRadius: 999,
    cursor: 'pointer',
    fontFamily: monoFont,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    transition:
      'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
  };
}

function exerciseRowStyle(active: boolean): React.CSSProperties {
  return {
    width: '100%',
    padding: '10px 12px',
    background: active ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
    border: '1px solid',
    borderColor: active ? 'var(--hair-2)' : 'transparent',
    borderRadius: 'var(--radius-inner)',
    textAlign: 'left',
    cursor: 'pointer',
    color: 'var(--ink)',
    minWidth: 0,
    transition:
      'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard)',
  };
}

function primaryBtnStyle(): React.CSSProperties {
  return {
    padding: '8px 18px',
    background: 'var(--ink)',
    color: 'var(--ink-on-fill)',
    border: '1px solid var(--ink)',
    borderRadius: 999,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
  };
}

function secondaryBtnStyle(): React.CSSProperties {
  return {
    padding: '6px 14px',
    background: 'transparent',
    color: 'var(--ink)',
    border: '1px solid var(--hair-2)',
    borderRadius: 999,
    cursor: 'pointer',
    fontSize: 12,
    alignSelf: 'flex-start',
  };
}
