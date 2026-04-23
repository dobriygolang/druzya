import { useMemo, useState } from 'react'
import { Copy, UserPlus, Swords, MessageSquare, Check, X, UserMinus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { Tabs } from '../components/Tabs'
import {
  useFriendsQuery,
  useIncomingFriendsQuery,
  useFriendSuggestionsQuery,
  useFriendCodeQuery,
  useBlockedFriendsQuery,
  useAddFriend,
  useAcceptFriend,
  useDeclineFriend,
  useUnfriend,
  useUnblockUser,
  recentSorted,
  type FriendDTO,
} from '../lib/queries/friends'

function ErrorChip() {
  const { t } = useTranslation('pages')
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      {t('common.load_failed')}
    </span>
  )
}

type Gradient = 'violet-cyan' | 'pink-violet' | 'cyan-violet' | 'pink-red' | 'success-cyan' | 'gold'

const GRADIENTS: Gradient[] = ['violet-cyan', 'pink-violet', 'cyan-violet', 'pink-red', 'success-cyan', 'gold']

// hashGradient — стабильный выбор градиента по строке (username/uid),
// чтобы цвет аватарки не прыгал между ре-рендерами.
function hashGradient(seed: string): Gradient {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return GRADIENTS[Math.abs(h) % GRADIENTS.length]
}

function FriendCard({
  f,
  onChallenge,
  onChat,
  onUnfriend,
}: {
  f: FriendDTO
  onChallenge: () => void
  onChat: () => void
  onUnfriend: () => void
}) {
  const { t } = useTranslation('pages')
  const initial = (f.display_name || f.username || '?').charAt(0).toUpperCase()
  const tier = f.tier || t('friends.tier_unranked', 'Unranked')
  // Anti-fallback: f.online removed (no presence service). Status derives
  // from last_match_at only.
  const status = f.last_match_at
    ? new Date(f.last_match_at).toLocaleDateString()
    : t('friends.never_played', 'Не играли')
  return (
    <Card className="flex-col gap-3 p-5">
      <div className="flex items-center gap-3">
        <Avatar size="lg" gradient={hashGradient(f.user_id)} initials={initial} />
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="font-display text-sm font-bold text-text-primary">@{f.username}</span>
          <span className="font-mono text-[11px] text-text-muted">{tier}</span>
        </div>
      </div>
      <span className="inline-flex w-fit items-center rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10px] font-semibold text-text-muted">
        {status}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" icon={<Swords className="h-3.5 w-3.5" />} className="flex-1" onClick={onChallenge}>
          {t('friends.challenge')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          className="flex-1"
          onClick={onChat}
          title={t('friends.chat_wip', 'Скоро')}
        >
          {t('friends.chat')}
        </Button>
        <button
          type="button"
          onClick={onUnfriend}
          className="grid h-8 w-8 place-items-center rounded-md bg-danger/10 text-danger hover:bg-danger/25"
          title={t('friends.unfriend', 'Удалить из друзей')}
        >
          <UserMinus className="h-4 w-4" />
        </button>
      </div>
    </Card>
  )
}

function SuggestionRow({ f, onAdd, busy }: { f: FriendDTO; onAdd: () => void; busy: boolean }) {
  const { t } = useTranslation('pages')
  const initial = (f.display_name || f.username || '?').charAt(0).toUpperCase()
  return (
    <div className="flex items-center gap-3">
      <Avatar size="sm" gradient={hashGradient(f.user_id)} initials={initial} />
      <div className="flex flex-1 flex-col">
        <span className="text-sm font-semibold text-text-primary">@{f.username}</span>
        <span className="font-mono text-[10px] text-text-muted">{f.tier || ''}</span>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onAdd}
        className="text-xs font-semibold text-accent-hover hover:text-accent disabled:opacity-50"
      >
        {t('friends.add')}
      </button>
    </div>
  )
}

function IncomingRow({
  r,
  onAccept,
  onDecline,
  busy,
}: {
  r: FriendDTO
  onAccept: () => void
  onDecline: () => void
  busy: boolean
}) {
  const initial = (r.display_name || r.username || '?').charAt(0).toUpperCase()
  return (
    <div className="flex items-center gap-3">
      <Avatar size="md" gradient={hashGradient(r.user_id)} initials={initial} />
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-text-primary">@{r.username}</span>
        <span className="text-[11px] text-text-muted">{r.tier || ''}</span>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onAccept}
        className="grid h-8 w-8 place-items-center rounded-md bg-success/15 text-success hover:bg-success/25 disabled:opacity-50"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onDecline}
        className="grid h-8 w-8 place-items-center rounded-md bg-danger/15 text-danger hover:bg-danger/25 disabled:opacity-50"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

function CardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-[180px] animate-pulse rounded-2xl bg-surface-2" />
      ))}
    </div>
  )
}

