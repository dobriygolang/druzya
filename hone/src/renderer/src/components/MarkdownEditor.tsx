// MarkdownEditor — CodeMirror 6 + yCollab + Notion-style live preview.
//
// Stack:
//   - CodeMirror 6 (state/view/commands)
//   - @codemirror/lang-markdown — Lezer-based parser, syntaxTree
//   - @codemirror/language — HighlightStyle, syntaxHighlighting
//   - y-codemirror.next — bidirectional Y.Text ↔ CM6 binding
//   - api/yjs.ts attachNoteYjs — REST sync engine для Y.Doc'а
//
// Что даёт Notion-like ощущение:
//   1. Heading sizes — H1 36px, H2 26px, H3 21px (через HighlightStyle).
//      Markers `# `, `## ` остаются видимыми, но цвет ink-40 — не
//      бросается в глаза (Notion полностью прячет, но это complex
//      decoration-toggling по cursor-line; делаем faded для MVP).
//   2. Bold / italic / inline code — token-based styling, markers
//      faded. **bold** рисуется bold-weight'ом, маркеры `**` приглушённые.
//   3. Blockquote — left-border + indent через ViewPlugin line-decoration.
//   4. Fenced code block — bg + monospace через line-decoration.
//   5. Bullet/ordered list — hanging indent чтобы wrap'нутые строки
//      выравнивались под текстом, не под маркером.
//   6. Auto-continuation — Enter в `- `, `1. `, `> ` continues prefix.
//      Empty prefix → cursor exits structure (Notion behaviour).
//   7. Toolbar — H1/H2/Bold/Italic/Code/Quote/List/Link, всегда видим
//     над editor pane; click меняет document через keymap helpers.
//
// CRDT (через yCollab): два девайса печатают одновременно — оба
// keystroke сохраняются character-level через Yjs.
import { useEffect, useMemo, useRef, useState } from 'react';

import { EditorState, EditorSelection, type EditorStateConfig } from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  Decoration,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
  keymap,
  placeholder as placeholderExt,
  drawSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  HighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { tags as t } from '@lezer/highlight';
import { yCollab } from 'y-codemirror.next';

import { attachNoteYjs, type NoteYjsHandle } from '../api/yjs';
import { SlashMenu, type EditorAPI } from './SlashMenu';
import { FloatingToolbar, type ToolbarOp } from './FloatingToolbar';

interface MarkdownEditorProps {
  noteId: string;
  seedBodyMD: string;
  placeholder?: string;
  onTextChange?: (text: string) => void;
}

