// /help — страница помощи и FAQ.
//
// Контент полностью статический (см. content/help.ts) — нет смысла гонять
// ручку /help в backend ради FAQ и контактов. Если в будущем появится CMS
// или dynamic articles — заменить импорт на useHelpQuery.

import { useMemo, useState } from 'react'
import {
  Search,
  ChevronDown,
  ChevronUp,
  Circle,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Send,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { useCreateSupportTicket, type SupportContactKind } from '../lib/queries/support'
import {
  HELP_CATEGORIES,
  HELP_FAQ,
  HELP_QUICK_QUESTIONS,
  HELP_CONTACTS,
  HELP_TOTAL_ARTICLES,
} from '../content/help'

export default function HelpPage() {
  const [openId, setOpenId] = useState<string>(HELP_FAQ[0]?.id ?? '')
  const [search, setSearch] = useState('')

  // Простая клиентская фильтрация: соответствие в question/answer/tags.
  // Для статики (6 пунктов) этого хватает; полнотекстовый поиск не нужен.
  const filteredFaq = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return HELP_FAQ
    return HELP_FAQ.filter((f) => {
      if (f.question.toLowerCase().includes(q)) return true
      const answerStr =
        typeof f.answer === 'string' ? f.answer.toLowerCase() : ''
      if (answerStr.includes(q)) return true
      return (f.tags ?? []).some((t) => t.toLowerCase().includes(q))
    })
  }, [search])

  return (
    <AppShellV2>
      {/* Hero с поиском */}
      <div className="relative h-auto overflow-hidden bg-gradient-to-br from-surface-3 to-accent lg:h-[240px]">
        <div className="flex h-full flex-col items-center justify-center gap-4 px-4 py-8 sm:px-8 lg:py-0">
          <h1 className="font-display text-3xl font-extrabold text-text-primary sm:text-4xl lg:text-[36px]">
            Чем помочь?
          </h1>
          <p className="text-center text-sm text-white/80">
            Поиск по {HELP_TOTAL_ARTICLES} статьям, чат с поддержкой и контакты
          </p>
          <div className="flex h-12 w-full max-w-[720px] items-center gap-3 rounded-xl border border-white/20 bg-bg/60 px-4 backdrop-blur">
            <Search className="h-5 w-5 shrink-0 text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
              placeholder="Введи вопрос или ключевое слово…"
            />
            <span className="hidden font-mono text-[11px] text-text-muted sm:inline">⌘K</span>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {HELP_QUICK_QUESTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setSearch(c)}
                className="rounded-full border border-white/20 bg-bg/40 px-3 py-1 text-xs text-text-primary hover:bg-bg/60"
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-8 px-4 py-8 sm:px-8 lg:px-20 lg:py-10">
        {/* Категории */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {HELP_CATEGORIES.map((c) => (
            <Card
              key={c.slug}
              interactive
              className="flex-col items-start gap-3 p-5 cursor-pointer"
            >
              <span
                className={`grid h-10 w-10 place-items-center rounded-lg ${c.bg} ${c.color}`}
              >
                {c.icon}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-display text-sm font-bold text-text-primary">
                  {c.label}
                </span>
                <span className="font-mono text-[11px] text-text-muted">
                  {c.count} статей
                </span>
              </div>
            </Card>
          ))}
        </div>

        {/* FAQ + Sidebar */}
        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <h2 className="font-display text-lg font-bold text-text-primary">
              Популярные вопросы
              {search && (
                <span className="ml-2 font-mono text-xs font-medium text-text-muted">
                  · найдено {filteredFaq.length}
                </span>
              )}
            </h2>
            {filteredFaq.length === 0 ? (
              <Card className="flex-col gap-2 p-5 text-center">
                <p className="text-sm text-text-secondary">
                  Ничего не нашли по запросу «{search}». Попробуй другой
                  ключевой запрос или напиши в поддержку справа.
                </p>
              </Card>
            ) : (
              filteredFaq.map((f) => {
                const isOpen = f.id === openId
                return (
                  <Card key={f.id} className="flex-col gap-3 p-5">
                    <button
                      type="button"
                      onClick={() => setOpenId(isOpen ? '' : f.id)}
                      className="flex items-center justify-between gap-3 text-left"
                    >
                      <span className="min-w-0 break-words font-display text-base font-semibold text-text-primary">
                        {f.question}
                      </span>
                      {isOpen ? (
                        <ChevronUp className="h-4 w-4 shrink-0 text-text-muted" />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />
                      )}
                    </button>
                    {isOpen && (
                      <div className="flex flex-col gap-3 border-t border-border pt-4">
                        {typeof f.answer === 'string' ? (
                          <p className="break-words text-sm leading-relaxed text-text-secondary">
                            {f.answer}
                          </p>
                        ) : (
                          f.answer
                        )}
                        {f.tags && f.tags.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {f.tags.map((t) => (
                              <span
                                key={t}
                                className="rounded-full bg-surface-2 px-3 py-1 text-[11px] text-text-secondary"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                )
              })
            )}
          </div>

          {/* Sidebar — форма поддержки + контакты + статус */}
          <div className="flex w-full flex-col gap-4 lg:w-[360px] lg:shrink-0">
            <SupportForm />


            <Card className="flex-col gap-3 p-5">
              <h3 className="font-display text-sm font-bold text-text-primary">Связаться</h3>
              {HELP_CONTACTS.map((c) => {
                const inner = (
                  <>
                    <span className="flex min-w-0 items-center gap-2 text-[13px] text-text-secondary">
                      <span className="shrink-0">{c.icon}</span>
                      <span className="truncate">{c.label}</span>
                    </span>
                    <span className="ml-2 truncate font-mono text-[11px] text-text-muted">
                      {c.value}
                    </span>
                  </>
                )
                return c.href ? (
                  <a
                    key={c.kind}
                    href={c.href}
                    target={c.href.startsWith('http') ? '_blank' : undefined}
                    rel={c.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                    className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-surface-2"
                  >
                    {inner}
                  </a>
                ) : (
                  <div key={c.kind} className="flex items-center justify-between gap-2 px-1">
                    {inner}
                  </div>
                )
              })}
            </Card>

            <Link to="/status">
              <Card interactive className="flex-col gap-2 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Circle className="h-2.5 w-2.5 fill-success text-success" />
                    <span className="font-mono text-[11px] font-bold tracking-[0.08em] text-success">
                      ВСЕ СИСТЕМЫ В ПОРЯДКЕ
                    </span>
                  </div>
                  <ExternalLink className="h-3 w-3 text-text-muted" />
                </div>
                <span className="text-xs text-text-muted">
                  Проверить статус сервисов
                </span>
              </Card>
            </Link>
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}

/* ── SupportForm ────────────────────────────────────────────────────────── */

// SupportForm — форма обращения в поддержку.
// POST /api/v1/support/ticket → запись в БД + alert в support-чат в Telegram.
// Ответ юзеру приходит на указанный канал (email или @druz9_bot deep-link).
function SupportForm() {
  const [contactKind, setContactKind] = useState<SupportContactKind>('telegram')
  const [contactValue, setContactValue] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [validationErr, setValidationErr] = useState<string | null>(null)
  const mutation = useCreateSupportTicket()

  const minMsgLen = 10
  const maxMsgLen = 5000
  const remaining = maxMsgLen - message.length

  function validate(): string | null {
    const value = contactValue.trim()
    if (contactKind === 'email') {
      if (!/^\S+@\S+\.\S+$/.test(value)) return 'Введи корректный email'
    } else {
      if (value.length < 2) return 'Введи Telegram username (@user) или телефон'
    }
    if (message.trim().length < minMsgLen) {
      return `Сообщение слишком короткое (минимум ${minMsgLen} символов)`
    }
    if (message.length > maxMsgLen) {
      return `Сообщение слишком длинное (максимум ${maxMsgLen} символов)`
    }
    return null
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setValidationErr(null)
    const err = validate()
    if (err) {
      setValidationErr(err)
      return
    }
    mutation.mutate({
      contact_kind: contactKind,
      contact_value: contactValue.trim(),
      subject: subject.trim() || undefined,
      message: message.trim(),
    })
  }

  // Success state — показываем подтверждение, кнопку "новое обращение".
  if (mutation.isSuccess) {
    return (
      <Card className="flex-col gap-3 border-success/40 bg-gradient-to-br from-success/15 to-cyan/15 p-5">
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-display text-base font-bold">Заявка отправлена</span>
        </div>
        <p className="text-xs text-text-secondary">
          Номер обращения: <code className="font-mono">{mutation.data.ticket_id.slice(0, 8)}</code>.
          Ответ придёт на твой {contactKind === 'email' ? 'email' : 'Telegram'} в течение
          1–2 часов в рабочее время.
        </p>
        <Button
          variant="ghost"
          className="self-start"
          onClick={() => {
            mutation.reset()
            setMessage('')
            setSubject('')
            setValidationErr(null)
          }}
        >
          Новое обращение
        </Button>
      </Card>
    )
  }

  const apiErr = mutation.isError
    ? (mutation.error instanceof Error ? mutation.error.message : 'Не удалось отправить')
    : null

  return (
    <Card className="flex-col gap-3 border-border-strong bg-surface-2 border border-border-strong p-5">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-success ring-2 ring-success/30" />
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-primary">
          ОНЛАЙН
        </span>
      </div>
      <h3 className="font-display text-lg font-bold text-text-primary">Написать в поддержку</h3>
      <p className="text-xs text-white/80">Среднее время ответа — 1–2 часа в рабочее время</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {/* Контакт-канал */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setContactKind('telegram')}
            className={`flex-1 rounded-md border px-2 py-1.5 text-[12px] transition ${
              contactKind === 'telegram'
                ? 'border-white/60 bg-white/15 text-text-primary'
                : 'border-white/20 text-white/70 hover:bg-white/5'
            }`}
          >
            Telegram
          </button>
          <button
            type="button"
            onClick={() => setContactKind('email')}
            className={`flex-1 rounded-md border px-2 py-1.5 text-[12px] transition ${
              contactKind === 'email'
                ? 'border-white/60 bg-white/15 text-text-primary'
                : 'border-white/20 text-white/70 hover:bg-white/5'
            }`}
          >
            Email
          </button>
        </div>

        <input
          value={contactValue}
          onChange={(e) => setContactValue(e.target.value)}
          placeholder={contactKind === 'telegram' ? '@username' : 'you@example.com'}
          className="rounded-md border border-white/30 bg-bg/60 px-3 py-2 text-[13px] text-text-primary placeholder:text-white/50 focus:border-white focus:outline-none"
          required
        />

        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Тема (необязательно)"
          maxLength={200}
          className="rounded-md border border-white/30 bg-bg/60 px-3 py-2 text-[13px] text-text-primary placeholder:text-white/50 focus:border-white focus:outline-none"
        />

        <div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Опиши проблему: что произошло, что ожидал, какие шаги привели к багу"
            rows={4}
            maxLength={maxMsgLen}
            className="w-full resize-y rounded-md border border-white/30 bg-bg/60 px-3 py-2 text-[13px] text-text-primary placeholder:text-white/50 focus:border-white focus:outline-none"
            required
          />
          <div className="mt-1 flex justify-end text-[10px] text-white/60">
            {remaining < 200 ? `${remaining} символов` : ''}
          </div>
        </div>

        {(validationErr || apiErr) && (
          <div className="rounded-md border border-red-300/40 bg-red-500/15 px-3 py-2 text-[12px] text-red-100">
            {validationErr ?? apiErr}
          </div>
        )}

        <Button
          variant="primary"
          type="submit"
          disabled={mutation.isPending}
          className="bg-white text-bg shadow-none hover:bg-white/90"
          icon={mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        >
          {mutation.isPending ? 'Отправляем…' : 'Отправить'}
        </Button>
      </form>
    </Card>
  )
}
