// Notes — Notion-like two-column editor.
//
// UX (Phase C-4):
//   - "+" в sidebar: instant-create новой заметки на сервере, открывает её в
//     editor'е сразу (без модальной формы). Title начинается «Untitled»,
//     body пустой; юзер сразу пишет.
//   - Right panel — title + body, без preview/edit toggle (always-edit
//     стиль Notion). MarkdownView и /preview-режим ушли — pure WYSIWYG-ish
//     edit через RichMarkdownEditor.
//   - Three-dots на каждой row sidebar'а появляется при hover, click →
//     dropdown {Publish to web | Delete Note}. Никакой DELETE-кнопки в
//     заголовке editor'а.
//   - Last updated HH:MM:SS показывается в правом нижнем углу editor'а
//     при hover на заметку (через мышь над editor'ом).
//   - Autosave: debounced 600ms на keystroke + immediate flush на
//     blur/unmount/route-change/window-blur. Никаких «save» кнопок.
//   - Hover-эффекты: смена background на rows, accent на «+», fade на
//     three-dots. Все transitions через --t-fast (180ms).
//
// ⌘J connections panel и ⌘⇧L AskNotes — оставлены без изменений.
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CueSessionAnalysis } from '@shared/ipc';
import { CueMeetingNotes, buildCueMarkdown } from '../components/CueMeetingNotes';
import { ConnectError, Code } from '@connectrpc/connect';

import { AskNotesModal } from '../components/AskNotesModal';
import { Kbd } from '../components/primitives/Kbd';
import { RichMarkdownEditor } from '../components/RichMarkdownEditor';
import { MilkdownEditor } from '../components/MilkdownEditor';
import { QuotaUsageBar } from '../components/QuotaUsageBar';
import {
  listNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  moveNote,
  listFolders,
  createFolder,
  deleteFolder,
  getNoteConnectionsStream,
  type Note,
  type NoteConnection,
  type NoteSummary,
  type Folder,
} from '../api/hone';
import {
  publishNote,
  unpublishNote,
  getPublishStatus,
  getNotesMeta,
  type PublishStatus,
  type NoteMeta,
} from '../api/storage';
import { getRow } from '../api/localCache';
import { useSessionStore } from '../stores/session';
import { useQuotaStore } from '../stores/quota';
import {
  createLocalNote,
  listLocalNotes,
  getLocalNote,
  updateLocalNote,
  deleteLocalNote,
  isLocalNoteId,
  type LocalNote,
} from '../api/localNotes';

interface ListState {
  status: 'loading' | 'ok' | 'error';
  notes: NoteSummary[];
  error: string | null;
  errorCode: Code | null;
}

const INITIAL_LIST: ListState = { status: 'loading', notes: [], error: null, errorCode: null };

const SIDEBAR_KEY = 'hone:notes:sidebar-w';
const SIDEBAR_COLLAPSED_KEY = 'hone:notes:sidebar-collapsed';
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 460;
const SIDEBAR_DEFAULT = 280;

export interface NotesPageProps {
  initialSelectedId?: string | null;
  onConsumeInitial?: () => void;
  initialCueNote?: { filePath: string; analysis: CueSessionAnalysis } | null;
  onConsumeCueNote?: () => void;
}

