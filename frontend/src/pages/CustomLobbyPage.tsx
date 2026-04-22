// TODO i18n
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Lock, Users, Sparkles, Code2, Share2, FileCode } from 'lucide-react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'

const MODES = ['1v1', '2v2', 'Mock', 'AI-Allowed']
const LANGS = ['Go', 'Python', 'TypeScript', 'Rust', 'Java', 'C++']
const PRIVACY = ['Публичная', 'По коду', 'Приватная']

const ROOMS = [
  { name: 'Алгосы перед Я.собесом', mode: '1v1', lang: 'Python', specs: 12, tags: ['DP', 'Graphs'], status: 'В матче' },
  { name: 'Mock interview · Senior BE', mode: 'Mock', lang: 'Go', specs: 4, tags: ['System Design'], status: 'Ожидание' },
  { name: '2v2 ladder grind', mode: '2v2', lang: 'TypeScript', specs: 28, tags: ['Trees', 'BFS'], status: 'В матче' },
  { name: 'AI duel · Sonnet vs Opus', mode: 'AI-Allowed', lang: 'Rust', specs: 47, tags: ['LLM'], status: 'В матче' },
  { name: 'Тренировка к ICPC', mode: '1v1', lang: 'C++', specs: 8, tags: ['Greedy'], status: 'Ожидание' },
  { name: 'Private — Yandex prep', mode: '1v1', lang: 'Go', specs: 0, tags: ['Locked'], status: 'Приватная', locked: true },
]

