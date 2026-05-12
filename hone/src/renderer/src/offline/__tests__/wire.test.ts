// wire.test.ts — verifies каждый registered executor через wire.ts:
//   1. Calls correct RPC wrapper / fetch с правильным URL + idempotency header
//   2. Translates outbox row → RPC payload без потери fields
//   3. Surface'ит rpcError'ы с правильным nonRetryable flag'ом
//
// Mocking strategy: vi.mock на каждом импорте wire.ts чтобы не тянуть
// весь Connect-RPC + transport (которые требуют живой backend / session
// store / device-id). Вместо этого даём wire.ts stub'ы api/* модулей с
// vi.fn() handlers'ами. Для fetch-based ops (editor.create_room, resource.*,
// external_activity.log, reflection.submit) глобальный `fetch` mock'ается.
//
// Что не тестим:
//   • Конкретный JSON shape backend response'а (мы парс'им только id) —
//     это договор контракта, не unit-test'а.
//   • Connect-RPC encoding (binary proto vs JSON) — это responsibility
//     библиотеки.
//   • ConflictModal UI rendering — это рендеринг-тест, не unit.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Mock chain ─────────────────────────────────────────────────────────
// vi.mock'и hoisted к top of file (Vitest заменяет на actual imports).
//
// session store нужен для authHeaders(): получает accessToken.
vi.mock('../../stores/session', () => ({
  useSessionStore: {
    getState: () => ({ accessToken: 'test-token' }),
  },
}));

// api/config — DEV_BEARER_TOKEN+API_BASE_URL. Захардкоженный API_BASE_URL
// нужен потому что без него wire.ts строит fetch URL'ы с `undefined`.
vi.mock('../../api/config', () => ({
  API_BASE_URL: 'http://test-api',
  DEV_BEARER_TOKEN: null,
  WEB_BASE_URL: 'http://test-web',
  PRO_UPGRADE_URL_BASE: 'http://test-upgrade',
  PRO_BYOK_URL: 'http://test-byok',
}));

// api/editor.setEditorRoomVisibility — wire.ts вызывает напрямую.
const editorSetVisibility = vi.fn().mockResolvedValue('private');
vi.mock('../../api/editor', () => ({
  setEditorRoomVisibility: (...args: unknown[]) => editorSetVisibility(...args),
  // Stub дополнительных exports чтобы tree-shake не упал.
  b64ToBytes: vi.fn(),
  bytesToB64: vi.fn(),
}));

// api/whiteboard.setRoomVisibility.
const whiteboardSetVisibility = vi.fn().mockResolvedValue('private');
vi.mock('../../api/whiteboard', () => ({
  setRoomVisibility: (...args: unknown[]) => whiteboardSetVisibility(...args),
}));

// api/hone.endFocusSession.
const endFocusSessionMock = vi.fn().mockResolvedValue({ sessionId: 's1' });
vi.mock('../../api/hone', () => ({
  endFocusSession: (...args: unknown[]) => endFocusSessionMock(...args),
}));

// api/intelligence.saveFocusReflection.
const saveFocusReflectionMock = vi.fn().mockResolvedValue({ reflectionId: 'r1' });
vi.mock('../../api/intelligence', () => ({
  saveFocusReflection: (...args: unknown[]) => saveFocusReflectionMock(...args),
}));

// components/ConflictModal.emitConflict — не вызывается в success path'ах.
const emitConflictMock = vi.fn();
vi.mock('../../components/ConflictModal', () => ({
  emitConflict: (...args: unknown[]) => emitConflictMock(...args),
}));

// ─── Test helpers ───────────────────────────────────────────────────────

interface FetchCall {
  url: string;
  init: RequestInit;
}
let fetchCalls: FetchCall[] = [];
let fetchResponse: { ok: boolean; status: number; json?: unknown } = {
  ok: true,
  status: 200,
  json: { id: 'srv-1' },
};

