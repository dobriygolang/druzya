// Today — bookkeeping module. R10 cleanup 2026-05-05:
// `page === 'today'` рендерит TaskBoardPage (см App.tsx ~line 855), и весь
// 1164-line TodayPage UI стал orphan'ом ещё на focus-refactor (apr 2026,
// см memory/project_redesign_2026_04). Файл свернут до тип-shape'а, чтобы
// startFocus callback'у было что подписать. При возврате surface'а —
// восстановить из git history.

export interface StartFocusArgs {
  planItemId?: string;
  pinnedTitle?: string;
}
