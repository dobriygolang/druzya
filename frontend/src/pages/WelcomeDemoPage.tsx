// /welcome/demo — интерактивный тур по платформе для гостей и онбординга.
//
// Показывает 4 ключевых раздела (Sanctum / Arena / Daily Kata / Codex) в виде
// карточек со скриншот-плейсхолдерами, краткими описаниями и CTA «открыть
// раздел». Нет демо-видео — заменили на быстрый interactive tour, потому
// что:
//   1) короткое видео всё равно требует CDN/обновления при каждом
//      редизайне → лишний maintenance;
//   2) live-карточки сразу позволяют пользователю кликнуть и попробовать
//      раздел, что эффективнее повышает engagement.
//
// Доступ — гостям (страница не требует авторизации). При клике на CTA
// неавторизованный юзер уйдёт через /login flow.

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Swords,
  Calendar,
  BookOpen,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { Button } from '../components/Button'

interface TourStep {
  id: string
  icon: typeof Swords
  title: string
  body: string
  cta: { label: string; to: string }
  accentClass: string
}

const STEPS: TourStep[] = [
  {
    id: 'sanctum',
    icon: Sparkles,
    title: 'Sanctum — твой штаб',
    body:
      'Дашборд с XP, текущим стриком, рекомендациями на сегодня и быстрым доступом к матчу за 5 секунд.',
    cta: { label: 'Открыть Sanctum', to: '/sanctum' },
    accentClass: 'from-cyan to-accent',
  },
  {
    id: 'arena',
    icon: Swords,
    title: 'Arena — реальные собесы',
    body:
      'Парные матчи 1v1 / 2v2 с живыми соперниками. Алгоритмы, system design, behavioural — всё, что спрашивают на интервью.',
    cta: { label: 'В Арену', to: '/arena' },
    accentClass: 'from-pink to-accent',
  },
  {
    id: 'daily',
    icon: Calendar,
    title: 'Daily Kata — стрик',
    body: 'Одно тёплое задание в день, чтобы держать форму. Без него стрик не нарастёт, а с ним — растёт LP и достижения.',
    cta: { label: 'Сегодняшняя ката', to: '/daily' },
    accentClass: 'from-success to-cyan',
  },
  {
    id: 'codex',
    icon: BookOpen,
    title: 'Codex — атлас знаний',
    body: 'Шпаргалки по разделам, разбор паттернов и ссылки на разборы. Удобно открывать прямо во время Mock-сессии.',
    cta: { label: 'Открыть Codex', to: '/codex' },
    accentClass: 'from-warn to-pink',
  },
]

function StepCard({ step, active }: { step: TourStep; active: boolean }) {
  const reduced = useReducedMotion()
  const Icon = step.icon
  const navigate = useNavigate()
  return (
    <motion.div
      initial={false}
      animate={{
        opacity: active ? 1 : 0.55,
        scale: active ? 1 : 0.97,
      }}
      transition={reduced ? { duration: 0 } : { duration: 0.25, ease: 'easeOut' }}
      className="flex h-full flex-col gap-4 rounded-2xl border border-border bg-surface-1 p-6"
    >
      <div className={`grid h-14 w-14 place-items-center rounded-xl bg-gradient-to-br ${step.accentClass}`}>
        <Icon className="h-6 w-6 text-text-primary" />
      </div>
      <h3 className="font-display text-xl font-bold text-text-primary">{step.title}</h3>
      <p className="text-[14px] leading-relaxed text-text-secondary">{step.body}</p>
      <div className="mt-auto">
        <Button variant="primary" onClick={() => navigate(step.cta.to)}>
          {step.cta.label} <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </motion.div>
  )
}

export default function WelcomeDemoPage() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    document.body.classList.add('v2')
    return () => document.body.classList.remove('v2')
  }, [])

  function go(delta: number) {
    setStep((s) => (s + delta + STEPS.length) % STEPS.length)
  }

  const current = STEPS[step]

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <header className="flex h-[72px] items-center justify-between border-b border-border bg-bg px-4 sm:px-8 lg:px-20">
        <Link
          to="/welcome"
          className="flex items-center gap-2 text-sm font-medium text-text-muted hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Назад
        </Link>
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          Шаг {step + 1} / {STEPS.length}
        </span>
      </header>
      <main className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-4 py-10 sm:py-16">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="font-display text-3xl font-extrabold text-text-primary sm:text-4xl">
            Тур по druz9
          </h1>
          <p className="mx-auto max-w-[640px] text-text-secondary">
            Четыре экрана о том, как платформа поможет тебе быстрее выйти на оффер.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {STEPS.map((s, i) => (
            <StepCard key={s.id} step={s} active={i === step} />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-1 px-4 text-sm font-medium text-text-primary hover:bg-surface-2"
            aria-label="Предыдущий шаг"
          >
            <ChevronLeft className="h-4 w-4" /> Назад
          </button>
          <div className="flex items-center gap-2" aria-label="Прогресс тура">
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStep(i)}
                className={
                  i === step
                    ? 'h-2 w-6 rounded-full bg-accent'
                    : 'h-2 w-2 rounded-full bg-surface-2 hover:bg-surface-3'
                }
                aria-label={`Шаг ${i + 1}`}
                aria-current={i === step}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => go(1)}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-1 px-4 text-sm font-medium text-text-primary hover:bg-surface-2"
            aria-label="Следующий шаг"
          >
            Дальше <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface-1 p-6 text-center">
          <h2 className="font-display text-lg font-bold text-text-primary">Готов попробовать {current.title.split('—')[0].trim()}?</h2>
          <p className="text-sm text-text-secondary">Войди или зарегистрируйся, чтобы открыть полный доступ.</p>
          <Link
            to="/login"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-text-primary hover:bg-accent-hover"
          >
            Войти в druz9
          </Link>
        </div>
      </main>
    </div>
  )
}
