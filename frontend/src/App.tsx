import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'

import RouteLoader from './components/RouteLoader'
import { readAccessToken } from './lib/apiClient'

// RootRedirect: гость → /welcome, авторизованный → /arena.
// Phase-2 of ADR-001: SanctumPage (RPG-flavored home) удалён, web-home
// теперь /arena per docs/ecosystem.md §3 ("druz9.online = арена + сайт").
// Старый /sanctum маршрут ниже превращён в 301-redirect.
function RootRedirect() {
  return <Navigate to={readAccessToken() ? '/arena' : '/welcome'} replace />
}

// Legacy /v2/* URL'ы из старого дизайна — редиректим на чистый путь.
// Также пара переименований: /v2/kata → /daily.
function LegacyV2Redirect() {
  const loc = useLocation()
  const params = useParams<{ '*': string }>()
  const tail = params['*'] ?? ''
  // Спец-маппинг для устаревших имён.
  // WAVE-13: kata теперь живёт под /arena/kata, поэтому /v2/kata → /arena/kata.
  const renamed: Record<string, string> = { kata: 'arena/kata', daily: 'arena/kata' }
  const first = tail.split('/')[0]
  const rest = tail.slice(first.length)
  const dest = '/' + (renamed[first] ?? first) + rest + loc.search
  return <Navigate to={dest} replace />
}

// WAVE-13 IA refactor — /daily/kata/:slug deep-links forward to the new
// /arena/kata/:slug URL with the slug preserved.
function DailyKataRedirect() {
  const { slug } = useParams<{ slug: string }>()
  return <Navigate to={`/arena/kata/${slug ?? ''}`} replace />
}