export function NotesPage({ initialSelectedId, onConsumeInitial, initialCueNote, onConsumeCueNote }: NotesPageProps = {}) {
  const [list, setList] = useState<ListState>(INITIAL_LIST);
  // listRef — всегда указывает на свежий list. Используется callback'ами
  // (handleDelete, etc) которые НЕ должны зависеть от list в useCallback
  // deps (иначе их identity меняется на каждый list update и React.memo
  // на NoteRow становится бесполезен — все rows ре-рендерятся).
  const listRef = useRef<ListState>(INITIAL_LIST);
  listRef.current = list;
  // activeRef + selectedIdRef — для async getNote effect: проверяет «не
  // ушёл ли юзер на другую заметку пока мы fetch'или». Без этого race:
  // юзер кликает A → fetch starts → переключается на B → fetch A
  // resolves → setActive(A) поверх B = wrong note rendered.
  const activeRef = useRef<Note | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [activeCueNote, setActiveCueNote] = useState<{ filePath: string; analysis: CueSessionAnalysis } | null>(initialCueNote ?? null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null | 'all'>('all');
  const [askOpen, setAskOpen] = useState(false);
  const [active, setActive] = useState<Note | null>(null);
  // Keep refs in lockstep with state for async-callback access.
  activeRef.current = active;
  selectedIdRef.current = selectedId;
  const [activeError, setActiveError] = useState<string | null>(null);
  // metaMap — per-note flags (encrypted/published). Заполняется bulkMeta
  // на mount + на hone:sync-changed. Ref для async-callback access без
  // запутывания useCallback-deps.
  const [metaMap, setMetaMap] = useState<Map<string, NoteMeta>>(new Map());
  const metaMapRef = useRef(metaMap);
  metaMapRef.current = metaMap;
  // saveStatus — индикатор для UI: 'idle' (всё сохранено), 'saving'
  // (POST в полёте), 'saved' (только что закончили; через 1.2s → idle).
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  // Sidebar resize.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  });
  const sidebarMountedRef = useRef(false);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (!sidebarMountedRef.current) {
      sidebarMountedRef.current = true;
      return;
    }
    const t1 = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
    const t2 = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [sidebarCollapsed]);

  // Global ⌘S toggle — listen `hone:toggle-sidebar` event from App.tsx.
  useEffect(() => {
    const onToggle = () => setSidebarCollapsed((c) => !c);
    window.addEventListener('hone:toggle-sidebar', onToggle as EventListener);
    return () => window.removeEventListener('hone:toggle-sidebar', onToggle as EventListener);
  }, []);
  const [sidebarW, setSidebarW] = useState<number>(() => {
    if (typeof window === 'undefined') return SIDEBAR_DEFAULT;
    const raw = window.localStorage.getItem(SIDEBAR_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n)) return SIDEBAR_DEFAULT;
    return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, n));
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_KEY, String(sidebarW));
    } catch {
      /* ignore */
    }
  }, [sidebarW]);
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      setSidebarW(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, dragRef.current.w + dx)));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Load folders once on mount.
  useEffect(() => {
    listFolders().then(setFolders).catch(() => {});
  }, []);

  // Initial list fetch + reactive refetch on SSE-bridged events.
  // hone:sync-changed диспатчит App.tsx когда server push приходит —
  // мы re-fetch'аем list, чтобы sidebar видел изменения с других девайсов
  // мгновенно. Игнорируем temp:id rows при merge (они не на сервере).
  useEffect(() => {
    let cancelled = false;

    const fetchList = () => {
      if (cancelled) return;
      // Local-only notes (free-tier и ниже) — параллельно с network list'ом
      // тянем из IndexedDB. local: id префикс однозначно отличает их от
      // cloud-нот, sidebar отрисует одним списком (sorted by updatedAt).
      const localPromise = listLocalNotes().catch((): LocalNote[] => []);

      void Promise.all([listNotes(), localPromise])
        .then(([res, locals]) => {
          if (cancelled) return;
          const localRows: NoteSummary[] = locals.map((n) => ({
            id: n.id,
            title: n.title,
            updatedAt: new Date(n.updatedAt),
            sizeBytes: new Blob([n.bodyMd]).size,
            folderId: null,
          }));
          setList((prev) => {
            // Сохраняем temp:id rows которые ещё не на сервере (optimistic
            // create в полёте).
            const temps = prev.notes.filter((n) => n.id.startsWith('temp:'));
            const merged = [...temps, ...localRows, ...res.notes];
            // Stable sort: local + cloud по updatedAt desc, temps всегда top.
            const tempSet = new Set(temps.map((t) => t.id));
            merged.sort((a, b) => {
              if (tempSet.has(a.id) && !tempSet.has(b.id)) return -1;
              if (!tempSet.has(a.id) && tempSet.has(b.id)) return 1;
              const at = a.updatedAt?.getTime() ?? 0;
              const bt = b.updatedAt?.getTime() ?? 0;
              return at > bt ? -1 : 1;
            });
            return {
              status: 'ok',
              notes: merged,
              error: null,
              errorCode: null,
            };
          });
          const firstId = localRows[0]?.id ?? res.notes[0]?.id ?? null;
          if (firstId) setSelectedId((cur) => cur ?? firstId);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const ce = ConnectError.from(err);
          // На последующих refresh'ах (sync-bridged) не валим в error если
          // у нас УЖЕ есть list — оставляем что было.
          setList((prev) => {
            if (prev.status === 'ok' && prev.notes.length > 0) return prev;
            return {
              status: 'error',
              notes: [],
              error: ce.rawMessage || ce.message,
              errorCode: ce.code,
            };
          });
        });
    };

    const fetchMeta = () => {
      if (cancelled) return;
      void getNotesMeta()
        .then((items) => {
          if (cancelled) return;
          const m = new Map<string, NoteMeta>();
          for (const it of items) m.set(it.id, it);
          setMetaMap(m);
        })
        .catch(() => {
          /* silent — sidebar просто без флагов до следующего refresh'а */
        });
    };

    fetchList();
    fetchMeta();
    const onSync = () => {
      fetchList();
      fetchMeta();
    };
    window.addEventListener('hone:sync-changed', onSync);
    return () => {
      cancelled = true;
      window.removeEventListener('hone:sync-changed', onSync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load active note on selection change. Cache-first read для instant
  // open: пытаемся IndexedDB (Phase C-5) до сети, если есть — рендерим
  // сразу. В фоне — refresh из сети, replace state когда придёт.
  //
  // Skip-fetch cases:
  //   - temp:id → уже inline-loaded в handleCreate (server ещё не знает
  //     этот id, fetch вернёт 404).
  //   - active.id === selectedId → уже in-memory от optimistic-flow
  //     (например после createNote'а где мы вручную swap'нули id).
  useEffect(() => {
    if (!selectedId) {
      setActive(null);
      return;
    }
    if (selectedId.startsWith('temp:')) return;
    // Already loaded — не сбрасываем active (избегаем flicker'а пустого
    // экрана). Network refresh всё равно выполнится через SSE event
    // или 30s polling.
    if (activeRef.current?.id === selectedId) return;

    // Local-only note: читаем из IndexedDB, никаких network calls.
    if (isLocalNoteId(selectedId)) {
      let cancelledLocal = false;
      void getLocalNote(selectedId).then((ln) => {
        if (cancelledLocal || !ln) return;
        if (selectedIdRef.current !== selectedId) return;
        const note: Note = {
          id: ln.id,
          title: ln.title,
          bodyMd: ln.bodyMd,
          sizeBytes: new Blob([ln.bodyMd]).size,
          createdAt: new Date(ln.createdAt),
          updatedAt: new Date(ln.updatedAt),
        } as Note;
        setActive(note);
        setDraftTitle(note.title);
        setDraftBody(note.bodyMd);
      });
      return () => {
        cancelledLocal = true;
      };
    }

    let cancelled = false;
    setActiveError(null);

    // Cache-first: instant render если в IndexedDB есть row.
    void (async () => {
      const uid = useSessionStore.getState().userId;
      if (!uid) return;
      try {
        const cached = await getRow<Record<string, unknown>>(uid, 'hone_notes', selectedId);
        if (cancelled || !cached) return;
        // Если за время cache-fetch'а пользователь ушёл на другую заметку
        // (selectedId сменился) — не пишем stale data.
        if (selectedIdRef.current !== selectedId) return;
        const note: Note = {
          id: String(cached.id),
          title: typeof cached.title === 'string' ? cached.title : 'Untitled',
          bodyMd: typeof cached.body_md === 'string' ? cached.body_md : '',
          sizeBytes: typeof cached.size_bytes === 'number' ? cached.size_bytes : 0,
          createdAt: typeof cached.created_at === 'string' ? new Date(cached.created_at) : new Date(),
          updatedAt: typeof cached.updated_at === 'string' ? new Date(cached.updated_at) : new Date(),
        } as Note;
        setActive(note);
        setDraftTitle(note.title);
        setDraftBody(note.bodyMd);
      } catch {
        /* IDB miss — упадём на network */
      }
    })();

    // Network refresh — всегда, чтобы поймать изменения с других девайсов.
    getNote(selectedId)
      .then((n) => {
        if (cancelled) return;
        if (selectedIdRef.current !== selectedId) return;
        // Если у нас есть локальные unsaved changes (lastSavedRef !==
        // current draft), НЕ переписываем draft — иначе потеряем юзеровский
        // ввод. Active мета-инфо обновляем (title/updated_at в sidebar
        // remains accurate).
        const ds = draftRef.current;
        const localDirty = ds.activeId === selectedId &&
          (ds.title !== n.title || ds.body !== n.bodyMd) &&
          (lastSavedRef.current.title !== ds.title || lastSavedRef.current.body !== ds.body);
        setActive(n);
        if (!localDirty) {
          setDraftTitle(n.title);
          setDraftBody(n.bodyMd);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const ce = ConnectError.from(err);
        // Если уже есть cached active — не сбрасываем UI, только log.
        if (!activeRef.current) {
          setActiveError(ce.rawMessage || ce.message);
          setActive(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // ─── Persistence ────────────────────────────────────────────────────────

  // We keep the latest draft in a ref so flushNow() reads the current value
  // даже когда вызывается из beforeunload / unmount (closure-captured state
  // там устарел).
  const draftRef = useRef({ title: '', body: '', activeId: '' });
  draftRef.current = {
    title: draftTitle,
    body: draftBody,
    activeId: active?.id ?? '',
  };
  const lastSavedRef = useRef({ title: '', body: '' });
  useEffect(() => {
    if (active) lastSavedRef.current = { title: active.title, body: active.bodyMd };
  }, [active]);

  const flushNow = useCallback(async () => {
    const { activeId, title, body } = draftRef.current;
    if (!activeId) return;
    // Optimistic create в полёте: temp-id не существует на сервере,
    // updateNote 404'нет. Пропускаем — flush сработает при следующем
    // edit'е когда id будет уже real (handleCreate подменит после
    // successful POST).
    if (activeId.startsWith('temp:')) return;
    if (lastSavedRef.current.title === title && lastSavedRef.current.body === body) return;

    // Local-only note → persist в IndexedDB вместо REST. Никакого
    // encrypt-path: vault не применим к local-only (E2E смысла нет —
    // данные не покидают устройство; OS-level encryption уже даёт
    // baseline защиту).
    if (isLocalNoteId(activeId)) {
      setSaveStatus('saving');
      try {
        const updated = await updateLocalNote(activeId, { title, bodyMd: body });
        lastSavedRef.current = { title, body };
        if (updated) {
          setList((prev) => ({
            ...prev,
            notes: prev.notes.map((row) =>
              row.id === activeId
                ? { ...row, title: updated.title, updatedAt: new Date(updated.updatedAt), sizeBytes: new Blob([updated.bodyMd]).size }
                : row,
            ),
          }));
        }
        setSaveStatus('saved');
        window.setTimeout(() => setSaveStatus((cur) => (cur === 'saved' ? 'idle' : cur)), 1200);
      } catch {
        setSaveStatus('idle');
      }
      return;
    }

    setSaveStatus('saving');

    // Phase C-7 — re-encrypt path. Если active note encrypted, body —
    // plaintext (decrypted в EncryptedEditorView), который мы должны
    // снова encrypt'нуть и отправить через /vault/notes/{id}/encrypt
    // вместо обычного UpdateNote (иначе server запишет plaintext в
    // body_md → encryption-гарантия нарушена).
    //
    // Title тоже всё равно сохраняем через UpdateNote — title остаётся
    // plaintext'ом (видим в sidebar для всех заметок включая encrypted).
    const isEncrypted = metaMapRef.current.get(activeId)?.encrypted ?? false;
    try {
      if (isEncrypted) {
        const { isUnlocked, encryptNote } = await import('../api/vault');
        if (!isUnlocked()) {
          // Vault stale-locked во время сессии редактирования. Сохранение
          // plaintext'а будет утечкой → отказ. Юзер увидит «Saving…»
          // зависшим — следующий attempt при unlock'е сработает.
          setSaveStatus('idle');
          return;
        }
        // Title: сохраняем через обычный path (он перетирает body_md тоже,
        // но мы немедленно за ним push'ним свежий ciphertext через
        // /vault/notes/{id}/encrypt — итоговое состояние корректное:
        // title=user input, body_md=ciphertext, encrypted=true).
        await updateNote(activeId, title, lastSavedRef.current.body); // body не трогаем, оставляем prev ciphertext
        await encryptNote(activeId, body);
        // После encryptNote'а server'ный body_md = свежий ciphertext.
        // lastSavedRef держим plaintext чтобы следующий keystroke снова
        // не trigger'ил save если ничего не изменилось.
        lastSavedRef.current = { title, body };
      } else {
        const n = await updateNote(activeId, title, body);
        lastSavedRef.current = { title: n.title, body: n.bodyMd };
        setActive((cur) => (cur && cur.id === n.id ? n : cur));
        setList((prev) => ({
          ...prev,
          notes: prev.notes.map((row) =>
            row.id === activeId
              ? { ...row, title: n.title, updatedAt: n.updatedAt, sizeBytes: n.sizeBytes }
              : row,
          ),
        }));
      }
      setSaveStatus('saved');
      window.setTimeout(() => {
        setSaveStatus((cur) => (cur === 'saved' ? 'idle' : cur));
      }, 1200);
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setActiveError(ce.rawMessage || ce.message);
      setSaveStatus('idle');
    }
  }, []);

  // Debounced autosave on keystroke. 250ms — quick «saved» feedback
  // без забивания сети (типичный typist 4-5 keystroke/s, debounce
  // схлопывает burst в один POST).
  useEffect(() => {
    if (!active) return;
    if (draftTitle === active.title && draftBody === active.bodyMd) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flushNow(), 250);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [draftTitle, draftBody, active, flushNow]);

  // Immediate flush on window blur (alt-tab) и beforeunload (close/reload).
  useEffect(() => {
    const onBlur = () => void flushNow();
    const onBeforeUnload = () => {
      // Best-effort sync save через keepalive — fetch'и в beforeunload
      // обрезаются браузером, но updateNote проходит через Connect и
      // обычно успевает на ~50ms. Не идеально, но приемлемо для MVP.
      void flushNow();
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Финальный flush на unmount (route-change Notes → Today).
      void flushNow();
    };
  }, [flushNow]);

  // Single-shot consume initialSelectedId on mount.
  useEffect(() => {
    if (initialSelectedId) {
      setSelectedId(initialSelectedId);
      onConsumeInitial?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When a Cue note arrives via deep link (page already mounted), открыть
  // её немедленно. Idempotency через filePath:
  //   1. localStorage хранит карту filePath → localNoteId.
  //   2. На повторный deep-link с тем же файлом — переключаемся на
  //      existing local note БЕЗ перезатирания body (юзер мог отредактить
  //      в Hone после импорта; Cue-source-of-truth не перебивает edits).
  //   3. На новый filePath — createLocalNote, добавить в карту, поставить
  //      row в list.
  useEffect(() => {
    if (!initialCueNote) return;
    setActiveCueNote(initialCueNote);
    setSelectedId(null);
    setActive(null);
    onConsumeCueNote?.();
    const { filePath, analysis } = initialCueNote;
    const title = analysis.title || 'Meeting notes';
    const existingId = readCueImportMap()[filePath];
    if (existingId) {
      // Verify local note ещё существует (юзер мог удалить).
      void getLocalNote(existingId).then((ln) => {
        if (ln) {
          // Note есть — переключаемся, не дублируем.
          setSelectedId(existingId);
          return;
        }
        // Note удалена → пересоздаём + перезаписываем mapping.
        void createCueLocalNote(filePath, title, analysis);
      });
      return;
    }
    void createCueLocalNote(filePath, title, analysis);

    function createCueLocalNote(fp: string, t: string, a: CueSessionAnalysis) {
      return createLocalNote(t, buildCueMarkdown(a))
        .then((ln) => {
          const row: NoteSummary = {
            id: ln.id,
            title: ln.title,
            updatedAt: new Date(ln.updatedAt),
            sizeBytes: new Blob([ln.bodyMd]).size,
            folderId: null,
          };
          setList((prev) => ({ ...prev, notes: [row, ...prev.notes] }));
          writeCueImportMapping(fp, ln.id);
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCueNote]);

  // ⌘J connections / ⌘⇧L AskNotes / ⌘N create.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setAskOpen(true);
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        if (!active) return;
        setConnectionsOpen((o) => !o);
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void handleCreate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ─── Actions ────────────────────────────────────────────────────────────

  // Optimistic create: instant feedback. Flow:
  //   1. Generate temp-id, добавляем фейковую row в list немедленно,
  //      переключаем selectedId на неё → юзер уже видит редактор.
  //   2. flushNow() в фоне (если был активный редактор).
  //   3. createNote() в фоне; на успех — заменяем temp-id на real,
  //      перенаправляем selectedId; на ошибку — удаляем фейк + toast.
  //
  // Trick: temp-id формата `temp:<uuid>` — Connect-RPC signature
  // принимает любую string на client'е, на server'е id GENERATES сам.
  // Local в IndexedDB не пишем (это origin only — не sync до того как
  // server присвоил постоянный id, иначе rebuild сломается).
  const handleCreate = useCallback(async () => {
    void flushNow(); // не await: pending save поедет фоном

    // Free-tier: создаём local-only заметку (никогда не идёт на бэкенд).
    // Юзер всё равно может отдельно "Sync to cloud" если quota позволит.
    const tier = useQuotaStore.getState().tier;
    if (tier === 'free') {
      try {
        const ln = await createLocalNote('Untitled', '');
        const row: NoteSummary = {
          id: ln.id,
          title: ln.title,
          updatedAt: new Date(ln.updatedAt),
          sizeBytes: 0,
          folderId: null,
        };
        setList((prev) => ({ ...prev, notes: [row, ...prev.notes] }));
        setSelectedId(ln.id);
        setActive({
          id: ln.id,
          title: ln.title,
          bodyMd: '',
          sizeBytes: 0,
          createdAt: new Date(ln.createdAt),
          updatedAt: new Date(ln.updatedAt),
        } as Note);
        setDraftTitle(ln.title);
        setDraftBody('');
      } catch (err) {
        setActiveError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const tempId = `temp:${crypto.randomUUID()}`;
    const now = new Date();
    const tempNote: NoteSummary = {
      id: tempId,
      title: 'Untitled',
      sizeBytes: 0,
      updatedAt: now,
      folderId: null,
    };
    // Optimistic UI:
    setList((prev) => ({ ...prev, notes: [tempNote, ...prev.notes] }));
    setSelectedId(tempId);
    // Затравочный draft — Editor покажет пустое поле для немедленного
    // ввода. Когда придёт server-id, мы пере-select'нем и effect загрузит
    // (пустое) тело без flicker'а.
    setActive({
      id: tempId,
      title: 'Untitled',
      bodyMd: '',
      sizeBytes: 0,
      createdAt: now,
      updatedAt: now,
    } as Note);
    setDraftTitle('Untitled');
    setDraftBody('');

    try {
      const n = await createNote('Untitled', '');
      // Replace temp-row with real one, swap selectedId.
      setList((prev) => ({
        ...prev,
        notes: prev.notes.map((row) =>
          row.id === tempId
            ? { id: n.id, title: n.title, updatedAt: n.updatedAt, sizeBytes: n.sizeBytes, folderId: n.folderId }
            : row,
        ),
      }));
      setSelectedId((cur) => (cur === tempId ? n.id : cur));
      // Active note: подменяем id, draft уже совпадает.
      setActive((cur) => (cur && cur.id === tempId ? { ...cur, id: n.id } : cur));

      // Default-encrypt: если vault unlocked'ed (а он по дефолту unlocked
      // через VaultUnlockGate), сразу encrypt'аем свежесозданную note.
      // Body=пустой, но мы прокинем через `encryptNote` чтобы server
      // взвёл encrypted=true flag — следующий save будет encrypted-path.
      // Если vault locked (race-window, юзер lock'нул прямо сейчас) —
      // оставляем plaintext, юзер может вручную encrypt'нуть позже из
      // 3-точек.
      try {
        const { isUnlocked, encryptNote: encryptApi } = await import('../api/vault');
        if (isUnlocked()) {
          await encryptApi(n.id, '');
          setMetaMap((prev) => {
            const next = new Map(prev);
            const cur = next.get(n.id);
            next.set(n.id, {
              id: n.id,
              published: cur?.published ?? false,
              encrypted: true,
            });
            return next;
          });
        }
      } catch {
        /* encrypt-fail — note всё равно создалась, просто без E2E */
      }
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      // Откатываем: удалить temp-row и сбросить selection.
      setList((prev) => ({ ...prev, notes: prev.notes.filter((r) => r.id !== tempId) }));
      setSelectedId((cur) => (cur === tempId ? null : cur));
      setActive((cur) => (cur && cur.id === tempId ? null : cur));
      // Quota-exhausted (Connect ResourceExhausted = HTTP 429 в connect-go
      // mapping; Code value 8) → показываем UpgradePrompt вместо обычной
      // ошибки. Refresh quota чтобы UI отображал свежий count.
      if (ce.code === Code.ResourceExhausted) {
        const { useQuotaStore, quotaExceededMessage } = await import('../stores/quota');
        useQuotaStore.getState().showUpgradePrompt(quotaExceededMessage('note'));
        void useQuotaStore.getState().refresh();
      } else {
        setActiveError(ce.rawMessage || ce.message);
      }
    }
  }, [flushNow]);

  // onSelectNote — stable identity (нужно для React.memo Sidebar/NoteRow).
  // flushNow — useCallback([]) тоже стабильный, ОК в deps.
  const onSelectNote = useCallback(
    (id: string) => {
      void flushNow();
      setSelectedId(id);
    },
    [flushNow],
  );

  // Stable identity (no list.notes / selectedId in deps). Internal state
  // mutations через functional setState — без замыкания на устаревшие
  // значения. Это критично для React.memo на NoteRow: иначе callback
  // меняется на каждый list.notes update и memo перерисовывает все rows.
  const handleDelete = useCallback(async (id: string) => {
    try {
      if (isLocalNoteId(id)) {
        await deleteLocalNote(id);
      } else {
        await deleteNote(id);
      }
      setList((prev) => ({ ...prev, notes: prev.notes.filter((n) => n.id !== id) }));
      // Quota counter: server-side count изменился, sidebar quota-bar
      // (`SYNCED N / OVER LIMIT M`) должен decrement'нуться. Раньше юзер
      // удалял notes, а счётчик оставался прежним до hourly auto-refresh.
      // Trigger immediate re-fetch.
      if (!isLocalNoteId(id)) {
        const { useQuotaStore } = await import('../stores/quota');
        void useQuotaStore.getState().refresh();
      }
      // Используем functional setSelectedId с inspection через setList
      // чтобы избежать stale closure'а на selectedId. Closure'нем через
      // отдельный set: если deleted == текущий, выбрать первый оставшийся.
      setSelectedId((cur) => {
        if (cur !== id) return cur;
        const next = listRef.current.notes.find((n) => n.id !== id);
        return next?.id ?? null;
      });
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setActiveError(ce.rawMessage || ce.message);
    }
  }, []);

  // Sync local note → cloud. Создаёт server row через CreateNote (с
   // текущим title+body), затем удаляет local copy и пере-select'ает на
   // новый server id. На quota-exhausted показываем upgrade prompt и
   // оставляем local copy intact.
  const handleSyncToCloud = useCallback(async (id: string) => {
    if (!isLocalNoteId(id)) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      // Offline-guard: без internet'а sync обречён на network error.
      // Раньше юзер кликал, видел «Sync failed» через 30s timeout — теперь
      // моментальный feedback что мы offline.
      setToast("You're offline · sync paused");
      window.setTimeout(() => setToast(null), 2400);
      return;
    }
    try {
      await flushNow(); // ensure latest content в local store
      const ln = await getLocalNote(id);
      if (!ln) return;
      const created = await createNote(ln.title, ln.bodyMd);
      // Удаляем local после успешного create.
      await deleteLocalNote(id);
      setList((prev) => ({
        ...prev,
        notes: prev.notes.map((row) =>
          row.id === id
            ? { id: created.id, title: created.title, updatedAt: created.updatedAt, sizeBytes: created.sizeBytes, folderId: created.folderId }
            : row,
        ),
      }));
      setSelectedId((cur) => (cur === id ? created.id : cur));
      setActive((cur) => (cur && cur.id === id ? created : cur));
      setToast('Synced to cloud');
      window.setTimeout(() => setToast(null), 2400);
      void useQuotaStore.getState().refresh();
    } catch (err) {
      const ce = ConnectError.from(err);
      if (ce.code === Code.ResourceExhausted) {
        const { quotaExceededMessage } = await import('../stores/quota');
        useQuotaStore.getState().showUpgradePrompt(quotaExceededMessage('note'));
        void useQuotaStore.getState().refresh();
      } else {
        setToast('Sync failed');
        window.setTimeout(() => setToast(null), 2400);
      }
    }
  }, [flushNow]);

  const handlePublish = useCallback(async (id: string) => {
    try {
      await flushNow(); // публикуем именно последнюю версию
      const status = await publishNote(id);
      if (status.url) {
        try {
          await navigator.clipboard.writeText(status.url);
          setToast('Public link copied');
        } catch {
          setToast(`Public: ${status.url}`);
        }
        window.setTimeout(() => setToast(null), 2400);
      }
    } catch {
      setToast('Publish failed');
      window.setTimeout(() => setToast(null), 2400);
    }
  }, [flushNow]);

  const handleUnpublish = useCallback(async (id: string) => {
    try {
      await unpublishNote(id);
      setToast('Unpublished');
      window.setTimeout(() => setToast(null), 2200);
    } catch {
      setToast('Unpublish failed');
      window.setTimeout(() => setToast(null), 2400);
    }
  }, []);

  // Phase C-7 — encrypt note. Lock-icon в sidebar row → этот handler.
  // Flow:
  //   1. Если vault не unlocked — prompt password, derive key.
  //   2. Если note ещё в Yjs/CodeMirror migration — flush сначала чтобы
  //      зашифровать самую свежую версию body_md (а не вчерашнюю).
  //   3. Encrypt body локально + POST /vault/notes/{id}/encrypt.
  //   4. Toast confirmation, локальный list state обновится через
  //      next pull (SSE event, или 30s).
  const handleEncrypt = useCallback(async (id: string) => {
    try {
      const { isUnlocked, unlockVault, fetchSalt, encryptNote: encryptApi } =
        await import('../api/vault');
      if (!isUnlocked()) {
        const salt = await fetchSalt();
        if (!salt) {
          setToast('Set up Vault in Settings first');
          window.setTimeout(() => setToast(null), 2800);
          return;
        }
        const pwd = window.prompt('Vault password to encrypt this note:');
        if (!pwd) return;
        await unlockVault(pwd);
      }
      // Flush текущего drafr'а если encrypting active note — иначе
      // зашифруем yesterday's bytes. Если encrypting другую заметку
      // (не selected) — flushNow на ней noop, getNote() ниже подтянет
      // server-truth.
      await flushNow();
      const note = await getNote(id);
      if (note.bodyMd === undefined) {
        setToast('Could not load note body');
        window.setTimeout(() => setToast(null), 2400);
        return;
      }
      await encryptApi(id, note.bodyMd);
      setToast('Note encrypted');
      window.setTimeout(() => setToast(null), 2200);
    } catch (e) {
      setToast(`Encrypt failed: ${(e as Error).message}`);
      window.setTimeout(() => setToast(null), 3400);
    }
  }, [flushNow]);

  const handleSidebarCollapse = useCallback(() => setSidebarCollapsed(true), []);

  const handleCreateFolder = useCallback(async (name: string, parentId?: string | null) => {
    try {
      const f = await createFolder(name, parentId);
      setFolders((prev) => [...prev, f].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      setToast(`Could not create folder: ${(e as Error).message}`);
      window.setTimeout(() => setToast(null), 2400);
    }
  }, []);

  const handleDeleteFolder = useCallback(async (id: string) => {
    try {
      await deleteFolder(id, true);
      setFolders((prev) => prev.filter((f) => f.id !== id));
      setList((prev) => ({
        ...prev,
        notes: prev.notes.map((n) => (n.folderId === id ? { ...n, folderId: null } : n)),
      }));
      if (selectedFolder === id) setSelectedFolder('all');
    } catch (e) {
      setToast(`Could not delete folder: ${(e as Error).message}`);
      window.setTimeout(() => setToast(null), 2400);
    }
  }, [selectedFolder]);

  const handleMoveNote = useCallback(async (noteId: string, folderId: string | null) => {
    try {
      await moveNote(noteId, folderId);
      setList((prev) => ({
        ...prev,
        notes: prev.notes.map((n) => (n.id === noteId ? { ...n, folderId } : n)),
      }));
    } catch {
      // silent — not blocking
    }
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 80,
        paddingBottom: 80,
        display: 'grid',
        // КРИТИЧНО: при collapsed — single-column grid, иначе Editor с
        // одним in-flow child'ом auto-flow'ится в column 1 и схлопывается
        // до нуля ширины (NotesExpandSidebarButton — position:absolute,
        // в grid flow не участвует).
        gridTemplateColumns: sidebarCollapsed ? `1fr` : `${sidebarW}px 6px 1fr`,
        animationDuration: '320ms',
      }}
    >
      {!sidebarCollapsed && (
        <Sidebar
          list={list}
          selectedId={selectedId}
          metaMap={metaMap}
          activeCueNote={activeCueNote}
          onSelectCueNote={(note) => {
            setActiveCueNote(note);
            setSelectedId(null);
            setActive(null);
          }}
          onSelect={(id) => {
            setActiveCueNote(null);
            onSelectNote(id);
          }}
          folders={folders}
          selectedFolder={selectedFolder}
          onSelectFolder={setSelectedFolder}
          onCreateFolder={handleCreateFolder}
          onDeleteFolder={handleDeleteFolder}
          onMoveNote={handleMoveNote}
          onCreate={handleCreate}
          onDelete={handleDelete}
          onPublish={handlePublish}
          onUnpublish={handleUnpublish}
          onEncrypt={handleEncrypt}
          onSyncToCloud={handleSyncToCloud}
          onToggleCollapse={handleSidebarCollapse}
        />
      )}

      {!sidebarCollapsed && (
        <ResizeHandle
          onMouseDown={(e) => {
            dragRef.current = { x: e.clientX, w: sidebarW };
          }}
        />
      )}
      {sidebarCollapsed && (
        <NotesExpandSidebarButton onClick={() => setSidebarCollapsed(false)} />
      )}

      {activeCueNote ? (
        <CueMeetingNotes
          analysis={activeCueNote.analysis}
          filePath={activeCueNote.filePath}
        />
      ) : (
        <Editor
          list={list}
          active={active}
          activeError={activeError}
          draftTitle={draftTitle}
          draftBody={draftBody}
          encrypted={!!(active && metaMap.get(active.id)?.encrypted)}
          saveStatus={saveStatus}
          folders={folders}
          onTitleChange={setDraftTitle}
          onBodyChange={setDraftBody}
          onCreate={handleCreate}
        />
      )}

      {connectionsOpen && active && (
        <ConnectionsPanel
          noteId={active.id}
          onClose={() => setConnectionsOpen(false)}
          onPick={(id) => {
            setSelectedId(id);
            setConnectionsOpen(false);
          }}
        />
      )}
      {askOpen && (
        <AskNotesModal
          onClose={() => setAskOpen(false)}
          onOpenNote={(noteId) => setSelectedId(noteId)}
        />
      )}

      {toast && <Toast text={toast} />}
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────

interface SidebarProps {
  list: ListState;
  selectedId: string | null;
  metaMap: Map<string, NoteMeta>;
  activeCueNote: { filePath: string; analysis: CueSessionAnalysis } | null;
  folders: Folder[];
  selectedFolder: string | null | 'all';
  onSelectFolder: (id: string | null | 'all') => void;
  onCreateFolder: (name: string, parentId?: string | null) => void;
  onDeleteFolder: (id: string) => void;
  onMoveNote: (noteId: string, folderId: string | null) => void;
  onSelect: (id: string) => void;
  onSelectCueNote: (note: { filePath: string; analysis: CueSessionAnalysis }) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onPublish: (id: string) => void;
  onEncrypt: (id: string) => void;
  onUnpublish: (id: string) => void;
  onSyncToCloud: (id: string) => void;
  onToggleCollapse: () => void;
}

function NotesExpandSidebarButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="focus-ring fadein"
      title="Show sidebar"
      style={{
        position: 'absolute',
        top: 92,
        left: 10,
        width: 28,
        height: 28,
        borderRadius: 7,
        background: 'rgba(20,20,22,0.78)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.08)',
        cursor: 'pointer',
        color: 'var(--ink-60)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 30,
        animationDuration: '180ms',
        transition: 'color 160ms ease, background-color 160ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--ink-60)';
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
        <path d="M12 10l2 2-2 2" />
      </svg>
    </button>
  );
}

// Sidebar memoized: keystroke в Editor (draftTitle / draftBody) НЕ должен
// триггерить re-render всех NoteRow. Memo сравнивает props по reference;
// мы стабилизируем все callbacks через useCallback в parent — иначе memo
// бесполезен. См. Notes parent: handleCreate, handleDelete, handlePublish,
// handleUnpublish, handleEncrypt — все useCallback с устойчивыми deps.
const Sidebar = memo(SidebarImpl);

// CUE_IMPORT_MAP_KEY — filePath → localNoteId mapping. Один Cue-файл
// импортируется в одну заметку, повторное открытие через deep-link
// переключается на существующую (без перезатирания edits юзера в Hone).
const CUE_IMPORT_MAP_KEY = 'hone:notes:cue-imports:v1';

function readCueImportMap(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(CUE_IMPORT_MAP_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeCueImportMapping(filePath: string, localNoteId: string): void {
  try {
    const map = readCueImportMap();
    map[filePath] = localNoteId;
    window.localStorage.setItem(CUE_IMPORT_MAP_KEY, JSON.stringify(map));
  } catch {
    /* quota — не критично, max что повторный импорт создаст дубликат */
  }
}

// EXPANDED_FOLDERS_KEY — set of expanded folder IDs, persisted в
// localStorage. Notion/Obsidian повторно открываются с тем же tree-state'ом.
const EXPANDED_FOLDERS_KEY = 'hone:notes:expanded-folders';

function readExpandedFolders(): Set<string> {
  try {
    const raw = window.localStorage.getItem(EXPANDED_FOLDERS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function writeExpandedFolders(s: Set<string>): void {
  try {
    window.localStorage.setItem(EXPANDED_FOLDERS_KEY, JSON.stringify(Array.from(s)));
  } catch {
    /* ignore quota */
  }
}

function SidebarImpl({ list, selectedId, metaMap, activeCueNote, folders, selectedFolder, onSelectFolder, onCreateFolder, onDeleteFolder, onMoveNote, onSelect, onSelectCueNote, onCreate, onDelete, onPublish, onUnpublish, onEncrypt, onSyncToCloud, onToggleCollapse }: SidebarProps) {
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState<{ parentId: string | null } | null>(null);
  const [folderInputRef] = useState(() => ({ current: null as HTMLInputElement | null }));
  const [expanded, setExpanded] = useState<Set<string>>(() => readExpandedFolders());

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeExpandedFolders(next);
      return next;
    });
  }, []);

  // childrenByParent — карта «parent_id → folder[]». null parent = корневые
  // папки. Один проход по списку.
  const childrenByParent = useMemo(() => {
    const m = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const k = f.parentId ?? null;
      const arr = m.get(k) ?? [];
      arr.push(f);
      m.set(k, arr);
    }
    // Stable sort by name внутри каждой группы — UX consistency.
    for (const arr of m.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    return m;
  }, [folders]);

  // notesCount(folderId) — direct-children заметки только. Notion-style:
  // не агрегируем рекурсивно (отвлекает от иерархии).
  const notesCountByFolder = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const n of list.notes) {
      const k = n.folderId ?? null;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [list.notes]);

  const visibleNotes = useMemo(() => {
    if (selectedFolder === 'all') return list.notes;
    return list.notes.filter((n) => n.folderId === (selectedFolder ?? null));
  }, [list.notes, selectedFolder]);
  return (
    <aside
      // slide-from-left анимация удалена для симметрии open/close.
      style={{
        animationDuration: '320ms',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        padding: '0 8px',
        overflowY: 'auto',
      }}
    >
      <SidebarHeader
        status={list.status}
        onCreate={onCreate}
        onToggleCollapse={onToggleCollapse}
      />

      {/* Cue Sessions — populated when the user opens a note from Cue desktop */}
      {activeCueNote && (
        <div style={{ marginBottom: 8 }}>
          <div style={{
            padding: '6px 6px 4px',
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: 'var(--ink-40)',
          }}>
            Cue Sessions
          </div>
          <button
            onClick={() => onSelectCueNote(activeCueNote)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 8px',
              borderRadius: 6,
              background: 'rgba(79,195,247,0.08)',
              border: '1px solid rgba(79,195,247,0.18)',
              color: 'var(--ink-90)',
              fontSize: 12.5,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 120ms',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(79,195,247,0.14)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(79,195,247,0.08)')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="rgba(79,195,247,0.9)" strokeWidth="1.3" strokeLinejoin="round">
              <path d="M6 1L10.33 3.5V8.5L6 11L1.67 8.5V3.5L6 1Z" />
            </svg>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeCueNote.analysis.title || 'Cue meeting'}
            </span>
          </button>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '8px 0' }} />
        </div>
      )}

      {/* Folder tree */}
      {folders.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{
            padding: '4px 14px 2px',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}>
            <span style={{
              flex: 1,
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: 'var(--ink-40)',
            }}>
              Folders
            </span>
            <button
              onClick={() => {
                setCreatingFolder({ parentId: null });
                window.setTimeout(() => folderInputRef.current?.focus(), 40);
              }}
              title="New folder"
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--ink-40)',
                display: 'grid',
                placeItems: 'center',
                transition: 'color 160ms ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-40)')}
            >
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>

          {creatingFolder && creatingFolder.parentId === null && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = newFolderName.trim();
                if (name) { onCreateFolder(name, null); }
                setNewFolderName('');
                setCreatingFolder(null);
              }}
              style={{ padding: '2px 10px 4px' }}
            >
              <input
                ref={(el) => { folderInputRef.current = el; }}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onBlur={() => { setCreatingFolder(null); setNewFolderName(''); }}
                onKeyDown={(e) => { if (e.key === 'Escape') { setCreatingFolder(null); setNewFolderName(''); } }}
                placeholder="Folder name…"
                style={{
                  width: '100%',
                  height: 26,
                  padding: '0 8px',
                  borderRadius: 6,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'var(--ink)',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
            </form>
          )}

          {/* All Notes row */}
          <FolderRow
            label="All Notes"
            count={list.notes.length}
            active={selectedFolder === 'all'}
            onClick={() => onSelectFolder('all')}
          />

          {/* Recursive folder tree. Корень = parentId=null;
              children лежат в childrenByParent[id]. Hover'ом на любую
              папку показывается «+» для создания subfolder'а. */}
          <FolderTreeBranch
            parentId={null}
            level={0}
            childrenByParent={childrenByParent}
            notesCountByFolder={notesCountByFolder}
            expanded={expanded}
            selectedFolder={selectedFolder}
            onSelectFolder={onSelectFolder}
            onToggleExpand={toggleExpanded}
            onDeleteFolder={onDeleteFolder}
            onCreateChild={(pid) => {
              setCreatingFolder({ parentId: pid });
              window.setTimeout(() => folderInputRef.current?.focus(), 40);
              if (pid && !expanded.has(pid)) toggleExpanded(pid);
            }}
            inlineCreate={
              creatingFolder && creatingFolder.parentId !== null
                ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = newFolderName.trim();
                      const parentId = creatingFolder.parentId;
                      if (name) onCreateFolder(name, parentId);
                      setNewFolderName('');
                      setCreatingFolder(null);
                    }}
                    style={{ padding: '2px 10px 4px' }}
                  >
                    <input
                      ref={(el) => { folderInputRef.current = el; }}
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onBlur={() => { setCreatingFolder(null); setNewFolderName(''); }}
                      onKeyDown={(e) => { if (e.key === 'Escape') { setCreatingFolder(null); setNewFolderName(''); } }}
                      placeholder="Subfolder…"
                      style={{
                        width: '100%',
                        height: 24,
                        padding: '0 8px',
                        borderRadius: 6,
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        color: 'var(--ink)',
                        fontSize: 12,
                        outline: 'none',
                      }}
                    />
                  </form>
                )
                : null
            }
            inlineCreateUnderId={creatingFolder?.parentId ?? null}
          />

          {/* Unfiled */}
          <FolderRow
            label="Unfiled"
            count={notesCountByFolder.get(null) ?? 0}
            active={selectedFolder === null}
            onClick={() => onSelectFolder(null)}
          />

          <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '6px 10px 4px' }} />
        </div>
      )}

      {/* Notes list (filtered by selected folder) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 2px' }}>
        {visibleNotes.map((n) => {
          const meta = metaMap.get(n.id);
          return (
            <NoteRow
              key={n.id}
              note={n}
              active={selectedId === n.id}
              encrypted={meta?.encrypted ?? false}
              folders={folders}
              onSelect={onSelect}
              onDelete={onDelete}
              onPublish={onPublish}
              onUnpublish={onUnpublish}
              onEncrypt={onEncrypt}
              onSyncToCloud={onSyncToCloud}
              onMove={onMoveNote}
            />
          );
        })}
      </div>
      <div style={{ padding: '4px 6px' }}>
        <QuotaUsageBar resource="synced_notes" />
      </div>
      <NotesRetentionHint />
    </aside>
  );
}

function NotesRetentionHint() {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Notes inactive for 90+ days are archived. Edits or opens reset the timer. Encrypted notes are never auto-deleted."
      style={{
        marginTop: 14,
        padding: '10px 14px 14px',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'help',
      }}
    >
      <svg
        width={11}
        height={11}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: hover ? 'var(--ink-60)' : 'var(--ink-40)', flexShrink: 0, transition: 'color 160ms ease' }}
      >
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 14" />
      </svg>
      <span
        className="mono"
        style={{
          fontSize: 9,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: hover ? 'var(--ink-60)' : 'var(--ink-40)',
          transition: 'color 160ms ease',
        }}
      >
        Auto-archive after 90d
      </span>
    </div>
  );
}

function SidebarHeader({
  status,
  onCreate,
  onToggleCollapse,
}: {
  status: ListState['status'];
  onCreate: () => void;
  onToggleCollapse: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px 14px',
      }}
    >
      <button
        onClick={() => {
          // SPA-навигация Hone — нет браузерной истории. App.tsx слушает
          // 'hone:nav-home' event и делает setPage('home'). Раньше тут был
          // window.history.back() который в Electron renderer no-op'ит
          // (single-page app). Теперь явно отправляем nav-home event.
          window.dispatchEvent(new Event('hone:nav-home'));
        }}
        className="focus-ring"
        title="Back to Home"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 4,
          borderRadius: 6,
          cursor: 'pointer',
          color: 'var(--ink-60)',
          display: 'inline-flex',
          alignItems: 'center',
          transition: 'color 180ms ease, background-color 180ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--ink)';
          e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--ink-60)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <span
        style={{
          flex: 1,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: 'var(--ink-60)',
        }}
      >
        {status === 'loading' ? 'Notes' : status === 'error' ? 'Offline' : 'Notes'}
      </span>
      <CreateButton onClick={onCreate} />
      <button
        onClick={onToggleCollapse}
        className="focus-ring"
        title="Hide sidebar"
        style={{
          width: 26,
          height: 26,
          borderRadius: 7,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--ink-60)',
          display: 'grid',
          placeItems: 'center',
          transition: 'background-color 180ms ease, color 180ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
          e.currentTarget.style.color = 'var(--ink)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--ink-60)';
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
          <path d="M14 10l-2 2 2 2" />
        </svg>
      </button>
    </div>
  );
}

function CreateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="focus-ring"
      title="New note (⌘N)"
      style={{
        width: 26,
        height: 26,
        borderRadius: 7,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--ink-60)',
        display: 'grid',
        placeItems: 'center',
        transition: 'background-color 180ms ease, color 180ms ease, transform 180ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
        e.currentTarget.style.color = 'var(--ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--ink-60)';
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = 'scale(0.92)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}

// ─── FolderRow ─────────────────────────────────────────────────────────────

// FolderTreeBranch — рекурсивно рендерит папки уровня parentId. Для каждой
// папки: FolderRow + (если expanded) дочерняя ветка. Inline subfolder-form
// вставляется ровно под parent'ом, в котором юзер клацнул «+». Tree-state
// (expanded set) живёт в SidebarImpl, передаётся вниз; toggleExpand
// контроллирует свёртку/раскрытие.
function FolderTreeBranch({
  parentId,
  level,
  childrenByParent,
  notesCountByFolder,
  expanded,
  selectedFolder,
  onSelectFolder,
  onToggleExpand,
  onDeleteFolder,
  onCreateChild,
  inlineCreate,
  inlineCreateUnderId,
}: {
  parentId: string | null;
  level: number;
  childrenByParent: Map<string | null, Folder[]>;
  notesCountByFolder: Map<string | null, number>;
  expanded: Set<string>;
  selectedFolder: string | 'all' | null;
  onSelectFolder: (id: string | 'all' | null) => void;
  onToggleExpand: (id: string) => void;
  onDeleteFolder: (id: string) => void;
  onCreateChild: (parentId: string | null) => void;
  inlineCreate: React.ReactNode;
  inlineCreateUnderId: string | null;
}) {
  const items = childrenByParent.get(parentId) ?? [];
  return (
    <>
      {items.map((f) => {
        const hasChildren = (childrenByParent.get(f.id)?.length ?? 0) > 0;
        const isExpanded = expanded.has(f.id);
        return (
          <React.Fragment key={f.id}>
            <FolderRow
              label={f.name}
              count={notesCountByFolder.get(f.id) ?? 0}
              active={selectedFolder === f.id}
              level={level}
              expandable={hasChildren}
              expanded={isExpanded}
              onToggleExpand={() => onToggleExpand(f.id)}
              onClick={() => onSelectFolder(f.id)}
              onDelete={() => onDeleteFolder(f.id)}
              onCreateChild={() => onCreateChild(f.id)}
            />
            {inlineCreateUnderId === f.id && inlineCreate}
            {isExpanded && hasChildren && (
              <FolderTreeBranch
                parentId={f.id}
                level={level + 1}
                childrenByParent={childrenByParent}
                notesCountByFolder={notesCountByFolder}
                expanded={expanded}
                selectedFolder={selectedFolder}
                onSelectFolder={onSelectFolder}
                onToggleExpand={onToggleExpand}
                onDeleteFolder={onDeleteFolder}
                onCreateChild={onCreateChild}
                inlineCreate={inlineCreate}
                inlineCreateUnderId={inlineCreateUnderId}
              />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

function FolderRow({
  label,
  count,
  active,
  level = 0,
  expandable = false,
  expanded = false,
  onToggleExpand,
  onClick,
  onDelete,
  onCreateChild,
}: {
  label: string;
  count: number;
  active: boolean;
  level?: number;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onClick: () => void;
  onDelete?: () => void;
  onCreateChild?: () => void;
}) {
  const [hover, setHover] = useState(false);
  // Indent — Notion-style: 14px на каждый уровень (caret-area). На level=0
  // отступ задаётся padding в SidebarImpl, иначе тут добавляем 14*level.
  const indent = level * 14;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: `4px 8px 4px ${14 + indent}px`,
        borderRadius: 6,
        margin: '1px 4px',
        cursor: 'pointer',
        background: active ? 'rgba(255,255,255,0.08)' : hover ? 'rgba(255,255,255,0.04)' : 'transparent',
        transition: 'background 140ms ease',
      }}
    >
      {/* Caret или placeholder. Когда expandable — chevron click'ом
          раскрывает/складывает; когда нет — пустое место чтобы все ряды
          выровнялись. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (expandable && onToggleExpand) onToggleExpand();
        }}
        style={{
          width: 14,
          height: 14,
          padding: 0,
          background: 'transparent',
          border: 'none',
          cursor: expandable ? 'pointer' : 'default',
          color: 'var(--ink-40)',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          transition: 'transform 140ms ease, color 140ms ease',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          opacity: expandable ? 1 : 0,
        }}
      >
        <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      <FolderIcon color={active ? 'var(--ink-60)' : 'var(--ink-40)'} />
      <span style={{
        flex: 1,
        fontSize: 12.5,
        color: active ? 'var(--ink-90)' : 'var(--ink-60)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        transition: 'color 140ms ease',
      }}>
        {label}
      </span>
      <span style={{ fontSize: 10.5, color: 'var(--ink-40)', fontVariantNumeric: 'tabular-nums', marginRight: 4 }}>
        {count}
      </span>
      {onCreateChild && hover && (
        <button
          onClick={(e) => { e.stopPropagation(); onCreateChild(); }}
          title="New subfolder"
          style={{
            width: 16,
            height: 16,
            borderRadius: 3,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--ink-40)',
            display: 'grid',
            placeItems: 'center',
            padding: 0,
            transition: 'color 140ms ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-40)')}
        >
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
      {onDelete && hover && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete folder"
          style={{
            width: 16,
            height: 16,
            borderRadius: 3,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--ink-40)',
            display: 'grid',
            placeItems: 'center',
            padding: 0,
            transition: 'color 140ms ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#ff6a6a')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-40)')}
        >
          <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ─── NoteRow with three-dots menu ─────────────────────────────────────────

interface NoteRowProps {
  note: NoteSummary;
  active: boolean;
  encrypted: boolean;
  folders: Folder[];
  // Callbacks принимают note.id внутри row — это позволяет parent'у
  // передать единый стабильный callback на все rows (вместо
  // `() => fn(n.id)` который создаёт новый identity per render и
  // ломает React.memo).
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onPublish: (id: string) => void;
  onUnpublish: (id: string) => void;
  onEncrypt: (id: string) => void;
  onSyncToCloud: (id: string) => void;
  onMove: (noteId: string, folderId: string | null) => void;
}

// NoteRow memoized — на 30+ заметках без memo каждый keystroke в editor
// перерисовывал бы все rows = noticeable jank. Custom comparator: row
// re-render только при смене своих props (note reference, active flag,
// encrypted flag, callbacks).
const NoteRow = memo(NoteRowImpl, (prev, next) => {
  return (
    prev.note === next.note &&
    prev.active === next.active &&
    prev.encrypted === next.encrypted &&
    prev.folders === next.folders &&
    prev.onSelect === next.onSelect &&
    prev.onDelete === next.onDelete &&
    prev.onPublish === next.onPublish &&
    prev.onUnpublish === next.onUnpublish &&
    prev.onEncrypt === next.onEncrypt &&
    prev.onSyncToCloud === next.onSyncToCloud &&
    prev.onMove === next.onMove
  );
});

function NoteRowImpl({ note, active, encrypted, folders, onSelect, onDelete, onPublish, onUnpublish, onEncrypt, onSyncToCloud, onMove }: NoteRowProps) {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pubStatus, setPubStatus] = useState<PublishStatus | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const isLocal = isLocalNoteId(note.id);
  // Eager-load publish status on mount (not on hover как раньше). Lock-
  // icon в row отображает publish-state — должен быть правильным сразу,
  // а не только после первого hover'а. fetch идёмpotent + cached server-
  // side, дёшево.
  useEffect(() => {
    if (isLocal || pubStatus) return;
    let live = true;
    void getPublishStatus(note.id)
      .then((s) => {
        if (live) setPubStatus(s);
      })
      .catch(() => {
        /* silent — network blip → assume not published, lock-icon red */
      });
    return () => {
      live = false;
    };
  }, [pubStatus, note.id, isLocal]);

  // Close menu on outside click / Esc.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const lastUpd = useMemo(() => formatTime(note.updatedAt), [note.updatedAt]);

  return (
    <div
      ref={rowRef}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
      }}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px 6px 10px',
        margin: '1px 0',
        borderRadius: 6,
        background: active
          ? 'rgba(255,255,255,0.07)'
          : hover
            ? 'rgba(255,255,255,0.04)'
            : 'transparent',
        transition: 'background-color 160ms ease',
        cursor: 'pointer',
      }}
      onClick={() => onSelect(note.id)}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            color: active ? 'var(--ink)' : 'var(--ink-60)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            transition: 'color 160ms ease',
            lineHeight: 1.4,
          }}
        >
          {note.title || 'Untitled'}
        </div>
        <div
          className="mono"
          style={{
            fontSize: 10,
            color: 'var(--ink-40)',
            marginTop: 1,
            lineHeight: 1.3,
          }}
        >
          {lastUpd}
        </div>
      </div>

      {/* Phase C-7 lock-icon — два режима:
            - encrypted=true → filled lock, всегда видна (badge), клик
              просто открывает note (decrypt flow в Editor'е).
            - encrypted=false → outline lock, fade-on-hover, клик →
              encrypt flow (prompt password если vault locked).
         */}
      {isLocal ? (
        // Local-only — показываем «device» badge вместо lock'а. Encrypt
        // flow не применим (vault — для cloud-нот, у local плейн в IDB).
        <span
          title="Local-only (this device)"
          style={{
            width: 22,
            height: 22,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--ink-40)',
            flexShrink: 0,
            pointerEvents: 'none',
          }}
        >
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="12" rx="2" />
            <path d="M8 20h8M12 16v4" />
          </svg>
        </span>
      ) : (
        // Lock-icon = publish state.
        //   🔒 red    = private (не опубликована)  → click → publish
        //   🔓 green  = public  (опубликована)     → click → unpublish
        //
        // Раньше lock = encryption-state (encrypted vs plaintext) — юзер не
        // понимал, click locked'а ничего не делал (pointerEvents:none). Сейчас
        // lock зеркалит publish state'ом, что более intuitive: «закрыто =
        // приватно, открыто = в интернете». Encryption переехало в dropdown
        // (см. RowDropdown «Encrypt note» item).
        //
        // Animation: shackle path морфит open↔closed на 220ms. Цвет тоже
        // плавно меняется через color transition.
        (() => {
          const isPublic = !!pubStatus?.published;
          const lockColor = isPublic
            ? 'rgba(127,212,155,0.95)' // green — public
            : 'rgba(255,106,106,0.95)'; // red — private
          const lockBg = isPublic
            ? 'rgba(127,212,155,0.10)'
            : 'rgba(255,106,106,0.08)';
          const lockBorder = isPublic
            ? 'rgba(127,212,155,0.30)'
            : 'rgba(255,106,106,0.22)';
          return (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isPublic) {
                  onUnpublish(note.id);
                  setPubStatus({ published: false });
                } else {
                  onPublish(note.id);
                  // Optimistic flip — handlePublish сам toast'нёт результат.
                  setPubStatus({ published: true });
                }
              }}
              className="focus-ring"
              title={isPublic ? 'Public on web — click to unpublish' : 'Private — click to publish to web'}
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 22,
                height: 22,
                background: lockBg,
                border: `1px solid ${lockBorder}`,
                borderRadius: 5,
                cursor: 'pointer',
                color: lockColor,
                flexShrink: 0,
                transition:
                  'background-color 220ms ease, border-color 220ms ease, color 220ms ease, transform 180ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              <svg
                width={12}
                height={12}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="4" y="11" width="16" height="10" rx="2" />
                {/* Animated shackle: closed (M8 11 V7 a4 4 0 0 1 8 0 v4) vs
                    open (shackle вправо). Реализовали через condional path
                    + CSS transition — браузер интерполирует morph между двумя
                    discrete path'ами как opacity-fade поскольку SVG path data
                    не animatable без SMIL. Простое решение: 2 layered paths,
                    кросс-fade opacity. */}
                <path
                  d="M8 11V7a4 4 0 0 1 8 0v4"
                  style={{
                    opacity: isPublic ? 0 : 1,
                    transition: 'opacity 220ms ease',
                  }}
                />
                <path
                  d="M8 11V7a4 4 0 0 1 7-2"
                  style={{
                    opacity: isPublic ? 1 : 0,
                    transition: 'opacity 220ms ease',
                  }}
                />
              </svg>
            </button>
          );
        })()
      )}

      {/* Three-dots — также fade-in при hover */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((o) => !o);
        }}
        className="focus-ring"
        title="More"
        style={{
          width: 22,
          height: 22,
          display: 'grid',
          placeItems: 'center',
          background: menuOpen ? 'rgba(255,255,255,0.08)' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--ink-60)',
          borderRadius: 5,
          opacity: hover || menuOpen ? 1 : 0,
          transition: 'opacity 180ms ease, background-color 160ms ease, color 160ms ease',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--ink)';
          if (!menuOpen) e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--ink-60)';
          if (!menuOpen) e.currentTarget.style.background = 'transparent';
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>

      {menuOpen && (
        <RowDropdown
          isLocal={isLocal}
          published={!!pubStatus?.published}
          encrypted={encrypted}
          onEncrypt={() => {
            setMenuOpen(false);
            onEncrypt(note.id);
          }}
          onSyncToCloud={() => {
            setMenuOpen(false);
            onSyncToCloud(note.id);
          }}
          onPublish={() => {
            setMenuOpen(false);
            onPublish(note.id);
            // Optimistic update: после publish меню должно сразу показывать
            // «Unpublish». Раньше pubStatus был stale до next-hover refetch'а
            // → юзер не видел unpublish-кнопки и не понимал как отозвать
            // публикацию. Setting pubStatus={published:true} на parent click
            // → drop-down ре-рендерится с unpublish item'ом сразу.
            setPubStatus({ published: true });
          }}
          onUnpublish={() => {
            setMenuOpen(false);
            onUnpublish(note.id);
            setPubStatus({ published: false });
          }}
          onDelete={() => {
            // Прямое удаление без двойного confirm — юзер просил.
            setMenuOpen(false);
            onDelete(note.id);
          }}
          folders={folders}
          currentFolderId={note.folderId}
          onMove={(folderId) => {
            setMenuOpen(false);
            onMove(note.id, folderId);
          }}
        />
      )}
    </div>
  );
}


