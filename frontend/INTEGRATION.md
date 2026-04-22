# Backend Integration Guide

This document explains how the `druz9` frontend talks to the backend, how to
switch between mocked and real APIs, and how to regenerate types from the
OpenAPI spec.

## Environment variables

Vite reads env vars at build/dev time. Files:

- `.env.example` — committed reference
- `.env.development` — used when running `npm run dev` (mock mode by default)
- `.env.production` — used by `npm run build` (real backend)

| Var               | Purpose                                 | Dev default          | Prod default                       |
| ----------------- | --------------------------------------- | -------------------- | ---------------------------------- |
| `VITE_USE_MSW`    | Boot MSW worker for mocked requests     | `true`               | `false`                            |
| `VITE_API_BASE`   | Base URL prepended to all REST calls    | `/api/v1`            | `https://api.druz9.online/v1`      |
| `VITE_WS_BASE`    | Base URL for the realtime WS connection | `/ws`                | `wss://api.druz9.online/ws`        |
| `VITE_API_PROXY`  | (dev only) override Vite dev proxy host | `http://localhost:8080` | n/a                              |

## Switching MSW -> real backend

1. Edit `.env.development` and set `VITE_USE_MSW=false`.
2. Make sure the backend is reachable at the URL you proxy to. By default
   `vite.config.ts` proxies `/api` and `/ws` to `http://localhost:8080`.
   To target a different host: `VITE_API_PROXY=http://api.local:8080 npm run dev`.
3. Restart `npm run dev`.

For a production build, simply `npm run build` — it reads `.env.production`
and ships with `VITE_USE_MSW=false` and the real `https://api.druz9.online/v1`
endpoint.

You can confirm at runtime via the helper:

```ts
import { isMockMode } from '@/lib/apiClient'
if (isMockMode()) console.log('using MSW')
```

## Auth flow

Authentication uses a bearer access token persisted in `localStorage` under the
key `druz9_access_token`.

- Sign-in flow stores the token: `localStorage.setItem('druz9_access_token', t)`.
- `lib/apiClient.ts` automatically attaches `Authorization: Bearer <token>` to
  every outgoing request.
- A `401` response clears the token and redirects to `/welcome`.

## Regenerating typed API client

Source of truth is `docs/legacy/openapi-v1.yaml`.

```sh
# from the frontend dir
npm run gen:api
```

That regenerates `src/api/generated/schema.ts` (typed `paths` interface).

To make a typed call, use the `apiCall` helper:

```ts
import { apiCall } from '@/lib/api'

const data = await apiCall('/me', 'get')
// 'data' is typed against paths['/me']['get'] response.
```

For ad-hoc untyped calls (or before the schema is regenerated) use the
low-level `api` fetcher:

```ts
import { api } from '@/lib/apiClient'
const x = await api<MyType>('/foo', { method: 'POST', body: JSON.stringify({}) })
```

## Dev proxy

`vite.config.ts` exposes:

- `/api/*`  -> `http://localhost:8080/api/*`
- `/ws`     -> `ws://localhost:8080/ws`

Override with `VITE_API_PROXY` (e.g. inside docker-compose where the backend
is reachable as `http://api:8080`).
