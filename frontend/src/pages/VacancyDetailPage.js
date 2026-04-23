import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// /vacancies/:id — детальный экран одной вакансии.
//
// Layout:
//   - Hero с title/company/source/salary.
//   - Колонка "Требования" (description) + skill-gap visualisation.
//   - CTA «Подготовиться» — открывает drawer с рекомендованными dailyKata
//     для missing skills (v1 — заглушка, fields для интеграции с daily).
//   - Sticky-CTA «Сохранить» / «Откликнулся».
import { useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Bookmark, ExternalLink, Sparkles, X } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useVacancy, useSaveVacancy, diffSkills, } from '../lib/queries/vacancies';
function formatSalary(min, max, currency) {
    if (!min && !max)
        return '';
    const cur = (currency ?? 'RUR').replace('RUR', '₽').replace('RUB', '₽');
    const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n);
    if (min && max && min !== max)
        return `${fmt(min)}–${fmt(max)} ${cur}`;
    return `от ${fmt(min ?? max ?? 0)} ${cur}`;
}
export default function VacancyDetailPage() {
    const params = useParams();
    const id = params.id ? Number(params.id) : undefined;
    const v = useVacancy(id);
    const save = useSaveVacancy();
    const navigate = useNavigate();
    const [drawerOpen, setDrawerOpen] = useState(false);
    // Покажем skill-gap. userSkills для now пуст (см. VacanciesPage комментарий).
    // Оба массива стабилизируем через useMemo, иначе deps useMemo ниже
    // меняются на каждый рендер и хук бесполезен.
    const userSkills = useMemo(() => [], []);
    const required = useMemo(() => v.data?.normalized_skills ?? [], [v.data?.normalized_skills]);
    const { matched, missing } = useMemo(() => diffSkills(required, userSkills), [required, userSkills]);
    if (v.isLoading) {
        return _jsx(AppShellV2, { children: _jsx("div", { className: "p-8 text-text-muted", children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430\u2026" }) });
    }
    if (v.error || !v.data) {
        return (_jsx(AppShellV2, { children: _jsxs("div", { className: "p-8", children: [_jsx("div", { className: "text-sm text-danger", children: "\u0412\u0430\u043A\u0430\u043D\u0441\u0438\u044F \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430." }), _jsx(Link, { to: "/vacancies", className: "mt-3 inline-block text-sm text-accent hover:underline", children: "\u2190 \u041A \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0443" })] }) }));
    }
    const vac = v.data;
    const onSave = () => {
        save.mutate({ vacancyId: vac.id }, {
            onSuccess: () => navigate('/applications'),
            onError: (err) => {
                if (err instanceof Error && err.message.includes('401')) {
                    navigate('/welcome');
                }
            },
        });
    };
    return (_jsxs(AppShellV2, { children: [_jsx("div", { className: "bg-gradient-to-br from-surface-3 to-accent", children: _jsxs("div", { className: "px-4 py-8 sm:px-8 lg:px-20", children: [_jsx(Link, { to: "/vacancies", className: "text-xs text-white/70 hover:text-white", children: "\u2190 \u041A \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0443 \u0432\u0430\u043A\u0430\u043D\u0441\u0438\u0439" }), _jsx("h1", { className: "mt-2 font-display text-3xl font-extrabold text-text-primary sm:text-4xl", children: vac.title }), _jsxs("div", { className: "mt-2 flex flex-wrap items-center gap-3 text-sm text-white/85", children: [vac.company && _jsx("span", { children: vac.company }), vac.location && _jsxs("span", { children: ["\u00B7 ", vac.location] }), vac.experience_level && _jsxs("span", { children: ["\u00B7 ", vac.experience_level] })] }), (vac.salary_min || vac.salary_max) && (_jsx("div", { className: "mt-2 font-mono text-base text-success", children: formatSalary(vac.salary_min, vac.salary_max, vac.currency) })), _jsxs("div", { className: "mt-4 flex flex-wrap gap-2", children: [_jsx(Button, { onClick: onSave, loading: save.isPending, icon: _jsx(Bookmark, { className: "h-4 w-4" }), children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C" }), _jsx("a", { href: vac.url, target: "_blank", rel: "noopener noreferrer", children: _jsxs(Button, { variant: "ghost", icon: _jsx(ExternalLink, { className: "h-4 w-4" }), children: ["\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043D\u0430 ", vac.source.toUpperCase()] }) }), _jsx(Button, { variant: "ghost", icon: _jsx(Sparkles, { className: "h-4 w-4" }), onClick: () => setDrawerOpen(true), children: "\u041F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u0438\u0442\u044C\u0441\u044F" })] })] }) }), _jsxs("div", { className: "grid grid-cols-1 gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[1fr_320px] lg:px-20", children: [_jsxs(Card, { padding: "lg", children: [_jsx("h2", { className: "mb-3 font-display text-base font-semibold text-text-primary", children: "\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435" }), _jsx("p", { className: "whitespace-pre-line text-sm text-text-secondary", children: vac.description || 'Нет описания.' })] }), _jsx("div", { className: "flex flex-col gap-4", children: _jsxs(Card, { padding: "lg", children: [_jsx("h2", { className: "mb-3 font-display text-sm font-semibold text-text-primary", children: "Skill-gap" }), required.length === 0 ? (_jsx("div", { className: "text-xs text-text-muted", children: "\u0421\u043A\u0438\u043B\u043B\u044B \u0435\u0449\u0451 \u043D\u0435 \u0438\u0437\u0432\u043B\u0435\u0447\u0435\u043D\u044B." })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "mb-3", children: [_jsx("div", { className: "text-[10px] uppercase text-text-muted", children: "\u0421\u043E\u0432\u043F\u0430\u043B\u043E" }), _jsxs("div", { className: "mt-1 flex flex-wrap gap-1.5", children: [required.filter((s) => matched.has(s.toLowerCase())).map((s) => (_jsx(Chip, { text: s, kind: "matched" }, s))), matched.size === 0 && (_jsx("span", { className: "text-xs text-text-muted", children: "\u2014" }))] })] }), _jsxs("div", { children: [_jsx("div", { className: "text-[10px] uppercase text-text-muted", children: "\u041D\u0435 \u0445\u0432\u0430\u0442\u0430\u0435\u0442" }), _jsxs("div", { className: "mt-1 flex flex-wrap gap-1.5", children: [required.filter((s) => missing.has(s.toLowerCase())).map((s) => (_jsx(Chip, { text: s, kind: "gap" }, s))), missing.size === 0 && (_jsx("span", { className: "text-xs text-text-muted", children: "\u2014" }))] })] })] }))] }) })] }), drawerOpen && (_jsx(PrepDrawer, { onClose: () => setDrawerOpen(false), missing: Array.from(missing) }))] }));
}
function Chip({ text, kind }) {
    const cls = kind === 'matched'
        ? 'border-success/40 bg-success/10 text-success'
        : 'border-warning/40 bg-warning/10 text-warning';
    return (_jsx("span", { className: `rounded-full border px-2 py-0.5 text-[11px] ${cls}`, children: text }));
}
function PrepDrawer({ onClose, missing }) {
    return (_jsxs("div", { className: "fixed inset-0 z-50 flex items-end justify-end", children: [_jsx("div", { className: "absolute inset-0 bg-black/40", onClick: onClose, role: "button", tabIndex: -1, "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C" }), _jsxs("div", { className: "relative h-full w-full max-w-[420px] overflow-y-auto bg-surface-1 shadow-card", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border p-4", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u041F\u043B\u0430\u043D \u043F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u043A\u0438" }), _jsx("button", { type: "button", onClick: onClose, className: "rounded-md p-1.5 text-text-secondary hover:bg-surface-2", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { className: "h-4 w-4" }) })] }), _jsx("div", { className: "flex flex-col gap-3 p-4", children: missing.length === 0 ? (_jsx("div", { className: "text-sm text-text-secondary", children: "\u0412\u0441\u0435 \u0442\u0440\u0435\u0431\u043E\u0432\u0430\u043D\u0438\u044F \u0443\u0436\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u044B. \u041C\u043E\u0436\u043D\u043E \u0441\u0440\u0430\u0437\u0443 \u043E\u0442\u043A\u043B\u0438\u043A\u0430\u0442\u044C\u0441\u044F!" })) : (_jsxs(_Fragment, { children: [_jsx("p", { className: "text-sm text-text-secondary", children: "\u0420\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0443\u0435\u043C \u0435\u0436\u0435\u0434\u043D\u0435\u0432\u043D\u044B\u0435 \u043A\u0430\u0442\u0430 \u043D\u0430 \u044D\u0442\u0438 \u0442\u0435\u0445\u043D\u043E\u043B\u043E\u0433\u0438\u0438:" }), _jsx("ul", { className: "flex flex-col gap-2", children: missing.map((s) => (_jsx("li", { children: _jsxs(Link, { to: `/daily?skill=${encodeURIComponent(s)}`, className: "flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary hover:border-border-strong", children: [_jsx("span", { className: "font-mono", children: s }), _jsx("span", { className: "text-xs text-accent-hover", children: "\u041A\u0430\u0442\u0430 \u2192" })] }) }, s))) })] })) })] })] }));
}
