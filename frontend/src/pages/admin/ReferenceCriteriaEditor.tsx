// Shared 3-section reference-criteria editor (Phase A.2 ADR-002).
//
// Both task-level and question-level criteria use the same JSONB shape:
//   { must_mention?, nice_to_have?, common_pitfalls? } : string[]
//
// The editor renders three labeled textareas — one item per line, empty
// lines are stripped on save. It keeps the parsed value in props (parent
// owns state); the textarea-level value is held locally so the user can
// type freely without their cursor jumping when the parent normalizes.

import { useEffect, useState } from 'react'
import type { ReferenceCriteria } from '../../lib/queries/mockAdmin'

type Section = 'must_mention' | 'nice_to_have' | 'common_pitfalls'

const LABELS: Record<Section, string> = {
  must_mention: 'Обязательно упомянуть (без — fail)',
  nice_to_have: 'Бонус-баллы',
  common_pitfalls: 'Ловушки (упомянул — fail)',
}

export function ReferenceCriteriaEditor({
  value,
  onChange,
}: {
  value: ReferenceCriteria | null | undefined
  onChange: (next: ReferenceCriteria) => void
}) {
  const [draft, setDraft] = useState<Record<Section, string>>({
    must_mention: (value?.must_mention ?? []).join('\n'),
    nice_to_have: (value?.nice_to_have ?? []).join('\n'),
    common_pitfalls: (value?.common_pitfalls ?? []).join('\n'),
  })

  // Re-sync when parent value changes (e.g. switched to a different row).
  // We intentionally key on joined arrays (not the parent ReferenceCriteria
  // object, which is often freshly allocated on every parent render) so the
  // local draft survives parent rerenders that don't actually change content.
  const mmKey = (value?.must_mention ?? []).join('|')
  const nhKey = (value?.nice_to_have ?? []).join('|')
  const cpKey = (value?.common_pitfalls ?? []).join('|')
  useEffect(() => {
    setDraft({
      must_mention: (value?.must_mention ?? []).join('\n'),
      nice_to_have: (value?.nice_to_have ?? []).join('\n'),
      common_pitfalls: (value?.common_pitfalls ?? []).join('\n'),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mmKey, nhKey, cpKey])

  function update(section: Section, raw: string) {
    setDraft((d) => ({ ...d, [section]: raw }))
    const next: ReferenceCriteria = {
      must_mention: split(section === 'must_mention' ? raw : draft.must_mention),
      nice_to_have: split(section === 'nice_to_have' ? raw : draft.nice_to_have),
      common_pitfalls: split(section === 'common_pitfalls' ? raw : draft.common_pitfalls),
    }
    // Drop empty arrays so the JSON stays tidy on the wire.
    onChange(prune(next))
  }

  return (
    <div className="flex flex-col gap-3">
      {(Object.keys(LABELS) as Section[]).map((s) => (
        <div key={s} className="flex flex-col gap-1.5">
          <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">
            {LABELS[s]}
          </label>
          <textarea
            value={draft[s]}
            onChange={(e) => update(s, e.target.value)}
            rows={4}
            className="resize-y rounded-md border border-border bg-bg/40 px-3 py-2 font-mono text-[12px] text-text-primary outline-none transition-colors focus:border-text-primary"
            placeholder="Один пункт на строку"
          />
        </div>
      ))}
    </div>
  )
}

function split(raw: string): string[] {
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

function prune(c: ReferenceCriteria): ReferenceCriteria {
  const out: ReferenceCriteria = {}
  if (c.must_mention && c.must_mention.length) out.must_mention = c.must_mention
  if (c.nice_to_have && c.nice_to_have.length) out.nice_to_have = c.nice_to_have
  if (c.common_pitfalls && c.common_pitfalls.length) out.common_pitfalls = c.common_pitfalls
  return out
}
