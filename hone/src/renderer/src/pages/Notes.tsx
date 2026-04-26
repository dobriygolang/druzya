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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  getNoteConnectionsStream,
  type Note,
  type NoteConnection,
  type NoteSummary,
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
}

export function NotesPage({ initialSelectedId, onConsumeInitial }: NotesPageProps = {}) {
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
            ? { id: n.id, title: n.title, updatedAt: n.updatedAt, sizeBytes: n.sizeBytes }
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
      // Используем functional setSelectedId с inspection через setList
      // чтобы избежать stale closure'а на selectedId. Closure'нем через
      // отдельный set: если deleted == текущий, выбрать первый оставшийся.
      setSelectedId((cur) => {
        if (cur !== id) return cur;
        // Выбираем next через свежий list (после filter уже применён) —
        // но setSelectedId имеет prev-only signature. Достаём актуальный
        // notes снова через setList с identity-функцией и captured ref.
        // Trick: nested setList возвращает свежее состояние synchronously
        // в React 18+ (microtask boundary), но безопаснее обратиться к
        // listRef обновляемой через каждый setList.
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
            ? { id: created.id, title: created.title, updatedAt: created.updatedAt, sizeBytes: created.sizeBytes }
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
          onSelect={onSelectNote}
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

      <Editor
        list={list}
        active={active}
        activeError={activeError}
        draftTitle={draftTitle}
        draftBody={draftBody}
        encrypted={!!(active && metaMap.get(active.id)?.encrypted)}
        saveStatus={saveStatus}
        onTitleChange={setDraftTitle}
        onBodyChange={setDraftBody}
        onCreate={handleCreate}
      />

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
  onSelect: (id: string) => void;
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

function SidebarImpl({ list, selectedId, metaMap, onSelect, onCreate, onDelete, onPublish, onUnpublish, onEncrypt, onSyncToCloud, onToggleCollapse }: SidebarProps) {
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
        count={list.notes.length}
        status={list.status}
        onCreate={onCreate}
        onToggleCollapse={onToggleCollapse}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 2px' }}>
        {list.notes.map((n) => {
          const meta = metaMap.get(n.id);
          return (
            <NoteRow
              key={n.id}
              note={n}
              active={selectedId === n.id}
              encrypted={meta?.encrypted ?? false}
              onSelect={onSelect}
              onDelete={onDelete}
              onPublish={onPublish}
              onUnpublish={onUnpublish}
              onEncrypt={onEncrypt}
              onSyncToCloud={onSyncToCloud}
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
  count,
  status,
  onCreate,
  onToggleCollapse,
}: {
  count: number;
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
        className="mono"
        style={{
          flex: 1,
          fontSize: 10,
          letterSpacing: '0.2em',
          color: 'var(--ink-40)',
          textTransform: 'uppercase',
        }}
      >
        {status === 'loading' ? 'Loading' : status === 'error' ? 'Offline' : `Notes · ${count}`}
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

// ─── NoteRow with three-dots menu ─────────────────────────────────────────

interface NoteRowProps {
  note: NoteSummary;
  active: boolean;
  encrypted: boolean;
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
    prev.onSelect === next.onSelect &&
    prev.onDelete === next.onDelete &&
    prev.onPublish === next.onPublish &&
    prev.onUnpublish === next.onUnpublish &&
    prev.onEncrypt === next.onEncrypt &&
    prev.onSyncToCloud === next.onSyncToCloud
  );
});

function NoteRowImpl({ note, active, encrypted, onSelect, onDelete, onPublish, onUnpublish, onEncrypt, onSyncToCloud }: NoteRowProps) {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pubStatus, setPubStatus] = useState<PublishStatus | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const isLocal = isLocalNoteId(note.id);
  // Lazy-load publish status on first hover (cheap idempotent fetch).
  // Local notes никогда не на бэкенде → skip.
  useEffect(() => {
    if (isLocal || !hover || pubStatus) return;
    let live = true;
    void getPublishStatus(note.id)
      .then((s) => {
        if (live) setPubStatus(s);
      })
      .catch(() => {
        /* silent */
      });
    return () => {
      live = false;
    };
  }, [hover, pubStatus, note.id, isLocal]);

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
        padding: '8px 10px 8px 12px',
        margin: '1px 0',
        borderRadius: 7,
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
      <NoteIcon />
      <span
        style={{
          flex: 1,
          fontSize: 13.5,
          color: active ? 'var(--ink)' : 'var(--ink-60)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          transition: 'color 160ms ease',
        }}
      >
        {note.title || 'Untitled'}
      </span>

      {/* Last updated tooltip — fade in при hover, fade out плавно */}
      <span
        className="mono"
        style={{
          fontSize: 10,
          color: 'var(--ink-40)',
          opacity: hover && !menuOpen ? 1 : 0,
          transition: 'opacity 180ms ease',
          pointerEvents: 'none',
          flexShrink: 0,
        }}
      >
        {lastUpd}
      </span>

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
      ) : encrypted ? (
        <span
          title="Encrypted — open to decrypt"
          style={{
            width: 22,
            height: 22,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--ink-60)',
            flexShrink: 0,
            pointerEvents: 'none', // открытие через row.onClick
          }}
        >
          <svg
            width={13}
            height={13}
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
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEncrypt(note.id);
          }}
          className="focus-ring"
          title="Encrypt this note (requires Vault password)"
          style={{
            width: 22,
            height: 22,
            display: 'grid',
            placeItems: 'center',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--ink-60)',
            borderRadius: 5,
            opacity: hover || menuOpen ? 1 : 0,
            transition:
              'opacity 180ms ease, background-color 160ms ease, color 160ms ease',
            flexShrink: 0,
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
          <svg
            width={13}
            height={13}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </button>
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
          onSyncToCloud={() => {
            setMenuOpen(false);
            onSyncToCloud(note.id);
          }}
          onPublish={() => {
            setMenuOpen(false);
            onPublish(note.id);
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
        />
      )}
    </div>
  );
}

function NoteIcon() {
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
      style={{ color: 'var(--ink-40)', flexShrink: 0 }}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

interface RowDropdownProps {
  isLocal: boolean;
  published: boolean;
  onSyncToCloud: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
}

function RowDropdown({ isLocal, published, onSyncToCloud, onPublish, onUnpublish, onDelete }: RowDropdownProps) {
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
        </>
      )}
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
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 10px',
        background: hover ? (danger ? 'rgba(255,80,80,0.10)' : 'rgba(255,255,255,0.06)') : 'transparent',
        border: 'none',
        borderRadius: 6,
        color: danger ? '#ff6a6a' : hover ? 'var(--ink)' : 'var(--ink-90)',
        fontSize: 13,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background-color 140ms ease, color 140ms ease',
      }}
    >
      <span style={{ display: 'inline-flex', color: 'inherit' }}>{icon}</span>
      <span>{label}</span>
    </button>
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
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onCreate: () => void;
}

