import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TournamentPage is a placeholder while the tournament backend is built.
//
// There is no `tournament` bounded context in backend/services/ today — the
// previous demo used hard-coded brackets / prize pool / participant numbers.
// Rather than ship fictional numbers we render a ComingSoon banner so users
// understand the surface is real-but-not-yet-launched.
import { useNavigate, useParams } from 'react-router-dom';
import { AppShellV2 } from '../components/AppShell';
import { ComingSoon } from '../components/ComingSoon';
export default function TournamentPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    return (_jsxs(AppShellV2, { children: [_jsx(ComingSoon, { title: "\u0422\u0443\u0440\u043D\u0438\u0440\u044B \u0441\u043A\u043E\u0440\u043E \u0431\u0443\u0434\u0443\u0442", description: 'Мы готовим формат еженедельных турниров с реальным призовым фондом, ' +
                    'сеткой Single Elimination и прогнозами. Подпишись — пришлём пуш на старте.', primaryCta: { label: 'На главную', onClick: () => navigate('/') }, secondaryCta: { label: 'Открыть Арену', onClick: () => navigate('/arena') } }), _jsx("span", { className: "hidden", children: id })] }));
}
