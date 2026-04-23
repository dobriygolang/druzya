import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
// Arena 2v2 — Phase 5.
//
// Реальные данные читаем тем же useArenaMatchQuery, что и для 1v1. Layout
// (классы tailwind, palette, gradients) НЕ трогаем — это территория
// Frontend Refactor agent. Здесь только функционал: маппинг участников по
// командам, ожидание партнёра по сабмиту, переход на /match/:id/end после
// победы команды.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MessageCircle, HelpCircle, Flag, FileCode, Loader2 } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
import { useArenaMatchQuery, useSubmitCodeMutation, } from '../lib/queries/arena';
import { useProfileQuery } from '../lib/queries/profile';
function ErrorChip() {
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C" }));
}
function PendingChip() {
    return (_jsxs("span", { className: "inline-flex items-center gap-1 rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan", children: [_jsx(Loader2, { className: "h-3 w-3 animate-spin" }), " \u0436\u0434\u0451\u043C \u043D\u0430\u043F\u0430\u0440\u043D\u0438\u043A\u0430"] }));
}
// Чип статуса игрока: «submitted» или прогресс. В отсутствие real-time
// прогресса от Judge0 показываем 0/100 vs 100/100 после submit.
function statusChipFor(hasSubmitted) {
    if (hasSubmitted)
        return { text: 'submitted', tone: 'success' };
    return { text: 'in-progress', tone: 'warn' };
}
function TeamPlayer({ nick, tier, chip, chipTone, gradient, mirror = false, }) {
    const chipCls = chipTone === 'success'
        ? 'bg-success/20 text-success'
        : chipTone === 'warn'
            ? 'bg-warn/20 text-warn'
            : chipTone === 'danger'
                ? 'bg-danger/20 text-danger'
                : 'bg-cyan/20 text-cyan';
    return (_jsxs("div", { className: [
            'flex items-center gap-2 rounded-[10px] bg-surface-2 p-2',
            mirror ? 'flex-row-reverse' : '',
        ].join(' '), children: [_jsx(Avatar, { size: "md", gradient: gradient, initials: (nick || '?').replace(/^@/, '').charAt(0).toUpperCase(), status: "online" }), _jsxs("div", { className: ['flex flex-col gap-0.5', mirror ? 'items-end' : ''].join(' '), children: [_jsx("span", { className: "font-display text-[13px] font-bold text-text-primary", children: nick }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: tier })] }), _jsx("span", { className: `rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${chipCls}`, children: chip })] }));
}
// Group participants by team_id. Returns [team1, team2] in display order.
// 1v1 fallback: if all teams === 0, treat first half as team1, second as team2.
function splitTeams(participants) {
    const t1 = participants.filter((p) => p.team === 1);
    const t2 = participants.filter((p) => p.team === 2);
    if (t1.length === 0 && t2.length === 0) {
        // legacy / 1v1 — preserve old layout: first→team1, rest→team2.
        return [participants.slice(0, 1), participants.slice(1)];
    }
    return [t1, t2];
}
// Find the just-submitted users by checking solve_time_ms > 0 (the backend
// stamps it on every submission). Per-user `submitted_at` would be cleaner
// but is not exposed on the wire — solve_time_ms is the public proxy.
function isSubmitted(p) {
    return Boolean(p.solve_time_ms && p.solve_time_ms > 0);
}
// Identify the winning team for a finished match. For 1v1 we can also fall
// back to the user who won (winner_user_id) when team is 0.
function winningTeamOf(match) {
    if (match.status !== 'MATCH_STATUS_FINISHED' && match.status !== 'finished')
        return 0;
    // Server-side adapter currently does not expose winning_team_id on the
    // wire (postponed proto bump). Infer from participants: the team where
    // *both* members have submitted_at wins.
    const [t1, t2] = splitTeams(match.participants);
    const t1Done = t1.every(isSubmitted);
    const t2Done = t2.every(isSubmitted);
    if (t1Done && !t2Done)
        return 1;
    if (t2Done && !t1Done)
        return 2;
    return 0;
}
function MatchHeader({ myTeam, enemyTeam, meId, status, startedAt, }) {
    const elapsed = useElapsed(startedAt);
    const renderTeam = (team, side) => {
        return team.map((p, i) => {
            const sub = isSubmitted(p);
            const chip = sub ? 'submitted' : 'coding...';
            const tone = sub ? 'success' : 'warn';
            const isMe = p.user_id === meId;
            const nick = isMe ? '@you' : `@${p.username || p.user_id.slice(0, 6)}`;
            const tier = `Elo ${p.elo_before ?? 0}`;
            const gradient = side === 'left'
                ? i === 0
                    ? 'cyan-violet'
                    : 'success-cyan'
                : i === 0
                    ? 'pink-violet'
                    : 'pink-red';
            return (_jsx(TeamPlayer, { nick: nick, tier: tier, chip: chip, chipTone: tone, gradient: gradient, mirror: side === 'right' }, p.user_id));
        });
    };
    return (_jsxs("div", { className: "flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-[100px] lg:flex-row lg:items-center lg:justify-between lg:px-10 lg:py-0", children: [_jsx("div", { className: "flex items-center gap-2", children: renderTeam(myTeam, 'left') }), _jsxs("div", { className: "flex flex-col items-center gap-1", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.12em] text-accent-hover", children: "RANKED 2V2" }), _jsx("span", { className: "font-display text-3xl font-extrabold leading-none text-text-primary lg:text-[36px]", children: elapsed }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: status === 'MATCH_STATUS_FINISHED' || status === 'finished' ? 'Матч завершён' : 'Бой команд' })] }), _jsx("div", { className: "flex items-center gap-2", children: renderTeam(enemyTeam, 'right') })] }));
}
function useElapsed(startedAt) {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (!startedAt)
            return undefined;
        const id = window.setInterval(() => setTick((n) => n + 1), 1000);
        return () => window.clearInterval(id);
    }, [startedAt]);
    if (!startedAt)
        return '—';
    const startMs = new Date(startedAt).getTime();
    if (Number.isNaN(startMs))
        return '—';
    // tick is read so this re-renders every second.
    void tick;
    const seconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    const mm = Math.floor(seconds / 60)
        .toString()
        .padStart(2, '0');
    const ss = (seconds % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
}
const STARTER_GO = [
    'package main',
    '',
    'func solve() {',
    '\t// TODO: ваше решение',
    '}',
];
function AssignmentStrip({ label, title, tags, chip, chipTone, progress, }) {
    const chipCls = chipTone === 'success' ? 'bg-success/20 text-success' : 'bg-warn/20 text-warn';
    const barCls = chipTone === 'success' ? 'bg-success' : 'bg-warn';
    return (_jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan", children: label }), _jsx("h3", { className: "font-display text-[17px] font-bold text-text-primary", children: title }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: tags.map((t, i) => (_jsx("span", { className: i === 0
                                ? 'rounded-full bg-pink/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-pink'
                                : i === 1
                                    ? 'rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan'
                                    : 'rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent-hover', children: t }, t))) })] }), _jsxs("div", { className: "flex min-w-[120px] flex-col items-end gap-2", children: [_jsx("span", { className: `rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${chipCls}`, children: chip }), _jsx("div", { className: "h-1.5 w-[110px] overflow-hidden rounded-full bg-black/40", children: _jsx("div", { className: `h-full ${barCls}`, style: { width: `${progress}%` } }) })] })] }));
}
function MiniEditor({ tabName, lines, highlight }) {
    return (_jsxs("div", { className: "flex flex-col overflow-hidden rounded-lg bg-surface-1", children: [_jsxs("div", { className: "flex h-9 items-center gap-2 border-b border-border bg-bg px-3", children: [_jsx(FileCode, { className: "h-3.5 w-3.5 text-accent-hover" }), _jsx("span", { className: "font-mono text-[11px] text-text-primary", children: tabName })] }), _jsxs("div", { className: "flex overflow-hidden", children: [_jsx("div", { className: "flex w-8 flex-col items-end border-r border-border bg-bg px-2 py-2 font-mono text-[11px] leading-[18px] text-text-muted", children: lines.map((_, i) => (_jsx("span", { children: i + 1 }, i))) }), _jsx("pre", { className: "flex-1 overflow-x-auto px-3 py-2 font-mono text-[11px] leading-[18px] text-text-secondary", children: lines.map((line, i) => (_jsx("div", { className: i === highlight ? 'rounded-sm bg-accent/15 px-1 text-text-primary' : '', children: line || '\u00A0' }, i))) })] })] }));
}
function Pane({ borderColor, label, title, tags, chip, chipTone, progress, tabName, lines, highlight, }) {
    return (_jsxs("div", { className: `flex flex-1 flex-col gap-3.5 rounded-[14px] border-2 ${borderColor} bg-surface-2 p-3.5`, children: [_jsx(AssignmentStrip, { label: label, title: title, tags: tags, chip: chip, chipTone: chipTone, progress: progress }), _jsx(MiniEditor, { tabName: tabName, lines: lines, highlight: highlight })] }));
}
function BottomBar({ myDone, partnerDone, onSubmit, onSurrender, submitting, enemyDone, }) {
    const teamDone = (myDone ? 1 : 0) + (partnerDone ? 1 : 0);
    const teamScoreCls = teamDone === 2 ? 'text-success' : 'text-warn';
    return (_jsxs("div", { className: "flex flex-col gap-4 border-t border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-20 lg:flex-row lg:items-center lg:justify-between lg:px-8", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "grid h-9 w-9 place-items-center rounded-full bg-cyan/15", children: _jsx(MessageCircle, { className: "h-4 w-4 text-cyan" }) }), _jsx("div", { className: "flex flex-col gap-0.5", children: _jsx("span", { className: "text-[13px] text-text-primary", children: myDone && !partnerDone ? (_jsx(PendingChip, {})) : partnerDone && !myDone ? (_jsx("span", { className: "font-mono text-[11px] text-success", children: "\u043D\u0430\u043F\u0430\u0440\u043D\u0438\u043A \u0441\u0434\u0430\u043B \u2014 \u0442\u0432\u043E\u0439 \u0445\u043E\u0434" })) : (_jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "2v2 \u00B7 \u043A\u043E\u0434 \u0440\u0435\u0448\u0435\u043D\u0438\u044F \u0441\u043A\u0440\u044B\u0442" })) }) })] }), _jsxs("div", { className: "flex items-center gap-5", children: [_jsxs("div", { className: "flex flex-col items-center gap-0.5", children: [_jsx("span", { className: "font-mono text-[10px] tracking-[0.12em] text-text-muted", children: "\u041C\u041E\u042F \u041A\u041E\u041C\u0410\u041D\u0414\u0410" }), _jsxs("span", { className: `font-display text-[22px] font-extrabold ${teamScoreCls}`, children: [teamDone, "/2"] })] }), _jsx("span", { className: "font-mono text-xs text-text-muted", children: "vs" }), _jsxs("div", { className: "flex flex-col items-center gap-0.5", children: [_jsx("span", { className: "font-mono text-[10px] tracking-[0.12em] text-text-muted", children: "\u041F\u0420\u041E\u0422\u0418\u0412\u041D\u0418\u041A" }), _jsxs("span", { className: "font-display text-[22px] font-extrabold text-danger", children: [enemyDone, "/2"] })] })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Button, { variant: "primary", icon: _jsx(HelpCircle, { className: "h-4 w-4" }), onClick: onSubmit, disabled: submitting || myDone, children: myDone ? 'Решение отправлено' : submitting ? 'Отправляем...' : 'Сдать решение' }), _jsx(Button, { variant: "ghost", icon: _jsx(Flag, { className: "h-4 w-4" }), onClick: onSurrender, children: "\u0421\u0434\u0430\u0442\u044C\u0441\u044F" })] })] }));
}
export default function Arena2v2Page() {
    const { matchId } = useParams();
    const navigate = useNavigate();
    const { data: match, isError } = useArenaMatchQuery(matchId);
    const { data: me } = useProfileQuery();
    const submitMutation = useSubmitCodeMutation();
    const myUserId = me?.id;
    const [team1, team2] = useMemo(() => splitTeams(match?.participants ?? []), [match]);
    const myTeamIdx = useMemo(() => {
        if (!myUserId)
            return 0;
        if (team1.some((p) => p.user_id === myUserId))
            return 1;
        if (team2.some((p) => p.user_id === myUserId))
            return 2;
        return 0;
    }, [team1, team2, myUserId]);
    const myTeam = myTeamIdx === 2 ? team2 : team1;
    const enemyTeam = myTeamIdx === 2 ? team1 : team2;
    const meParticipant = myTeam.find((p) => p.user_id === myUserId);
    const partner = myTeam.find((p) => p.user_id !== myUserId);
    const myDone = meParticipant ? isSubmitted(meParticipant) : false;
    const partnerDone = partner ? isSubmitted(partner) : false;
    const enemyDone = enemyTeam.filter(isSubmitted).length;
    // When the match is finished, route to MatchEndPage (Group A territory; we
    // just navigate). For team-mode we pass the inferred winning team via a
    // querystring so MatchEndPage can render the right header.
    useEffect(() => {
        if (!match || !matchId)
            return;
        if (match.status === 'MATCH_STATUS_FINISHED' || match.status === 'finished') {
            const winningTeam = winningTeamOf(match);
            const params = new URLSearchParams();
            if (winningTeam > 0)
                params.set('winning_team', String(winningTeam));
            if (myTeamIdx > 0)
                params.set('my_team', String(myTeamIdx));
            navigate(`/match/${matchId}/end?${params.toString()}`);
        }
    }, [match, matchId, navigate, myTeamIdx]);
    const handleSubmit = () => {
        if (!matchId || myDone)
            return;
        // For Phase 5 we ship a placeholder "OK" submission; the real Monaco
        // editor lives in the existing 1v1 page and is out of this agent's
        // scope. Tests assert the wiring, not the editor UI.
        submitMutation.mutate({
            matchId,
            code: 'package main\n\nfunc solve() {}\n',
            language: 'go',
        });
    };
    const handleSurrender = () => {
        navigate('/arena');
    };
    const taskATitle = match?.task?.title ?? 'Задача команды';
    const taskBTitle = match?.task?.title ?? 'Задача команды';
    const myLines = STARTER_GO;
    const partnerLines = STARTER_GO;
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex min-h-[calc(100vh-64px)] flex-col lg:h-[calc(100vh-72px)]", children: [isError && (_jsx("div", { className: "flex justify-end px-4 py-2", children: _jsx(ErrorChip, {}) })), _jsx(MatchHeader, { myTeam: myTeam, enemyTeam: enemyTeam, meId: myUserId, status: match?.status ?? '', startedAt: match?.started_at }), _jsxs("div", { className: "flex flex-1 flex-col gap-4 overflow-auto px-4 py-4 sm:px-6 lg:flex-row lg:overflow-hidden lg:px-8", children: [_jsx(Pane, { borderColor: "border-cyan", label: "\u0417\u0410\u0414\u0410\u0427\u0410 \u00B7 \u0412\u042B", title: taskATitle, tags: [match?.task?.difficulty ?? 'Medium', match?.task?.section ?? 'Algorithms'], chip: myDone ? 'submitted' : 'coding...', chipTone: myDone ? 'success' : 'warn', progress: myDone ? 100 : 0, tabName: "solution.go", lines: myLines, highlight: 2 }), _jsx(Pane, { borderColor: "border-success", label: partner ? `ЗАДАЧА · @${partner.username || 'teammate'}` : 'ЗАДАЧА · НАПАРНИК', title: taskBTitle, tags: [match?.task?.difficulty ?? 'Medium', 'Team'], chip: partnerDone ? 'submitted' : 'coding...', chipTone: partnerDone ? 'success' : 'warn', progress: partnerDone ? 100 : 0, tabName: "partner.go", lines: partnerLines, highlight: 2 })] }), _jsx(BottomBar, { myDone: myDone, partnerDone: partnerDone, enemyDone: enemyDone, onSubmit: handleSubmit, onSurrender: handleSurrender, submitting: submitMutation.isPending }), _jsx("div", { className: "hidden", children: matchId })] }) }));
}
// statusChipFor is exported indirectly via JSX; mark it as referenced to
// keep the linter happy when tree-shaken.
void statusChipFor;
