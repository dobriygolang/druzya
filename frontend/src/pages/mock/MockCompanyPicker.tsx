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
// mock; the toggle just gates a right-side AIAssistantChat in the cockpit.
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

export default function MockCompanyPicker() {
  const navigate = useNavigate()
  const companies = useMockCompaniesQuery()
  const create = useCreateMockPipelineMutation()
  const [aiAssist, setAiAssist] = useState<boolean>(loadInitialAiAssist)

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

  const handlePick = (company_id: string) => {
    create.mutate(
      { company_id, ai_assist: aiAssist },
      {
        onSuccess: (pipeline) => navigate(`/mock/pipeline/${pipeline.id}`),
      },
    )
  }

  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <header className="flex flex-col gap-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-pink">Mock Interview</div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
            Выбери компанию для собеса
          </h1>
          <p className="text-sm text-text-secondary max-w-2xl">
            5 секций подряд: скрининг с голосовой нейрокой → Go + SQL → алгоритмы → System Design (с Excalidraw
            доской) → behavioral. На каждой секции ставится оценка, в конце — отчёт.
          </p>
        </header>

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
            icon={<Bot className="h-4 w-4 text-pink" />}
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
          ? 'border-accent bg-accent/10'
          : 'border-border bg-surface-2 hover:border-border-strong',
      ].join(' ')}
    >
      <span
        className={[
          'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border',
          checked ? 'border-accent bg-accent text-bg' : 'border-border bg-surface-1',
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
