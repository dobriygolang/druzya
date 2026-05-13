// Offline-first contract:
//   - localStorage `hone:primary_goal:v1` — last-known goal (instant render).
//   - hydrate() — read из backend, fills/replaces local cache. 404 → clear.
//   - subscribe() — re-fetch на window focus. Backend источник правды;
//     localStorage только cache layer.
//
// Goal create/edit flow доступен Sergey через web /profile (F2 wizard).
// Hone имеет только simple edit modal (kind + target_date + company/text);
// full wizard остался в web. Backend RPC общий — оба клиента видят те же
// данные.

import { create } from 'zustand';

import {
  getActiveGoal,
  updateGoal as rpcUpdateGoal,
  type PrimaryGoal,
  type UpdatePrimaryGoalBody,
} from '../api/intelligence';

const LS_KEY = 'hone:primary_goal:v1';

function readCached(): PrimaryGoal | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PrimaryGoal;
    if (parsed && typeof parsed.id === 'string' && typeof parsed.kind === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCached(g: PrimaryGoal | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (g) window.localStorage.setItem(LS_KEY, JSON.stringify(g));
    else window.localStorage.removeItem(LS_KEY);
  } catch {
    /* private mode / quota — degrade gracefully */
  }
}

interface GoalState {
  active: PrimaryGoal | null;
  loaded: boolean; // true после первого successful hydrate
  hydrate: () => Promise<void>;
  subscribe: () => () => void;
  update: (body: UpdatePrimaryGoalBody) => Promise<void>;
}

export const useGoalStore = create<GoalState>((set, get) => ({
  active: readCached(),
  loaded: false,

  hydrate: async () => {
    try {
      const g = await getActiveGoal();
      writeCached(g);
      set({ active: g, loaded: true });
    } catch {
      // Offline / network — оставляем localStorage cache как есть, mark
      // loaded=true чтобы UI не показывал бесконечный «loading».
      set({ loaded: true });
    }
  },

  // subscribe — re-fetch on window focus так что после edit'а в web юзер
  // вернётся в Hone и увидит updated goal. Returns unsubscriber.
  subscribe: () => {
    if (typeof window === 'undefined') return () => {};
    const onFocus = () => {
      void get().hydrate();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  },

  update: async (body: UpdatePrimaryGoalBody) => {
    const updated = await rpcUpdateGoal(body);
    writeCached(updated);
    set({ active: updated });
  },
}));

// daysUntil — utility для chip / countdown rendering. Returns null если
// target_date пуст / невалиден. Otherwise integer N days (может быть < 0
// если deadline в прошлом).
export function daysUntil(targetDate?: string): number | null {
  if (!targetDate) return null;
  const d = new Date(targetDate);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  // Normalize обе даты до UTC midnight, чтобы не зависеть от timezone shift'ов.
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / 86_400_000);
}

// formatGoalChip — короткий title для chip / hero. Возвращает напр.:
//   «Senior @ Yandex · 60d» / «ML Engineer offer» / «TOEFL 100+ · 30d».
// Hidden когда no goal (caller проверяет active===null).
export function formatGoalChip(g: PrimaryGoal): string {
  let title = '';
  switch (g.kind) {
    case 'GOAL_KIND_TOP_TIER_CO':
      title = g.target_company ? `Senior @ ${g.target_company}` : 'Senior @ ?';
      break;
    case 'GOAL_KIND_ANY_SENIOR':
      title = 'Senior IT';
      break;
    case 'GOAL_KIND_ML_OFFER':
      title = 'ML Engineer offer';
      break;
    case 'GOAL_KIND_ENGLISH_TARGET':
      title = g.target_text ?? 'English fluency';
      break;
    case 'GOAL_KIND_CUSTOM':
      title = g.target_text ?? 'Custom goal';
      break;
  }
  const n = daysUntil(g.target_date);
  if (n !== null && n > 0) title += ` · ${n}d`;
  else if (n !== null && n === 0) title += ' · today';
  else if (n !== null && n < 0) title += ' · overdue';
  return title;
}

// formatGoalLong — длинный rendering для Today card. Включает full date
// readable + days countdown отдельной строкой.
export function formatGoalLong(g: PrimaryGoal): { title: string; deadline: string | null } {
  let title = '';
  switch (g.kind) {
    case 'GOAL_KIND_TOP_TIER_CO':
      title = g.target_company ? `Senior @ ${g.target_company}` : 'Senior @ ?';
      break;
    case 'GOAL_KIND_ANY_SENIOR':
      title = 'Senior IT';
      break;
    case 'GOAL_KIND_ML_OFFER':
      title = 'ML Engineer offer';
      break;
    case 'GOAL_KIND_ENGLISH_TARGET':
      title = g.target_text ?? 'English fluency';
      break;
    case 'GOAL_KIND_CUSTOM':
      title = g.target_text ?? 'Custom goal';
      break;
  }
  const n = daysUntil(g.target_date);
  if (n === null) return { title, deadline: null };
  if (n > 0) return { title, deadline: `${n} ${n === 1 ? 'day' : 'days'} till deadline` };
  if (n === 0) return { title, deadline: 'deadline today' };
  return { title, deadline: `overdue by ${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}` };
}
