import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'

import RouteLoader from './components/RouteLoader'
import { OfflineBanner } from './components/OfflineBanner'
import { readAccessToken } from './lib/apiClient'

// RootRedirect: гость → /welcome, авторизованный → /today.
// Pivot 2026-05-03: landing'ом стал /today (action-driven dashboard) вместо
// /atlas — Sergey справедливо заметил «zachem мне atlas сейчас, что бы что?».
// /atlas остаётся в nav как «карта тем для подготовки».
function RootRedirect() {
  return <Navigate to={readAccessToken() ? '/today' : '/welcome'} replace />
}

const TodayPage = lazy(() => import('./pages/TodayPage'))
const AtlasPage = lazy(() => import('./pages/AtlasPage'))
const AtlasExplorePage = lazy(() => import('./pages/atlas/AtlasExplorePage'))
const TrackDetailPage = lazy(() => import('./pages/atlas/TrackDetailPage'))
const TaskBoardPage = lazy(() => import('./pages/TaskBoardPage'))
const InsightsPage = lazy(() => import('./pages/InsightsPage'))
// /goals UI removed 2026-05-05 (R10 cleanup) — orphan page без nav-links.
// Coach всё ещё читает goals через GoalsReader (см services/intelligence/
// infra/cross_readers.go), CRUD endpoints в backend остаются для будущего
// surface'а или CLI-доступа.
const CodexPage = lazy(() => import('./pages/CodexPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const WelcomePage = lazy(() => import('./pages/WelcomePage'))
// Phase-4 ADR-001 — separate /copilot, /hone, /welcome/demo landings removed.
// Cue and Hone are now promoted as sections inside /welcome instead of
// duplicate landing pages. Demo overlay was an unused legacy step.
const LegalTermsPage = lazy(() => import('./pages/LegalTermsPage'))
const LegalPrivacyPage = lazy(() => import('./pages/LegalPrivacyPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const AuthCallbackYandexPage = lazy(() => import('./pages/AuthCallbackYandexPage'))
const GoogleCalendarCallbackPage = lazy(() => import('./pages/auth/GoogleCalendarCallback'))
const AllSetPage = lazy(() => import('./pages/AllSetPage'))
const InviteAcceptPage = lazy(() => import('./pages/InviteAcceptPage'))
// Wave 2.6 — tutor dashboard. Both routes are tutor-authenticated; the
// backend gates per-row, so an unauthorised viewer just sees an empty list.
const TutorDashboardPage = lazy(() => import('./pages/TutorDashboardPage'))
const TutorStudentPage = lazy(() => import('./pages/TutorStudentPage'))
const AITutorChatPage = lazy(() => import('./pages/AITutorChatPage'))
// Wave-10 onboarding flow (design-review v3 part A) — 5-step gated flow
// living under /onboarding/{welcome,class,skill,task}. Step 5 is a tour
// overlay on /sanctum (mounted via ?tour=1 query param).
const OnbStep0 = lazy(() => import('./pages/onboarding/Step0Tracks'))
const DiagnosticQuiz = lazy(() => import('./pages/onboarding/DiagnosticQuiz'))
const OnbPath = lazy(() => import('./pages/onboarding/StepPath'))
const OnbPathEdit = lazy(() => import('./pages/onboarding/PathEdit'))
const OnbPathCustom = lazy(() => import('./pages/onboarding/PathCustom'))
const OnbStep1 = lazy(() => import('./pages/onboarding/Step1Welcome'))
const OnbStep2 = lazy(() => import('./pages/onboarding/Step2Class'))
const OnbStep3 = lazy(() => import('./pages/onboarding/Step3Skill'))
const OnbStep4 = lazy(() => import('./pages/onboarding/Step4Task'))
const MockSessionPage = lazy(() => import('./pages/MockSessionPage'))
const MockResultPage = lazy(() => import('./pages/MockResultPage'))
// Wave-11: multi-stage mock interview pipeline (company picker →
// screening → go+sql → algo → sys_design → behavioral → debrief).
const MockCompanyPicker = lazy(() => import('./pages/mock/MockCompanyPicker'))
const MockPipelinePage = lazy(() => import('./pages/mock/MockPipelinePage'))
const MockPipelineDebrief = lazy(() => import('./pages/mock/MockPipelineDebrief'))
const MockCanvasFullscreen = lazy(() => import('./pages/mock/MockCanvasFullscreen'))
// F8 (Phase D, 2026-05-12) — mini-mock diagnostic mode. Single-page flow,
// localStorage-backed result feeds F3 readiness.
const MockDiagnosticPage = lazy(() => import('./pages/mock/DiagnosticPage'))
// D5 (2026-05-12) — podcasts back from Hone. Web content surface теперь
// hosts both articles (/codex) и podcasts (/podcasts) под KnowledgeHubTabs.
const PodcastsPage = lazy(() => import('./pages/PodcastsPage'))
// F1 Phase 2 (2026-05-12) — user-facing AI memory audit. Reads
// IntelligenceService.ListMemoryEntries (Agent I backend).
const MemoryPage = lazy(() => import('./pages/MemoryPage'))
// Phase-4 ADR-001 Wave 1+2 — `cohort`, `achievements`, `warroom` removed.
// Frontend pages deleted; routes redirect to /circles or /profile.
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const HelpPage = lazy(() => import('./pages/HelpPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const WeeklyReportPage = lazy(() => import('./pages/WeeklyReportPage'))
// /voice-mock standalone deleted (D7 2026-05-12) — voice answer теперь
// inline-инпут BehavioralStage'а; старые ссылки редиректим на /mock.
const AdminPage = lazy(() => import('./pages/AdminPage'))
const AdminInterviewerApplicationsPage = lazy(() => import('./pages/AdminInterviewerApplicationsPage'))
const StatusPage = lazy(() => import('./pages/StatusPage'))
// Wave-11 — premium subscription flow (5 screens). /pricing is public; the
// other three live behind whatever auth-state /sanctum reaches them with —
// the routes themselves don't gate, AppShell + apiClient do.
const PricingPage = lazy(() => import('./pages/pricing/PricingPage'))
const CheckoutPage = lazy(() => import('./pages/checkout/CheckoutPage'))
const CheckoutSuccess = lazy(() => import('./pages/checkout/CheckoutSuccess'))
const CheckoutFailure = lazy(() => import('./pages/checkout/CheckoutFailure'))
// Wave 5 (2026-05-12) — Stripe success_url target. Renders post-checkout
// hero + unlocked Pro features + next-action cards. Cancel route reuses
// /upgrade с ?retry=true banner.
const BillingWelcomePage = lazy(() => import('./pages/BillingWelcome'))
// Pair-coding (collaborative editor) переехал в Hone (bible §2.1 DNA-revision).
// Web-routes /pair удалены — primary surface теперь desktop, shareable URL
// приведёт сюда лендинг «Open in Hone». TODO: добавить hone-handoff page
// если понадобится поделиться ссылкой web-юзеру без Hone'а.

// Circles — community-layer (bible §9 Phase 6.5.3). UI создания circle +
// events (Book Club Fridays) — единственное web-creation-место для этой
// поверхности; Hone только показывает + RSVP.
const CirclesPage = lazy(() => import('./pages/circles/CirclesPage'))
const CircleDetailPage = lazy(() => import('./pages/circles/CircleDetailPage'))
// D4 (Stream F, 2026-05-12) — Whiteboard / Editor migrated from Hone to web
// в solo-mode. Peer-collab WS (Yjs / awareness / presence) dropped. Legacy
// WhiteboardSharePage / EditorRoomSharePage оставлены под их же URL'ами
// в виде новых SoloWhiteboardPage / SoloEditorPage; multi-player «share»
// flow сворачивается, обёртка над solo persistence.
const WhiteboardPage = lazy(() => import('./pages/whiteboard/WhiteboardPage'))
const EditorPage = lazy(() => import('./pages/editor/EditorPage'))

export default function App() {
  return (
    <Suspense fallback={<RouteLoader />}>
      <OfflineBanner />
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        {/* Pivot 2026-05-01: arena/lobby/match-end/2v2/daily/RPG-legacy
            routes удалены целиком. Бывшие external links (/sanctum,
            /obituary, /arena*, /lobby*, /match*, /daily*) теперь падают
            на NotFoundPage в самом низу. */}
        <Route path="/today" element={<TodayPage />} />
        <Route path="/atlas" element={<AtlasPage />} />
        {/* Phase 2e — Tracks UI. /atlas теперь Tracks ribbon (catalogue);
            старый skill-graph переехал в /atlas/explore. Детали трека —
            /atlas/track/:slug. */}
        <Route path="/atlas/explore" element={<AtlasExplorePage />} />
        <Route path="/atlas/track/:slug" element={<TrackDetailPage />} />
        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/tasks" element={<TaskBoardPage />} />
        {/* Calendar UI вырезан 2026-04-30: backend personal_events + coach
            CalendarReader keepalive, но web UI оказался вторичным. /calendar
            редиректит на /arena вторым роутом ниже. */}
        <Route path="/codex" element={<CodexPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        {/* WAVE-13 — /profile/weekly absorbs the standalone /weekly route as
            a profile sub-section. ProfilePage's tab strip also surfaces this
            tab so users can navigate without changing URL manually. */}
        <Route path="/profile/weekly" element={<WeeklyReportPage />} />
        {/* R8 Phase A 2026-05-12: Settings absorbed под /profile/settings.
            Старый /settings редиректит — внешние ссылки и нав уже работают.
            Реальный merge UI (single page с tabs) — Phase A next iteration; пока
            same component, новый URL. */}
        <Route path="/profile/settings" element={<SettingsPage />} />
        {/* F1 Phase 2 (2026-05-12) — user-facing AI memory audit surface. */}
        <Route path="/profile/memory" element={<MemoryPage />} />
        <Route path="/profile/:username" element={<ProfilePage />} />
        <Route path="/settings" element={<Navigate to="/profile/settings" replace />} />
        <Route path="/welcome" element={<WelcomePage />} />
        {/* Pivot 2026-05-04: legacy redirects /welcome/demo /copilot /hone
            удалены. NotFound теперь — честный ответ для устаревших URL'ов. */}
        <Route path="/legal/terms" element={<LegalTermsPage />} />
        <Route path="/legal/privacy" element={<LegalPrivacyPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback/yandex" element={<AuthCallbackYandexPage />} />
        <Route path="/auth/google-calendar-callback" element={<GoogleCalendarCallbackPage />} />
        {/* Bare /onboarding redirects to the Wave-10 entry step. The old
            OnboardingPage (3-step ?step=N flow) was deprecated in favour
            of the per-step routes below — a bare hit was rendering empty. */}
        <Route path="/onboarding" element={<Navigate to="/onboarding/tracks" replace />} />
        <Route path="/onboarding/done" element={<AllSetPage />} />
        {/* Wave-10 onboarding (design-review v3) — 4 step pages.
            Phase-2 ADR-001: Sanctum tour overlay removed alongside
            SanctumPage. /onboarding/done lands directly on /arena. */}
        <Route path="/onboarding/tracks" element={<OnbStep0 />} />
        <Route path="/onboarding/path" element={<OnbPath />} />
        <Route path="/onboarding/path/edit" element={<OnbPathEdit />} />
        <Route path="/onboarding/path/custom" element={<OnbPathCustom />} />
        <Route path="/onboarding/welcome" element={<OnbStep1 />} />
        {/* Wave 2.7 — public invite landing. PeekInvite RPC reads
            without bearer; Accept gates on logged-in user with
            /login?next=/invite/{code} round-trip. */}
        <Route path="/invite/:code" element={<InviteAcceptPage />} />
        {/* Wave 2.6 — tutor dashboard. Backend enforces per-row auth;
            anonymous viewers see empty lists (no 403 surface). */}
        <Route path="/tutor" element={<Navigate to="/tutor/overview" replace />} />
        <Route path="/tutor/students/:id" element={<TutorStudentPage />} />
        <Route path="/tutor/:tab" element={<TutorDashboardPage />} />
        {/* AI-tutor chat — gated, dedicated chat page per persona slug.
            Marketplace was dropped 2026-05-01 (см identity.md) — Boosty
            был supply-без-supply'я. AI-tutor adoption теперь живёт на
            /tutor (tutor dashboard tabs). */}
        <Route path="/tutor/ai/:slug" element={<AITutorChatPage />} />
        <Route path="/onboarding/class" element={<OnbStep2 />} />
        <Route path="/onboarding/skill" element={<OnbStep3 />} />
        <Route path="/onboarding/task" element={<OnbStep4 />} />
        {/* F9 Diagnostic Quiz (Phase B, 2026-05-12 MVP) — 8 Q's Go track →
            3 first actions + suggested goal preset. localStorage-backed,
            no backend dependency. Entry: banner on /atlas, /today, header
            user-menu. Result: ?step=done query subroute. */}
        <Route path="/diagnostic" element={<DiagnosticQuiz />} />
        {/* Wave-11 mock-pipeline routes — registered BEFORE the legacy
            /mock/:sessionId so the literal "pipeline" segment wins router
            ranking. /mock (no params) is the company picker; the
            single-shot mock session UI keeps its old URL shape. */}
        <Route path="/mock" element={<MockCompanyPicker />} />
        {/* F8 mini-mock — registered BEFORE :sessionId so literal segment
            wins router ranking. */}
        <Route path="/mock/diagnostic" element={<MockDiagnosticPage />} />
        <Route path="/mock/pipeline/:pipelineId" element={<MockPipelinePage />} />
        <Route path="/mock/pipeline/:pipelineId/debrief" element={<MockPipelineDebrief />} />
        {/* Standalone "большая доска" tab — opened via window.open from
            SysDesignCanvas. Pure Excalidraw + autosave; submit lives on
            the main /mock/pipeline tab. */}
        <Route path="/mock/canvas/:attemptId" element={<MockCanvasFullscreen />} />
        <Route path="/mock/:sessionId" element={<MockSessionPage />} />
        <Route path="/mock/:sessionId/result" element={<MockResultPage />} />
        {/* Pivot 2026-05-01/04: legacy 301-redirect routes (cohort,
            achievements, friends, history) удалены. Старые bookmark'и
            упадут на NotFound — честно после года pivot'ов. */}
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/help" element={<HelpPage />} />
        {/*
          /weekly — primary route as advertised in nav. /report kept as alias
          for backward compatibility (старые шеры в ссылках, e2e-тесты).
        */}
        {/* WAVE-13 — /weekly kept as 301-style redirect to /profile/weekly. */}
        <Route path="/weekly" element={<Navigate to="/profile/weekly" replace />} />
        {/* D5 2026-05-12: /podcasts вернулся в web (Hone перестал быть
            content surface). KnowledgeHubTabs показывает Articles + Podcasts. */}
        <Route path="/podcasts" element={<PodcastsPage />} />
        {/* Legacy voice-mock route → /mock (D7 cleanup 2026-05-12). */}
        <Route path="/voice-mock" element={<Navigate to="/mock" replace />} />
        <Route path="/voice-mock/:sessionId" element={<Navigate to="/mock" replace />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/interviewers" element={<AdminInterviewerApplicationsPage />} />
        <Route path="/status" element={<StatusPage />} />
        {/* Wave-11: premium subscription flow. /pricing — public route
            (рендерится для гостей тоже, не дёргает /profile/me). */}
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/checkout/success" element={<CheckoutSuccess />} />
        <Route path="/checkout/failure" element={<CheckoutFailure />} />
        {/* Wave 5 (2026-05-12) — Stripe success_url target. Auth-free
            route: пользователь мог пройти checkout без сохранённой
            session. session_id из query param → verify через GetCheckoutSession. */}
        <Route path="/billing/welcome" element={<BillingWelcomePage />} />
        {/* /upgrade — Stripe cancel_url target + canonical upsell URL для
            email/notify CTA'ев. Сейчас тонкий redirect на /pricing с
            ?retry=true прокинутым (PricingPage показывает банер). */}
        <Route path="/upgrade" element={<PricingPage />} />
        {/* /pair moved to Hone (E hotkey, bible §2.1). */}
        {/* Lobby/lobbies routes удалены 2026-05-01 (см pivot-arena-drop.md). */}
        <Route path="/circles" element={<CirclesPage />} />
        <Route path="/circles/:circleId" element={<CircleDetailPage />} />
        {/* D4 Stream F (2026-05-12) — solo Whiteboard / Editor (Hone→web). */}
        <Route path="/whiteboard/:id" element={<WhiteboardPage />} />
        <Route path="/whiteboard/:id/view" element={<WhiteboardPage readOnly />} />
        <Route path="/editor/:id" element={<EditorPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}