export function MarkdownEditor({ noteId, seedBodyMD, placeholder = 'Write your thoughts…', onTextChange }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const handleRef = useRef<NoteYjsHandle | null>(null);
  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;
  // Slash menu — viewport coords + query (после `/`) + slashStart (doc-pos
  // самого `/`). При выборе command'ы integrator стирает [slashStart..cursor)
  // и вставляет block prefix.
  const [slash, setSlash] = useState<{ x: number; y: number; query: string; slashStart: number } | null>(null);
  // Floating bubble toolbar — DOMRect выделения. Null = hidden.
  const [bubbleRect, setBubbleRect] = useState<DOMRect | null>(null);
  // Active ops set — обновляется тем же updateListener'ом что и bubbleRect.
  const [activeOpsSet, setActiveOpsSet] = useState<Set<ToolbarOp>>(() => new Set());
  // seedBodyMD / placeholder читаем через refs — иначе их обновления
  // (которые случаются при каждом setDraftBody parent'ом) попали бы в
  // useEffect deps и вызвали destroy+recreate editor'а на каждый
  // keystroke. Это убивало курсор и сбрасывало ввод.
  // Effect должен mount'ить editor РОВНО ОДИН РАЗ per noteId.
  const seedBodyMDRef = useRef(seedBodyMD);
  const placeholderRef = useRef(placeholder);
  // Update refs on every render — БЕЗ deps в useEffect, чтобы не
  // re-mount'ить editor. Refs use'аются только на effect mount (один раз
  // per noteId), последующие changes prop'ов отображаются в ref для
  // следующего mount'а (когда сменится noteId).
  seedBodyMDRef.current = seedBodyMD;
  placeholderRef.current = placeholder;

  useEffect(() => {
    if (!containerRef.current) return;

    // ВНИМАНИЕ: читаем через refs — НЕ напрямую props. Деps этого useEffect
    // [noteId] only. Если бы seedBodyMD был в deps, parent'ов setDraftBody
    // (на каждый keystroke) re-mount'ил бы editor. См. ref defs выше.
    const handle = attachNoteYjs(noteId, seedBodyMDRef.current);
    handleRef.current = handle;

    const config: EditorStateConfig = {
      doc: handle.ytext.toString(),
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        markdown({ addKeymap: false }), // мы прописываем свои keymap'ы вручную
        syntaxHighlighting(notionLikeHighlight),
        // markdownLineDecorations + wysiwygDecorations УДАЛЕНЫ — их line-class
        // декорации (`cm-md-h*`, `cm-heading-*`) конфликтовали с
        // notionLikeHighlight token-based fontSize → CM6 measure inconsistencies
        // → arrow nav пропускала heading levels. Token-based sizing через
        // syntaxHighlighting(notionLikeHighlight) выше — единственный источник
        // heading typography. Caret nav теперь работает по дефолтным CM6
        // правилам без custom interference.
        checkboxDecorations(),
        fenceDecorations(),
        toggleDecorations(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          // Auto-continuation: Enter после list/quote prefix → продолжаем
          // prefix; пустой prefix → выходим из структуры.
          { key: 'Enter', run: continueLinePrefix },
          // Markdown wrappers — keymap-shortcuts.
          { key: 'Mod-b', run: wrapSelection('**', '**') },
          { key: 'Mod-i', run: wrapSelection('_', '_') },
          { key: 'Mod-k', run: insertLink },
          // Heading shortcuts — Notion compatibility (⌘⌥1/2/3).
          { key: 'Mod-Alt-1', run: (v) => togglePrefix(v, '# ') },
          { key: 'Mod-Alt-2', run: (v) => togglePrefix(v, '## ') },
          { key: 'Mod-Alt-3', run: (v) => togglePrefix(v, '### ') },
        ]),
        yCollab(handle.ytext, null),
        placeholderExt(placeholderRef.current),
        notionTheme(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString();
            onTextChangeRef.current?.(text);
          }
          // Slash-menu trigger detection. На каждое изменение selection или
          // doc'а пересчитываем — вкл/выкл/обновляем query.
          if (update.docChanged || update.selectionSet || update.focusChanged) {
            recomputeSlash(update.view, setSlash);
            recomputeBubble(update.view, setBubbleRect, setActiveOpsSet);
          }
        }),
        // Click-outside и blur тоже скрывают — focus changes покрывает
        // часть, но click без focus-change (e.g. выбор пункта в dropdown)
        // нужен отдельный handler. SlashMenu сам слушает window:mousedown.
      ],
    };

    const view = new EditorView({
      state: EditorState.create(config),
      parent: containerRef.current,
    });
    viewRef.current = view;

    void handle.ready;

    return () => {
      view.destroy();
      viewRef.current = null;
      handle.close();
      handleRef.current = null;
    };
    // ВАЖНО: deps ТОЛЬКО [noteId]. seedBodyMD/placeholder/onTextChange
    // читаются через refs внутри (см. seedBodyMDRef / placeholderRef /
    // onTextChangeRef). Любая re-evaluation effect'а = destroy+recreate
    // CM6 view = курсор теряется и input в полёте дропается. Editor
    // должен mount'иться РОВНО один раз на каждую открытую заметку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // EditorAPI for slash-menu — все операции выражены через CodeMirror
  // transactions. slash хранит slashStart (doc-pos `/`) — мы заменяем
  // [slashStart .. cursor] на нужный prefix.
  const slashEditorAPI: EditorAPI = useMemo(() => {
    const replaceRange = (insert: string, cursorOffset?: number) => {
      const view = viewRef.current;
      if (!view || !slash) return;
      const cursor = view.state.selection.main.head;
      const tr = view.state.update({
        changes: { from: slash.slashStart, to: cursor, insert },
        selection: {
          anchor:
            cursorOffset !== undefined
              ? slash.slashStart + cursorOffset
              : slash.slashStart + insert.length,
        },
      });
      view.dispatch(tr);
      view.focus();
    };
    return {
      insertBlock: (prefix) => replaceRange(prefix),
      insertCodeBlock: () => {
        const block = '```javascript\n\n```\n';
        replaceRange(block, '```javascript\n'.length);
      },
      insertToggle: () => {
        const block = '<details>\n<summary>Title</summary>\n\nContent\n</details>\n';
        replaceRange(block, '<details>\n<summary>'.length);
      },
      insertCallout: () => {
        replaceRange('> **Note:** ');
      },
    };
  }, [slash]);

  // Bubble-toolbar handlers. Reuse CM6 dispatch'ит — proper undo + Yjs sync.
  const onBubbleOp = (op: Exclude<ToolbarOp, 'link'>) => {
    const view = viewRef.current;
    if (!view) return;
    runCMBubbleOp(view, op, activeOpsSet);
  };
  const onBubbleLink = (url: string) => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const sel = view.state.sliceDoc(from, to) || 'link';
    const insert = `[${sel}](${url})`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
    });
    view.focus();
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Static Toolbar убран намеренно — форматирование только через
       *  slash-меню (`/`) и FloatingToolbar при выделении текста. См.
       *  spec Fix 1 в Notes-редактор-rewrite. Old Toolbar component +
       *  hone:md-toolbar event listener больше не используются;
       *  оставлены ниже как dead code чтобы не плодить refactor-noise. */}
      <div ref={containerRef} style={{ minHeight: 280 }} />
      <FloatingToolbar
        rect={bubbleRect}
        activeOps={activeOpsSet}
        onOp={onBubbleOp}
        onLink={onBubbleLink}
        onDismiss={() => setBubbleRect(null)}
      />
      {slash && (
        <SlashMenu
          x={slash.x}
          y={slash.y}
          query={slash.query}
          editor={slashEditorAPI}
          onClose={() => setSlash(null)}
        />
      )}
    </div>
  );
}

// ─── Slash / bubble recompute helpers ─────────────────────────────────────
//
// Извлечены из MarkdownEditor чтобы не загромождать тело компонента и
// чтобы можно было дёргать из CM6 updateListener'а который не имеет
// прямого доступа к state hook'ам React'а — мы передаём setters внутрь.

function recomputeSlash(
  view: EditorView,
  setSlash: (s: { x: number; y: number; query: string; slashStart: number } | null) => void,
): void {
  const sel = view.state.selection.main;
  if (!sel.empty) {
    setSlash(null);
    return;
  }
  const cursor = sel.head;
  const doc = view.state.doc.toString();
  // Идём назад от cursor'а в поисках `/`. Останавливаемся на whitespace
  // или newline (тогда не trigger).
  let i = cursor - 1;
  while (i >= 0) {
    const ch = doc.charAt(i);
    if (ch === '/') break;
    if (ch === '\n' || ch === ' ' || ch === '\t') {
      setSlash(null);
      return;
    }
    i -= 1;
  }
  if (i < 0) {
    setSlash(null);
    return;
  }
  // `/` должен быть в начале строки или после whitespace.
  const before = i === 0 ? '\n' : doc.charAt(i - 1);
  if (before !== '\n' && before !== ' ' && before !== '\t') {
    setSlash(null);
    return;
  }
  const query = doc.slice(i + 1, cursor);
  if (query.includes('\n')) {
    setSlash(null);
    return;
  }
  // Координаты caret'а в viewport через CM6 API.
  const coords = view.coordsAtPos(cursor);
  if (!coords) {
    setSlash(null);
    return;
  }
  setSlash({
    x: coords.left,
    y: coords.bottom + 4, // под cursor'ом, 4px gap
    query,
    slashStart: i,
  });
}

