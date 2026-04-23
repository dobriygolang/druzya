import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// /podcasts — каталог подкастов с возможностью прослушивания.
//
// Источник правды — backend services/podcast (см. ports/server.go,
// PodcastServer.ListCatalog). Реальные ответы содержат signed audio URL
// (`audio_url`) — фронт встраивает <audio>-плеер прямо в карточку и
// throttle'ом вызывает PUT /podcast/{id}/progress, чтобы прогресс
// синхронизировался между девайсами.
//
// Структура:
//   - Hero: featured-эпизод (первый из выдачи) с большой кнопкой Play.
//   - Filter chips: «Все», секции (Algorithms / SQL / Go / System Design /
//     Behavioral) — клиентский фильтр поверх полученного каталога.
//   - Search input: подстрочный фильтр по title/description.
//   - Grid: карточки с inline-плеером, длительностью, датой публикации.
//
// Ключевой UX-принцип: ВСЕ кнопки кликабельные. Если audio_url пустой
// (mock или сигнер не настроен), плеер деактивируется, но визуально
// карточка всё равно реагирует на hover/keyboard.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Headphones, Play, Pause, Search, CheckCircle2, Clock, Filter } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Card } from '../components/Card';
import { usePodcastsQuery, updatePodcastProgress, formatDuration, formatPublished, } from '../lib/queries/podcasts';
// Discrete section keys mirroring `enums.Section` on the Go side. UI labels
// сидят в i18n `pages.podcasts.sections`.
const SECTION_KEYS = [
    'all',
    'SECTION_ALGORITHMS',
    'SECTION_SQL',
    'SECTION_GO',
    'SECTION_SYSTEM_DESIGN',
    'SECTION_BEHAVIORAL',
    // Mock использует lowercase-формы — поддерживаем оба варианта в фильтре.
    'algorithms',
    'sql',
    'go',
    'system_design',
    'behavioral',
];
// Mapping mock-секций к i18n-ключам — одна и та же подпись для обоих
// вариантов написания.
function sectionI18nKey(s) {
    switch (s.toLowerCase().replace(/^section_/, '')) {
        case 'algorithms':
            return 'algorithms';
        case 'sql':
            return 'sql';
        case 'go':
            return 'go';
        case 'system_design':
            return 'system_design';
        case 'behavioral':
            return 'behavioral';
        default:
            return 'other';
    }
}
function ProgressBar({ podcast }) {
    const total = Math.max(1, podcast.duration_sec);
    const pct = Math.min(100, Math.round((podcast.progress_sec / total) * 100));
    if (podcast.progress_sec === 0 && !podcast.completed)
        return null;
    return (_jsx("div", { className: "h-1 w-full overflow-hidden rounded-full bg-surface-1", children: _jsx("div", { className: podcast.completed ? 'h-full bg-success' : 'h-full bg-accent', style: { width: `${podcast.completed ? 100 : pct}%` } }) }));
}
// AudioPlayer — управляемый <audio> с throttled progress sync. Когда
// карточка получает фокус (isActive=true), мы собственно создаём элемент;
// до этого рендерится только Play-кнопка, чтобы не плодить десятки
// одновременно загружающихся аудио-источников при первом рендере страницы.
function AudioPlayer({ podcast, isActive, onActivate }) {
    const audioRef = useRef(null);
    const lastSyncRef = useRef(0);
    const [playing, setPlaying] = useState(false);
    useEffect(() => {
        if (!isActive)
            return;
        const el = audioRef.current;
        if (!el)
            return;
        if (podcast.progress_sec > 0 && el.currentTime < podcast.progress_sec) {
            try {
                el.currentTime = podcast.progress_sec;
            }
            catch {
                /* some browsers throw if seeking before metadata loaded */
            }
        }
    }, [isActive, podcast.progress_sec]);
    function handleTimeUpdate() {
        const el = audioRef.current;
        if (!el)
            return;
        const now = Date.now();
        // Throttle: 1 sync / 10 s, чтобы не заспамить бэкенд.
        if (now - lastSyncRef.current < 10_000)
            return;
        lastSyncRef.current = now;
        void updatePodcastProgress({
            podcastId: podcast.id,
            progressSec: el.currentTime,
        }).catch(() => {
            /* network blip — следующий tick попробует снова */
        });
    }
    function handleEnded() {
        void updatePodcastProgress({
            podcastId: podcast.id,
            progressSec: podcast.duration_sec,
            completed: true,
        }).catch(() => { });
        setPlaying(false);
    }
    function togglePlay() {
        onActivate();
        const el = audioRef.current;
        if (!el) {
            // Element will be created on next render (because isActive flips); the
            // user's intent gets a small lag of one tick. Schedule a follow-up play.
            window.setTimeout(() => {
                const next = audioRef.current;
                if (next)
                    void next.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
            }, 0);
            return;
        }
        if (el.paused) {
            void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        }
        else {
            el.pause();
            setPlaying(false);
        }
    }
    const disabled = !podcast.audio_url;
    return (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { type: "button", onClick: togglePlay, disabled: disabled, title: disabled ? 'Аудио недоступно' : playing ? 'Пауза' : 'Слушать', "aria-label": playing ? 'Пауза' : 'Слушать', className: "grid h-10 w-10 place-items-center rounded-full bg-accent text-text-primary transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-muted", children: playing ? _jsx(Pause, { className: "h-4 w-4" }) : _jsx(Play, { className: "h-4 w-4" }) }), isActive && podcast.audio_url && (_jsx("audio", { ref: audioRef, src: podcast.audio_url, preload: "metadata", controls: true, className: "h-9 w-full max-w-[260px]", onTimeUpdate: handleTimeUpdate, onEnded: handleEnded, onPause: () => setPlaying(false), onPlay: () => setPlaying(true) }))] }));
}
function PodcastCard({ podcast, isActive, onActivate, }) {
    const { t } = useTranslation('pages');
    return (_jsxs(Card, { variant: "elevated", padding: "lg", className: "flex h-full flex-col gap-3", children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "flex min-w-0 flex-col gap-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase text-text-secondary", children: t(`podcasts.sections.${sectionI18nKey(podcast.section)}`, { defaultValue: podcast.section }) }), podcast.completed && (_jsxs("span", { className: "inline-flex items-center gap-1 font-mono text-[10px] text-success", children: [_jsx(CheckCircle2, { className: "h-3 w-3" }), " ", t('podcasts.completed', { defaultValue: 'Прослушан' })] }))] }), _jsx("h3", { className: "truncate font-display text-base font-bold text-text-primary", children: podcast.title }), podcast.description && (_jsx("p", { className: "line-clamp-2 text-[13px] text-text-secondary", children: podcast.description }))] }), _jsx("div", { className: "grid h-12 w-12 shrink-0 place-items-center rounded-md bg-gradient-to-br from-pink to-accent", children: _jsx(Headphones, { className: "h-5 w-5 text-text-primary" }) })] }), _jsxs("div", { className: "mt-auto flex flex-col gap-2", children: [_jsx(ProgressBar, { podcast: podcast }), _jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsxs("div", { className: "flex items-center gap-3 text-[12px] text-text-muted", children: [_jsxs("span", { className: "inline-flex items-center gap-1", children: [_jsx(Clock, { className: "h-3 w-3" }), " ", formatDuration(podcast.duration_sec)] }), podcast.published_at && _jsx("span", { children: formatPublished(podcast.published_at) })] }), _jsx(AudioPlayer, { podcast: podcast, isActive: isActive, onActivate: onActivate })] })] })] }));
}
function HeroFeatured({ podcast, isActive, onActivate, }) {
    const { t } = useTranslation('pages');
    if (!podcast)
        return null;
    return (_jsxs(Card, { variant: "elevated", padding: "lg", className: "flex flex-col gap-4 bg-gradient-to-br from-accent/15 via-surface-1 to-pink/10 lg:flex-row lg:items-center", children: [_jsx("div", { className: "grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-pink to-accent", children: _jsx(Headphones, { className: "h-8 w-8 text-text-primary" }) }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col gap-2", children: [_jsx("span", { className: "font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted", children: t('podcasts.featured', { defaultValue: 'Подкаст недели' }) }), _jsx("h2", { className: "font-display text-xl font-bold text-text-primary lg:text-2xl", children: podcast.title }), podcast.description && (_jsx("p", { className: "text-[13px] text-text-secondary", children: podcast.description })), _jsxs("div", { className: "flex items-center gap-3 text-[12px] text-text-muted", children: [_jsxs("span", { className: "inline-flex items-center gap-1", children: [_jsx(Clock, { className: "h-3 w-3" }), " ", formatDuration(podcast.duration_sec)] }), podcast.published_at && _jsx("span", { children: formatPublished(podcast.published_at) })] }), _jsx("div", { className: "mt-1", children: _jsx(AudioPlayer, { podcast: podcast, isActive: isActive, onActivate: onActivate }) })] })] }));
}
function SectionFilter({ active, onChange, sections, }) {
    const { t } = useTranslation('pages');
    return (_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx(Filter, { className: "h-4 w-4 shrink-0 text-text-muted" }), _jsx("button", { type: "button", onClick: () => onChange('all'), className: active === 'all'
                    ? 'rounded-full border border-accent bg-accent/15 px-3 py-1 text-[12px] font-semibold text-accent-hover'
                    : 'rounded-full border border-border bg-surface-2 px-3 py-1 text-[12px] text-text-secondary hover:border-accent/40', children: t('podcasts.filter.all', { defaultValue: 'Все' }) }), sections
                .filter((s) => s !== 'all')
                .map((s) => (_jsx("button", { type: "button", onClick: () => onChange(s), className: active === s
                    ? 'rounded-full border border-accent bg-accent/15 px-3 py-1 text-[12px] font-semibold text-accent-hover'
                    : 'rounded-full border border-border bg-surface-2 px-3 py-1 text-[12px] text-text-secondary hover:border-accent/40', children: t(`podcasts.sections.${sectionI18nKey(s)}`, { defaultValue: s }) }, s)))] }));
}
export default function PodcastsPage() {
    const { t } = useTranslation('pages');
    const { data, isLoading, isError, refetch } = usePodcastsQuery();
    const [section, setSection] = useState('all');
    const [search, setSearch] = useState('');
    const [activeId, setActiveId] = useState(null);
    const podcasts = useMemo(() => data ?? [], [data]);
    // Derive the section chips from data so we don't show a chip for an empty
    // bucket. The string identity (uppercase vs lowercase) is preserved so the
    // filter predicate just compares with ===.
    const availableSections = useMemo(() => {
        const set = new Set(['all']);
        for (const p of podcasts) {
            if (SECTION_KEYS.includes(p.section)) {
                set.add(p.section);
            }
        }
        return Array.from(set);
    }, [podcasts]);
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return podcasts.filter((p) => {
            if (section !== 'all' && p.section !== section)
                return false;
            if (!q)
                return true;
            return p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
        });
    }, [podcasts, section, search]);
    const featured = filtered[0] ?? podcasts[0] ?? null;
    const grid = filtered.slice(featured && filtered.includes(featured) ? 1 : 0);
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-6 sm:px-8 lg:px-10 lg:py-8", children: [_jsxs("header", { className: "flex flex-col gap-2", children: [_jsx("h1", { className: "font-display text-2xl font-bold text-text-primary lg:text-[32px] lg:leading-[1.1]", children: t('podcasts.title', { defaultValue: 'Подкасты' }) }), _jsx("p", { className: "text-sm text-text-secondary", children: t('podcasts.subtitle', {
                                defaultValue: 'Слушай разборы интервью, патчи в системном дизайне и stories из прода.',
                            }) })] }), isLoading ? (_jsx("div", { className: "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3", children: Array.from({ length: 6 }).map((_, i) => (_jsx("div", { className: "h-[180px] animate-pulse rounded-2xl bg-surface-2" }, i))) })) : isError ? (_jsxs("div", { className: "flex flex-col items-start gap-3 rounded-2xl border border-danger/40 bg-surface-1 p-5", children: [_jsx("p", { className: "text-sm text-text-secondary", children: t('podcasts.error', { defaultValue: 'Не удалось загрузить каталог.' }) }), _jsx("button", { type: "button", onClick: () => void refetch(), className: "rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-text-primary hover:bg-accent-hover", children: t('podcasts.retry', { defaultValue: 'Повторить' }) })] })) : podcasts.length === 0 ? (_jsxs("div", { className: "rounded-2xl border border-border bg-surface-1 p-8 text-center", children: [_jsx(Headphones, { className: "mx-auto mb-3 h-8 w-8 text-text-muted" }), _jsx("p", { className: "text-sm text-text-secondary", children: t('podcasts.empty', { defaultValue: 'Пока в каталоге нет ни одного эпизода.' }) })] })) : (_jsxs(_Fragment, { children: [_jsx(HeroFeatured, { podcast: featured, isActive: featured?.id === activeId, onActivate: () => featured && setActiveId(featured.id) }), _jsxs("div", { className: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", children: [_jsx(SectionFilter, { active: section, onChange: setSection, sections: availableSections }), _jsxs("label", { className: "flex h-9 items-center gap-2 rounded-md border border-border bg-surface-2 px-3 sm:w-[280px]", children: [_jsx(Search, { className: "h-4 w-4 text-text-muted", "aria-hidden": true }), _jsx("input", { type: "search", value: search, onChange: (e) => setSearch(e.target.value), placeholder: t('podcasts.search_placeholder', { defaultValue: 'Поиск по эпизодам…' }), className: "flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted", "aria-label": t('podcasts.search_placeholder', { defaultValue: 'Поиск по эпизодам' }) })] })] }), grid.length === 0 ? (_jsx("p", { className: "text-sm text-text-muted", children: t('podcasts.no_match', { defaultValue: 'Ничего не нашлось — попробуй другой фильтр.' }) })) : (_jsx("div", { className: "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3", children: grid.map((p) => (_jsx(PodcastCard, { podcast: p, isActive: p.id === activeId, onActivate: () => setActiveId(p.id) }, p.id))) }))] }))] }) }));
}
