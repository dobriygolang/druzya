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
//     `mock_pipeline.coming_soon` and we render the EmptyState with a retry
//     CTA (the legacy /voice-mock fallback was dropped in D7 2026-05-12).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Bot, Check, Target } from 'lucide-react'
import { useT } from '@d9-i18n'
import { AppShellV2 } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import { CompanyCard } from '../../components/mock/CompanyCard'
import { TrackFilterChips } from '../../components/TrackFilterChips'
import { useTrackFilter } from '../../lib/useTrackFilter'
import { classifyMockCompanySections, itemMatchesFilter } from '../../lib/trackFilter'
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
//
// `id` остаётся в module-scope (используется в loadInitialSections для валидации
// сохранённых значений). Labels / hints локализуются внутри компонента через useT.
const SECTION_IDS = ['hr', 'algo', 'coding', 'sysdesign', 'behavioral'] as const
const SECTION_LABELS: Record<(typeof SECTION_IDS)[number], string> = {
  hr: 'HR',
  algo: 'Algo',
  coding: 'Coding',
  sysdesign: 'System Design',
  behavioral: 'Behavioral',
}

const MOCK_SECTIONS_STORAGE_KEY = 'druz9.mock.sections'

// atlasSectionToMockSections — Atlas node.section ('algorithms', 'sql',
// 'system_design', 'english_hr', 'ml_eng', 'databases', …) → подмножество
// mock-секций (hr/algo/coding/sysdesign/behavioral). Используется когда
// юзер пришёл с /atlas?focus=<node> — pre-select'аем матчинг секции.
function atlasSectionToMockSections(s: string): string[] {
  switch (s) {
    case 'algorithms':
      return ['algo']
    case 'system_design':
      return ['sysdesign']
    case 'sql':
    case 'databases':
      return ['coding']
    case 'english_hr':
    case 'english':
      return ['hr']
    case 'ml_eng':
      return ['algo', 'coding']
    case 'behavioral':
      return ['behavioral']
    default:
      return []
  }
}