function recomputeBubble(
  view: EditorView,
  setRect: (r: DOMRect | null) => void,
  setActiveOps: (s: Set<ToolbarOp>) => void,
): void {
  const sel = view.state.selection.main;
  if (sel.empty) {
    setRect(null);
    return;
  }
  // Не показываем bubble внутри code-fence строк — там pure мarkdown
  // syntax не имеет смысла.
  const fromLine = view.state.doc.lineAt(sel.from);
  if (fromLine.text.trimStart().startsWith('```')) {
    setRect(null);
    return;
  }
  const fromCoords = view.coordsAtPos(sel.from);
  const toCoords = view.coordsAtPos(sel.to);
  if (!fromCoords || !toCoords) {
    setRect(null);
    return;
  }
  const left = Math.min(fromCoords.left, toCoords.left);
  const right = Math.max(fromCoords.right, toCoords.right);
  const top = Math.min(fromCoords.top, toCoords.top);
  const bottom = Math.max(fromCoords.bottom, toCoords.bottom);
  setRect(new DOMRect(left, top, right - left, bottom - top));

  // Active ops: проверяем wrap'ы вокруг selection через doc.sliceDoc.
  const out = new Set<ToolbarOp>();
  const before2 = view.state.sliceDoc(Math.max(0, sel.from - 2), sel.from);
  const after2 = view.state.sliceDoc(sel.to, Math.min(view.state.doc.length, sel.to + 2));
  const before1 = view.state.sliceDoc(Math.max(0, sel.from - 1), sel.from);
  const after1 = view.state.sliceDoc(sel.to, Math.min(view.state.doc.length, sel.to + 1));
  if (before2 === '**' && after2 === '**') out.add('bold');
  if ((before1 === '_' && after1 === '_') || (before1 === '*' && after1 === '*' && before2 !== '**')) {
    out.add('italic');
  }
  if (before2 === '~~' && after2 === '~~') out.add('strike');
  const before3 = view.state.sliceDoc(Math.max(0, sel.from - 3), sel.from);
  if (before1 === '`' && after1 === '`' && before3 !== '```') out.add('inlineCode');
  // Heading prefix — line.text начинается с # или ##.
  if (fromLine.text.startsWith('# ')) out.add('h1');
  else if (fromLine.text.startsWith('## ')) out.add('h2');
  setActiveOps(out);
}

// ─── Bubble toolbar op runner ─────────────────────────────────────────────

function runCMBubbleOp(
  view: EditorView,
  op: Exclude<ToolbarOp, 'link'>,
  active: ReadonlySet<ToolbarOp>,
): void {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);

  const wrap = (marker: string, isActive: boolean) => {
    if (isActive) {
      // Unwrap: remove marker before `from` and after `to`.
      const before = view.state.sliceDoc(Math.max(0, from - marker.length), from);
      const after = view.state.sliceDoc(to, to + marker.length);
      if (before === marker && after === marker) {
        view.dispatch({
          changes: [
            { from: from - marker.length, to: from, insert: '' },
            { from: to, to: to + marker.length, insert: '' },
          ],
          selection: { anchor: from - marker.length, head: to - marker.length },
        });
      }
      return;
    }
    view.dispatch({
      changes: { from, to, insert: marker + sel + marker },
      selection: {
        anchor: from + marker.length,
        head: to + marker.length,
      },
    });
  };

  if (op === 'bold') return wrap('**', active.has('bold'));
  if (op === 'italic') return wrap('*', active.has('italic'));
  if (op === 'strike') return wrap('~~', active.has('strike'));
  if (op === 'inlineCode') return wrap('`', active.has('inlineCode'));
  if (op === 'codeBlock') {
    view.dispatch({
      changes: { from, to, insert: '```\n' + sel + '\n```' },
      selection: { anchor: from + 4, head: from + 4 + sel.length },
    });
    return;
  }
  if (op === 'h1' || op === 'h2') {
    const prefix = op === 'h1' ? '# ' : '## ';
    const line = view.state.doc.lineAt(from);
    if (line.text.startsWith(prefix)) {
      // Toggle off: strip prefix.
      view.dispatch({
        changes: { from: line.from, to: line.from + prefix.length, insert: '' },
      });
    } else {
      // Strip any other heading prefix first (one update'ом — без двойной транзакции).
      const stripMatch = /^#{1,6}\s+/.exec(line.text);
      const stripLen = stripMatch ? stripMatch[0].length : 0;
      view.dispatch({
        changes: { from: line.from, to: line.from + stripLen, insert: prefix },
      });
    }
  }
}

// ─── Editing helpers ──────────────────────────────────────────────────────

function wrapSelection(before: string, after: string): (view: EditorView) => boolean {
  return (view: EditorView) => {
    const { state } = view;
    const tr = state.update(
      state.changeByRange((range) => {
        const sel = state.sliceDoc(range.from, range.to);
        const replacement = before + sel + after;
        const newSelectionFrom = range.from + before.length;
        const newSelectionTo = newSelectionFrom + sel.length;
        return {
          changes: { from: range.from, to: range.to, insert: replacement },
          range: range.empty
            ? EditorSelection.cursor(range.from + before.length)
            : EditorSelection.range(newSelectionFrom, newSelectionTo),
        };
      }),
    );
    view.dispatch(tr);
    return true;
  };
}

