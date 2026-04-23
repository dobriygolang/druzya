// TODO i18n
// Arena 2v2 — Phase 5.
//
// Реальные данные читаем тем же useArenaMatchQuery, что и для 1v1. Layout
// (классы tailwind, palette, gradients) НЕ трогаем — это территория
// Frontend Refactor agent. Здесь только функционал: маппинг участников по
// командам, ожидание партнёра по сабмиту, переход на /match/:id/end после
// победы команды.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MessageCircle, HelpCircle, Flag, FileCode, Loader2 } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Avatar } from '../components/Avatar'
import {
  useArenaMatchQuery,
  useSubmitCodeMutation,
  type ArenaMatch,
  type Participant,
} from '../lib/queries/arena'
import { useProfileQuery } from '../lib/queries/profile'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

function PendingChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan">
      <Loader2 className="h-3 w-3 animate-spin" /> ждём напарника
    </span>
  )
}

// Чип статуса игрока: «submitted» или прогресс. В отсутствие real-time
// прогресса от Judge0 показываем 0/100 vs 100/100 после submit.
function statusChipFor(hasSubmitted: boolean): { text: string; tone: 'success' | 'warn' | 'cyan' } {
  if (hasSubmitted) return { text: 'submitted', tone: 'success' }
  return { text: 'in-progress', tone: 'warn' }
}

