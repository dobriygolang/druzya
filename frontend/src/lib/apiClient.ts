// Thin fetch wrapper. Real client will be replaced once oapi-codegen / openapi-typescript
// clients are plugged in. Kept minimal to avoid coupling to generated code during scaffolding.

const BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

export type Fetcher = <T = unknown>(path: string, init?: RequestInit) => Promise<T>

export const api: Fetcher = async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(res.status, body)
  }

  if (res.status === 204) return undefined as never
  return res.json()
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`api ${status}: ${body}`)
  }
}
