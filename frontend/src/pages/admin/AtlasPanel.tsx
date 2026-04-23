// ─── Atlas CMS panel ────────────────────────────────────────────────────
//
// Manages atlas_nodes / atlas_edges (migration 00031). The user-visible
// Atlas (/atlas) reads from /profile/me/atlas which now returns these
// rows; this panel is the only mutate path.

import { useMemo, useState, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import {
  useAtlasAdminEdgesQuery,
  useAtlasAdminNodesQuery,
  useCreateAtlasEdgeMutation,
  useCreateAtlasNodeMutation,
  useDeleteAtlasEdgeMutation,
  useDeleteAtlasNodeMutation,
  useUpdateAtlasNodeMutation,
  useUpdateAtlasPositionMutation,
  type AtlasAdminEdge,
  type AtlasAdminNode,
} from '../../lib/queries/atlasAdmin'
import { ErrorBox, PanelSkeleton } from './shared'
import { AtlasNodeModal, emptyNodeForm } from './AtlasNodeModal'

export function AtlasPanel() {
  const nodesQ = useAtlasAdminNodesQuery()
  const edgesQ = useAtlasAdminEdgesQuery()
  const createMut = useCreateAtlasNodeMutation()
  const updateMut = useUpdateAtlasNodeMutation()
  const deleteMut = useDeleteAtlasNodeMutation()
  const positionMut = useUpdateAtlasPositionMutation()
  const createEdgeMut = useCreateAtlasEdgeMutation()
  const deleteEdgeMut = useDeleteAtlasEdgeMutation()

  const [editing, setEditing] = useState<AtlasAdminNode | null>(null)
  const [creating, setCreating] = useState(false)
  const [edgeFrom, setEdgeFrom] = useState('')
  const [edgeTo, setEdgeTo] = useState('')
  const [edgeError, setEdgeError] = useState<string | null>(null)

  const nodes = nodesQ.data?.items ?? []
  const edges = edgesQ.data?.items ?? []

  const edgeCountByNode = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of edges) {
      m.set(e.from, (m.get(e.from) ?? 0) + 1)
      m.set(e.to, (m.get(e.to) ?? 0) + 1)
    }
    return m
  }, [edges])

  const handleDelete = async (n: AtlasAdminNode) => {
    const linked = edgeCountByNode.get(n.id) ?? 0
    const msg =
      linked > 0
        ? `Удалить узел «${n.title}»? Это также удалит ${linked} связ${linked === 1 ? 'ь' : linked < 5 ? 'и' : 'ей'} (CASCADE).`
        : `Удалить узел «${n.title}»?`
    // eslint-disable-next-line no-alert
    if (!window.confirm(msg)) return
    await deleteMut.mutateAsync(n.id)
  }

  const handleAddEdge = async (e: FormEvent) => {
    e.preventDefault()
    setEdgeError(null)
    if (!edgeFrom || !edgeTo) {
      setEdgeError('Выбери оба узла.')
      return
    }
    if (edgeFrom === edgeTo) {
      setEdgeError('Нельзя соединить узел сам с собой.')
      return
    }
    try {
      await createEdgeMut.mutateAsync({ from: edgeFrom, to: edgeTo })
      setEdgeFrom('')
      setEdgeTo('')
    } catch (err) {
      setEdgeError(err instanceof Error ? err.message : 'Не удалось добавить связь.')
    }
  }

  const handleDeleteEdge = async (e: AtlasAdminEdge) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Удалить связь ${e.from} → ${e.to}?`)) return
    await deleteEdgeMut.mutateAsync(e.id)
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-5 sm:px-7">
      {nodesQ.isPending ? (
        <PanelSkeleton rows={6} />
      ) : nodesQ.error ? (
        <ErrorBox message="Не удалось загрузить узлы атласа" />
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold text-text-secondary">
              Узлы ({nodes.length})
            </h2>
            <Button size="sm" onClick={() => setCreating(true)}>
              + Новый узел
            </Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface-1">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  <th className="px-3 py-2">id</th>
                  <th className="px-3 py-2">title</th>
                  <th className="px-3 py-2">section</th>
                  <th className="px-3 py-2">kind</th>
                  <th className="px-3 py-2">total</th>
                  <th className="px-3 py-2">pos</th>
                  <th className="px-3 py-2">active</th>
                  <th className="px-3 py-2 text-right">actions</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr key={n.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-[11px] text-text-muted">{n.id}</td>
                    <td className="px-3 py-2 text-text-primary">{n.title}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-text-secondary">{n.section}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-text-secondary">{n.kind}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-text-secondary">{n.total_count}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-text-muted">
                      {n.pos_x != null && n.pos_y != null ? `${n.pos_x},${n.pos_y}` : 'auto'}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 font-mono text-[9px] ${
                          n.is_active ? 'bg-success/15 text-success' : 'bg-surface-3 text-text-muted'
                        }`}
                      >
                        {n.is_active ? 'on' : 'off'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(n)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleDelete(n)}
                          disabled={deleteMut.isPending}
                        >
                          Del
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {nodes.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center font-mono text-[11px] text-text-muted">
                      Узлов пока нет — создай первый.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {edgesQ.isPending ? null : edgesQ.error ? (
        <ErrorBox message="Не удалось загрузить связи" />
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-sm font-bold text-text-secondary">
            Связи ({edges.length})
          </h2>
          <form
            onSubmit={handleAddEdge}
            className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface-1 p-3"
          >
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">from</span>
              <select
                value={edgeFrom}
                onChange={(e) => setEdgeFrom(e.target.value)}
                className="h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
              >
                <option value="">— выбери —</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">to</span>
              <select
                value={edgeTo}
                onChange={(e) => setEdgeTo(e.target.value)}
                className="h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-text-primary"
              >
                <option value="">— выбери —</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" type="submit" disabled={createEdgeMut.isPending}>
              + Добавить связь
            </Button>
            {edgeError && (
              <span className="ml-2 font-mono text-[11px] text-danger">{edgeError}</span>
            )}
          </form>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface-1">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  <th className="px-3 py-2">id</th>
                  <th className="px-3 py-2">from</th>
                  <th className="px-3 py-2">→</th>
                  <th className="px-3 py-2">to</th>
                  <th className="px-3 py-2 text-right">actions</th>
                </tr>
              </thead>
              <tbody>
                {edges.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-[11px] text-text-muted">{e.id}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-text-secondary">{e.from}</td>
                    <td className="px-3 py-2 text-text-muted">→</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-text-secondary">{e.to}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => void handleDeleteEdge(e)}>
                        Del
                      </Button>
                    </td>
                  </tr>
                ))}
                {edges.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center font-mono text-[11px] text-text-muted">
                      Связей пока нет.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(creating || editing) && (
        <AtlasNodeModal
          initial={editing ?? emptyNodeForm}
          mode={editing ? 'edit' : 'create'}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSubmit={async (payload) => {
            if (editing) {
              await updateMut.mutateAsync(payload)
            } else {
              await createMut.mutateAsync(payload)
            }
          }}
          onSavePosition={async (id, posX, posY) => {
            await positionMut.mutateAsync({ id, pos_x: posX, pos_y: posY })
          }}
          busy={createMut.isPending || updateMut.isPending || positionMut.isPending}
        />
      )}
    </div>
  )
}
