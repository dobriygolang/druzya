// Typed API helper built on top of the generated OpenAPI `paths` type.
// Falls back to a generic wrapper if the generated schema isn't present.

import { api, API_BASE, isMockMode } from '../apiClient'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { paths } from '../../api/generated/schema'

type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace'

// Helpers to extract response body from the generated paths type when available.
type PathOf<P> = P extends keyof paths ? P : string
type MethodsOf<P> = P extends keyof paths ? keyof paths[P] & HttpMethod : HttpMethod

type ResponseBody<P, M> = P extends keyof paths
  ? M extends keyof paths[P]
    ? paths[P][M] extends {
        responses: infer R
      }
      ? R extends Record<number, { content?: { 'application/json'?: infer J } }>
        ? // pick 200 if present, else first
          R[200] extends { content?: { 'application/json'?: infer J2 } }
          ? J2
          : J
        : unknown
      : unknown
    : unknown
  : unknown

export async function apiCall<P extends string, M extends HttpMethod = 'get'>(
  path: PathOf<P>,
  method: MethodsOf<P> | M = 'get' as M,
  init: Omit<RequestInit, 'method'> = {},
): Promise<ResponseBody<P, M>> {
  return api<ResponseBody<P, M>>(path as string, {
    ...init,
    method: (method as string).toUpperCase(),
  })
}

export { api, API_BASE, isMockMode }
