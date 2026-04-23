// Typed API helper built on top of the generated OpenAPI `paths` type.
// Falls back to a generic wrapper if the generated schema isn't present.
import { api, API_BASE, isMockMode } from '../apiClient';
export async function apiCall(path, method = 'get', init = {}) {
    return api(path, {
        ...init,
        method: method.toUpperCase(),
    });
}
export { api, API_BASE, isMockMode };
