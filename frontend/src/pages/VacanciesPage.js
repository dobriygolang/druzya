import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// /vacancies — каталог реальных вакансий с российских площадок
// (HH, Yandex, Ozon, T-Bank, VK, Sber, Avito, …).
//
// Источник правды — backend services/vacancies. Read-path public, save/track
// требует логина (фронт показывает CTA "Войти, чтобы сохранить" если 401).
//
// Структура:
//   - Hero: заголовок, поле «вставь ссылку → /analyze».
//   - Sidebar: фильтры (источник, скиллы, salary, location).
//   - Grid: карточки с title/company/salary/skill diff vs profile.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Briefcase, MapPin, Wallet, Sparkles, Bookmark } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useVacanciesList, useAnalyzeVacancy, useSaveVacancy, VACANCY_SOURCES, diffSkills, } from '../lib/queries/vacancies';
import { useProfileQuery } from '../lib/queries/profile';
function formatSalary(min, max, currency) {
    if (!min && !max)
        return '';
    const cur = (currency ?? 'RUR').replace('RUR', '₽').replace('RUB', '₽');
    const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n);
    if (min && max && min !== max)
        return `${fmt(min)}–${fmt(max)} ${cur}`;
    return `от ${fmt(min ?? max ?? 0)} ${cur}`;
}
function SourceBadge({ source }) {
    const labels = {
        hh: 'HH', yandex: 'Yandex', ozon: 'Ozon', tinkoff: 'T-Bank', vk: 'VK',
        sber: 'Sber', avito: 'Avito', wildberries: 'WB', mts: 'MTS',
        kaspersky: 'Kaspersky', jetbrains: 'JetBrains', lamoda: 'Lamoda',
    };
    return (_jsx("span", { className: "rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase text-text-secondary", children: labels[source] }));
}
function SkillChip({ s, state }) {
    const cls = state === 'matched' ? 'border-success/40 bg-success/10 text-success' :
        state === 'gap' ? 'border-warning/40 bg-warning/10 text-warning' :
            'border-border bg-surface-2 text-text-secondary';
    return (_jsx("span", { className: `rounded-full border px-2 py-0.5 text-[11px] ${cls}`, children: s }));
}
function VacancyCard({ v, userSkills, onSave, }) {
    const top = v.normalized_skills.slice(0, 5);
    const { matched, missing } = diffSkills(top, userSkills);
    return (_jsxs(Card, { variant: "elevated", interactive: true, padding: "lg", children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "flex min-w-0 flex-col gap-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(SourceBadge, { source: v.source }), v.experience_level && (_jsx("span", { className: "font-mono text-[10px] uppercase text-text-muted", children: v.experience_level }))] }), _jsx(Link, { to: `/vacancies/${v.id}`, className: "font-display text-base font-bold text-text-primary hover:text-accent-hover", children: v.title }), v.company && (_jsxs("div", { className: "flex items-center gap-1 text-xs text-text-secondary", children: [_jsx(Briefcase, { className: "h-3 w-3" }), " ", v.company] })), v.location && (_jsxs("div", { className: "flex items-center gap-1 text-xs text-text-muted", children: [_jsx(MapPin, { className: "h-3 w-3" }), " ", v.location] }))] }), onSave && (_jsx(Button, { size: "sm", variant: "ghost", icon: _jsx(Bookmark, { className: "h-4 w-4" }), onClick: () => onSave(v.id), children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C" }))] }), (v.salary_min || v.salary_max) && (_jsxs("div", { className: "mt-3 flex items-center gap-1 text-sm text-success", children: [_jsx(Wallet, { className: "h-4 w-4" }), formatSalary(v.salary_min, v.salary_max, v.currency)] })), top.length > 0 && (_jsx("div", { className: "mt-3 flex flex-wrap gap-1.5", children: top.map((s) => (_jsx(SkillChip, { s: s, state: matched.has(s.toLowerCase()) ? 'matched' : missing.has(s.toLowerCase()) ? 'gap' : 'extra' }, s))) }))] }));
}
function FilterSidebar({ sources, setSources, salaryMin, setSalaryMin, location, setLocation, }) {
    const toggle = (s) => {
        if (sources.includes(s))
            setSources(sources.filter((x) => x !== s));
        else
            setSources([...sources, s]);
    };
    return (_jsxs(Card, { variant: "default", padding: "md", className: "self-start", children: [_jsx("h3", { className: "mb-3 font-display text-sm font-semibold text-text-primary", children: "\u0424\u0438\u043B\u044C\u0442\u0440\u044B" }), _jsxs("div", { className: "mb-4", children: [_jsx("div", { className: "mb-2 text-xs uppercase text-text-muted", children: "\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0438" }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: VACANCY_SOURCES.map((s) => (_jsx("button", { type: "button", onClick: () => toggle(s), className: `rounded-full border px-2.5 py-1 text-[11px] uppercase transition-colors ${sources.includes(s)
                                ? 'border-accent bg-accent/15 text-text-primary'
                                : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong'}`, children: s }, s))) })] }), _jsxs("div", { className: "mb-4", children: [_jsx("label", { className: "mb-1 block text-xs uppercase text-text-muted", htmlFor: "salaryMin", children: "\u0417\u0430\u0440\u043F\u043B\u0430\u0442\u0430 \u043E\u0442, \u20BD" }), _jsx("input", { id: "salaryMin", type: "number", value: salaryMin || '', onChange: (e) => setSalaryMin(Number(e.target.value) || 0), placeholder: "0", className: "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" })] }), _jsxs("div", { children: [_jsx("label", { className: "mb-1 block text-xs uppercase text-text-muted", htmlFor: "location", children: "\u0413\u043E\u0440\u043E\u0434" }), _jsx("input", { id: "location", type: "text", value: location, onChange: (e) => setLocation(e.target.value), placeholder: "\u041C\u043E\u0441\u043A\u0432\u0430", className: "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" })] })] }));
}
export default function VacanciesPage() {
    const [sources, setSources] = useState([]);
    const [salaryMin, setSalaryMin] = useState(0);
    const [location, setLocation] = useState('');
    const [page, setPage] = useState(1);
    const list = useVacanciesList({
        sources,
        salary_min: salaryMin || undefined,
        location: location || undefined,
        page,
        limit: 30,
    });
    const profile = useProfileQuery();
    const userSkills = useMemo(() => {
        const b = profile.data ?? {};
        return (b.skill_nodes ?? []).map((n) => n.node_key ?? '').filter(Boolean);
    }, [profile.data]);
    const navigate = useNavigate();
    const save = useSaveVacancy();
    const handleSave = (id) => {
        save.mutate({ vacancyId: id }, {
            onError: (err) => {
                if (err instanceof Error && err.message.includes('401')) {
                    navigate('/welcome');
                }
            },
        });
    };
    return (_jsxs(AppShellV2, { children: [_jsx(Hero, {}), _jsxs("div", { className: "grid grid-cols-1 gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[280px_1fr] lg:px-20", children: [_jsx(FilterSidebar, { sources: sources, setSources: setSources, salaryMin: salaryMin, setSalaryMin: setSalaryMin, location: location, setLocation: setLocation }), _jsx("div", { className: "flex flex-col gap-4", children: list.isLoading ? (_jsx(ListSkeleton, {})) : list.error ? (_jsx(ErrorState, {})) : (list.data?.items.length ?? 0) === 0 ? (_jsx(EmptyState, {})) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "text-xs uppercase text-text-muted", children: [list.data?.total, " \u0432\u0430\u043A\u0430\u043D\u0441\u0438\u0439 \u00B7 \u0441\u0442\u0440. ", page] }), _jsx("div", { className: "grid gap-3 sm:grid-cols-2", children: list.data?.items.map((v) => (_jsx(VacancyCard, { v: v, userSkills: userSkills, onSave: handleSave }, v.id))) }), _jsx(Pagination, { page: page, total: list.data?.total ?? 0, limit: list.data?.limit ?? 30, onChange: setPage })] })) })] })] }));
}
function Hero() {
    const [url, setUrl] = useState('');
    const analyze = useAnalyzeVacancy();
    const navigate = useNavigate();
    const submit = (e) => {
        e.preventDefault();
        if (!url.trim())
            return;
        analyze.mutate({ url }, {
            onSuccess: (res) => {
                navigate(`/vacancies/${res.vacancy.id}`);
            },
        });
    };
    return (_jsx("div", { className: "relative h-auto overflow-hidden bg-gradient-to-br from-surface-3 to-accent lg:h-[240px]", children: _jsxs("div", { className: "flex h-full flex-col items-center justify-center gap-4 px-4 py-8 sm:px-8 lg:py-0", children: [_jsx("h1", { className: "font-display text-3xl font-extrabold text-text-primary sm:text-4xl", children: "\u0412\u0430\u043A\u0430\u043D\u0441\u0438\u0438 \u0434\u043B\u044F \u043F\u0440\u043E\u043A\u0430\u0447\u043A\u0438" }), _jsx("p", { className: "text-center text-sm text-white/80", children: "HH, Yandex, Ozon, T-Bank, VK\u2026 \u041E\u0434\u0438\u043D Ctrl+V \u2014 \u043C\u044B \u0432\u044B\u0442\u0430\u0449\u0438\u043C \u0441\u0442\u0435\u043A \u0438 \u0441\u0440\u0430\u0432\u043D\u0438\u043C \u0441 \u0442\u0432\u043E\u0438\u043C \u043F\u0440\u043E\u0444\u0438\u043B\u0435\u043C." }), _jsxs("form", { onSubmit: submit, className: "flex h-12 w-full max-w-[720px] items-center gap-3 rounded-xl border border-white/20 bg-bg/60 px-4 backdrop-blur", children: [_jsx(Search, { className: "h-5 w-5 shrink-0 text-text-muted" }), _jsx("input", { value: url, onChange: (e) => setUrl(e.target.value), placeholder: "\u0412\u0441\u0442\u0430\u0432\u044C \u0441\u0441\u044B\u043B\u043A\u0443 \u043D\u0430 \u0432\u0430\u043A\u0430\u043D\u0441\u0438\u044E (hh.ru/yandex/ozon\u2026)", className: "min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none" }), _jsx(Button, { type: "submit", size: "sm", loading: analyze.isPending, icon: _jsx(Sparkles, { className: "h-4 w-4" }), children: "\u0420\u0430\u0437\u043E\u0431\u0440\u0430\u0442\u044C" })] }), analyze.error && (_jsx("div", { className: "text-xs text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0440\u0430\u0437\u043E\u0431\u0440\u0430\u0442\u044C \u0441\u0441\u044B\u043B\u043A\u0443" }))] }) }));
}
function Pagination({ page, total, limit, onChange, }) {
    const pages = Math.max(1, Math.ceil(total / limit));
    if (pages <= 1)
        return null;
    return (_jsxs("div", { className: "flex items-center justify-center gap-2 py-4", children: [_jsx(Button, { size: "sm", variant: "ghost", disabled: page <= 1, onClick: () => onChange(page - 1), children: "\u041D\u0430\u0437\u0430\u0434" }), _jsxs("span", { className: "font-mono text-sm text-text-secondary", children: [page, " / ", pages] }), _jsx(Button, { size: "sm", variant: "ghost", disabled: page >= pages, onClick: () => onChange(page + 1), children: "\u0412\u043F\u0435\u0440\u0451\u0434" })] }));
}
function ListSkeleton() {
    return (_jsx("div", { className: "grid gap-3 sm:grid-cols-2", children: Array.from({ length: 6 }).map((_, i) => (_jsx("div", { className: "h-40 animate-pulse rounded-xl border border-border bg-surface-1" }, i))) }));
}
function EmptyState() {
    return (_jsx(Card, { padding: "lg", children: _jsx("div", { className: "text-sm text-text-secondary", children: "\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E. \u0421\u0431\u0440\u043E\u0441\u044C \u0444\u0438\u043B\u044C\u0442\u0440\u044B \u0438\u043B\u0438 \u043F\u043E\u0434\u043E\u0436\u0434\u0438 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0443\u044E \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044E (\u0440\u0430\u0437 \u0432 \u0447\u0430\u0441)." }) }));
}
function ErrorState() {
    return (_jsx(Card, { padding: "lg", children: _jsx("div", { className: "text-sm text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0432\u0430\u043A\u0430\u043D\u0441\u0438\u0438." }) }));
}
