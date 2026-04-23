import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'

import RouteLoader from './components/RouteLoader'

// Legacy /v2/* URL'ы из старого дизайна — редиректим на чистый путь.
// Также пара переименований: /v2/kata → /daily.
function LegacyV2Redirect() {
  const loc = useLocation()
  const params = useParams<{ '*': string }>()
  const tail = params['*'] ?? ''
  // Спец-маппинг для устаревших имён.
  const renamed: Record<string, string> = { kata: 'daily' }
  const first = tail.split('/')[0]
  const rest = tail.slice(first.length)
  const dest = '/' + (renamed[first] ?? first) + rest + loc.search
  return <Navigate to={dest} replace />
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
const MockSessionPage = lazy(() => import('./pages/MockSessionPage'))
const MockResultPage = lazy(() => import('./pages/MockResultPage'))
const MockReplayPage = lazy(() => import('./pages/MockReplayPage'))
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
const CustomLobbyPage = lazy(() => import('./pages/CustomLobbyPage'))
const InterviewCalendarPage = lazy(() => import('./pages/InterviewCalendarPage'))
const MatchHistoryPage = lazy(() => import('./pages/MatchHistoryPage'))
const KataStreakPage = lazy(() => import('./pages/KataStreakPage'))
const HeroCardsPage = lazy(() => import('./pages/HeroCardsPage'))
const WeeklyReportPage = lazy(() => import('./pages/WeeklyReportPage'))
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

export default function App() {
  return (
    <Suspense fallback={<RouteLoader />}>
      <Routes>
        <Route path="/" element={<Navigate to="/sanctum" replace />} />
        <Route path="/sanctum" element={<SanctumPage />} />
        <Route path="/arena" element={<ArenaPage />} />
        <Route path="/arena/match/:matchId" element={<ArenaMatchPage />} />
        <Route path="/atlas" element={<AtlasPage />} />
        <Route path="/codex" element={<CodexPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/:username" element={<ProfilePage />} />
        <Route path="/daily" element={<DailyPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/welcome/demo" element={<WelcomeDemoPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback/yandex" element={<AuthCallbackYandexPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/onboarding/done" element={<AllSetPage />} />
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
        <Route path="/lobby" element={<CustomLobbyPage />} />
        <Route path="/calendar" element={<InterviewCalendarPage />} />
        <Route path="/history" element={<MatchHistoryPage />} />
        <Route path="/daily/streak" element={<KataStreakPage />} />
        <Route path="/cards" element={<HeroCardsPage />} />
        {/*
          /weekly — primary route as advertised in nav. /report kept as alias
          for backward compatibility (старые шеры в ссылках, e2e-тесты).
        */}
        <Route path="/weekly" element={<WeeklyReportPage />} />
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
        {/* Legacy /v2/* — редирект на новый URL без префикса. */}
        <Route path="/v2/*" element={<LegacyV2Redirect />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}
