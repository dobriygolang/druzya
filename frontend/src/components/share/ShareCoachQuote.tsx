// ShareCoachQuote — pull-quote rendition of the AI Coach narrative
// (WeeklyReport.ai_insight or .stress_analysis fallback).
//
// Visual: pink→cyan slice on the leading character, large serif-feel
// body, mono attribution. Anti-fallback: пустая строка → секция исчезает
// (никаких заглушек "Coach пока молчит").

import { Brain } from 'lucide-react'

export function ShareCoachQuote({ text }: { text: string }) {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return null

  // Берём первый параграф (≤240 chars) — для шер-вью важна плотность,
  // а не длинный нарратив.
  const lead = trimmed.split('\n\n')[0].slice(0, 240)

  return (
    <section className="relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-border-strong bg-gradient-to-br from-accent/15 via-surface-2 to-pink/10 p-6 sm:p-8">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-text-secondary" />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] bg-gradient-to-r from-pink to-cyan bg-clip-text text-transparent">
          AI Coach · недельный разбор
        </span>
      </div>
      <blockquote className="font-display text-lg sm:text-xl lg:text-2xl font-semibold leading-snug text-text-primary">
        <span className="bg-gradient-to-r from-pink to-cyan bg-clip-text text-transparent">«</span>
        {lead}
        <span className="bg-gradient-to-r from-pink to-cyan bg-clip-text text-transparent">»</span>
      </blockquote>
    </section>
  )
}

export default ShareCoachQuote
