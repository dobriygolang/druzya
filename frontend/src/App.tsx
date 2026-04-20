import { Routes, Route, Navigate } from 'react-router-dom'

import SanctumPage from './pages/SanctumPage'
import ArenaPage from './pages/ArenaPage'
import ArenaMatchPage from './pages/ArenaMatchPage'
import SlotsPage from './pages/SlotsPage'
import InterviewAutopsyPage from './pages/InterviewAutopsyPage'
import AtlasPage from './pages/AtlasPage'
import CodexPage from './pages/CodexPage'
import GuildPage from './pages/GuildPage'
import MockSessionPage from './pages/MockSessionPage'
import MockResultPage from './pages/MockResultPage'
import MockReplayPage from './pages/MockReplayPage'
import NativeRoundPage from './pages/NativeRoundPage'
import DailyPage from './pages/DailyPage'
import ProfilePage from './pages/ProfilePage'
import SeasonPage from './pages/SeasonPage'
import AchievementsPage from './pages/AchievementsPage'
import SettingsPage from './pages/SettingsPage'
import OnboardingPage from './pages/OnboardingPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/sanctum" replace />} />
      <Route path="/sanctum" element={<SanctumPage />} />
      <Route path="/arena" element={<ArenaPage />} />
      <Route path="/arena/match/:matchId" element={<ArenaMatchPage />} />
      <Route path="/slots" element={<SlotsPage />} />
      <Route path="/autopsy/new" element={<InterviewAutopsyPage />} />
      <Route path="/autopsy/:id" element={<InterviewAutopsyPage />} />
      <Route path="/guild" element={<GuildPage />} />
      <Route path="/atlas" element={<AtlasPage />} />
      <Route path="/codex" element={<CodexPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/season" element={<SeasonPage />} />
      <Route path="/achievements" element={<AchievementsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/daily" element={<DailyPage />} />
      <Route path="/mock/:sessionId" element={<MockSessionPage />} />
      <Route path="/mock/:sessionId/result" element={<MockResultPage />} />
      <Route path="/mock/:sessionId/replay" element={<MockReplayPage />} />
      <Route path="/native/:sessionId" element={<NativeRoundPage />} />
      <Route path="*" element={<Navigate to="/sanctum" replace />} />
    </Routes>
  )
}