function loadInitialSections(): string[] {
  try {
    if (typeof window === 'undefined') return []
    const raw = window.localStorage.getItem(MOCK_SECTIONS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string' && (SECTION_IDS as readonly string[]).includes(x))
  } catch {
    return []
  }
}

export default function MockCompanyPicker() {
  const t = useT()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const companies = useMockCompaniesQuery()
  const create = useCreateMockPipelineMutation()
  const [aiAssist, setAiAssist] = useState<boolean>(loadInitialAiAssist)
  const [selectedSections, setSelectedSections] = useState<string[]>(loadInitialSections)

  const SECTION_OPTIONS = useMemo(
    () => [
      { id: 'hr', label: SECTION_LABELS.hr, hint: t('mock.picker.section.hr.hint') },
      { id: 'algo', label: SECTION_LABELS.algo, hint: t('mock.picker.section.algo.hint') },
      { id: 'coding', label: SECTION_LABELS.coding, hint: t('mock.picker.section.coding.hint') },
      { id: 'sysdesign', label: SECTION_LABELS.sysdesign, hint: t('mock.picker.section.sysdesign.hint') },
      { id: 'behavioral', label: SECTION_LABELS.behavioral, hint: t('mock.picker.section.behavioral.hint') },
    ],
    [t],
  )

  const { selected: selectedTracks, setSelected: setSelectedTracks } = useTrackFilter({
    persistKey: 'mock:track-filter:v1',
    defaultFromPrimaryGoal: true,
  })

  const filteredCompanies = useMemo(() => {
    if (!companies.data) return []
    if (selectedTracks.size === 0) return companies.data
    return companies.data.filter((c) => {
      const trackSet = classifyMockCompanySections(c.sections ?? [])
      return itemMatchesFilter(trackSet, selectedTracks)
    })
  }, [companies.data, selectedTracks])

  // ?focus=<atlas_node_id>&section=<atlas_section>&title=<node_title> —
  // пришли из Atlas drawer. Pre-select'аем mock-секции под этот узел и
  // показываем banner. Только при первом mount, чтобы не override'ить
  // юзера если он манипулирует чипами.
  const focusNodeId = searchParams.get('focus') ?? ''
  const focusSection = searchParams.get('section') ?? ''
  const focusTitle = searchParams.get('title') ?? ''
  useEffect(() => {
    if (!focusSection) return
    const mapped = atlasSectionToMockSections(focusSection)
    if (mapped.length === 0) return
    persistSections(mapped)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot
  }, [])

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
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">Mock Interview</div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
            {t('mock.picker.title')}
          </h1>
          <p className="text-sm text-text-secondary max-w-2xl">
            {t('mock.picker.body')}
          </p>
        </header>

        {focusNodeId && focusTitle && (
          <div className="relative flex items-start gap-3 rounded-xl border border-border-strong bg-surface-2 p-4 pl-5">
            <span
              aria-hidden
              className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-xl"
              style={{ background: 'var(--red)' }}
            />
            <Target className="mt-0.5 h-4 w-4 shrink-0 text-text-primary" />
            <div className="flex-1">
              <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                {t('mock.picker.atlas_focus.label')}
              </div>
              <div className="mt-0.5 text-[14px] font-medium text-text-primary">
                {t('mock.picker.atlas_focus.topic', { title: focusTitle })}
              </div>
              <p className="mt-1 text-[12px] text-text-secondary">
                {t('mock.picker.atlas_focus.body')}
              </p>
            </div>
          </div>
        )}

        <FirstRunSteps />


        <fieldset
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface-1 p-4"
          aria-label={t('mock.picker.sections.aria')}
        >
          <legend className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted px-1">
            {t('mock.picker.sections.legend')}
          </legend>
          <p className="text-xs text-text-secondary">
            {t('mock.picker.sections.help')}
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
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-xs tracking-[0.08em] transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-emphasized)]',
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
          aria-label={t('mock.picker.ai_assist.aria')}
        >
          <legend className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted px-1">
            {t('mock.picker.ai_assist.legend')}
          </legend>
          <AiAssistOption
            checked={!aiAssist}
            onSelect={() => persistAiAssist(false)}
            title={t('mock.picker.ai_assist.off.title')}
            body={t('mock.picker.ai_assist.off.body')}
          />
          <AiAssistOption
            checked={aiAssist}
            onSelect={() => persistAiAssist(true)}
            title={t('mock.picker.ai_assist.on.title')}
            body={t('mock.picker.ai_assist.on.body')}
            icon={<Bot className="h-4 w-4 text-text-secondary" />}
          />
        </fieldset>

        {/* Track filter chips — Phase K 6.1. Narrows visible companies
            to firms touching the active track. Hidden during loading /
            error / empty states (no point filtering nothing). */}
        {companies.isSuccess && companies.data.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-1 p-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              {t('mock.picker.track_filter.label')}
            </span>
            <TrackFilterChips
              selected={selectedTracks}
              onChange={setSelectedTracks}
              persistKey="mock:track-filter:v1"
              ariaLabel={t('mock.picker.track_filter.aria')}
            />
            {selectedTracks.size > 0 && (
              <span className="font-mono text-[10px] text-text-muted">
                · {filteredCompanies.length} / {companies.data.length}
              </span>
            )}
          </div>
        )}

        {companies.isLoading && <EmptyState variant="loading" skeletonLayout="card-grid" />}

        {companies.isError && isComingSoonError(companies.error) && (
          <EmptyState
            variant="coming-soon"
            title={t('mock.picker.coming_soon.title')}
            body={t('mock.picker.coming_soon.body')}
            cta={{ label: t('mock.picker.coming_soon.cta'), onClick: () => navigate('/atlas') }}
          />
        )}

        {companies.isError && !isComingSoonError(companies.error) && (
          <EmptyState
            variant="error"
            title={t('mock.picker.err.load_title')}
            body={t('mock.picker.err.load_body')}
            cta={{ label: t('mock.pipeline.err.retry'), onClick: () => companies.refetch() }}
          />
        )}

        {companies.isSuccess && companies.data.length === 0 && (
          <EmptyState
            variant="error"
            title={t('mock.picker.err.empty_title')}
            body={t('mock.picker.err.empty_body')}
            cta={{ label: t('mock.pipeline.err.retry'), onClick: () => companies.refetch() }}
          />
        )}

        {companies.isSuccess && companies.data.length > 0 && filteredCompanies.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-surface-1 p-6 text-center">
            <p className="text-sm text-text-secondary">
              {t('mock.picker.err.no_track')}
            </p>
          </div>
        )}

        {companies.isSuccess && filteredCompanies.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {filteredCompanies.map((c) => (
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
          <div
            className="relative pl-3 text-sm text-text-primary"
            role="alert"
          >
            <span
              aria-hidden
              className="absolute left-0 top-0 h-full w-[1.5px]"
              style={{ background: 'var(--red)' }}
            />
            {t('mock.picker.err.create_pipeline_prefix')} {(create.error as Error).message}
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
        'relative flex items-start gap-3 rounded-lg border p-3 text-left transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-emphasized)]',
        checked
          ? 'border-text-primary bg-text-primary/10'
          : 'border-border bg-surface-2 hover:border-border-strong',
      ].join(' ')}
    >
      {checked && (
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-lg"
          style={{ background: 'var(--red)' }}
        />
      )}
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
  const t = useT()
  const steps: Array<{ n: string; title: string; body: string }> = [
    {
      n: '1',
      title: 'Pick a company',
      body: t('mock.picker.first_run.step1.body'),
    },
    {
      n: '2',
      title: '5 stages back-to-back',
      body: t('mock.picker.first_run.step2.body'),
    },
    {
      n: '3',
      title: 'AI report at the end',
      body: t('mock.picker.first_run.step3.body'),
    },
  ]
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4">
      <div className="mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('mock.picker.first_run.header')}
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