function mockFetch(): void {
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(fetchResponse.json ?? {}), {
      status: fetchResponse.status,
      // Cast — minimal Response shape (no cookies / cache / etc).
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

async function loadWireAndOutbox(): Promise<{
  wire: typeof import('../wire');
  outbox: typeof import('../outbox');
}> {
  vi.resetModules();
  const outbox = await import('../outbox');
  const wire = await import('../wire');
  wire.wireOutboxExecutors();
  return { wire, outbox };
}

async function drainFor(
  outbox: typeof import('../outbox'),
  kind: import('../outbox').OutboxOpKind,
  payload: unknown,
): Promise<void> {
  await outbox.enqueue(kind, payload);
  await outbox.drainAll();
}

beforeEach(() => {
  fetchCalls = [];
  fetchResponse = { ok: true, status: 200, json: { id: 'srv-1' } };
  editorSetVisibility.mockResolvedValue('private');
  whiteboardSetVisibility.mockResolvedValue('private');
  endFocusSessionMock.mockResolvedValue({ sessionId: 's1' });
  saveFocusReflectionMock.mockResolvedValue({ reflectionId: 'r1' });
  emitConflictMock.mockReset();
  mockFetch();
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

afterEach(() => {
  delete (globalThis as { fetch?: typeof fetch }).fetch;
});

// ─── editor.create_room ─────────────────────────────────────────────────

describe('wire — editor.create_room', () => {
  it('POSTs JSON to /api/v1/editor/room с idempotency-key header', async () => {
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, 'editor.create_room', {
      clientId: 'cid-123',
      type: 'practice',
      language: 1,
    });

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0]!;
    expect(call.url).toBe('http://test-api/api/v1/editor/room');
    expect(call.init.method).toBe('POST');
    const headers = call.init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe('cid-123');
    expect(headers.authorization).toBe('Bearer test-token');
    expect(JSON.parse(call.init.body as string)).toEqual({ type: 'practice', language: 1 });
  });

  it('returns serverId из response для post-drain hook', async () => {
    fetchResponse = { ok: true, status: 200, json: { id: 'server-room-1' } };
    const { outbox } = await loadWireAndOutbox();
    const hook = vi.fn();
    outbox.registerPostDrainHook(hook);

    await drainFor(outbox, 'editor.create_room', {
      clientId: 'cid', type: 'practice', language: 1,
    });

    expect(hook).toHaveBeenCalledWith(
      'editor.create_room',
      expect.any(Object),
      { serverId: 'server-room-1' },
    );
  });

  it('5xx → throws retryable error (NOT dead immediately)', async () => {
    fetchResponse = { ok: false, status: 503, json: {} };
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, 'editor.create_room', {
      clientId: 'cid', type: 'practice', language: 1,
    });

    const all = await outbox.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.attempts).toBe(1);
    expect(all[0]?.dead).toBeFalsy();
    expect(all[0]?.lastError).toContain('503');
  });

  it('4xx (e.g. 403) → marks op dead-letter (nonRetryable)', async () => {
    fetchResponse = { ok: false, status: 403, json: {} };
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, 'editor.create_room', {
      clientId: 'cid', type: 'practice', language: 1,
    });

    const all = await outbox.listAll();
    expect(all[0]?.dead).toBe(true);
  });

  it('408 / 429 → retryable (rate-limit semantics)', async () => {
    fetchResponse = { ok: false, status: 429, json: {} };
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, 'editor.create_room', {
      clientId: 'cid', type: 'practice', language: 1,
    });

    const all = await outbox.listAll();
    expect(all[0]?.dead).toBeFalsy();
    expect(all[0]?.attempts).toBe(1);
  });
});

// ─── editor.set_visibility ──────────────────────────────────────────────

describe('wire — editor.set_visibility', () => {
  it('calls api.editor.setEditorRoomVisibility с правильными args', async () => {
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, 'editor.set_visibility', {
      roomId: 'room-A',
      visibility: 'shared',
    });

    expect(editorSetVisibility).toHaveBeenCalledWith('room-A', 'shared');
    expect(await outbox.listAll()).toHaveLength(0); // success → removed
  });

  it('error с status code extracted via regex (для retry classification)', async () => {
    editorSetVisibility.mockRejectedValueOnce(new Error('set visibility: 403'));
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, 'editor.set_visibility', {
      roomId: 'r', visibility: 'private',
    });

    const all = await outbox.listAll();
    // 403 → nonRetryable → dead.
    expect(all[0]?.dead).toBe(true);
  });
});

// ─── editor.delete_room ─────────────────────────────────────────────────

