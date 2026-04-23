import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import RouteLoader from './components/RouteLoader';
// Legacy /v2/* URL'ы из старого дизайна — редиректим на чистый путь.
// Также пара переименований: /v2/kata → /daily.
function LegacyV2Redirect() {
    const loc = useLocation();
    const params = useParams();
    const tail = params['*'] ?? '';
    // Спец-маппинг для устаревших имён.
    const renamed = { kata: 'daily' };
    const first = tail.split('/')[0];
    const rest = tail.slice(first.length);
    const dest = '/' + (renamed[first] ?? first) + rest + loc.search;
    return _jsx(Navigate, { to: dest, replace: true });
}
const SanctumPage = lazy(() => import('./pages/SanctumPage'));
const ArenaPage = lazy(() => import('./pages/ArenaPage'));
const ArenaMatchPage = lazy(() => import('./pages/ArenaMatchPage'));
const AtlasPage = lazy(() => import('./pages/AtlasPage'));
const CodexPage = lazy(() => import('./pages/CodexPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const DailyPage = lazy(() => import('./pages/DailyPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const WelcomePage = lazy(() => import('./pages/WelcomePage'));
const WelcomeDemoPage = lazy(() => import('./pages/WelcomeDemoPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const AuthCallbackYandexPage = lazy(() => import('./pages/AuthCallbackYandexPage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const AllSetPage = lazy(() => import('./pages/AllSetPage'));
const MockSessionPage = lazy(() => import('./pages/MockSessionPage'));
const MockResultPage = lazy(() => import('./pages/MockResultPage'));
const MockReplayPage = lazy(() => import('./pages/MockReplayPage'));
const NativeRoundPage = lazy(() => import('./pages/NativeRoundPage'));
const InterviewAutopsyPage = lazy(() => import('./pages/InterviewAutopsyPage'));
const GuildPage = lazy(() => import('./pages/GuildPage'));
const SlotsPage = lazy(() => import('./pages/SlotsPage'));
const SeasonPage = lazy(() => import('./pages/SeasonPage'));
const AchievementsPage = lazy(() => import('./pages/AchievementsPage'));
const FriendsPage = lazy(() => import('./pages/FriendsPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const MatchEndPage = lazy(() => import('./pages/MatchEndPage'));
const HelpPage = lazy(() => import('./pages/HelpPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const CustomLobbyPage = lazy(() => import('./pages/CustomLobbyPage'));
const InterviewCalendarPage = lazy(() => import('./pages/InterviewCalendarPage'));
const MatchHistoryPage = lazy(() => import('./pages/MatchHistoryPage'));
const KataStreakPage = lazy(() => import('./pages/KataStreakPage'));
const HeroCardsPage = lazy(() => import('./pages/HeroCardsPage'));
const WeeklyReportPage = lazy(() => import('./pages/WeeklyReportPage'));
const Arena2v2Page = lazy(() => import('./pages/Arena2v2Page'));
const SystemDesignInterviewPage = lazy(() => import('./pages/SystemDesignInterviewPage'));
const CodeEditorPage = lazy(() => import('./pages/CodeEditorPage'));
const DungeonsPage = lazy(() => import('./pages/DungeonsPage'));
const TournamentPage = lazy(() => import('./pages/TournamentPage'));
const SpectatorPage = lazy(() => import('./pages/SpectatorPage'));
const CodeObituaryPage = lazy(() => import('./pages/CodeObituaryPage'));
const GhostRunsPage = lazy(() => import('./pages/GhostRunsPage'));
const NecromancyPage = lazy(() => import('./pages/NecromancyPage'));
const WarRoomPage = lazy(() => import('./pages/WarRoomPage'));
const VoiceMockPage = lazy(() => import('./pages/VoiceMockPage'));
const StressMeterPage = lazy(() => import('./pages/StressMeterPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const StatusPage = lazy(() => import('./pages/StatusPage'));
const RatingPage = lazy(() => import('./pages/RatingPage'));
const VacanciesPage = lazy(() => import('./pages/VacanciesPage'));
const VacancyDetailPage = lazy(() => import('./pages/VacancyDetailPage'));
const ApplicationsPage = lazy(() => import('./pages/ApplicationsPage'));
export default function App() {
    return (_jsx(Suspense, { fallback: _jsx(RouteLoader, {}), children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Navigate, { to: "/sanctum", replace: true }) }), _jsx(Route, { path: "/sanctum", element: _jsx(SanctumPage, {}) }), _jsx(Route, { path: "/arena", element: _jsx(ArenaPage, {}) }), _jsx(Route, { path: "/arena/match/:matchId", element: _jsx(ArenaMatchPage, {}) }), _jsx(Route, { path: "/atlas", element: _jsx(AtlasPage, {}) }), _jsx(Route, { path: "/codex", element: _jsx(CodexPage, {}) }), _jsx(Route, { path: "/profile", element: _jsx(ProfilePage, {}) }), _jsx(Route, { path: "/profile/:username", element: _jsx(ProfilePage, {}) }), _jsx(Route, { path: "/daily", element: _jsx(DailyPage, {}) }), _jsx(Route, { path: "/settings", element: _jsx(SettingsPage, {}) }), _jsx(Route, { path: "/welcome", element: _jsx(WelcomePage, {}) }), _jsx(Route, { path: "/welcome/demo", element: _jsx(WelcomeDemoPage, {}) }), _jsx(Route, { path: "/login", element: _jsx(LoginPage, {}) }), _jsx(Route, { path: "/auth/callback/yandex", element: _jsx(AuthCallbackYandexPage, {}) }), _jsx(Route, { path: "/onboarding", element: _jsx(OnboardingPage, {}) }), _jsx(Route, { path: "/onboarding/done", element: _jsx(AllSetPage, {}) }), _jsx(Route, { path: "/mock/:sessionId", element: _jsx(MockSessionPage, {}) }), _jsx(Route, { path: "/mock/:sessionId/result", element: _jsx(MockResultPage, {}) }), _jsx(Route, { path: "/mock/:sessionId/replay", element: _jsx(MockReplayPage, {}) }), _jsx(Route, { path: "/native/:sessionId", element: _jsx(NativeRoundPage, {}) }), _jsx(Route, { path: "/autopsy/new", element: _jsx(InterviewAutopsyPage, {}) }), _jsx(Route, { path: "/autopsy/:id", element: _jsx(InterviewAutopsyPage, {}) }), _jsx(Route, { path: "/guild", element: _jsx(GuildPage, {}) }), _jsx(Route, { path: "/guild/:guildId", element: _jsx(GuildPage, {}) }), _jsx(Route, { path: "/slots", element: _jsx(SlotsPage, {}) }), _jsx(Route, { path: "/season", element: _jsx(SeasonPage, {}) }), _jsx(Route, { path: "/achievements", element: _jsx(AchievementsPage, {}) }), _jsx(Route, { path: "/friends", element: _jsx(FriendsPage, {}) }), _jsx(Route, { path: "/notifications", element: _jsx(NotificationsPage, {}) }), _jsx(Route, { path: "/match/:matchId/end", element: _jsx(MatchEndPage, {}) }), _jsx(Route, { path: "/help", element: _jsx(HelpPage, {}) }), _jsx(Route, { path: "/lobby", element: _jsx(CustomLobbyPage, {}) }), _jsx(Route, { path: "/calendar", element: _jsx(InterviewCalendarPage, {}) }), _jsx(Route, { path: "/history", element: _jsx(MatchHistoryPage, {}) }), _jsx(Route, { path: "/daily/streak", element: _jsx(KataStreakPage, {}) }), _jsx(Route, { path: "/cards", element: _jsx(HeroCardsPage, {}) }), _jsx(Route, { path: "/report", element: _jsx(WeeklyReportPage, {}) }), _jsx(Route, { path: "/arena/2v2/:matchId", element: _jsx(Arena2v2Page, {}) }), _jsx(Route, { path: "/sd-interview/:sessionId", element: _jsx(SystemDesignInterviewPage, {}) }), _jsx(Route, { path: "/playground", element: _jsx(CodeEditorPage, {}) }), _jsx(Route, { path: "/dungeons", element: _jsx(DungeonsPage, {}) }), _jsx(Route, { path: "/tournament/:id", element: _jsx(TournamentPage, {}) }), _jsx(Route, { path: "/spectator/:matchId", element: _jsx(SpectatorPage, {}) }), _jsx(Route, { path: "/obituary/:id", element: _jsx(CodeObituaryPage, {}) }), _jsx(Route, { path: "/practice/ghosts/:kataId", element: _jsx(GhostRunsPage, {}) }), _jsx(Route, { path: "/necromancy/:bountyId", element: _jsx(NecromancyPage, {}) }), _jsx(Route, { path: "/guild/warroom/:incidentId", element: _jsx(WarRoomPage, {}) }), _jsx(Route, { path: "/voice-mock/:sessionId", element: _jsx(VoiceMockPage, {}) }), _jsx(Route, { path: "/stress", element: _jsx(StressMeterPage, {}) }), _jsx(Route, { path: "/admin", element: _jsx(AdminPage, {}) }), _jsx(Route, { path: "/status", element: _jsx(StatusPage, {}) }), _jsx(Route, { path: "/rating", element: _jsx(RatingPage, {}) }), _jsx(Route, { path: "/vacancies", element: _jsx(VacanciesPage, {}) }), _jsx(Route, { path: "/vacancies/:id", element: _jsx(VacancyDetailPage, {}) }), _jsx(Route, { path: "/applications", element: _jsx(ApplicationsPage, {}) }), _jsx(Route, { path: "/v2/*", element: _jsx(LegacyV2Redirect, {}) }), _jsx(Route, { path: "*", element: _jsx(NotFoundPage, {}) })] }) }));
}