function insertLink(view: EditorView): boolean {
  const { state } = view;
  const tr = state.update(
    state.changeByRange((range) => {
      const sel = state.sliceDoc(range.from, range.to);
      const text = sel || 'link';
      const insert = `[${text}](url)`;
      const urlStart = range.from + text.length + 3;
      const urlEnd = urlStart + 'url'.length;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(urlStart, urlEnd),
      };
    }),
  );
  view.dispatch(tr);
  return true;
}

/**
 * togglePrefix — добавляет или удаляет префикс (`# `, `> `, `- `) на
 * текущей строке. Если уже есть тот же префикс → snimaет (toggle off);
 * иначе ставит. Multi-line selection — применяет ко всем строкам.
 */
function togglePrefix(view: EditorView, prefix: string): boolean {
  const { state } = view;
  const tr = state.update(
    state.changeByRange((range) => {
      const startLine = state.doc.lineAt(range.from);
      const endLine = state.doc.lineAt(range.to);
      const changes: Array<{ from: number; to: number; insert: string }> = [];
      for (let n = startLine.number; n <= endLine.number; n++) {
        const line = state.doc.line(n);
        const stripped = stripExistingMarker(line.text);
        if (line.text.startsWith(prefix)) {
          // Уже есть → toggle off (delete prefix).
          changes.push({ from: line.from, to: line.from + prefix.length, insert: '' });
        } else {
          // Нет → заменяем существующий heading-marker (если был) на новый
          // prefix, или добавляем prefix к чистой строке.
          const replaceFrom = line.from;
          const replaceTo = line.from + (line.text.length - stripped.length);
          changes.push({ from: replaceFrom, to: replaceTo, insert: prefix });
        }
      }
      // Caret в конец первой изменённой строки.
      const updatedFirstLine = state.doc.line(startLine.number);
      const newCaret = updatedFirstLine.from + prefix.length;
      return {
        changes,
        range: EditorSelection.cursor(Math.max(newCaret, range.from)),
      };
    }),
  );
  view.dispatch(tr);
  return true;
}

const HEADING_PREFIX_RE = /^#{1,6}\s+/;
const QUOTE_PREFIX_RE = /^>\s+/;
const BULLET_PREFIX_RE = /^[-*]\s+/;
const ORDERED_PREFIX_RE = /^(\d+)\.\s+/;

function stripExistingMarker(line: string): string {
  let out = line;
  out = out.replace(HEADING_PREFIX_RE, '');
  out = out.replace(QUOTE_PREFIX_RE, '');
  out = out.replace(BULLET_PREFIX_RE, '');
  out = out.replace(ORDERED_PREFIX_RE, '');
  return out;
}

/**
 * continueLinePrefix — Enter behaviour as Notion/Obsidian:
 *   - Внутри `- list item` → следующая строка `- ` (cursor после)
 *   - Внутри `1. item` → `2. ` (auto-increment)
 *   - Внутри `> quote` → `> ` continuation
 *   - Если prefix пустой (e.g. `- ` без content) → удаляем его (выход
 *     из structure), обычный Enter
 *   - Иначе обычный Enter
 */
// Todo prefix REGEX — должен идти ПЕРЕД BULLET_PREFIX_RE т.к. `- [ ]`
// match'ит и BULLET_PREFIX_RE как `- ` (rest = `[ ] task`). Continuation
// должен быть `- [ ] ` (новый пустой todo), не `- ` (downgrade в bullet).
const TODO_PREFIX_RE = /^(\s*)- \[[ xX]\]\s+/;

function continueLinePrefix(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false; // multi-char selection — let default behaviour handle
  const line = state.doc.lineAt(range.head);
  // Курсор должен быть в конце строки (Notion behaviour). Если нет —
  // обычный Enter.
  if (range.head !== line.to) return false;

  // Detect prefix. Important: TODO check ПЕРЕД bullet (см. TODO_PREFIX_RE).
  let prefix = '';
  let isOrdered = false;
  let isTodo = false;
  let orderedNum = 0;

  const todoMatch = TODO_PREFIX_RE.exec(line.text);
  const orderedMatch = !todoMatch ? ORDERED_PREFIX_RE.exec(line.text) : null;

  if (todoMatch) {
    isTodo = true;
    // Сохраняем indentation (если есть) + новый пустой `- [ ] ` checkbox.
    prefix = (todoMatch[1] ?? '') + '- [ ] ';
  } else if (orderedMatch && orderedMatch[1]) {
    isOrdered = true;
    orderedNum = parseInt(orderedMatch[1], 10) + 1;
    prefix = `${orderedNum}. `;
  } else if (BULLET_PREFIX_RE.test(line.text)) {
    prefix = line.text.startsWith('* ') ? '* ' : '- ';
  } else if (QUOTE_PREFIX_RE.test(line.text)) {
    prefix = '> ';
  } else {
    return false; // не наша зона ответственности — let defaultKeymap'у обработать
  }

  // Если строка содержит ТОЛЬКО prefix (empty content) — выходим из
  // structure: удаляем prefix + переводим строку. Это natural way
  // закончить список без копания в раскладке.
  let stripped: string;
  if (isTodo) {
    stripped = line.text.replace(TODO_PREFIX_RE, '');
  } else if (isOrdered) {
    stripped = line.text.replace(ORDERED_PREFIX_RE, '');
  } else {
    stripped = line.text.replace(BULLET_PREFIX_RE, '').replace(QUOTE_PREFIX_RE, '');
  }
  if (stripped.trim() === '') {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: '' },
      selection: EditorSelection.cursor(line.from),
    });
    return true;
  }

  // Иначе — Enter + новый prefix.
  view.dispatch({
    changes: { from: range.head, to: range.head, insert: '\n' + prefix },
    selection: EditorSelection.cursor(range.head + 1 + prefix.length),
  });
  return true;
}

