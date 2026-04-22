// TODO i18n
import { Lightbulb, X, Mic, SkipBack, Volume2, CheckCircle2, Circle, AlertTriangle } from 'lucide-react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'

function VoiceHeader() {
  return (
    <div className="flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-16 lg:flex-row lg:items-center lg:justify-between lg:py-0">
      <div className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-primary">
          VOICE MOCK · LIVE
        </span>
        <span className="text-text-muted">·</span>
        <span className="font-mono text-xs text-text-secondary">Question 2 of 4</span>
      </div>
      <span className="font-display text-2xl font-extrabold text-text-primary">32:14</span>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" icon={<Lightbulb className="h-3.5 w-3.5" />}>
          Подсказка
        </Button>
        <Button variant="danger" size="sm" icon={<X className="h-3.5 w-3.5" />}>
          Завершить
        </Button>
      </div>
    </div>
  )
}

function LeftTranscript() {
  const messages = [
    { who: 'ai', text: 'Расскажи как устроен LRU Cache внутри.', t: '00:15' },
    { who: 'me', text: 'Это hash map + двусвязный список. Map даёт O(1) lookup, list — порядок.', t: '00:32' },
    { who: 'ai', text: 'Хорошо. Почему именно двусвязный?', t: '01:02' },
    { who: 'me', text: 'Чтобы удалять и переставлять узлы за O(1) без обхода.', t: '01:18' },
    { who: 'ai', text: 'А что произойдёт при превышении capacity?', t: '01:48' },
    { who: 'me', text: 'Удаляем tail — самый давно использованный.', t: '02:05' },
  ]
  return (
    <div className="flex w-full flex-col gap-4 border-b border-border bg-surface-1 lg:w-[380px] lg:border-b-0 lg:border-r">
      <div className="border-b border-border p-5">
        <span className="rounded-full bg-accent/15 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-accent-hover">
          ВОПРОС 2/4
        </span>
        <h2 className="mt-2 font-display text-lg font-bold text-text-primary">
          Расскажи о реализации LRU Cache
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          Объясни структуру, основные операции и сложность.
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-auto px-5">
        <h3 className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
          ТРАНСКРИПТ
        </h3>
        {messages.map((m, i) =>
          m.who === 'ai' ? (
            <div key={i} className="flex items-start gap-2">
              <Avatar size="sm" gradient="violet-cyan" initials="AI" />
              <div className="flex-1 rounded-lg bg-surface-2 p-3">
                <p className="text-[12px] text-text-secondary">{m.text}</p>
                <span className="mt-1 block font-mono text-[10px] text-text-muted">{m.t}</span>
              </div>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1 rounded-lg bg-accent/20 p-3">
                <p className="text-[12px] text-text-primary">{m.text}</p>
                <span className="mt-1 block font-mono text-[10px] text-text-muted">{m.t}</span>
              </div>
              <Avatar size="sm" gradient="pink-violet" initials="Я" />
            </div>
          ),
        )}
      </div>
      <div className="flex h-14 items-center justify-between border-t border-border bg-surface-2 px-4">
        <div className="flex items-end gap-1">
          {[10, 18, 14, 22, 12].map((h, i) => (
            <span
              key={i}
              className="w-1 rounded-full bg-accent-hover"
              style={{ height: `${h}px` }}
            />
          ))}
        </div>
        <span className="font-mono text-[11px] text-accent-hover">Слушаю...</span>
      </div>
    </div>
  )
}

