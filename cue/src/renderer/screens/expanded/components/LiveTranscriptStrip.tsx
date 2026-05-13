// Live transcript status pills + speaker label bar shown above the
// composer when audio capture is running.

import { SpeakerLabel } from '../../../components/SpeakerLabel';
import { useAudioCaptureStore } from '../../../stores/audio-capture';

/**
 * LiveTranscriptStrip — компактный status-indicator. ТЕКСТ распознавания
 * НЕ дублируется тут (он живёт в input field), показываем только что
 * сейчас активно: «● Слушаем» / «● Микрофон» + ошибки если есть.
 *
 * Раньше strip полноценно повторял transcript, что путало юзера: текст
 * в strip есть, а в input нет. Унифицировано: input — единственная
 * точка где live-transcript видим.
 */
export function LiveTranscriptStrip(_props: { draft: string; setDraft: (s: string) => void }) {
  const sys = useAudioCaptureStore((s) => s.system);
  const mic = useAudioCaptureStore((s) => s.mic);

  const sysActive = sys.state === 'running' || sys.state === 'starting';
  const micActive = mic.state === 'running' || mic.state === 'starting';

  if (!sysActive && !micActive && !sys.error && !mic.error) return null;

  return (
    <div
      style={{
        padding: '6px 12px 0',
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      {sysActive && <ActivePill label="Слушаем (звук)" />}
      {micActive && <ActivePill label="Микрофон" />}
      {sys.error && <ErrorPill label="Слушать" message={sys.error} />}
      {mic.error && <ErrorPill label="Микрофон" message={mic.error} />}
    </div>
  );
}

/**
 * C4 SpeakerLabelsBar — surfaces distinct speaker chips для manual relabel.
 * Появляется только когда diarizer нашёл ≥2 разных speaker'ов в system
 * source ИЛИ когда оба source'а активны (mic vs system labelling важно
 * для LLM context'а). В одинаковом-source / single-speaker scenario'е
 * скрыта — иначе noise. Mic / speaker_0 — read-only «Я» chip (см. SpeakerLabel).
 */
export function SpeakerLabelsBar() {
  const systemChunks = useAudioCaptureStore((s) => s.system.chunks);
  const micChunks = useAudioCaptureStore((s) => s.mic.chunks);

  // Извлекаем distinct system speakerIds. Sorted ascending для стабильного
  // ordering (юзер видит ту же последовательность каждый раз).
  const systemSpeakerIds = (() => {
    const set = new Set<number>();
    for (const c of systemChunks) {
      if (typeof c.speakerId === 'number') set.add(c.speakerId);
    }
    return Array.from(set).sort((a, b) => a - b);
  })();

  const hasMic = micChunks.length > 0;
  const hasMultipleSystem = systemSpeakerIds.length >= 2;
  const visible = hasMultipleSystem || (hasMic && systemSpeakerIds.length >= 1);

  if (!visible) return null;

  return (
    <div
      style={{
        padding: '4px 12px 0',
        display: 'flex',
        gap: 4,
        flexWrap: 'wrap',
        alignItems: 'center',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      <span
        style={{
          fontSize: 10,
          color: 'var(--d9-ink-ghost)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          marginRight: 4,
        }}
      >
        Speakers
      </span>
      {hasMic && <SpeakerLabel speakerId={0} source="mic" compact />}
      {systemSpeakerIds.map((id) => (
        <SpeakerLabel key={`sys-${id}`} speakerId={id} source="system" compact />
      ))}
    </div>
  );
}

function ActivePill({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 'var(--radius-inner)',
        background: 'rgba(255, 59, 48, 0.08)',
        border: '0.5px solid rgba(255, 59, 48, 0.3)',
        color: 'var(--d9-ink-mute)',
        fontSize: 11,
        letterSpacing: '-0.005em',
      }}
    >
      <span
        aria-hidden
        style={{
          flex: 'none',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'var(--d9-accent)',
          animation: 'd9-pulse 1s ease-in-out infinite',
        }}
      />
      {label}
    </div>
  );
}

function ErrorPill({ label, message }: { label: string; message: string }) {
  return (
    <div
      title={message}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 'var(--radius-inner)',
        background: 'rgba(255, 59, 48, 0.12)',
        border: '0.5px solid rgba(255, 59, 48, 0.35)',
        color: 'var(--d9-accent)',
        fontSize: 11,
        letterSpacing: '-0.005em',
        maxWidth: 280,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      ⚠ {label}: {message}
    </div>
  );
}
