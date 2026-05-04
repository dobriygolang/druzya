// ReflectionModal — Phase 5 5a multi-takeaway reflection.
//
// Replaces 1-line "что главное?" на 3-5 takeaways + optional confusion.
// Submit вызывает gradeReflection (TaskReflectionGrade) → quality_score
// + extracted_topics + confusion_flag, backend пишет в user_resource_log.
//
// UX:
//   - Field 1 required, 2-5 optional
//   - Auto-Tab между полями (Enter → focus next)
//   - Voice input (Web Speech API) — mic-icon в каждом поле; mac/Chrome OK
//   - lowercase microcopy
//   - B/W only — accent #FF3B30 точкой/полоской
//   - ⌘⏎ submit, Esc cancel
import { useEffect, useRef, useState } from 'react';

import { gradeReflection, type ReflectionGrade } from '../api/curation';
import { enqueue as enqueueOutbox } from '../offline/outbox';

interface Props {
  userResourceLogId: string;
  resourceTitle: string;
  expectedTopics: string[];
  allowedAtlasNodeIds: string[];
  onClose: () => void;
  onSaved: (grade: ReflectionGrade) => void;
}

const MAX_TAKEAWAYS = 5;
const MIN_TAKEAWAYS = 1;

// naiveLocalQuality — offline fallback грейд'а. Mirrors backend
// `app.naiveQuality` (см services/curation/app/reflection_grade.go) —
// чтобы offline-grade был ~consistent с server'ным когда LLM отвалился.
function naiveLocalQuality(takeaways: string[]): number {
  if (takeaways.length === 0) return 0;
  const totalLen = takeaways.reduce((s, t) => s + t.length, 0);
  const avg = totalLen / takeaways.length;
  let base = takeaways.length * 0.15;
  if (base > 0.8) base = 0.8;
  if (avg > 80) base += 0.1;
  if (base > 0.95) base = 0.95;
  return base;
}

export function ReflectionModal({
  userResourceLogId,
  resourceTitle,
  expectedTopics,
  allowedAtlasNodeIds,
  onClose,
  onSaved,
}: Props) {
  const [takeaways, setTakeaways] = useState<string[]>(['', '', '']);
  const [confusion, setConfusion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const t = setTimeout(() => inputRefs.current[0]?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void doSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filled = takeaways.filter((t) => t.trim() !== '');

  function setAt(i: number, v: string) {
    setTakeaways((prev) => prev.map((t, idx) => (idx === i ? v : t)));
  }

  function addRow() {
    if (takeaways.length >= MAX_TAKEAWAYS) return;
    setTakeaways((prev) => [...prev, '']);
    setTimeout(() => inputRefs.current[takeaways.length]?.focus(), 30);
  }

  async function doSubmit() {
    if (filled.length < MIN_TAKEAWAYS) {
      setError('at least one takeaway required');
      return;
    }
    setSubmitting(true);
    setError(null);

    const payload = {
      userResourceLogId,
      takeaways: filled,
      confusionText: confusion.trim(),
      expectedTopics,
      allowedAtlasNodeIds,
    };

    // Offline / network-fail path: enqueue + show local fallback grade.
    // Server TaskReflectionGrade overwrite'нет quality_score при reconnect
    // через UPDATE user_resource_log (idempotent — scalar overwrite).
    const localFallback = (): ReflectionGrade => ({
      qualityScore: naiveLocalQuality(filled),
      extractedTopics: expectedTopics,
      confusionFlag: confusion.trim() !== '',
    });

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await enqueueOutbox('reflection.submit', payload);
        onSaved(localFallback());
        return;
      }
      const grade = await gradeReflection(payload);
      onSaved(grade);
    } catch (e) {
      // Online attempt failed → outbox + local grade. Don't surface error
      // — UX уже handled (queued, grade shown).
      await enqueueOutbox('reflection.submit', payload);
      onSaved(localFallback());
    } finally {
      setSubmitting(false);
    }
  }

  function tryVoice(i: number) {
    const W = window as unknown as {
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: (ev: { results: { 0: { transcript: string } }[] }) => void;
        onerror: () => void;
        start: () => void;
        stop: () => void;
      };
    };
    const Ctor = W.webkitSpeechRecognition;
    if (!Ctor) {
      setError('voice input not supported in this browser');
      return;
    }
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const text = ev.results[0]?.[0]?.transcript ?? '';
      setAt(i, takeaways[i] ? takeaways[i] + ' ' + text : text);
    };
    rec.onerror = () => undefined;
    rec.start();
  }

  return (
    <div
      role="dialog"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 80,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: '90vw',
          background: '#0a0a0a',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 10,
          padding: '28px 30px 22px',
          color: 'rgba(255,255,255,0.92)',
        }}
      >
        <div className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: '.18em', textTransform: 'uppercase' }}>
          focus block done · reflection
        </div>
        <h3 style={{ margin: '8px 0 4px', fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em' }}>
          {resourceTitle || 'pomodoro'}
        </h3>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.7)', marginBottom: 18 }}>
          what did you learn? <span style={{ color: 'rgba(255,255,255,0.4)' }}>(3–5 key points · helps AI tune your plan)</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {takeaways.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span className="mono" style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', width: 16 }}>
                {i + 1}.
              </span>
              <input
                ref={(el) => {
                  inputRefs.current[i] = el;
                }}
                type="text"
                value={t}
                placeholder={i === 0 ? 'required' : 'optional'}
                onChange={(e) => setAt(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    if (i < takeaways.length - 1) {
                      inputRefs.current[i + 1]?.focus();
                    } else if (takeaways.length < MAX_TAKEAWAYS) {
                      addRow();
                    }
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '8px 10px',
                  fontSize: 13,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 5,
                  color: 'rgba(255,255,255,0.92)',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => tryVoice(i)}
                title="voice input"
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.5)',
                  width: 28,
                  height: 28,
                  borderRadius: 5,
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                ●
              </button>
            </div>
          ))}
          {takeaways.length < MAX_TAKEAWAYS && (
            <button
              type="button"
              onClick={addRow}
              className="mono"
              style={{
                marginLeft: 24,
                marginTop: 2,
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.5)',
                fontSize: 10,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              + add another
            </button>
          )}
        </div>

        <div style={{ marginTop: 20 }}>
          <div className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>
            optional · anything confused you?
          </div>
          <input
            type="text"
            value={confusion}
            onChange={(e) => setConfusion(e.target.value)}
            placeholder="…"
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: 13,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 5,
              color: 'rgba(255,255,255,0.92)',
              outline: 'none',
            }}
          />
        </div>

        {error && (
          <div className="mono" style={{ marginTop: 14, fontSize: 11, color: '#FF3B30' }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="mono"
            style={{
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.6)',
              borderRadius: 5,
              fontSize: 11,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            skip
          </button>
          <button
            type="button"
            onClick={() => void doSubmit()}
            disabled={submitting || filled.length < MIN_TAKEAWAYS}
            className="mono"
            style={{
              padding: '6px 14px',
              background: '#fff',
              color: '#000',
              border: 'none',
              borderRadius: 5,
              fontSize: 11,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              cursor: submitting ? 'progress' : 'pointer',
              opacity: filled.length < MIN_TAKEAWAYS ? 0.5 : 1,
            }}
          >
            {submitting ? 'grading…' : 'save · ⌘⏎'}
          </button>
        </div>
      </div>
    </div>
  );
}
