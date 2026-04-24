// ─── Personas CMS panel ─────────────────────────────────────────────────
//
// Grid + modal for the personas registry (migration 00051). Admins
// add/edit/disable an expert-mode preset here and it shows up in the
// desktop Copilot's persona picker without a code deploy.
//
// Matches the AIModelsPanel layout conventions (inline toggle, open-
// modal-for-edit, confirm-for-delete) so operator muscle-memory
// transfers between the two.

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '../../components/Button'
import {
  useAdminPersonasQuery,
  useCreatePersonaMutation,
  useDeletePersonaMutation,
  useTogglePersonaMutation,
  useUpdatePersonaMutation,
  type AdminPersona,
} from '../../lib/queries/personas'
import { ErrorBox, PanelSkeleton } from './shared'
import { PersonaModal } from './PersonaModal'

export function PersonasPanel() {
  const list = useAdminPersonasQuery()
  const createMut = useCreatePersonaMutation()
  const updateMut = useUpdatePersonaMutation()
  const toggleMut = useTogglePersonaMutation()
  const deleteMut = useDeletePersonaMutation()

  const [editing, setEditing] = useState<AdminPersona | null>(null)
  const [creating, setCreating] = useState(false)

  if (list.isPending) {
    return <PanelSkeleton rows={5} />
  }
  if (list.error || !list.data) {
    return <ErrorBox message="Не удалось загрузить персоны." />
  }

  const rows = list.data.items
  const busy =
    createMut.isPending ||
    updateMut.isPending ||
    toggleMut.isPending ||
    deleteMut.isPending

  return (
    <div className="flex flex-col gap-5 px-4 py-5 sm:px-7">
      <section className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-display text-sm font-bold text-text-primary">
              Персоны (expert-mode пресеты)
            </h2>
            <p className="mt-1 font-mono text-[11px] text-text-muted">
              Каждая строка = пресет в пикере desktop-Copilot'а. system_prompt
              префиксится к user-запросу когда персона активна. Выключай чтобы
              убрать временно, удаляй — насовсем.
            </p>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            + Добавить персону
          </Button>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface-2 px-4 py-6 text-center font-mono text-xs text-text-muted">
            Каталог пуст. Desktop покажет только дефолтную baseline-персону.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  <th className="py-2 pr-3 text-left">icon</th>
                  <th className="py-2 pr-3 text-left">id</th>
                  <th className="py-2 pr-3 text-left">label / hint</th>
                  <th className="py-2 pr-3 text-left">gradient</th>
                  <th className="py-2 pr-3 text-left">task</th>
                  <th className="py-2 pr-3 text-center">enabled</th>
                  <th className="py-2 pr-3 text-right">sort</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 align-top">
                    <td className="py-2 pr-3 text-lg">{p.icon_emoji}</td>
                    <td className="py-2 pr-3 font-mono text-[12px] text-text-primary">
                      {p.id}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="font-semibold text-text-primary">{p.label}</div>
                      <div className="font-mono text-[10px] text-text-muted">{p.hint}</div>
                    </td>
                    <td className="py-2 pr-3">
                      {p.brand_gradient ? (
                        <div
                          className="h-5 w-10 rounded border border-border"
                          style={{ background: p.brand_gradient }}
                          title={p.brand_gradient}
                        />
                      ) : (
                        <span className="font-mono text-[10px] text-text-muted">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-text-secondary">
                      {p.suggested_task || '—'}
                    </td>
                    <td className="py-2 pr-3 text-center">
                      <button
                        type="button"
                        onClick={() => toggleMut.mutate(p.id)}
                        disabled={busy}
                        className={`rounded-md px-2 py-0.5 font-mono text-[10px] ${
                          p.is_enabled
                            ? 'bg-accent/20 text-accent'
                            : 'bg-surface-3 text-text-muted'
                        }`}
                      >
                        {p.is_enabled ? 'ON' : 'OFF'}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-xs text-text-secondary">
                      {p.sort_order}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(p)}
                          className="text-[11px] text-accent hover:underline"
                        >
                          edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              confirm(
                                `Удалить персону «${p.label}»? Это необратимо — юзеры потеряют её из пикера. Предпочтительнее выключить тумблером.`,
                              )
                            ) {
                              deleteMut.mutate(p.id)
                            }
                          }}
                          disabled={busy}
                          className="text-danger hover:text-danger/80"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && (
        <PersonaModal
          initial={null}
          busy={createMut.isPending}
          onClose={() => setCreating(false)}
          onSave={async (body) => {
            await createMut.mutateAsync(body)
            setCreating(false)
          }}
        />
      )}
      {editing && (
        <PersonaModal
          initial={editing}
          busy={updateMut.isPending}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            await updateMut.mutateAsync({ id: editing.id, body })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
