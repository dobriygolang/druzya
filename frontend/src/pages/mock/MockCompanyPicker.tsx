// MockCompanyPicker — landing page of the multi-stage mock interview flow.
//
// Route: /mock
//
// The user picks one company → we POST /mock/pipelines → navigate to
// /mock/pipeline/{id}. The 5 stages (screening → go+sql → algo →
// sys_design → behavioral) live on the cockpit page; this screen only
// owns the "which company are we simulating?" decision.
//
// Anti-fallback:
//   - Companies fetched live via useMockCompaniesQuery. No hardcoded list.
//   - When the backend orchestrator is gated (Wave-12), the query throws
//     `mock_pipeline.coming_soon` and we render the EmptyState that links
//     to the existing single-shot /voice-mock so users still have a path.

import { useNavigate } from 'react-router-dom'
import { AppShellV2 } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import { CompanyCard } from '../../components/mock/CompanyCard'
import {
  isComingSoonError,
  useCreateMockPipelineMutation,
  useMockCompaniesQuery,
} from '../../lib/queries/mockPipeline'

export default function MockCompanyPicker() {
  const navigate = useNavigate()
  const companies = useMockCompaniesQuery()
  const create = useCreateMockPipelineMutation()

  const handlePick = (company_id: string) => {
    create.mutate(
      { company_id },
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
