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
      {/* Hero с поиском — underline-only search foundation, ink-ramp chips */}
      <div
        className="relative h-auto overflow-hidden bg-surface-3 lg:h-[240px]"
        style={{ borderBottom: '1px solid var(--hair-2)' }}
      >
        <div className="flex h-full flex-col items-center justify-center gap-4 px-4 py-10 sm:px-8 lg:py-0">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{
              background: 'rgba(var(--ink), 0.06)',
              color: 'var(--ink-60)',
            }}
          >
            <span
              className="inline-block h-1 w-1 rounded-full"
              style={{ background: 'var(--red)' }}
              aria-hidden
            />
            HELP · ПОДДЕРЖКА
          </span>
          <h1
            className="font-display text-3xl font-extrabold sm:text-4xl lg:text-[40px]"
            style={{ color: 'rgb(var(--ink))' }}
          >
            Чем помочь?
          </h1>
          <p className="text-center text-sm" style={{ color: 'var(--ink-60)' }}>
            Поиск по <span className="font-display tabular-nums" style={{ color: 'rgb(var(--ink))' }}>{HELP_TOTAL_ARTICLES}</span>{' '}
            статьям, чат с поддержкой и контакты
          </p>
          <div
            className="flex h-11 w-full max-w-[720px] items-center gap-3 px-1"
            style={{
              borderBottom: '1px solid var(--hair-2)',
              transition: 'border-color var(--motion-dur-small) var(--motion-ease-standard)',
            }}
          >
            <Search className="h-5 w-5 shrink-0" style={{ color: 'var(--ink-40)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
              style={{ color: 'rgb(var(--ink))' }}
              placeholder="Введи вопрос или ключевое слово…"
            />
            <span className="hidden font-mono text-[11px] sm:inline" style={{ color: 'var(--ink-40)' }}>⌘K</span>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {HELP_QUICK_QUESTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setSearch(c)}
                className="rounded-full px-3 py-1 text-xs"
                style={{
                  border: '1px solid var(--hair-2)',
                  background: 'rgba(var(--ink), 0.04)',
                  color: 'rgb(var(--ink))',
                  transition:
                    'background var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard)',
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-8 px-4 py-8 sm:px-8 lg:px-20 lg:py-10">
        {/* Категории */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
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
  // Phase B (schema_v2): support is Telegram-only. The DB column
  // contact_kind has CHECK IN ('telegram') and email-auth was dropped, so the
  // form locks the channel to TG. Users without a linked TG account see the
  // 'link TG to contact support' notice instead of the form (handled by the
  // parent HelpPage based on tg_user_link).
  const contactKind: SupportContactKind = 'telegram'
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
    if (value.length < 2) return 'Введи Telegram username (@user) или телефон'
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
      <Card className="flex-col gap-3 border-success/40 bg-success/10 p-5">
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-display text-base font-bold">Заявка отправлена</span>
        </div>
        <p className="text-xs text-text-secondary">
          Номер обращения: <code className="font-mono">{mutation.data.ticket_id.slice(0, 8)}</code>.
          Ответ придёт в твой Telegram в течение 1–2 часов в рабочее время.
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

  // Underline-only inputs — foundation form style. No surface fill or
  // border ring; focus ramps the bottom hair to full ink via the
  // motion-small token. Aligns with hero search.
  const fieldStyle: React.CSSProperties = {
    borderBottom: '1px solid var(--hair-2)',
    color: 'rgb(var(--ink))',
    background: 'transparent',
    transition: 'border-color var(--motion-dur-small) var(--motion-ease-standard)',
  }
  return (
    <Card className="flex-col gap-3 border border-border-strong bg-surface-2 p-5">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-success ring-2 ring-success/30" />
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-primary">
          ОНЛАЙН
        </span>
      </div>
      <h3 className="font-display text-lg font-bold text-text-primary">Написать в поддержку</h3>
      <p className="text-xs" style={{ color: 'var(--ink-60)' }}>
        Среднее время ответа — 1–2 часа в рабочее время
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <p className="font-mono text-[10px] tracking-[0.08em]" style={{ color: 'var(--ink-40)' }}>
          КАНАЛ · TELEGRAM
        </p>

        <input
          value={contactValue}
          onChange={(e) => setContactValue(e.target.value)}
          placeholder="@username"
          className="px-1 py-2 text-[13px] placeholder:text-white/40 focus:outline-none"
          style={fieldStyle}
          required
        />

        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Тема (необязательно)"
          maxLength={200}
          className="px-1 py-2 text-[13px] placeholder:text-white/40 focus:outline-none"
          style={fieldStyle}
        />

        <div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Опиши проблему: что произошло, что ожидал, какие шаги привели к багу"
            rows={4}
            maxLength={maxMsgLen}
            className="w-full resize-y px-1 py-2 text-[13px] placeholder:text-white/40 focus:outline-none"
            style={fieldStyle}
            required
          />
          <div className="mt-1 flex justify-end text-[10px]" style={{ color: 'var(--ink-40)' }}>
            {remaining < 200 ? `${remaining} символов` : ''}
          </div>
        </div>

        {(validationErr || apiErr) && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
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
