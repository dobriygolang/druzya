import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// MockSessionPage — main AI-interview UI. Wires:
//   - GET /mock/session/:id  via useMockSessionQuery (initial bootstrap)
//   - WS /ws/mock/:id        via useChannel (streaming AI tokens, stress)
//   - POST /mock/session/:id/message  via useSendMockMessage (REST fallback)
//   - POST /mock/session/:id/finish   via useFinishMockSessionMutation
//
// Hardcoded panels (notes / interviewer video / company score) are kept
// purely visual — they don't have backing endpoints in MVP, only feature
// flags that the bible defers to v2. Marked with `mvp-static` for grep.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera, FileCode, Lightbulb, Loader2, Mic, PhoneOff, Send, Sparkles, Upload, Video, } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { WSStatus } from '../components/ws/WSStatus';
import { useChannel } from '../lib/ws';
import { useFinishMockSessionMutation, useMockSessionQuery, useSendMockMessage, } from '../lib/queries/mock';
function ErrorChip() {
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C" }));
}
function fromMessageRow(m) {
    return { from: m.role === 'user' ? 'user' : 'ai', text: m.content };
}
function fmtMmSs(totalSec) {
    const mm = Math.max(0, Math.floor(totalSec / 60));
    const ss = Math.max(0, Math.floor(totalSec % 60));
    return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}
