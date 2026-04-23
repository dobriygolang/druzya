import { jsx as _jsx } from "react/jsx-runtime";
// HeroCardsPage is a placeholder while the hero-cards collectible system is
// built. There is no `hero_cards` bounded context in backend/services/ today
// — the previous demo used a hand-coded CARDS array and a fictional 1500💎
// pack price. Rather than ship invented numbers we render a ComingSoon
// banner so the surface is honest about its readiness.
import { useNavigate } from 'react-router-dom';
import { AppShellV2 } from '../components/AppShell';
import { ComingSoon } from '../components/ComingSoon';
export default function HeroCardsPage() {
    const navigate = useNavigate();
    return (_jsx(AppShellV2, { children: _jsx(ComingSoon, { title: "Hero Cards \u0432 \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0435", description: 'Коллекционные карточки игроков с редкостями, паками и обменом — ' +
                'отдельный домен, который мы делаем после Season Pass. ' +
                'Пока приходи в Сезон-пасс за наградами.', primaryCta: { label: 'Сезон-пасс', onClick: () => navigate('/season') }, secondaryCta: { label: 'На главную', onClick: () => navigate('/') } }) }));
}
