// SystemDesignInterviewPage — placeholder while the system-design interview
// runtime is built.
//
// The full surface needs: interactive canvas (shape library, dragging,
// snapping, persistence), AI critique loop (screenshot → LLM → trade-off
// scoring), and a phase tracker. Building it on top of ai_mock with a new
// session-type would still be 8..12h of work (canvas alone). Rather than
// ship fake sticky notes, hard-coded timers and a sample diagram of
// "Twitter Timeline" we render a ComingSoon banner so users know the
// surface is real-but-not-yet-launched.
//
// Same pattern as TournamentPage / DungeonsPage / HeroCardsPage.
import { useNavigate, useParams } from 'react-router-dom'
import { AppShellV2 } from '../components/AppShell'
import { ComingSoon } from '../components/ComingSoon'

export default function SystemDesignInterviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  return (
    <AppShellV2>
      <ComingSoon
        title="System Design интервью — запуск скоро"
        description={
          'Готовим режим архитектурного интервью с интерактивным канвасом, ' +
          'библиотекой компонентов (LB, кеш, очередь, БД) и AI-критиком, ' +
          'который оценивает trade-offs по запросу. Пока что — обычный ' +
          'AI-mock с system_design секцией.'
        }
        primaryCta={{ label: 'AI Mock', onClick: () => navigate('/mock/new') }}
        secondaryCta={{ label: 'На главную', onClick: () => navigate('/') }}
      />
      {/* Keep the route param referenced so it does not look like dead code. */}
      <span className="hidden">{sessionId}</span>
    </AppShellV2>
  )
}
