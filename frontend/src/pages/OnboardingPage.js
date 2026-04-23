import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Check, MousePointerClick, Play, CircleCheck, Bot, Sparkles, Lock, Clock, MessageSquare, } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { cn } from '../lib/cn';
import { useLanguages } from '../lib/api/languages';
import { useOnboardingPreviewKata } from '../lib/api/onboarding';
function useStepLabels() {
    const { t } = useTranslation('onboarding');
    // Подмапим старые i18n-ключи: old step 2 → new 1, old 3 → 2, old 4 → 3.
    return {
        1: t('step_labels.2'),
        2: t('step_labels.3'),
        3: t('step_labels.4'),
    };
}
// Ключ access-токена в localStorage (тот же, что читает /lib/apiClient.ts).
const ACCESS_TOKEN_KEY = 'druz9_access_token';
function Logo() {
    return (_jsxs(Link, { to: "/welcome", className: "flex items-center gap-2.5", children: [_jsx("span", { className: "grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-lg font-extrabold text-text-primary", children: "9" }), _jsx("span", { className: "font-display text-lg font-bold text-text-primary", children: "druz9" })] }));
}
function StepIndicator({ current, allDone = false }) {
    const STEP_LABELS = useStepLabels();
    const steps = [1, 2, 3];
    return (_jsx("div", { className: "flex items-center gap-2", children: steps.map((s, idx) => {
            const completed = allDone || s < current;
            const isCurrent = !allDone && s === current;
            return (_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: cn('grid place-items-center rounded-full text-[13px]', completed
                                    ? 'bg-success text-bg'
                                    : isCurrent
                                        ? 'bg-accent text-text-primary shadow-glow'
                                        : 'border border-border-strong text-text-muted'), style: { width: 28, height: 28 }, children: completed ? (_jsx(Check, { className: "h-4 w-4", strokeWidth: 3 })) : (_jsx("span", { className: "font-display font-bold leading-none", children: s })) }), _jsx("span", { className: cn('text-[12px]', isCurrent ? 'font-semibold text-text-primary' : 'font-medium text-text-muted'), children: STEP_LABELS[s] })] }), idx < steps.length - 1 && (_jsx("span", { className: cn('block', completed ? 'bg-success' : 'bg-border-strong'), style: { width: 32, height: 2 } }))] }, s));
        }) }));
}
export function OnboardingTopBar({ current, allDone = false, showSkip = true, }) {
    const { t } = useTranslation('onboarding');
    return (_jsxs("header", { className: "flex h-[72px] items-center justify-between border-b border-border bg-bg px-4 sm:px-8 lg:px-20", children: [_jsx(Logo, {}), _jsx("div", { className: "hidden md:block", children: _jsx(StepIndicator, { current: current, allDone: allDone }) }), showSkip ? (_jsx(Link, { to: "/onboarding/done", className: "text-sm font-medium text-text-muted hover:text-text-secondary", children: t('skip') })) : (_jsx("span", { style: { width: 80 } }))] }));
}
function Step2Stack({ onNext, onBack }) {
    const { t } = useTranslation('onboarding');
    const langsQ = useLanguages();
    const langs = langsQ.data?.items ?? [];
    const [selected, setSelected] = useState(['Go', 'Python']);
    const toggle = (n) => {
        setSelected((cur) => cur.includes(n) ? cur.filter((x) => x !== n) : cur.length >= 3 ? cur : [...cur, n]);
    };
    return (_jsxs("div", { className: "flex flex-col items-center gap-6 px-4 py-8 sm:px-8 lg:px-20 lg:py-10", children: [_jsx("h1", { className: "text-center font-display text-3xl font-extrabold text-text-primary sm:text-4xl lg:text-[44px]", style: { lineHeight: 1.1 }, children: t('step2.title') }), _jsx("p", { className: "max-w-[560px] text-center text-[15px] text-text-secondary", children: t('step2.subtitle') }), _jsxs("span", { className: "inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-3 py-1 font-mono text-[12px] font-semibold text-success", children: [_jsx(Check, { className: "h-3.5 w-3.5" }), " ", t('step2.selected', { count: selected.length })] }), _jsx("div", { className: "grid w-full max-w-[1100px] grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4", children: langsQ.isLoading && langs.length === 0
                    ? Array.from({ length: 8 }).map((_, i) => (_jsx("div", { className: "animate-pulse rounded-xl border border-border bg-surface-1", style: { height: 160 } }, `sk-${i}`)))
                    : langs.map((l) => {
                        const active = selected.includes(l.name);
                        return (_jsxs("button", { type: "button", onClick: () => toggle(l.name), className: cn('relative flex flex-col items-center justify-center gap-2 rounded-xl bg-surface-1 p-4 transition-all', active
                                ? 'border-2 border-accent shadow-glow'
                                : 'border border-border hover:border-border-strong'), style: { height: 160 }, children: [active && (_jsx("span", { className: "absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-accent text-text-primary shadow-glow", children: _jsx(Check, { className: "h-3.5 w-3.5", strokeWidth: 3 }) })), _jsx("span", { className: "grid place-items-center rounded-lg font-display font-bold", style: {
                                        width: 56,
                                        height: 56,
                                        background: l.color,
                                        color: l.text_color ?? '#FFFFFF',
                                        fontSize: 18,
                                    }, children: l.symbol }), _jsx("span", { className: "font-sans text-[14px] font-bold text-text-primary", children: l.name }), _jsxs("span", { className: "font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted", children: [l.players_active.toLocaleString('ru-RU'), " online"] })] }, l.slug));
                    }) }), _jsxs("div", { className: "mt-4 flex w-full max-w-[1100px] items-center justify-between", children: [_jsx(Button, { variant: "ghost", icon: _jsx(ArrowLeft, { className: "h-4 w-4" }), onClick: onBack, className: "h-12 px-6", children: t('step2.back') }), _jsx(Button, { variant: "primary", iconRight: _jsx(ArrowRight, { className: "h-5 w-5" }), onClick: onNext, className: "h-12 px-7 shadow-glow", children: t('step2.next') })] })] }));
}
/* ------------------------------- STEP 3 -------------------------------- */
function Step3Kata({ onNext, onBack }) {
    const { t } = useTranslation('onboarding');
    const previewQ = useOnboardingPreviewKata();
    const kata = previewQ.data;
    const testsLabel = kata
        ? `${kata.tests_passed}/${kata.tests_total} tests passed`
        : '—/— tests passed';
    return (_jsxs("div", { className: "grid grid-cols-1 gap-8 px-4 pb-8 pt-8 sm:px-8 lg:grid-cols-[480px_minmax(0,1fr)] lg:px-20 lg:pb-7 lg:pt-10", children: [_jsxs("div", { className: "flex min-w-0 flex-col justify-center gap-5", children: [_jsx("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-cyan/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan", children: t('step3.tag') }), _jsx("h1", { className: "font-display text-3xl font-extrabold text-text-primary sm:text-4xl lg:text-[40px]", style: { lineHeight: 1.15 }, children: t('step3.title') }), _jsx("p", { className: "text-[15px] text-text-secondary", children: t('step3.subtitle') }), _jsxs("div", { className: "flex flex-col gap-3 pt-2", children: [_jsx(FeatureRow, { icon: _jsx(MousePointerClick, { className: "h-4 w-4 text-cyan" }), iconBg: "bg-cyan/15", title: t('step3.f1_title'), sub: t('step3.f1_sub') }), _jsx(FeatureRow, { icon: _jsx(Play, { className: "h-4 w-4 text-accent-hover" }), iconBg: "bg-accent/15", title: t('step3.f2_title'), sub: t('step3.f2_sub') }), _jsx(FeatureRow, { icon: _jsx(CircleCheck, { className: "h-4 w-4 text-success" }), iconBg: "bg-success/15", title: t('step3.f3_title'), sub: t('step3.f3_sub') })] }), _jsxs("div", { className: "mt-4 flex items-center gap-3", children: [_jsx(Button, { variant: "ghost", icon: _jsx(ArrowLeft, { className: "h-4 w-4" }), onClick: onBack, className: "h-12 px-6", children: t('step3.back') }), _jsx(Button, { variant: "primary", iconRight: _jsx(ArrowRight, { className: "h-5 w-5" }), onClick: onNext, className: "h-12 px-7 shadow-glow", children: t('step3.go') })] })] }), _jsxs("div", { className: "relative min-w-0 overflow-hidden rounded-2xl bg-surface-2", children: [_jsxs("div", { className: "flex flex-col gap-2 px-6 py-5", style: {
                            height: 120,
                            background: 'linear-gradient(135deg, #2D1B4D 0%, #582CFF 100%)',
                        }, children: [_jsx("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn", children: "DAILY \u00B7 TUTORIAL" }), _jsx("h3", { className: "font-display text-2xl font-bold text-text-primary", children: kata?.title ?? 'Two Sum' }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Tag, { children: "Easy" }), _jsx(Tag, { children: "Hash Map" }), _jsx(Tag, { children: "Array" })] })] }), _jsxs("div", { className: "grid grid-cols-1 gap-3.5 bg-surface-1 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]", children: [_jsxs("div", { className: "flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-4", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted", children: t('step3.task') }), _jsx("p", { className: "text-[12px] leading-relaxed text-text-secondary", children: t('step3.task_text') })] }), _jsxs("div", { className: "flex flex-col gap-1 overflow-x-auto rounded-lg border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed", children: [_jsx(CodeLine, { n: 1, text: "func twoSum(nums []int, t int) []int {" }), _jsx(CodeLine, { n: 2, text: "  m := map[int]int{}" }), _jsx(CodeLine, { n: 3, text: "  for i, v := range nums {", highlight: true }), _jsx(CodeLine, { n: 4, text: "    if j, ok := m[t-v]; ok {" }), _jsx(CodeLine, { n: 5, text: "      return []int{j, i}" })] })] }), _jsxs("div", { className: "flex items-center justify-between border-t border-border bg-surface-2 px-6 py-3", children: [_jsx("span", { className: "font-mono text-[11px] text-text-muted", children: testsLabel }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { className: "rounded-md border border-border bg-bg px-3 py-1.5 text-[12px] font-semibold text-text-secondary", children: "Run" }), _jsx("button", { id: "mock-submit-btn", className: "rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-text-primary shadow-glow", children: "Submit" })] })] }), _jsxs("div", { className: "absolute flex flex-col gap-1 rounded-lg border border-accent bg-accent/95 px-4 py-3 shadow-glow", style: { bottom: 70, right: 24, maxWidth: 220 }, children: [_jsx("span", { className: "font-display text-[13px] font-bold text-text-primary", children: t('step3.tooltip_title') }), _jsx("span", { className: "text-[11px] text-white/85", children: t('step3.tooltip_sub') }), _jsx("span", { className: "absolute h-3 w-3 rotate-45 bg-accent", style: { bottom: -6, right: 32 } })] })] })] }));
}
function Tag({ children }) {
    return (_jsx("span", { className: "rounded-full bg-black/30 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-secondary", children: children }));
}
function FeatureRow({ icon, iconBg, title, sub, }) {
    return (_jsxs("div", { className: "flex items-start gap-3", children: [_jsx("span", { className: cn('mt-0.5 grid h-9 w-9 place-items-center rounded-full', iconBg), children: icon }), _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "text-[14px] font-semibold text-text-primary", children: title }), _jsx("span", { className: "text-[12px] text-text-muted", children: sub })] })] }));
}
function CodeLine({ n, text, highlight }) {
    return (_jsxs("div", { className: cn('flex gap-3 rounded px-1', highlight ? 'bg-accent/20 text-text-primary' : 'text-text-secondary'), children: [_jsx("span", { className: "shrink-0 text-text-muted", children: n }), _jsx("span", { className: "whitespace-pre", children: text })] }));
}
/* ------------------------------- STEP 4 -------------------------------- */
function Step4AISpar(_props) {
    void _props;
    const { t } = useTranslation('onboarding');
    const navigate = useNavigate();
    return (_jsxs("div", { className: "flex flex-col", children: [_jsxs("div", { className: "flex flex-col items-start justify-between gap-6 px-4 py-8 sm:px-8 lg:h-[360px] lg:flex-row lg:items-center lg:gap-0 lg:px-20 lg:py-0", style: {
                    background: 'linear-gradient(135deg, #2D1B4D 0%, #F472B6 100%)',
                }, children: [_jsxs("div", { className: "flex min-w-0 flex-col gap-4 lg:w-[540px] lg:max-w-[540px]", children: [_jsx("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn", children: t('step4.tag') }), _jsx("h1", { className: "font-display text-2xl font-extrabold text-text-primary sm:text-3xl lg:text-[36px]", style: { lineHeight: 1.1 }, children: t('step4.title') }), _jsx("p", { className: "text-[14px] leading-relaxed text-white/85", children: t('step4.subtitle') }), _jsxs("div", { className: "flex flex-col gap-2 pt-1", children: [_jsx(CheckFeat, { text: t('step4.f1') }), _jsx(CheckFeat, { text: t('step4.f2') }), _jsx(CheckFeat, { text: t('step4.f3') })] })] }), _jsxs("div", { className: "flex w-full max-w-full flex-col items-center gap-[18px] rounded-2xl p-[22px] backdrop-blur lg:w-[380px] lg:max-w-[380px]", style: { background: 'rgba(0,0,0,0.6)' }, children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("div", { className: "grid place-items-center text-text-primary", style: {
                                            width: 72,
                                            height: 72,
                                            borderRadius: 36,
                                            background: 'linear-gradient(135deg, #F472B6 0%, #582CFF 100%)',
                                        }, children: _jsx("span", { className: "font-display text-2xl font-bold", children: "\u0414" }) }), _jsx("span", { className: "font-display text-2xl font-extrabold text-text-primary", children: "VS" }), _jsx("div", { className: "grid place-items-center text-text-primary", style: {
                                            width: 72,
                                            height: 72,
                                            borderRadius: 36,
                                            background: 'linear-gradient(135deg, #22D3EE 0%, #582CFF 100%)',
                                        }, children: _jsx(Bot, { className: "h-8 w-8" }) })] }), _jsx("span", { className: "font-mono text-[12px] text-text-secondary", children: "Two Sum \u00B7 Hash Map \u00B7 Easy" })] })] }), _jsxs("div", { className: "flex flex-col items-center gap-5 px-4 py-8 sm:px-8 lg:px-20", children: [_jsx("h2", { className: "text-center font-display text-2xl font-bold text-text-primary", children: t('step4.ready') }), _jsx("p", { className: "max-w-[560px] text-center text-[14px] text-text-secondary", children: t('step4.ready_sub') }), _jsxs("div", { className: "grid w-full max-w-[900px] grid-cols-1 gap-4 sm:grid-cols-3", children: [_jsx(BenefitCard, { icon: _jsx(Sparkles, { className: "h-5 w-5 text-accent-hover" }), title: t('step4.b1_title'), sub: t('step4.b1_sub') }), _jsx(BenefitCard, { icon: _jsx(Sparkles, { className: "h-5 w-5 text-cyan" }), title: t('step4.b2_title'), sub: t('step4.b2_sub') }), _jsx(BenefitCard, { icon: _jsx(Lock, { className: "h-5 w-5 text-warn" }), title: t('step4.b3_title'), sub: t('step4.b3_sub') })] }), _jsxs("div", { className: "flex w-full flex-col items-stretch gap-3 pt-2 sm:w-auto sm:flex-row sm:items-center", children: [_jsx(Button, { variant: "ghost", icon: _jsx(Play, { className: "h-4 w-4" }), onClick: () => navigate('/welcome/demo'), className: "h-12 px-6", children: t('step4.watch_video') }), _jsx(Button, { variant: "primary", iconRight: _jsx(ArrowRight, { className: "h-5 w-5" }), onClick: () => navigate('/arena'), className: "h-14 px-8 text-[15px] shadow-glow", children: t('step4.begin_spar') })] })] })] }));
}
function CheckFeat({ text }) {
    return (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "grid h-5 w-5 place-items-center rounded-full bg-success/25", children: _jsx(Check, { className: "h-3 w-3 text-success", strokeWidth: 3 }) }), _jsx("span", { className: "text-[13px] text-text-primary", children: text })] }));
}
function BenefitCard({ icon, title, sub, }) {
    return (_jsxs("div", { className: "flex flex-1 flex-col gap-2 rounded-xl border border-border bg-surface-1 p-5", children: [_jsx("span", { className: "grid h-9 w-9 place-items-center rounded-full bg-surface-2", children: icon }), _jsx("span", { className: "font-display text-base font-bold text-text-primary", children: title }), _jsx("span", { className: "text-[12px] text-text-muted", children: sub })] }));
}
/* ------------------------------- PAGE ---------------------------------- */
// re-export icon for unused suppression
void Clock;
void MessageSquare;
export default function OnboardingPage() {
    useEffect(() => {
        document.body.classList.add('v2');
        return () => document.body.classList.remove('v2');
    }, []);
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    // Auth guard: онбординг — для авторизованных. Незалогиненный → /login?next=/onboarding.
    // Простая проверка по localStorage; полноценный /me-запрос ждать здесь не имеет смысла.
    useEffect(() => {
        let token = null;
        try {
            token = window.localStorage.getItem(ACCESS_TOKEN_KEY);
        }
        catch {
            token = null;
        }
        if (!token) {
            navigate('/login?next=/onboarding', { replace: true });
        }
    }, [navigate]);
    // Валидный диапазон step — 1..3 (новая нумерация после удаления OAuth-step1).
    // Раньше тут был "legacy ремап" (?step=2 → 1, ?step=3 → 2 и т.д.) для совместимости
    // со старыми ссылками. Он ЛОМАЛ обычную навигацию: setStep(2) → URL ?step=2
    // → ремап возвращал 1 → застряли на step 1. Убран.
    // Старые ссылки с ?step=4 (которых уже не существует) теперь нормализуются в 3.
    const stepParam = params.get('step');
    const step = useMemo(() => {
        const raw = parseInt(stepParam ?? '1', 10);
        if (raw >= 1 && raw <= 3)
            return raw;
        return 1;
    }, [stepParam]);
    const setStep = (s) => {
        const next = new URLSearchParams(params);
        next.set('step', String(s));
        setParams(next, { replace: false });
    };
    const goNext = () => {
        if (step < 3)
            setStep((step + 1));
        else
            navigate('/onboarding/done');
    };
    const goBack = () => {
        if (step > 1)
            setStep((step - 1));
    };
    return (_jsxs("div", { className: "min-h-screen bg-bg text-text-primary", children: [_jsx(OnboardingTopBar, { current: step }), _jsxs("main", { children: [step === 1 && _jsx(Step2Stack, { onNext: goNext, onBack: goBack }), step === 2 && _jsx(Step3Kata, { onNext: goNext, onBack: goBack }), step === 3 && _jsx(Step4AISpar, { onNext: goNext, onBack: goBack })] })] }));
}
