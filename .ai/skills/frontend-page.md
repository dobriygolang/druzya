---
name: frontend-page
description: Add a new page to druz9 web (frontend/) or Hone (hone/) — routing, Connect-RPC wiring, layout, state, and visual consistency with the design system. Use when shipping a new feature surface.
---

# Добавить страницу

Web (`frontend/`) и Hone (`hone/`) — оба React 18 + Vite + TS + Connect-RPC. Cue (`desktop/`) — другой паттерн (tray-screens), отдельная история.

## Когда применять

- Новая фича в web (по типу `/insights`, `/circles`).
- Новая страница в Hone (например, отдельный модуль за хоткеем).

## Не применять

- Modal / overlay / popup — это компонент в `components/`, не страница.
- Обновление существующей страницы — открой её и редактируй, не создавай дубль.

## Принципы (общие для web + Hone)

- **strict TypeScript.** Ни `@ts-nocheck`, ни `any` без обоснования.
- **Generated types only для proto.** Не дублируй тип сервера в TS.
- **Zustand для local state, react-query для server state.** Не смешивай.
- **CSS — utility-first.** Web: Tailwind. Hone: CSS variables + `globals.css` primitives. Inline `style` — только для runtime-вычислений.
- **Keyboard accessibility.** Esc закрывает overlay. Enter подтверждает. Tab-flow логичен.

## Web: добавить страницу

### 1. Создать компонент

`frontend/src/pages/<Name>Page.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { honeClient } from "@/api/honeClient";

export function FocusGoalsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["focus-goals", "me"],
    queryFn: () => honeClient.getFocusGoals({}),
  });

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError error={error} />;

  return (
    <PageShell title="Focus goals">
      {/* ... */}
    </PageShell>
  );
}
```

Соглашения:
- Один default-export не используем — именованный экспорт `export function`.
- Loading / error / empty states — отдельно, не inline-тернарии.
- Используй существующие primitives: `<PageShell>`, `<PageSkeleton>`, `<EmptyState>` (см `components/`).

### 2. Добавить роут

`frontend/src/router.tsx` (или `App.tsx` в зависимости от текущего паттерна):

```tsx
{
  path: "/focus-goals",
  element: <FocusGoalsPage />,
  // protected: requires auth
}
```

### 3. Добавить в навигацию

Если страница в top-nav — `frontend/src/components/TopNav.tsx`. Соблюдай порядок (см [for_investment/druz9.md](../../docs/for_investment/druz9.md)). Insights → Atlas → Circles → Codex → Vacancies → Slots — пример порядка.

### 4. RPC wrapper

Если бэкенд-метод новый — сначала [.ai/skills/add-rpc.md](./add-rpc.md). Потом в `frontend/src/api/`:

```ts
import { HoneService } from "@generated/pb/druz9/v1/hone_connect";
import { transport } from "./apiClient";

export const honeClient = createPromiseClient(HoneService, transport);
```

### 5. Эстетика

После ADR-001 Phase-4 web переведён в Hone-эстетику:

- Чистый чёрный фон, белый + 3 оттенка серого, единственный акцент `#FF3B30`.
- Hairlines (1px borders) вместо толстых разделителей.
- `JetBrains Mono` или `Geist Mono` для цифр.
- Никаких gradient'ов (старый violet→cyan→pink удалён).

Проверка визуала: открой соседнюю «образцовую» страницу (`/insights`, `/atlas`) и сверь токены.

### 6. MSW моки

`frontend/src/mocks/handlers.ts`:

```ts
http.post("/druz9.v1.HoneService/GetFocusGoals", () => HttpResponse.json({
  goals: [{ id: "1", target_minutes: 120 }],
}));
```

Без моков страница не работает в `npm run dev` без бэкенда.

### 7. Проверка

```bash
cd frontend
npm run typecheck
npm run lint
npm run dev    # руками открыть страницу, проверить loading/error/empty
```

## Hone: добавить страницу

### 1. Создать компонент

`hone/src/renderer/src/pages/<Name>.tsx`:

```tsx
export function FocusGoals() {
  const { data, error } = useFocusGoals();

  return (
    <div className="h-screen bg-black text-white p-8 font-sans">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-medium">Focus Goals</h1>
        <Kbd>Esc</Kbd>
      </header>
      {/* ... */}
    </div>
  );
}
```

### 2. Зарегистрировать роутинг

`hone/src/renderer/src/App.tsx` — там roughly switch/router. Добавь:

```tsx
{route === "focus-goals" && <FocusGoals />}
```

### 3. Добавить хоткей

В `App.tsx` есть `useEffect` слушающий keyboard. Добавь shortcut (одна буква, не занятая существующими):

```tsx
if (e.key === "G") setRoute("focus-goals");
```

И в `Palette.tsx` (⌘K) добавь команду:

```tsx
{ id: "focus-goals", label: "Focus Goals", hint: "G", onSelect: () => setRoute("focus-goals") }
```

### 4. RPC wrapper

`hone/src/renderer/src/api/<service>.ts`:

```ts
import { transport } from "./transport";
import { HoneService } from "@generated/pb/druz9/v1/hone_connect";

const client = createPromiseClient(HoneService, transport);

export async function getFocusGoals() {
  const resp = await client.getFocusGoals({});
  return resp.goals; // unwrap proto envelope
}
```

### 5. Эстетика — minimum-essence

- Один canvas, fullscreen.
- Esc возвращает в Home.
- Никаких toolbar'ов / меню / sidebar'ов.
- Если на экране больше двух визуальных групп — переверстать.

### 6. Проверка

```bash
cd hone
npm run typecheck
npm run lint
npm run dev
# Внутри Hone: открой страницу через хоткей, проверь Esc, ⌘K, loading/error
```

## Anti-patterns

- ❌ **Дублировать generated types** в `types.ts`. Импортируй из `@generated/`.
- ❌ **Inline JSX-логика без декомпозиции.** Если страница > 200 строк — выноси секции в компоненты.
- ❌ **`useEffect` для server state.** react-query / SWR, никаких ручных fetch'ей.
- ❌ **Кастомные роуты вне центрального router'а.** В web — react-router, в Hone — `App.tsx` switch.
- ❌ **Web-style фичи в Hone.** Если страница требует sidebar/breadcrumbs — она не в Hone.
- ❌ **Hone-style фичи в web.** Если нужен fullscreen без chrome — это не страница, это modal.
- ❌ **Нет loading state.** Минимум `<PageSkeleton />` пока fetch.
- ❌ **CSS-in-JS / styled-components.** Не используем.

## Related

- [.ai/skills/add-rpc.md](./add-rpc.md) — если страница вызывает новый бэкенд-метод
- [docs/tech/frontend.md](../../docs/tech/frontend.md) — общая структура клиентов
- [docs/for_investment/hone.md](../../docs/for_investment/hone.md) — что Hone делает / не делает (правило несаморазмывания)
