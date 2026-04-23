// TODO i18n
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, Lock, Users, Sparkles, Code2, Share2, FileCode, Check } from 'lucide-react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import {
  useFindMatchMutation,
  loadNeuralModel,
  type ArenaModeKey,
  type SectionKey,
} from '../lib/queries/arena'

const MODES = ['1v1', '2v2', 'Mock', 'AI-Allowed'] as const
const LANGS = ['Go', 'Python', 'TypeScript', 'Rust', 'Java', 'C++'] as const
const PRIVACY = ['Публичная', 'По коду', 'Приватная'] as const

type ModeKey = (typeof MODES)[number]
type LangKey = (typeof LANGS)[number]
type PrivacyKey = (typeof PRIVACY)[number]
type Tab = 'create' | 'code'

const ROOMS = [
  { name: 'Алгосы перед Я.собесом', mode: '1v1', lang: 'Python', specs: 12, tags: ['DP', 'Graphs'], status: 'В матче' },
  { name: 'Mock interview · Senior BE', mode: 'Mock', lang: 'Go', specs: 4, tags: ['System Design'], status: 'Ожидание' },
  { name: '2v2 ladder grind', mode: '2v2', lang: 'TypeScript', specs: 28, tags: ['Trees', 'BFS'], status: 'В матче' },
  { name: 'AI duel · Sonnet vs Opus', mode: 'AI-Allowed', lang: 'Rust', specs: 47, tags: ['LLM'], status: 'В матче' },
  { name: 'Тренировка к ICPC', mode: '1v1', lang: 'C++', specs: 8, tags: ['Greedy'], status: 'Ожидание' },
  { name: 'Private — Yandex prep', mode: '1v1', lang: 'Go', specs: 0, tags: ['Locked'], status: 'Приватная', locked: true },
] as const

// Сопоставление UI-режима кастомного лобби c очередью arena. Mock играем
// через Hardcore (таймер строже), AI-Allowed через Cursed (открытый
// AI-помощник). Это позволяет реально стартовать матч из лобби, не
// добавляя отдельного бэкенд-эндпоинта под кастом.
const MODE_TO_QUEUE: Record<ModeKey, ArenaModeKey> = {
  '1v1': 'solo_1v1',
  '2v2': 'duo_2v2',
  Mock: 'hardcore',
  'AI-Allowed': 'cursed',
}

const SETTING_KEYS = ['custom_tasks', 'ai_helper', 'video_voice', 'spectators'] as const
type SettingKey = (typeof SETTING_KEYS)[number]
const SETTING_LABELS: Record<SettingKey, string> = {
  custom_tasks: 'Свои задачи',
  ai_helper: 'AI-помощник',
  video_voice: 'Видео + голос',
  spectators: 'Спектаторы',
}

