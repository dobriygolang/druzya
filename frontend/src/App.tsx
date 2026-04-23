import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'

import RouteLoader from './components/RouteLoader'
import { readAccessToken } from './lib/apiClient'

// RootRedirect: посетитель без токена — на marketing /welcome, авторизованный
// — сразу в /sanctum. Раньше "/" безусловно вёл на /sanctum, тот возвращал
// 401, и apiClient кидал гостя на /login (минуя welcome) — пользователь
// никогда не видел маркетинговый landing. См. user-bug 2026-04.
function RootRedirect() {
  return <Navigate to={readAccessToken() ? '/sanctum' : '/welcome'} replace />
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

const SanctumPage = lazy(() => import('./pages/SanctumPage'))
const ArenaPage = lazy(() => import('./pages/ArenaPage'))
const ArenaMatchPage = lazy(() => import('./pages/ArenaMatchPage'))
const AtlasPage = lazy(() => import('./pages/AtlasPage'))
const CodexPage = lazy(() => import('./pages/CodexPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const DailyPage = lazy(() => import('./pages/DailyPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const WelcomePage = lazy(() => import('./pages/WelcomePage'))
const WelcomeDemoPage = lazy(() => import('./pages/WelcomeDemoPage'))
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
const MockReplayPage = lazy(() => import('./pages/MockReplayPage'))
// Wave-11: multi-stage mock interview pipeline (company picker →
// screening → go+sql → algo → sys_design → behavioral → debrief).
const MockCompanyPicker = lazy(() => import('./pages/mock/MockCompanyPicker'))
const MockPipelinePage = lazy(() => import('./pages/mock/MockPipelinePage'))
const MockPipelineDebrief = lazy(() => import('./pages/mock/MockPipelineDebrief'))
const NativeRoundPage = lazy(() => import('./pages/NativeRoundPage'))
const InterviewAutopsyPage = lazy(() => import('./pages/InterviewAutopsyPage'))
const GuildPage = lazy(() => import('./pages/GuildPage'))
const SlotsPage = lazy(() => import('./pages/SlotsPage'))
const SeasonPage = lazy(() => import('./pages/SeasonPage'))
const AchievementsPage = lazy(() => import('./pages/AchievementsPage'))
const FriendsPage = lazy(() => import('./pages/FriendsPage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const MatchEndPage = lazy(() => import('./pages/MatchEndPage'))
const HelpPage = lazy(() => import('./pages/HelpPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const InterviewCalendarPage = lazy(() => import('./pages/InterviewCalendarPage'))
const MatchHistoryPage = lazy(() => import('./pages/MatchHistoryPage'))
const KataStreakPage = lazy(() => import('./pages/KataStreakPage'))
const HeroCardsPage = lazy(() => import('./pages/HeroCardsPage'))
const WeeklyReportPage = lazy(() => import('./pages/WeeklyReportPage'))
// WeeklyShareView (Wave-10 P1) — dedicated public view (replaces the legacy
// WeeklyReportSharePage which mirrored the authorized /weekly layout).
const WeeklyShareView = lazy(() => import('./pages/WeeklyShareView'))
const Arena2v2Page = lazy(() => import('./pages/Arena2v2Page'))
const SystemDesignInterviewPage = lazy(() => import('./pages/SystemDesignInterviewPage'))
const CodeEditorPage = lazy(() => import('./pages/CodeEditorPage'))
const DungeonsPage = lazy(() => import('./pages/DungeonsPage'))
const TournamentPage = lazy(() => import('./pages/TournamentPage'))
const SpectatorPage = lazy(() => import('./pages/SpectatorPage'))
const CodeObituaryPage = lazy(() => import('./pages/CodeObituaryPage'))
const GhostRunsPage = lazy(() => import('./pages/GhostRunsPage'))
const NecromancyPage = lazy(() => import('./pages/NecromancyPage'))
const WarRoomPage = lazy(() => import('./pages/WarRoomPage'))
const VoiceMockPage = lazy(() => import('./pages/VoiceMockPage'))
const StressMeterPage = lazy(() => import('./pages/StressMeterPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const StatusPage = lazy(() => import('./pages/StatusPage'))
const RatingPage = lazy(() => import('./pages/RatingPage'))
const VacanciesPage = lazy(() => import('./pages/VacanciesPage'))
const VacancyDetailPage = lazy(() => import('./pages/VacancyDetailPage'))
const ApplicationsPage = lazy(() => import('./pages/ApplicationsPage'))
const PodcastsPage = lazy(() => import('./pages/PodcastsPage'))
const CohortsPage = lazy(() => import('./pages/CohortsPage'))
const CohortPage = lazy(() => import('./pages/CohortPage'))
// Wave-11 — premium subscription flow (5 screens). /pricing is public; the
// other three live behind whatever auth-state /sanctum reaches them with —
// the routes themselves don't gate, AppShell + apiClient do.
const PricingPage = lazy(() => import('./pages/pricing/PricingPage'))
const CheckoutPage = lazy(() => import('./pages/checkout/CheckoutPage'))
const CheckoutSuccess = lazy(() => import('./pages/checkout/CheckoutSuccess'))
const CheckoutFailure = lazy(() => import('./pages/checkout/CheckoutFailure'))
// Wave-11 — pair-coding (collaborative editor, бекенд: services/editor).
const PairLobbyPage = lazy(() => import('./pages/pair/PairLobbyPage'))
const PairRoomPage = lazy(() => import('./pages/pair/PairRoomPage'))
const PairInvitePage = lazy(() => import('./pages/pair/PairInvitePage'))
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
        <Route path="/sanctum" element={<SanctumPage />} />
        <Route path="/arena" element={<ArenaPage />} />
        <Route path="/arena/match/:matchId" element={<ArenaMatchPage />} />
        {/* WAVE-13 IA refactor — /kata absorbed into /arena namespace.
            Same DailyPage component, just remounted under the new URL.
            Old /daily routes are kept as 301-style redirects below. */}
        <Route path="/arena/kata" element={<DailyPage />} />
        <Route path="/arena/kata/:slug" element={<DailyPage />} />
        <Route path="/atlas" element={<AtlasPage />} />
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
        <Route path="/welcome/demo" element={<WelcomeDemoPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback/yandex" element={<AuthCallbackYandexPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/onboarding/done" element={<AllSetPage />} />
        {/* Wave-10 onboarding (design-review v3) — 4 step pages.
            Step 5 (sanctum tour) is rendered as an overlay inside
            SanctumPage when ?tour=1 is present, no dedicated route. */}
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
        <Route path="/mock/:sessionId/replay" element={<MockReplayPage />} />
        <Route path="/native/:sessionId" element={<NativeRoundPage />} />
        <Route path="/autopsy/new" element={<InterviewAutopsyPage />} />
        <Route path="/autopsy/:id" element={<InterviewAutopsyPage />} />
        <Route path="/guild" element={<GuildPage />} />
        <Route path="/guild/:guildId" element={<GuildPage />} />
        <Route path="/slots" element={<SlotsPage />} />
        <Route path="/season" element={<SeasonPage />} />
        <Route path="/achievements" element={<AchievementsPage />} />
        <Route path="/friends" element={<FriendsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/match/:matchId/end" element={<MatchEndPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/calendar" element={<InterviewCalendarPage />} />
        <Route path="/history" element={<MatchHistoryPage />} />
        <Route path="/daily/streak" element={<KataStreakPage />} />
        <Route path="/cards" element={<HeroCardsPage />} />
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
        <Route path="/podcasts" element={<PodcastsPage />} />
        <Route path="/arena/2v2/:matchId" element={<Arena2v2Page />} />
        <Route path="/sd-interview/:sessionId" element={<SystemDesignInterviewPage />} />
        <Route path="/playground" element={<CodeEditorPage />} />
        <Route path="/dungeons" element={<DungeonsPage />} />
        <Route path="/tournament/:id" element={<TournamentPage />} />
        <Route path="/spectator/:matchId" element={<SpectatorPage />} />
        <Route path="/obituary/:id" element={<CodeObituaryPage />} />
        <Route path="/practice/ghosts/:kataId" element={<GhostRunsPage />} />
        <Route path="/necromancy/:bountyId" element={<NecromancyPage />} />
        <Route path="/guild/warroom/:incidentId" element={<WarRoomPage />} />
        <Route path="/voice-mock/:sessionId" element={<VoiceMockPage />} />
        <Route path="/stress" element={<StressMeterPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/rating" element={<RatingPage />} />
        <Route path="/vacancies" element={<VacanciesPage />} />
        <Route path="/vacancies/:id" element={<VacancyDetailPage />} />
        <Route path="/applications" element={<ApplicationsPage />} />
        {/* Cohorts (Phase 1 MVP) — list at /cohorts, detail at /c/{slug}. */}
        <Route path="/cohorts" element={<CohortsPage />} />
        <Route path="/c/:slug" element={<CohortPage />} />
        {/* Wave-11: premium subscription flow. /pricing — public route
            (рендерится для гостей тоже, не дёргает /profile/me). */}
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/checkout/success" element={<CheckoutSuccess />} />
        <Route path="/checkout/failure" element={<CheckoutFailure />} />
        {/* Wave-11 pair-coding (collaborative editor). /pair — лобби,
            /pair/:roomId — комната, /pair/invite/:token — приём приглашения. */}
        <Route path="/pair" element={<PairLobbyPage />} />
        <Route path="/pair/invite/:token" element={<PairInvitePage />} />
        <Route path="/pair/:roomId" element={<PairRoomPage />} />
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
