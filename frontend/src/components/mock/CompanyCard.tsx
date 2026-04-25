// CompanyCard — single tile in the /mock company picker grid. Renders
// the company logo (or initials fallback) + name + difficulty band.
// Click → onSelect(company.id) — the parent triggers the create-pipeline
// mutation and navigates to /mock/{id}.

import { cn } from '../../lib/cn'
import type { MockCompany } from '../../lib/queries/mockPipeline'

const DIFFICULTY_LABEL: Record<string, string> = {
  normal: 'Normal',
  hard: 'Hard',
  boss: 'Boss',
}

export type CompanyCardProps = {
  company: MockCompany
  onSelect: (companyId: string) => void
  loading?: boolean
}

function Initials({ name }: { name: string }) {
  const parts = (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2)
  const txt = parts.map((p) => p[0]?.toUpperCase() ?? '').join('')
  return (
    <div className="h-12 w-12 rounded-md bg-surface-2 border border-border flex items-center justify-center font-display font-bold text-text-secondary text-base">
      {txt || '?'}
    </div>
  )
}

export function CompanyCard({ company, onSelect, loading }: CompanyCardProps) {
  const sections = company.sections ?? []
  return (
    <button
      type="button"
      onClick={() => onSelect(company.id)}
      disabled={loading}
      className={cn(
        'group relative flex flex-col gap-3 rounded-lg border border-border bg-surface-1 p-4 text-left',
        'transition-colors hover:border-border-strong hover:bg-surface-2',
        'disabled:opacity-60 disabled:cursor-wait',
      )}
    >
      <div className="flex items-center gap-3">
        {company.logo_url ? (
          <img
            src={company.logo_url}
            alt=""
            className="h-12 w-12 rounded-md object-contain bg-surface-2 border border-border"
          />
        ) : (
          <Initials name={company.name} />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-text-primary truncate">{company.name}</div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{company.slug}</div>
        </div>
      </div>
      {(company.difficulty || sections.length > 0) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {company.difficulty && (
            <span className="inline-flex items-center rounded border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-text-secondary">
              {DIFFICULTY_LABEL[company.difficulty] ?? company.difficulty}
            </span>
          )}
          {sections.slice(0, 3).map((s) => (
            <span
              key={s}
              className="inline-flex items-center rounded border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-text-muted"
            >
              {s}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}

export default CompanyCard
