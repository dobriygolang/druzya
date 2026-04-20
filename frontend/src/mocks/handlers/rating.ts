import { http, HttpResponse } from 'msw'

const base = '/api/v1'

export const ratingHandlers = [
  http.get(`${base}/rating/me`, () =>
    HttpResponse.json({
      ratings: [
        { section: 'algorithms', elo: 1620, matches_count: 42, percentile: 88, decaying: false },
        { section: 'sql', elo: 1510, matches_count: 18, percentile: 76, decaying: false },
        { section: 'go', elo: 1680, matches_count: 31, percentile: 92, decaying: false },
        { section: 'system_design', elo: 1320, matches_count: 6, percentile: 45, decaying: true },
        { section: 'behavioral', elo: 1400, matches_count: 12, percentile: 60, decaying: false },
      ],
      global_power_score: 1506,
      history: Array.from({ length: 12 }).map((_, i) => ({
        week_start: new Date(Date.now() - (11 - i) * 7 * 864e5).toISOString().slice(0, 10),
        global_power_score: 1200 + i * 25,
      })),
    }),
  ),

  http.get(`${base}/rating/leaderboard`, ({ request }) => {
    const section = new URL(request.url).searchParams.get('section') ?? 'algorithms'
    return HttpResponse.json({
      section,
      updated_at: new Date().toISOString(),
      my_rank: 47,
      entries: Array.from({ length: 10 }).map((_, i) => ({
        rank: i + 1,
        user_id: `u${i + 1}`,
        username: i === 0 ? 'shadow_777' : `player_${i + 1}`,
        elo: 1980 - i * 18,
        title: i === 0 ? 'Champion' : null,
        guild_emblem: null,
      })),
    })
  }),
]
