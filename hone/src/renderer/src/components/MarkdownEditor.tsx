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
import { useEffect, useRef } from 'react';

import { EditorState, EditorSelection, type EditorStateConfig } from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  Decoration,
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
  syntaxTree,
} from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { tags as t } from '@lezer/highlight';
import { yCollab } from 'y-codemirror.next';

import { attachNoteYjs, type NoteYjsHandle } from '../api/yjs';

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
        markdownLineDecorations(),
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
        }),
      ],
    };

    const view = new EditorView({
      state: EditorState.create(config),
      parent: containerRef.current,
    });
    viewRef.current = view;

    void handle.ready;

    // Expose toolbar handle via DOM custom event — Toolbar component
    // (рендерится parent'ом) находит EditorView через event response.
    // Альтернатива — context — overengineered для одной кнопки в toolbar.
    const onToolbarAction = (e: Event) => {
      const ce = e as CustomEvent<{ action: ToolbarAction; targetEl: HTMLElement }>;
      if (ce.detail.targetEl !== containerRef.current) return;
      runToolbarAction(view, ce.detail.action);
    };
    window.addEventListener('hone:md-toolbar', onToolbarAction);

    return () => {
      window.removeEventListener('hone:md-toolbar', onToolbarAction);
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

  return (
    <div>
      <Toolbar containerRef={containerRef} />
      <div ref={containerRef} style={{ minHeight: 280 }} />
    </div>
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────

type ToolbarAction =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bold'
  | 'italic'
  | 'code'
  | 'quote'
  | 'list'
  | 'link';

function Toolbar({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const dispatch = (action: ToolbarAction) => {
    if (!containerRef.current) return;
    window.dispatchEvent(
      new CustomEvent('hone:md-toolbar', {
        detail: { action, targetEl: containerRef.current },
      }),
    );
  };
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '4px 0 12px',
        borderBottom: '1px solid var(--ink-10)',
        marginBottom: 12,
        flexWrap: 'wrap',
      }}
    >
      <ToolbarBtn label="H1" title="Heading 1 (⌘⌥1)" onClick={() => dispatch('h1')} />
      <ToolbarBtn label="H2" title="Heading 2 (⌘⌥2)" onClick={() => dispatch('h2')} />
      <ToolbarBtn label="H3" title="Heading 3 (⌘⌥3)" onClick={() => dispatch('h3')} />
      <ToolbarSep />
      <ToolbarBtn icon="B" title="Bold (⌘B)" onClick={() => dispatch('bold')} bold />
      <ToolbarBtn icon="I" title="Italic (⌘I)" onClick={() => dispatch('italic')} italic />
      <ToolbarBtn label="</>" title="Inline code" onClick={() => dispatch('code')} mono />
      <ToolbarSep />
      <ToolbarBtn label="“ ”" title="Quote" onClick={() => dispatch('quote')} />
      <ToolbarBtn label="• —" title="Bullet list" onClick={() => dispatch('list')} />
      <ToolbarBtn label="🔗" title="Link (⌘K)" onClick={() => dispatch('link')} />
    </div>
  );
}

function ToolbarBtn({
  label,
  icon,
  title,
  onClick,
  bold,
  italic,
  mono,
}: {
  label?: string;
  icon?: string;
  title: string;
  onClick: () => void;
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="focus-ring"
      style={{
        height: 28,
        minWidth: 28,
        padding: '0 8px',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--ink-60)',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: bold ? 700 : 500,
        fontStyle: italic ? 'italic' : 'normal',
        fontFamily: mono ? 'ui-monospace, "SF Mono", Menlo, monospace' : 'inherit',
        transition: 'color 140ms ease, background-color 140ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--ink)';
        e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--ink-60)';
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {icon ?? label}
    </button>
  );
}

function ToolbarSep() {
  return (
    <span
      aria-hidden
      style={{
        width: 1,
        height: 16,
        background: 'var(--ink-10)',
        margin: '0 6px',
      }}
    />
  );
}