describe('wire — editor.delete_room', () => {
  it('DELETE /api/v1/editor/room/{id}', async () => {
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, 'editor.delete_room', { roomId: 'roomXYZ' });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe('http://test-api/api/v1/editor/room/roomXYZ');
    expect(fetchCalls[0]?.init.method).toBe('DELETE');
    expect(await outbox.listAll()).toHaveLength(0);
  });

  it('404 treated as success (idempotent delete)', async () => {
    fetchResponse = { ok: false, status: 404, json: {} };
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, 'editor.delete_room', { roomId: 'gone' });

    expect(await outbox.listAll()).toHaveLength(0); // не dead, removed
  });

  it('url-encodes roomId со spec'+'символами', async () => {
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, 'editor.delete_room', { roomId: 'room with/space' });

    expect(fetchCalls[0]?.url).toContain('room%20with%2Fspace');
  });
});

// ─── whiteboard.create_room ─────────────────────────────────────────────

describe('wire — whiteboard.create_room', () => {
  it('POSTs to /api/v1/whiteboard/room с idempotency-key', async () => {
    fetchResponse = { ok: true, status: 200, json: { id: 'wb-1' } };
    const { outbox } = await loadWireAndOutbox();
    const hook = vi.fn();
    outbox.registerPostDrainHook(hook);

    await drainFor(outbox, 'whiteboard.create_room', {
      clientId: 'wb-cid', type: 'shared', language: 0,
    });

    expect(fetchCalls[0]?.url).toBe('http://test-api/api/v1/whiteboard/room');
    expect((fetchCalls[0]?.init.headers as Record<string, string>)['idempotency-key']).toBe('wb-cid');
    expect(hook).toHaveBeenCalledWith(
      'whiteboard.create_room',
      expect.any(Object),
      { serverId: 'wb-1' },
    );
  });
});

// ─── whiteboard.delete_room ─────────────────────────────────────────────

describe('wire — whiteboard.delete_room', () => {
  it('DELETE с 404-as-success', async () => {
    fetchResponse = { ok: false, status: 404, json: {} };
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, 'whiteboard.delete_room', { roomId: 'wb-gone' });

    expect(await outbox.listAll()).toHaveLength(0);
  });
});

// ─── resource.* (curation Phase 3.5) ────────────────────────────────────

describe('wire — resource.add', () => {
  it('POSTs к /api/v1/curation/add-resource с op-id как idempotency key', async () => {
    const { outbox } = await loadWireAndOutbox();
    const opId = await outbox.enqueue('resource.add', {
      url: 'https://example.com/article',
      title: 'Test',
    });
    await outbox.drainAll();

    expect(fetchCalls[0]?.url).toBe('http://test-api/api/v1/curation/add-resource');
    expect((fetchCalls[0]?.init.headers as Record<string, string>)['idempotency-key']).toBe(opId);
    expect(JSON.parse(fetchCalls[0]?.init.body as string)).toEqual({
      url: 'https://example.com/article',
      title: 'Test',
    });
  });
});

describe('wire — resource.hide / resource.unhelpful / resource.replace', () => {
  it.each([
    ['resource.hide', 'hide-resource'],
    ['resource.unhelpful', 'mark-unhelpful'],
    ['resource.replace', 'replace-resource'],
  ] as const)('%s → POST to /api/v1/curation/%s', async (kind, endpoint) => {
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, kind, { resourceId: 'r1' });

    expect(fetchCalls[0]?.url).toBe(`http://test-api/api/v1/curation/${endpoint}`);
  });
});

// ─── reflection.submit (Phase 5a) ───────────────────────────────────────

describe('wire — reflection.submit', () => {
  it('POSTs к /api/v1/curation/reflection с idempotency-key=opId', async () => {
    const { outbox } = await loadWireAndOutbox();
    const opId = await outbox.enqueue('reflection.submit', {
      resourceId: 'r1',
      grade: 4,
      takeaways: ['useful'],
    });
    await outbox.drainAll();

    expect(fetchCalls[0]?.url).toBe('http://test-api/api/v1/curation/reflection');
    expect((fetchCalls[0]?.init.headers as Record<string, string>)['idempotency-key']).toBe(opId);
  });
});

// ─── focus.end (Phase A) ────────────────────────────────────────────────

describe('wire — focus.end', () => {
  it('calls api.hone.endFocusSession с полным payload'+'ом', async () => {
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, 'focus.end', {
      sessionId: 'sess-1',
      pomodorosCompleted: 3,
      secondsFocused: 1500,
      reflection: 'good run',
    });

    expect(endFocusSessionMock).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      pomodorosCompleted: 3,
      secondsFocused: 1500,
      reflection: 'good run',
    });
    expect(await outbox.listAll()).toHaveLength(0);
  });

  it('rejected → outbox bumps attempts', async () => {
    endFocusSessionMock.mockRejectedValueOnce(new Error('rpc fail'));
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, 'focus.end', {
      sessionId: 'sess', pomodorosCompleted: 0, secondsFocused: 0,
    });

    const all = await outbox.listAll();
    expect(all[0]?.attempts).toBe(1);
  });
});