function FindByCodeCard() {
  const { t } = useTranslation('pages')
  const [code, setCode] = useState('')
  const add = useAddFriend()
  const onSubmit = () => {
    if (!code.trim()) return
    add.mutate({ code: code.trim() }, { onSettled: () => setCode('') })
  }
  return (
    <Card className="flex-col gap-3 p-5">
      <h3 className="font-display text-base font-bold text-text-primary">{t('friends.find_by_code')}</h3>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit()
          }}
          className="h-9 flex-1 rounded-md border border-border bg-surface-2 px-3 font-mono text-[13px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          placeholder="DRUZ9-XXXX-XXX"
        />
        <Button size="sm" variant="primary" disabled={add.isPending} onClick={onSubmit}>
          {t('friends.find_btn')}
        </Button>
      </div>
      {add.isError && (
        <span className="text-[11px] text-danger">{t('friends.code_error', 'Код не найден или истёк.')}</span>
      )}
      {add.isSuccess && add.data?.already && (
        <span className="text-[11px] text-text-muted">{t('friends.already_friends', 'Уже в списке.')}</span>
      )}
    </Card>
  )
}

// Anti-fallback: 'online' tab removed alongside the FriendDTO.online field
// (no real presence service exists; the AlwaysOffline stub used to show
// every user as offline anyway).
type Tab = 'all' | 'requests' | 'blocked'

