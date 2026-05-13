// WritingPromptsPage — defer'нутый placeholder.
//
//   - GradeEnglishWriting RPC существует — но это one-shot grader, не
//     content store. Принимает draft + title (опционально), отдаёт
//     overall_score + issues. No persistence layer.
//   - Нет writing_prompts таблицы.
//   - Нет ListWritingPrompts / AddWritingPrompt / Archive RPC'ов.
//
// Текущий user-flow: пользователь сам формулирует draft. Curated
// prompts library — это backend mig + repo + handler.
//
// Этот page — empty-state с явным «defer» сообщением. Admin'у не
// показываем fake-CRUD который ничего не сохраняет.

export function WritingPromptsPage() {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h4 className="font-display text-[14px] font-bold text-text-primary">Writing prompts</h4>
      </header>

      <div className="flex flex-col gap-4 rounded-md border border-dashed border-border bg-surface-1 px-6 py-10">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-text-muted" />
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            Defer · backend missing
          </span>
        </div>
        <p className="text-[13px] text-text-secondary">
          Writing prompts не имеют persistence слоя. Сейчас доступен только{' '}
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px] text-text-primary">
            GradeEnglishWriting
          </code>{' '}
          — one-shot grader для user-driven draft'ов. Curated prompts library требует:
        </p>
        <ul className="ml-4 flex flex-col gap-1 text-[12px] text-text-secondary">
          <li className="font-mono text-[11px]">— migration: writing_prompts таблица (id / level / topic / prompt_md)</li>
          <li className="font-mono text-[11px]">— proto: WritingPrompt + List/Add/Archive RPC + REST routes</li>
          <li className="font-mono text-[11px]">— backend: services/hone/{`{domain,app,infra}`} layers</li>
          <li className="font-mono text-[11px]">— seed: 10-15 baseline prompts по level / topic</li>
        </ul>
        <p className="font-mono text-[11px] text-text-muted">
          Admin CRUD UI готов к подключению — bridge'нет на новые hooks в adminLingua.ts когда
          backend появится.
        </p>
      </div>
    </div>
  )
}
