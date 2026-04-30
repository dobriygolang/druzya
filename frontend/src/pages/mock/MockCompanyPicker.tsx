// MockCompanyPicker — landing page of the multi-stage mock interview flow.
//
// Route: /mock
//
// The user picks one company → we POST /mock/pipelines → navigate to
// /mock/pipeline/{id}. The 5 stages (screening → go+sql → algo →
// sys_design → behavioral) live on the cockpit page; this screen owns
// two decisions:
//   1. which company to simulate
//   2. AI assistant — OFF (classic mock) or ON (chat panel during stages)
//
// Wave-12 UX consolidation: the AI-assist toggle replaces the separate
// "AI-allowed Interview" arena card. Both flows are the same multi-stage
// mock; the toggle is persisted on the pipeline row.
//
// Anti-fallback:
//   - Companies fetched live via useMockCompaniesQuery. No hardcoded list.
//   - When the backend orchestrator is gated (Wave-12), the query throws
//     `mock_pipeline.coming_soon` and we render the EmptyState that links
//     to the existing single-shot /voice-mock so users still have a path.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Check } from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import { CompanyCard } from '../../components/mock/CompanyCard'
import {
  isComingSoonError,
  MOCK_AI_ASSIST_STORAGE_KEY,
  useCreateMockPipelineMutation,
  useMockCompaniesQuery,
} from '../../lib/queries/mockPipeline'

function loadInitialAiAssist(): boolean {
  try {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(MOCK_AI_ASSIST_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

// Phase 1.6 — sections selector. Empty array (or all selected) = full
// 5-stage pipeline; subset = pipeline trimmed to those stages only.
// Persisted in localStorage so the user's preferred subset survives
// reloads inside one device.
const SECTION_OPTIONS: { id: string; label: string; hint: string }[] = [
  { id: 'hr', label: 'HR', hint: 'Скрининг с голосовой нейрокой' },
  { id: 'algo', label: 'Algo', hint: 'Алгоритмическая задача в редакторе' },
  { id: 'coding', label: 'Coding', hint: 'Go + SQL практический раунд' },
  { id: 'sysdesign', label: 'System Design', hint: 'Проектирование на whiteboard' },
  { id: 'behavioral', label: 'Behavioral', hint: 'Поведенческие вопросы' },
]

const MOCK_SECTIONS_STORAGE_KEY = 'druz9.mock.sections'

function loadInitialSections(): string[] {
  try {
    if (typeof window === 'undefined') return []
    const raw = window.localStorage.getItem(MOCK_SECTIONS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string' && SECTION_OPTIONS.some((o) => o.id === x))
  } catch {
    return []
  }
}

export default function MockCompanyPicker() {
  const navigate = useNavigate()
  const companies = useMockCompaniesQuery()
  const create = useCreateMockPipelineMutation()
  const [aiAssist, setAiAssist] = useState<boolean>(loadInitialAiAssist)
  const [selectedSections, setSelectedSections] = useState<string[]>(loadInitialSections)

  const persistAiAssist = (next: boolean) => {
    setAiAssist(next)
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(MOCK_AI_ASSIST_STORAGE_KEY, next ? '1' : '0')
      }
    } catch {
      /* localStorage unavailable — choice still applies for this session */
    }
  }

  const persistSections = (next: string[]) => {
    setSelectedSections(next)
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(MOCK_SECTIONS_STORAGE_KEY, JSON.stringify(next))
      }
    } catch {
      /* localStorage unavailable */
    }
  }

  const toggleSection = (id: string) => {
    if (selectedSections.includes(id)) {
      persistSections(selectedSections.filter((x) => x !== id))
    } else {
      persistSections([...selectedSections, id])
    }
  }

  const handlePick = (company_id: string) => {
    // Empty selection or "all" both mean full pipeline; backend treats
    // empty array as "no allow-list".
    const sections =
      selectedSections.length === 0 || selectedSections.length === SECTION_OPTIONS.length
        ? undefined
        : selectedSections
    create.mutate(
      { company_id, ai_assist: aiAssist, sections },
      {
        onSuccess: (pipeline) => navigate(`/mock/pipeline/${pipeline.id}`),
      },
    )
  }

  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <header className="flex flex-col gap-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">Mock Interview</div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
            Выбери компанию для собеса
          </h1>
          <p className="text-sm text-text-secondary max-w-2xl">
            5 секций подряд: скрининг с голосовой нейрокой → Go + SQL → алгоритмы → System Design (с Excalidraw
            доской) → behavioral. На каждой секции ставится оценка, в конце — отчёт.
          </p>
        </header>

        <FirstRunSteps />


        <fieldset
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface-1 p-4"
          aria-label="Какие секции тренировать"
        >
          <legend className="font-mono text-[10px] uppercase tracking-wider text-text-muted px-1">
            Секции пайплайна
          </legend>
          <p className="text-xs text-text-secondary">
            Пусто или все включены = полный 5-секционный собес. Выбери подмножество, чтобы потренировать только
            нужное.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {SECTION_OPTIONS.map((opt) => {
              const checked = selectedSections.includes(opt.id)
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggleSection(opt.id)}
                  title={opt.hint}
                  className={[
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-xs transition-colors',
                    checked
                      ? 'border-text-primary bg-text-primary text-bg'
                      : 'border-border bg-surface-2 text-text-secondary hover:border-text-primary/40 hover:text-text-primary',
                  ].join(' ')}
                >
                  {checked && <Check className="h-3 w-3" />}
                  {opt.label}
                </button>
              )
            })}
          </div>
        </fieldset>

        <fieldset
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface-1 p-4"
          aria-label="Режим AI-помощника"
        >
          <legend className="font-mono text-[10px] uppercase tracking-wider text-text-muted px-1">
            AI-помощник во время собеса
          </legend>
          <AiAssistOption
            checked={!aiAssist}
            onSelect={() => persistAiAssist(false)}
            title="AI-помощник запрещён"
            body="Классический mock: только ты, задачи и таймер. Так проходит реальный собес."
          />
          <AiAssistOption
            checked={aiAssist}
            onSelect={() => persistAiAssist(true)}
            title="AI-помощник разрешён"
            body="Справа во время алго / sys-design / behavioral будет чат с нейрокой — можно спрашивать подсказки."
            icon={<Bot className="h-4 w-4 text-text-secondary" />}
          />
        </fieldset>

        {companies.isLoading && <EmptyState variant="loading" skeletonLayout="card-grid" />}

        {companies.isError && isComingSoonError(companies.error) && (
          <EmptyState
            variant="coming-soon"
            title="Multi-stage Mock Interview"
            body="Запускается в Wave-12. Сейчас доступен одиночный mock /voice-mock — голосовая нейрока без многоступенчатого пайплайна."
            cta={{ label: 'Открыть /voice-mock', onClick: () => navigate('/voice-mock') }}
            secondaryCta={{ label: 'Назад в Arena', onClick: () => navigate('/arena') }}
          />
        )}

        {companies.isError && !isComingSoonError(companies.error) && (
          <EmptyState
            variant="error"
            title="Не удалось загрузить компании"
            body="Сервис собеседований временно недоступен."
            cta={{ label: 'Повторить', onClick: () => companies.refetch() }}
          />
        )}

        {companies.isSuccess && companies.data.length === 0 && (
          <EmptyState
            variant="error"
            title="Список компаний пуст"
            body="Каталог ещё не наполнен. Зайди позже или сообщи в /help."
            cta={{ label: 'Повторить', onClick: () => companies.refetch() }}
          />
        )}

        {companies.isSuccess && companies.data.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {companies.data.map((c) => (
              <CompanyCard
                key={c.id}
                company={c}
                onSelect={handlePick}
                loading={create.isPending && create.variables?.company_id === c.id}
              />
            ))}
          </div>
        )}

        {create.isError && (
          <div className="text-sm text-danger" role="alert">
            Не удалось запустить пайплайн: {(create.error as Error).message}
          </div>
        )}
      </div>
    </AppShellV2>
  )
}

