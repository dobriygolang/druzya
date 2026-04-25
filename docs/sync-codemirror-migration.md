# RichMarkdownEditor → CodeMirror 6 migration (ADR)

**Status:** ratified 2026-04-25
**Blocks:** real CRDT semantics for note editing (C-6 client-side)
**Estimate:** 1.5–2 days of careful UX work
**Owner:** next session

This document explains why the obvious "just plug Y.Text into the existing
RichMarkdownEditor" doesn't work, what the correct path is, and exactly
what behaviour must survive the migration.

---

## Context: where we are

After Phase C-6 server foundation:
- Backend has `note_yjs_updates` table + `/sync/yjs/notes/{id}/(append|updates|compact)` endpoints. ✅
- Frontend has `attachNoteYjs(noteId, seedBodyMD)` returning `{ydoc, ytext, ready, close}`. ✅
- Sync engine handles polling (5s), online/focus pulls, compaction (every 100 appends), final compaction on close. ✅

**Missing:** `Y.Text` is not bound to the editor. So local edits don't
flow into `Y.Text`, and remote `applyUpdate(ydoc, …)` doesn't repaint
the editor. Today's `Notes.tsx` still uses Connect-RPC `UpdateNote(body_md)`
as the source of truth. Yjs sync engine runs in parallel and is not
consumed.

---

## Why "just plug Y.Text in" fails

`RichMarkdownEditor` is a **plain `<textarea>`** with custom decorations:
- Markdown-prefix-on-Enter (`- `, `> `, etc. continuation)
- Hover-toolbar for selections (bold/italic/link/code-block)
- Custom focus styles, placeholder, autoresize

Naive integration option: on every `onChange`, do
`ytext.delete(0, ytext.length); ytext.insert(0, value)`. This compiles, but
it's **not CRDT** — it's "full-text replace via Yjs". Two devices editing
the same paragraph simultaneously: one device's update fires
`delete-all + insert-all` with their snapshot, the other device's same
operation fires with a *different* snapshot, last-writer wins on the
character level. The Y.Text gives no CRDT benefit because we never
expressed character-level intent.

This is **strictly worse** than the current `UpdateNote` LWW path (same
semantics, but with extra round-trips and a misleading "we have CRDT"
label). Not shipping it.

---

## What correct migration looks like

Replace the `<textarea>` with **CodeMirror 6** (`@codemirror/view` +
`@codemirror/state` + `@codemirror/lang-markdown`) and bind via
`y-codemirror.next` (`yCollab(ytext, awareness)` extension). This is
exactly the pattern already proven in `pages/Editor.tsx` for code rooms
— same packages, same Y.Doc/Y.Text/awareness, just with markdown
language extension instead of language-per-room.

Why CodeMirror specifically:
- y-codemirror.next is the **only** production-tested binding. Alternatives
  (y-textarea, y-prosemirror, custom) either don't exist, are alpha, or
  require ProseMirror (heavier).
- CM6 has first-class markdown language support — syntax highlighting,
  fold ranges, all the things textarea can't do.
- Editor.tsx already has the pattern; we're not inventing.

---

## What must survive the migration (UX checklist)

The current `RichMarkdownEditor` has subtle behaviours that users rely on.
The migration is "complete" only when all of these still work with
Y.Text-backed CM6:

### Hard requirements (would be regression)

- [ ] Typing into the editor produces visible characters at the cursor
      position (sounds trivial, but Y.Text + CM6 binding has historically
      caused dropped keystrokes if mis-wired).
- [ ] Hover toolbar appears on text selection with bold/italic/link/code
      buttons. Click → wraps selection with markdown markers (`**…**`,
      `_…_`, `[text](url)`, `` `…` ``). Currently in `RichMarkdownEditor.tsx`
      lines 153–210 (`ToolbarBtn` array). Must rewrite as CM6 transaction
      dispatchers.
- [ ] Markdown auto-continuation: pressing Enter in a `- ` list, `> `
      blockquote, or `1. ` ordered list line continues with the same
      prefix. RichMarkdownEditor lines 110–145 (`applyBlockTransform`).
      Must reimplement as CM6 `keymap.of([{ key: 'Enter', run: … }])`.
- [ ] ⌘B / ⌘I / ⌘K shortcuts trigger the corresponding toolbar buttons.
      Currently a global keydown listener; in CM6 use `Prec.high(keymap.of([…]))`.
- [ ] Placeholder text shows when document is empty. CM6 has
      `@codemirror/view`'s `placeholder("Write your thoughts…")` extension
      built-in.
- [ ] Auto-resize: editor grows with content (no fixed height, no inner
      scrollbar except when window is small). CM6 default: needs
      `EditorView.theme({ '&': { minHeight: …, height: 'auto' } })` plus
      not applying `.cm-scroller` overflow.