export default function CustomLobbyPage() {
  useEffect(() => { document.body.classList.add('v2'); return () => document.body.classList.remove('v2') }, [])
  const [mode, setMode] = useState('1v1')
  const [lang, setLang] = useState('Go')
  const [privacy, setPrivacy] = useState('Приватная')

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <header className="flex h-auto flex-col gap-3 border-b border-border bg-bg px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-0 lg:h-[72px]">
        <div className="flex flex-wrap items-center gap-4 lg:gap-8">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-lg font-extrabold text-text-primary">9</span>
            <span className="font-display text-lg font-bold text-text-primary">druz9</span>
            <span className="ml-1 rounded-md bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em] text-cyan">LOBBY</span>
          </Link>
          <nav className="flex items-center gap-1">
            {['Как работает', 'Демо', 'FAQ'].map((l) => (
              <a key={l} href="#" className="rounded-md px-3.5 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2">{l}</a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost">Войти</Button>
          <Button variant="primary">Создать комнату</Button>
        </div>
      </header>

      <section className="flex flex-col items-center gap-4 px-8 py-12 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-accent-hover">
          <span className="relative h-2 w-2"><span className="absolute inset-0 animate-ping rounded-full bg-accent" /><span className="relative block h-2 w-2 rounded-full bg-accent" /></span>
          12 АКТИВНЫХ КОМНАТ · 348 ИГРОКОВ
        </span>
        <h1 className="font-display text-3xl sm:text-4xl lg:text-[48px] font-extrabold leading-[1.05] text-text-primary">Создай свою кодинг-комнату</h1>
        <p className="max-w-xl text-sm text-text-secondary">Без регистрации — приглашай друзей по ссылке и решайте задачи в любом формате.</p>
      </section>

      <div className="flex flex-col gap-4 px-4 pb-12 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:pb-16">
        <Card className="w-full flex-col gap-5 bg-surface-2 p-7 lg:w-[540px]">
          <div className="flex gap-1 rounded-md bg-surface-1 p-1">
            <button className="flex-1 rounded-md bg-surface-3 py-2 text-sm font-semibold text-text-primary">Создать</button>
            <button className="flex-1 rounded-md py-2 text-sm font-semibold text-text-secondary hover:text-text-primary">Войти по коду</button>
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">НАЗВАНИЕ КОМНАТЫ</label>
            <input className="h-10 rounded-md border border-border bg-bg px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" placeholder="Тренировка с друзьями" />
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">РЕЖИМ</label>
            <div className="grid grid-cols-2 gap-2">
              {MODES.map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`rounded-lg border p-3 text-sm font-semibold transition-colors ${mode === m ? 'border-accent bg-accent/10 text-text-primary' : 'border-border bg-surface-1 text-text-secondary hover:border-border-strong'}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">ЯЗЫК</label>
            <div className="flex flex-wrap gap-2">
              {LANGS.map((l) => (
                <button key={l} onClick={() => setLang(l)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${lang === l ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary hover:border-border-strong'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">НАСТРОЙКИ</label>
            {[
              { l: 'Свои задачи', on: false },
              { l: 'AI-помощник', on: true },
              { l: 'Видео + голос', on: false },
              { l: 'Спектаторы', on: true },
            ].map((s) => (
              <div key={s.l} className="flex items-center justify-between rounded-md bg-surface-1 px-3 py-2">
                <span className="text-[13px] text-text-secondary">{s.l}</span>
                <span className={`flex h-5 w-9 items-center rounded-full ${s.on ? 'bg-accent justify-end' : 'bg-surface-3 justify-start'} px-0.5`}>
                  <span className="h-4 w-4 rounded-full bg-text-primary" />
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">ДОСТУП</label>
            <div className="flex gap-2">
              {PRIVACY.map((p) => (
                <button key={p} onClick={() => setPrivacy(p)}
                  className={`flex-1 rounded-md border py-2 text-xs font-semibold ${privacy === p ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          <Button variant="primary" size="lg" className="shadow-glow">Создать и пригласить</Button>
        </Card>

        <div className="flex flex-1 flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-display text-xl font-bold text-text-primary">Открытые публичные комнаты</h2>
            <div className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-surface-2 px-3 sm:w-[240px]">
              <Search className="h-3.5 w-3.5 text-text-muted" />
              <input className="flex-1 bg-transparent text-[13px] text-text-primary focus:outline-none" placeholder="Поиск комнаты…" />
            </div>
          </div>

          {ROOMS.map((r) => (
            <Card key={r.name} className={`flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 ${r.locked ? 'opacity-50' : ''}`}>
              <span className="rounded-md bg-accent/15 px-2.5 py-1 font-mono text-[11px] font-bold text-accent-hover">{r.mode}</span>
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  {r.locked && <Lock className="h-3 w-3 text-text-muted" />}
                  <span className="font-display text-sm font-bold text-text-primary">{r.name}</span>
                </div>
                <span className="font-mono text-[11px] text-text-muted">{r.lang} · {r.specs} зрителей</span>
              </div>
              <div className="flex gap-1">
                {r.tags.map((t) => <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-text-secondary">{t}</span>)}
              </div>
              <div className="flex -space-x-2">
                <Avatar size="sm" gradient="violet-cyan" initials="A" />
                <Avatar size="sm" gradient="pink-violet" initials="K" />
              </div>
              <span className={`font-mono text-[11px] font-semibold ${r.status === 'В матче' ? 'text-success' : 'text-warn'}`}>{r.status}</span>
              <Button size="sm" variant={r.locked ? 'ghost' : 'primary'} disabled={r.locked}>{r.locked ? 'Закрыто' : 'Войти'}</Button>
            </Card>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-border bg-surface-1 px-4 py-8 sm:grid-cols-2 sm:px-8 lg:grid-cols-3 lg:px-20 lg:py-10">
        {[
          { icon: <Users className="h-5 w-5 text-cyan" />, l: 'Без регистрации', s: 'Гость по ссылке за 5 секунд' },
          { icon: <Share2 className="h-5 w-5 text-pink" />, l: 'Шарь ссылкой', s: 'Один клик — копия инвайта в буфер' },
          { icon: <FileCode className="h-5 w-5 text-warn" />, l: 'Свои задачи', s: 'Загружай условия и тесты в YAML' },
        ].map((t) => (
          <div key={t.l} className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-surface-2">{t.icon}</span>
            <div className="flex flex-col">
              <span className="font-display text-sm font-bold text-text-primary">{t.l}</span>
              <span className="text-xs text-text-muted">{t.s}</span>
            </div>
          </div>
        ))}
        <div className="hidden">
          <Sparkles /><Code2 />
        </div>
      </div>
    </div>
  )
}