export default function FriendsPage() {
  const { t } = useTranslation('pages')
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('all')

  const friends = useFriendsQuery()
  const incoming = useIncomingFriendsQuery()
  const suggestions = useFriendSuggestionsQuery()
  const code = useFriendCodeQuery()
  const blocked = useBlockedFriendsQuery()

  const accept = useAcceptFriend()
  const decline = useDeclineFriend()
  const unfriend = useUnfriend()
  const unblock = useUnblockUser()
  const add = useAddFriend()

  const isError = friends.isError || incoming.isError

  // Stabilise the accepted reference: `friends.data?.accepted ?? []` would
  // recreate the empty array on every render and break the useMemo deps.
  const accepted = useMemo(() => friends.data?.accepted ?? [], [friends.data?.accepted])
  const recentList = useMemo(() => recentSorted(accepted), [accepted])
  const incomingList = incoming.data ?? []
  const suggestionList = suggestions.data ?? []
  const blockedList = blocked.data ?? []

  // Anti-fallback: `online` count + `guild` count removed (no presence
  // service; friends API doesn't expose guild-membership cross-join). When
  // either landing — restore via the corresponding field on FriendListEntry.
  const counts = {
    total: friends.data?.total ?? accepted.length,
    requests: incomingList.length,
    blocked: blockedList.length,
  }

  const friendCode = code.data?.code ?? '...'

  const handleChallenge = (uid: string) => navigate(`/arena?opponent=${encodeURIComponent(uid)}`)
  const handleChat = () => {
    /* chat-страница ещё не существует — кнопка disabled через title */
  }

  const visibleAll = tab === 'all'
  const visibleRequests = tab === 'requests'
  const visibleBlocked = tab === 'blocked'

  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <div className="flex flex-col items-start gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display text-2xl lg:text-[32px] font-bold text-text-primary">{t('friends.title')}</h1>
            <p className="text-sm text-text-secondary">
              {t('friends.summary', { online: 0, total: counts.total, requests: counts.requests })}
            </p>
            {isError && <ErrorChip />}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="ghost"
              icon={<Copy className="h-4 w-4" />}
              onClick={() => {
                if (typeof window !== 'undefined' && navigator.clipboard && code.data?.code) {
                  void navigator.clipboard.writeText(code.data.code)
                }
              }}
              title={t('friends.copy_code', 'Скопировать код')}
            >
              <span className="font-mono text-xs">{friendCode}</span>
            </Button>
          </div>
        </div>

        <Tabs variant="pills" value={tab} onChange={(v) => setTab(v as Tab)}>
          <Tabs.List>
            <Tabs.Tab id="all">{t('friends.all')} {counts.total}</Tabs.Tab>
            <Tabs.Tab id="requests">
              <span className="inline-flex items-center gap-1.5">
                {t('friends.requests')} {counts.requests}
                {counts.requests > 0 && <span className="h-1.5 w-1.5 rounded-full bg-danger" />}
              </span>
            </Tabs.Tab>
            {/* "guild" tab dropped: friends API doesn't expose guild-membership cross-join. */}
            <Tabs.Tab id="blocked">{t('friends.blocked')} {counts.blocked}</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <div className="flex flex-1 flex-col gap-6">
            {visibleAll && (
              <div className="flex flex-col gap-3">
                <h2 className="font-display text-lg font-bold text-text-primary">{t('friends.recent')}</h2>
                {friends.isLoading ? (
                  <CardSkeleton />
                ) : recentList.length === 0 ? (
                  <Card className="p-6 text-sm text-text-secondary">
                    {t('friends.empty_friends', 'Список друзей пуст — добавь кого-нибудь!')}
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {recentList.map((f) => (
                      <FriendCard
                        key={f.user_id}
                        f={f}
                        onChallenge={() => handleChallenge(f.user_id)}
                        onChat={handleChat}
                        onUnfriend={() => unfriend.mutate(f.user_id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {visibleRequests && (
              <div className="flex flex-col gap-3">
                <h2 className="font-display text-lg font-bold text-text-primary">{t('friends.incoming')}</h2>
                {incoming.isLoading ? (
                  <Card className="h-24 animate-pulse" />
                ) : incomingList.length === 0 ? (
                  <Card className="p-6 text-sm text-text-secondary">{t('friends.empty_requests', 'Заявок нет.')}</Card>
                ) : (
                  <Card className="flex-col gap-3 border-accent/40 p-5">
                    {incomingList.map((r) => (
                      <IncomingRow
                        key={r.user_id}
                        r={r}
                        busy={accept.isPending || decline.isPending}
                        onAccept={() => r.friendship_id && accept.mutate(r.friendship_id)}
                        onDecline={() => r.friendship_id && decline.mutate(r.friendship_id)}
                      />
                    ))}
                  </Card>
                )}
              </div>
            )}

            {visibleBlocked && (
              <div className="flex flex-col gap-3">
                <h2 className="font-display text-lg font-bold text-text-primary">{t('friends.blocked')}</h2>
                {blocked.isLoading ? (
                  <Card className="h-24 animate-pulse" />
                ) : blockedList.length === 0 ? (
                  <Card className="p-6 text-sm text-text-secondary">{t('friends.empty_blocked', 'Список заблокированных пуст.')}</Card>
                ) : (
                  <Card className="flex-col gap-2 p-5">
                    {blockedList.map((b) => (
                      <div key={b.user_id} className="flex items-center gap-3">
                        <Avatar size="sm" gradient={hashGradient(b.user_id)} initials={(b.username || '?').charAt(0).toUpperCase()} />
                        <span className="flex-1 text-sm text-text-primary">@{b.username}</span>
                        <button
                          type="button"
                          onClick={() => unblock.mutate(b.user_id)}
                          disabled={unblock.isPending}
                          className="text-xs font-semibold text-accent-hover hover:text-accent disabled:opacity-50"
                        >
                          {t('friends.unblock', 'Разблок')}
                        </button>
                      </div>
                    ))}
                  </Card>
                )}
              </div>
            )}
          </div>

          <div className="flex w-full flex-col gap-4 lg:w-[380px]">
            <Card className="flex-col gap-3 border-accent/40 p-5">
              <h3 className="font-display text-base font-bold text-text-primary">{t('friends.incoming')}</h3>
              {incoming.isLoading ? (
                <div className="h-16 animate-pulse rounded bg-surface-2" />
              ) : incomingList.length === 0 ? (
                <span className="text-[12px] text-text-secondary">{t('friends.empty_requests', 'Заявок нет.')}</span>
              ) : (
                incomingList.slice(0, 4).map((r) => (
                  <IncomingRow
                    key={r.user_id}
                    r={r}
                    busy={accept.isPending || decline.isPending}
                    onAccept={() => r.friendship_id && accept.mutate(r.friendship_id)}
                    onDecline={() => r.friendship_id && decline.mutate(r.friendship_id)}
                  />
                ))
              )}
            </Card>

            <Card className="flex-col gap-3 p-5">
              <h3 className="font-display text-base font-bold text-text-primary">{t('friends.suggestions')}</h3>
              {suggestions.isLoading ? (
                <div className="h-16 animate-pulse rounded bg-surface-2" />
              ) : suggestionList.length === 0 ? (
                <span className="text-[12px] text-text-secondary">{t('friends.empty_suggestions', 'Пока никого не рекомендуем.')}</span>
              ) : (
                suggestionList.map((s) => (
                  <SuggestionRow
                    key={s.user_id}
                    f={s}
                    busy={add.isPending}
                    onAdd={() => add.mutate({ user_id: s.user_id })}
                  />
                ))
              )}
            </Card>

            <FindByCodeCard />

            <Card className="flex-col gap-2 p-5">
              <h3 className="font-display text-base font-bold text-text-primary">{t('friends.find', 'Найти друзей')}</h3>
              <p className="text-[12px] text-text-secondary">
                {t('friends.share_code_hint', 'Поделись своим кодом с друзьями — они смогут добавить тебя моментально.')}
              </p>
              <Button
                variant="ghost"
                icon={<UserPlus className="h-4 w-4" />}
                onClick={() => {
                  if (typeof window !== 'undefined' && navigator.clipboard && code.data?.code) {
                    void navigator.clipboard.writeText(code.data.code)
                  }
                }}
              >
                <span className="font-mono text-xs">{friendCode}</span>
              </Button>
            </Card>
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
