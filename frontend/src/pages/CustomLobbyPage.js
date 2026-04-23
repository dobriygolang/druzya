import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// TODO i18n
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Lock, Users, Sparkles, Code2, Share2, FileCode, Check } from 'lucide-react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { useFindMatchMutation, loadNeuralModel, } from '../lib/queries/arena';
const MODES = ['1v1', '2v2', 'Mock', 'AI-Allowed'];
const LANGS = ['Go', 'Python', 'TypeScript', 'Rust', 'Java', 'C++'];
const PRIVACY = ['Публичная', 'По коду', 'Приватная'];
const ROOMS = [
    { name: 'Алгосы перед Я.собесом', mode: '1v1', lang: 'Python', specs: 12, tags: ['DP', 'Graphs'], status: 'В матче' },
    { name: 'Mock interview · Senior BE', mode: 'Mock', lang: 'Go', specs: 4, tags: ['System Design'], status: 'Ожидание' },
    { name: '2v2 ladder grind', mode: '2v2', lang: 'TypeScript', specs: 28, tags: ['Trees', 'BFS'], status: 'В матче' },
    { name: 'AI duel · Sonnet vs Opus', mode: 'AI-Allowed', lang: 'Rust', specs: 47, tags: ['LLM'], status: 'В матче' },
    { name: 'Тренировка к ICPC', mode: '1v1', lang: 'C++', specs: 8, tags: ['Greedy'], status: 'Ожидание' },
    { name: 'Private — Yandex prep', mode: '1v1', lang: 'Go', specs: 0, tags: ['Locked'], status: 'Приватная', locked: true },
];
// Сопоставление UI-режима кастомного лобби c очередью arena. Mock играем
// через Hardcore (таймер строже), AI-Allowed через Cursed (открытый
// AI-помощник). Это позволяет реально стартовать матч из лобби, не
// добавляя отдельного бэкенд-эндпоинта под кастом.
const MODE_TO_QUEUE = {
    '1v1': 'solo_1v1',
    '2v2': 'duo_2v2',
    Mock: 'hardcore',
    'AI-Allowed': 'cursed',
};
const SETTING_KEYS = ['custom_tasks', 'ai_helper', 'video_voice', 'spectators'];
const SETTING_LABELS = {
    custom_tasks: 'Свои задачи',
    ai_helper: 'AI-помощник',
    video_voice: 'Видео + голос',
    spectators: 'Спектаторы',
};
export default function CustomLobbyPage() {
    const navigate = useNavigate();
    const findMatch = useFindMatchMutation();
    useEffect(() => {
        document.body.classList.add('v2');
        return () => document.body.classList.remove('v2');
    }, []);
    const [tab, setTab] = useState('create');
    const [name, setName] = useState('Тренировка с друзьями');
    const [mode, setMode] = useState('1v1');
    const [lang, setLang] = useState('Go');
    const [privacy, setPrivacy] = useState('Приватная');
    const [code, setCode] = useState('');
    const [search, setSearch] = useState('');
    const [settings, setSettings] = useState({
        custom_tasks: false,
        ai_helper: true,
        video_voice: false,
        spectators: true,
    });
    const [errorMsg, setErrorMsg] = useState(null);
    const filteredRooms = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q)
            return ROOMS;
        return ROOMS.filter((r) => r.name.toLowerCase().includes(q));
    }, [search]);
    const handleCreate = () => {
        setErrorMsg(null);
        const arenaMode = MODE_TO_QUEUE[mode];
        const section = lang.toLowerCase() === 'sql' ? 'sql' : 'algorithms';
        findMatch.mutate({ section, mode: arenaMode, neuralModel: loadNeuralModel() }, {
            onSuccess: (resp) => {
                if (resp.match_id) {
                    const path = arenaMode === 'duo_2v2'
                        ? `/arena/2v2/${resp.match_id}`
                        : `/arena/match/${resp.match_id}`;
                    navigate(path);
                    return;
                }
                // Queued — bounce user back to the arena so the existing queue
                // hero takes over (avoids a second "stuck on lobby" screen).
                navigate('/arena');
            },
            onError: (e) => {
                setErrorMsg(e.message ?? 'не удалось стартовать лобби');
            },
        });
    };
    const handleJoinByCode = () => {
        setErrorMsg(null);
        const trimmed = code.trim();
        if (!trimmed) {
            setErrorMsg('Введите код комнаты');
            return;
        }
        // Custom-lobby join-by-code re-uses the live match URL: the lobby host
        // shares the match_id as the room code. We navigate optimistically; the
        // ArenaMatchPage shows an error chip if the id is bogus.
        navigate(`/arena/match/${trimmed}`);
    };
    const handleEnterRoom = (roomMode) => {
        const arenaMode = MODE_TO_QUEUE[roomMode ?? '1v1'] ?? 'solo_1v1';
        findMatch.mutate({ section: 'algorithms', mode: arenaMode, neuralModel: loadNeuralModel() }, {
            onSuccess: (resp) => {
                if (resp.match_id) {
                    navigate(arenaMode === 'duo_2v2'
                        ? `/arena/2v2/${resp.match_id}`
                        : `/arena/match/${resp.match_id}`);
                    return;
                }
                navigate('/arena');
            },
            onError: (e) => setErrorMsg(e.message ?? 'не удалось войти'),
        });
    };
    const toggleSetting = (key) => {
        setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
    };
    return (_jsxs("div", { className: "min-h-screen bg-bg text-text-primary", children: [_jsxs("header", { className: "flex h-auto flex-col gap-3 border-b border-border bg-bg px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-0 lg:h-[72px]", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-4 lg:gap-8", children: [_jsxs(Link, { to: "/", className: "flex items-center gap-2.5", children: [_jsx("span", { className: "grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-lg font-extrabold text-text-primary", children: "9" }), _jsx("span", { className: "font-display text-lg font-bold text-text-primary", children: "druz9" }), _jsx("span", { className: "ml-1 rounded-md bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em] text-cyan", children: "LOBBY" })] }), _jsxs("nav", { className: "flex items-center gap-1", children: [_jsx(Link, { to: "/help", className: "rounded-md px-3.5 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2", children: "\u041A\u0430\u043A \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442" }), _jsx(Link, { to: "/arena", className: "rounded-md px-3.5 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2", children: "\u0414\u0435\u043C\u043E" }), _jsx(Link, { to: "/help", className: "rounded-md px-3.5 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2", children: "FAQ" })] })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Button, { variant: "ghost", onClick: () => navigate('/welcome'), children: "\u0412\u043E\u0439\u0442\u0438" }), _jsx(Button, { variant: "primary", onClick: handleCreate, disabled: findMatch.isPending, children: findMatch.isPending ? 'Создаём…' : 'Создать комнату' })] })] }), _jsxs("section", { className: "flex flex-col items-center gap-4 px-8 py-12 text-center", children: [_jsxs("span", { className: "inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-accent-hover", children: [_jsxs("span", { className: "relative h-2 w-2", children: [_jsx("span", { className: "absolute inset-0 animate-ping rounded-full bg-accent" }), _jsx("span", { className: "relative block h-2 w-2 rounded-full bg-accent" })] }), "12 \u0410\u041A\u0422\u0418\u0412\u041D\u042B\u0425 \u041A\u041E\u041C\u041D\u0410\u0422 \u00B7 348 \u0418\u0413\u0420\u041E\u041A\u041E\u0412"] }), _jsx("h1", { className: "font-display text-3xl sm:text-4xl lg:text-[48px] font-extrabold leading-[1.05] text-text-primary", children: "\u0421\u043E\u0437\u0434\u0430\u0439 \u0441\u0432\u043E\u044E \u043A\u043E\u0434\u0438\u043D\u0433-\u043A\u043E\u043C\u043D\u0430\u0442\u0443" }), _jsx("p", { className: "max-w-xl text-sm text-text-secondary", children: "\u0411\u0435\u0437 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0438 \u2014 \u043F\u0440\u0438\u0433\u043B\u0430\u0448\u0430\u0439 \u0434\u0440\u0443\u0437\u0435\u0439 \u043F\u043E \u0441\u0441\u044B\u043B\u043A\u0435 \u0438 \u0440\u0435\u0448\u0430\u0439\u0442\u0435 \u0437\u0430\u0434\u0430\u0447\u0438 \u0432 \u043B\u044E\u0431\u043E\u043C \u0444\u043E\u0440\u043C\u0430\u0442\u0435." })] }), _jsxs("div", { className: "flex flex-col gap-4 px-4 pb-12 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:pb-16", children: [_jsxs(Card, { className: "w-full flex-col gap-5 bg-surface-2 p-7 lg:w-[540px]", children: [_jsxs("div", { className: "flex gap-1 rounded-md bg-surface-1 p-1", children: [_jsx("button", { type: "button", onClick: () => setTab('create'), "aria-pressed": tab === 'create', className: `flex-1 rounded-md py-2 text-sm font-semibold transition-colors ${tab === 'create' ? 'bg-surface-3 text-text-primary' : 'text-text-secondary hover:text-text-primary'}`, children: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C" }), _jsx("button", { type: "button", onClick: () => setTab('code'), "aria-pressed": tab === 'code', className: `flex-1 rounded-md py-2 text-sm font-semibold transition-colors ${tab === 'code' ? 'bg-surface-3 text-text-primary' : 'text-text-secondary hover:text-text-primary'}`, children: "\u0412\u043E\u0439\u0442\u0438 \u043F\u043E \u043A\u043E\u0434\u0443" })] }), tab === 'code' ? (_jsxs("div", { className: "flex flex-col gap-3", children: [_jsx("label", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: "\u041A\u041E\u0414 \u041A\u041E\u041C\u041D\u0410\u0422\u042B" }), _jsx("input", { value: code, onChange: (e) => setCode(e.target.value), className: "h-10 rounded-md border border-border bg-bg px-3 font-mono text-sm tracking-widest text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none", placeholder: "match-id \u0438\u043B\u0438 \u043A\u043E\u0434 \u043F\u0440\u0438\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u044F" }), _jsx(Button, { variant: "primary", size: "lg", onClick: handleJoinByCode, children: "\u0412\u043E\u0439\u0442\u0438" }), errorMsg && _jsx("p", { className: "font-mono text-xs text-danger", children: errorMsg })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("label", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: "\u041D\u0410\u0417\u0412\u0410\u041D\u0418\u0415 \u041A\u041E\u041C\u041D\u0410\u0422\u042B" }), _jsx("input", { value: name, onChange: (e) => setName(e.target.value), className: "h-10 rounded-md border border-border bg-bg px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none", placeholder: "\u0422\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430 \u0441 \u0434\u0440\u0443\u0437\u044C\u044F\u043C\u0438" })] }), _jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("label", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: "\u0420\u0415\u0416\u0418\u041C" }), _jsx("div", { className: "grid grid-cols-2 gap-2", children: MODES.map((m) => (_jsx("button", { type: "button", onClick: () => setMode(m), "aria-pressed": mode === m, className: `rounded-lg border p-3 text-sm font-semibold transition-colors ${mode === m ? 'border-accent bg-accent/10 text-text-primary' : 'border-border bg-surface-1 text-text-secondary hover:border-border-strong'}`, children: m }, m))) })] }), _jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("label", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: "\u042F\u0417\u042B\u041A" }), _jsx("div", { className: "flex flex-wrap gap-2", children: LANGS.map((l) => (_jsx("button", { type: "button", onClick: () => setLang(l), "aria-pressed": lang === l, className: `rounded-full border px-3 py-1.5 text-xs font-semibold ${lang === l ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary hover:border-border-strong'}`, children: l }, l))) })] }), _jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("label", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: "\u041D\u0410\u0421\u0422\u0420\u041E\u0419\u041A\u0418" }), SETTING_KEYS.map((key) => {
                                                const on = settings[key];
                                                return (_jsxs("button", { type: "button", onClick: () => toggleSetting(key), "aria-pressed": on, className: "flex items-center justify-between rounded-md bg-surface-1 px-3 py-2 text-left transition-colors hover:bg-surface-3", children: [_jsx("span", { className: "text-[13px] text-text-secondary", children: SETTING_LABELS[key] }), _jsx("span", { className: `flex h-5 w-9 items-center rounded-full ${on ? 'justify-end bg-accent' : 'justify-start bg-surface-3'} px-0.5`, children: _jsx("span", { className: "grid h-4 w-4 place-items-center rounded-full bg-text-primary", children: on && _jsx(Check, { className: "h-2.5 w-2.5 text-bg" }) }) })] }, key));
                                            })] }), _jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("label", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: "\u0414\u041E\u0421\u0422\u0423\u041F" }), _jsx("div", { className: "flex gap-2", children: PRIVACY.map((p) => (_jsx("button", { type: "button", onClick: () => setPrivacy(p), "aria-pressed": privacy === p, className: `flex-1 rounded-md border py-2 text-xs font-semibold ${privacy === p ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary hover:border-border-strong'}`, children: p }, p))) })] }), errorMsg && _jsx("p", { className: "font-mono text-xs text-danger", children: errorMsg }), _jsx(Button, { variant: "primary", size: "lg", className: "shadow-glow", onClick: handleCreate, disabled: findMatch.isPending, children: findMatch.isPending ? 'Создаём…' : 'Создать и пригласить' })] }))] }), _jsxs("div", { className: "flex flex-1 flex-col gap-4", children: [_jsxs("div", { className: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", children: [_jsx("h2", { className: "font-display text-xl font-bold text-text-primary", children: "\u041E\u0442\u043A\u0440\u044B\u0442\u044B\u0435 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u0435 \u043A\u043E\u043C\u043D\u0430\u0442\u044B" }), _jsxs("div", { className: "flex h-9 w-full items-center gap-2 rounded-md border border-border bg-surface-2 px-3 sm:w-[240px]", children: [_jsx(Search, { className: "h-3.5 w-3.5 text-text-muted" }), _jsx("input", { value: search, onChange: (e) => setSearch(e.target.value), className: "flex-1 bg-transparent text-[13px] text-text-primary focus:outline-none", placeholder: "\u041F\u043E\u0438\u0441\u043A \u043A\u043E\u043C\u043D\u0430\u0442\u044B\u2026" })] })] }), filteredRooms.length === 0 && (_jsxs("p", { className: "font-mono text-xs text-text-muted", children: ["\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E \u043F\u043E \u0437\u0430\u043F\u0440\u043E\u0441\u0443 \u00AB", search, "\u00BB."] })), filteredRooms.map((r) => {
                                const locked = 'locked' in r && r.locked;
                                return (_jsxs(Card, { className: `flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 ${locked ? 'opacity-50' : ''}`, children: [_jsx("span", { className: "rounded-md bg-accent/15 px-2.5 py-1 font-mono text-[11px] font-bold text-accent-hover", children: r.mode }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col gap-0.5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [locked && _jsx(Lock, { className: "h-3 w-3 text-text-muted" }), _jsx("span", { className: "font-display text-sm font-bold text-text-primary", children: r.name })] }), _jsxs("span", { className: "font-mono text-[11px] text-text-muted", children: [r.lang, " \u00B7 ", r.specs, " \u0437\u0440\u0438\u0442\u0435\u043B\u0435\u0439"] })] }), _jsx("div", { className: "flex flex-wrap gap-1", children: r.tags.map((t) => _jsx("span", { className: "rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-text-secondary", children: t }, t)) }), _jsxs("div", { className: "flex -space-x-2", children: [_jsx(Avatar, { size: "sm", gradient: "violet-cyan", initials: "A" }), _jsx(Avatar, { size: "sm", gradient: "pink-violet", initials: "K" })] }), _jsx("span", { className: `font-mono text-[11px] font-semibold ${r.status === 'В матче' ? 'text-success' : 'text-warn'}`, children: r.status }), locked ? (_jsxs("span", { className: "inline-flex items-center gap-1 rounded-md border border-border px-3 py-1 font-mono text-[11px] text-text-muted", children: [_jsx(Lock, { className: "h-3 w-3" }), " \u0417\u0430\u043A\u0440\u044B\u0442\u043E"] })) : (_jsx(Button, { size: "sm", variant: "primary", onClick: () => handleEnterRoom(r.mode), disabled: findMatch.isPending, children: findMatch.isPending ? '...' : 'Войти' }))] }, r.name));
                            })] })] }), _jsxs("div", { className: "grid grid-cols-1 gap-4 border-t border-border bg-surface-1 px-4 py-8 sm:grid-cols-2 sm:px-8 lg:grid-cols-3 lg:px-20 lg:py-10", children: [[
                        { icon: _jsx(Users, { className: "h-5 w-5 text-cyan" }), l: 'Без регистрации', s: 'Гость по ссылке за 5 секунд' },
                        { icon: _jsx(Share2, { className: "h-5 w-5 text-pink" }), l: 'Шарь ссылкой', s: 'Один клик — копия инвайта в буфер' },
                        { icon: _jsx(FileCode, { className: "h-5 w-5 text-warn" }), l: 'Свои задачи', s: 'Загружай условия и тесты в YAML' },
                    ].map((t) => (_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "grid h-10 w-10 place-items-center rounded-lg bg-surface-2", children: t.icon }), _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-display text-sm font-bold text-text-primary", children: t.l }), _jsx("span", { className: "text-xs text-text-muted", children: t.s })] })] }, t.l))), _jsxs("div", { className: "hidden", children: [_jsx(Sparkles, {}), _jsx(Code2, {})] })] })] }));
}