const ArenaPage = lazy(() => import('./pages/ArenaPage'))
const ArenaMatchPage = lazy(() => import('./pages/ArenaMatchPage'))
const AtlasPage = lazy(() => import('./pages/AtlasPage'))
const InsightsPage = lazy(() => import('./pages/InsightsPage'))
const PracticePage = lazy(() => import('./pages/PracticePage'))
const CodexPage = lazy(() => import('./pages/CodexPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const DailyPage = lazy(() => import('./pages/DailyPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const WelcomePage = lazy(() => import('./pages/WelcomePage'))
// Phase-4 ADR-001 — separate /copilot, /hone, /welcome/demo landings removed.
// Cue and Hone are now promoted as sections inside /welcome instead of
// duplicate landing pages. Demo overlay was an unused legacy step.
const LegalTermsPage = lazy(() => import('./pages/LegalTermsPage'))
const LegalPrivacyPage = lazy(() => import('./pages/LegalPrivacyPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const AuthCallbackYandexPage = lazy(() => import('./pages/AuthCallbackYandexPage'))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'))
const AllSetPage = lazy(() => import('./pages/AllSetPage'))
// Wave-10 onboarding flow (design-review v3 part A) — 5-step gated flow
// living under /onboarding/{welcome,class,skill,task}. Step 5 is a tour
// overlay on /sanctum (mounted via ?tour=1 query param).
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
// Phase-4 ADR-001 Wave 1+2 — `cohort`, `achievements`, `warroom` removed.
// Frontend pages deleted; routes redirect to /circles or /profile.
const SlotsPage = lazy(() => import('./pages/SlotsPage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const MatchEndPage = lazy(() => import('./pages/MatchEndPage'))
const HelpPage = lazy(() => import('./pages/HelpPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const WeeklyReportPage = lazy(() => import('./pages/WeeklyReportPage'))
// WeeklyShareView (Wave-10 P1) — dedicated public view (replaces the legacy
// WeeklyReportSharePage which mirrored the authorized /weekly layout).
const WeeklyShareView = lazy(() => import('./pages/WeeklyShareView'))
const Arena2v2Page = lazy(() => import('./pages/Arena2v2Page'))
const SystemDesignInterviewPage = lazy(() => import('./pages/SystemDesignInterviewPage'))
const CodeEditorPage = lazy(() => import('./pages/CodeEditorPage'))
const SpectatorPage = lazy(() => import('./pages/SpectatorPage'))
const VoiceMockPage = lazy(() => import('./pages/VoiceMockPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const AdminInterviewerApplicationsPage = lazy(() => import('./pages/AdminInterviewerApplicationsPage'))
const InterviewerProfilePage = lazy(() => import('./pages/InterviewerProfilePage'))
const StatusPage = lazy(() => import('./pages/StatusPage'))
const VacanciesPage = lazy(() => import('./pages/VacanciesPage'))
const VacancyDetailPage = lazy(() => import('./pages/VacancyDetailPage'))
const ApplicationsPage = lazy(() => import('./pages/ApplicationsPage'))
// Wave-11 — premium subscription flow (5 screens). /pricing is public; the
// other three live behind whatever auth-state /sanctum reaches them with —
// the routes themselves don't gate, AppShell + apiClient do.
const PricingPage = lazy(() => import('./pages/pricing/PricingPage'))
const CheckoutPage = lazy(() => import('./pages/checkout/CheckoutPage'))
const CheckoutSuccess = lazy(() => import('./pages/checkout/CheckoutSuccess'))
const CheckoutFailure = lazy(() => import('./pages/checkout/CheckoutFailure'))
// Pair-coding (collaborative editor) переехал в Hone (bible §2.1 DNA-revision).
// Web-routes /pair удалены — primary surface теперь desktop, shareable URL
// приведёт сюда лендинг «Open in Hone». TODO: добавить hone-handoff page
// если понадобится поделиться ссылкой web-юзеру без Hone'а.

// Circles — community-layer (bible §9 Phase 6.5.3). UI создания circle +
// events (Book Club Fridays) — единственное web-creation-место для этой
// поверхности; Hone только показывает + RSVP.
const CirclesPage = lazy(() => import('./pages/circles/CirclesPage'))
const CircleDetailPage = lazy(() => import('./pages/circles/CircleDetailPage'))
const WhiteboardSharePage = lazy(() => import('./pages/WhiteboardSharePage'))
const EditorRoomSharePage = lazy(() => import('./pages/EditorRoomSharePage'))
// WAVE-11 — Custom Lobby restored. Backend: services/lobby + 8 REST endpoints
// at /api/v1/lobby/*. /lobbies = public list + create + join-by-code; /lobby/:id
// = single-room view that polls and auto-redirects to /arena/match/:matchId
// once the owner clicks Start (status flips to 'live').
const LobbyListPage = lazy(() => import('./pages/lobby/LobbyListPage'))
const LobbyPage = lazy(() => import('./pages/lobby/LobbyPage'))

export default function App() {
  return (
    <Suspense fallback={<RouteLoader />}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        {/* Phase-2 ADR-001 — RPG-flavored pages cut: Sanctum (home),
            CodeObituary, Necromancy, GhostRuns, StressMeter. Routes
            preserved as 301-redirects so external links don't 404. */}
        <Route path="/sanctum" element={<Navigate to="/arena" replace />} />
        <Route path="/obituary/:id" element={<Navigate to="/arena" replace />} />
        <Route path="/practice/ghosts/:kataId" element={<Navigate to="/arena/kata" replace />} />
        <Route path="/necromancy/:bountyId" element={<Navigate to="/arena" replace />} />
        <Route path="/stress" element={<Navigate to="/arena" replace />} />
        <Route path="/arena" element={<ArenaPage />} />
        <Route path="/arena/match/:matchId" element={<ArenaMatchPage />} />
        {/* WAVE-13 IA refactor — /kata absorbed into /arena namespace.
            Same DailyPage component, just remounted under the new URL.
            Old /daily routes are kept as 301-style redirects below. */}
        <Route path="/arena/kata" element={<DailyPage />} />
        <Route path="/arena/kata/:slug" element={<DailyPage />} />
        <Route path="/atlas" element={<AtlasPage />} />
        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/practice" element={<PracticePage />} />
        <Route path="/codex" element={<CodexPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        {/* WAVE-13 — /profile/weekly absorbs the standalone /weekly route as
            a profile sub-section. ProfilePage's tab strip also surfaces this
            tab so users can navigate without changing URL manually. */}
        <Route path="/profile/weekly" element={<WeeklyReportPage />} />
        <Route path="/profile/:username" element={<ProfilePage />} />
        {/* WAVE-13 — /daily kept as 301-style redirect to /arena/kata for
            backward-compat with bookmarks. React Router uses replace so the
            history is cleaned. */}
        <Route path="/daily" element={<Navigate to="/arena/kata" replace />} />
        <Route path="/daily/kata/:slug" element={<DailyKataRedirect />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/welcome" element={<WelcomePage />} />
        {/* Phase-4 ADR-001 — separate landing pages folded into /welcome.
            Direct URLs preserved as redirects; the welcome page now has
            sections for Cue (#cue) and Hone (#hone). */}
        <Route path="/welcome/demo" element={<Navigate to="/welcome" replace />} />
        <Route path="/copilot" element={<Navigate to="/welcome#cue" replace />} />
        <Route path="/copilot/reports/:sessionId" element={<Navigate to="/welcome#cue" replace />} />
        <Route path="/hone" element={<Navigate to="/welcome#hone" replace />} />
        <Route path="/legal/terms" element={<LegalTermsPage />} />
        <Route path="/legal/privacy" element={<LegalPrivacyPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback/yandex" element={<AuthCallbackYandexPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/onboarding/done" element={<AllSetPage />} />
        {/* Wave-10 onboarding (design-review v3) — 4 step pages.
            Phase-2 ADR-001: Sanctum tour overlay removed alongside
            SanctumPage. /onboarding/done lands directly on /arena. */}
        <Route path="/onboarding/welcome" element={<OnbStep1 />} />
        <Route path="/onboarding/class" element={<OnbStep2 />} />
        <Route path="/onboarding/skill" element={<OnbStep3 />} />
        <Route path="/onboarding/task" element={<OnbStep4 />} />
        {/* Wave-11 mock-pipeline routes — registered BEFORE the legacy
            /mock/:sessionId so the literal "pipeline" segment wins router
            ranking. /mock (no params) is the company picker; the
            single-shot mock session UI keeps its old URL shape. */}
        <Route path="/mock" element={<MockCompanyPicker />} />
        <Route path="/mock/pipeline/:pipelineId" element={<MockPipelinePage />} />
        <Route path="/mock/pipeline/:pipelineId/debrief" element={<MockPipelineDebrief />} />
        <Route path="/mock/:sessionId" element={<MockSessionPage />} />
        <Route path="/mock/:sessionId/result" element={<MockResultPage />} />
        {/* Phase-4 ADR-001 — niche/unsurfaced routes deleted:
            /native (legacy mock-round), /autopsy (post-mortem),
            /season (incomplete season pass), /rating (dup of profile
            leaderboard), /calendar (no entry point), /daily/streak
            (now lives in Hone Stats). All redirect to /arena. */}
        <Route path="/native/:sessionId" element={<Navigate to="/arena" replace />} />
        <Route path="/autopsy/new" element={<Navigate to="/arena" replace />} />
        <Route path="/autopsy/:id" element={<Navigate to="/arena" replace />} />
        <Route path="/season" element={<Navigate to="/arena" replace />} />
        <Route path="/rating" element={<Navigate to="/profile" replace />} />
        <Route path="/calendar" element={<Navigate to="/arena" replace />} />
        <Route path="/daily/streak" element={<Navigate to="/profile" replace />} />
        {/* Phase-4 ADR-001 Wave 2 — cohort merged into circles. */}
        <Route path="/cohort" element={<Navigate to="/circles" replace />} />
        <Route path="/cohort/:cohortId" element={<Navigate to="/circles" replace />} />
        <Route path="/slots" element={<SlotsPage />} />
        {/* Phase-4 ADR-001 Wave 1 — Achievements removed (gamification cut). */}
        <Route path="/achievements" element={<Navigate to="/profile" replace />} />
        {/* /friends removed — community lives in /circles. */}
        <Route path="/friends" element={<Navigate to="/circles" replace />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/match/:matchId/end" element={<MatchEndPage />} />
        <Route path="/help" element={<HelpPage />} />
        {/* Phase-4 ADR-001 — match history moved into profile (Matches
            tab) with full filter + pagination UX. /history redirects to
            keep external links alive. */}
        <Route path="/history" element={<Navigate to="/profile" replace />} />
        {/*
          /weekly — primary route as advertised in nav. /report kept as alias
          for backward compatibility (старые шеры в ссылках, e2e-тесты).
        */}
        {/* WAVE-13 — /weekly kept as 301-style redirect to /profile/weekly.
            Public share /weekly/share/:token below stays unchanged. */}
        <Route path="/weekly" element={<Navigate to="/profile/weekly" replace />} />
        {/* Phase C: публичный share-link на недельный отчёт. Никаких guards —
            страница сама дёргает /api/v1/profile/weekly/share/{token} без
            bearer'а и показывает 404 при истёкшем токене. */}
        <Route path="/weekly/share/:token" element={<WeeklyShareView />} />
        <Route path="/report" element={<Navigate to="/weekly" replace />} />
        {/* /podcasts moved to Hone (P hotkey, bible §2.1). */}
        <Route path="/arena/2v2/:matchId" element={<Arena2v2Page />} />
        <Route path="/sd-interview/:sessionId" element={<SystemDesignInterviewPage />} />
        <Route path="/playground" element={<CodeEditorPage />} />
        <Route path="/spectator/:matchId" element={<SpectatorPage />} />
        {/* Phase-4 ADR-001 Wave 2 — WarRoom removed alongside cohort. */}
        <Route path="/cohort/warroom/:incidentId" element={<Navigate to="/circles" replace />} />
        <Route path="/voice-mock/:sessionId" element={<VoiceMockPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/interviewers" element={<AdminInterviewerApplicationsPage />} />
        <Route path="/interviewer/:userID" element={<InterviewerProfilePage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/vacancies" element={<VacanciesPage />} />
        <Route path="/vacancies/:source/:externalId" element={<VacancyDetailPage />} />
        <Route path="/applications" element={<ApplicationsPage />} />
        {/* Wave-11: premium subscription flow. /pricing — public route
            (рендерится для гостей тоже, не дёргает /profile/me). */}
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/checkout/success" element={<CheckoutSuccess />} />
        <Route path="/checkout/failure" element={<CheckoutFailure />} />
        {/* /pair moved to Hone (E hotkey, bible §2.1). */}
        <Route path="/circles" element={<CirclesPage />} />
        <Route path="/circles/:circleId" element={<CircleDetailPage />} />
        <Route path="/whiteboard/:roomId" element={<WhiteboardSharePage />} />
        <Route path="/editor/:roomId" element={<EditorRoomSharePage />} />
        {/* WAVE-11 Custom Lobby — restored. /lobbies = public list +
            create + join-by-code; /lobby/:id = single-room with auto-redirect
            to /arena/match/{match_id} when owner clicks Start. */}
        <Route path="/lobbies" element={<LobbyListPage />} />
        <Route path="/lobby/:id" element={<LobbyPage />} />
        {/* Legacy /v2/* — редирект на новый URL без префикса. */}
        <Route path="/v2/*" element={<LegacyV2Redirect />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}
