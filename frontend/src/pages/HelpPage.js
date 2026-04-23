import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// /help — страница помощи и FAQ.
//
// Контент полностью статический (см. content/help.ts) — нет смысла гонять
// ручку /help в backend ради FAQ и контактов. Если в будущем появится CMS
// или dynamic articles — заменить импорт на useHelpQuery.
import { useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronUp, Circle, ExternalLink, Loader2, CheckCircle2, Send, } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useCreateSupportTicket } from '../lib/queries/support';
import { HELP_CATEGORIES, HELP_FAQ, HELP_QUICK_QUESTIONS, HELP_CONTACTS, HELP_TOTAL_ARTICLES, } from '../content/help';
export default function HelpPage() {
    const [openId, setOpenId] = useState(HELP_FAQ[0]?.id ?? '');
    const [search, setSearch] = useState('');
    // Простая клиентская фильтрация: соответствие в question/answer/tags.
    // Для статики (6 пунктов) этого хватает; полнотекстовый поиск не нужен.
    const filteredFaq = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q)
            return HELP_FAQ;
        return HELP_FAQ.filter((f) => {
            if (f.question.toLowerCase().includes(q))
                return true;
            const answerStr = typeof f.answer === 'string' ? f.answer.toLowerCase() : '';
            if (answerStr.includes(q))
                return true;
            return (f.tags ?? []).some((t) => t.toLowerCase().includes(q));
        });
    }, [search]);
    return (_jsxs(AppShellV2, { children: [_jsx("div", { className: "relative h-auto overflow-hidden bg-gradient-to-br from-surface-3 to-accent lg:h-[240px]", children: _jsxs("div", { className: "flex h-full flex-col items-center justify-center gap-4 px-4 py-8 sm:px-8 lg:py-0", children: [_jsx("h1", { className: "font-display text-3xl font-extrabold text-text-primary sm:text-4xl lg:text-[36px]", children: "\u0427\u0435\u043C \u043F\u043E\u043C\u043E\u0447\u044C?" }), _jsxs("p", { className: "text-center text-sm text-white/80", children: ["\u041F\u043E\u0438\u0441\u043A \u043F\u043E ", HELP_TOTAL_ARTICLES, " \u0441\u0442\u0430\u0442\u044C\u044F\u043C, \u0447\u0430\u0442 \u0441 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u043E\u0439 \u0438 \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u044B"] }), _jsxs("div", { className: "flex h-12 w-full max-w-[720px] items-center gap-3 rounded-xl border border-white/20 bg-bg/60 px-4 backdrop-blur", children: [_jsx(Search, { className: "h-5 w-5 shrink-0 text-text-muted" }), _jsx("input", { value: search, onChange: (e) => setSearch(e.target.value), className: "min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none", placeholder: "\u0412\u0432\u0435\u0434\u0438 \u0432\u043E\u043F\u0440\u043E\u0441 \u0438\u043B\u0438 \u043A\u043B\u044E\u0447\u0435\u0432\u043E\u0435 \u0441\u043B\u043E\u0432\u043E\u2026" }), _jsx("span", { className: "hidden font-mono text-[11px] text-text-muted sm:inline", children: "\u2318K" })] }), _jsx("div", { className: "flex flex-wrap justify-center gap-2", children: HELP_QUICK_QUESTIONS.map((c) => (_jsx("button", { type: "button", onClick: () => setSearch(c), className: "rounded-full border border-white/20 bg-bg/40 px-3 py-1 text-xs text-text-primary hover:bg-bg/60", children: c }, c))) })] }) }), _jsxs("div", { className: "flex flex-col gap-8 px-4 py-8 sm:px-8 lg:px-20 lg:py-10", children: [_jsx("div", { className: "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6", children: HELP_CATEGORIES.map((c) => (_jsxs(Card, { interactive: true, className: "flex-col items-start gap-3 p-5 cursor-pointer", children: [_jsx("span", { className: `grid h-10 w-10 place-items-center rounded-lg ${c.bg} ${c.color}`, children: c.icon }), _jsxs("div", { className: "flex min-w-0 flex-col gap-0.5", children: [_jsx("span", { className: "truncate font-display text-sm font-bold text-text-primary", children: c.label }), _jsxs("span", { className: "font-mono text-[11px] text-text-muted", children: [c.count, " \u0441\u0442\u0430\u0442\u0435\u0439"] })] })] }, c.slug))) }), _jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:gap-6", children: [_jsxs("div", { className: "flex min-w-0 flex-1 flex-col gap-3", children: [_jsxs("h2", { className: "font-display text-lg font-bold text-text-primary", children: ["\u041F\u043E\u043F\u0443\u043B\u044F\u0440\u043D\u044B\u0435 \u0432\u043E\u043F\u0440\u043E\u0441\u044B", search && (_jsxs("span", { className: "ml-2 font-mono text-xs font-medium text-text-muted", children: ["\u00B7 \u043D\u0430\u0439\u0434\u0435\u043D\u043E ", filteredFaq.length] }))] }), filteredFaq.length === 0 ? (_jsx(Card, { className: "flex-col gap-2 p-5 text-center", children: _jsxs("p", { className: "text-sm text-text-secondary", children: ["\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0448\u043B\u0438 \u043F\u043E \u0437\u0430\u043F\u0440\u043E\u0441\u0443 \u00AB", search, "\u00BB. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439 \u0434\u0440\u0443\u0433\u043E\u0439 \u043A\u043B\u044E\u0447\u0435\u0432\u043E\u0439 \u0437\u0430\u043F\u0440\u043E\u0441 \u0438\u043B\u0438 \u043D\u0430\u043F\u0438\u0448\u0438 \u0432 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u0443 \u0441\u043F\u0440\u0430\u0432\u0430."] }) })) : (filteredFaq.map((f) => {
                                        const isOpen = f.id === openId;
                                        return (_jsxs(Card, { className: "flex-col gap-3 p-5", children: [_jsxs("button", { type: "button", onClick: () => setOpenId(isOpen ? '' : f.id), className: "flex items-center justify-between gap-3 text-left", children: [_jsx("span", { className: "min-w-0 break-words font-display text-base font-semibold text-text-primary", children: f.question }), isOpen ? (_jsx(ChevronUp, { className: "h-4 w-4 shrink-0 text-text-muted" })) : (_jsx(ChevronDown, { className: "h-4 w-4 shrink-0 text-text-muted" }))] }), isOpen && (_jsxs("div", { className: "flex flex-col gap-3 border-t border-border pt-4", children: [typeof f.answer === 'string' ? (_jsx("p", { className: "break-words text-sm leading-relaxed text-text-secondary", children: f.answer })) : (f.answer), f.tags && f.tags.length > 0 && (_jsx("div", { className: "flex flex-wrap gap-2 pt-1", children: f.tags.map((t) => (_jsx("span", { className: "rounded-full bg-surface-2 px-3 py-1 text-[11px] text-text-secondary", children: t }, t))) }))] }))] }, f.id));
                                    }))] }), _jsxs("div", { className: "flex w-full flex-col gap-4 lg:w-[360px] lg:shrink-0", children: [_jsx(SupportForm, {}), _jsxs(Card, { className: "flex-col gap-3 p-5", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u0421\u0432\u044F\u0437\u0430\u0442\u044C\u0441\u044F" }), HELP_CONTACTS.map((c) => {
                                                const inner = (_jsxs(_Fragment, { children: [_jsxs("span", { className: "flex min-w-0 items-center gap-2 text-[13px] text-text-secondary", children: [_jsx("span", { className: "shrink-0", children: c.icon }), _jsx("span", { className: "truncate", children: c.label })] }), _jsx("span", { className: "ml-2 truncate font-mono text-[11px] text-text-muted", children: c.value })] }));
                                                return c.href ? (_jsx("a", { href: c.href, target: c.href.startsWith('http') ? '_blank' : undefined, rel: c.href.startsWith('http') ? 'noopener noreferrer' : undefined, className: "flex items-center justify-between gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-surface-2", children: inner }, c.kind)) : (_jsx("div", { className: "flex items-center justify-between gap-2 px-1", children: inner }, c.kind));
                                            })] }), _jsx(Link, { to: "/status", children: _jsxs(Card, { interactive: true, className: "flex-col gap-2 p-5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Circle, { className: "h-2.5 w-2.5 fill-success text-success" }), _jsx("span", { className: "font-mono text-[11px] font-bold tracking-[0.08em] text-success", children: "\u0412\u0421\u0415 \u0421\u0418\u0421\u0422\u0415\u041C\u042B \u0412 \u041F\u041E\u0420\u042F\u0414\u041A\u0415" })] }), _jsx(ExternalLink, { className: "h-3 w-3 text-text-muted" })] }), _jsx("span", { className: "text-xs text-text-muted", children: "\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0441\u0442\u0430\u0442\u0443\u0441 \u0441\u0435\u0440\u0432\u0438\u0441\u043E\u0432" })] }) })] })] })] })] }));
}
/* ── SupportForm ────────────────────────────────────────────────────────── */
// SupportForm — форма обращения в поддержку.
// POST /api/v1/support/ticket → запись в БД + alert в support-чат в Telegram.
// Ответ юзеру приходит на указанный канал (email или @druz9_bot deep-link).
function SupportForm() {
    const [contactKind, setContactKind] = useState('telegram');
    const [contactValue, setContactValue] = useState('');
    const [subject, setSubject] = useState('');
    const [message, setMessage] = useState('');
    const [validationErr, setValidationErr] = useState(null);
    const mutation = useCreateSupportTicket();
    const minMsgLen = 10;
    const maxMsgLen = 5000;
    const remaining = maxMsgLen - message.length;
    function validate() {
        const value = contactValue.trim();
        if (contactKind === 'email') {
            if (!/^\S+@\S+\.\S+$/.test(value))
                return 'Введи корректный email';
        }
        else {
            if (value.length < 2)
                return 'Введи Telegram username (@user) или телефон';
        }
        if (message.trim().length < minMsgLen) {
            return `Сообщение слишком короткое (минимум ${minMsgLen} символов)`;
        }
        if (message.length > maxMsgLen) {
            return `Сообщение слишком длинное (максимум ${maxMsgLen} символов)`;
        }
        return null;
    }
    function handleSubmit(e) {
        e.preventDefault();
        setValidationErr(null);
        const err = validate();
        if (err) {
            setValidationErr(err);
            return;
        }
        mutation.mutate({
            contact_kind: contactKind,
            contact_value: contactValue.trim(),
            subject: subject.trim() || undefined,
            message: message.trim(),
        });
    }
    // Success state — показываем подтверждение, кнопку "новое обращение".
    if (mutation.isSuccess) {
        return (_jsxs(Card, { className: "flex-col gap-3 border-success/40 bg-gradient-to-br from-success/15 to-cyan/15 p-5", children: [_jsxs("div", { className: "flex items-center gap-2 text-success", children: [_jsx(CheckCircle2, { className: "h-5 w-5" }), _jsx("span", { className: "font-display text-base font-bold", children: "\u0417\u0430\u044F\u0432\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0430" })] }), _jsxs("p", { className: "text-xs text-text-secondary", children: ["\u041D\u043E\u043C\u0435\u0440 \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u044F: ", _jsx("code", { className: "font-mono", children: mutation.data.ticket_id.slice(0, 8) }), ". \u041E\u0442\u0432\u0435\u0442 \u043F\u0440\u0438\u0434\u0451\u0442 \u043D\u0430 \u0442\u0432\u043E\u0439 ", contactKind === 'email' ? 'email' : 'Telegram', " \u0432 \u0442\u0435\u0447\u0435\u043D\u0438\u0435 1\u20132 \u0447\u0430\u0441\u043E\u0432 \u0432 \u0440\u0430\u0431\u043E\u0447\u0435\u0435 \u0432\u0440\u0435\u043C\u044F."] }), _jsx(Button, { variant: "ghost", className: "self-start", onClick: () => {
                        mutation.reset();
                        setMessage('');
                        setSubject('');
                        setValidationErr(null);
                    }, children: "\u041D\u043E\u0432\u043E\u0435 \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0435" })] }));
    }
    const apiErr = mutation.isError
        ? (mutation.error instanceof Error ? mutation.error.message : 'Не удалось отправить')
        : null;
    return (_jsxs(Card, { className: "flex-col gap-3 border-accent/40 bg-gradient-to-br from-accent to-pink p-5 shadow-glow", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "h-2 w-2 rounded-full bg-success ring-2 ring-success/30" }), _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-primary", children: "\u041E\u041D\u041B\u0410\u0419\u041D" })] }), _jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: "\u041D\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0432 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u0443" }), _jsx("p", { className: "text-xs text-white/80", children: "\u0421\u0440\u0435\u0434\u043D\u0435\u0435 \u0432\u0440\u0435\u043C\u044F \u043E\u0442\u0432\u0435\u0442\u0430 \u2014 1\u20132 \u0447\u0430\u0441\u0430 \u0432 \u0440\u0430\u0431\u043E\u0447\u0435\u0435 \u0432\u0440\u0435\u043C\u044F" }), _jsxs("form", { onSubmit: handleSubmit, className: "flex flex-col gap-3", children: [_jsxs("div", { className: "flex gap-2", children: [_jsx("button", { type: "button", onClick: () => setContactKind('telegram'), className: `flex-1 rounded-md border px-2 py-1.5 text-[12px] transition ${contactKind === 'telegram'
                                    ? 'border-white/60 bg-white/15 text-text-primary'
                                    : 'border-white/20 text-white/70 hover:bg-white/5'}`, children: "Telegram" }), _jsx("button", { type: "button", onClick: () => setContactKind('email'), className: `flex-1 rounded-md border px-2 py-1.5 text-[12px] transition ${contactKind === 'email'
                                    ? 'border-white/60 bg-white/15 text-text-primary'
                                    : 'border-white/20 text-white/70 hover:bg-white/5'}`, children: "Email" })] }), _jsx("input", { value: contactValue, onChange: (e) => setContactValue(e.target.value), placeholder: contactKind === 'telegram' ? '@username' : 'you@example.com', className: "rounded-md border border-white/30 bg-bg/60 px-3 py-2 text-[13px] text-text-primary placeholder:text-white/50 focus:border-white focus:outline-none", required: true }), _jsx("input", { value: subject, onChange: (e) => setSubject(e.target.value), placeholder: "\u0422\u0435\u043C\u0430 (\u043D\u0435\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E)", maxLength: 200, className: "rounded-md border border-white/30 bg-bg/60 px-3 py-2 text-[13px] text-text-primary placeholder:text-white/50 focus:border-white focus:outline-none" }), _jsxs("div", { children: [_jsx("textarea", { value: message, onChange: (e) => setMessage(e.target.value), placeholder: "\u041E\u043F\u0438\u0448\u0438 \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u0443: \u0447\u0442\u043E \u043F\u0440\u043E\u0438\u0437\u043E\u0448\u043B\u043E, \u0447\u0442\u043E \u043E\u0436\u0438\u0434\u0430\u043B, \u043A\u0430\u043A\u0438\u0435 \u0448\u0430\u0433\u0438 \u043F\u0440\u0438\u0432\u0435\u043B\u0438 \u043A \u0431\u0430\u0433\u0443", rows: 4, maxLength: maxMsgLen, className: "w-full resize-y rounded-md border border-white/30 bg-bg/60 px-3 py-2 text-[13px] text-text-primary placeholder:text-white/50 focus:border-white focus:outline-none", required: true }), _jsx("div", { className: "mt-1 flex justify-end text-[10px] text-white/60", children: remaining < 200 ? `${remaining} символов` : '' })] }), (validationErr || apiErr) && (_jsx("div", { className: "rounded-md border border-red-300/40 bg-red-500/15 px-3 py-2 text-[12px] text-red-100", children: validationErr ?? apiErr })), _jsx(Button, { variant: "primary", type: "submit", disabled: mutation.isPending, className: "bg-white text-bg shadow-none hover:bg-white/90", icon: mutation.isPending ? _jsx(Loader2, { className: "h-4 w-4 animate-spin" }) : _jsx(Send, { className: "h-4 w-4" }), children: mutation.isPending ? 'Отправляем…' : 'Отправить' })] })] }));
}