interface RowDropdownProps {
  isLocal: boolean;
  published: boolean;
  encrypted: boolean;
  folders: Folder[];
  currentFolderId: string | null | undefined;
  onSyncToCloud: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onEncrypt: () => void;
  onDelete: () => void;
  onMove: (folderId: string | null) => void;
}

function RowDropdown({ isLocal, published, encrypted, folders, currentFolderId, onSyncToCloud, onPublish, onUnpublish, onEncrypt, onDelete, onMove }: RowDropdownProps) {
  return (
    <div
      className="fadein"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 'calc(100% - 4px)',
        right: 8,
        zIndex: 30,
        minWidth: 200,
        padding: 6,
        borderRadius: 10,
        background: 'rgba(20,20,22,0.96)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        animationDuration: '140ms',
      }}
    >
      {isLocal ? (
        <>
          <DropdownLabel>Sync</DropdownLabel>
          <DropdownItem
            icon={<LinkIcon />}
            label="Sync to cloud"
            onClick={onSyncToCloud}
          />
          <DropdownDivider />
        </>
      ) : (
        <>
          <DropdownLabel>Publishing</DropdownLabel>
          <DropdownItem
            icon={<LinkIcon />}
            label={published ? 'Copy public link' : 'Publish to web'}
            onClick={onPublish}
          />
          {published && (
            <DropdownItem
              icon={<UnlinkIcon />}
              label="Unpublish"
              onClick={onUnpublish}
            />
          )}
          <DropdownDivider />
          {/* Encrypt menu item — переехал из row-icon'а сюда. Lock-icon в row
              теперь зеркалит publish-state (red/green), encryption — это
              отдельная concept (E2E vault), её action скрыли в menu. */}
          {!encrypted && (
            <>
              <DropdownLabel>Privacy</DropdownLabel>
              <DropdownItem
                icon={<EncryptIcon />}
                label="Encrypt note (Vault)"
                onClick={onEncrypt}
              />
              <DropdownDivider />
            </>
          )}
          {encrypted && (
            <>
              <DropdownLabel>Privacy</DropdownLabel>
              <DropdownItem
                icon={<EncryptIcon />}
                label="Encrypted (E2E)"
                disabled
                onClick={() => {}}
              />
              <DropdownDivider />
            </>
          )}
        </>
      )}
      {folders.length > 0 && (
        <>
          <DropdownDivider />
          <DropdownLabel>Move to folder</DropdownLabel>
          {currentFolderId && (
            <DropdownItem
              icon={<FolderIcon />}
              label="Unfiled"
              onClick={() => onMove(null)}
            />
          )}
          {folders.map((f) => (
            <DropdownItem
              key={f.id}
              icon={<FolderIcon />}
              label={f.name}
              disabled={f.id === currentFolderId}
              onClick={() => onMove(f.id)}
            />
          ))}
        </>
      )}
      <DropdownDivider />
      <DropdownItem
        icon={<TrashIcon />}
        label="Delete Note"
        onClick={onDelete}
        danger
      />
    </div>
  );
}

function DropdownLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mono"
      style={{
        fontSize: 9,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--ink-40)',
        padding: '6px 10px 4px',
      }}
    >
      {children}
    </div>
  );
}

function DropdownItem({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => !disabled && setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 10px',
        background: disabled
          ? 'transparent'
          : hover
            ? danger
              ? 'rgba(255,80,80,0.10)'
              : 'rgba(255,255,255,0.06)'
            : 'transparent',
        border: 'none',
        borderRadius: 6,
        color: disabled
          ? 'var(--ink-40)'
          : danger
            ? '#ff6a6a'
            : hover
              ? 'var(--ink)'
              : 'var(--ink-90)',
        fontSize: 13,
        cursor: disabled ? 'default' : 'pointer',
        textAlign: 'left',
        opacity: disabled ? 0.6 : 1,
        transition: 'background-color 140ms ease, color 140ms ease',
      }}
    >
      <span style={{ display: 'inline-flex', color: 'inherit' }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function EncryptIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      <circle cx="12" cy="16" r="1" fill="currentColor" />
    </svg>
  );
}

function DropdownDivider() {
  return (
    <div
      style={{
        margin: '4px 6px',
        height: 1,
        background: 'rgba(255,255,255,0.06)',
      }}
    />
  );
}

function LinkIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function UnlinkIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.71 1.71" />
      <path d="M5.16 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.72-1.71" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function FolderIcon({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// ─── Editor pane ──────────────────────────────────────────────────────────

interface EditorProps {
  list: ListState;
  active: Note | null;
  activeError: string | null;
  draftTitle: string;
  draftBody: string;
  // C-7: encrypted-режим — если true, ActiveEditor показывает либо
  // decrypted body (если vault unlocked) либо locked-placeholder.
  encrypted: boolean;
  saveStatus: 'idle' | 'saving' | 'saved';
  folders: Folder[];
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onCreate: () => void;
}

const EDITOR_WIDTH_KEY = 'hone:notes:editor-width';
// Notion/Obsidian-style: широкая колонка по дефолту, юзер сам режет
// resize-handle'ом если хочет уже. 1100px ~ Notion default text-column на
// laptop-screen'е.
const EDITOR_WIDTH_DEFAULT = 1100;
const EDITOR_WIDTH_MIN = 560;

function Editor({ list, active, activeError, draftTitle, draftBody, encrypted, saveStatus, folders, onTitleChange, onBodyChange, onCreate }: EditorProps) {
  const [hover, setHover] = useState(false);
  // Editor max-width — drag-resizable, persisted в localStorage. Range
  // [500 .. (window.innerWidth - 80)] (clamp в onMove). Hand-rolled drag
  // (mouse-down → window:mousemove/up listeners) — mirror of sidebar
  // ResizeHandle для consistency.
  const [editorWidth, setEditorWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return EDITOR_WIDTH_DEFAULT;
    const raw = window.localStorage.getItem(EDITOR_WIDTH_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n)) return EDITOR_WIDTH_DEFAULT;
    return Math.max(EDITOR_WIDTH_MIN, n);
  });
  const widthDragRef = useRef<{ startX: number; startW: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = widthDragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const next = Math.max(
        EDITOR_WIDTH_MIN,
        Math.min(d.startW + dx * 2, window.innerWidth - 80),
      );
      setEditorWidth(next);
    };
    const onUp = () => {
      if (widthDragRef.current === null) return;
      widthDragRef.current = null;
      document.body.style.userSelect = '';
      try {
        window.localStorage.setItem(EDITOR_WIDTH_KEY, String(editorWidth));
      } catch {
        /* ignore quota */
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [editorWidth]);
  return (
    <section
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        // Notion-style: вертикальный воздух щедрый, горизонтальные паддинги
        // умеренные (32px) — текстовая колонка центрируется через max-width
        // на ActiveEditor. Раньше было 80px с двух сторон + max-width 900 →
        // на 1920-экране контент жался к центру слишком плотно.
        padding: '56px 32px 24px 32px',
        overflowY: 'auto',
        minWidth: 0,
      }}
    >
      {list.status === 'error' ? (
        <ErrorPane message={list.error ?? ''} code={list.errorCode} />
      ) : !active && list.status === 'ok' && list.notes.length === 0 ? (
        <EmptyState onCreate={onCreate} />
      ) : !active ? (
        <EmptyState onCreate={onCreate} dim />
      ) : encrypted ? (
        <EncryptedEditorView
          key={active.id}
          ciphertextBase64={active.bodyMd}
          title={draftTitle}
          folderName={active.folderId ? (folders.find((f) => f.id === active.folderId)?.name ?? null) : null}
          onTitleChange={onTitleChange}
          onBodyChange={onBodyChange}
          editorWidth={editorWidth}
        />
      ) : (
        <ActiveEditor
          key={active.id}
          noteId={active.id}
          title={draftTitle}
          body={draftBody}
          folderName={active.folderId ? (folders.find((f) => f.id === active.folderId)?.name ?? null) : null}
          onTitleChange={onTitleChange}
          onBodyChange={onBodyChange}
          editorWidth={editorWidth}
        />
      )}

      {/* Right-edge drag handle. Visible only on hover, как sidebar
       *  ResizeHandle. Clamp positioning сам внутри handler'а. */}
      <div
        onMouseDown={(e) => {
          widthDragRef.current = { startX: e.clientX, startW: editorWidth };
          document.body.style.userSelect = 'none';
        }}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: 8,
          cursor: 'col-resize',
          userSelect: 'none',
          opacity: hover ? 1 : 0,
          transition: 'opacity 200ms ease',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 3,
            width: 2,
            background: 'rgba(255,255,255,0.15)',
          }}
        />
      </div>

      {/* Bottom-right indicators */}
      {active && (
        <div
          className="mono"
          style={{
            position: 'absolute',
            bottom: 14,
            right: 24,
            fontSize: 10,
            color: 'var(--ink-40)',
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            opacity: hover ? 1 : 0.4,
            transition: 'opacity 220ms ease',
          }}
        >
          <SaveStatusIndicator status={saveStatus} />
          <span>{formatTime(active.updatedAt)}</span>
        </div>
      )}

      {activeError && (
        <p
          className="mono"
          style={{
            position: 'absolute',
            bottom: 30,
            left: 80,
            fontSize: 10,
            color: '#ff6a6a',
          }}
        >
          {activeError}
        </p>
      )}
    </section>
  );
}

