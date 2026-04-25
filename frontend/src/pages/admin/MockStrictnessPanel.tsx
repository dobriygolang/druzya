// MockStrictnessPanel — AI strictness profile CRUD. Phase A.2 of ADR-002.
//
// One profile = one set of penalties + an optional custom prompt template
// that overrides the default rubric prompt. Penalty inputs are rendered as
// hone-styled <input type=range> sliders (no library) showing the numeric
// value beside the track. `+ New profile` clones default values.

import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { FormField } from '../../components/FormField'
import { ErrorBox, PanelSkeleton } from './shared'
import {
  mockAdminErrorMessage,
  useCreateStrictnessMutation,
  useStrictnessQuery,
  useUpdateStrictnessMutation,
  type StrictnessProfile,
} from '../../lib/queries/mockAdmin'

const DEFAULTS = {
  off_topic_penalty: 0.4,
  must_mention_penalty: 0.6,
  hallucination_penalty: 0.8,
  bias_toward_fail: false,
}

export function MockStrictnessPanel() {
  const list = useStrictnessQuery()
  const [creating, setCreating] = useState(false)

  if (list.isPending) return <PanelSkeleton rows={3} />
  if (list.error || !list.data) return <ErrorBox message={mockAdminErrorMessage(list.error)} />

  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-7">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-sm font-bold text-text-primary">
            Профили строгости AI
          </h2>
          <p className="mt-1 font-mono text-[11px] text-text-muted">
            Каждый профиль = набор штрафов и опциональный custom prompt для оценщика.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>+ New profile</Button>
      </div>

      {creating && (
        <CreateProfileForm onClose={() => setCreating(false)} />
      )}

      {list.data.length === 0 && !creating ? (
        <div className="rounded-md border border-dashed border-border bg-surface-1 px-3 py-6 text-center font-mono text-[11px] text-text-muted">
          Ещё нет профилей — создай первый.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.data.map((p) => (
            <ProfileCard key={p.id} profile={p} />
          ))}
        </ul>
      )}
    </div>
  )
}

function CreateProfileForm({ onClose }: { onClose: () => void }) {
  const create = useCreateStrictnessMutation()
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [offTopic, setOffTopic] = useState(DEFAULTS.off_topic_penalty)
  const [mustMention, setMustMention] = useState(DEFAULTS.must_mention_penalty)
  const [hallucination, setHallucination] = useState(DEFAULTS.hallucination_penalty)
  const [bias, setBias] = useState(DEFAULTS.bias_toward_fail)
  const [tpl, setTpl] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      await create.mutateAsync({
        slug: slug.trim(),
        name: name.trim(),
        off_topic_penalty: offTopic,
        must_mention_penalty: mustMention,
        hallucination_penalty: hallucination,
        bias_toward_fail: bias,
        custom_prompt_template: tpl.trim() || undefined,
      })
      onClose()
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-lg border border-border-strong bg-surface-2 p-4"
    >
      <h3 className="font-display text-sm font-bold text-text-primary">Новый профиль</h3>
      <FormField label="slug" value={slug} onChange={(e) => setSlug(e.currentTarget.value)} required />
      <FormField label="name" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
      <PenaltySlider label="off_topic_penalty" value={offTopic} onChange={setOffTopic} />
      <PenaltySlider label="must_mention_penalty" value={mustMention} onChange={setMustMention} />
      <PenaltySlider label="hallucination_penalty" value={hallucination} onChange={setHallucination} />
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={bias} onChange={(e) => setBias(e.target.checked)} />
        <span className="font-mono text-[11px] text-text-secondary">bias_toward_fail</span>
      </label>
      <FormField
        label="custom_prompt_template"
        multiline
        rows={4}
        mono
        value={tpl}
        onChange={(e) => setTpl(e.currentTarget.value)}
      />
      {err && <div className="text-[12px] text-danger">{err}</div>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Отмена</Button>
        <Button type="submit" size="sm" loading={create.isPending}>Создать</Button>
      </div>
    </form>
  )
}

function ProfileCard({ profile }: { profile: StrictnessProfile }) {
  const update = useUpdateStrictnessMutation()
  const [name, setName] = useState(profile.name)
  const [offTopic, setOffTopic] = useState(profile.off_topic_penalty)
  const [mustMention, setMustMention] = useState(profile.must_mention_penalty)
  const [hallucination, setHallucination] = useState(profile.hallucination_penalty)
  const [bias, setBias] = useState(profile.bias_toward_fail)
  const [tpl, setTpl] = useState(profile.custom_prompt_template ?? '')
  const [tplOpen, setTplOpen] = useState(!!profile.custom_prompt_template)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setName(profile.name)
    setOffTopic(profile.off_topic_penalty)
    setMustMention(profile.must_mention_penalty)
    setHallucination(profile.hallucination_penalty)
    setBias(profile.bias_toward_fail)
    setTpl(profile.custom_prompt_template ?? '')
    setTplOpen(!!profile.custom_prompt_template)
    setErr(null)
  }, [
    profile.id,
    profile.name,
    profile.off_topic_penalty,
    profile.must_mention_penalty,
    profile.hallucination_penalty,
    profile.bias_toward_fail,
    profile.custom_prompt_template,
  ])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      await update.mutateAsync({
        id: profile.id,
        body: {
          name: name.trim(),
          off_topic_penalty: offTopic,
          must_mention_penalty: mustMention,
          hallucination_penalty: hallucination,
          bias_toward_fail: bias,
          custom_prompt_template: tpl.trim(),
        },
      })
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  return (
    <form
      onSubmit={save}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-1 p-4"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="font-display text-sm font-bold text-text-primary">{profile.name}</div>
          <div className="font-mono text-[10px] text-text-muted">{profile.slug}</div>
        </div>
        {typeof profile.active === 'boolean' && (
          <button
            type="button"
            onClick={() =>
              update.mutate({ id: profile.id, body: { active: !profile.active } })
            }
            className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] ${
              profile.active ? 'bg-success/20 text-success' : 'bg-surface-3 text-text-muted'
            }`}
          >
            {profile.active ? 'active' : 'inactive'}
          </button>
        )}
      </div>

      <FormField label="name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
      <PenaltySlider label="off_topic_penalty" value={offTopic} onChange={setOffTopic} />
      <PenaltySlider label="must_mention_penalty" value={mustMention} onChange={setMustMention} />
      <PenaltySlider label="hallucination_penalty" value={hallucination} onChange={setHallucination} />

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={bias} onChange={(e) => setBias(e.target.checked)} />
        <span className="font-mono text-[11px] text-text-secondary">bias_toward_fail</span>
      </label>

      <div>
        <button
          type="button"
          onClick={() => setTplOpen((o) => !o)}
          className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary hover:text-text-primary"
        >
          {tplOpen ? '− custom_prompt_template' : '+ custom_prompt_template'}
        </button>
        {tplOpen && (
          <textarea
            value={tpl}
            onChange={(e) => setTpl(e.target.value)}
            rows={5}
            className="mt-1 w-full resize-y rounded-md border border-border bg-bg/40 px-3 py-2 font-mono text-[12px] text-text-primary outline-none transition-colors focus:border-text-primary"
          />
        )}
      </div>

      {err && <div className="text-[12px] text-danger">{err}</div>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={update.isPending}>Сохранить</Button>
      </div>
    </form>
  )
}

function PenaltySlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
        <span>{label}</span>
        <span className="text-text-primary">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-surface-2 accent-text-primary"
      />
    </label>
  )
}
