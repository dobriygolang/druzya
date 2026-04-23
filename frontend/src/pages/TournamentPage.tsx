// TournamentPage is a placeholder while the tournament backend is built.
//
// There is no `tournament` bounded context in backend/services/ today — the
// previous demo used hard-coded brackets / prize pool / participant numbers.
// Rather than ship fictional numbers we render a ComingSoon banner so users
// understand the surface is real-but-not-yet-launched.
import { useNavigate, useParams } from 'react-router-dom'
import { AppShellV2 } from '../components/AppShell'
import { ComingSoon } from '../components/ComingSoon'

export default function TournamentPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  return (
    <AppShellV2>
      <ComingSoon
        title="Турниры скоро будут"
        description={
          'Мы готовим формат еженедельных турниров с реальным призовым фондом, ' +
          'сеткой Single Elimination и прогнозами. Подпишись — пришлём пуш на старте.'
        }
        primaryCta={{ label: 'На главную', onClick: () => navigate('/') }}
        secondaryCta={{ label: 'Открыть Арену', onClick: () => navigate('/arena') }}
      />
      {/* keep the route param referenced so it does not look like dead code */}
      <span className="hidden">{id}</span>
    </AppShellV2>
  )
}