function ActiveEditor({
  noteId,
  title,
  body,
  folderName,
  onTitleChange,
  onBodyChange,
  editorWidth,
}: {
  noteId: string;
  title: string;
  body: string;
  folderName: string | null;
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  editorWidth: number;
}) {
  return (
    <div className="fadein" style={{ animationDuration: '180ms', maxWidth: editorWidth, margin: '0 auto' }}>
      {folderName && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          marginBottom: 14,
          fontSize: 11.5,
          color: 'var(--ink-40)',
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: '0.02em',
        }}>
          <FolderIcon />
          <span>{folderName}</span>
        </div>
      )}
      <input
        className="hone-notes-title"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Untitled"
        autoFocus={!title}
        style={{
          width: '100%',
          fontSize: 44,
          fontWeight: 700,
          letterSpacing: '-0.03em',
          lineHeight: 1.15,
          padding: '0 0 20px',
          background: 'transparent',
          color: 'var(--ink)',
          border: 'none',
          outline: 'none',
        }}
      />
      <div style={{ marginTop: 0, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 20 }}>
        {noteId.startsWith('temp:') ? (
          // Optimistic create в полёте — yjs endpoints 404'нут на
          // несуществующий note_id. Используем legacy textarea на этот
          // короткий период (handleCreate подменит id на real → key
          // re-mount → MilkdownEditor поднимется).
          <RichMarkdownEditor
            value={body}
            onChange={onBodyChange}
            placeholder="Write your thoughts…"
          />
        ) : (
          <MilkdownEditor
            noteId={noteId}
            seedBodyMD={body}
            placeholder="Write your thoughts…"
            onTextChange={onBodyChange}
            localOnly={isLocalNoteId(noteId)}
          />
        )}
      </div>
    </div>
  );
}

