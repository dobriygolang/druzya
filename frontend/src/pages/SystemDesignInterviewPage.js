import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { useNavigate, useParams } from 'react-router-dom';
import { AppShellV2 } from '../components/AppShell';
import { ComingSoon } from '../components/ComingSoon';
export default function SystemDesignInterviewPage() {
    const { sessionId } = useParams();
    const navigate = useNavigate();
    return (_jsxs(AppShellV2, { children: [_jsx(ComingSoon, { title: "System Design \u0438\u043D\u0442\u0435\u0440\u0432\u044C\u044E \u2014 \u0437\u0430\u043F\u0443\u0441\u043A \u0441\u043A\u043E\u0440\u043E", description: 'Готовим режим архитектурного интервью с интерактивным канвасом, ' +
                    'библиотекой компонентов (LB, кеш, очередь, БД) и AI-критиком, ' +
                    'который оценивает trade-offs по запросу. Пока что — обычный ' +
                    'AI-mock с system_design секцией.', primaryCta: { label: 'AI Mock', onClick: () => navigate('/mock/new') }, secondaryCta: { label: 'На главную', onClick: () => navigate('/') } }), _jsx("span", { className: "hidden", children: sessionId })] }));
}