export default function CustomLobbyPage() {
  const navigate = useNavigate()
  const findMatch = useFindMatchMutation()

  useEffect(() => {
    document.body.classList.add('v2')
    return () => document.body.classList.remove('v2')
  }, [])

  const [tab, setTab] = useState<Tab>('create')
  const [name, setName] = useState('Тренировка с друзьями')
  const [mode, setMode] = useState<ModeKey>('1v1')
  const [lang, setLang] = useState<LangKey>('Go')
  const [privacy, setPrivacy] = useState<PrivacyKey>('Приватная')
  const [code, setCode] = useState('')
  const [search, setSearch] = useState('')
  const [settings, setSettings] = useState<Record<SettingKey, boolean>>({
    custom_tasks: false,
    ai_helper: true,
    video_voice: false,
    spectators: true,
  })
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const filteredRooms = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return ROOMS
    return ROOMS.filter((r) => r.name.toLowerCase().includes(q))
  }, [search])

  const handleCreate = () => {
    setErrorMsg(null)
    const arenaMode = MODE_TO_QUEUE[mode]
    const section: SectionKey = lang.toLowerCase() === 'sql' ? 'sql' : 'algorithms'
    findMatch.mutate(
      { section, mode: arenaMode, neuralModel: loadNeuralModel() },
      {
        onSuccess: (resp) => {
          if (resp.match_id) {
            const path =
              arenaMode === 'duo_2v2'
                ? `/arena/2v2/${resp.match_id}`
                : `/arena/match/${resp.match_id}`
            navigate(path)
            return
          }
          // Queued — bounce user back to the arena so the existing queue
          // hero takes over (avoids a second "stuck on lobby" screen).
          navigate('/arena')
        },
        onError: (e: unknown) => {
          setErrorMsg((e as Error).message ?? 'не удалось стартовать лобби')
        },
      },
    )
  }

  const handleJoinByCode = () => {
    setErrorMsg(null)
    const trimmed = code.trim()
    if (!trimmed) {
      setErrorMsg('Введите код комнаты')
      return
    }
    // Custom-lobby join-by-code re-uses the live match URL: the lobby host
    // shares the match_id as the room code. We navigate optimistically; the
    // ArenaMatchPage shows an error chip if the id is bogus.
    navigate(`/arena/match/${trimmed}`)
  }

  const handleEnterRoom = (roomMode: string) => {
    const arenaMode = MODE_TO_QUEUE[(roomMode as ModeKey) ?? '1v1'] ?? 'solo_1v1'
    findMatch.mutate(
      { section: 'algorithms', mode: arenaMode, neuralModel: loadNeuralModel() },
      {
        onSuccess: (resp) => {
          if (resp.match_id) {
            navigate(
              arenaMode === 'duo_2v2'
                ? `/arena/2v2/${resp.match_id}`
                : `/arena/match/${resp.match_id}`,
            )
            return
          }
          navigate('/arena')
        },
        onError: (e: unknown) => setErrorMsg((e as Error).message ?? 'не удалось войти'),
      },
    )
  }

  const toggleSetting = (key: SettingKey) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }))
  }

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
            <Link to="/help" className="rounded-md px-3.5 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2">Как работает</Link>
            <Link to="/arena" className="rounded-md px-3.5 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2">Демо</Link>
            <Link to="/help" className="rounded-md px-3.5 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2">FAQ</Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => navigate('/welcome')}>Войти</Button>
          <Button variant="primary" onClick={handleCreate} disabled={findMatch.isPending}>
            {findMatch.isPending ? 'Создаём…' : 'Создать комнату'}
          </Button>
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
            <button
              type="button"
              onClick={() => setTab('create')}
              aria-pressed={tab === 'create'}
              className={`flex-1 rounded-md py-2 text-sm font-semibold transition-colors ${tab === 'create' ? 'bg-surface-3 text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
            >
              Создать
            </button>
            <button
              type="button"
              onClick={() => setTab('code')}
              aria-pressed={tab === 'code'}
              className={`flex-1 rounded-md py-2 text-sm font-semibold transition-colors ${tab === 'code' ? 'bg-surface-3 text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
            >
              Войти по коду
            </button>
          </div>

          {tab === 'code' ? (
            <div className="flex flex-col gap-3">
              <label className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">КОД КОМНАТЫ</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="h-10 rounded-md border border-border bg-bg px-3 font-mono text-sm tracking-widest text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                placeholder="match-id или код приглашения"
              />
              <Button variant="primary" size="lg" onClick={handleJoinByCode}>Войти</Button>
              {errorMsg && <p className="font-mono text-xs text-danger">{errorMsg}</p>}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">НАЗВАНИЕ КОМНАТЫ</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-10 rounded-md border border-border bg-bg px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                  placeholder="Тренировка с друзьями"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">РЕЖИМ</label>
                <div className="grid grid-cols-2 gap-2">
                  {MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      aria-pressed={mode === m}
                      className={`rounded-lg border p-3 text-sm font-semibold transition-colors ${mode === m ? 'border-accent bg-accent/10 text-text-primary' : 'border-border bg-surface-1 text-text-secondary hover:border-border-strong'}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">ЯЗЫК</label>
                <div className="flex flex-wrap gap-2">
                  {LANGS.map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLang(l)}
                      aria-pressed={lang === l}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${lang === l ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary hover:border-border-strong'}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">НАСТРОЙКИ</label>
                {SETTING_KEYS.map((key) => {
                  const on = settings[key]
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleSetting(key)}
                      aria-pressed={on}
                      className="flex items-center justify-between rounded-md bg-surface-1 px-3 py-2 text-left transition-colors hover:bg-surface-3"
                    >
                      <span className="text-[13px] text-text-secondary">{SETTING_LABELS[key]}</span>
                      <span className={`flex h-5 w-9 items-center rounded-full ${on ? 'justify-end bg-accent' : 'justify-start bg-surface-3'} px-0.5`}>
                        <span className="grid h-4 w-4 place-items-center rounded-full bg-text-primary">
                          {on && <Check className="h-2.5 w-2.5 text-bg" />}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">ДОСТУП</label>
                <div className="flex gap-2">
                  {PRIVACY.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPrivacy(p)}
                      aria-pressed={privacy === p}
                      className={`flex-1 rounded-md border py-2 text-xs font-semibold ${privacy === p ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary hover:border-border-strong'}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {errorMsg && <p className="font-mono text-xs text-danger">{errorMsg}</p>}
              <Button
                variant="primary"
                size="lg"
                className="shadow-glow"
                onClick={handleCreate}
                disabled={findMatch.isPending}
              >
                {findMatch.isPending ? 'Создаём…' : 'Создать и пригласить'}
              </Button>
            </>
          )}
        </Card>

        <div className="flex flex-1 flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-display text-xl font-bold text-text-primary">Открытые публичные комнаты</h2>
            <div className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-surface-2 px-3 sm:w-[240px]">
              <Search className="h-3.5 w-3.5 text-text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-transparent text-[13px] text-text-primary focus:outline-none"
                placeholder="Поиск комнаты…"
              />
            </div>
          </div>

          {filteredRooms.length === 0 && (
            <p className="font-mono text-xs text-text-muted">Ничего не найдено по запросу «{search}».</p>
          )}
          {filteredRooms.map((r) => {
            const locked = 'locked' in r && r.locked
            return (
              <Card key={r.name} className={`flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 ${locked ? 'opacity-50' : ''}`}>
                <span className="rounded-md bg-accent/15 px-2.5 py-1 font-mono text-[11px] font-bold text-accent-hover">{r.mode}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    {locked && <Lock className="h-3 w-3 text-text-muted" />}
                    <span className="font-display text-sm font-bold text-text-primary">{r.name}</span>
                  </div>
                  <span className="font-mono text-[11px] text-text-muted">{r.lang} · {r.specs} зрителей</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {r.tags.map((t) => <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-text-secondary">{t}</span>)}
                </div>
                <div className="flex -space-x-2">
                  <Avatar size="sm" gradient="violet-cyan" initials="A" />
                  <Avatar size="sm" gradient="pink-violet" initials="K" />
                </div>
                <span className={`font-mono text-[11px] font-semibold ${r.status === 'В матче' ? 'text-success' : 'text-warn'}`}>{r.status}</span>
                {locked ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1 font-mono text-[11px] text-text-muted">
                    <Lock className="h-3 w-3" /> Закрыто
                  </span>
                ) : (
                  <Button size="sm" variant="primary" onClick={() => handleEnterRoom(r.mode)} disabled={findMatch.isPending}>
                    {findMatch.isPending ? '...' : 'Войти'}
                  </Button>
                )}
              </Card>
            )
          })}
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