function EmptyState({ onCreate, dim = false }: { onCreate: () => void; dim?: boolean }) {
  return (
    <div
      className="fadein"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 400,
        gap: 14,
        opacity: dim ? 0.7 : 1,
      }}
    >
      <p style={{ fontSize: 14, color: 'var(--ink-40)', margin: 0 }}>
        {dim ? 'Pick a note or' : 'No notes yet —'} press <Kbd>⌘N</Kbd> to write.
      </p>
      <button
        onClick={onCreate}
        className="focus-ring"
        style={{
          padding: '9px 18px',
          fontSize: 13,
          fontWeight: 500,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'var(--ink-90)',
          cursor: 'pointer',
          transition: 'background-color 180ms ease, color 180ms ease, transform 180ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
          e.currentTarget.style.color = 'var(--ink)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          e.currentTarget.style.color = 'var(--ink-90)';
        }}
      >
        + New note
      </button>
    </div>
  );
}

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        cursor: 'col-resize',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 2,
          top: 0,
          bottom: 0,
          width: 2,
          background: hover ? 'rgba(255,255,255,0.15)' : 'transparent',
          transition: 'background-color 180ms ease',
        }}
      />
    </div>
  );
}

function Toast({ text }: { text: string }) {
  return (
    <div
      className="fadein"
      style={{
        position: 'fixed',
        // Поднимаем над Dock'ом (Dock у нас bottom: 36, ~36px высотой =
        // занимает 36..72). Раньше Toast был на bottom: 32 → перекрывался
        // с Dock'ом, юзер не видел уведомление "Synced to cloud" —
        // прятался за timer-капсулой.
        bottom: 96,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 80,
        padding: '10px 16px',
        background: 'rgba(20,20,22,0.96)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10,
        color: 'var(--ink)',
        fontSize: 13,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        animationDuration: '180ms',
      }}
    >
      {text}
    </div>
  );
}

