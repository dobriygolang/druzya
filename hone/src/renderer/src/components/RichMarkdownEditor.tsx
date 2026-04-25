// RichMarkdownEditor — Obsidian-like overlay over plain <textarea>.
//
// Source-of-truth остаётся markdown-строка (бэкенд хранит body как plain
// markdown). Мы не подменяем editor — добавляем поверх:
//   1) floating selection toolbar (B / I / U / S / code / H1-3 / quote /
//      lists / link / code-block) — wraps выделение markdown-сахаром
//   2) markdown shortcuts на клавиатуре: bracket-pairs, list continuation,
//      tab-indent, ⌘B/⌘I/⌘K, triple-backtick fenced block scaffold.
//
// Никаких ProseMirror/TipTap — pure textarea + handlers. Toolbar
// позиционируется через невидимый mirror-div (классический трюк для
// получения координат caret-а в textarea).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Icon, type IconName } from './primitives/Icon';

interface RichMarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

interface ToolbarPos {
  top: number;
  left: number;
}

// ──────────────────────────────────────────────────────────────────────
// Caret/selection coordinate measurement.
// Стандартный mirror-div trick: создаём скрытый div с теми же стилями что
// и textarea, копируем туда текст до selection, ставим <span> в позицию
// — span.getBoundingClientRect() даёт нам экранные координаты caret-а.
// Берётся MIN(start, end) для top-edge выделения.
// ──────────────────────────────────────────────────────────────────────

const MIRROR_PROPS: (keyof CSSStyleDeclaration)[] = [
  'boxSizing',
  'width',
  'height',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'whiteSpace',
  'wordWrap',
  'wordBreak',
];

function getCaretCoords(
  ta: HTMLTextAreaElement,
  position: number,
): { top: number; left: number; height: number } {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const style = div.style;
  const computed = window.getComputedStyle(ta);
  style.position = 'absolute';
  style.visibility = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';
  style.top = '0';
  style.left = '-9999px';
  for (const prop of MIRROR_PROPS) {
    // @ts-expect-error indexed access on CSSStyleDeclaration
    style[prop] = computed[prop];
  }
  div.textContent = ta.value.substring(0, position);
  const span = document.createElement('span');
  span.textContent = ta.value.substring(position) || '.';
  div.appendChild(span);
  const rect = span.getBoundingClientRect();
  const taRect = ta.getBoundingClientRect();
  const top = rect.top - taRect.top + ta.scrollTop * -1;
  const left = rect.left - taRect.left + ta.scrollLeft * -1;
  const height = parseFloat(computed.lineHeight) || 18;
  document.body.removeChild(div);
  return { top, left, height };
}

// ──────────────────────────────────────────────────────────────────────
// Selection helpers
// ──────────────────────────────────────────────────────────────────────

function wrapSelection(
  ta: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder = '',
): { value: string; selStart: number; selEnd: number } {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const sel = ta.value.slice(start, end) || placeholder;
  const value = ta.value.slice(0, start) + before + sel + after + ta.value.slice(end);
  return {
    value,
    selStart: start + before.length,
    selEnd: start + before.length + sel.length,
  };
}

