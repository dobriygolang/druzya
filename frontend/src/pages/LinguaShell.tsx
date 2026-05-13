// LinguaShell — top-level route gate for /lingua/*.
//
// Wraps existing AppShellV2 + LinguaTabsChrome, hosts nested Routes for
// overview/reading/writing/listening/speaking.
import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'

import { AppShellV2 } from '../components/AppShell'
import { LinguaTabsChrome } from '../components/lingua/LinguaTabsChrome'
import RouteLoader from '../components/RouteLoader'

const LinguaOverviewPage = lazy(() => import('./lingua/LinguaOverviewPage'))
const ReadingPage = lazy(() => import('./lingua/ReadingPage'))
const WritingPage = lazy(() => import('./lingua/WritingPage'))
const ListeningPage = lazy(() => import('./lingua/ListeningPage'))
const SpeakingPage = lazy(() => import('./lingua/SpeakingPage'))

export default function LinguaShell() {
  return (
    <AppShellV2>
      <LinguaTabsChrome />
      <Suspense fallback={<RouteLoader />}>
        <Routes>
          <Route index element={<LinguaOverviewPage />} />
          <Route path="reading" element={<ReadingPage />} />
          <Route path="writing" element={<WritingPage />} />
          <Route path="listening" element={<ListeningPage />} />
          <Route path="speaking" element={<SpeakingPage />} />
          <Route path="*" element={<Navigate to="/lingua" replace />} />
        </Routes>
      </Suspense>
    </AppShellV2>
  )
}