const EDITOR_WIDTH_KEY = 'hone:notes:editor-width';
const EDITOR_WIDTH_DEFAULT = 760;
const EDITOR_WIDTH_MIN = 500;

function Editor({ list, active, activeError, draftTitle, draftBody, encrypted, saveStatus, onTitleChange, onBodyChange, onCreate }: EditorProps) {
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
        // Левый padding ужат с 80→48 (~40% reduction по запросу). Right
        // оставлен 80 — нужен запас под right-side three-dots / connections
        // affordance'ы. Vertical 24 без изменений.
        padding: '24px 80px 24px 48px',
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
          <span>⌘J for connections</span>
          <span>Last updated: {formatTime(active.updatedAt)}</span>
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
  onTitleChange,
  onBodyChange,
  editorWidth,
}: {
  noteId: string;
  title: string;
  // body — initial seed для Yjs Y.Text (если server log пуст). Parent
  // обновляет body когда переключается note (key={note.id} re-mount'ит
  // ActiveEditor); ytext дальше становится source of truth, body не
  // трогаем во время editing-session'а.
  body: string;
  onTitleChange: (v: string) => void;
  // Срабатывает на каждый ytext change (local OR remote applyUpdate).
  // Parent держит draftBody → debounced flushNow материализует
  // body_md на сервере через UpdateNote (для embedding/RAG/publish).
  onBodyChange: (v: string) => void;
  /** Drag-resizable editor max-width — controlled parent'ом (Editor),
   *  persisted в localStorage. */
  editorWidth: number;
}) {
  return (
    <div className="fadein" style={{ animationDuration: '180ms', maxWidth: editorWidth, margin: '0 auto' }}>
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Untitled"
        autoFocus={!title}
        style={{
          width: '100%',
          fontSize: 36,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          padding: '4px 0 12px',
          background: 'transparent',
          color: 'var(--ink)',
          border: 'none',
          outline: 'none',
        }}
      />
      <div style={{ marginTop: 8 }}>
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
  onTitleChange,
  onBodyChange,
  editorWidth,
}: {
  ciphertextBase64: string;
  title: string;
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
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled"
          style={{
            width: '100%',
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            padding: '4px 0 12px',
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
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Untitled"
        autoFocus={!title}
        style={{
          width: '100%',
          fontSize: 36,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          padding: '4px 0 12px',
          background: 'transparent',
          color: 'var(--ink)',
          border: 'none',
          outline: 'none',
        }}
      />
      <div style={{ marginTop: 8 }}>
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