// ─── Connections panel (unchanged from previous) ──────────────────────────

interface ConnectionsPanelProps {
  noteId: string;
  onClose: () => void;
  onPick: (id: string) => void;
}

function ConnectionsPanel({ noteId, onClose, onPick }: ConnectionsPanelProps) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [items, setItems] = useState<NoteConnection[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const acc: NoteConnection[] = [];
    setStatus('loading');
    setItems([]);
    getNoteConnectionsStream(noteId, (c) => {
      if (cancelled) return;
      acc.push(c);
      setItems([...acc]);
    })
      .then(() => {
        if (!cancelled) setStatus('ok');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const ce = ConnectError.from(e);
        setErr(ce.rawMessage || ce.message);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 55,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          height: '100%',
          background: 'rgba(8,8,8,0.96)',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          padding: '90px 28px 40px',
          overflowY: 'auto',
        }}
      >
        <div className="mono" style={{ fontSize: 10, letterSpacing: '.24em', color: 'var(--ink-40)' }}>
          CONNECTIONS {status === 'loading' && '· STREAMING…'}
        </div>
        <h3 style={{ margin: '10px 0 24px', fontSize: 22, fontWeight: 400, letterSpacing: '-0.015em' }}>
          What this note relates to.
        </h3>

        {status === 'error' && (
          <p style={{ fontSize: 13, color: 'var(--ink-60)' }}>
            {err?.includes('embedding') ? 'Embeddings not available yet.' : err}
          </p>
        )}
        {status === 'ok' && items.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--ink-60)' }}>
            Nothing above the similarity floor yet. Write a few more notes.
          </p>
        )}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((c, i) => (
            <li key={`${c.kind}:${c.targetId}:${i}`} style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <button
                onClick={() => (c.kind === 'note' ? onPick(c.targetId) : undefined)}
                className="focus-ring"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  cursor: c.kind === 'note' ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>
                    {c.displayTitle || '(untitled)'}
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-40)', flexShrink: 0 }}>
                    {c.kind.toUpperCase()} · {(c.similarity * 100).toFixed(0)}%
                  </span>
                </div>
                {c.snippet && (
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-60)', lineHeight: 1.5 }}>
                    {c.snippet}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="mono" style={{ marginTop: 20, fontSize: 10, color: 'var(--ink-40)', letterSpacing: '.12em' }}>
          ESC TO CLOSE
        </div>
      </aside>
    </div>
  );
}

