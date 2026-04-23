import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Play, Pause, SkipBack, SkipForward, ChevronDown, Headphones, Heart, ListMusic, Briefcase, GraduationCap, } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShellV2 } from '../components/AppShell';
import { Card } from '../components/Card';
import { usePodcastCatalogQuery } from '../lib/queries/codex';
function Hero() {
    const { t } = useTranslation('codex');
    const { data, isError } = usePodcastCatalogQuery();
    const total = data?.episodes?.length ?? 0;
    return (_jsxs("section", { className: "flex flex-col items-start justify-center gap-3 px-4 py-8 sm:px-8 lg:px-20", style: {
            padding: undefined,
            background: 'linear-gradient(180deg, #2D1B4D 0%, #0A0A0F 100%)',
        }, children: [_jsx("span", { className: "inline-flex items-center gap-1.5 rounded-full bg-pink/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-pink", children: t('tag') }), _jsx("h1", { className: "font-display text-3xl font-bold leading-[1.1] text-text-primary lg:text-[36px]", children: t('title') }), _jsx("p", { className: "max-w-[640px] text-[15px] text-text-secondary", children: isError ? t('subtitle_error') : t('subtitle', { count: total || 47 }) })] }));
}
function FiltersRow() {
    const { t } = useTranslation('codex');
    const FILTERS = [
        { label: t('filters.all'), count: 47, active: true },
        { label: t('filters.system_design'), count: 12, active: false },
        { label: t('filters.backend'), count: 14, active: false },
        { label: t('filters.career'), count: 11, active: false },
        { label: t('filters.behavioral'), count: 6, active: false },
        { label: t('filters.algorithms'), count: 4, active: false },
    ];
    return (_jsxs("div", { className: "flex flex-col items-start gap-3 px-4 py-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-20", children: [_jsx("div", { className: "flex flex-wrap items-center gap-2", children: FILTERS.map((f) => (_jsxs("button", { type: "button", className: f.active
                        ? 'inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-1.5 text-[13px] font-semibold text-text-primary'
                        : 'inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3.5 py-1.5 text-[13px] text-text-secondary hover:border-border-strong hover:text-text-primary', children: [f.label, ' ', _jsx("span", { className: f.active
                                ? 'font-mono text-[11px] text-text-muted'
                                : 'font-mono text-[11px] text-text-muted', children: f.count })] }, f.label))) }), _jsxs("button", { type: "button", className: "inline-flex items-center gap-1.5 font-mono text-[12px] text-text-secondary hover:text-text-primary", children: [t('newest_first'), " ", _jsx(ChevronDown, { className: "h-3.5 w-3.5" })] })] }));
}
function FeaturedCard() {
    const { t } = useTranslation('codex');
    const { data } = usePodcastCatalogQuery();
    const featured = data?.episodes?.[0];
    const title = featured?.title ?? t('featured_title');
    const author = featured ? `${featured.section} · ${featured.duration_min} мин` : t('featured_author');
    return (_jsxs("div", { className: "flex flex-col items-start gap-6 rounded-xl border border-border-strong p-5 shadow-card sm:flex-row sm:items-center sm:p-7 lg:h-[200px]", style: {
            background: 'linear-gradient(135deg, #2D1B4D 0%, #582CFF 100%)',
        }, children: [_jsx("button", { type: "button", className: "grid shrink-0 place-items-center rounded-full transition-all hover:scale-105", style: {
                    width: 100,
                    height: 100,
                    background: 'rgba(255,255,255,0.12)',
                    backdropFilter: 'blur(8px)',
                }, "aria-label": "Play featured episode", children: _jsx(Play, { className: "h-9 w-9 fill-text-primary text-text-primary" }) }), _jsxs("div", { className: "flex flex-1 flex-col gap-2", children: [_jsx("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn", children: t('episode_of_week') }), _jsx("h2", { className: "font-display text-xl font-bold leading-tight text-text-primary sm:text-2xl lg:text-[26px]", children: title }), _jsx("span", { className: "font-mono text-[12px] text-white/70", children: author }), _jsxs("div", { className: "mt-1 flex items-center gap-2", children: [_jsx("span", { className: "rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium text-text-primary", children: "System Design" }), _jsx("span", { className: "rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium text-text-primary", children: "\u041A\u0430\u0440\u044C\u0435\u0440\u0430" }), _jsx("span", { className: "ml-auto font-mono text-[11px] text-white/60", children: t('listens', { count: 12480 }) })] })] })] }));
}
const EPISODES = [
    {
        title: 'Шардинг PostgreSQL без боли',
        author: 'Мария Карпова, Avito',
        category: 'BACKEND',
        completion: '↻ 87% слушают до конца',
        gradient: 'linear-gradient(135deg, #582CFF 0%, #22D3EE 100%)',
    },
    {
        title: 'Как договориться о +30% к офферу',
        author: 'Игорь Новиков, ex-Yandex',
        category: 'КАРЬЕРА',
        completion: '↻ 92% слушают до конца',
        gradient: 'linear-gradient(135deg, #F472B6 0%, #582CFF 100%)',
    },
    {
        title: 'Дизайн ленты как у TikTok',
        author: 'Дмитрий Костров, VK',
        category: 'SYSTEM DESIGN',
        completion: '↻ 81% слушают до конца',
        gradient: 'linear-gradient(135deg, #22D3EE 0%, #10B981 100%)',
    },
    {
        title: 'STAR-метод на behavioral интервью',
        author: 'Анна Беликова, HR Lead',
        category: 'BEHAVIORAL',
        completion: '↻ 78% слушают до конца',
        gradient: 'linear-gradient(135deg, #FBBF24 0%, #F472B6 100%)',
    },
    {
        title: 'Микросервисы — когда не нужно',
        author: 'Сергей Петров, Ozon',
        category: 'BACKEND',
        completion: '↻ 89% слушают до конца',
        gradient: 'linear-gradient(135deg, #EF4444 0%, #FBBF24 100%)',
    },
    {
        title: 'Графы в проде: путь от Neo4j',
        author: 'Илья Раков, Wildberries',
        category: 'АЛГОРИТМЫ',
        completion: '↻ 74% слушают до конца',
        gradient: 'linear-gradient(135deg, #582CFF 0%, #F472B6 100%)',
    },
    {
        title: 'Дизайн Uber: матчинг водителей',
        author: 'Никита Власов, ex-Uber',
        category: 'SYSTEM DESIGN',
        completion: '↻ 85% слушают до конца',
        gradient: 'linear-gradient(135deg, #10B981 0%, #22D3EE 100%)',
    },
    {
        title: 'Как пройти онсайт в FAANG',
        author: 'Кирилл Лебедев, Meta',
        category: 'КАРЬЕРА',
        completion: '↻ 90% слушают до конца',
        gradient: 'linear-gradient(135deg, #F472B6 0%, #EF4444 100%)',
    },
    {
        title: 'Kafka vs RabbitMQ: что выбрать',
        author: 'Олег Жуков, Сбер',
        category: 'BACKEND',
        completion: '↻ 83% слушают до конца',
        gradient: 'linear-gradient(135deg, #FBBF24 0%, #582CFF 100%)',
    },
];
function EpisodeCard({ ep }) {
    return (_jsxs(Card, { interactive: true, padding: "none", className: "overflow-hidden", style: { height: 240 }, children: [_jsx("div", { className: "relative flex items-end justify-end p-3", style: { height: 100, background: ep.gradient }, children: _jsx("button", { type: "button", className: "grid h-9 w-9 place-items-center rounded-full bg-black/30 text-text-primary backdrop-blur-sm hover:bg-black/50", "aria-label": "Play episode", children: _jsx(Play, { className: "h-3.5 w-3.5 fill-text-primary" }) }) }), _jsxs("div", { className: "flex flex-1 flex-col gap-1.5 p-4", children: [_jsx("span", { className: "font-mono text-[10px] font-semibold tracking-[0.08em] text-text-muted", children: ep.category }), _jsx("h4", { className: "font-sans text-[14px] font-bold leading-tight text-text-primary", children: ep.title }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: ep.author }), _jsx("span", { className: "mt-auto font-mono text-[11px] text-success", children: ep.completion })] })] }));
}
const FALLBACK_GRADIENTS = [
    'linear-gradient(135deg, #582CFF 0%, #22D3EE 100%)',
    'linear-gradient(135deg, #F472B6 0%, #582CFF 100%)',
    'linear-gradient(135deg, #22D3EE 0%, #10B981 100%)',
    'linear-gradient(135deg, #FBBF24 0%, #F472B6 100%)',
    'linear-gradient(135deg, #EF4444 0%, #FBBF24 100%)',
    'linear-gradient(135deg, #10B981 0%, #22D3EE 100%)',
];
function EpisodesGrid() {
    const { t } = useTranslation('codex');
    const { data, isError } = usePodcastCatalogQuery();
    const episodes = data?.episodes?.length
        ? data.episodes.map((e, i) => ({
            title: e.title,
            author: e.description,
            category: e.section.toUpperCase(),
            completion: e.listened ? '✓ прослушано' : `${e.duration_min} мин`,
            gradient: FALLBACK_GRADIENTS[i % FALLBACK_GRADIENTS.length],
        }))
        : EPISODES;
    return (_jsxs("div", { className: "flex flex-col gap-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "font-display text-[20px] font-bold text-text-primary", children: t('all_episodes') }), isError && (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: t('load_failed') }))] }), _jsx("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3", children: episodes.map((ep) => (_jsx(EpisodeCard, { ep: ep }, ep.title))) })] }));
}
function NowPlayingCard() {
    return (_jsxs(Card, { padding: "md", className: "gap-3 p-4", variant: "elevated", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "h-12 w-12 shrink-0 rounded-md", style: {
                            background: 'linear-gradient(135deg, #582CFF 0%, #F472B6 100%)',
                        } }), _jsxs("div", { className: "flex flex-1 flex-col gap-0.5", children: [_jsx("span", { className: "text-[13px] font-semibold text-text-primary", children: "\u0428\u0430\u0440\u0434\u0438\u043D\u0433 PostgreSQL \u0431\u0435\u0437 \u0431\u043E\u043B\u0438" }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "\u041C\u0430\u0440\u0438\u044F \u041A\u0430\u0440\u043F\u043E\u0432\u0430" })] })] }), _jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("div", { className: "h-1 overflow-hidden rounded-full bg-black/40", children: _jsx("div", { className: "h-full w-[42%] rounded-full bg-accent" }) }), _jsxs("div", { className: "flex justify-between font-mono text-[10px] text-text-muted", children: [_jsx("span", { children: "14:23" }), _jsx("span", { children: "34:01" })] })] }), _jsxs("div", { className: "flex items-center justify-center gap-3", children: [_jsx("button", { type: "button", className: "grid h-9 w-9 place-items-center rounded-full text-text-secondary hover:bg-surface-3 hover:text-text-primary", "aria-label": "Skip back", children: _jsx(SkipBack, { className: "h-4 w-4" }) }), _jsx("button", { type: "button", className: "grid h-10 w-10 place-items-center rounded-full bg-accent text-text-primary shadow-glow hover:bg-accent-hover", "aria-label": "Pause", children: _jsx(Pause, { className: "h-4 w-4 fill-text-primary" }) }), _jsx("button", { type: "button", className: "grid h-9 w-9 place-items-center rounded-full text-text-secondary hover:bg-surface-3 hover:text-text-primary", "aria-label": "Skip forward", children: _jsx(SkipForward, { className: "h-4 w-4" }) })] })] }));
}
function StatsCard() {
    const { t } = useTranslation('codex');
    const rows = [
        { label: t('stats_rows.listened'), value: '12', color: 'text-text-primary' },
        { label: t('stats_rows.hours_month'), value: '8.4', color: 'text-text-primary' },
        { label: t('stats_rows.completed'), value: '67%', color: 'text-success' },
        { label: t('stats_rows.favourite'), value: 'System Design', color: 'text-cyan' },
    ];
    return (_jsxs(Card, { padding: "md", className: "gap-3 p-4", children: [_jsx("h4", { className: "font-display text-[15px] font-bold text-text-primary", children: t('stats') }), _jsx("div", { className: "flex flex-col gap-2", children: rows.map((r) => (_jsxs("div", { className: "flex items-center justify-between border-b border-border/60 py-1.5 last:border-b-0", children: [_jsx("span", { className: "text-[12px] text-text-secondary", children: r.label }), _jsx("span", { className: `font-mono text-[12px] font-semibold ${r.color}`, children: r.value })] }, r.label))) })] }));
}
function PlaylistsCard() {
    const { t } = useTranslation('codex');
    const lists = [
        {
            icon: _jsx(Briefcase, { className: "h-4 w-4 text-accent-hover" }),
            bg: 'bg-accent/15',
            name: t('playlist.yandex'),
            meta: '8 · 4h 12m',
        },
        {
            icon: _jsx(GraduationCap, { className: "h-4 w-4 text-cyan" }),
            bg: 'bg-cyan/15',
            name: t('playlist.system_design'),
            meta: '12 · 7h 48m',
        },
        {
            icon: _jsx(Heart, { className: "h-4 w-4 text-pink" }),
            bg: 'bg-pink/15',
            name: t('playlist.favourites'),
            meta: '5 · 3h 04m',
        },
    ];
    return (_jsxs(Card, { padding: "md", className: "gap-3 p-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h4", { className: "font-display text-[15px] font-bold text-text-primary", children: t('playlists') }), _jsx(ListMusic, { className: "h-4 w-4 text-text-muted" })] }), _jsx("div", { className: "flex flex-col gap-1", children: lists.map((l) => (_jsxs("button", { type: "button", className: "flex items-center gap-3 rounded-lg p-2 text-left hover:bg-surface-3", children: [_jsx("span", { className: `grid h-9 w-9 shrink-0 place-items-center rounded-md ${l.bg}`, children: l.icon }), _jsxs("div", { className: "flex flex-1 flex-col gap-0.5", children: [_jsx("span", { className: "text-[13px] font-semibold text-text-primary", children: l.name }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: l.meta })] })] }, l.name))) })] }));
}
function Sidebar() {
    const { t } = useTranslation('codex');
    return (_jsxs("aside", { className: "flex w-full shrink-0 flex-col gap-4 lg:w-[320px]", children: [_jsxs("div", { className: "flex items-center gap-2 px-1", children: [_jsx(Headphones, { className: "h-4 w-4 text-accent-hover" }), _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: t('now_playing') })] }), _jsx(NowPlayingCard, {}), _jsx(StatsCard, {}), _jsx(PlaylistsCard, {})] }));
}
export default function CodexPage() {
    return (_jsxs(AppShellV2, { children: [_jsx(Hero, {}), _jsx(FiltersRow, {}), _jsxs("div", { className: "flex flex-col gap-6 px-4 pb-12 sm:px-8 lg:flex-row lg:px-20", children: [_jsxs("div", { className: "flex flex-1 flex-col gap-6", children: [_jsx(FeaturedCard, {}), _jsx(EpisodesGrid, {})] }), _jsx(Sidebar, {})] })] }));
}