- [ ] Word-wrap on long lines. CM6: add `EditorView.lineWrapping`.
- [ ] Click-to-focus from anywhere in the editor area, not just the text.
      CM6 default but verify in Notes.tsx layout.

### Style requirements (subtle but visible)

- [ ] Caret colour and selection background match the rest of the app
      (`var(--ink)` / `rgba(255,255,255,0.2)`). CM6: `EditorView.theme`.
- [ ] Font size, line-height, font-family match current. Pull from
      RichMarkdownEditor's inline styles, port into theme.
- [ ] No focus ring around the editor (Hone uses focus-ring on buttons
      only, not text inputs). CM6 default has `.cm-focused { outline: … }`
      — override to `none`.
- [ ] Markdown headings (`# `, `## `) render visually distinct (current
      doesn't — RichMarkdownEditor is plain textarea). CM6 markdown
      language gives this **for free** with proper theme — opportunity
      for UX upgrade, not regression.

### Behaviour requirements (correctness)

- [ ] Local edits → `ytext.insert/delete` with character-level granularity
      (this is the whole point — verifiable via Y.encodeStateAsUpdate
      diffing).
- [ ] Two devices editing the same note simultaneously → both edits
      preserved (test: type "ABC" on device A and "XYZ" on device B
      between polls; final state contains both, possibly interleaved at
      character level, **never** loses one side).
- [ ] `attachNoteYjs(id, body_md)` seed path: empty server log + non-empty
      `body_md` → Y.Text initialised with the body, immediately picked up
      by the bound editor without flicker.
- [ ] Note deletion via Connect-RPC `DeleteNote` triggers backend cascade
      → `note_yjs_updates` rows gone via FK ON DELETE CASCADE. Already
      works (verified in 00033 migration).

---

## Migration steps (proposed order)

1. **Build new `<MarkdownEditor>` component** alongside the existing
   `RichMarkdownEditor`. CM6 + yCollab + theme + keymap + toolbar.
   Don't delete the old one yet.
2. **Snapshot tests**: run UX checklist above against both editors with
   the same content. Resolve regressions before swap.
3. **Notes.tsx**: switch `<RichMarkdownEditor value={body} onChange={…}>`
   to `<MarkdownEditor noteId={active.id} bodyMd={active.bodyMd} />`. The
   new component owns the `attachNoteYjs` lifecycle (mount → attach,
   unmount → close).
4. **Server-side `body_md` derivation**: when client appends Yjs update,
   it ALSO calls existing `UpdateNote(title, body_md)` with `ytext.toString()`.
   This keeps `body_md` as a plaintext mirror for embedding/RAG/publish.
   Debounce 600ms (same as current). Two writes per edit-burst is
   acceptable; we'd consolidate in C-6.2 with server-streaming push.
5. **Migration of existing notes**: when a user opens an old note that has
   `body_md` but no rows in `note_yjs_updates`, the seed callback in
   `attachNoteYjs` populates Y.Text once. No batch migration cron — lazy
   per-note. The very first append for a note IS the migration.
6. **Delete `RichMarkdownEditor`** once Notes.tsx no longer uses it. Grep
   the codebase to confirm no other call sites — currently only Notes.tsx.

---

## What we explicitly defer

- **Awareness (cursor positions of other devices)**: not user-visible
  for single-user multi-device — your other devices are not in your face
  while you type. Skip awareness UI; pass `null` or empty awareness to
  `yCollab`.
- **Compaction tuning**: current threshold of 100 local appends is a
  guess. Will tune after real usage data.
- **Conflict highlights**: when remote update arrives mid-edit and merges
  cleanly, just re-render. Don't show "someone else edited" banner —
  it's the same user on another device, not a conflict to surface.

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Existing `body_md` corrupted by buggy first-edit migration | Seed only when `note_yjs_updates` is empty AND `body_md` is non-empty. Y.Text mutation is local; if seed fails (Y throws), cancel the edit, log, fallback to legacy `UpdateNote`. |
| Two devices both seed the same note simultaneously | Server's `note_yjs_updates` has BIGSERIAL seq — both seeds become independent updates. Y CRDT will merge them: if both inserted the same `body_md` at offset 0, result is duplicated text. Workaround: client checks `fetchUpdates(noteId, 0).updates.length === 0` BEFORE seeding, and bails if it's racing (next successful poll will pull the other device's seed). |
| CM6 bundle size bloat in Hone | We already have CM6 in Editor.tsx and SharedBoards.tsx. Adding markdown language ~ +30KB gzipped. Acceptable. |
| Keystroke loss during applyUpdate('remote') re-render | yCollab handles this — the binding suspends local change tracking during remote apply. Verified in code rooms. |

---

## Done definition

When all UX checklist items pass AND two devices can collaboratively edit
the same note without losing characters AND deleting a note from one
device removes it from the other within 5s (poll interval), the migration
is complete and we can mark C-6 client-side as ✅.
