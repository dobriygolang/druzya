// api/clubs.ts — Phase 3 final. Hone Today club chip.
//
// REST через /api/v1/clubs/upcoming-for-me. Возвращает следующую
// scheduled-сессию, к которой юзер RSVP'd_yes — для one-line chip.

import { useSessionStore } from '../stores/session';
import { API_BASE_URL, DEV_BEARER_TOKEN } from './config';

export interface UpcomingClubSession {
  sessionId: string;
  clubId: string;
  clubSlug: string;
  clubName: string;
  scheduledAt: string;
  topicTitle: string;
  zoomLink: string;
  hoursFromNow: number;
}

interface WireResp {
  session: {
    session_id: string;
    club_id: string;
    club_slug: string;
    club_name: string;
    scheduled_at: string;
    topic_title: string;
    zoom_link: string;
    hours_from_now: number;
  } | null;
}

function authHeaders(): Record<string, string> {
  const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

export async function nextClubSession(): Promise<UpcomingClubSession | null> {
  try {
    const resp = await fetch(`${API_BASE_URL}/api/v1/clubs/upcoming-for-me`, {
      headers: authHeaders(),
    });
    if (!resp.ok) return null;
    const j = (await resp.json()) as WireResp;
    if (!j.session) return null;
    const s = j.session;
    return {
      sessionId: s.session_id,
      clubId: s.club_id,
      clubSlug: s.club_slug,
      clubName: s.club_name,
      scheduledAt: s.scheduled_at,
      topicTitle: s.topic_title,
      zoomLink: s.zoom_link,
      hoursFromNow: s.hours_from_now,
    };
  } catch {
    return null;
  }
}