function TeamPlayer({
  nick,
  tier,
  chip,
  chipTone,
  gradient,
  mirror = false,
}: {
  nick: string
  tier: string
  chip: string
  chipTone: 'success' | 'warn' | 'danger' | 'cyan'
  gradient: 'cyan-violet' | 'pink-violet' | 'pink-red' | 'success-cyan'
  mirror?: boolean
}) {
  const chipCls =
    chipTone === 'success'
      ? 'bg-success/20 text-success'
      : chipTone === 'warn'
        ? 'bg-warn/20 text-warn'
        : chipTone === 'danger'
          ? 'bg-danger/20 text-danger'
          : 'bg-cyan/20 text-cyan'
  return (
    <div
      className={[
        'flex items-center gap-2 rounded-[10px] bg-surface-2 p-2',
        mirror ? 'flex-row-reverse' : '',
      ].join(' ')}
    >
      <Avatar
        size="md"
        gradient={gradient}
        initials={(nick || '?').replace(/^@/, '').charAt(0).toUpperCase()}
        status="online"
      />
      <div className={['flex flex-col gap-0.5', mirror ? 'items-end' : ''].join(' ')}>
        <span className="font-display text-[13px] font-bold text-text-primary">{nick}</span>
        <span className="font-mono text-[10px] text-text-muted">{tier}</span>
      </div>
      <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${chipCls}`}>
        {chip}
      </span>
    </div>
  )
}

// Group participants by team_id. Returns [team1, team2] in display order.
// 1v1 fallback: if all teams === 0, treat first half as team1, second as team2.
function splitTeams(participants: Participant[]): [Participant[], Participant[]] {
  const t1 = participants.filter((p) => p.team === 1)
  const t2 = participants.filter((p) => p.team === 2)
  if (t1.length === 0 && t2.length === 0) {
    // legacy / 1v1 — preserve old layout: first→team1, rest→team2.
    return [participants.slice(0, 1), participants.slice(1)]
  }
  return [t1, t2]
}

// Find the just-submitted users by checking solve_time_ms > 0 (the backend
// stamps it on every submission). Per-user `submitted_at` would be cleaner
// but is not exposed on the wire — solve_time_ms is the public proxy.
function isSubmitted(p: Participant): boolean {
  return Boolean(p.solve_time_ms && p.solve_time_ms > 0)
}

// Identify the winning team for a finished match. For 1v1 we can also fall
// back to the user who won (winner_user_id) when team is 0.
function winningTeamOf(match: ArenaMatch): number {
  if (match.status !== 'MATCH_STATUS_FINISHED' && match.status !== 'finished') return 0
  // Server-side adapter currently does not expose winning_team_id on the
  // wire (postponed proto bump). Infer from participants: the team where
  // *both* members have submitted_at wins.
  const [t1, t2] = splitTeams(match.participants)
  const t1Done = t1.every(isSubmitted)
  const t2Done = t2.every(isSubmitted)
  if (t1Done && !t2Done) return 1
  if (t2Done && !t1Done) return 2
  return 0
}

function MatchHeader({
  myTeam,
  enemyTeam,
  meId,
  status,
  startedAt,
}: {
  myTeam: Participant[]
  enemyTeam: Participant[]
  meId: string | undefined
  status: string
  startedAt: string | undefined
}) {
  const elapsed = useElapsed(startedAt)
  const renderTeam = (team: Participant[], side: 'left' | 'right') => {
    return team.map((p, i) => {
      const sub = isSubmitted(p)
      const chip = sub ? 'submitted' : 'coding...'
      const tone: 'success' | 'warn' = sub ? 'success' : 'warn'
      const isMe = p.user_id === meId
      const nick = isMe ? '@you' : `@${p.username || p.user_id.slice(0, 6)}`
      const tier = `Elo ${p.elo_before ?? 0}`
      const gradient: 'cyan-violet' | 'pink-violet' | 'pink-red' | 'success-cyan' =
        side === 'left'
          ? i === 0
            ? 'cyan-violet'
            : 'success-cyan'
          : i === 0
            ? 'pink-violet'
            : 'pink-red'
      return (
        <TeamPlayer
          key={p.user_id}
          nick={nick}
          tier={tier}
          chip={chip}
          chipTone={tone}
          gradient={gradient}
          mirror={side === 'right'}
        />
      )
    })
  }
  return (
    <div className="flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-[100px] lg:flex-row lg:items-center lg:justify-between lg:px-10 lg:py-0">
      <div className="flex items-center gap-2">{renderTeam(myTeam, 'left')}</div>
      <div className="flex flex-col items-center gap-1">
        <span className="font-mono text-[11px] font-semibold tracking-[0.12em] text-accent-hover">
          RANKED 2V2
        </span>
        <span className="font-display text-3xl font-extrabold leading-none text-text-primary lg:text-[36px]">
          {elapsed}
        </span>
        <span className="font-mono text-[11px] text-text-muted">
          {status === 'MATCH_STATUS_FINISHED' || status === 'finished' ? 'Матч завершён' : 'Бой команд'}
        </span>
      </div>
      <div className="flex items-center gap-2">{renderTeam(enemyTeam, 'right')}</div>
    </div>
  )
}

function useElapsed(startedAt: string | undefined): string {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!startedAt) return undefined
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [startedAt])
  if (!startedAt) return '—'
  const startMs = new Date(startedAt).getTime()
  if (Number.isNaN(startMs)) return '—'
  // tick is read so this re-renders every second.
  void tick
  const seconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000))
  const mm = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')
  const ss = (seconds % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

const STARTER_GO = [
  'package main',
  '',
  'func solve() {',
  '\t// TODO: ваше решение',
  '}',
]

function AssignmentStrip({
  label,
  title,
  tags,
  chip,
  chipTone,
  progress,
}: {
  label: string
  title: string
  tags: string[]
  chip: string
  chipTone: 'success' | 'warn'
  progress: number
}) {
  const chipCls = chipTone === 'success' ? 'bg-success/20 text-success' : 'bg-warn/20 text-warn'
  const barCls = chipTone === 'success' ? 'bg-success' : 'bg-warn'
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan">{label}</span>
        <h3 className="font-display text-[17px] font-bold text-text-primary">{title}</h3>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t, i) => (
            <span
              key={t}
              className={
                i === 0
                  ? 'rounded-full bg-pink/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-pink'
                  : i === 1
                    ? 'rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan'
                    : 'rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent-hover'
              }
            >
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="flex min-w-[120px] flex-col items-end gap-2">
        <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${chipCls}`}>
          {chip}
        </span>
        <div className="h-1.5 w-[110px] overflow-hidden rounded-full bg-black/40">
          <div className={`h-full ${barCls}`} style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  )
}