function ErrorPane({ message, code }: { message: string; code: Code | null }) {
  let headline = 'Notes offline.';
  if (code === Code.Unauthenticated) headline = 'Sign in to view notes.';
  return (
    <div>
      <p style={{ fontSize: 14, color: 'var(--ink-60)' }}>{headline}</p>
      {message && (
        <p className="mono" style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-40)' }}>
          {message}
        </p>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatTime(d: string | Date | null | undefined): string {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (!Number.isFinite(dt.getTime())) return '';
  const today = new Date();
  const sameDay =
    dt.getFullYear() === today.getFullYear() &&
    dt.getMonth() === today.getMonth() &&
    dt.getDate() === today.getDate();
  if (sameDay) {
    return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  return dt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Encrypted editor view (Phase C-7) ────────────────────────────────────
//
// active.bodyMd для encrypted notes содержит base64(IV || ciphertext).
// Поведение:
//   - Vault unlocked → декриптуем при mount и предоставляем editable
//     plaintext через onBodyChange. Save-path в parent перенаправит на
//     /vault/notes/{id}/encrypt вместо обычного UpdateNote.
//   - Vault locked → показываем placeholder с «Unlock vault» button.
//     Editor disabled — без key мы не можем re-encrypt user input
//     осмысленно (новый text был бы записан plaintext'ом и сломал
//     encryption гарантии).
//   - Decrypt failed (corrupt ciphertext / tampered) → error banner.

function EncryptedEditorView({
  ciphertextBase64,
  title,
  folderName,
  onTitleChange,
  onBodyChange,
  editorWidth,
}: {
  ciphertextBase64: string;
  title: string;
  folderName: string | null;
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  editorWidth: number;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  // Подписываемся на vault state — если юзер unlock'нет где-то ещё
  // (Settings), мы автоматически попробуем decrypt.
  useEffect(() => {
    let live = true;
    let unsub: (() => void) | null = null;
    void import('../api/vault').then(({ isUnlocked: vaultUnlocked, subscribe }) => {
      if (!live) return;
      setUnlocked(vaultUnlocked());
      unsub = subscribe((u) => {
        if (live) setUnlocked(u);
      });
    });
    return () => {
      live = false;
      if (unsub) unsub();
    };
  }, []);

  // Decrypt при unlock'е или при смене ciphertext'а (e.g. SSE pull
  // подтянул свежее значение от другого девайса).
  //
  // Empty/short ciphertext = fresh note (auto-encrypt'нул backend на
  // create, но client'ский active.bodyMd ещё не подхватил ciphertext) или
  // legacy untouched note. В этом случае treat'аем как empty plaintext —
  // юзер начинает с пустого редактора. Save-path всё равно re-encrypt'ит.
  useEffect(() => {
    if (!unlocked) {
      setPlaintext(null);
      return;
    }
    if (!ciphertextBase64 || ciphertextBase64.length < 20) {
      // Fresh / empty encrypted note: skip decrypt, render empty editor.
      setPlaintext('');
      onBodyChange('');
      return;
    }
    let cancelled = false;
    setError(null);
    void import('../api/vault').then(({ decryptText }) => {
      decryptText(ciphertextBase64)
        .then((pt) => {
          if (cancelled) return;
          setPlaintext(pt);
          // Поднимаем decrypted body наверх как «draft» — parent'ская
          // autosave увидит изменение, но re-encrypt path в parent'е
          // сначала снова encrypt'ит перед POST'ом (см. handleSaveActive
          // в NotesPage).
          onBodyChange(pt);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setError((e as Error).message);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [unlocked, ciphertextBase64, onBodyChange]);

  if (!unlocked) {
    return (
      <div
        className="fadein"
        style={{
          maxWidth: editorWidth,
          margin: '0 auto',
          paddingTop: 60,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          alignItems: 'flex-start',
        }}
      >
        {folderName && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            marginBottom: 14,
            fontSize: 11.5,
            color: 'var(--ink-40)',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.02em',
          }}>
            <FolderIcon />
            <span>{folderName}</span>
          </div>
        )}
        <input
          className="hone-notes-title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled"
          style={{
            width: '100%',
            fontSize: 44,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.15,
            padding: '0 0 20px',
            background: 'transparent',
            color: 'var(--ink-40)',
            border: 'none',
            outline: 'none',
          }}
          readOnly
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 18px',
            borderRadius: 12,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--ink-10)',
          }}
        >
          <span
            style={{
              width: 36,
              height: 36,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
              color: 'var(--ink-60)',
            }}
          >
            <svg
              width={18}
              height={18}
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" />
            </svg>
          </span>
          <div style={{ flex: 1, fontSize: 13.5, color: 'var(--ink-90)' }}>
            <div style={{ marginBottom: 2 }}>This note is encrypted</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-60)' }}>
              Unlock Vault with your password to read or edit it.
            </div>
          </div>
        </div>
        <button
          type="button"
          disabled={unlocking}
          onClick={async () => {
            const pwd = window.prompt('Vault password:');
            if (!pwd) return;
            setUnlocking(true);
            try {
              const { unlockVault } = await import('../api/vault');
              await unlockVault(pwd);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setUnlocking(false);
            }
          }}
          className="focus-ring"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 500,
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid var(--ink-20)',
            borderRadius: 999,
            color: 'var(--ink-90)',
            cursor: unlocking ? 'default' : 'pointer',
            opacity: unlocking ? 0.6 : 1,
          }}
        >
          {unlocking ? 'Unlocking…' : 'Unlock Vault'}
        </button>
        {error ? (
          <div style={{ fontSize: 12, color: '#ff6a6a' }}>{error}</div>
        ) : null}
      </div>
    );
  }

  if (plaintext === null) {
    // unlocked, но decrypt ещё в полёте (или упал)
    return (
      <div
        style={{ maxWidth: editorWidth, margin: '0 auto', paddingTop: 100, color: 'var(--ink-40)', fontSize: 13 }}
      >
        {error ?? 'Decrypting…'}
      </div>
    );
  }

  // unlocked + decrypted → обычный editor поверх plaintext'а
  return (
    <div className="fadein" style={{ animationDuration: '180ms', maxWidth: editorWidth, margin: '0 auto' }}>
      {folderName && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          marginBottom: 14,
          fontSize: 11.5,
          color: 'var(--ink-40)',
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: '0.02em',
        }}>
          <FolderIcon />
          <span>{folderName}</span>
        </div>
      )}
      <input
        className="hone-notes-title"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Untitled"
        autoFocus={!title}
        style={{
          width: '100%',
          fontSize: 44,
          fontWeight: 700,
          letterSpacing: '-0.03em',
          lineHeight: 1.15,
          padding: '0 0 20px',
          background: 'transparent',
          color: 'var(--ink)',
          border: 'none',
          outline: 'none',
        }}
      />
      <div style={{ marginTop: 0, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 20 }}>
        <RichMarkdownEditor
          value={plaintext}
          onChange={(v) => {
            setPlaintext(v);
            onBodyChange(v);
          }}
          placeholder="Encrypted note — your edits stay encrypted."
        />
      </div>
    </div>
  );
}

// SaveStatusIndicator — мелкий fade-text справа внизу. 'idle' → пусто
// (минимум noise), 'saving' → 'Saving…', 'saved' → 'Saved' на 1.2s.
function SaveStatusIndicator({ status }: { status: 'idle' | 'saving' | 'saved' }) {
  if (status === 'idle') return null;
  return (
    <span
      style={{
        color: status === 'saved' ? 'rgba(127, 212, 155, 0.85)' : 'var(--ink-60)',
        transition: 'color 220ms ease, opacity 220ms ease',
      }}
    >
      {status === 'saving' ? 'Saving…' : 'Saved'}
    </span>
  );
}
