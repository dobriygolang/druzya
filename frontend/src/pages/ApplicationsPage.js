import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// /applications — kanban-доска отслеживаемых вакансий пользователя.
//
// 5 колонок: saved → applied → interviewing → rejected / offer.
// V1: смена статуса через select; drag-drop оставлен на v2.
import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useSavedVacancies, useUpdateSavedStatus, useDeleteSaved, SAVED_STATUSES, } from '../lib/queries/vacancies';
const STATUS_LABEL = {
    saved: 'Сохранено',
    applied: 'Откликнулся',
    interviewing: 'Собес',
    rejected: 'Отказ',
    offer: 'Оффер',
};
const STATUS_COLOR = {
    saved: 'border-border bg-surface-2',
    applied: 'border-accent/40 bg-accent/10',
    interviewing: 'border-cyan/40 bg-cyan/10',
    rejected: 'border-danger/40 bg-danger/10',
    offer: 'border-success/40 bg-success/10',
};
export default function ApplicationsPage() {
    const list = useSavedVacancies();
    const updateStatus = useUpdateSavedStatus();
    const remove = useDeleteSaved();
    const grouped = useMemo(() => {
        const m = {
            saved: [], applied: [], interviewing: [], rejected: [], offer: [],
        };
        for (const s of list.data?.items ?? []) {
            ;
            (m[s.status] ?? m.saved).push(s);
        }
        return m;
    }, [list.data]);
    return (_jsxs(AppShellV2, { children: [_jsx("div", { className: "bg-gradient-to-br from-surface-3 to-accent", children: _jsxs("div", { className: "px-4 py-8 sm:px-8 lg:px-20", children: [_jsx("h1", { className: "font-display text-3xl font-extrabold text-text-primary sm:text-4xl", children: "\u041C\u043E\u0438 \u043E\u0442\u043A\u043B\u0438\u043A\u0438" }), _jsx("p", { className: "mt-2 text-sm text-white/85", children: "\u0412\u043E\u0440\u043E\u043D\u043A\u0430 \u043F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u043A\u0438: \u0447\u0442\u043E \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u043B \u2192 \u043A\u0443\u0434\u0430 \u043E\u0442\u043A\u043B\u0438\u043A\u043D\u0443\u043B\u0441\u044F \u2192 \u0433\u0434\u0435 \u0441\u0435\u0439\u0447\u0430\u0441 \u0441\u043E\u0431\u0435\u0441." })] }) }), _jsx("div", { className: "px-4 py-6 sm:px-8 lg:px-20", children: list.isLoading ? (_jsx("div", { className: "text-text-muted", children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430\u2026" })) : list.error ? (_jsx("div", { className: "text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C." })) : (list.data?.items.length ?? 0) === 0 ? (_jsx(Empty, {})) : (_jsx("div", { className: "grid gap-4 lg:grid-cols-5", children: SAVED_STATUSES.map((st) => (_jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("div", { className: `rounded-md border px-3 py-1.5 text-xs uppercase ${STATUS_COLOR[st]}`, children: [STATUS_LABEL[st], " \u00B7 ", grouped[st].length] }), grouped[st].map((s) => (_jsxs(Card, { variant: "elevated", padding: "md", children: [_jsx(Link, { to: `/vacancies/${s.vacancy.id}`, className: "font-display text-sm font-bold text-text-primary hover:text-accent-hover", children: s.vacancy.title }), s.vacancy.company && (_jsx("div", { className: "mt-0.5 text-xs text-text-secondary", children: s.vacancy.company })), (s.vacancy.salary_min || s.vacancy.salary_max) && (_jsxs("div", { className: "mt-1 text-xs text-success", children: [[s.vacancy.salary_min, s.vacancy.salary_max].filter(Boolean).join('–'), ' ', (s.vacancy.currency ?? 'RUR').replace('RUR', '₽').replace('RUB', '₽')] })), _jsxs("div", { className: "mt-3 flex items-center gap-2", children: [_jsx("select", { value: s.status, onChange: (e) => updateStatus.mutate({
                                                    savedId: s.id,
                                                    status: e.target.value,
                                                    notes: s.notes ?? '',
                                                }), className: "flex-1 rounded-md border border-border bg-bg px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none", children: SAVED_STATUSES.map((x) => (_jsx("option", { value: x, children: STATUS_LABEL[x] }, x))) }), _jsx("button", { type: "button", onClick: () => remove.mutate(s.id), className: "rounded-md border border-border p-1.5 text-text-muted hover:border-danger hover:text-danger", "aria-label": "\u0423\u0434\u0430\u043B\u0438\u0442\u044C", children: _jsx(Trash2, { className: "h-3.5 w-3.5" }) })] })] }, s.id)))] }, st))) })) })] }));
}
function Empty() {
    return (_jsx(Card, { padding: "lg", children: _jsxs("div", { className: "flex flex-col items-center gap-3 py-8 text-center", children: [_jsx("h2", { className: "font-display text-xl font-bold text-text-primary", children: "\u0412\u043E\u0440\u043E\u043D\u043A\u0430 \u043F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u0430\u044F" }), _jsx("p", { className: "max-w-md text-sm text-text-secondary", children: "\u0417\u0430\u0439\u0434\u0438 \u0432 \u043A\u0430\u0442\u0430\u043B\u043E\u0433 \u0432\u0430\u043A\u0430\u043D\u0441\u0438\u0439 \u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0439 \u0438\u043D\u0442\u0435\u0440\u0435\u0441\u043D\u044B\u0435 \u2014 \u043E\u043D\u0438 \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u0437\u0434\u0435\u0441\u044C \u0441 \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E\u0441\u0442\u044C\u044E \u043E\u0442\u0441\u043B\u0435\u0436\u0438\u0432\u0430\u0442\u044C \u0441\u0442\u0430\u0434\u0438\u044E." }), _jsx(Link, { to: "/vacancies", children: _jsx(Button, { children: "\u041A \u0432\u0430\u043A\u0430\u043D\u0441\u0438\u044F\u043C" }) })] }) }));
}
