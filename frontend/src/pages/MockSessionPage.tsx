// MockSessionPage — main AI-interview UI. Wires:
//   - GET /mock/session/:id  via useMockSessionQuery (initial bootstrap)
//   - WS /ws/mock/:id        via useChannel (streaming AI tokens, stress)
//   - POST /mock/session/:id/message  via useSendMockMessage (REST fallback)
//   - POST /mock/session/:id/finish   via useFinishMockSessionMutation
//
// Hardcoded panels (notes / interviewer video / company score) are kept
// purely visual — they don't have backing endpoints in MVP, only feature
// flags that the bible defers to v2. Marked with `mvp-static` for grep.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Camera,
  FileCode,
  Lightbulb,
  Loader2,
  Mic,
  PhoneOff,
  Send,
  Sparkles,
  Upload,
  Video,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { WSStatus } from '../components/ws/WSStatus'
import { useChannel } from '../lib/ws'
import {
  useFinishMockSessionMutation,
  useMockSessionQuery,
  useSendMockMessage,
  type MockMessage,
} from '../lib/queries/mock'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

type AIMessage = { from: 'ai' | 'user'; text: string }
type Stress = { pauses_score: number; backspace_score: number; chaos_score: number; paste_attempts: number }

function fromMessageRow(m: MockMessage): AIMessage {
  return { from: m.role === 'user' ? 'user' : 'ai', text: m.content }
}

