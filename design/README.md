# design/

Standalone HTML+JSX дизайн-прототипы. **Не часть production-сборки** — открываются прямо в браузере (двойной клик по `.html`), используются как живой референс эстетики.

## Содержимое

### `druz9_design_package/`

«Midnight-velvet» design system для веб-продукта. `Druz9 Design.html` — точка входа, рядом лежат:

- `tokens.css` — CSS-переменные (цвета, типографика, spacing). Источник истины для Hone-эстетики после ADR-001 Phase-4.
- `app.jsx`, `components.jsx`, `windows.jsx` — мини-React (через `<script type="text/babel">` без сборки) с компонентами-референсами.
- `animations.jsx`, `morph.jsx` — keyframes и переходы.
- `design-canvas.jsx`, `tweaks-panel.jsx` — игрушка-playground.

### `hone/`

Лендинг и брендинг Hone-приложения. `index.html` + `hone.jsx` — single-file demo. `landing/` — копия landing-страницы для referenc'а перед редактированием реальной `frontend/src/pages/WelcomePage.tsx`.

## Когда открывать

- При работе над визуалом / типографикой / motion: смотришь в `tokens.css` и `animations.jsx` чтобы выровняться с design system.
- При редизайне страниц web/Hone: сравниваешь живой компонент с прототипом из `components.jsx`.
- При обсуждении правок с дизайнером — это меньшая модель проекта, в которой можно быстро экспериментировать.

## Чего здесь НЕТ

- Production-сборки. Эти файлы не импортируются ни во что.
- Источника правды для tokens — то, что реально в продакшене, лежит в `frontend/src/styles/` (web) и `hone/src/renderer/src/styles/globals.css` (Hone).
- Pencil .pen файлов или Figma exports.

## Если выглядит устаревшим

Возможно. Это playground, не auto-generated. При расхождении с реальным UI — доверяй коду, а прототип обнови или удали.