function AiAssistOption({
  checked,
  onSelect,
  title,
  body,
  icon,
}: {
  checked: boolean
  onSelect: () => void
  title: string
  body: string
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={[
        'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
        checked
          ? 'border-text-primary bg-text-primary/10'
          : 'border-border bg-surface-2 hover:border-border-strong',
      ].join(' ')}
    >
      <span
        className={[
          'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border',
          checked ? 'border-text-primary bg-text-primary text-bg' : 'border-border bg-surface-1',
        ].join(' ')}
        aria-hidden
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 font-display text-sm font-bold text-text-primary">
          {icon}
          {title}
        </span>
        <span className="text-xs text-text-secondary">{body}</span>
      </div>
    </button>
  )
}

// FirstRunSteps — 3-card explainer for the mock pipeline.
//
// Phase 0.10 — pinned permanently (no Dismiss button). The previous
// localStorage-flag UX caused users to accidentally hide it on first
// visit and never see the explanation again — the cards are tiny and
// re-reading them costs nothing, while removing them stranded
// returning users without context.
function FirstRunSteps() {
  const steps: Array<{ n: string; title: string; body: string }> = [
    {
      n: '1',
      title: 'Pick a company',
      body: 'Каждая компания — свой набор этапов и стиль вопросов. На рандоме — общий пул.',
    },
    {
      n: '2',
      title: '5 stages back-to-back',
      body: 'HR → algo → coding → system design → behavioral. На каждом — таймер и AI-судья.',
    },
    {
      n: '3',
      title: 'AI report at the end',
      body: 'Pass/fail по каждому этапу + что упустил. Появится в /insights через секунду.',
    },
  ]
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4">
      <div className="mb-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          Как это работает
        </span>
      </div>
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {steps.map((s) => (
          <li
            key={s.n}
            className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-3"
          >
            <span className="grid h-7 w-7 place-items-center rounded-full bg-text-primary/10 font-display text-sm font-bold text-text-primary">
              {s.n}
            </span>
            <span className="font-display text-sm font-bold text-text-primary">{s.title}</span>
            <span className="text-xs text-text-secondary">{s.body}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
