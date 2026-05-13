# docs/ — точка входа

Минимальная документация для AI-агента / нового dev. ~1 час от нуля до «могу делать таски».

## Что читать в каком порядке

1. **[../README.md](../README.md)** (5 мин) — что такое druz9, три продукта, быстрый старт
2. **[../CLAUDE.md](../CLAUDE.md)** (15 мин) — orientation для AI-агентов: identity, hard rules (B/W only, free-only LLM, offline-first), команды, skills
3. **[feature/identity.md](feature/identity.md)** (10 мин) — кто мы / кто НЕ мы / 3 трека / монетизация / что удалено
4. **[tech/README.md](tech/README.md)** (5 мин) — навигатор по техдокам
5. **[tech/architecture.md](tech/architecture.md)** (20 мин) — монолит + 3 клиента, Connect-RPC, чистая архитектура, ports/app/domain/infra
6. **[tech/conventions.md](tech/conventions.md)** (15 мин) — **правила** (не guidelines): proto-контракт, generated коммитятся, free-LLM cascade, TS-strict, conventional commits

Затем — relevant к задаче:
- **Работаешь в backend?** → [tech/backend.md](tech/backend.md)
- **Работаешь в frontend/Hone/Cue?** → [tech/frontend.md](tech/frontend.md)
- **Деплой / провижн?** → [tech/deployment.md](tech/deployment.md)
- **On-call / что-то горит?** → [tech/runbook.md](tech/runbook.md) + [tech/observability.md](tech/observability.md)
- **Performance baseline?** → [tech/perf.md](tech/perf.md)
- **WCAG / a11y audit?** → [tech/a11y.md](tech/a11y.md)
- **Известные STUB-точки?** → [tech/stubs.md](tech/stubs.md)
- **Типовая задача (новый RPC / migration / LLM-задача / page)?** → [../.ai/skills/](../.ai/skills/)

## Структура

```
docs/
├── README.md            ← вы здесь
├── feature/             Каноническая identity (на текущий момент — только identity.md)
└── tech/                Техническая база (architecture / backend / frontend / runbook / ...)
```

## Правила

1. **Документация — живая.** Если код противоречит docs, **доверяй коду, обновляй документ**
2. **Минимализм.** Закрылась инициатива → файл удаляем. Закрытые волны живут в `git log`, не здесь
3. **Self-contained.** Каждый файл читается отдельно, без цепочки из 5 ссылок
4. **Decision log в начале.** Цель → tradeoffs → план. Не narrative
</content>
</invoke>