// theme.ts — dark-only (light theme killed 2026-05-11 CI4 + finalised
// 2026-05-12 Phase J). `index.html` уже выставляет `<html class="dark"
// style="color-scheme: dark">` на старте; этот файл — пустой shim
// сохранён только чтобы любые случайные `import` не сломались. Когда
// удостоверимся что callsites = 0 (grep чист), файл можно удалить
// целиком. См memory/feedback_color_rule.md (B/W only, #FF3B30 ТОЛЬКО
// indicator).

export {}