// ─── Highlight style (token-based) ────────────────────────────────────────
//
// HighlightStyle применяется к token'ам которые Lezer parser помечает
// тегами. Stronger типографическая иерархия на heading'ах + faded
// markup-маркеры (`#`, `**`, `_`, `>`, `-`).

const notionLikeHighlight = HighlightStyle.define([
  // Headings — больший размер, semibold, чуть tight letter-spacing.
  {
    tag: t.heading1,
    fontSize: '32px',
    fontWeight: '700',
    letterSpacing: '-0.02em',
    lineHeight: '1.25',
  },
  {
    tag: t.heading2,
    fontSize: '24px',
    fontWeight: '600',
    letterSpacing: '-0.018em',
    lineHeight: '1.3',
  },
  {
    tag: t.heading3,
    fontSize: '19px',
    fontWeight: '600',
    letterSpacing: '-0.015em',
    lineHeight: '1.35',
  },
  { tag: t.heading4, fontSize: '17px', fontWeight: '600' },
  { tag: t.heading5, fontSize: '15px', fontWeight: '600' },
  { tag: t.heading6, fontSize: '14px', fontWeight: '600' },

  // Bold / italic.
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--ink-40)' },

  // Inline code: monospace + subtle bg.
  {
    tag: t.monospace,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: '0.9em',
    background: 'rgba(255,255,255,0.06)',
    padding: '1px 5px',
    borderRadius: '4px',
  },

  // Links (text part).
  { tag: t.link, color: 'var(--ink)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--ink-40)' },

  // Lists.
  { tag: t.list, color: 'var(--ink)' },

  // Quotes — italic, ink-60 (border-left добавит ViewPlugin ниже).
  { tag: t.quote, fontStyle: 'italic', color: 'var(--ink-60)' },

  // Faded markup. Lezer-tag `processInstruction` / `meta` / `comment` —
  // нет на markdown'е. Используем tag.processingInstruction для marker'ов
  // (`#`, `**`, `_`, `\``, `-`, `>`). Если parser не маркирует их этим
  // тэгом (зависит от @lezer/markdown version) — fallback в decoration
  // mark внизу.
  {
    tag: [t.processingInstruction, t.punctuation, t.meta],
    color: 'var(--ink-40)',
    opacity: '0.6',
  },
]);

// ─── Line/inline custom decorations — УДАЛЕНЫ ────────────────────────────
//
// History: prior versions добавляли:
//   - markdownLineDecorations() с line-classes на blockquote/fenced/heading
//     (cm-md-h*, cm-md-quote-line, cm-md-code-line) — у этих классов НЕ БЫЛО
//     CSS, dead code от старого refactor'а
//   - wysiwygDecorations() с cm-heading-1/2/3 line-classes + token-based
//     dim markers — конфликтовало с notionLikeHighlight token sizing,
//     ломая CM6 measure-engine → arrow nav пропускала heading levels
//
// Сейчас heading typography только через `notionLikeHighlight` HighlightStyle
// (token-based, см. notionTheme и syntaxHighlighting()). Caret nav работает
// по дефолтным CM6 правилам без custom interference. Если в будущем
// захочется line-level styling (border-left для quote, bg для fenced code),
// надо CAREFULLY measure heights и НЕ дублировать sizing с tokens.

// ─── WYSIWYG / line-decorations: ВСЁ УДАЛЕНО ─────────────────────────────
//
// 6 итераций попыток сделать Notion-style hide/dim markers через
// Decoration.replace + atomicRanges + line-classes ломали CM6 caret
// navigation в неочевидных edge-case'ах. Чисто token-based styling
// (notionLikeHighlight HighlightStyle, см. ниже) — единственный
// надёжный путь без сюрпризов.
//
// Что юзер видит:
//   - `# Heading` — большой жирный текст (font-size 32px from t.heading1)
//   - `**bold**` — жирный, маркеры `**` тоже жирные (тем же tag'ом)
//   - `*italic*` — курсив
//   - `` `code` `` — monospace
//   - `> quote` — без line-styling, только token-color faded для `>`
//   - `---` — без визуального hr, просто текст `---`
//
// Trade-off: маркеры `# ## ` видны как часть heading-text, не отдельно
// faded. Это тоже не Notion, но это работает 100% predictably.

// ─── Toggle (<details>) decoration ────────────────────────────────────────
//
// Pattern:
//   <details>
//   <summary>Title</summary>
//
//   Content
//
//   </details>
//
// Добавляем:
//   - <summary> строка получает widget triangle ▶/▼ слева — клик toggle'ит
//     collapsed state. State хранится per-document в Set<openLine> на
//     module-уровне (in-memory, не персистится — Notion ведёт себя так же).
//   - В collapsed state — все строки между <summary> и </details>
//     получают line-decoration с display:none. Курсор пользователя
//     может туда попасть стрелочками (atomic не используем — иначе
//     юзер потеряет доступ к редактированию content'а).
//
// Парсинг прост: regex по строкам, парим open/close. Не nested
// (Notion толком тоже не поддерживает nested toggle UI).

// Глобальный set открытых toggle'ов, индексируется по от <details> line position.
// Не персистится — при reopen note все toggle'ы закрытые. Это ок для MVP.
const collapsedToggles = new Set<number>();

