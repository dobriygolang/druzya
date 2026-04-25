// MilkdownEditor — Notion-like WYSIWYG markdown editor on top of
// ProseMirror via @milkdown/crepe.
//
// Замена для CodeMirror-based MarkdownEditor: 6 итераций пытались сделать
// hide/dim markers через CM6 decorations + atomicRanges и каждый раз
// ломали arrow nav. ProseMirror — другой rendering model: документ
// представлен как tree of nodes, а не как text + decorations. `# foo`
// при вводе моментально превращается в Heading-node + Text-node «foo» —
// никаких `# ` маркеров в layout'е, caret nav работает по дефолтным
// браузерным правилам.
//
// Что даёт Crepe out of the box:
//   - BlockEdit (slash menu) — `/heading`, `/code`, `/todo`, `/table`...
//   - Toolbar (floating bubble) на selection — Bold/Italic/Link/Code
//   - CodeMirror inside для code blocks (inline в ProseMirror, не conflict
//     с outer editor — это именно code block syntax-highlight)
//   - Checkbox в list-item
//   - Link tooltip с edit/remove
//   - Placeholder
//   - Tables (GFM) + Latex math + Image-block
//
// Yjs: @milkdown/plugin-collab binds Y.XmlFragment к ProseMirror state.
// Backend Yjs sync (yjs.ts attachNoteYjs) protocol-agnostic — relay
// Y.Doc updates without inspecting structure, поэтому тот же sync
// работает для XmlFragment как и работал для Y.Text.
//
// Migration note: existing notes хранили content как Y.Text('body'). После
// миграции — Y.XmlFragment('prosemirror'). User wipes DB перед prod
// (см. last conversation), для already-migrated notes seedBodyMD
// применяется через applyTemplate.

import { useEffect, useRef } from 'react';
import { Crepe } from '@milkdown/crepe';
import { collab, collabServiceCtx } from '@milkdown/plugin-collab';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';

import { attachNoteYjs, type NoteYjsHandle } from '../api/yjs';

// Crepe theme css. style.css aggregator не build'ится в lib (packaging
// quirk crepe@7.20), импортируем individual common pieces. frame-dark
// даёт dark palette CSS variables (см. .milkdown selector ниже в
// globals.css для Hone-tuning'а).
import '@milkdown/crepe/theme/common/reset.css';
import '@milkdown/crepe/theme/common/prosemirror.css';
import '@milkdown/crepe/theme/common/block-edit.css';
import '@milkdown/crepe/theme/common/cursor.css';
import '@milkdown/crepe/theme/common/list-item.css';
import '@milkdown/crepe/theme/common/placeholder.css';
import '@milkdown/crepe/theme/common/link-tooltip.css';
import '@milkdown/crepe/theme/common/image-block.css';
import '@milkdown/crepe/theme/common/code-mirror.css';
import '@milkdown/crepe/theme/frame-dark.css';

interface MilkdownEditorProps {
  noteId: string;
  seedBodyMD: string;
  placeholder?: string;
  onTextChange?: (text: string) => void;
  /**
   * Local-only mode — пропускает Yjs collab привязку и backend sync.
   * Для free-tier notes которые живут только в IndexedDB. seedBodyMD
   * используется как initial content; onTextChange срабатывает на каждое
   * изменение и должен вызываться парентом для persist в local store.
   */
  localOnly?: boolean;
}

export function MilkdownEditor({ noteId, seedBodyMD, placeholder = 'Write your thoughts…', onTextChange, localOnly = false }: MilkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const handleRef = useRef<NoteYjsHandle | null>(null);
  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;
  const seedBodyMDRef = useRef(seedBodyMD);
  const placeholderRef = useRef(placeholder);
  seedBodyMDRef.current = seedBodyMD;
  placeholderRef.current = placeholder;

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    // localOnly path: ни Yjs, ни backend sync — Crepe stand-alone editor
    // с initial markdown через `defaultValue`. onTextChange прокидывает
    // изменения наружу для persist в IndexedDB localNotes store.
    if (localOnly) {
      const crepe = new Crepe({
        root: containerRef.current,
        defaultValue: seedBodyMDRef.current,
        featureConfigs: {
          [Crepe.Feature.Placeholder]: {
            text: placeholderRef.current,
            mode: 'block',
          },
        },
      });
      crepeRef.current = crepe;

      crepe.editor
        .config((ctx) => {
          ctx.get(listenerCtx).markdownUpdated((_c, markdown) => {
            if (destroyed) return;
            onTextChangeRef.current?.(markdown);
          });
        })
        .use(listener);

      void crepe.create();

      return () => {
        destroyed = true;
        void crepe.destroy().catch(() => {
          /* ignore */
        });
        crepeRef.current = null;
      };
    }

    // Yjs Y.Doc через существующий sync engine. CollabService bind'ится
    // на XmlFragment 'prosemirror' — стандартный name для ProseMirror+Yjs
    // bridge'а. Backend sync remains the same (YjsHandle relays raw doc
    // updates).
    const handle = attachNoteYjs(noteId, seedBodyMDRef.current);
    handleRef.current = handle;
    const xmlFragment = handle.ydoc.getXmlFragment('prosemirror');

    const crepe = new Crepe({
      root: containerRef.current,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: placeholderRef.current,
          mode: 'block',
        },
      },
    });
    crepeRef.current = crepe;

    crepe.editor
      .config((ctx) => {
        // Listen for markdown updates → relay to parent (autosave).
        ctx.get(listenerCtx).markdownUpdated((_c, markdown) => {
          if (destroyed) return;
          onTextChangeRef.current?.(markdown);
        });
      })
      .use(listener)
      .use(collab);

    void crepe.create().then(async () => {
      if (destroyed) return;
      // Wire collab AFTER editor created. CollabService binds Y.Doc+
      // XmlFragment, applies seed-template if fragment is empty, then
      // connects (start syncing).
      crepe.editor.action((ctx) => {
        const collabService = ctx.get(collabServiceCtx);
        collabService
          .bindDoc(handle.ydoc)
          .bindXmlFragment(xmlFragment)
          // applyTemplate — fills the editor with seedBodyMD ONLY if Y.Doc
          // fragment is empty (predicate condition checked internally).
          // Existing notes uploaded with content through prior session —
          // template skipped, content preserved.
          .applyTemplate(seedBodyMDRef.current)
          .connect();
      });
    });

    return () => {
      destroyed = true;
      try {
        // Disconnect collab BEFORE destroying editor — release Y.Doc
        // listeners cleanly.
        crepe.editor.action((ctx) => {
          ctx.get(collabServiceCtx).disconnect();
        });
      } catch {
        /* ignore — editor might not have finished initializing */
      }
      void crepe.destroy().catch(() => {
        /* ignore */
      });
      crepeRef.current = null;
      handle.close();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, localOnly]);

  return (
    <div
      ref={containerRef}
      className="hone-milkdown-mount"
      style={{
        minHeight: 280,
      }}
    />
  );
}
