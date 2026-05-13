// AdminPage — operator console.
//
// Replaces the apigen-era hard-coded counters / task table with live data
// from the backend admin module:
//   - useAdminDashboardQuery — live counters (60s Redis cache server-side).
//   - useAdminUsersQuery     — paged user listing with active-ban metadata.
//   - useAdminReportsQuery   — moderation queue.
//
// Auth gate: useProfileQuery resolves the current viewer; users without
// role='admin' are redirected to /sanctum. The backend enforces the same
// gate, this is purely UX so non-admins don't see a blank 403 shell.
// TODO i18n
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useProfileQuery } from '../../lib/queries/profile'
import { useAdminDashboardQuery } from '../../lib/queries/admin'
import { Sidebar, type Tab } from './shared'
import { DashboardPanel } from './DashboardPanel'
import { UsersPanel } from './UsersPanel'
import { ReportsPanel } from './ReportsPanel'
import { PodcastsPanel } from './PodcastsPanel'
import { CodexPanel } from './CodexPanel'
import { AtlasPanel } from './AtlasPanel'
import { AIModelsPanel } from './AIModelsPanel'
import { LLMChainPanel } from './LLMChainPanel'
import { PersonasPanel } from './PersonasPanel'
import { MockCompaniesPanel } from './MockCompaniesPanel'
import { CompanyManagerPage } from './companies/CompanyManagerPage'
import { MockTasksPanel } from './MockTasksPanel'
import { MockQuestionsPanel } from './MockQuestionsPanel'
import { MockStrictnessPanel } from './MockStrictnessPanel'
import { QuotasPanel } from './QuotasPanel'
import { CopilotPlansPanel } from './CopilotPlansPanel'
import { ObservabilityDashboard } from './ObservabilityDashboard'
import { RoomsPanel } from './RoomsPanel'
import { GoalPresetsPanel } from './goals/GoalPresetsPanel'
import { CoachPromptsPanel } from './coach/CoachPromptsPanel'
import { NotificationTemplatesPanel } from './notifications/NotificationTemplatesPanel'
import { ABExperimentsPanel } from './ab/ABExperimentsPanel'
import { LinguaAdminPage } from './lingua'

export default function AdminPage() {
  const profile = useProfileQuery()
  const dashboard = useAdminDashboardQuery()
  const [tab, setTab] = useState<Tab>('dashboard')

  // Auth gate — the backend returns 403 for non-admins; we mirror the
  // outcome here so a non-admin user lands on /sanctum instead of an empty
  // shell. /profile/me must return successfully (a logged-in user); if
  // it 401s the apiClient already redirects to /welcome.
  if (profile.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text-muted">
        Загрузка…
      </div>
    )
  }
  // Surface server-side admin gate failure as a redirect. The dashboard
  // hook is the canonical "am I admin?" probe — if the role check fails,
  // the apiClient throws ApiError with status 403.
  const dashErrStatus = (dashboard.error as { status?: number } | null)?.status
  if (dashErrStatus === 403) {
    return <Navigate to="/atlas" replace />
  }

  const pending = dashboard.data?.reports_pending ?? 0
  // profile is referenced solely to ensure the bearer is valid before we
  // try to render the admin shell — its body isn't read.
  void profile
  return (
    <div className="flex min-h-screen flex-col bg-bg text-text-primary lg:flex-row">
      <Sidebar tab={tab} setTab={setTab} pendingReports={pending} />
      <main className="flex flex-1 flex-col">
        <div className="flex h-auto flex-col gap-1 border-b border-border bg-bg px-4 py-3 sm:px-7 lg:h-14 lg:flex-row lg:items-center lg:justify-between lg:py-0">
          <div>
            <h1 className="font-display text-lg font-bold text-text-primary">
              {tab === 'dashboard'
                ? 'Dashboard'
                : tab === 'users'
                  ? 'Users'
                  : tab === 'reports'
                    ? 'Reports'
                    : tab === 'podcasts'
                      ? 'Подкасты'
                      : tab === 'codex'
                        ? 'Codex · статьи'
                      : tab === 'atlas'
                        ? 'Atlas CMS'
                        : tab === 'personas'
                          ? 'Персоны'
                          : tab === 'llm_chain'
                            ? 'LLM Chain'
                            : tab === 'mock_company_manager'
                              ? 'Company Manager'
                              : tab === 'mock_companies'
                              ? 'Mock · компании (legacy)'
                              : tab === 'mock_tasks'
                                ? 'Mock · задачи'
                                : tab === 'mock_questions'
                                  ? 'Mock · вопросы'
                                  : tab === 'mock_strictness'
                                    ? 'Mock · строгость AI'
                                    : tab === 'quotas'
                                      ? 'Subscription · квоты'
                                      : tab === 'copilot_plans'
                                        ? 'Copilot · тарифы'
                                        : tab === 'observability'
                                          ? 'Observability'
                                          : tab === 'rooms'
                                            ? 'Rooms · moderation'
                                            : tab === 'goal_presets'
                                              ? 'Goal presets'
                                              : tab === 'coach_prompts'
                                                ? 'Coach prompts'
                                                : tab === 'notification_templates'
                                                  ? 'Notifications'
                                                  : tab === 'ab_experiments'
                                                    ? 'A/B experiments'
                                                    : tab === 'lingua'
                                                      ? 'Lingua · English'
                                                      : 'AI Modельки'}
            </h1>
            <span className="font-mono text-[11px] text-text-muted">Операционная панель druz9</span>
          </div>
        </div>
        {tab === 'dashboard' && <DashboardPanel setTab={setTab} />}
        {tab === 'users' && <UsersPanel />}
        {tab === 'reports' && <ReportsPanel />}
        {tab === 'podcasts' && <PodcastsPanel />}
        {tab === 'codex' && <CodexPanel />}
        {tab === 'atlas' && <AtlasPanel />}
        {tab === 'ai_models' && <AIModelsPanel />}
        {tab === 'llm_chain' && <LLMChainPanel />}
        {tab === 'personas' && <PersonasPanel />}
        {tab === 'mock_company_manager' && <CompanyManagerPage />}
        {tab === 'mock_companies' && <MockCompaniesPanel />}
        {tab === 'mock_tasks' && <MockTasksPanel />}
        {tab === 'mock_questions' && <MockQuestionsPanel />}
        {tab === 'mock_strictness' && <MockStrictnessPanel />}
        {tab === 'quotas' && <QuotasPanel />}
        {tab === 'copilot_plans' && <CopilotPlansPanel />}
        {tab === 'observability' && <ObservabilityDashboard />}
        {tab === 'rooms' && <RoomsPanel />}
        {tab === 'goal_presets' && <GoalPresetsPanel />}
        {tab === 'coach_prompts' && <CoachPromptsPanel />}
        {tab === 'notification_templates' && <NotificationTemplatesPanel />}
        {tab === 'ab_experiments' && <ABExperimentsPanel />}
        {tab === 'lingua' && <LinguaAdminPage />}
      </main>
    </div>
  )
}
