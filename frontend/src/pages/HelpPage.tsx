// TODO i18n
import { useState } from 'react'
import { Search, ChevronDown, ChevronUp, Rocket, Swords, Shield, Crown, Sparkles, Lock, MessageCircle, Mail, Send, Code as GithubIcon, Circle } from 'lucide-react'

const Github = GithubIcon
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { useHelpQuery } from '../lib/queries/help'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

const CATS = [
  { icon: <Rocket className="h-5 w-5" />, color: 'text-cyan', bg: 'bg-cyan/15', l: 'Старт', sub: '8 статей' },
  { icon: <Swords className="h-5 w-5" />, color: 'text-accent-hover', bg: 'bg-accent/15', l: 'Арена и матчи', sub: '14 статей' },
  { icon: <Shield className="h-5 w-5" />, color: 'text-pink', bg: 'bg-pink/15', l: 'Гильдии', sub: '11 статей' },
  { icon: <Crown className="h-5 w-5" />, color: 'text-warn', bg: 'bg-warn/15', l: 'Premium', sub: '6 статей' },
  { icon: <Sparkles className="h-5 w-5" />, color: 'text-pink', bg: 'bg-pink/15', l: 'AI настройки', sub: '9 статей' },
  { icon: <Lock className="h-5 w-5" />, color: 'text-success', bg: 'bg-success/15', l: 'Безопасность', sub: '5 статей' },
]

const FAQ = [
  { q: 'Как считается LP?', expanded: true },
  { q: 'Что даёт Premium?', expanded: false },
  { q: 'Как создать гильдию?', expanded: false },
  { q: 'Какие AI модели доступны?', expanded: false },
  { q: 'Как работает Streak Freeze?', expanded: false },
  { q: 'Возврат денег за подписку', expanded: false },
]

export default function HelpPage() {
  const [open, setOpen] = useState<number>(0)
  const { data, isError } = useHelpQuery()
  const totalArticles = data?.total_articles ?? 53
  return (
    <AppShellV2>
      <div className="relative h-auto overflow-hidden bg-gradient-to-br from-surface-3 to-accent lg:h-[240px]">
        <div className="flex h-full flex-col items-center justify-center gap-4 px-4 py-8 sm:px-8 lg:py-0">
          <h1 className="font-display text-3xl sm:text-4xl lg:text-[36px] font-extrabold text-text-primary">Чем помочь?</h1>
          <p className="text-sm text-white/80">Поиск по {totalArticles} статьям, чат с поддержкой и контакты</p>
          {isError && <ErrorChip />}
          <div className="flex h-12 w-full max-w-[720px] items-center gap-3 rounded-xl border border-white/20 bg-bg/60 px-4 backdrop-blur">
            <Search className="h-5 w-5 text-text-muted" />
            <input className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none" placeholder="Введи вопрос или ключевое слово…" />
            <span className="font-mono text-[11px] text-text-muted">⌘K</span>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {['Как поднять LP?', 'Создать гильдию', 'Купить Premium'].map((c) => (
              <button key={c} className="rounded-full border border-white/20 bg-bg/40 px-3 py-1 text-xs text-text-primary hover:bg-bg/60">
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-8 px-4 py-8 sm:px-8 lg:px-20 lg:py-10">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {CATS.map((c) => (
            <Card key={c.l} interactive className="flex-col items-start gap-3 p-5 cursor-pointer">
              <span className={`grid h-10 w-10 place-items-center rounded-lg ${c.bg} ${c.color}`}>{c.icon}</span>
              <div className="flex flex-col gap-0.5">
                <span className="font-display text-sm font-bold text-text-primary">{c.l}</span>
                <span className="font-mono text-[11px] text-text-muted">{c.sub}</span>
              </div>
            </Card>
          ))}
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <div className="flex flex-1 flex-col gap-3">
            <h2 className="font-display text-lg font-bold text-text-primary">Популярные вопросы</h2>
            {FAQ.map((f, i) => {
              const isOpen = i === open
              return (
                <Card key={f.q} className="flex-col gap-3 p-5">
                  <button onClick={() => setOpen(isOpen ? -1 : i)} className="flex items-center justify-between text-left">
                    <span className="font-display text-base font-semibold text-text-primary">{f.q}</span>
                    {isOpen ? <ChevronUp className="h-4 w-4 text-text-muted" /> : <ChevronDown className="h-4 w-4 text-text-muted" />}
                  </button>
                  {isOpen && i === 0 && (
                    <div className="flex flex-col gap-3 border-t border-border pt-4">
                      <p className="text-sm leading-relaxed text-text-secondary">
                        LP начисляется за победы в ranked-матчах и зависит от разницы рейтингов соперников.
                        Базовое значение — 20 LP, корректируется на основе MMR-формулы (Elo-подобная).
                      </p>
                      <pre className="rounded-md bg-bg p-3 font-mono text-[12px] text-cyan">
{`ΔLP = 20 + 10 × (1 − P(win))
P(win) = 1 / (1 + 10^((opp − you) / 400))`}
                      </pre>
                      <p className="text-sm leading-relaxed text-text-secondary">
                        Минимум +5 LP за победу, максимум +35 LP. При поражении удерживается от −12 до −22 LP.
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {['MMR vs LP', 'Сезонный сброс', 'Decay'].map((t) => (
                          <span key={t} className="rounded-full bg-surface-2 px-3 py-1 text-[11px] text-text-secondary">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>

          <div className="flex w-full flex-col gap-4 lg:w-[360px]">
            <Card className="flex-col gap-3 p-5 bg-gradient-to-br from-accent to-pink border-accent/40 shadow-glow">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-success ring-2 ring-success/30" />
                <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-primary">ОНЛАЙН</span>
              </div>
              <h3 className="font-display text-lg font-bold text-text-primary">Живой чат с поддержкой</h3>
              <p className="text-xs text-white/80">4 минуты средн. ответа</p>
              <div className="flex -space-x-2">
                <Avatar size="sm" gradient="violet-cyan" initials="A" />
                <Avatar size="sm" gradient="pink-violet" initials="K" />
                <Avatar size="sm" gradient="success-cyan" initials="M" />
              </div>
              <Button variant="ghost" className="border-white/30 text-text-primary hover:bg-white/10" icon={<MessageCircle className="h-4 w-4" />}>
                Открыть чат
              </Button>
            </Card>

            <Card className="flex-col gap-3 p-5">
              <h3 className="font-display text-sm font-bold text-text-primary">Связаться</h3>
              {[
                { icon: <Mail className="h-3.5 w-3.5" />, l: 'Email', v: 'help@druz9.dev' },
                { icon: <Send className="h-3.5 w-3.5" />, l: 'Telegram', v: '@druz9_support' },
                { icon: <MessageCircle className="h-3.5 w-3.5" />, l: 'Discord', v: 'discord.gg/druz9' },
                { icon: <Github className="h-3.5 w-3.5" />, l: 'GitHub', v: 'druz9/feedback' },
              ].map((c) => (
                <div key={c.l} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] text-text-secondary">{c.icon} {c.l}</span>
                  <span className="font-mono text-[11px] text-text-muted">{c.v}</span>
                </div>
              ))}
            </Card>

            <Card className="flex-col gap-2 p-5">
              <div className="flex items-center gap-2">
                <Circle className="h-2.5 w-2.5 fill-success text-success" />
                <span className="font-mono text-[11px] font-bold tracking-[0.08em] text-success">ВСЕ СИСТЕМЫ В ПОРЯДКЕ</span>
              </div>
              <a className="text-xs text-text-muted underline-offset-2 hover:underline" href="#">status.druz9.dev →</a>
            </Card>
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