function prependLines(
  ta: HTMLTextAreaElement,
  prefix: string | ((i: number) => string),
): { value: string; selStart: number; selEnd: number } {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd =
    ta.value.indexOf('\n', end) === -1 ? ta.value.length : ta.value.indexOf('\n', end);
  const block = ta.value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const transformed = lines
    .map((l, i) => {
      const px = typeof prefix === 'function' ? prefix(i) : prefix;
      // strip pre-existing same-class prefix to make toolbar idempotent
      const stripped = l.replace(/^(#{1,6}\s|>\s|-\s|\d+\.\s)/, '');
      return px + stripped;
    })
    .join('\n');
  const value = ta.value.slice(0, lineStart) + transformed + ta.value.slice(lineEnd);
  return {
    value,
    selStart: lineStart,
    selEnd: lineStart + transformed.length,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────

interface ToolbarBtn {
  icon: IconName;
  title: string;
  fn: (ta: HTMLTextAreaElement) => { value: string; selStart: number; selEnd: number } | null;
  group: number;
}

const BUTTONS: ToolbarBtn[] = [
  { group: 0, icon: 'bold', title: 'Bold ⌘B', fn: (ta) => wrapSelection(ta, '**', '**', 'bold') },
  { group: 0, icon: 'italic', title: 'Italic ⌘I', fn: (ta) => wrapSelection(ta, '*', '*', 'italic') },
  { group: 0, icon: 'underline', title: 'Underline', fn: (ta) => wrapSelection(ta, '<u>', '</u>', 'underline') },
  { group: 0, icon: 'strike', title: 'Strikethrough', fn: (ta) => wrapSelection(ta, '~~', '~~', 'strike') },
  { group: 0, icon: 'inline-code', title: 'Inline code', fn: (ta) => wrapSelection(ta, '`', '`', 'code') },
  { group: 1, icon: 'h1', title: 'Heading 1', fn: (ta) => prependLines(ta, '# ') },
  { group: 1, icon: 'h2', title: 'Heading 2', fn: (ta) => prependLines(ta, '## ') },
  { group: 1, icon: 'h3', title: 'Heading 3', fn: (ta) => prependLines(ta, '### ') },
  { group: 2, icon: 'quote', title: 'Quote', fn: (ta) => prependLines(ta, '> ') },
  { group: 2, icon: 'list-ul', title: 'Bullet list', fn: (ta) => prependLines(ta, '- ') },
  { group: 2, icon: 'list-ol', title: 'Numbered list', fn: (ta) => prependLines(ta, (i) => `${i + 1}. `) },
  {
    group: 3,
    icon: 'link',
    title: 'Link ⌘K',
    fn: (ta) => {
      const url = window.prompt('URL', 'https://') || '';
      if (!url) return null;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const sel = ta.value.slice(start, end) || 'link';
      const value = ta.value.slice(0, start) + `[${sel}](${url})` + ta.value.slice(end);
      return {
        value,
        selStart: start + 1,
        selEnd: start + 1 + sel.length,
      };
    },
  },
  {
    group: 3,
    icon: 'code-block',
    title: 'Code block',
    fn: (ta) => {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const sel = ta.value.slice(start, end);
      const before = start === 0 || ta.value[start - 1] === '\n' ? '' : '\n';
      const block = `${before}\`\`\`\n${sel || ''}\n\`\`\`\n`;
      const value = ta.value.slice(0, start) + block + ta.value.slice(end);
      const inner = start + before.length + 4; // ```\n
      return { value, selStart: inner, selEnd: inner + (sel?.length ?? 0) };
    },
  },
];

const PAIRS: Record<string, string> = {
  '[': ']',
  '(': ')',
  '{': '}',
  '"': '"',
  '`': '`',
};

export function RichMarkdownEditor({ value, onChange, placeholder }: RichMarkdownEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [toolbar, setToolbar] = useState<ToolbarPos | null>(null);
  const [hasSelection, setHasSelection] = useState(false);

  // Recompute toolbar on selection change.
  const updateToolbar = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart, selectionEnd } = ta;
    if (selectionStart === selectionEnd || document.activeElement !== ta) {
      setHasSelection(false);
      setToolbar(null);
      return;
    }
    const top = Math.min(selectionStart, selectionEnd);
    const coords = getCaretCoords(ta, top);
    setHasSelection(true);
    setToolbar({
      // 8px gap above the line
      top: coords.top - 44,
      left: Math.max(8, coords.left - 8),
    });
  }, []);

  useEffect(() => {
    const onSel = () => updateToolbar();
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [updateToolbar]);

  useLayoutEffect(() => {
    updateToolbar();
  }, [value, updateToolbar]);

  // Apply a toolbar action.
  const apply = useCallback(
    (btn: ToolbarBtn) => {
      const ta = taRef.current;
      if (!ta) return;
      const out = btn.fn(ta);
      if (!out) return;
      onChange(out.value);
      // Restore selection after React re-renders.
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(out.selStart, out.selEnd);
        updateToolbar();
      });
    },
    [onChange, updateToolbar],
  );

  // ──────────────────────────────────────────────────────────────────
  // Keyboard handler
  // ──────────────────────────────────────────────────────────────────

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && !e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'b') {
          e.preventDefault();
          apply(BUTTONS.find((b) => b.icon === 'bold')!);
          return;
        }
        if (k === 'i') {
          e.preventDefault();
          apply(BUTTONS.find((b) => b.icon === 'italic')!);
          return;
        }
        if (k === 'k') {
          e.preventDefault();
          apply(BUTTONS.find((b) => b.icon === 'link')!);
          return;
        }
      }

      // Tab / Shift-Tab — indent / unindent
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
        if (e.shiftKey) {
          // unindent: remove up to 2 leading spaces on each affected line
          const lineEnd =
            ta.value.indexOf('\n', end) === -1 ? ta.value.length : ta.value.indexOf('\n', end);
          const block = ta.value.slice(lineStart, lineEnd);
          const transformed = block
            .split('\n')
            .map((l) => l.replace(/^ {1,2}/, ''))
            .join('\n');
          const newValue = ta.value.slice(0, lineStart) + transformed + ta.value.slice(lineEnd);
          onChange(newValue);
          requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(lineStart, lineStart + transformed.length);
          });
        } else {
          if (start !== end) {
            const lineEnd =
              ta.value.indexOf('\n', end) === -1 ? ta.value.length : ta.value.indexOf('\n', end);
            const block = ta.value.slice(lineStart, lineEnd);
            const transformed = block
              .split('\n')
              .map((l) => '  ' + l)
              .join('\n');
            const newValue = ta.value.slice(0, lineStart) + transformed + ta.value.slice(lineEnd);
            onChange(newValue);
            requestAnimationFrame(() => {
              ta.focus();
              ta.setSelectionRange(lineStart, lineStart + transformed.length);
            });
          } else {
            const newValue = ta.value.slice(0, start) + '  ' + ta.value.slice(end);
            onChange(newValue);
            requestAnimationFrame(() => {
              ta.focus();
              ta.setSelectionRange(start + 2, start + 2);
            });
          }
        }
        return;
      }

      // Enter — list continuation + fenced code scaffolding follow-up
      if (e.key === 'Enter' && !e.shiftKey) {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        if (start === end) {
          const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
          const line = ta.value.slice(lineStart, start);

          // Empty list item — exit list
          const emptyBullet = /^(\s*)([-*]|\d+\.)\s+$/.exec(line);
          if (emptyBullet) {
            e.preventDefault();
            const newValue = ta.value.slice(0, lineStart) + ta.value.slice(start);
            onChange(newValue);
            requestAnimationFrame(() => {
              ta.focus();
              ta.setSelectionRange(lineStart, lineStart);
            });
            return;
          }

          // Continue bullet list
          const bulletM = /^(\s*)([-*])\s+/.exec(line);
          if (bulletM) {
            e.preventDefault();
            const insert = `\n${bulletM[1]}${bulletM[2]} `;
            const newValue = ta.value.slice(0, start) + insert + ta.value.slice(end);
            onChange(newValue);
            const pos = start + insert.length;
            requestAnimationFrame(() => {
              ta.focus();
              ta.setSelectionRange(pos, pos);
            });
            return;
          }
          // Continue numbered list
          const numM = /^(\s*)(\d+)\.\s+/.exec(line);
          if (numM) {
            e.preventDefault();
            const next = parseInt(numM[2], 10) + 1;
            const insert = `\n${numM[1]}${next}. `;
            const newValue = ta.value.slice(0, start) + insert + ta.value.slice(end);
            onChange(newValue);
            const pos = start + insert.length;
            requestAnimationFrame(() => {
              ta.focus();
              ta.setSelectionRange(pos, pos);
            });
            return;
          }
          // Continue blockquote
          const quoteM = /^(\s*)>\s+/.exec(line);
          if (quoteM) {
            e.preventDefault();
            const insert = `\n${quoteM[1]}> `;
            const newValue = ta.value.slice(0, start) + insert + ta.value.slice(end);
            onChange(newValue);
            const pos = start + insert.length;
            requestAnimationFrame(() => {
              ta.focus();
              ta.setSelectionRange(pos, pos);
            });
            return;
          }
        }
        return;
      }

      // Auto-pair brackets/quotes/backticks
      if (PAIRS[e.key]) {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        // Triple-backtick scaffolding: if we're typing third backtick, expand to fenced block
        if (e.key === '`' && start === end && start >= 2 && ta.value.slice(start - 2, start) === '``') {
          e.preventDefault();
          const insert = '`\n\n```';
          const newValue = ta.value.slice(0, start) + insert + ta.value.slice(end);
          onChange(newValue);
          const pos = start + 2; // place cursor at empty line between fences
          requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(pos, pos);
          });
          return;
        }
        e.preventDefault();
        const sel = ta.value.slice(start, end);
        const close = PAIRS[e.key];
        const insert = e.key + sel + close;
        const newValue = ta.value.slice(0, start) + insert + ta.value.slice(end);
        onChange(newValue);
        requestAnimationFrame(() => {
          ta.focus();
          if (sel) {
            ta.setSelectionRange(start + 1, start + 1 + sel.length);
          } else {
            ta.setSelectionRange(start + 1, start + 1);
          }
        });
        return;
      }
    },
    [apply, onChange],
  );

  // Group buttons for divider rendering
  const groups: ToolbarBtn[][] = [];
  for (const b of BUTTONS) {
    if (!groups[b.group]) groups[b.group] = [];
    groups[b.group]!.push(b);
  }

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onSelect={updateToolbar}
        onBlur={() => {
          // Delay so toolbar clicks register before blur kills it.
          window.setTimeout(() => {
            if (document.activeElement !== taRef.current) {
              setHasSelection(false);
              setToolbar(null);
            }
          }, 120);
        }}
        placeholder={placeholder}
        rows={20}
        className="mono focus-ring"
        style={{
          width: '100%',
          fontSize: 13,
          lineHeight: 1.75,
          color: 'var(--ink-90)',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: 8,
          padding: '14px 16px',
          resize: 'none',
          transition:
            'background-color var(--t-fast), border-color var(--t-fast), box-shadow var(--t-fast)',
        }}
      />
      {hasSelection && toolbar && (
        <div
          className="scale-pop"
          style={{
            position: 'absolute',
            top: toolbar.top,
            left: toolbar.left,
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: '4px 6px',
            background: 'rgba(14,14,14,0.96)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            backdropFilter: 'blur(20px)',
            boxShadow: '0 6px 24px -8px rgba(0,0,0,0.7)',
            animationDuration: '180ms',
          }}
          onMouseDown={(e) => e.preventDefault() /* keep textarea selection */}
        >
          {groups.map((g, gi) => (
            <span key={gi} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {gi > 0 && (
                <span
                  style={{
                    width: 1,
                    height: 16,
                    background: 'rgba(255,255,255,0.08)',
                    margin: '0 4px',
                  }}
                />
              )}
              {g.map((btn) => (
                <button
                  key={btn.icon}
                  title={btn.title}
                  onClick={() => apply(btn)}
                  className="row"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 26,
                    height: 26,
                    borderRadius: 5,
                    color: 'var(--ink-60)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                    e.currentTarget.style.color = 'var(--ink)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--ink-60)';
                  }}
                >
                  <Icon name={btn.icon} size={14} />
                </button>
              ))}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
