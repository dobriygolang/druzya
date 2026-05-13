// WritingPromptsPage — Phase K Wave 11 (2026-05-13).
//
// Curated writing prompts library admin CMS. Replaces the Wave 8
// placeholder (backend now exists: migration 00119, RPCs in hone.proto,
// repo + use cases + handler wired).
//
// Mirror of SpeakingExercisesPage layout: level chips → table of rows
// → add-form modal. Archive flips archived_at; no edit (admin can
// archive + re-create with new slug to revise).

import { useMemo, useState } from 'react'

import { ErrorBox, PanelSkeleton } from '../shared'
import {
  useAdminWritingPromptsQuery,
  useAddWritingPromptMutation,
  useArchiveWritingPromptMutation,
  type WritingPrompt,
} from '../../../lib/queries/adminLingua'

type LevelFilter = '' | 'B1' | 'B2' | 'C1'

export function WritingPromptsPage() {
  const [level, setLevel] = useState<LevelFilter>('')
  const [showAdd, setShowAdd] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [pendingID, setPendingID] = useState('')

  const query = useAdminWritingPromptsQuery(level)
  const archive = useArchiveWritingPromptMutation()

  const grouped = useMemo(() => {
    if (!query.data) return new Map<string, WritingPrompt[]>()
    const m = new Map<string, WritingPrompt[]>()
    for (const p of query.data) {
      const arr = m.get(p.level) ?? []
      arr.push(p)
      m.set(p.level, arr)
    }
    return m
  }, [query.data])

  const items = query.data ?? []

  if (query.isPending) return <PanelSkeleton rows={6} />
  if (query.error) return <ErrorBox message={(query.error as Error).message || 'Failed to load'} />

  const counts = {
    B1: grouped.get('B1')?.length ?? 0,
    B2: grouped.get('B2')?.length ?? 0,
    C1: grouped.get('C1')?.length ?? 0,
  }

  const handleArchive = async (id: string) => {
    if (!confirm(`Archive prompt "${id}"? This hides it from users (one-way; create a new slug to revise).`)) {
      return
    }
    setErrorMsg('')
    setPendingID(id)
    try {
      await archive.mutateAsync(id)
    } catch (e) {
      setErrorMsg(`${id}: ${(e as Error).message || 'failed'}`)
    } finally {
      setPendingID('')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-display text-[14px] font-bold text-text-primary">Writing prompts</h4>
        <div className="flex flex-wrap items-center gap-1.5">
          <LevelChip current={level} value="" label={`All · ${items.length}`} onChange={setLevel} />
          <LevelChip current={level} value="B1" label={`B1 · ${counts.B1}`} onChange={setLevel} />
          <LevelChip current={level} value="B2" label={`B2 · ${counts.B2}`} onChange={setLevel} />
          <LevelChip current={level} value="C1" label={`C1 · ${counts.C1}`} onChange={setLevel} />
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-1 px-3 py-2 text-[11px] text-text-secondary">
        <span>
          Curated catalog. Archive is one-way (no edit). To revise — archive + add new slug. Seed: 00119_writing_prompts.sql · 10 baseline rows.
        </span>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="rounded-md border border-text-primary bg-text-primary px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-bg transition-colors hover:bg-text-primary/80"
        >
          Add prompt
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-border bg-bg px-3 py-2 font-mono text-[11px] text-text-primary">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#FF3B30]" /> {errorMsg}
        </div>
      )}

      {showAdd && (
        <AddPromptForm
          onClose={() => setShowAdd(false)}
          onError={(msg) => setErrorMsg(msg)}
        />
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-surface-1 px-4 py-10 text-center">
          <span className="font-mono text-[12px] text-text-muted">Empty</span>
          <span className="font-mono text-[10px] text-text-muted">No active prompts</span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full">
            <thead className="bg-surface-1">
              <tr>
                <Th>ID</Th>
                <Th>Level</Th>
                <Th>Topic</Th>
                <Th>Prompt</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((p) => {
                const isPending = pendingID === p.id
                return (
                  <tr key={p.id} className="bg-surface-2 hover:bg-surface-1">
                    <Td className="font-mono text-[10px] text-text-muted">{p.id}</Td>
                    <Td>
                      <span className="rounded-full border border-border bg-bg px-2 py-0.5 font-mono text-[10px] uppercase text-text-secondary">
                        {p.level}
                      </span>
                    </Td>
                    <Td className="text-[12px] text-text-secondary">{p.topic}</Td>
                    <Td className="max-w-[480px] text-[12px] text-text-primary" title={p.prompt}>
                      <span className="line-clamp-3">{p.prompt}</span>
                    </Td>
                    <Td>
                      <button
                        type="button"
                        onClick={() => handleArchive(p.id)}
                        disabled={isPending}
                        className="rounded-md border border-border bg-surface-1 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.05em] text-text-secondary transition-colors hover:border-border-strong disabled:opacity-50"
                      >
                        {isPending ? 'Working…' : 'Archive'}
                      </button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AddPromptForm({
  onClose,
  onError,
}: {
  onClose: () => void
  onError: (msg: string) => void
}) {
  const [id, setId] = useState('')
  const [promptLevel, setPromptLevel] = useState<'B1' | 'B2' | 'C1'>('B2')
  const [topic, setTopic] = useState('')
  const [prompt, setPrompt] = useState('')
  const [rubric, setRubric] = useState('')
  const [busy, setBusy] = useState(false)

  const add = useAddWritingPromptMutation()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await add.mutateAsync({
        id: id.trim(),
        level: promptLevel,
        topic: topic.trim(),
        prompt: prompt.trim(),
        rubric_md: rubric.trim(),
      })
      onClose()
    } catch (err) {
      onError(`add: ${(err as Error).message || 'failed'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-1 p-4"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          Add prompt
        </span>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[10px] uppercase text-text-muted hover:text-text-primary"
        >
          cancel
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="ID (slug)">
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="b2-tech-blog-bugfix"
            required
            pattern="^[a-z0-9][a-z0-9-]{0,79}$"
            className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-[11px] text-text-primary focus:border-text-primary focus:outline-none"
          />
        </Field>
        <Field label="Level">
          <select
            value={promptLevel}
            onChange={(e) => setPromptLevel(e.target.value as 'B1' | 'B2' | 'C1')}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-[11px] text-text-primary focus:border-text-primary focus:outline-none"
          >
            <option value="B1">B1</option>
            <option value="B2">B2</option>
            <option value="C1">C1</option>
          </select>
        </Field>
        <Field label="Topic">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="email / tech-blog / retrospective"
            required
            maxLength={80}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-[11px] text-text-primary focus:border-text-primary focus:outline-none"
          />
        </Field>
      </div>

      <Field label="Prompt body">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          required
          maxLength={4000}
          placeholder="Write a 200-word email to your manager…"
          className="w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-[11px] text-text-primary focus:border-text-primary focus:outline-none"
        />
      </Field>

      <Field label="Rubric MD (optional)">
        <textarea
          value={rubric}
          onChange={(e) => setRubric(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Grading axes: clarity, technical depth, structure"
          className="w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-[11px] text-text-primary focus:border-text-primary focus:outline-none"
        />
      </Field>

      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-text-primary bg-text-primary px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-bg transition-colors hover:bg-text-primary/80 disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        {label}
      </span>
      {children}
    </label>
  )
}

function LevelChip({
  current,
  value,
  label,
  onChange,
}: {
  current: LevelFilter
  value: LevelFilter
  label: string
  onChange: (v: LevelFilter) => void
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.05em] transition-colors ${
        active
          ? 'border-text-primary bg-text-primary/10 text-text-primary'
          : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong'
      }`}
    >
      {label}
    </button>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
      {children}
    </th>
  )
}

function Td({
  children,
  className,
  title,
}: {
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <td className={`px-3 py-2 align-top text-[12px] text-text-primary ${className ?? ''}`} title={title}>
      {children}
    </td>
  )
}
