// track.ts — active study mode store.
//
// Source of truth — backend hone_user_settings. Store: optimistic UI на
// switch + reload from backend on mount. localStorage используется только
// как hint до hydrate, чтобы dropdown не флипал на 'general' и обратно.
import { create } from 'zustand';

import {
  ActiveTrack,
  getUserSettings,
  setActiveTrack as apiSetActiveTrack,
  setEnglishActive as apiSetEnglishActive,
} from '../api/hone';
import { listAtlasNodeTracks } from '../api/external';

const LS_KEY = 'hone:active_track';

function readCachedTrack(): ActiveTrack {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === 'general' || v === 'dev' || v === 'ml' || v === 'english' || v === 'go') return v;
  } catch {
    /* ignore */
  }
  return 'general';
}

function writeCachedTrack(t: ActiveTrack) {
  try {
    localStorage.setItem(LS_KEY, t);
  } catch {
    /* ignore */
  }
}

interface TrackState {
  activeTrack: ActiveTrack;
  englishActive: boolean;
  hydrated: boolean;
  /** {atlas_node_id → track_kind}. Lazy-loaded; пустой = filter не активен. */
  atlasNodeTracks: Record<string, string>;
  hydrate: () => Promise<void>;
  set: (t: ActiveTrack) => Promise<void>;
  setEnglishActive: (active: boolean) => Promise<void>;
  /** Loads atlas-node track-mapping. No-op если уже загружено. */
  loadAtlasTracks: () => Promise<void>;
  itemMatchesActive: (skillKey: string) => boolean;
}

// activeTrack → набор приемлемых track_kind'ов. 'go' — sub-mode dev'а:
// разрешаем 'dev' и 'dev_senior' (Sergey'у показываем full senior dev pipeline
// в go-deep mode'е, plus go-coach для chat). 'ml' — специализация внутри
// dev_senior (mig 00046 не вернули track_kind enum, ML atlas-узлы остались
// под dev_senior); фильтр показывает dev_senior контент + ml-coach handoff.
function trackToKinds(t: ActiveTrack): Set<string> {
  switch (t) {
    case 'general':
      return new Set();
    case 'dev':
    case 'go':
      return new Set(['dev', 'dev_senior']);
    case 'ml':
      return new Set(['dev_senior']);
    case 'english':
      return new Set(['english']);
    default:
      return new Set();
  }
}

export const useTrackStore = create<TrackState>((set, get) => ({
  activeTrack: readCachedTrack(),
  englishActive: false,
  hydrated: false,
  atlasNodeTracks: {},

  hydrate: async () => {
    try {
      const s = await getUserSettings();
      writeCachedTrack(s.activeTrack);
      set({ activeTrack: s.activeTrack, englishActive: s.englishActive, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  setEnglishActive: async (active: boolean) => {
    const prev = get().englishActive;
    set({ englishActive: active });
    try {
      await apiSetEnglishActive(active);
    } catch (err) {
      set({ englishActive: prev });
      throw err;
    }
  },

  set: async (t: ActiveTrack) => {
    const prev = get().activeTrack;
    set({ activeTrack: t });
    writeCachedTrack(t);
    try {
      await apiSetActiveTrack(t);
    } catch (err) {
      set({ activeTrack: prev });
      writeCachedTrack(prev);
      throw err;
    }
  },

  loadAtlasTracks: async () => {
    if (Object.keys(get().atlasNodeTracks).length > 0) return;
    try {
      const m = await listAtlasNodeTracks();
      set({ atlasNodeTracks: m });
    } catch {
      /* silent — без map'а filter работает как passthrough */
    }
  },

  itemMatchesActive: (skillKey: string) => {
    const { activeTrack, atlasNodeTracks } = get();
    if (activeTrack === 'general') return true;
    const trimmed = (skillKey ?? '').trim();
    if (!trimmed) return true; // user-added items без skill_key — всегда видимы
    const tk = atlasNodeTracks[trimmed];
    if (!tk) return true; // skill_key не в атласе (custom labels) — видим
    return trackToKinds(activeTrack).has(tk);
  },
}));

export const TRACK_LABELS: Record<ActiveTrack, string> = {
  general: 'General',
  dev: 'Dev (Go)',
  ml: 'ML Engineering',
  english: 'English',
  go: 'Go deep',
};
