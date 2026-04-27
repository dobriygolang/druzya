// MarkdownSourceEditor — Obsidian source-mode editor на CodeMirror 6.
//
// Зачем не Milkdown/Crepe: Crepe съедает markdown-маркеры (`# `, `**…**`)
// сразу при вводе и работает в WYSIWYG-режиме. Это конфликтует с тем как
// юзер хочет редактировать heading levels (добавить `#` к существующему
// `# Title` чтобы получить `## Title`). В CodeMirror 6 текст хранится как
// есть — все маркеры видимы, плюс decoration'ы стилизуют heading-строки
// крупным шрифтом, как в Obsidian Live Preview.
//
// Yjs collab: y-codemirror.next bind'ит Y.Text к CM6 state. Тот же sync-
// engine что в EditorRooms (api/yjs.ts) перерелится автоматически —
// XmlFragment был для ProseMirror, для CM6 используем Y.Text 'body'.
//
// localOnly: пропускаем Y.Doc, держим content в state и onChange обратно.
import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { tags as t } from '@lezer/highlight';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';

import { attachNoteYjs, type NoteYjsHandle } from '../api/yjs';

interface MarkdownSourceEditorProps {
  noteId: string;
  seedBodyMD: string;
  placeholder?: string;
  onTextChange?: (text: string) => void;
  /** Local-only mode — пропускает Yjs collab + backend sync. Для free-tier
   * notes которые живут только в IndexedDB. */
  localOnly?: boolean;
}

// Hone-tuned highlight: heading'и крупные, маркеры (# / ** / etc.) приглушены.
// Стиль приближен к Obsidian Live Preview — markdown syntax видна, но не
// мешает чтению.
const honeMarkdownHighlight = HighlightStyle.define([
  // Heading text — большой font + bold. h1 самый крупный, h2/h3 поменьше.
  { tag: t.heading1, fontSize: '28px', fontWeight: '700', lineHeight: '1.25', color: 'var(--ink)' },
  { tag: t.heading2, fontSize: '22px', fontWeight: '700', lineHeight: '1.3', color: 'var(--ink)' },
  { tag: t.heading3, fontSize: '18px', fontWeight: '600', lineHeight: '1.35', color: 'var(--ink)' },
  { tag: t.heading4, fontSize: '16px', fontWeight: '600', color: 'var(--ink)' },
  { tag: t.heading5, fontSize: '14.5px', fontWeight: '600', color: 'var(--ink)' },
  { tag: t.heading6, fontSize: '14px', fontWeight: '600', color: 'var(--ink-90)' },
  // Bold/italic/strikethrough — обычный inline emphasis.
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  // Markdown markers (# / ** / _ / >) — приглушённые, не отвлекают.
  { tag: t.processingInstruction, color: 'rgba(255,255,255,0.32)' },
  { tag: t.contentSeparator, color: 'rgba(255,255,255,0.32)' },
  // Links + code — обычный + mono.
  { tag: t.link, color: '#7fb3ff', textDecoration: 'underline' },
  { tag: t.url, color: 'rgba(255,255,255,0.4)' },
  {
    tag: t.monospace,
    fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
    fontSize: '13px',
    color: 'var(--ink)',
  },
  // Inline + block code — bg slightly lighter.
  { tag: t.quote, color: 'rgba(255,255,255,0.65)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--ink)' },
]);

const baseTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      minHeight: '280px',
      fontSize: '15px',
      color: 'var(--ink)',
      backgroundColor: 'transparent',
    },
    '.cm-scroller': {
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
      lineHeight: '1.7',
      letterSpacing: '-0.005em',
      caretColor: 'var(--ink)',
    },
    '.cm-content': {
      padding: '4px 0',
      caretColor: 'var(--ink)',
    },
    '.cm-line': {
      padding: '2px 0',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--ink)',
      borderLeftWidth: '2px',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(255,255,255,0.18) !important',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
    '&.cm-focused .cm-selectionBackground, &.cm-focused ::selection': {
      backgroundColor: 'rgba(255,255,255,0.22) !important',
    },
    // Inline code background.
    '.cm-line .tok-monospace': {
      backgroundColor: 'rgba(255,255,255,0.06)',
      borderRadius: '3px',
      padding: '0 4px',
    },
    // Block-quote left bar.
    '.cm-line:has([data-tag="quote"])': {
      borderLeft: '2px solid rgba(255,255,255,0.16)',
      paddingLeft: '12px',
    },
  },
  { dark: true },
);

