// queries/podcasts.ts — runtime-запросы каталога подкастов для /podcasts.
//
// Контракт ответа GET /api/v1/podcast (см. backend/services/podcast/ports/server.go,
// PodcastServer.ListCatalog → PodcastCatalog proto):
//
//   {
//     "items": [
//       {
//         "id": "uuid",
//         "title": "string",
//         "description": "string",
//         "section": "SECTION_*",
//         "duration_sec": 1234,
//         "audio_url": "https://signed.s3.url/...",
//         "progress_sec": 0,
//         "completed": false
//       }
//     ]
//   }
//
// Mock (frontend/src/mocks/handlers/podcast.ts) пока возвращает legacy-форму
// `{episodes, sections}` — нормализуем оба варианта в `Podcast[]`, чтобы
// PodcastsPage.tsx не знал про разницу. Когда mock переведут на канон
// (`items`), legacy-ветка превратится в no-op.
import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
function isCanonical(payload) {
    return typeof payload === 'object' && payload !== null && Array.isArray(payload.items);
}
function isLegacy(payload) {
    return typeof payload === 'object' && payload !== null && Array.isArray(payload.episodes);
}
/** Нормализует ответ бэка в канон. Бросает при unknown shape. */
export function normalisePodcastCatalog(raw) {
    if (isCanonical(raw)) {
        return raw.items.map((p) => ({
            id: p.id,
            title: p.title,
            description: p.description,
            section: p.section,
            duration_sec: p.duration_sec,
            audio_url: p.audio_url,
            progress_sec: p.progress_sec,
            completed: p.completed,
            published_at: p.published_at,
        }));
    }
    if (isLegacy(raw)) {
        return raw.episodes.map((e) => ({
            id: e.id,
            title: e.title,
            description: e.description,
            section: e.section,
            duration_sec: Math.max(0, Math.round(e.duration_min * 60)),
            audio_url: '',
            progress_sec: 0,
            completed: Boolean(e.listened),
            published_at: e.published_at,
        }));
    }
    return [];
}
export function usePodcastsQuery() {
    return useQuery({
        queryKey: ['podcasts', 'catalog'],
        queryFn: async () => {
            const raw = await api('/podcast');
            return normalisePodcastCatalog(raw);
        },
        staleTime: 5 * 60_000,
    });
}
/**
 * PUT /api/v1/podcast/{id}/progress — отправляем listened seconds.
 * Возвращает обновлённый прогресс. Не попадает в TanStack-cache; вызывается
 * императивно из аудио-плеера на throttle.
 */
export async function updatePodcastProgress(input) {
    const body = { progress_sec: Math.max(0, Math.floor(input.progressSec)) };
    if (input.completed)
        body.completed = true;
    await api(`/podcast/${encodeURIComponent(input.podcastId)}/progress`, {
        method: 'PUT',
        body: JSON.stringify(body),
    });
}
/** Человекочитаемая длительность: 42 min или 1h 12m. */
export function formatDuration(durationSec) {
    const total = Math.max(0, Math.round(durationSec));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    if (h > 0)
        return `${h}ч ${m}м`;
    return `${m} мин`;
}
/** Человекочитаемая дата публикации (RU). */
export function formatPublished(iso) {
    if (!iso)
        return '';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime()))
            return '';
        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    catch {
        return '';
    }
}