// ─── external_activity.log (Phase 4) ────────────────────────────────────

describe('wire — external_activity.log', () => {
  it('POSTs к /api/v1/hone/external-activity', async () => {
    const { outbox } = await loadWireAndOutbox();
    const opId = await outbox.enqueue('external_activity.log', {
      source: 'codeforces',
      occurredAt: '2026-05-12T10:00:00Z',
      topic: 'binary-search',
    });
    await outbox.drainAll();

    expect(fetchCalls[0]?.url).toBe('http://test-api/api/v1/hone/external-activity');
    expect((fetchCalls[0]?.init.headers as Record<string, string>)['idempotency-key']).toBe(opId);
  });
});

// ─── focus.reflection (H2 Phase J) ──────────────────────────────────────

describe('wire — focus.reflection', () => {
  it('parses ISO timestamps обратно в Date перед RPC call', async () => {
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, 'focus.reflection', {
      sessionId: 'sess-X',
      focusMode: 'pomodoro',
      durationSeconds: 1500,
      grade: 5,
      notes: 'cleared chapter',
      taskPinned: 'task-1',
      startedAt: '2026-05-12T10:00:00.000Z',
      endedAt: '2026-05-12T10:25:00.000Z',
    });

    expect(saveFocusReflectionMock).toHaveBeenCalled();
    const [args] = saveFocusReflectionMock.mock.calls[0]!;
    const a = args as {
      sessionId: string;
      focusMode: string;
      startedAt: Date;
      endedAt: Date;
      taskPinned: string;
    };
    expect(a.sessionId).toBe('sess-X');
    expect(a.focusMode).toBe('pomodoro');
    expect(a.startedAt).toBeInstanceOf(Date);
    expect(a.endedAt).toBeInstanceOf(Date);
    expect(a.startedAt.toISOString()).toBe('2026-05-12T10:00:00.000Z');
    expect(a.taskPinned).toBe('task-1');
  });

  it('taskPinned defaults к "" если undefined', async () => {
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, 'focus.reflection', {
      sessionId: 'sess',
      focusMode: 'free',
      durationSeconds: 600,
      grade: 3,
      notes: '',
      startedAt: '2026-05-12T10:00:00.000Z',
      endedAt: '2026-05-12T10:10:00.000Z',
    });

    const [args] = saveFocusReflectionMock.mock.calls[0]!;
    expect((args as { taskPinned: string }).taskPinned).toBe('');
  });
});

// ─── 409 conflict — UI surface ──────────────────────────────────────────

describe('wire — 409 ConflictModal surface', () => {
  it('emitConflict вызывается на 409 с body.error.code=version_mismatch', async () => {
    fetchResponse = {
      ok: false,
      status: 409,
      json: {
        error: { code: 'version_mismatch', message: 'stale' },
        server: { some: 'state' },
      },
    };
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, 'editor.create_room', {
      clientId: 'c', type: 'practice', language: 1,
    });

    expect(emitConflictMock).toHaveBeenCalled();
    const call = emitConflictMock.mock.calls[0]![0] as {
      kind: string;
      id: string;
      local: { body: string };
      server: { body: string };
    };
    expect(call.kind).toBe('editor_room');
    expect(call.id).toBeDefined();
    expect(call.local.body).toContain('clientId');
    // Op marked dead-letter (409 = nonRetryable per rpcError logic).
    const all = await outbox.listAll();
    expect(all[0]?.dead).toBe(true);
  });

  it('emitConflict NOT called если 409 без version_mismatch code', async () => {
    fetchResponse = {
      ok: false,
      status: 409,
      json: { error: { code: 'other', message: 'duplicate' } },
    };
    const { outbox } = await loadWireAndOutbox();
    await drainFor(outbox, 'editor.create_room', {
      clientId: 'c', type: 'p', language: 1,
    });

    expect(emitConflictMock).not.toHaveBeenCalled();
    // Op still dead-letter (409 = 4xx = nonRetryable).
    const all = await outbox.listAll();
    expect(all[0]?.dead).toBe(true);
  });
});
