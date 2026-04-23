// /guild — Wave 3 guild page.
//
// Three layout modes driven by the route + query state:
//
//   1. /guild and the user IS in a guild  → detail view of MY guild
//   2. /guild and the user is NOT in any  → public discovery (search + grid)
//   3. /guild/:guildId                    → public detail of THAT guild
//
// Reads:
//   - useMyGuildQuery()    /api/v1/guild/my   (returns null on 404)
//   - useGuildQuery(id)    /api/v1/guild/{id}
//   - useGuildWarQuery(id) /api/v1/guild/{id}/war
//   - useGuildListQuery()  /api/v1/guild/list?search=&tier=&page=
//
// Mutations (Wave 3):
//   - useJoinGuildMutation()    POST /api/v1/guild/{id}/join
//   - useLeaveGuildMutation()   POST /api/v1/guild/{id}/leave
//   - useCreateGuildMutation()  POST /api/v1/guild
//
// Loading/empty/error states mirror the bible defaults — skeleton sections,
// friendly empty copy, and a retry button on hard errors.

import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { RefreshCw, Shield } from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import {
  useGuildQuery,
  useMyGuildQuery,
  type Guild,
} from '../../lib/queries/guild'
import { GuildBanner } from './GuildBanner'
import { MembersList } from './MembersList'
import { WarPanel, ActionsPanel } from './WarPanel'
import { DiscoveryView } from './DiscoveryView'

// ── per-mode views ────────────────────────────────────────────────────────

function GuildDetail({ guild, isMine }: { guild: Guild; isMine: boolean }) {
  return (
    <>
      <GuildBanner guild={guild} />
      <div className="flex flex-col gap-4 px-4 pb-6 pt-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:pb-7">
        <div className="flex w-full flex-col gap-5 lg:w-[380px]">
          <WarPanel guildId={guild.id} />
          <ActionsPanel guildId={guild.id} isMine={isMine} />
        </div>
        <MembersList members={guild.members} />
      </div>
    </>
  )
}

// ── page ──────────────────────────────────────────────────────────────────

export default function GuildPage() {
  const { guildId } = useParams<{ guildId: string }>()
  const myGuildQuery = useMyGuildQuery()
  const explicitQuery = useGuildQuery(guildId)

  // The "active" guild — what we render in the detail layout — depends on
  // whether the URL pinned a specific guildId or not.
  const detailGuild = useMemo<Guild | null | undefined>(() => {
    if (guildId) return explicitQuery.data
    return myGuildQuery.data
  }, [guildId, explicitQuery.data, myGuildQuery.data])

  const isMine = !!myGuildQuery.data && detailGuild?.id === myGuildQuery.data.id
  const loading = guildId ? explicitQuery.isLoading : myGuildQuery.isLoading
  const errored = guildId ? explicitQuery.isError : myGuildQuery.isError

  if (loading) {
    return (
      <AppShellV2>
        <div className="px-4 pt-6 sm:px-8 lg:px-20">
          <Card className="flex-col gap-3 p-5">
            <div className="h-6 w-1/3 animate-pulse rounded bg-surface-3" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-3" />
            <div className="h-4 w-1/4 animate-pulse rounded bg-surface-3" />
          </Card>
        </div>
      </AppShellV2>
    )
  }

  if (errored) {
    return (
      <AppShellV2>
        <div className="px-4 pt-6 sm:px-8 lg:px-20">
          <Card className="flex-col items-start gap-3 p-5">
            <p className="text-sm text-danger">Не удалось загрузить гильдию.</p>
            <Button
              size="sm"
              onClick={() => (guildId ? explicitQuery.refetch() : myGuildQuery.refetch())}
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Повторить
            </Button>
          </Card>
        </div>
      </AppShellV2>
    )
  }

  // /guild/:guildId — explicit lookup that returned no row → friendly empty.
  if (guildId && !detailGuild) {
    return (
      <AppShellV2>
        <div className="px-4 pt-6 sm:px-8 lg:px-20">
          <Card className="flex-col gap-2 p-5">
            <Shield className="h-5 w-5 text-text-muted" />
            <p className="text-sm text-text-secondary">Гильдия не найдена.</p>
          </Card>
        </div>
      </AppShellV2>
    )
  }

  // /guild without an id and the user has no guild → discovery view (search,
  // grid of public guilds, join + create CTAs).
  if (!guildId && !detailGuild) {
    return (
      <AppShellV2>
        <DiscoveryView />
      </AppShellV2>
    )
  }

  // detail view (mine or public)
  return (
    <AppShellV2>
      <GuildDetail guild={detailGuild!} isMine={isMine} />
    </AppShellV2>
  )
}