function CenterOrb() {
  const bars = Array.from({ length: 30 }).map((_, i) => 8 + Math.abs(((i * 9) % 24) - 4))
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-surface-1 p-6 lg:gap-8 lg:p-10">
      <div
        className="grid h-56 w-56 place-items-center rounded-full sm:h-72 sm:w-72 lg:h-80 lg:w-80"
        style={{
          background: 'linear-gradient(135deg, #582CFF 0%, #F472B6 100%)',
          boxShadow: '0 20px 80px rgba(88,44,255,0.6)',
        }}
      >
        <div className="grid h-44 w-44 place-items-center rounded-full sm:h-56 sm:w-56 lg:h-60 lg:w-60" style={{ background: '#00000060' }}>
          <div className="flex flex-col items-center gap-1.5">
            <span className="font-mono text-[11px] tracking-[0.15em] text-text-muted">AI INTERVIEWER</span>
            <span className="font-display text-[32px] font-extrabold text-text-primary">Слушает</span>
            <span className="font-mono text-[11px] text-text-secondary">GPT-4o · Senior Backend Mock</span>
          </div>
        </div>
      </div>
      <div className="flex h-12 items-end gap-1.5">
        {bars.map((h, i) => (
          <span
            key={i}
            className="w-1 rounded-full bg-cyan opacity-80"
            style={{ height: `${h * 1.5}px` }}
          />
        ))}
      </div>
      <span className="text-xs text-text-secondary">Говори свободно — AI запишет и оценит</span>
      <div className="flex items-center gap-5">
        <button className="grid h-14 w-14 place-items-center rounded-full bg-surface-2 text-text-secondary hover:bg-surface-3">
          <SkipBack className="h-5 w-5" />
        </button>
        <button
          className="grid h-20 w-20 place-items-center rounded-full bg-accent text-text-primary"
          style={{ boxShadow: '0 10px 40px rgba(88,44,255,0.6)' }}
        >
          <Mic className="h-7 w-7" />
        </button>
        <button className="grid h-14 w-14 place-items-center rounded-full bg-surface-2 text-text-secondary hover:bg-surface-3">
          <Volume2 className="h-5 w-5" />
        </button>
      </div>
      <span className="font-mono text-[10px] text-text-muted">Tab — пауза, Esc — закрыть</span>
    </div>
  )
}

function RightPanel() {
  const notes = [
    { i: <CheckCircle2 className="h-4 w-4 text-success" />, t: 'Упомянул hash map + linked list' },
    { i: <CheckCircle2 className="h-4 w-4 text-success" />, t: 'Объяснил O(1) сложность' },
    { i: <AlertTriangle className="h-4 w-4 text-warn" />, t: 'Не упомянул thread safety' },
  ]
  const metrics = [
    ['Понимание', 9.0, 'bg-success'],
    ['Объяснение', 8.5, 'bg-cyan'],
    ['Скорость', 7.5, 'bg-warn'],
    ['Глубина', 8.0, 'bg-accent'],
  ] as const
  const actions = [
    'Задать follow-up вопрос',
    'Перейти к следующему',
    'Сменить тему',
    'Сделать паузу',
  ]
  return (
    <div className="flex w-full flex-col gap-4 border-t border-border bg-surface-1 p-5 lg:w-[320px] lg:border-l lg:border-t-0">
      <Card className="flex-col gap-3 p-4" interactive={false}>
        <h3 className="font-display text-sm font-bold text-text-primary">Live notes</h3>
        {notes.map((n, i) => (
          <div key={i} className="flex items-center gap-2">
            {n.i}
            <span className="text-[12px] text-text-secondary">{n.t}</span>
          </div>
        ))}
      </Card>
      <Card className="flex-col gap-3 p-4" interactive={false}>
        <h3 className="font-display text-sm font-bold text-text-primary">Live evaluation</h3>
        {metrics.map(([k, v, c]) => (
          <div key={k} className="flex flex-col gap-1">
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-text-secondary">{k}</span>
              <span className="text-text-primary">{v.toFixed(1)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className={`h-full ${c}`} style={{ width: `${v * 10}%` }} />
            </div>
          </div>
        ))}
      </Card>
      <Card className="flex-col gap-2 p-4" interactive={false}>
        <h3 className="font-display text-sm font-bold text-text-primary">Quick actions</h3>
        {actions.map((a) => (
          <button
            key={a}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-[12px] text-text-secondary hover:bg-surface-2"
          >
            <Circle className="h-3 w-3 text-accent-hover" />
            {a}
          </button>
        ))}
      </Card>
    </div>
  )
}

export default function VoiceMockPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-text-primary">
      <VoiceHeader />
      <div className="flex flex-1 flex-col lg:flex-row">
        <LeftTranscript />
        <CenterOrb />
        <RightPanel />
      </div>
    </div>
  )
}