class ToggleSummaryWidget extends WidgetType {
  constructor(
    readonly detailsLineFrom: number,
    readonly collapsed: boolean,
  ) {
    super();
  }
  eq(other: ToggleSummaryWidget): boolean {
    return other.detailsLineFrom === this.detailsLineFrom && other.collapsed === this.collapsed;
  }
  toDOM(view: EditorView): HTMLElement {
    const tri = document.createElement('button');
    tri.type = 'button';
    tri.textContent = this.collapsed ? '▶' : '▼';
    tri.style.cssText = [
      'display:inline-block',
      'width:18px',
      'margin:0 6px 0 0',
      'border:none',
      'background:transparent',
      'color:var(--ink-40)',
      'font-size:10px',
      'cursor:pointer',
      'transition:color 140ms ease',
    ].join(';');
    tri.addEventListener('mouseenter', () => {
      tri.style.color = 'var(--ink-60)';
    });
    tri.addEventListener('mouseleave', () => {
      tri.style.color = 'var(--ink-40)';
    });
    tri.addEventListener('mousedown', (e) => e.preventDefault());
    tri.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (collapsedToggles.has(this.detailsLineFrom)) {
        collapsedToggles.delete(this.detailsLineFrom);
      } else {
        collapsedToggles.add(this.detailsLineFrom);
      }
      // Force CM6 re-render: empty no-op transaction triggers ViewPlugin.update.
      view.dispatch({});
    });
    return tri;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

const collapsedLineDeco = Decoration.line({
  attributes: { style: 'display:none' },
});

function toggleDecorations() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = this.build(u.view);
        }
      }
      build(view: EditorView): DecorationSet {
        const builder: Array<{ from: number; to?: number; deco: Decoration }> = [];
        const doc = view.state.doc;
        let openDetails: number | null = null; // line number `<details>` строки
        for (let i = 1; i <= doc.lines; i++) {
          const line = doc.line(i);
          const trimmed = line.text.trim();
          if (trimmed === '<details>') {
            openDetails = i;
          } else if (trimmed === '</details>' && openDetails !== null) {
            // Найдём <summary> между openDetails и i.
            let summaryLine: number | null = null;
            for (let j = openDetails + 1; j < i; j++) {
              const inner = doc.line(j).text.trim();
              if (inner.startsWith('<summary>')) {
                summaryLine = j;
                break;
              }
            }
            if (summaryLine !== null) {
              const summary = doc.line(summaryLine);
              const detailsLineFrom = doc.line(openDetails).from;
              const collapsed = collapsedToggles.has(detailsLineFrom);
              // Triangle widget — at start of <summary> line.
              builder.push({
                from: summary.from,
                deco: Decoration.widget({
                  widget: new ToggleSummaryWidget(detailsLineFrom, collapsed),
                  side: -1,
                }),
              });
              if (collapsed) {
                // Hide все строки между <summary>+1 и </details>-1.
                for (let j = summaryLine + 1; j < i; j++) {
                  const cl = doc.line(j);
                  builder.push({ from: cl.from, deco: collapsedLineDeco });
                }
              }
            }
            openDetails = null;
          }
        }
        builder.sort((a, b) => a.from - b.from);
        return Decoration.none.update({
          add: builder.map((b) => b.deco.range(b.from)),
        });
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}

// ─── Code block language picker ───────────────────────────────────────────
//
// Pattern: ` ```lang ` или ` ``` ` в начале строки = open fence. Рендерим
// поверх line'а pill с текущим языком + copy-button. Клик на pill →
// dropdown со списком LANGUAGES; выбор → replace `lang` в fence-строке.
// Click на copy → копируем тело блока (между fence-строками) в clipboard.
//
// Pill — Decoration.widget (НЕ replace — оставляем fence-text видимым;
// pill висит float'ом справа от fence-маркера). Сам widget просто overlay'ит
// абсолютную пилюлю над fence строкой.

const CODE_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'go',
  'rust',
  'sql',
  'bash',
  'json',
  'yaml',
  'html',
  'css',
  'markdown',
] as const;

class FenceWidget extends WidgetType {
  constructor(
    readonly language: string,
    readonly fenceLineFrom: number,
    readonly fenceLineTo: number,
    readonly contentFrom: number,
    readonly contentTo: number,
  ) {
    super();
  }
  eq(other: FenceWidget): boolean {
    return (
      other.language === this.language &&
      other.fenceLineFrom === this.fenceLineFrom &&
      other.contentFrom === this.contentFrom &&
      other.contentTo === this.contentTo
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.style.cssText = [
      'display:inline-flex',
      'gap:4px',
      'align-items:center',
      'margin-left:8px',
      'vertical-align:middle',
    ].join(';');

    // Lang pill — кликабельная, открывает dropdown.
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.textContent = this.language || 'plain';
    pill.style.cssText = [
      'font-size:10px',
      'font-family:var(--font-mono, monospace)',
      'letter-spacing:0.08em',
      'color:var(--ink-40)',
      'background:rgba(255,255,255,0.04)',
      'border:1px solid rgba(255,255,255,0.06)',
      'border-radius:4px',
      'padding:2px 6px',
      'cursor:pointer',
      'transition:color 140ms ease',
    ].join(';');
    pill.addEventListener('mouseenter', () => {
      pill.style.color = 'var(--ink-60)';
    });
    pill.addEventListener('mouseleave', () => {
      pill.style.color = 'var(--ink-40)';
    });
    pill.addEventListener('mousedown', (e) => e.preventDefault());
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openLangDropdown(view, pill, this.language, this.fenceLineFrom);
    });

