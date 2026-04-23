import { jsx as _jsx } from "react/jsx-runtime";
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
import { useNavigate } from 'react-router-dom';
import { AppShellV2 } from '../components/AppShell';
import { ComingSoon } from '../components/ComingSoon';
export default function DungeonsPage() {
    const navigate = useNavigate();
    return (_jsx(AppShellV2, { children: _jsx(ComingSoon, { title: "\u041F\u043E\u0434\u0437\u0435\u043C\u0435\u043B\u044C\u044F \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u0439 \u0441\u043A\u043E\u0440\u043E \u043E\u0442\u043A\u0440\u043E\u044E\u0442\u0441\u044F", description: 'Большие многоэтапные интервью-сценарии под конкретные компании ' +
                '(Avito, VK, Яндекс, Tinkoff и др.) с прогрессом по секциям и ' +
                'наградой за прохождение Boss-уровня. Запуск — Q2 2026. Пока что ' +
                'тренируйся на Арене или прогоняй мок-интервью.', primaryCta: { label: 'На Арену', onClick: () => navigate('/arena') }, secondaryCta: { label: 'Открыть Mock', onClick: () => navigate('/mock/new') } }) }));
}