function runToolbarAction(view: EditorView, action: ToolbarAction): void {
  switch (action) {
    case 'h1':
      togglePrefix(view, '# ');
      break;
    case 'h2':
      togglePrefix(view, '## ');
      break;
    case 'h3':
      togglePrefix(view, '### ');
      break;
    case 'bold':
      wrapSelection('**', '**')(view);
      break;
    case 'italic':
      wrapSelection('_', '_')(view);
      break;
    case 'code':
      wrapSelection('`', '`')(view);
      break;
    case 'quote':
      togglePrefix(view, '> ');
      break;
    case 'list':
      togglePrefix(view, '- ');
      break;
    case 'link':
      insertLink(view);
      break;
  }
  view.focus();
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
function continueLinePrefix(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false; // multi-char selection — let default behaviour handle
  const line = state.doc.lineAt(range.head);
  // Курсор должен быть в конце строки (Notion behaviour). Если нет —
  // обычный Enter.
  if (range.head !== line.to) return false;

  // Detect prefix.
  let prefix = '';
  let isOrdered = false;
  let orderedNum = 0;

  const orderedMatch = ORDERED_PREFIX_RE.exec(line.text);
  if (orderedMatch && orderedMatch[1]) {
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
  const stripped = isOrdered
    ? line.text.replace(ORDERED_PREFIX_RE, '')
    : line.text.replace(BULLET_PREFIX_RE, '').replace(QUOTE_PREFIX_RE, '');
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

// ─── Line-level decorations (block constructs) ────────────────────────────
//
// HighlightStyle покрывает inline tokens, но не line-level styling
// (border-left для blockquote, bg для fenced code). Эти ставит
// ViewPlugin сканированием syntaxTree.

const quoteLineDeco = Decoration.line({ class: 'cm-md-quote-line' });
const codeBlockLineDeco = Decoration.line({ class: 'cm-md-code-line' });
const codeBlockFirstDeco = Decoration.line({ class: 'cm-md-code-line cm-md-code-first' });
const codeBlockLastDeco = Decoration.line({ class: 'cm-md-code-line cm-md-code-last' });
const headingLineDeco = (level: number) =>
  Decoration.line({ class: `cm-md-h cm-md-h${level}` });

function markdownLineDecorations() {
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
        for (const { from, to } of view.visibleRanges) {
          syntaxTree(view.state).iterate({
            from,
            to,
            enter: (node) => {
              const name = node.type.name;
              if (name === 'Blockquote') {
                // Каждая строка внутри Blockquote получает deco.
                let pos = node.from;
                while (pos <= node.to) {
                  const line = view.state.doc.lineAt(pos);
                  if (line.from >= node.from) {
                    builder.push({ from: line.from, deco: quoteLineDeco });
                  }
                  if (line.to >= node.to) break;
                  pos = line.to + 1;
                }
              } else if (name === 'FencedCode') {
                let pos = node.from;
                let firstSeen = false;
                let lastLineFrom = -1;
                while (pos <= node.to) {
                  const line = view.state.doc.lineAt(pos);
                  if (line.from >= node.from) {
                    if (!firstSeen) {
                      builder.push({ from: line.from, deco: codeBlockFirstDeco });
                      firstSeen = true;
                    } else {
                      builder.push({ from: line.from, deco: codeBlockLineDeco });
                    }
                    lastLineFrom = line.from;
                  }
                  if (line.to >= node.to) break;
                  pos = line.to + 1;
                }
                // Заменяем последнюю line deco на «last» вариант чтобы
                // подкрутить border-radius / margin внизу.
                if (lastLineFrom >= 0) {
                  // Pop последнюю и push'аем codeBlockLastDeco.
                  for (let i = builder.length - 1; i >= 0; i--) {
                    if (builder[i]!.from === lastLineFrom) {
                      builder[i] = { from: lastLineFrom, deco: codeBlockLastDeco };
                      break;
                    }
                  }
                }
              } else if (name.startsWith('ATXHeading') || name.startsWith('SetextHeading')) {
                const lvl = parseInt(name.replace(/[^\d]/g, ''), 10) || 1;
                const line = view.state.doc.lineAt(node.from);
                builder.push({ from: line.from, deco: headingLineDeco(lvl) });
              }
            },
          });
        }
        // RangeSet требует sorted-by-from; ensure.
        builder.sort((a, b) => a.from - b.from);
        const set = Decoration.none.update({
          add: builder.map((b) => b.deco.range(b.from)),
        });
        return set;
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}

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