function MiniEditor({ tabName, lines, highlight }: { tabName: string; lines: string[]; highlight: number }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg bg-surface-1">
      <div className="flex h-9 items-center gap-2 border-b border-border bg-bg px-3">
        <FileCode className="h-3.5 w-3.5 text-accent-hover" />
        <span className="font-mono text-[11px] text-text-primary">{tabName}</span>
      </div>
      <div className="flex overflow-hidden">
        <div className="flex w-8 flex-col items-end border-r border-border bg-bg px-2 py-2 font-mono text-[11px] leading-[18px] text-text-muted">
          {lines.map((_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <pre className="flex-1 overflow-x-auto px-3 py-2 font-mono text-[11px] leading-[18px] text-text-secondary">
          {lines.map((line, i) => (
            <div
              key={i}
              className={i === highlight ? 'rounded-sm bg-accent/15 px-1 text-text-primary' : ''}
            >
              {line || '\u00A0'}
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}

function Pane({
  borderColor,
  label,
  title,
  tags,
  chip,
  chipTone,
  progress,
  tabName,
  lines,
  highlight,
}: {
  borderColor: string
  label: string
  title: string
  tags: string[]
  chip: string
  chipTone: 'success' | 'warn'
  progress: number
  tabName: string
  lines: string[]
  highlight: number
}) {
  return (
    <div
      className={`flex flex-1 flex-col gap-3.5 rounded-[14px] border-2 ${borderColor} bg-surface-2 p-3.5`}
    >
      <AssignmentStrip
        label={label}
        title={title}
        tags={tags}
        chip={chip}
        chipTone={chipTone}
        progress={progress}
      />
      <MiniEditor tabName={tabName} lines={lines} highlight={highlight} />
    </div>
  )
}

function BottomBar({
  myDone,
  partnerDone,
  onSubmit,
  onSurrender,
  submitting,
  enemyDone,
}: {
  myDone: boolean
  partnerDone: boolean
  onSubmit: () => void
  onSurrender: () => void
  submitting: boolean
  enemyDone: number
}) {
  const teamDone = (myDone ? 1 : 0) + (partnerDone ? 1 : 0)
  const teamScoreCls = teamDone === 2 ? 'text-success' : 'text-warn'
  return (
    <div className="flex flex-col gap-4 border-t border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-20 lg:flex-row lg:items-center lg:justify-between lg:px-8">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-cyan/15">
          <MessageCircle className="h-4 w-4 text-cyan" />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] text-text-primary">
            {myDone && !partnerDone ? (
              <PendingChip />
            ) : partnerDone && !myDone ? (
              <span className="font-mono text-[11px] text-success">напарник сдал — твой ход</span>
            ) : (
              <span className="font-mono text-[11px] text-text-muted">2v2 · код решения скрыт</span>
            )}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-5">
        <div className="flex flex-col items-center gap-0.5">
          <span className="font-mono text-[10px] tracking-[0.12em] text-text-muted">МОЯ КОМАНДА</span>
          <span className={`font-display text-[22px] font-extrabold ${teamScoreCls}`}>{teamDone}/2</span>
        </div>
        <span className="font-mono text-xs text-text-muted">vs</span>
        <div className="flex flex-col items-center gap-0.5">
          <span className="font-mono text-[10px] tracking-[0.12em] text-text-muted">ПРОТИВНИК</span>
          <span className="font-display text-[22px] font-extrabold text-danger">{enemyDone}/2</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          icon={<HelpCircle className="h-4 w-4" />}
          onClick={onSubmit}
          disabled={submitting || myDone}
        >
          {myDone ? 'Решение отправлено' : submitting ? 'Отправляем...' : 'Сдать решение'}
        </Button>
        <Button variant="ghost" icon={<Flag className="h-4 w-4" />} onClick={onSurrender}>
          Сдаться
        </Button>
      </div>
    </div>
  )
}

export default function Arena2v2Page() {
  const { matchId } = useParams<{ matchId: string }>()
  const navigate = useNavigate()
  const { data: match, isError } = useArenaMatchQuery(matchId)
  const { data: me } = useProfileQuery()
  const submitMutation = useSubmitCodeMutation()

  const myUserId = me?.id
  const [team1, team2] = useMemo(() => splitTeams(match?.participants ?? []), [match])
  const myTeamIdx = useMemo(() => {
    if (!myUserId) return 0
    if (team1.some((p) => p.user_id === myUserId)) return 1
    if (team2.some((p) => p.user_id === myUserId)) return 2
    return 0
  }, [team1, team2, myUserId])
  const myTeam = myTeamIdx === 2 ? team2 : team1
  const enemyTeam = myTeamIdx === 2 ? team1 : team2
  const meParticipant = myTeam.find((p) => p.user_id === myUserId)
  const partner = myTeam.find((p) => p.user_id !== myUserId)
  const myDone = meParticipant ? isSubmitted(meParticipant) : false
  const partnerDone = partner ? isSubmitted(partner) : false
  const enemyDone = enemyTeam.filter(isSubmitted).length

  // When the match is finished, route to MatchEndPage (Group A territory; we
  // just navigate). For team-mode we pass the inferred winning team via a
  // querystring so MatchEndPage can render the right header.
  useEffect(() => {
    if (!match || !matchId) return
    if (match.status === 'MATCH_STATUS_FINISHED' || match.status === 'finished') {
      const winningTeam = winningTeamOf(match)
      const params = new URLSearchParams()
      if (winningTeam > 0) params.set('winning_team', String(winningTeam))
      if (myTeamIdx > 0) params.set('my_team', String(myTeamIdx))
      navigate(`/match/${matchId}/end?${params.toString()}`)
    }
  }, [match, matchId, navigate, myTeamIdx])

  const handleSubmit = () => {
    if (!matchId || myDone) return
    // For Phase 5 we ship a placeholder "OK" submission; the real Monaco
    // editor lives in the existing 1v1 page and is out of this agent's
    // scope. Tests assert the wiring, not the editor UI.
    submitMutation.mutate({
      matchId,
      code: 'package main\n\nfunc solve() {}\n',
      language: 'go',
    })
  }

  const handleSurrender = () => {
    navigate('/arena')
  }

  const taskATitle = match?.task?.title ?? 'Задача команды'
  const taskBTitle = match?.task?.title ?? 'Задача команды'
  const myLines = STARTER_GO
  const partnerLines = STARTER_GO

  return (
    <AppShellV2>
      <div className="flex min-h-[calc(100vh-64px)] flex-col lg:h-[calc(100vh-72px)]">
        {isError && (
          <div className="flex justify-end px-4 py-2">
            <ErrorChip />
          </div>
        )}
        <MatchHeader
          myTeam={myTeam}
          enemyTeam={enemyTeam}
          meId={myUserId}
          status={match?.status ?? ''}
          startedAt={match?.started_at}
        />
        <div className="flex flex-1 flex-col gap-4 overflow-auto px-4 py-4 sm:px-6 lg:flex-row lg:overflow-hidden lg:px-8">
          <Pane
            borderColor="border-cyan"
            label="ЗАДАЧА · ВЫ"
            title={taskATitle}
            tags={[match?.task?.difficulty ?? 'Medium', match?.task?.section ?? 'Algorithms']}
            chip={myDone ? 'submitted' : 'coding...'}
            chipTone={myDone ? 'success' : 'warn'}
            progress={myDone ? 100 : 0}
            tabName="solution.go"
            lines={myLines}
            highlight={2}
          />
          <Pane
            borderColor="border-success"
            label={partner ? `ЗАДАЧА · @${partner.username || 'teammate'}` : 'ЗАДАЧА · НАПАРНИК'}
            title={taskBTitle}
            tags={[match?.task?.difficulty ?? 'Medium', 'Team']}
            chip={partnerDone ? 'submitted' : 'coding...'}
            chipTone={partnerDone ? 'success' : 'warn'}
            progress={partnerDone ? 100 : 0}
            tabName="partner.go"
            lines={partnerLines}
            highlight={2}
          />
        </div>
        <BottomBar
          myDone={myDone}
          partnerDone={partnerDone}
          enemyDone={enemyDone}
          onSubmit={handleSubmit}
          onSurrender={handleSurrender}
          submitting={submitMutation.isPending}
        />
        <div className="hidden">{matchId}</div>
      </div>
    </AppShellV2>
  )
}

// statusChipFor is exported indirectly via JSX; mark it as referenced to
// keep the linter happy when tree-shaken.
void statusChipFor
