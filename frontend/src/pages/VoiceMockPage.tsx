// VoiceMockPage — phase dispatcher for the voice-mock interview UX.
//
// Three phases, three components, one fade-through between them:
//   pre-call → in-call → debrief
//
// Wave-10 P2 redesign: split out from the previous monolith. The route
// remains /voice-mock/:sessionId — backward-compatible. AppShell chrome is
// intentionally hidden during the in-call phase (immersion).
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate, useParams } from 'react-router-dom'
import { useProfileQuery } from '../lib/queries/profile'
import { isPremiumTTSAvailable, type TTSVoice } from '../lib/voice'
import { PreCallScreen, type PreCallConfig } from './voice-mock/PreCallScreen'
import { InCallScreen, type TranscriptEntry } from './voice-mock/InCallScreen'
import { DebriefScreen } from './voice-mock/DebriefScreen'

type Phase = 'pre' | 'in' | 'debrief'

interface DebriefData {
  config: PreCallConfig
  transcript: TranscriptEntry[]
  elapsedSec: number
}

export default function VoiceMockPage() {
  const { sessionId: routeSessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { data: profile } = useProfileQuery()
  const tier = profile?.tier ?? 'free'
  const premiumOk = isPremiumTTSAvailable(tier)
  const voice: TTSVoice = premiumOk ? 'premium-female' : 'browser'

  // Stable session id for the lifetime of the page mount (or use route).
  const sessionId = useMemo(
    () => routeSessionId ?? `voice-${Math.random().toString(36).slice(2, 10)}`,
    [routeSessionId],
  )

  const [phase, setPhase] = useState<Phase>('pre')
  const [config, setConfig] = useState<PreCallConfig | null>(null)
  const [debriefData, setDebriefData] = useState<DebriefData | null>(null)

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <AnimatePresence mode="wait">
        {phase === 'pre' && (
          <motion.div
            key="pre"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <PreCallScreen
              onStart={(c) => {
                setConfig(c)
                setPhase('in')
              }}
            />
          </motion.div>
        )}

        {phase === 'in' && config && (
          <motion.div
            key="in"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // Fade-through with 600ms hold per animation spec
            transition={{ duration: 0.4, ease: 'easeInOut' }}
          >
            <InCallScreen
              sessionId={sessionId}
              persona={config.persona}
              topic={config.topic}
              durationMin={config.duration}
              voice={voice}
              onEnd={({ transcript, elapsedSec }) => {
                setDebriefData({ config, transcript, elapsedSec })
                // 600ms hold gives the user a beat to register the call ended
                window.setTimeout(() => setPhase('debrief'), 600)
              }}
            />
          </motion.div>
        )}

        {phase === 'debrief' && debriefData && (
          <motion.div
            key="debrief"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          >
            <DebriefScreen
              persona={debriefData.config.persona}
              transcript={debriefData.transcript}
              elapsedSec={debriefData.elapsedSec}
              onScheduleNext={() => {
                setDebriefData(null)
                setConfig(null)
                setPhase('pre')
              }}
              onShare={() => navigate('/share/last-voice-mock')}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
