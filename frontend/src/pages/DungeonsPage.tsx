// DungeonsPage — placeholder while the dungeons backend is built.
//
// "Подземелья компаний" — large, multi-stage company-specific interview
// gauntlets (NORMAL / HARD / BOSS tiers, 30..80 tasks each, ~10..28h
// playtime). There is no `dungeons` bounded context in backend/services/
// today and the persistence model alone (per-company task graphs, level
// gates, multi-day progress, boss reward grants) is at least a sprint of
// work. Rather than ship hard-coded company brackets and progress numbers
// we render a ComingSoon banner so users know the surface is real-but-not-
// yet-launched.
//
// Same pattern as TournamentPage / HeroCardsPage.
import { useNavigate } from 'react-router-dom'
import { AppShellV2 } from '../components/AppShell'
import { ComingSoon } from '../components/ComingSoon'

export default function DungeonsPage() {
  const navigate = useNavigate()
  return (
    <AppShellV2>
      <ComingSoon
        title="Подземелья компаний скоро откроются"
        description={
          'Большие многоэтапные интервью-сценарии под конкретные компании ' +
          '(Avito, VK, Яндекс, Tinkoff и др.) с прогрессом по секциям и ' +
          'наградой за прохождение Boss-уровня. Запуск — Q2 2026. Пока что ' +
          'тренируйся на Арене или прогоняй мок-интервью.'
        }
        primaryCta={{ label: 'На Арену', onClick: () => navigate('/arena') }}
        secondaryCta={{ label: 'Открыть Mock', onClick: () => navigate('/mock/new') }}
      />
    </AppShellV2>
  )
}
