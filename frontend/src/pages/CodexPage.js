import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// /codex — каталог статей-знаний (System Design, алгоритмы, карьера...).
//
// Это контент-страница, не runtime: каталог хранится в src/content/codex.ts
// и попадает в bundle на build. Никакого backend-запроса здесь не делаем —
// раньше был placeholder с фейковыми "12480 прослушиваний" и хардкоженным
// плеером; то и другое снято, потому что подкастов как продукта пока нет.
// Когда заведём собственный CMS или blog — заменить импорт CODEX_ARTICLES
// на useQuery (см. content/codex.ts header).
import { useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Card } from '../components/Card';
import { CODEX_ARTICLES, CODEX_TOTAL, codexCategoriesWithCounts, } from '../content/codex';
const ALL = 'all';
function Hero() {
    return (_jsxs("section", { className: "flex flex-col items-start justify-center gap-3 px-4 py-8 sm:px-8 lg:px-20", style: {
            background: 'linear-gradient(180deg, #2D1B4D 0%, #0A0A0F 100%)',
        }, children: [_jsx("span", { className: "inline-flex items-center gap-1.5 rounded-full bg-pink/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-pink", children: "CODEX \u00B7 \u0411\u0418\u0411\u041B\u0418\u041E\u0422\u0415\u041A\u0410 \u0417\u041D\u0410\u041D\u0418\u0419" }), _jsx("h1", { className: "font-display text-3xl font-bold leading-[1.1] text-text-primary lg:text-[36px]", children: "\u0427\u0442\u043E \u043F\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u043A \u0441\u043E\u0431\u0435\u0441\u0443" }), _jsxs("p", { className: "max-w-[640px] text-[15px] text-text-secondary", children: [CODEX_TOTAL, " \u0441\u0442\u0430\u0442\u0435\u0439 \u0438 \u0440\u0435\u0444\u0435\u0440\u0435\u043D\u0441\u043E\u0432 \u043F\u0440\u043E System Design, \u0430\u043B\u0433\u043E\u0440\u0438\u0442\u043C\u044B, SQL, Go \u0438 \u043F\u043E\u0432\u0435\u0434\u0435\u043D\u0447\u0435\u0441\u043A\u0438\u0435 \u0438\u043D\u0442\u0435\u0440\u0432\u044C\u044E. \u0412\u0441\u0435 \u0441\u0441\u044B\u043B\u043A\u0438 \u2014 \u043D\u0430 \u0441\u0442\u0430\u0431\u0438\u043B\u044C\u043D\u044B\u0435 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u0435 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0438: Wikipedia, MDN, RFC, \u043E\u0444\u0438\u0446\u0438\u0430\u043B\u044C\u043D\u044B\u0435 \u0434\u043E\u043A\u0438."] })] }));
}
function CategoryFilters({ active, onChange, }) {
    const cats = codexCategoriesWithCounts();
    return (_jsxs("div", { className: "flex flex-wrap items-center gap-2 px-4 py-5 sm:px-8 lg:px-20", children: [_jsxs("button", { type: "button", onClick: () => onChange(ALL), className: active === ALL
                    ? 'inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-1.5 text-[13px] font-semibold text-text-primary'
                    : 'inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3.5 py-1.5 text-[13px] text-text-secondary hover:border-border-strong hover:text-text-primary', children: ["\u0412\u0441\u0435 ", _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: CODEX_TOTAL })] }), cats.map((c) => (_jsxs("button", { type: "button", onClick: () => onChange(c.slug), className: active === c.slug
                    ? 'inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-1.5 text-[13px] font-semibold text-text-primary'
                    : 'inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3.5 py-1.5 text-[13px] text-text-secondary hover:border-border-strong hover:text-text-primary', children: [c.label, " ", _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: c.count })] }, c.slug)))] }));
}
function SearchBox({ value, onChange }) {
    return (_jsxs("div", { className: "flex w-full max-w-md items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2", children: [_jsx(Search, { className: "h-4 w-4 text-text-muted" }), _jsx("input", { value: value, onChange: (e) => onChange(e.target.value), placeholder: "\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043A\u0443 \u0438\u043B\u0438 \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u044E...", className: "w-full bg-transparent text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none" })] }));
}
function ArticleCard({ a }) {
    return (_jsx("a", { href: a.href, target: "_blank", rel: "noopener noreferrer", className: "block", children: _jsxs(Card, { interactive: true, className: "flex-col gap-2 p-5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted", children: a.category.replace('_', ' ') }), _jsx(ArrowUpRight, { className: "h-3.5 w-3.5 text-text-muted group-hover:text-text-primary" })] }), _jsx("h4", { className: "font-sans text-[15px] font-bold leading-tight text-text-primary", children: a.title }), _jsx("p", { className: "text-[13px] leading-snug text-text-secondary", children: a.description }), _jsxs("div", { className: "mt-auto flex items-center justify-between pt-2", children: [_jsx("span", { className: "font-mono text-[11px] text-text-muted", children: a.source }), _jsxs("span", { className: "font-mono text-[11px] text-text-muted", children: [a.read_min, " \u043C\u0438\u043D"] })] })] }) }));
}
export default function CodexPage() {
    const [category, setCategory] = useState(ALL);
    const [q, setQ] = useState('');
    const norm = q.trim().toLowerCase();
    const visible = CODEX_ARTICLES.filter((a) => {
        if (category !== ALL && a.category !== category)
            return false;
        if (norm.length === 0)
            return true;
        return (a.title.toLowerCase().includes(norm) ||
            a.description.toLowerCase().includes(norm));
    });
    return (_jsxs(AppShellV2, { children: [_jsx(Hero, {}), _jsx(CategoryFilters, { active: category, onChange: setCategory }), _jsx("div", { className: "px-4 pb-4 sm:px-8 lg:px-20", children: _jsx(SearchBox, { value: q, onChange: setQ }) }), _jsx("div", { className: "px-4 pb-12 sm:px-8 lg:px-20", children: visible.length === 0 ? (_jsxs(Card, { className: "flex-col gap-1 p-8 text-center", children: [_jsx("span", { className: "font-display text-base font-bold text-text-primary", children: "\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0448\u043B\u043E\u0441\u044C" }), _jsx("span", { className: "text-sm text-text-secondary", children: "\u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439 \u0443\u0431\u0440\u0430\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438 \u0438\u043B\u0438 \u043F\u043E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u043F\u043E\u0438\u0441\u043A." })] })) : (_jsx("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3", children: visible.map((a) => (_jsx(ArticleCard, { a: a }, a.id))) })) })] }));
}
