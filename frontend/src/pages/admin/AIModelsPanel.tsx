// ─── AI models CMS panel ────────────────────────────────────────────────
//
// Grid + modal for the llm_models registry (migration 00033). Admins add
// a new OpenRouter id here and it appears in the Arena AI-opponent picker
// / Weekly Insight client / Mock LLM without a code deploy.

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '../../components/Button'
import {
  useAIAdminModelsQuery,
  useCreateLLMModelMutation,
  useDeleteLLMModelMutation,
  useToggleLLMModelMutation,
  useUpdateLLMModelMutation,
  type AdminLLMModel,
} from '../../lib/queries/ai'
import { ErrorBox, PanelSkeleton } from './shared'
import { LLMModelModal } from './LLMModelModal'

export function AIModelsPanel() {
  const list = useAIAdminModelsQuery()
  const createMut = useCreateLLMModelMutation()
  const updateMut = useUpdateLLMModelMutation()
  const toggleMut = useToggleLLMModelMutation()
  const deleteMut = useDeleteLLMModelMutation()

  const [editing, setEditing] = useState<AdminLLMModel | null>(null)
  const [creating, setCreating] = useState(false)

  if (list.isPending) {
    return <PanelSkeleton rows={5} />
  }
  if (list.error || !list.data) {
    return <ErrorBox message="Не удалось загрузить AI-модельки." />
  }

  const rows = list.data.items

  return (
    <div className="flex flex-col gap-5 px-4 py-5 sm:px-7">
      <section className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-display text-sm font-bold text-text-primary">Реестр AI-моделей</h2>
            <p className="mt-1 font-mono text-[11px] text-text-muted">
              Что здесь включено — то и видит фронт в пикере Arena / Insight / Mock.
              Выключай строку, чтобы временно убрать модель, удаляй — чтобы стереть насовсем.
            </p>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            + Добавить нейронку
          </Button>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface-2 px-4 py-6 text-center font-mono text-xs text-text-muted">
            Реестр пуст. Пока ни одна AI-фича не сможет дозваться до OpenRouter — добавь хотя бы одну модель.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  <th className="py-2 pr-3 text-left">model_id</th>
                  <th className="py-2 pr-3 text-left">label</th>
                  <th className="py-2 pr-3 text-left">provider</th>
                  <th className="py-2 pr-3 text-left">tier</th>
                  <th className="py-2 pr-3 text-center">enabled</th>
                  <th className="py-2 pr-3 text-left">use for</th>
                  <th className="py-2 pr-3 text-right">sort</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-b border-border/60 align-top">
                    <td className="py-2 pr-3 font-mono text-[12px] text-text-primary">{m.model_id}</td>
                    <td className="py-2 pr-3 text-text-primary">{m.label}</td>
                    <td className="py-2 pr-3 text-text-secondary">{m.provider}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                          m.tier === 'premium'
                            ? 'bg-accent/20 text-accent'
                            : 'bg-surface-3 text-text-secondary'
                        }`}
                      >
                        {m.tier}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-center">
                      <button
                        type="button"
                        disabled={toggleMut.isPending}
                        onClick={() => toggleMut.mutate(m.model_id)}
                        className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                          m.is_enabled
                            ? 'bg-success/20 text-success'
                            : 'bg-danger/20 text-danger'
                        }`}
                      >
                        {m.is_enabled ? 'on' : 'off'}
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {m.use_for_arena && (
                          <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">arena</span>
                        )}
                        {m.use_for_insight && (
                          <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">insight</span>
                        )}
                        {m.use_for_mock && (
                          <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">mock</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-[12px] text-text-secondary">{m.sort_order}</td>
                    <td className="py-2 pr-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(m)}>
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={deleteMut.isPending}
                          onClick={() => {
                            if (window.confirm(`Удалить ${m.model_id}?`)) {
                              deleteMut.mutate(m.model_id)
                            }
                          }}
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                        >
                          Del
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(creating || editing) && (
        <LLMModelModal
          initial={editing}
          busy={createMut.isPending || updateMut.isPending}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSave={async (body) => {
            if (editing) {
              await updateMut.mutateAsync({ modelId: editing.model_id, body })
            } else {
              await createMut.mutateAsync(body)
            }
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
