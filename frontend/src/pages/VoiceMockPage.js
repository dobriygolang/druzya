import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// VoiceMockPage — two-way voice interview UI wired to useVoiceSession.
// Visual structure (header / left transcript / center orb / right panel) is
// preserved from the original mock; only the dynamic bits (mic, orb, voice
// chips, transcript) are wired to live state.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Lightbulb, Lock, Mic, MicOff, SkipBack, Sparkles, Volume2, X, } from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useProfileQuery } from '../lib/queries/profile';
import { isPremiumTTSAvailable, useVoiceSession } from '../lib/voice';
function nowStamp() {
    const d = new Date();
    return `${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}
function VoiceHeader({ voice, setVoice, premiumOk, onEnd, }) {
    return (_jsxs("div", { className: "flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-16 lg:flex-row lg:items-center lg:justify-between lg:py-0", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "h-2.5 w-2.5 animate-pulse rounded-full bg-danger" }), _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-primary", children: "VOICE MOCK \u00B7 LIVE" }), _jsx("span", { className: "text-text-muted", children: "\u00B7" }), _jsx("span", { className: "font-mono text-xs text-text-secondary", children: "Question 2 of 4" })] }), _jsx("span", { className: "font-display text-2xl font-extrabold text-text-primary", children: "32:14" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(VoicePicker, { voice: voice, setVoice: setVoice, premiumOk: premiumOk }), _jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(Lightbulb, { className: "h-3.5 w-3.5" }), children: "\u041F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0430" }), _jsx(Button, { variant: "danger", size: "sm", icon: _jsx(X, { className: "h-3.5 w-3.5" }), onClick: onEnd, children: "\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C" })] })] }));
}
function VoicePicker({ voice, setVoice, premiumOk, }) {
    const opts = [
        { id: 'browser', label: 'Browser', premium: false },
        { id: 'premium-male', label: '♂ Premium', premium: true },
        { id: 'premium-female', label: '♀ Premium', premium: true },
    ];
    return (_jsxs("div", { className: "flex items-center gap-1 rounded-full bg-surface-2 p-1", children: [premiumOk ? (_jsxs("span", { className: "flex items-center gap-1 rounded-full bg-warn/20 px-2 py-0.5 font-mono text-[10px] font-bold text-warn", children: [_jsx(Sparkles, { className: "h-3 w-3" }), " Premium Voice"] })) : (_jsxs("span", { className: "flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold text-text-muted", children: [_jsx(Lock, { className: "h-3 w-3" }), " Premium"] })), opts.map((o) => {
                const disabled = o.premium && !premiumOk;
                const active = voice === o.id;
                return (_jsx("button", { type: "button", disabled: disabled, title: disabled ? 'Доступно с Premium' : o.label, onClick: () => setVoice(o.id), className: 'rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold transition-colors ' +
                        (active
                            ? 'bg-accent text-text-primary'
                            : disabled
                                ? 'cursor-not-allowed text-text-muted opacity-60'
                                : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary'), children: o.label }, o.id));
            })] }));
}
function LeftTranscript({ messages, interim, listening, }) {
    return (_jsxs("div", { className: "flex w-full flex-col gap-4 border-b border-border bg-surface-1 lg:w-[380px] lg:border-b-0 lg:border-r", children: [_jsxs("div", { className: "border-b border-border p-5", children: [_jsx("span", { className: "rounded-full bg-accent/15 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-accent-hover", children: "\u0412\u041E\u041F\u0420\u041E\u0421 2/4" }), _jsx("h2", { className: "mt-2 font-display text-lg font-bold text-text-primary", children: "\u0420\u0430\u0441\u0441\u043A\u0430\u0436\u0438 \u043E \u0440\u0435\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u0438 LRU Cache" }), _jsx("p", { className: "mt-1 text-xs text-text-muted", children: "\u041E\u0431\u044A\u044F\u0441\u043D\u0438 \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0443, \u043E\u0441\u043D\u043E\u0432\u043D\u044B\u0435 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438 \u0438 \u0441\u043B\u043E\u0436\u043D\u043E\u0441\u0442\u044C." })] }), _jsxs("div", { className: "flex flex-1 flex-col gap-3 overflow-auto px-5", children: [_jsx("h3", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: "\u0422\u0420\u0410\u041D\u0421\u041A\u0420\u0418\u041F\u0422" }), messages.length === 0 && !interim && (_jsx("p", { className: "text-[12px] text-text-muted", children: "\u041D\u0430\u0436\u043C\u0438 \u043D\u0430 \u043C\u0438\u043A\u0440\u043E\u0444\u043E\u043D \u0438 \u043D\u0430\u0447\u043D\u0438 \u0433\u043E\u0432\u043E\u0440\u0438\u0442\u044C \u2014 AI \u0443\u0441\u043B\u044B\u0448\u0438\u0442 \u0438 \u043E\u0442\u0432\u0435\u0442\u0438\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u043C." })), messages.map((m, i) => m.who === 'ai' ? (_jsxs("div", { className: "flex items-start gap-2", children: [_jsx(Avatar, { size: "sm", gradient: "violet-cyan", initials: "AI" }), _jsxs("div", { className: "min-w-0 flex-1 rounded-lg bg-surface-2 p-3", children: [_jsx("p", { className: "break-words text-[12px] text-text-secondary", children: m.text }), _jsx("span", { className: "mt-1 block font-mono text-[10px] text-text-muted", children: m.t })] })] }, i)) : (_jsxs("div", { className: "flex items-start gap-2", children: [_jsxs("div", { className: "min-w-0 flex-1 rounded-lg bg-accent/20 p-3", children: [_jsx("p", { className: "break-words text-[12px] text-text-primary", children: m.text }), _jsx("span", { className: "mt-1 block font-mono text-[10px] text-text-muted", children: m.t })] }), _jsx(Avatar, { size: "sm", gradient: "pink-violet", initials: "\u042F" })] }, i))), interim && (_jsxs("div", { className: "flex items-start gap-2 opacity-70", children: [_jsx("div", { className: "min-w-0 flex-1 rounded-lg border border-dashed border-accent/40 p-3", children: _jsx("p", { className: "break-words text-[12px] italic text-text-secondary", children: interim }) }), _jsx(Avatar, { size: "sm", gradient: "pink-violet", initials: "\u042F" })] }))] }), _jsxs("div", { className: "flex h-14 items-center justify-between border-t border-border bg-surface-2 px-4", children: [_jsx("div", { className: 'flex items-end gap-1 ' + (listening ? 'voice-bars-listening' : ''), children: [10, 18, 14, 22, 12].map((h, i) => (_jsx("span", { className: "w-1 rounded-full bg-accent-hover", style: {
                                height: `${h}px`,
                                animation: listening ? `voicePulse 1s ease-in-out ${i * 0.1}s infinite` : 'none',
                            } }, i))) }), _jsx("span", { className: "font-mono text-[11px] text-accent-hover", children: listening ? 'Слушаю...' : 'Микрофон выключен' })] }), _jsx("style", { children: `
        @keyframes voicePulse {
          0%, 100% { transform: scaleY(0.5); }
          50% { transform: scaleY(1.4); }
        }
      ` })] }));
}
function CenterOrb({ state, onToggle, modelLabel, }) {
    const bars = Array.from({ length: 30 }).map((_, i) => 8 + Math.abs(((i * 9) % 24) - 4));
    const labelMap = {
        idle: 'Готов',
        listening: 'Слушает',
        thinking: 'Думает',
        speaking: 'Говорит',
        error: 'Ошибка',
    };
    const speaking = state === 'speaking';
    const listening = state === 'listening';
    return (_jsxs("div", { className: "flex min-w-0 flex-1 flex-col items-center justify-center gap-6 bg-surface-1 p-6 lg:gap-8 lg:p-10", children: [_jsx("div", { className: "grid h-56 w-56 place-items-center rounded-full sm:h-72 sm:w-72 lg:h-80 lg:w-80", style: {
                    background: 'linear-gradient(135deg, #582CFF 0%, #F472B6 100%)',
                    boxShadow: '0 20px 80px rgba(88,44,255,0.6)',
                    animation: speaking ? 'orbPulse 1.2s ease-in-out infinite' : 'none',
                }, children: _jsx("div", { className: "grid h-44 w-44 place-items-center rounded-full sm:h-56 sm:w-56 lg:h-60 lg:w-60", style: { background: '#00000060' }, children: _jsxs("div", { className: "flex flex-col items-center gap-1.5", children: [_jsx("span", { className: "font-mono text-[11px] tracking-[0.15em] text-text-muted", children: "AI INTERVIEWER" }), _jsx("span", { className: "font-display text-[32px] font-extrabold text-text-primary", children: labelMap[state] }), _jsx("span", { className: "font-mono text-[11px] text-text-secondary", children: modelLabel })] }) }) }), _jsx("div", { className: "flex h-12 items-end gap-1.5", children: bars.map((h, i) => (_jsx("span", { className: "w-1 rounded-full bg-cyan opacity-80", style: {
                        height: `${h * 1.5}px`,
                        animation: listening ? `voicePulse 0.7s ease-in-out ${i * 0.04}s infinite` : 'none',
                    } }, i))) }), _jsx("span", { className: "text-xs text-text-secondary", children: listening
                    ? 'Говори свободно — AI запишет и оценит'
                    : state === 'speaking'
                        ? 'AI отвечает...'
                        : state === 'thinking'
                            ? 'AI обрабатывает...'
                            : 'Нажми микрофон, чтобы начать' }), _jsxs("div", { className: "flex items-center gap-5", children: [_jsx("button", { className: "grid h-14 w-14 place-items-center rounded-full bg-surface-2 text-text-secondary hover:bg-surface-3", children: _jsx(SkipBack, { className: "h-5 w-5" }) }), _jsx("button", { onClick: onToggle, className: 'grid h-20 w-20 place-items-center rounded-full text-text-primary transition-transform active:scale-95 ' +
                            (state === 'idle' || state === 'error' ? 'bg-accent' : 'bg-danger'), style: { boxShadow: '0 10px 40px rgba(88,44,255,0.6)' }, "aria-label": state === 'idle' ? 'Start' : 'Stop', children: state === 'idle' || state === 'error' ? (_jsx(Mic, { className: "h-7 w-7" })) : (_jsx(MicOff, { className: "h-7 w-7" })) }), _jsx("button", { className: "grid h-14 w-14 place-items-center rounded-full bg-surface-2 text-text-secondary hover:bg-surface-3", children: _jsx(Volume2, { className: "h-5 w-5" }) })] }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: "Tab \u2014 \u043F\u0430\u0443\u0437\u0430, Esc \u2014 \u0437\u0430\u043A\u0440\u044B\u0442\u044C" }), _jsx("style", { children: `
        @keyframes orbPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 20px 80px rgba(88,44,255,0.6); }
          50% { transform: scale(1.05); box-shadow: 0 30px 120px rgba(244,114,182,0.85); }
        }
      ` })] }));
}
function RightPanel() {
    const notes = [
        { i: _jsx(CheckCircle2, { className: "h-4 w-4 text-success" }), t: 'Упомянул hash map + linked list' },
        { i: _jsx(CheckCircle2, { className: "h-4 w-4 text-success" }), t: 'Объяснил O(1) сложность' },
        { i: _jsx(AlertTriangle, { className: "h-4 w-4 text-warn" }), t: 'Не упомянул thread safety' },
    ];
    const metrics = [
        ['Понимание', 9.0, 'bg-success'],
        ['Объяснение', 8.5, 'bg-cyan'],
        ['Скорость', 7.5, 'bg-warn'],
        ['Глубина', 8.0, 'bg-accent'],
    ];
    const actions = [
        'Задать follow-up вопрос',
        'Перейти к следующему',
        'Сменить тему',
        'Сделать паузу',
    ];
    return (_jsxs("div", { className: "flex w-full flex-col gap-4 border-t border-border bg-surface-1 p-5 lg:w-[320px] lg:border-l lg:border-t-0", children: [_jsxs(Card, { className: "flex-col gap-3 p-4", interactive: false, children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "Live notes" }), notes.map((n, i) => (_jsxs("div", { className: "flex items-center gap-2", children: [n.i, _jsx("span", { className: "text-[12px] text-text-secondary", children: n.t })] }, i)))] }), _jsxs(Card, { className: "flex-col gap-3 p-4", interactive: false, children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "Live evaluation" }), metrics.map(([k, v, c]) => (_jsxs("div", { className: "flex flex-col gap-1", children: [_jsxs("div", { className: "flex justify-between font-mono text-[11px]", children: [_jsx("span", { className: "text-text-secondary", children: k }), _jsx("span", { className: "text-text-primary", children: v.toFixed(1) })] }), _jsx("div", { className: "h-1.5 overflow-hidden rounded-full bg-surface-2", children: _jsx("div", { className: `h-full ${c}`, style: { width: `${v * 10}%` } }) })] }, k)))] }), _jsxs(Card, { className: "flex-col gap-2 p-4", interactive: false, children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "Quick actions" }), actions.map((a) => (_jsxs("button", { className: "flex items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-[12px] text-text-secondary hover:bg-surface-2", children: [_jsx(Circle, { className: "h-3 w-3 text-accent-hover" }), a] }, a)))] })] }));
}
export default function VoiceMockPage() {
    const { data: profile } = useProfileQuery();
    const tier = profile?.tier ?? 'free';
    const premiumOk = isPremiumTTSAvailable(tier);
    const [voice, setVoice] = useState('browser');
    const [chat, setChat] = useState([]);
    // Stable session id for the lifetime of the page mount.
    const sessionId = useMemo(() => `voice-${Math.random().toString(36).slice(2, 10)}`, []);
    const session = useVoiceSession({ sessionId, voice, lang: 'ru-RU' });
    // Mirror voice-session events into the visible transcript. useEffect runs
    // after commit, so we never trigger a setState during render.
    const lastAiRef = useRef('');
    const lastUserRef = useRef('');
    useEffect(() => {
        if (session.aiText && session.aiText !== lastAiRef.current) {
            lastAiRef.current = session.aiText;
            const userTxt = session.transcript.trim();
            setChat((prev) => {
                const next = [...prev];
                if (userTxt && userTxt !== lastUserRef.current) {
                    lastUserRef.current = userTxt;
                    next.push({ who: 'me', text: userTxt, t: nowStamp() });
                }
                next.push({ who: 'ai', text: session.aiText, t: nowStamp() });
                return next;
            });
        }
    }, [session.aiText, session.transcript]);
    const onToggle = () => {
        if (session.state === 'idle' || session.state === 'error') {
            setChat([]);
            session.start();
        }
        else {
            session.stop();
        }
    };
    return (_jsxs("div", { className: "flex min-h-screen flex-col bg-bg text-text-primary", children: [_jsx(VoiceHeader, { voice: voice, setVoice: setVoice, premiumOk: premiumOk, onEnd: session.stop }), _jsxs("div", { className: "flex flex-1 flex-col lg:flex-row", children: [_jsx(LeftTranscript, { messages: chat, interim: session.transcript, listening: session.state === 'listening' }), _jsx(CenterOrb, { state: session.state, onToggle: onToggle, modelLabel: voice === 'browser' ? 'Browser TTS · Web Speech' : `Premium · ${voice}` }), _jsx(RightPanel, {})] }), session.error && (_jsx("div", { className: "border-t border-danger/40 bg-danger/10 px-4 py-2 font-mono text-[11px] text-danger", children: session.error }))] }));
}