function MatchHeader({ elapsedSec, durationMin, onFinish, finishing, }) {
    return (_jsxs("div", { className: "flex h-[80px] items-center justify-between gap-2 border-b border-border bg-surface-1 px-4 sm:px-8", children: [_jsx("div", { className: "hidden items-center gap-3 sm:flex", children: _jsxs("span", { className: "inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-success", children: [_jsx("span", { className: "h-1.5 w-1.5 rounded-full bg-success" }), "AI INTERVIEW \u00B7 LIVE"] }) }), _jsx("div", { className: "flex flex-col items-center gap-1", children: _jsxs("span", { className: "font-display text-[26px] font-extrabold leading-none text-text-primary", children: [fmtMmSs(elapsedSec), ' ', _jsxs("span", { className: "text-text-muted", children: ["/ ", fmtMmSs(durationMin * 60)] })] }) }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Button, { variant: "ghost", icon: _jsx(Lightbulb, { className: "h-4 w-4" }), size: "sm", className: "hidden sm:inline-flex", children: "\u041F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0430" }), _jsx(Button, { variant: "danger", size: "sm", onClick: onFinish, disabled: finishing, children: finishing ? 'Завершаем…' : 'Завершить' })] })] }));
}
function InterviewerPanel() {
    return (_jsxs(Card, { className: "h-[320px] flex-col gap-3 p-4", interactive: false, children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-2.5", children: [_jsx(Avatar, { size: "md", gradient: "cyan-violet", initials: "AI", status: "online" }), _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "text-sm font-semibold text-text-primary", children: "AI Interviewer" }), _jsx("span", { className: "font-mono text-[11px] text-success", children: "\u25CF \u0421\u043B\u0443\u0448\u0430\u0435\u0442" })] })] }), _jsx(Sparkles, { className: "h-4 w-4 text-cyan" })] }), _jsx("div", { className: "flex flex-1 items-center justify-center rounded-lg bg-gradient-to-br from-surface-3 to-surface-2 border border-border-strong", children: _jsxs("div", { className: "flex flex-col items-center gap-2", children: [_jsx(Video, { className: "h-10 w-10 text-text-muted" }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "video stream" })] }) })] }));
}
function QuestionPanel({ title, description }) {
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsx("span", { className: "inline-flex w-fit items-center gap-1 rounded-full bg-cyan/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-cyan", children: "\u0412\u041E\u041F\u0420\u041E\u0421" }), _jsx("h3", { className: "font-display text-lg font-bold text-text-primary break-words", children: title }), _jsx("p", { className: "text-[13px] leading-relaxed text-text-secondary break-words", children: description })] }));
}
function ControlsCard({ micOn, toggleMic, onLeave, }) {
    const tile = (Icon, danger, active, onClick) => (_jsx("button", { onClick: onClick, className: [
            'grid h-11 w-11 place-items-center rounded-full border',
            danger
                ? 'border-danger/40 bg-danger/15 text-danger hover:bg-danger/25'
                : active
                    ? 'border-cyan/40 bg-cyan/15 text-cyan hover:bg-cyan/25'
                    : 'border-border bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary',
        ].join(' '), children: _jsx(Icon, { className: "h-4 w-4" }) }));
    return (_jsxs(Card, { className: "flex-row items-center justify-around p-4", interactive: false, children: [tile(Mic, false, micOn, toggleMic), tile(Camera), tile(Upload), tile(PhoneOff, true, false, onLeave)] }));
}
function StressCard({ stress }) {
    const items = [
        { label: 'Паузы', value: stress.pauses_score, color: 'bg-cyan' },
        { label: 'Backspaces', value: stress.backspace_score, color: 'bg-warn' },
        { label: 'Хаос', value: stress.chaos_score, color: 'bg-accent' },
        { label: 'Paste-попытки', value: stress.paste_attempts, color: 'bg-danger' },
    ];
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "text-sm font-bold text-text-primary", children: "\u0421\u0442\u0440\u0435\u0441\u0441-\u043C\u0435\u0442\u0440\u0438\u043A\u0438" }), _jsx(Sparkles, { className: "h-4 w-4 text-cyan" })] }), items.map((m) => (_jsxs("div", { className: "flex flex-col gap-1", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[12px] text-text-secondary", children: m.label }), _jsx("span", { className: "font-mono text-[12px] font-semibold text-text-primary", children: m.value })] }), _jsx("div", { className: "h-1.5 overflow-hidden rounded-full bg-black/40", children: _jsx("div", { className: `h-full transition-all duration-700 ${m.color}`, style: { width: `${Math.min(100, m.value)}%` } }) })] }, m.label)))] }));
}
function TranscriptCard({ messages, pending }) {
    if (messages.length === 0 && !pending) {
        return (_jsxs(Card, { className: "flex-col gap-2 p-4", interactive: false, children: [_jsx("h3", { className: "text-sm font-bold text-text-primary", children: "\u0414\u0438\u0430\u043B\u043E\u0433" }), _jsx("p", { className: "text-[12px] text-text-muted", children: "\u041D\u0430\u0447\u043D\u0438\u0442\u0435 \u0441 \u043F\u0435\u0440\u0432\u043E\u0433\u043E \u043E\u0442\u0432\u0435\u0442\u0430 AI-\u0438\u043D\u0442\u0435\u0440\u0432\u044C\u044E\u0435\u0440\u0443 \u0432 \u043F\u043E\u043B\u0435 \u043D\u0438\u0436\u0435." })] }));
    }
    return (_jsxs(Card, { className: "flex-col gap-2 p-4", interactive: false, children: [_jsx("h3", { className: "text-sm font-bold text-text-primary", children: "\u0414\u0438\u0430\u043B\u043E\u0433" }), _jsxs("div", { className: "flex max-h-[240px] flex-col gap-1.5 overflow-y-auto", children: [messages.slice(-30).map((m, i) => (_jsxs("div", { className: "text-[12px] break-words", children: [_jsxs("span", { className: m.from === 'ai' ? 'text-cyan' : 'text-accent-hover', children: [m.from === 'ai' ? 'AI:' : 'Я:', ' '] }), _jsx("span", { className: "text-text-secondary", children: m.text })] }, i))), pending && (_jsxs("div", { className: "flex items-center gap-1.5 text-[12px] text-text-muted", children: [_jsx(Loader2, { className: "h-3 w-3 animate-spin" }), " AI \u043F\u0435\u0447\u0430\u0442\u0430\u0435\u0442\u2026"] }))] })] }));
}
function MessageBox({ value, onChange, onSend, sending, toggleMic, micOn, }) {
    return (_jsxs(Card, { className: "flex-row items-center gap-2 p-3", interactive: false, children: [_jsx("button", { type: "button", onClick: toggleMic, className: [
                    'grid h-9 w-9 shrink-0 place-items-center rounded-full border',
                    micOn
                        ? 'border-cyan/40 bg-cyan/15 text-cyan'
                        : 'border-border bg-surface-2 text-text-secondary hover:bg-surface-3',
                ].join(' '), "aria-label": "toggle voice", children: _jsx(Mic, { className: "h-4 w-4" }) }), _jsx("input", { className: "flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent", placeholder: "\u041E\u0442\u0432\u0435\u0442\u044C\u0442\u0435 \u0438\u043D\u0442\u0435\u0440\u0432\u044C\u044E\u0435\u0440\u0443\u2026", value: value, onChange: (e) => onChange(e.target.value), onKeyDown: (e) => {
                    if (e.key === 'Enter' && !e.shiftKey && value.trim()) {
                        e.preventDefault();
                        onSend();
                    }
                } }), _jsx(Button, { variant: "primary", size: "sm", onClick: onSend, disabled: sending || !value.trim(), icon: sending ? _jsx(Loader2, { className: "h-4 w-4 animate-spin" }) : _jsx(Send, { className: "h-4 w-4" }), children: sending ? '…' : 'Отправить' })] }));
}
function EditorPlaceholder() {
    return (_jsxs(Card, { className: "flex-1 flex-col p-0 overflow-hidden", interactive: false, children: [_jsxs("div", { className: "flex h-11 items-center justify-between border-b border-border px-4", children: [_jsxs("div", { className: "flex items-center gap-2.5", children: [_jsx(FileCode, { className: "h-4 w-4 text-text-secondary" }), _jsx("span", { className: "font-mono text-[13px] text-text-primary", children: "workspace" })] }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "UTF-8 \u00B7 LF" })] }), _jsx("div", { className: "flex flex-1 items-center justify-center bg-surface-1 p-6 text-center", children: _jsx("p", { className: "font-mono text-[12px] text-text-muted", children: "Code editor \u0434\u043B\u044F \u044D\u0442\u043E\u0439 \u0441\u0435\u043A\u0446\u0438\u0438 \u043E\u0442\u043A\u0440\u043E\u0435\u0442\u0441\u044F \u0432 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 \u00B7 MVP \u0443\u0440\u043E\u0432\u043D\u044F v1" }) })] }));
}
export default function MockSessionPage() {
    const { sessionId } = useParams();
    const navigate = useNavigate();
    const channel = sessionId ? `mock/${sessionId}` : '';
    const { lastEvent, data: wsData, status: wsStatus } = useChannel(channel);
    const { data: session, isError, isLoading } = useMockSessionQuery(sessionId);
    const sendMutation = useSendMockMessage(sessionId);
    const finishMutation = useFinishMockSessionMutation(sessionId);
    const [draft, setDraft] = useState('');
    const [micOn, setMicOn] = useState(false);
    const [transcript, setTranscript] = useState([]);
    const seedKeyRef = useRef(null);
    const [stress, setStress] = useState({ pauses_score: 0, backspace_score: 0, chaos_score: 0, paste_attempts: 0 });
    const [streamingDelta, setStreamingDelta] = useState('');
    // Seed transcript from REST when the session first arrives (idempotent
    // per session id so user-typed messages aren't blown away on refetch).
    useEffect(() => {
        if (!session)
            return;
        if (seedKeyRef.current === session.id)
            return;
        seedKeyRef.current = session.id;
        setTranscript((session.last_messages ?? []).map(fromMessageRow));
        if (session.stress_profile)
            setStress(session.stress_profile);
    }, [session]);
    // WS event fan-out. The hub emits these kinds:
    //   ai_token           — partial assistant token (delta only)
    //   ai_done            — final assistant message saved
    //   user_message_ack   — server confirms our message landed
    //   stress_update      — boundary crossing on a stress dimension
    //   intervention       — AI nudges after user idle
    useEffect(() => {
        if (!lastEvent || !wsData)
            return;
        const payload = wsData;
        if (lastEvent === 'ai_token') {
            const d = typeof payload.delta === 'string' ? payload.delta : '';
            setStreamingDelta((prev) => prev + d);
        }
        else if (lastEvent === 'ai_done') {
            setStreamingDelta((prev) => {
                if (prev) {
                    setTranscript((t) => [...t, { from: 'ai', text: prev }]);
                }
                return '';
            });
        }
        else if (lastEvent === 'user_message_ack') {
            const text = typeof payload.content === 'string' ? payload.content : '';
            if (text)
                setTranscript((t) => [...t, { from: 'user', text }]);
        }
        else if (lastEvent === 'stress_update') {
            const dim = typeof payload.dimension === 'string' ? payload.dimension : '';
            const value = typeof payload.value === 'number' ? payload.value : 0;
            setStress((prev) => {
                const next = { ...prev };
                if (dim === 'pauses')
                    next.pauses_score = value;
                else if (dim === 'backspace')
                    next.backspace_score = value;
                else if (dim === 'chaos')
                    next.chaos_score = value;
                else if (dim === 'paste')
                    next.paste_attempts = value;
                return next;
            });
        }
        else if (lastEvent === 'intervention') {
            const text = typeof payload.text === 'string' ? payload.text : '';
            if (text)
                setTranscript((t) => [...t, { from: 'ai', text }]);
        }
    }, [lastEvent, wsData]);
    // Wall-clock elapsed since started_at. Avoids re-rendering at >1Hz.
    const startedAt = session?.started_at ? new Date(session.started_at).getTime() : Date.now();
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
        tick();
        const id = window.setInterval(tick, 1000);
        return () => window.clearInterval(id);
    }, [startedAt]);
    const qTitle = session?.task?.title ?? (isLoading ? 'Загрузка задачи…' : 'Задача');
    const qDesc = session?.task?.description ?? (isLoading ? 'Подождите немного, загружаем условие интервью.' : 'Подождите AI-собеседника.');
    const sendCurrentDraft = () => {
        const content = draft.trim();
        if (!content)
            return;
        setDraft('');
        setTranscript((t) => [...t, { from: 'user', text: content }]);
        sendMutation.mutate({ content });
    };
    const onFinish = async () => {
        if (!sessionId)
            return;
        try {
            await finishMutation.mutateAsync();
            navigate(`/mock/${sessionId}/result`);
        }
        catch {
            // surfaced via mutation.isError; chip on top right
        }
    };
    // Build the live transcript: persisted lines + the in-flight streaming delta
    // shown as a fake AI line so the candidate sees the answer materialise.
    const liveLines = useMemo(() => {
        if (!streamingDelta)
            return transcript;
        return [...transcript, { from: 'ai', text: streamingDelta + '▍' }];
    }, [transcript, streamingDelta]);
    const durationMin = session?.duration_min ?? 45;
    return (_jsxs(AppShellV2, { children: [_jsxs("div", { className: "relative", children: [_jsxs("div", { className: "absolute right-4 top-4 z-10 flex items-center gap-2", children: [isError && _jsx(ErrorChip, {}), _jsx(WSStatus, { status: wsStatus })] }), _jsx(MatchHeader, { elapsedSec: elapsed, durationMin: durationMin, onFinish: onFinish, finishing: finishMutation.isPending })] }), _jsxs("div", { className: "flex flex-col gap-4 px-4 py-4 sm:px-8 lg:flex-row", children: [_jsxs("div", { className: "flex w-full flex-col gap-4 lg:w-[360px]", children: [_jsx(QuestionPanel, { title: qTitle, description: qDesc }), _jsx("div", { className: "hidden lg:block", children: _jsx(InterviewerPanel, {}) })] }), _jsxs("div", { className: "flex min-h-[400px] min-w-0 flex-1 flex-col gap-4", children: [_jsx(EditorPlaceholder, {}), _jsx(TranscriptCard, { messages: liveLines, pending: sendMutation.isPending && !streamingDelta }), _jsx(MessageBox, { value: draft, onChange: setDraft, onSend: sendCurrentDraft, sending: sendMutation.isPending, micOn: micOn, toggleMic: () => {
                                    setMicOn((on) => !on);
                                    if (!micOn && sessionId)
                                        navigate(`/mock/${sessionId}/voice`);
                                } })] }), _jsxs("div", { className: "flex w-full flex-col gap-4 lg:w-[320px]", children: [_jsx(ControlsCard, { micOn: micOn, toggleMic: () => setMicOn((v) => !v), onLeave: onFinish }), _jsx(StressCard, { stress: stress })] })] })] }));
}
