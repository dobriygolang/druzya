// PairLobbyPage — landing for the collaborative-editor bounded context
// (route /pair). Two affordances:
//   - "Создать комнату"  → POST /editor/room then navigate to /pair/{id}
//   - "Войти по приглашению" → text-input the invite token; submit
//     navigates to /pair/invite/{token}.
//
// Anti-fallback: create-mutation errors render as inline danger text;
// no fake "demo room" is fabricated.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Code2, KeyRound } from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { useCreatePairRoomMutation } from '../../lib/queries/pairEditor'

const LANGS = [
  { id: 'go', label: 'Go' },
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'java', label: 'Java' },
  { id: 'cpp', label: 'C++' },
]

export default function PairLobbyPage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('Pair-coding session')
  const [language, setLanguage] = useState('go')
  const [token, setToken] = useState('')
  const create = useCreatePairRoomMutation()

  const handleCreate = async () => {
    try {
      const res = await create.mutateAsync({ title: title.trim() || 'Pair-coding session', language })
      navigate(`/pair/${res.room.id}`)
    } catch {
      /* handled via create.error inline */
    }
  }

  const handleJoin = () => {
    const t = token.trim()
    if (!t) return
    navigate(`/pair/invite/${encodeURIComponent(t)}`)
  }

  return (
    <AppShellV2>
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-8 lg:py-10">
        <header className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary">
            pair · live coding
          </span>
          <h1 className="font-display text-2xl font-extrabold text-text-primary">
            Совместный редактор кода
          </h1>
          <p className="text-[13px] text-text-secondary">
            Live-кодинг с ментором или партнёром в реальном времени. Видно курсоры друг друга,
            синхронный текст, заморозка кода для проверки. Без эмуляции — если бекенд не отвечает,
            комната не создастся.
          </p>
        </header>

        <section className="rounded-lg border border-border bg-surface-1 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Code2 className="h-4 w-4 text-text-primary" />
            <h2 className="font-display text-[15px] font-bold text-text-primary">Создать комнату</h2>
          </div>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                Название
              </span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded-md border border-border bg-bg px-3 py-2 font-mono text-[12px] text-text-primary outline-none focus:border-text-primary"
                maxLength={120}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                Язык
              </span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="rounded-md border border-border bg-bg px-3 py-2 font-mono text-[12px] text-text-primary outline-none focus:border-text-primary"
              >
                {LANGS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            {create.isError && (
              <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
                Не удалось создать комнату. Проверьте подключение и повторите.
              </div>
            )}
            <Button variant="primary" onClick={handleCreate} disabled={create.isPending}>
              {create.isPending ? 'Создаём…' : 'Создать и войти'}
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-surface-1 p-5">
          <div className="mb-3 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-text-secondary" />
            <h2 className="font-display text-[15px] font-bold text-text-primary">Войти по приглашению</h2>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Вставьте токен из ссылки"
              className="flex-1 rounded-md border border-border bg-bg px-3 py-2 font-mono text-[12px] text-text-primary outline-none focus:border-text-primary"
            />
            <Button variant="ghost" onClick={handleJoin} disabled={!token.trim()}>
              Войти
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            Полная ссылка вида <span className="font-mono">/pair/invite/&lt;token&gt;</span> также работает —
            просто откройте её в браузере.
          </p>
        </section>
      </div>
    </AppShellV2>
  )
}
