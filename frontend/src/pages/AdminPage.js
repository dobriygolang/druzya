import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { Search, MoreHorizontal, Plus } from 'lucide-react';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
function Sidebar() {
    const sections = [
        {
            title: 'ОПЕРАЦИИ',
            items: [
                { name: 'Dashboard' },
                { name: 'Tasks', chip: '1.2k', chipColor: 'bg-surface-3 text-text-secondary', active: true },
                { name: 'Companies' },
                { name: 'Test Cases' },
                { name: 'Podcasts' },
            ],
        },
        {
            title: 'МОДЕРАЦИЯ',
            items: [
                { name: 'Anti-Cheat', chip: '23', chipColor: 'bg-danger/20 text-danger' },
                { name: 'Reports' },
                { name: 'Banned' },
            ],
        },
        {
            title: 'СИСТЕМА',
            items: [
                { name: 'Dynamic Config' },
                { name: 'Notifications' },
                { name: 'LLM Configs' },
                { name: 'Status', chip: '●', chipColor: 'bg-success/20 text-success' },
            ],
        },
    ];
    return (_jsxs("aside", { className: "flex w-full flex-col border-b border-border bg-surface-1 lg:w-60 lg:border-b-0 lg:border-r", children: [_jsxs("div", { className: "flex items-center gap-2.5 border-b border-border px-5 py-4", children: [_jsx("span", { className: "grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-sm font-extrabold text-text-primary", children: "9" }), _jsx("span", { className: "font-display text-sm font-bold text-text-primary", children: "druz9 ADMIN" }), _jsx("span", { className: "ml-auto rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[9px] text-text-muted", children: "v3.2" })] }), _jsx("nav", { className: "flex flex-1 flex-row gap-5 overflow-x-auto px-3 py-4 lg:flex-col", children: sections.map((s) => (_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("span", { className: "px-3 font-mono text-[10px] font-semibold tracking-[0.1em] text-text-muted", children: s.title }), s.items.map((it) => (_jsxs("button", { className: `flex items-center justify-between rounded-md px-3 py-1.5 text-[13px] ${it.active
                                ? 'border-l-2 border-accent bg-accent/10 text-text-primary'
                                : 'text-text-secondary hover:bg-surface-2'}`, children: [_jsx("span", { children: it.name }), it.chip && (_jsx("span", { className: `rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold ${it.chipColor ?? 'bg-surface-3 text-text-secondary'}`, children: it.chip }))] }, it.name)))] }, s.title))) }), _jsxs("div", { className: "flex items-center gap-2.5 border-t border-border px-4 py-3", children: [_jsx(Avatar, { size: "sm", gradient: "pink-violet", initials: "A" }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx("span", { className: "text-[12px] font-semibold text-text-primary", children: "admin" }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: "root" })] })] })] }));
}
function TopBar() {
    return (_jsxs("div", { className: "flex h-auto flex-col gap-3 border-b border-border bg-bg px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-0 lg:h-14", children: [_jsxs("div", { className: "flex flex-col", children: [_jsx("h1", { className: "font-display text-lg font-bold text-text-primary", children: "Tasks" }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0437\u0430\u0434\u0430\u0447\u0430\u043C\u0438 \u0438 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u043E\u043C" })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("div", { className: "flex h-8 w-64 items-center gap-2 rounded-md border border-border bg-surface-1 px-3", children: [_jsx(Search, { className: "h-3.5 w-3.5 text-text-muted" }), _jsx("span", { className: "font-sans text-[12px] text-text-muted", children: "Search\u2026" })] }), _jsx(Button, { variant: "primary", size: "sm", icon: _jsx(Plus, { className: "h-3.5 w-3.5" }), children: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0437\u0430\u0434\u0430\u0447\u0443" })] })] }));
}
function StatsStrip() {
    const stats = [
        ['Всего', '1247', 'text-text-primary'],
        ['Активные', '1184', 'text-success'],
        ['Drafts', '47', 'text-warn'],
        ['Архив', '16', 'text-text-muted'],
    ];
    return (_jsx("div", { className: "grid grid-cols-2 gap-3 px-4 pt-4 sm:px-7 lg:flex lg:h-20 lg:grid-cols-none", children: stats.map(([k, v, c]) => (_jsxs("div", { className: "flex flex-1 flex-col rounded-lg border border-border bg-surface-1 px-4 py-2", children: [_jsx("span", { className: "font-mono text-[10px] font-semibold tracking-[0.08em] text-text-muted", children: k }), _jsx("span", { className: `font-display text-xl font-extrabold ${c}`, children: v })] }, k))) }));
}
function FiltersBar() {
    const filters = ['Раздел ▾', 'Сложность ▾', 'Статус ▾', 'Author ▾', 'Tag ▾'];
    return (_jsxs("div", { className: "flex h-auto flex-col gap-3 border-y border-border bg-surface-1 px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-0 lg:h-12", children: [_jsx("div", { className: "flex gap-2 overflow-x-auto", children: filters.map((f) => (_jsx("button", { className: "rounded-md border border-border bg-bg px-2.5 py-1 font-mono text-[11px] text-text-secondary hover:bg-surface-2", children: f }, f))) }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "\u0412\u044B\u0431\u0440\u0430\u043D\u043E: 0" }), _jsx("button", { className: "rounded-md border border-border bg-bg px-2.5 py-1 font-mono text-[11px] text-text-secondary", children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u25BE" })] })] }));
}
const tasks = [
    { id: 'tw-sum', title: 'Two Sum', slug: 'two-sum', section: 'Algorithms', diff: 'Easy', status: 'Active', tests: 15, used: '12.4k', updated: '2 ч назад' },
    { id: 'lru', title: 'LRU Cache', slug: 'lru-cache', section: 'Algorithms', diff: 'Med', status: 'Active', tests: 22, used: '8.1k', updated: '5 ч назад' },
    { id: 'med-srt', title: 'Median Sorted', slug: 'median-sorted-arrays', section: 'Algorithms', diff: 'Hard', status: 'Active', tests: 28, used: '3.4k', updated: '1 д назад' },
    { id: 'wb', title: 'Word Break', slug: 'word-break', section: 'DP', diff: 'Med', status: 'Active', tests: 18, used: '4.7k', updated: '2 д назад' },
    { id: 'trie', title: 'Trie', slug: 'trie', section: 'Trees', diff: 'Med', status: 'Draft', tests: 12, used: '0', updated: '3 д назад' },
    { id: 'bfs', title: 'Graph BFS', slug: 'graph-bfs', section: 'Graphs', diff: 'Med', status: 'Active', tests: 16, used: '2.8k', updated: '4 д назад' },
    { id: 'urls', title: 'URL Shortener', slug: 'url-shortener', section: 'System Design', diff: 'Hard', status: 'Active', tests: 10, used: '1.2k', updated: '6 д назад' },
    { id: 'star', title: 'STAR conflict', slug: 'star-conflict', section: 'Behavioral', diff: 'Easy', status: 'Active', tests: 5, used: '5.6k', updated: '7 д назад' },
    { id: 'dcache', title: 'Distributed cache', slug: 'distributed-cache', section: 'System Design', diff: 'Hard', status: 'Active', tests: 14, used: '900', updated: '10 д назад' },
];
const diffColor = {
    Easy: 'bg-success/15 text-success',
    Med: 'bg-warn/15 text-warn',
    Hard: 'bg-danger/15 text-danger',
};
const statusColor = {
    Active: 'bg-success/15 text-success',
    Draft: 'bg-warn/15 text-warn',
    Archived: 'bg-surface-3 text-text-muted',
};
function TasksTable() {
    return (_jsx("div", { className: "px-4 pb-4 sm:px-7", children: _jsx("div", { className: "overflow-x-auto rounded-lg border border-border", children: _jsxs("table", { className: "w-full min-w-[800px]", children: [_jsx("thead", { className: "bg-surface-1", children: _jsxs("tr", { className: "text-left font-mono text-[10px] font-semibold tracking-[0.08em] text-text-muted", children: [_jsx("th", { className: "w-8 px-3 py-2.5", children: _jsx("input", { type: "checkbox" }) }), _jsx("th", { className: "px-3 py-2.5", children: "ID" }), _jsx("th", { className: "px-3 py-2.5", children: "TITLE" }), _jsx("th", { className: "px-3 py-2.5", children: "SECTION" }), _jsx("th", { className: "px-3 py-2.5", children: "DIFF" }), _jsx("th", { className: "px-3 py-2.5", children: "STATUS" }), _jsx("th", { className: "px-3 py-2.5", children: "TESTS" }), _jsx("th", { className: "px-3 py-2.5", children: "USED" }), _jsx("th", { className: "px-3 py-2.5", children: "UPDATED" }), _jsx("th", { className: "w-8 px-3 py-2.5" })] }) }), _jsx("tbody", { children: tasks.map((t) => (_jsxs("tr", { className: "border-t border-border bg-bg hover:bg-surface-1", children: [_jsx("td", { className: "px-3 py-3", children: _jsx("input", { type: "checkbox" }) }), _jsx("td", { className: "px-3 py-3 font-mono text-[12px] text-text-secondary", children: t.id }), _jsx("td", { className: "px-3 py-3", children: _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "text-[13px] font-semibold text-text-primary", children: t.title }), _jsxs("span", { className: "font-mono text-[10px] text-text-muted", children: ["/", t.slug] })] }) }), _jsx("td", { className: "px-3 py-3", children: _jsx("span", { className: "rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan", children: t.section }) }), _jsx("td", { className: "px-3 py-3", children: _jsx("span", { className: `rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${diffColor[t.diff]}`, children: t.diff }) }), _jsx("td", { className: "px-3 py-3", children: _jsx("span", { className: `rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${statusColor[t.status]}`, children: t.status }) }), _jsx("td", { className: "px-3 py-3 font-mono text-[12px] text-text-secondary", children: t.tests }), _jsx("td", { className: "px-3 py-3 font-mono text-[12px] text-text-secondary", children: t.used }), _jsx("td", { className: "px-3 py-3 font-mono text-[11px] text-text-muted", children: t.updated }), _jsx("td", { className: "px-3 py-3 text-text-muted", children: _jsx(MoreHorizontal, { className: "h-4 w-4" }) })] }, t.id))) })] }) }) }));
}
function Pagination() {
    const pages = ['1', '2', '3', '...', '139'];
    return (_jsxs("div", { className: "flex flex-col items-center justify-between gap-2 border-t border-border bg-surface-1 px-4 py-3 sm:flex-row sm:px-7", children: [_jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "1-9 \u0438\u0437 1247" }), _jsx("div", { className: "flex gap-1", children: pages.map((p, i) => (_jsx("button", { className: `grid h-7 w-7 place-items-center rounded-md font-mono text-[11px] ${p === '1' ? 'bg-accent text-text-primary' : 'border border-border text-text-secondary hover:bg-surface-2'}`, children: p }, i))) })] }));
}
export default function AdminPage() {
    return (_jsxs("div", { className: "flex min-h-screen flex-col bg-bg text-text-primary lg:flex-row", children: [_jsx(Sidebar, {}), _jsxs("main", { className: "flex flex-1 flex-col", children: [_jsx(TopBar, {}), _jsx(StatsStrip, {}), _jsx(FiltersBar, {}), _jsx(TasksTable, {}), _jsx("div", { className: "flex-1" }), _jsx(Pagination, {})] })] }));
}