    // Copy button — справа от pill.
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.title = 'Copy code';
    copy.textContent = 'copy';
    copy.style.cssText = [
      'font-size:10px',
      'font-family:var(--font-mono, monospace)',
      'letter-spacing:0.08em',
      'color:var(--ink-40)',
      'background:transparent',
      'border:none',
      'padding:2px 4px',
      'cursor:pointer',
      'opacity:0.6',
      'transition:opacity 140ms ease',
    ].join(';');
    copy.addEventListener('mouseenter', () => {
      copy.style.opacity = '1';
      copy.style.color = 'var(--ink-60)';
    });
    copy.addEventListener('mouseleave', () => {
      copy.style.opacity = '0.6';
      copy.style.color = 'var(--ink-40)';
    });
    copy.addEventListener('mousedown', (e) => e.preventDefault());
    copy.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const body = view.state.sliceDoc(this.contentFrom, this.contentTo);
      void navigator.clipboard.writeText(body).then(() => {
        copy.textContent = '✓';
        window.setTimeout(() => {
          copy.textContent = 'copy';
        }, 1200);
      });
    });

    wrap.appendChild(pill);
    wrap.appendChild(copy);
    return wrap;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

function openLangDropdown(
  view: EditorView,
  anchor: HTMLElement,
  current: string,
  fenceLineFrom: number,
): void {
  // Закрываем существующий dropdown если есть.
  document.querySelectorAll('[data-cm-lang-dropdown]').forEach((n) => n.remove());

  const rect = anchor.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.setAttribute('data-cm-lang-dropdown', '1');
  menu.style.cssText = [
    'position:fixed',
    `left:${rect.left}px`,
    `top:${rect.bottom + 4}px`,
    'z-index:60',
    'background:rgba(20,20,22,0.96)',
    'backdrop-filter:blur(18px)',
    '-webkit-backdrop-filter:blur(18px)',
    'border:1px solid rgba(255,255,255,0.08)',
    'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
    'border-radius:10px',
    'padding:6px',
    'min-width:160px',
    'max-height:280px',
    'overflow-y:auto',
  ].join(';');

  for (const lang of CODE_LANGUAGES) {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = lang;
    item.style.cssText = [
      'display:block',
      'width:100%',
      'padding:6px 10px',
      'border:none',
      'border-radius:6px',
      'background:transparent',
      `color:${lang === current ? 'var(--ink)' : 'var(--ink-90)'}`,
      'font-size:12px',
      'font-family:var(--font-mono, monospace)',
      'letter-spacing:0.04em',
      'text-align:left',
      'cursor:pointer',
      'transition:background-color 140ms ease',
    ].join(';');
    item.addEventListener('mouseenter', () => {
      item.style.background = 'rgba(255,255,255,0.06)';
      item.style.color = 'var(--ink)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = 'transparent';
      item.style.color = lang === current ? 'var(--ink)' : 'var(--ink-90)';
    });
    item.addEventListener('mousedown', (e) => e.preventDefault());
    item.addEventListener('click', () => {
      // Заменяем lang в fence-строке: position fenceLineFrom + 3 (после ```)
      // .. до следующего \n или конца строки.
      const line = view.state.doc.lineAt(fenceLineFrom);
      const fenceText = line.text;
      const fenceM = /^```(\S*)/.exec(fenceText);
      if (fenceM) {
        const langStart = line.from + 3;
        const langEnd = line.from + 3 + fenceM[1]!.length;
        view.dispatch({
          changes: { from: langStart, to: langEnd, insert: lang },
        });
      }
      menu.remove();
    });
    menu.appendChild(item);
  }

  document.body.appendChild(menu);

  // Click-outside / Esc → close.
  const onDoc = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      menu.remove();
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    }
  };
  window.setTimeout(() => {
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
  }, 0);
}

const FENCE_RE = /^```(\S*)/;

function fenceDecorations() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = this.build(u.view);
        }
      }
      build(view: EditorView): DecorationSet {
        const builder: Array<{ from: number; deco: Decoration }> = [];
        // Сканируем все строки (не только viewportRanges) чтобы корректно
        // парить open/close fence pairs, в которых одна из строк может быть
        // вне viewport'а. Доc небольшой (note size cap'ится бэкендом),
        // фуллскан дешёвый.
        const doc = view.state.doc;
        let openLine: { from: number; lang: string } | null = null;
        for (let i = 1; i <= doc.lines; i++) {
          const line = doc.line(i);
          const m = FENCE_RE.exec(line.text);
          if (m) {
            if (!openLine) {
              openLine = { from: line.from, lang: m[1] || '' };
              const closeLine = findCloseFence(doc, i);
              if (closeLine !== null) {
                const close = doc.line(closeLine);
                const contentFrom = line.to + 1;
                const contentTo = close.from > contentFrom ? close.from - 1 : contentFrom;
                builder.push({
                  from: line.to,
                  deco: Decoration.widget({
                    widget: new FenceWidget(
                      openLine.lang,
                      line.from,
                      line.to,
                      contentFrom,
                      contentTo,
                    ),
                    side: 1,
                  }),
                });
              }
              openLine = null;
            } else {
              openLine = null;
            }
          }
        }
        builder.sort((a, b) => a.from - b.from);
        return Decoration.none.update({
          add: builder.map((b) => b.deco.range(b.from)),
        });
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}

function findCloseFence(
  doc: ReturnType<EditorView['state']['doc']['line']> extends { text: string }
    ? EditorView['state']['doc']
    : EditorView['state']['doc'],
  openLineNumber: number,
): number | null {
  for (let i = openLineNumber + 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (line.text.startsWith('```')) return i;
  }
  return null;
}

// ─── Checkbox decoration ──────────────────────────────────────────────────
//
// Pattern: `- [ ]` (unchecked) или `- [x]` (checked) в начале строки —
// рендерим `[ ]` / `[x]` как replace-decoration с Widget'ом-input'ом.
// Click → dispatch transaction которая меняет `[ ]` ↔ `[x]`. Cursor
// position не меняем — Widget вне normal selection flow'а.
//
// Атомичность: важно `atomic: true` чтобы caret прыгал мимо widget'а
// при стрелочках (как в Notion — пустой checkbox не "доступен" caret'у),
// иначе курсор застревает в hidden range.

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly checkboxFrom: number,
    readonly checkboxTo: number,
  ) {
    super();
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.checkboxFrom === this.checkboxFrom;
  }
  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.checked;
    input.style.cssText = [
      'width:14px',
      'height:14px',
      'margin:0 4px 0 0',
      'border-radius:3px',
      'border:1.5px solid rgba(255,255,255,0.2)',
      'background:transparent',
      'cursor:pointer',
      'vertical-align:-2px',
      `accent-color:${this.checked ? 'var(--ink)' : 'var(--ink-60)'}`,
    ].join(';');
    input.addEventListener('mousedown', (e) => {
      // Не отбираем focus у редактора + не позволяем CM6 трактовать
      // mousedown как селекшн-старт.
      e.preventDefault();
      e.stopPropagation();
    });
    input.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Toggle `[ ]` ↔ `[x]` через CM6 transaction. Меняем единственный
      // символ внутри скобок (положения checkboxFrom+1 .. checkboxFrom+2).
      view.dispatch({
        changes: {
          from: this.checkboxFrom + 1,
          to: this.checkboxFrom + 2,
          insert: this.checked ? ' ' : 'x',
        },
      });
    });
    return input;
  }
  ignoreEvent(): boolean {
    // Возвращаем false — позволяем mousedown/click пробросить наш handler.
    return false;
  }
}

