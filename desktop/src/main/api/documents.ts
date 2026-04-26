// Desktop-side wrapper for the documents service + session↔documents
// attach/detach. All plain REST under /api/v1. Auth is the user's Druz9
// JWT from the keychain, same as api/sessions.ts.
//
// Upload: the backend accepts content as base64 inside JSON (no
// multipart yet). The file bytes travel renderer → main (buffer) →
// base64 here. ≤10MB raw, per the server-side documents.MaxUploadBytes.

import { getValidSession } from '../auth/refresh';
import type { RuntimeConfig } from '../config/bootstrap';

export interface DocumentDTO {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sourceUrl: string;
  status: 'pending' | 'extracting' | 'embedding' | 'ready' | 'failed' | 'deleting';
  errorMessage: string;
  chunkCount: number;
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UploadInput {
  filename: string;
  mime: string;
  /** Raw bytes. The client base64-encodes before POST. */
  content: Uint8Array;
  sourceUrl?: string;
}

export interface ListResult {
  documents: DocumentDTO[];
  nextCursor: string;
}

export interface SearchHit {
  docId: string;
  chunkId: string;
  ord: number;
  score: number;
  content: string;
}

export interface DocumentsClient {
  list: (cursor: string, limit: number) => Promise<ListResult>;
  get: (id: string) => Promise<DocumentDTO>;
  upload: (input: UploadInput) => Promise<DocumentDTO>;
  uploadFromURL: (url: string) => Promise<DocumentDTO>;
  delete: (id: string) => Promise<void>;
  search: (docIds: string[], query: string, topK?: number) => Promise<SearchHit[]>;
  // Session attachment: server keeps a set-like array on the session row.
  attachToSession: (sessionId: string, docId: string) => Promise<void>;
  detachFromSession: (sessionId: string, docId: string) => Promise<void>;
  listAttachedToSession: (sessionId: string) => Promise<string[]>;
}

export function createDocumentsClient(cfg: RuntimeConfig): DocumentsClient {
  const url = (p: string) => `${cfg.apiBaseURL.replace(/\/+$/, '')}${p}`;

  const authHeaders = async (contentType = 'application/json'): Promise<Record<string, string>> => {
    const s = await getValidSession({ apiBaseURL: cfg.apiBaseURL });
    const h: Record<string, string> = { 'Content-Type': contentType };
    if (s) h.Authorization = `Bearer ${s.accessToken}`;
    return h;
  };

  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const resp = await fetch(url(path), {
      method,
      headers: await authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`${method} ${path}: ${resp.status} ${text.slice(0, 200)}`);
    }
    // 204 No Content — .json() would throw. Return undefined cast.
    if (resp.status === 204) return undefined as unknown as T;
    return (await resp.json()) as T;
  };

  // Translate snake_case → camelCase at the REST boundary so the
  // renderer sees a consistent shape.
  const fromRawDoc = (raw: Record<string, unknown>): DocumentDTO => ({
    id: String(raw.id ?? ''),
    filename: String(raw.filename ?? ''),
    mime: String(raw.mime ?? ''),
    sizeBytes: Number(raw.size_bytes ?? raw.sizeBytes ?? 0),
    sourceUrl: String(raw.source_url ?? raw.sourceUrl ?? ''),
    status: String(raw.status ?? 'pending') as DocumentDTO['status'],
    errorMessage: String(raw.error_message ?? raw.errorMessage ?? ''),
    chunkCount: Number(raw.chunk_count ?? raw.chunkCount ?? 0),
    tokenCount: Number(raw.token_count ?? raw.tokenCount ?? 0),
    createdAt: String(raw.created_at ?? raw.createdAt ?? ''),
    updatedAt: String(raw.updated_at ?? raw.updatedAt ?? ''),
  });

  return {
    list: async (cursor, limit) => {
      const q = new URLSearchParams();
      if (cursor) q.set('cursor', cursor);
      if (limit > 0) q.set('limit', String(limit));
      const suffix = q.toString();
      const raw = await call<Record<string, unknown>>(
        'GET',
        '/api/v1/documents' + (suffix ? '?' + suffix : ''),
      );
      const list = (raw.documents as Array<Record<string, unknown>>) ?? [];
      return {
        documents: list.map(fromRawDoc),
        nextCursor: String(raw.next_cursor ?? raw.nextCursor ?? ''),
      };
    },

    get: async (id) => {
      const raw = await call<Record<string, unknown>>('GET', `/api/v1/documents/${id}`);
      return fromRawDoc(raw);
    },

    upload: async (input) => {
      // Node 20 has a global Buffer; the preload sends us a Uint8Array
      // sliced from a browser ArrayBuffer. Converting via Buffer.from
      // is allocation-free for the view and produces standard base64
      // (not base64url — matches encoding/base64.StdEncoding on the
      // Go side).
      const b64 = Buffer.from(input.content).toString('base64');
      const raw = await call<Record<string, unknown>>('POST', '/api/v1/documents', {
        filename: input.filename,
        mime: input.mime,
        content_base64: b64,
        source_url: input.sourceUrl ?? '',
      });
      return fromRawDoc(raw);
    },

    uploadFromURL: async (rawURL) => {
      const raw = await call<Record<string, unknown>>('POST', '/api/v1/documents/from-url', {
        url: rawURL,
      });
      return fromRawDoc(raw);
    },

    delete: async (id) => {
      await call<void>('DELETE', `/api/v1/documents/${id}`);
    },

    search: async (docIds, query, topK) => {
      const raw = await call<Record<string, unknown>>('POST', '/api/v1/documents/search', {
        doc_ids: docIds,
        query,
        top_k: topK ?? 5,
      });
      const hits = (raw.hits as Array<Record<string, unknown>>) ?? [];
      return hits.map((h) => ({
        docId: String(h.doc_id ?? h.docId ?? ''),
        chunkId: String(h.chunk_id ?? h.chunkId ?? ''),
        ord: Number(h.ord ?? 0),
        score: Number(h.score ?? 0),
        content: String(h.content ?? ''),
      }));
    },

    attachToSession: async (sessionId, docId) => {
      await call<void>('POST', `/api/v1/copilot/sessions/${sessionId}/documents/${docId}`);
    },

    detachFromSession: async (sessionId, docId) => {
      await call<void>('DELETE', `/api/v1/copilot/sessions/${sessionId}/documents/${docId}`);
    },

    listAttachedToSession: async (sessionId) => {
      const raw = await call<Record<string, unknown>>(
        'GET',
        `/api/v1/copilot/sessions/${sessionId}/documents`,
      );
      const ids = (raw.document_ids as unknown[]) ?? [];
      return ids.map(String);
    },
  };
}
