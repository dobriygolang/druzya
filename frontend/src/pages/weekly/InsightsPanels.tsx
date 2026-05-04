import { Brain } from 'lucide-react'

// AI Insight panel — only the LLM-narrative section. Percentile/Achievement
// blocks were removed when their data sources stopped being populated server-side.

export function AiInsight({ text }: { text: string }) {
  // Anti-fallback policy (Phase B): empty insight = backend deliberately
  // returned "" (OPENROUTER_API_KEY missing OR upstream errored). НИКОГДА
  // не рендерим placeholder — секция должна полностью исчезать.
  if (!text.trim()) return null
  // Делим на 2 параграфа: либо по двойному \n\n, либо пополам по точке.
  const paragraphs = text.includes('\n\n')
    ? text.split('\n\n').slice(0, 2)
    : [text]
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border-strong bg-surface-2 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-text-secondary" />
          <h3 className="font-display text-lg font-bold text-text-primary">AI insight недели</h3>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
          Сгенерировано Claude Sonnet 4
        </p>
      </div>
      {paragraphs.map((p, i) => (
        <p key={i} className="text-sm leading-relaxed text-text-secondary">
          {p.trim()}
        </p>
      ))}
    </section>
  )
}
