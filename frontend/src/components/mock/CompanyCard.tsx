// CompanyCard — single tile in the /mock company picker grid. Renders
// the company logo (or initials fallback), name, and the band of meta
// chips (level + tier). Click → onSelect(company.id) — the parent
// triggers the create-pipeline mutation and navigates to /mock/{id}.
//
// We deliberately do NOT show "X people interviewing now" counts here —
// the backend doesn't expose it and inventing it would be a fallback.

import { cn } from '../../lib/cn'
import type { MockCompany } from '../../lib/queries/mockPipeline'

const LEVEL_LABEL: Record<MockCompany['level'], string> = {
  mid: 'Middle',
  senior: 'Senior',
  staff: 'Staff',
}

const TIER_TONE: Record<MockCompany['tier'], string> = {
  tier1: 'border-pink/40 bg-pink/10 text-pink',
  tier2: 'border-cyan/40 bg-cyan/10 text-cyan',
  tier3: 'border-border bg-surface-2 text-text-muted',
}

export type CompanyCardProps = {
  company: MockCompany
  onSelect: (companyId: string) => void
  loading?: boolean
}

function Initials({ name }: { name: string }) {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2)
  const txt = parts.map((p) => p[0]?.toUpperCase() ?? '').join('')
  return (
    <div className="h-12 w-12 rounded-md bg-surface-2 border border-border flex items-center justify-center font-display font-bold text-text-secondary text-base">
      {txt || '?'}
    </div>
  )
}

export function CompanyCard({ company, onSelect, loading }: CompanyCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(company.id)}
      disabled={loading}
      className={cn(
        'group relative flex flex-col gap-3 rounded-lg border border-border bg-surface-1 p-4 text-left',
        'transition-colors hover:border-accent/60 hover:bg-surface-2',
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
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className={cn(
            'inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider',
            TIER_TONE[company.tier],
          )}
        >
          {company.tier}
        </span>
        <span className="inline-flex items-center rounded border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-text-secondary">
          {LEVEL_LABEL[company.level]}
        </span>
        {company.default_languages.slice(0, 2).map((lang) => (
          <span
            key={lang}
            className="inline-flex items-center rounded border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-text-muted"
          >
            {lang}
          </span>
        ))}
      </div>
    </button>
  )
}

export default CompanyCard