export function MarkdownSourceEditor({
  noteId,
  seedBodyMD,
  placeholder = 'Write your thoughts…',
  onTextChange,
  localOnly = false,
}: MarkdownSourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const handleRef = useRef<NoteYjsHandle | null>(null);
  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;

  // Suppress placeholder-static-text via simple decoration: when content
  // empty, рендерим CSS pseudo-element с placeholder-текстом. CodeMirror'у
  // dedicated placeholder-extension есть, но он переопределяет gutter'ы —
  // mvp обходимся CSS.
  // Отдельный CSS-класс `is-empty` ставим через listener.

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    // Local-only path: standalone CM, no Yjs.
    if (localOnly) {
      const state = EditorState.create({
        doc: seedBodyMD,
        extensions: [
          baseTheme,
          history(),
          highlightActiveLine(),
          markdown({ base: markdownLanguage, codeLanguages: [], addKeymap: true }),
          syntaxHighlighting(honeMarkdownHighlight),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((upd) => {
            if (!upd.docChanged || destroyed) return;
            onTextChangeRef.current?.(upd.state.doc.toString());
          }),
        ],
      });
      const view = new EditorView({ state, parent: containerRef.current });
      viewRef.current = view;
      togglePlaceholder(containerRef.current, view, placeholder);

      return () => {
        destroyed = true;
        view.destroy();
        viewRef.current = null;
      };
    }

    // Yjs path: bind Y.Text 'body' к CM6.
    const handle = attachNoteYjs(noteId, seedBodyMD);
    handleRef.current = handle;
    const ytext = handle.ydoc.getText('body');
    // Initial seed: если document пустой, первый клиент льёт seedBodyMD.
    // Параллельные клиенты возьмут его через Yjs delta (после connect).
    if (ytext.length === 0 && seedBodyMD.length > 0) {
      handle.ydoc.transact(() => {
        ytext.insert(0, seedBodyMD);
      });
    }

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        baseTheme,
        history(),
        highlightActiveLine(),
        markdown({ base: markdownLanguage, codeLanguages: [], addKeymap: true }),
        syntaxHighlighting(honeMarkdownHighlight),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        yCollab(ytext, null),
        EditorView.lineWrapping,
        EditorView.updateListener.of((upd) => {
          if (!upd.docChanged || destroyed) return;
          onTextChangeRef.current?.(upd.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    togglePlaceholder(containerRef.current, view, placeholder);

    return () => {
      destroyed = true;
      view.destroy();
      viewRef.current = null;
      handle.close();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, localOnly]);

  return (
    <div
      ref={containerRef}
      className="hone-md-source-mount"
      style={{ minHeight: 280 }}
    />
  );
}

// togglePlaceholder — простой CSS-хак: ставим data-empty="true" на root
// когда документ пустой, CSS показывает placeholder-pseudo. Update'ится
// через CM listener.
function togglePlaceholder(root: HTMLElement, view: EditorView, placeholder: string) {
  const setEmpty = () => {
    const empty = view.state.doc.length === 0;
    root.dataset.empty = String(empty);
    root.dataset.placeholder = placeholder;
  };
  setEmpty();
  view.dom.addEventListener('input', setEmpty);
  // CM tracks doc changes via updateListener — but we only render-update,
  // not state-listen here. Simple poll on 250ms keeps it correct without
  // extra plugin wiring.
  const id = window.setInterval(setEmpty, 250);
  view.dom.addEventListener('blur', () => window.clearInterval(id));
}

// Re-export Y namespace for callers если когда-нибудь понадобится отладка
// напрямую — текущий MilkdownEditor его экспонировал, поддерживаем API.
export { Y };
