// DebriefScreen — post-call review.
//
// Three priority blocks (in order of importance to the user):
//   1. Top quote — "вот лучший момент" with timestamp + replay button
//   2. Top mistake — "вот где затыкался" (secondary, danger-tinted)
//   3. ScoreRadar polygon
//   4. 3 actionable recommendations
//   5. CTAs: schedule next / share results
//
// We compute lightweight heuristics from the live transcript when no
// backend debrief endpoint is available yet (see BACKEND-MISSING below).
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Calendar, PlayCircle, Share2, Sparkles, AlertTriangle, Lightbulb } from 'lucide-react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { ScoreRadar } from '../../components/voice-mock/ScoreRadar'
import { InterviewerAvatar, type InterviewerPersona } from '../../components/voice-mock/InterviewerAvatar'
import type { TranscriptEntry } from './InCallScreen'

interface Props {
  persona: InterviewerPersona
  transcript: TranscriptEntry[]
  elapsedSec: number
  onScheduleNext: () => void
  onShare: () => void
  onReplay?: (ts: number) => void
}

function fmtTs(offsetSec: number): string {
  const m = Math.floor(offsetSec / 60)
  const s = Math.floor(offsetSec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function DebriefScreen({
  persona,
  transcript,
  elapsedSec,
  onScheduleNext,
  onShare,
  onReplay,
}: Props) {
  // Heuristics in lieu of /voice/debrief endpoint (BACKEND-MISSING):
  //   topQuote   = longest user message (proxy for "развёрнутый ответ")
  //   topMistake = shortest non-trivial user message after an AI question
  //                (proxy for "затык")
  const baseTs = transcript[0]?.ts ?? Date.now()
  const myMsgs = transcript.filter((m) => m.who === 'me' && m.text.trim().length > 0)

  const topQuote = useMemo(() => {
    if (myMsgs.length === 0) return null
    return myMsgs.reduce((a, b) => (a.text.length >= b.text.length ? a : b))
  }, [myMsgs])

  const topMistake = useMemo(() => {
    const candidates = myMsgs.filter((m) => m.text.length > 10 && m.text.length < 60)
    if (candidates.length === 0) return null
    return candidates.reduce((a, b) => (a.text.length <= b.text.length ? a : b))
  }, [myMsgs])

  // Score is a placeholder distribution skewed by transcript volume; replace
  // with backend-supplied scores when /voice/debrief lands.
  const score = useMemo(() => {
    const wordCount = myMsgs.reduce((acc, m) => acc + m.text.split(/\s+/).length, 0)
    const base = Math.min(85, 40 + Math.round(wordCount / 4))
    return {
      clarity: base,
      depth: Math.max(30, base - 10),
      pace: Math.min(95, base + 8),
      structure: Math.max(35, base - 5),
    }
  }, [myMsgs])

  const recommendations = [
    'Структурируй ответ: проблема → подход → trade-offs → итог.',
    'Не пропускай worst-case complexity, даже если решение «очевидно O(n)».',
    'Проговаривай вслух, пока думаешь — молчание дольше 8 сек интервьюер читает как «застрял».',
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="mx-auto max-w-5xl px-4 py-10 sm:px-8 lg:py-14"
    >
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-text-muted">debrief</div>
          <h1 className="mt-1 font-display text-3xl font-bold leading-[1.1] text-text-primary lg:text-[40px]">
            Разбор{' '}
            <span className="bg-gradient-to-r from-pink to-cyan bg-clip-text text-transparent">интервью</span>
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            {fmtTs(elapsedSec)} разговора · {myMsgs.length} реплик
          </p>
        </div>
        <div className="hidden sm:block">
          <InterviewerAvatar persona={persona} size={96} idleSpin={false} />
        </div>
      </header>

      {/* Top quote */}
      {topQuote && (
        <Card padding="lg" interactive={false} className="mb-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-pink" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-pink">
              лучший момент
            </span>
            <span className="ml-auto font-mono text-[11px] text-text-muted">
              {fmtTs(Math.floor((topQuote.ts - baseTs) / 1000))}
            </span>
          </div>
          <p className="mt-3 font-display text-xl leading-snug text-text-primary">
            «{topQuote.text}»
          </p>
          <div className="mt-4">
            <Button
              variant="ghost"
              size="sm"
              icon={<PlayCircle className="h-4 w-4" />}
              onClick={() => onReplay?.(topQuote.ts)}
            >
              Replay с этого места
            </Button>
          </div>
        </Card>
      )}

      {/* Top mistake */}
      {topMistake && (
        <Card padding="lg" interactive={false} className="mb-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warn" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-warn">
              где затыкался
            </span>
            <span className="ml-auto font-mono text-[11px] text-text-muted">
              {fmtTs(Math.floor((topMistake.ts - baseTs) / 1000))}
            </span>
          </div>
          <p className="mt-3 text-sm text-text-secondary">«{topMistake.text}»</p>
        </Card>
      )}

      {/* Radar + recs */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card padding="lg" interactive={false} className="items-center">
          <h3 className="self-start font-display text-lg font-bold text-text-primary">Оценка</h3>
          <p className="mb-4 self-start text-xs text-text-muted">4 измерения · 0–100</p>
          <div className="flex justify-center pt-2">
            <ScoreRadar score={score} size={300} />
          </div>
        </Card>

        <Card padding="lg" interactive={false}>
          <h3 className="font-display text-lg font-bold text-text-primary">Рекомендации</h3>
          <p className="mb-4 text-xs text-text-muted">3 действия на следующую сессию</p>
          <ol className="flex flex-col gap-3">
            {recommendations.map((r, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-md bg-accent/15 font-mono text-[11px] font-bold text-accent">
                  {i + 1}
                </span>
                <span className="text-[13px] text-text-secondary">{r}</span>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex items-center gap-2 rounded-md bg-cyan/10 px-3 py-2">
            <Lightbulb className="h-3.5 w-3.5 text-cyan" />
            <span className="text-[11px] text-text-secondary">
              Полный разбор по каждой реплике появится после расширения /voice/debrief.
            </span>
          </div>
        </Card>
      </div>

      {/* CTAs */}
      <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-end">
        <Button variant="ghost" icon={<Share2 className="h-4 w-4" />} onClick={onShare}>
          Поделиться результатом
        </Button>
        <Button variant="primary" icon={<Calendar className="h-4 w-4" />} onClick={onScheduleNext}>
          Назначить следующую сессию
        </Button>
      </div>
    </motion.div>
  )
}
