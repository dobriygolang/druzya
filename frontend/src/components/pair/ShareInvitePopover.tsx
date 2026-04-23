// ShareInvitePopover — minimal "create + copy invite link" surface.
// Triggered by the share button in PairRoomPage's top bar. Calls
// useCreatePairInviteMutation; on success shows the URL with a copy
// button. Anti-fallback: errors render as inline danger text — never
// invent a fake URL.

import { useState } from 'react'
import { Copy, Link as LinkIcon, Check } from 'lucide-react'
import { Button } from '../Button'
import { useCreatePairInviteMutation } from '../../lib/queries/pairEditor'

type Props = {
  roomId: string
}

export function ShareInvitePopover({ roomId }: Props) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const m = useCreatePairInviteMutation(roomId)

  const handleCreate = () => {
    setOpen(true)
    if (!m.data && !m.isPending) {
      m.mutate()
    }
  }

  const handleCopy = async () => {
    if (!m.data?.url) return
    try {
      await navigator.clipboard.writeText(m.data.url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — user can still copy manually from the input */
    }
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        icon={<LinkIcon className="h-3.5 w-3.5" />}
        onClick={handleCreate}
      >
        Пригласить
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-[320px] rounded-md border border-border bg-surface-1 p-3 shadow-lg">
          <div className="mb-2 font-display text-[13px] font-semibold text-text-primary">
            Ссылка-приглашение
          </div>
          {m.isPending && (
            <div className="text-[12px] text-text-muted">Создаём ссылку…</div>
          )}
          {m.isError && (
            <div className="text-[12px] text-danger">
              Не удалось создать. <button className="underline" onClick={() => m.mutate()}>Повторить</button>
            </div>
          )}
          {m.data && (
            <>
              <div className="flex items-center gap-1.5 rounded border border-border bg-bg px-2 py-1.5 font-mono text-[11px] text-text-secondary">
                <span className="flex-1 truncate">{m.data.url}</span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="text-text-muted hover:text-text-primary"
                  aria-label="Скопировать ссылку"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <div className="mt-2 font-mono text-[10px] text-text-muted">
                Действует до {new Date(m.data.expires_at).toLocaleString()}
              </div>
            </>
          )}
          <div className="mt-3 text-right">
            <button
              className="text-[11px] text-text-muted hover:text-text-primary"
              onClick={() => setOpen(false)}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