const TODO_RE = /^(\s*[-*]\s+)\[([ xX])\]/;

function checkboxDecorations() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = this.build(u.view);
        }
      }
      build(view: EditorView): DecorationSet {
        const builder: Array<{ from: number; to: number; deco: Decoration }> = [];
        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            const line = view.state.doc.lineAt(pos);
            const m = TODO_RE.exec(line.text);
            if (m) {
              const checkboxOffset = m[1]!.length; // прыгаем за `- ` префикс
              const checkboxFrom = line.from + checkboxOffset;
              const checkboxTo = checkboxFrom + 3; // `[x]` или `[ ]`
              const checked = m[2] !== ' ';
              builder.push({
                from: checkboxFrom,
                to: checkboxTo,
                deco: Decoration.replace({
                  widget: new CheckboxWidget(checked, checkboxFrom, checkboxTo),
                  // Atomic — caret skip'ает widget при keyboard nav.
                  inclusive: false,
                }),
              });
            }
            if (line.to >= to) break;
            pos = line.to + 1;
          }
        }
        builder.sort((a, b) => a.from - b.from);
        return Decoration.none.update({
          add: builder.map((b) => b.deco.range(b.from, b.to)),
        });
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}

// markdownLineDecorations() УДАЛЕНА — добавляла line-classes (cm-md-h*,
// cm-md-quote-line, cm-md-code-line) у которых НЕ БЫЛО CSS правил →
// функция была no-op. Heading typography теперь только через token-based
// notionLikeHighlight (см. ниже). См. также комментарий выше про
// «WYSIWYG / line-decorations: ВСЁ УДАЛЕНО».

// ─── Theme ────────────────────────────────────────────────────────────────

function notionTheme() {
  return EditorView.theme(
    {
      '&': {
        backgroundColor: 'transparent',
        color: 'var(--ink)',
      },
      '.cm-content': {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
        fontSize: '16px',
        lineHeight: '1.65',
        padding: '0',
        caretColor: 'var(--ink)',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--ink)',
        borderLeftWidth: '1.5px',
      },
      '.cm-selectionBackground, ::selection': {
        backgroundColor: 'rgba(255,255,255,0.18)',
      },
      '&.cm-focused .cm-selectionBackground': {
        backgroundColor: 'rgba(255,255,255,0.22)',
      },
      '&.cm-focused': {
        outline: 'none',
      },
      '.cm-line': {
        padding: '0',
      },
      '.cm-placeholder': {
        color: 'var(--ink-40)',
        fontStyle: 'normal',
      },

      // Block-level decorations.
      '.cm-md-quote-line': {
        borderLeft: '3px solid var(--ink-20)',
        paddingLeft: '14px',
        color: 'var(--ink-60)',
      },
      '.cm-md-code-line': {
        background: 'rgba(255,255,255,0.04)',
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        fontSize: '13.5px',
        paddingLeft: '14px',
        paddingRight: '14px',
      },
      '.cm-md-code-first': {
        paddingTop: '6px',
        borderTopLeftRadius: '6px',
        borderTopRightRadius: '6px',
        marginTop: '4px',
      },
      '.cm-md-code-last': {
        paddingBottom: '6px',
        borderBottomLeftRadius: '6px',
        borderBottomRightRadius: '6px',
        marginBottom: '4px',
      },
      // Heading line — chunk margin для воздуха над/под.
      '.cm-md-h': {
        marginTop: '0.6em',
        marginBottom: '0.2em',
      },
      '.cm-md-h1': { marginTop: '0.8em' },
      '.cm-md-h2': { marginTop: '0.7em' },

      // y-codemirror.next selection-info popup — hide для single-user
      // multi-device (awareness UI deferred per ADR).
      '.cm-ySelectionInfo': { display: 'none' },
    },
    { dark: true },
  );
}