function fmtMmSs(totalSec: number): string {
  const mm = Math.max(0, Math.floor(totalSec / 60))
  const ss = Math.max(0, Math.floor(totalSec % 60))
  return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`
}

function MatchHeader({
  elapsedSec,
  durationMin,
  onFinish,
  finishing,
}: {
  elapsedSec: number
  durationMin: number
  onFinish: () => void
  finishing: boolean
}) {
  return (
    <div className="flex h-[80px] items-center justify-between gap-2 border-b border-border bg-surface-1 px-4 sm:px-8">
      <div className="hidden items-center gap-3 sm:flex">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-success">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          AI INTERVIEW · LIVE
        </span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="font-display text-[26px] font-extrabold leading-none text-text-primary">
          {fmtMmSs(elapsedSec)}{' '}
          <span className="text-text-muted">/ {fmtMmSs(durationMin * 60)}</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" icon={<Lightbulb className="h-4 w-4" />} size="sm" className="hidden sm:inline-flex">
          Подсказка
        </Button>
        <Button variant="danger" size="sm" onClick={onFinish} disabled={finishing}>
          {finishing ? 'Завершаем…' : 'Завершить'}
        </Button>
      </div>
    </div>
  )
}

function InterviewerPanel() {
  return (
    <Card className="h-[320px] flex-col gap-3 p-4" interactive={false}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Avatar size="md" gradient="cyan-violet" initials="AI" status="online" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-text-primary">AI Interviewer</span>
            <span className="font-mono text-[11px] text-success">● Слушает</span>
          </div>
        </div>
        <Sparkles className="h-4 w-4 text-text-secondary" />
      </div>
      <div className="flex flex-1 items-center justify-center rounded-lg bg-surface-2 border border-border-strong">
        <div className="flex flex-col items-center gap-2">
          <Video className="h-10 w-10 text-text-muted" />
          <span className="font-mono text-[11px] text-text-muted">video stream</span>
        </div>
      </div>
    </Card>
  )
}

function QuestionPanel({ title, description }: { title: string; description: string }) {
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-text-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-text-secondary">
        ВОПРОС
      </span>
      <h3 className="font-display text-lg font-bold text-text-primary break-words">{title}</h3>
      <p className="text-[13px] leading-relaxed text-text-secondary break-words">{description}</p>
    </Card>
  )
}

// Tech Lead / EM pre-brief panel — STAR-style behavioral round.
// Content aligns with services/ai_mock/domain/tech_lead.go.
function TechLeadEMPanel() {
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-text-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-text-secondary">
        TECH LEAD · EM
      </span>
      <h3 className="font-display text-lg font-bold text-text-primary break-words">
        STAR-style behavioral round
      </h3>
      <p className="text-[13px] leading-relaxed text-text-secondary break-words">
        AI-панель проводит 4-5 STAR-сценариев: 1:1 с underperformer'ом,
        конфликт между разработчиками, hiring decisions, защита
        tech-debt'а. Структурируй ответ как Situation → Task → Action → Result.
      </p>
      <div className="grid grid-cols-2 gap-2 pt-1">
        {[
          ['structure', 'STAR-формат'],
          ['ownership', 'YOU vs WE'],
          ['impact', 'числа, не вода'],
          ['learning', 'transferable lesson'],
        ].map(([key, ru]) => (
          <div
            key={key}
            className="rounded-md border border-border px-2.5 py-2 font-mono text-[10px] uppercase tracking-wider text-text-secondary"
          >
            <div className="text-text-primary">{key}</div>
            <div className="text-text-muted">{ru}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// Senior SD pre-brief panel — analogous to EnglishHRPanel but for
// architectural pushback rounds. Content aligns with the prompt in
// services/ai_mock/domain/system_design_senior.go.
function SystemDesignSeniorPanel() {
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-text-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-text-secondary">
        SENIOR · SYSTEM DESIGN
      </span>
      <h3 className="font-display text-lg font-bold text-text-primary break-words">
        Free-form architectural pushback
      </h3>
      <p className="text-[13px] leading-relaxed text-text-secondary break-words">
        Без конкретной задачи. AI-собеседующий ведёт разговор по одной-двум темам
        (distributed / real-time / ML / security / observability) и давит
        на failure modes и tradeoff'ы. Никаких «we'd just add a cache».
      </p>
      <div className="grid grid-cols-2 gap-2 pt-1">
        {[
          ['depth', 'глубина reasoning'],
          ['tradeoffs', 'cost / benefit'],
          ['failure_modes', 'отказы и edge'],
          ['pragmatism', 'числа vs hand-wave'],
        ].map(([key, ru]) => (
          <div
            key={key}
            className="rounded-md border border-border px-2.5 py-2 font-mono text-[10px] uppercase tracking-wider text-text-secondary"
          >
            <div className="text-text-primary">{key}</div>
            <div className="text-text-muted">{ru}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// Sysanalyst — Wave 7. Free-form interview. Same panel pattern as
// SystemDesignSeniorPanel; rubric mirrors BuildSysanalystReportPrompt
// (requirements / modeling / integration / data / process).
function SysanalystPanel() {
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-text-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-text-secondary">
        SYSTEMS ANALYST
      </span>
      <h3 className="font-display text-lg font-bold text-text-primary break-words">
        Free-form working session
      </h3>
      <p className="text-[13px] leading-relaxed text-text-secondary break-words">
        Без алгоритмической задачи. AI ведёт 4-6 сценариев по requirements →
        UML/BPMN → integration patterns → data design → process. Push for
        SQL on the whiteboard, isolation levels by name, broker semantics.
      </p>
      <div className="grid grid-cols-2 gap-2 pt-1">
        {[
          ['requirements', 'NFR + Gherkin'],
          ['modeling', 'UML / BPMN / C4'],
          ['integration', 'sagas + idempotency'],
          ['data', 'SQL + isolation'],
          ['process', 'DoR/DoD + RACI'],
        ].map(([key, ru]) => (
          <div
            key={key}
            className="rounded-md border border-border px-2.5 py-2 font-mono text-[10px] uppercase tracking-wider text-text-secondary"
          >
            <div className="text-text-primary">{key}</div>
            <div className="text-text-muted">{ru}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// Product analyst — Wave 8. Same shape; rubric mirrors
// BuildProductAnalystReportPrompt (metrics / sql / experimentation /
// frameworks / communication).
function ProductAnalystPanel() {
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-text-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-text-secondary">
        PRODUCT ANALYST
      </span>
      <h3 className="font-display text-lg font-bold text-text-primary break-words">
        Free-form analytics interview
      </h3>
      <p className="text-[13px] leading-relaxed text-text-secondary break-words">
        Без задачи в редакторе. AI ведёт разговор по metrics → SQL → A/B
        testing → frameworks → insight comm. Готовься писать SQL, обосновывать
        sample size и защищать выбор North Star метрики.
      </p>
      <div className="grid grid-cols-2 gap-2 pt-1">
        {[
          ['metrics', 'DAU/retention/NSM'],
          ['sql', 'window + cohort'],
          ['experimentation', 'CUPED + MDE'],
          ['frameworks', 'RICE / JTBD'],
          ['communication', 'insight memo'],
        ].map(([key, ru]) => (
          <div
            key={key}
            className="rounded-md border border-border px-2.5 py-2 font-mono text-[10px] uppercase tracking-wider text-text-secondary"
          >
            <div className="text-text-primary">{key}</div>
            <div className="text-text-muted">{ru}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// QA / тестировщик — Wave 9.2.
function QAPanel() {
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-text-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-text-secondary">
        QA / SDET
      </span>
      <h3 className="font-display text-lg font-bold text-text-primary break-words">
        Free-form QA working session
      </h3>
      <p className="text-[13px] leading-relaxed text-text-secondary break-words">
        Без алгоритмической задачи. AI ведёт 4-6 сценариев: test design →
        API testing → automation → bug analysis → process. Готовься защищать
        конкретные assertions и flake-диагностику.
      </p>
      <div className="grid grid-cols-2 gap-2 pt-1">
        {[
          ['test_design', 'boundary + decision'],
          ['api', 'contracts + idempotency'],
          ['automation', 'flake hunting'],
          ['bug_analysis', 'RCA + severity'],
          ['process', 'risk-based'],
        ].map(([key, ru]) => (
          <div
            key={key}
            className="rounded-md border border-border px-2.5 py-2 font-mono text-[10px] uppercase tracking-wider text-text-secondary"
          >
            <div className="text-text-primary">{key}</div>
            <div className="text-text-muted">{ru}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// DevOps / SRE — Wave 9.3.
function DevOpsPanel() {
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-text-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-text-secondary">
        DEVOPS / SRE
      </span>
      <h3 className="font-display text-lg font-bold text-text-primary break-words">
        Free-form platform interview
      </h3>
      <p className="text-[13px] leading-relaxed text-text-secondary break-words">
        Без задачи в редакторе. AI ведёт диалог по infra → observability →
        CI/CD → incident response → security. Защищай PromQL, alarm
        thresholds, IAM action strings, runbook timelines.
      </p>
      <div className="grid grid-cols-2 gap-2 pt-1">
        {[
          ['infra', 'k8s + IaC'],
          ['observability', 'SLO + cardinality'],
          ['cicd', 'blue-green + rollback'],
          ['incident', 'runbooks + budgets'],
          ['security', 'secrets + netpol'],
        ].map(([key, ru]) => (
          <div
            key={key}
            className="rounded-md border border-border px-2.5 py-2 font-mono text-[10px] uppercase tracking-wider text-text-secondary"
          >
            <div className="text-text-primary">{key}</div>
            <div className="text-text-muted">{ru}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// English HR rounds have no algorithmic task. The left panel still
// frames the round so the candidate isn't dropped into a blank chat;
// content is static (rubric + ground rules) and aligned to the prompt
// in services/ai_mock/domain/english_hr.go::BuildEnglishHRSystemPrompt.
function EnglishHRPanel() {
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-text-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-text-secondary">
        ENGLISH HR ROUND
      </span>
      <h3 className="font-display text-lg font-bold text-text-primary break-words">
        Conversational HR-screen, in English
      </h3>
      <p className="text-[13px] leading-relaxed text-text-secondary break-words">
        AI-собеседующий проведёт HR-этап на английском. Отвечай свободно — грамматика
        и vocab оцениваются в финале, мидсессии корректировок не будет.
      </p>
      <div className="grid grid-cols-2 gap-2 pt-1">
        {[
          ['clarity', 'структура мысли'],
          ['accuracy', 'грамматика'],
          ['range', 'словарный запас'],
          ['fluency', 'темп речи'],
        ].map(([key, ru]) => (
          <div
            key={key}
            className="rounded-md border border-border px-2.5 py-2 font-mono text-[10px] uppercase tracking-wider text-text-secondary"
          >
            <div className="text-text-primary">{key}</div>
            <div className="text-text-muted">{ru}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function ControlsCard({
  micOn,
  toggleMic,
  onLeave,
}: {
  micOn: boolean
  toggleMic: () => void
  onLeave: () => void
}) {
  const tile = (Icon: React.ElementType, danger?: boolean, active?: boolean, onClick?: () => void) => (
    <button
      onClick={onClick}
      className={[
        'grid h-11 w-11 place-items-center rounded-full border',
        danger
          ? 'border-danger/40 bg-danger/15 text-danger hover:bg-danger/25'
          : active
            ? 'border-border-strong bg-text-primary/10 text-text-primary hover:bg-text-primary/15'
            : 'border-border bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary',
      ].join(' ')}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
  return (
    <Card className="flex-row items-center justify-around p-4" interactive={false}>
      {tile(Mic, false, micOn, toggleMic)}
      {tile(Camera)}
      {tile(Upload)}
      {tile(PhoneOff, true, false, onLeave)}
    </Card>
  )
}

function StressCard({ stress }: { stress: Stress }) {
  const items: { label: string; value: number; color: string }[] = [
    { label: 'Паузы', value: stress.pauses_score, color: 'bg-text-primary/60' },
    { label: 'Backspaces', value: stress.backspace_score, color: 'bg-warn' },
    { label: 'Хаос', value: stress.chaos_score, color: 'bg-text-primary' },
    { label: 'Paste-попытки', value: stress.paste_attempts, color: 'bg-danger' },
  ]
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Стресс-метрики</h3>
        <Sparkles className="h-4 w-4 text-text-secondary" />
      </div>
      {items.map((m) => (
        <div key={m.label} className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-text-secondary">{m.label}</span>
            <span className="font-mono text-[12px] font-semibold text-text-primary">{m.value}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-black/40">
            <div
              className={`h-full transition-all duration-700 ${m.color}`}
              style={{ width: `${Math.min(100, m.value)}%` }}
            />
          </div>
        </div>
      ))}
    </Card>
  )
}

function TranscriptCard({ messages, pending }: { messages: AIMessage[]; pending: boolean }) {
  if (messages.length === 0 && !pending) {
    return (
      <Card className="flex-col gap-2 p-4" interactive={false}>
        <h3 className="text-sm font-bold text-text-primary">Диалог</h3>
        <p className="text-[12px] text-text-muted">
          Начните с первого ответа AI-интервьюеру в поле ниже.
        </p>
      </Card>
    )
  }
  return (
    <Card className="flex-col gap-2 p-4" interactive={false}>
      <h3 className="text-sm font-bold text-text-primary">Диалог</h3>
      <div className="flex max-h-[240px] flex-col gap-1.5 overflow-y-auto">
        {messages.slice(-30).map((m, i) => (
          <div key={i} className="text-[12px] break-words">
            <span className={m.from === 'ai' ? 'text-text-secondary' : 'text-text-primary'}>
              {m.from === 'ai' ? 'AI:' : 'Я:'}{' '}
            </span>
            <span className="text-text-secondary">{m.text}</span>
          </div>
        ))}
        {pending && (
          <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> AI печатает…
          </div>
        )}
      </div>
    </Card>
  )
}

function MessageBox({
  value,
  onChange,
  onSend,
  sending,
  toggleMic,
  micOn,
}: {
  value: string
  onChange: (s: string) => void
  onSend: () => void
  sending: boolean
  micOn: boolean
  toggleMic: () => void
}) {
  return (
    <Card className="flex-row items-center gap-2 p-3" interactive={false}>
      <button
        type="button"
        onClick={toggleMic}
        className={[
          'grid h-9 w-9 shrink-0 place-items-center rounded-full border',
          micOn
            ? 'border-border-strong bg-text-primary/10 text-text-primary'
            : 'border-border bg-surface-2 text-text-secondary hover:bg-surface-3',
        ].join(' ')}
        aria-label="toggle voice"
      >
        <Mic className="h-4 w-4" />
      </button>
      <input
        className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary outline-none focus:border-text-primary"
        placeholder="Ответьте интервьюеру…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && value.trim()) {
            e.preventDefault()
            onSend()
          }
        }}
      />
      <Button
        variant="primary"
        size="sm"
        onClick={onSend}
        disabled={sending || !value.trim()}
        icon={sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      >
        {sending ? '…' : 'Отправить'}
      </Button>
    </Card>
  )
}

function EditorPlaceholder() {
  return (
    <Card className="flex-1 flex-col p-0 overflow-hidden" interactive={false}>
      <div className="flex h-11 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2.5">
          <FileCode className="h-4 w-4 text-text-secondary" />
          <span className="font-mono text-[13px] text-text-primary">workspace</span>
        </div>
        <span className="font-mono text-[11px] text-text-muted">UTF-8 · LF</span>
      </div>
      <div className="flex flex-1 items-center justify-center bg-surface-1 p-6 text-center">
        <p className="font-mono text-[12px] text-text-muted">
          Code editor для этой секции откроется в отдельной странице · MVP уровня v1
        </p>
      </div>
    </Card>
  )
}

export default function MockSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const channel = sessionId ? `mock/${sessionId}` : ''
  const { lastEvent, data: wsData, status: wsStatus } = useChannel<Record<string, unknown>>(channel)
  const { data: session, isError, isLoading } = useMockSessionQuery(sessionId)
  const sendMutation = useSendMockMessage(sessionId)
  const finishMutation = useFinishMockSessionMutation(sessionId)

  const [draft, setDraft] = useState('')
  const [micOn, setMicOn] = useState(false)
  const [transcript, setTranscript] = useState<AIMessage[]>([])
  const seedKeyRef = useRef<string | null>(null)
  const [stress, setStress] = useState<Stress>({ pauses_score: 0, backspace_score: 0, chaos_score: 0, paste_attempts: 0 })
  const [streamingDelta, setStreamingDelta] = useState('')

  // Seed transcript from REST when the session first arrives (idempotent
  // per session id so user-typed messages aren't blown away on refetch).
  useEffect(() => {
    if (!session) return
    if (seedKeyRef.current === session.id) return
    seedKeyRef.current = session.id
    setTranscript((session.last_messages ?? []).map(fromMessageRow))
    if (session.stress_profile) setStress(session.stress_profile)
  }, [session])

  // WS event fan-out. The hub emits these kinds:
  //   ai_token           — partial assistant token (delta only)
  //   ai_done            — final assistant message saved
  //   user_message_ack   — server confirms our message landed
  //   stress_update      — boundary crossing on a stress dimension
  //   intervention       — AI nudges after user idle
  useEffect(() => {
    if (!lastEvent || !wsData) return
    const payload = wsData as Record<string, unknown>
    if (lastEvent === 'ai_token') {
      const d = typeof payload.delta === 'string' ? payload.delta : ''
      setStreamingDelta((prev) => prev + d)
    } else if (lastEvent === 'ai_done') {
      setStreamingDelta((prev) => {
        if (prev) {
          setTranscript((t) => [...t, { from: 'ai', text: prev }])
        }
        return ''
      })
    } else if (lastEvent === 'user_message_ack') {
      const text = typeof payload.content === 'string' ? payload.content : ''
      if (text) setTranscript((t) => [...t, { from: 'user', text }])
    } else if (lastEvent === 'stress_update') {
      const dim = typeof payload.dimension === 'string' ? payload.dimension : ''
      const value = typeof payload.value === 'number' ? payload.value : 0
      setStress((prev) => {
        const next = { ...prev }
        if (dim === 'pauses') next.pauses_score = value
        else if (dim === 'backspace') next.backspace_score = value
        else if (dim === 'chaos') next.chaos_score = value
        else if (dim === 'paste') next.paste_attempts = value
        return next
      })
    } else if (lastEvent === 'intervention') {
      const text = typeof payload.text === 'string' ? payload.text : ''
      if (text) setTranscript((t) => [...t, { from: 'ai', text }])
    }
  }, [lastEvent, wsData])

  // Wall-clock elapsed since started_at. Avoids re-rendering at >1Hz.
  const startedAt = session?.started_at ? new Date(session.started_at).getTime() : Date.now()
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [startedAt])

  // Free-form rounds have no algorithmic task — backend stores task_id = NULL.
  // The whole right pane (editor placeholder + stress card) is hidden,
  // and the left pane swaps QuestionPanel for a section-specific brief.
  const isEnglishHR = session?.section === 'english_hr'
  const isSeniorSD = session?.section === 'system_design_senior'
  const isTechLead = session?.section === 'tech_lead_em'
  const isSysanalyst = session?.section === 'sysanalyst'
  const isProductAnalyst = session?.section === 'product_analyst'
  const isQA = session?.section === 'qa'
  const isDevOps = session?.section === 'devops'
  const isFreeform =
    isEnglishHR || isSeniorSD || isTechLead || isSysanalyst || isProductAnalyst || isQA || isDevOps
  const qTitle = session?.task?.title ?? (isLoading ? 'Загрузка задачи…' : 'Задача')
  const qDesc = session?.task?.description ?? (isLoading ? 'Подождите немного, загружаем условие интервью.' : 'Подождите AI-собеседника.')

  const sendCurrentDraft = () => {
    const content = draft.trim()
    if (!content) return
    setDraft('')
    setTranscript((t) => [...t, { from: 'user', text: content }])
    sendMutation.mutate({ content })
  }

  const onFinish = async () => {
    if (!sessionId) return
    try {
      await finishMutation.mutateAsync()
      navigate(`/mock/${sessionId}/result`)
    } catch {
      // surfaced via mutation.isError; chip on top right
    }
  }

  // Build the live transcript: persisted lines + the in-flight streaming delta
  // shown as a fake AI line so the candidate sees the answer materialise.
  const liveLines = useMemo(() => {
    if (!streamingDelta) return transcript
    return [...transcript, { from: 'ai' as const, text: streamingDelta + '▍' }]
  }, [transcript, streamingDelta])

  const durationMin = session?.duration_min ?? 45

  return (
    <AppShellV2>
      <div className="relative">
        <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
          {isError && <ErrorChip />}
          <WSStatus status={wsStatus} />
        </div>
        <MatchHeader
          elapsedSec={elapsed}
          durationMin={durationMin}
          onFinish={onFinish}
          finishing={finishMutation.isPending}
        />
      </div>
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-8 lg:flex-row">
        <div className="flex w-full flex-col gap-4 lg:w-[360px]">
          {isEnglishHR ? (
            <EnglishHRPanel />
          ) : isSeniorSD ? (
            <SystemDesignSeniorPanel />
          ) : isTechLead ? (
            <TechLeadEMPanel />
          ) : isSysanalyst ? (
            <SysanalystPanel />
          ) : isProductAnalyst ? (
            <ProductAnalystPanel />
          ) : isQA ? (
            <QAPanel />
          ) : isDevOps ? (
            <DevOpsPanel />
          ) : (
            <QuestionPanel title={qTitle} description={qDesc} />
          )}
          <div className="hidden lg:block">
            <InterviewerPanel />
          </div>
        </div>
        <div className="flex min-h-[400px] min-w-0 flex-1 flex-col gap-4">
          {!isFreeform && <EditorPlaceholder />}
          <TranscriptCard messages={liveLines} pending={sendMutation.isPending && !streamingDelta} />
          <MessageBox
            value={draft}
            onChange={setDraft}
            onSend={sendCurrentDraft}
            sending={sendMutation.isPending}
            micOn={micOn}
            toggleMic={() => {
              setMicOn((on) => !on)
              // Voice route is registered as /voice-mock/:sessionId (see App.tsx).
              // Sending users to /mock/:sessionId/voice 404'd.
              if (!micOn && sessionId) navigate(`/voice-mock/${sessionId}`)
            }}
          />
        </div>
        <div className="flex w-full flex-col gap-4 lg:w-[320px]">
          <ControlsCard micOn={micOn} toggleMic={() => setMicOn((v) => !v)} onLeave={onFinish} />
          {/* StressCard is hidden for free-form rounds — there's no stress
              profile for a conversational round (no editor → no keystroke signals). */}
          {!isFreeform && <StressCard stress={stress} />}
        </div>
      </div>
    </AppShellV2>
  )
}
