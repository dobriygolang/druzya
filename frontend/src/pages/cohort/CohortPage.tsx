// /cohort — Wave 3 cohort page.
//
// Three layout modes driven by the route + query state:
//
//   1. /cohort and the user IS in a cohort  → detail view of MY cohort
//   2. /cohort and the user is NOT in any  → public discovery (search + grid)
//   3. /cohort/:cohortId                    → public detail of THAT cohort
//
// Reads:
//   - useMyCohortQuery()    /api/v1/cohort/my   (returns null on 404)
//   - useCohortQuery(id)    /api/v1/cohort/{id}
//   - useCohortWarQuery(id) /api/v1/cohort/{id}/war
//   - useCohortListQuery()  /api/v1/cohort/list?search=&tier=&page=
//
// Mutations (Wave 3):
//   - useJoinCohortMutation()    POST /api/v1/cohort/{id}/join
//   - useLeaveCohortMutation()   POST /api/v1/cohort/{id}/leave
//   - useCreateCohortMutation()  POST /api/v1/cohort
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
  useCohortQuery,
  useMyCohortQuery,
  type Cohort,
} from '../../lib/queries/cohort'
import { CohortBanner } from './CohortBanner'
import { MembersList } from './MembersList'
import { WarPanel, ActionsPanel } from './WarPanel'
import { DiscoveryView } from './DiscoveryView'

// ── per-mode views ────────────────────────────────────────────────────────

function CohortDetail({ cohort, isMine }: { cohort: Cohort; isMine: boolean }) {
  return (
    <>
      <CohortBanner cohort={cohort} />
      <div className="flex flex-col gap-4 px-4 pb-6 pt-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:pb-7">
        <div className="flex w-full flex-col gap-5 lg:w-[380px]">
          <WarPanel cohortId={cohort.id} />
          <ActionsPanel cohortId={cohort.id} isMine={isMine} />
        </div>
        <MembersList members={cohort.members} />
      </div>
    </>
  )
}

// ── page ──────────────────────────────────────────────────────────────────

export default function CohortPage() {
  const { cohortId } = useParams<{ cohortId: string }>()
  const myCohortQuery = useMyCohortQuery()
  const explicitQuery = useCohortQuery(cohortId)

  // The "active" cohort — what we render in the detail layout — depends on
  // whether the URL pinned a specific cohortId or not.
  const detailCohort = useMemo<Cohort | null | undefined>(() => {
    if (cohortId) return explicitQuery.data
    return myCohortQuery.data
  }, [cohortId, explicitQuery.data, myCohortQuery.data])

  const isMine = !!myCohortQuery.data && detailCohort?.id === myCohortQuery.data.id
  const loading = cohortId ? explicitQuery.isLoading : myCohortQuery.isLoading
  const errored = cohortId ? explicitQuery.isError : myCohortQuery.isError

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
            <p className="text-sm text-danger">Не удалось загрузить когорту.</p>
            <Button
              size="sm"
              onClick={() => (cohortId ? explicitQuery.refetch() : myCohortQuery.refetch())}
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Повторить
            </Button>
          </Card>
        </div>
      </AppShellV2>
    )
  }

  // /cohort/:cohortId — explicit lookup that returned no row → friendly empty.
  if (cohortId && !detailCohort) {
    return (
      <AppShellV2>
        <div className="px-4 pt-6 sm:px-8 lg:px-20">
          <Card className="flex-col gap-2 p-5">
            <Shield className="h-5 w-5 text-text-muted" />
            <p className="text-sm text-text-secondary">Когорта не найдена.</p>
          </Card>
        </div>
      </AppShellV2>
    )
  }

  // /cohort without an id and the user has no cohort → discovery view (search,
  // grid of public cohorts, join + create CTAs).
  if (!cohortId && !detailCohort) {
    return (
      <AppShellV2>
        <DiscoveryView />
      </AppShellV2>
    )
  }

  // detail view (mine or public)
  return (
    <AppShellV2>
      <CohortDetail cohort={detailCohort!} isMine={isMine} />
    </AppShellV2>
  )
}
