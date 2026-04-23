import { http, HttpResponse } from 'msw'

const base = '/api/v1'

export type MatchSummary = {
  id: string
  user: string
  result: 'W' | 'L'
  lp: number
  task: string
  time: string
  initial: string
}

const matches: MatchSummary[] = [
  { id: 'm1', user: '@kirill_dev', result: 'W', lp: 18, task: 'Two Sum', time: '5 мин назад', initial: 'K' },
  { id: 'm2', user: '@nastya', result: 'L', lp: -12, task: 'Median Sorted', time: '1 ч назад', initial: 'N' },
  { id: 'm3', user: '@alexey', result: 'W', lp: 24, task: 'Search Rotated', time: '3 ч назад', initial: 'A' },
  { id: 'm4', user: '@vasya', result: 'W', lp: 16, task: 'Longest Substring', time: '5 ч назад', initial: 'V' },
  { id: 'm5', user: '@oleg', result: 'L', lp: -8, task: 'Word Break', time: 'вчера', initial: 'O' },
  { id: 'm6', user: '@denis', result: 'W', lp: 14, task: 'Course Schedule', time: 'вчера', initial: 'D' },
  { id: 'm7', user: '@lera', result: 'W', lp: 20, task: 'Trie', time: '2 дня назад', initial: 'L' },
  { id: 'm8', user: '@misha', result: 'L', lp: -10, task: 'Edit Distance', time: '2 дня назад', initial: 'M' },
]

export const matchesHandlers = [
  http.get(`${base}/matches/history`, () =>
    HttpResponse.json({
      total_wins: 284,
      total_losses: 176,
      avg_lp: 2.4,
      matches,
      selected_id: 'm1',
      detail: {
        id: 'm1',
        opponent: '@kirill_dev',
        task: 'Two Sum',
        difficulty: 'Easy',
        time_ago: '5 мин назад',
        result: 'W',
        lp: 18,
        your_time: '4:21',
        their_time: '5:08',
        tests: '15/15',
        your_code: [
          'func twoSum(nums []int, target int) []int {',
          '    seen := make(map[int]int)',
          '    for i, n := range nums {',
          '        if j, ok := seen[target-n]; ok {',
          '            return []int{j, i}',
          '        }',
          '        seen[n] = i',
          '    }',
          '    return nil',
          '}',
        ],
        your_highlight: [3, 4],
        their_code: [
          'func twoSum(nums []int, target int) []int {',
          '    for i := 0; i < len(nums); i++ {',
          '        for j := i + 1; j < len(nums); j++ {',
          '            if nums[i]+nums[j] == target {',
          '                return []int{i, j}',
          '            }',
          '        }',
          '    }',
          '    return nil',
          '}',
        ],
        their_highlight: [1, 2],
        your_lines: 10,
        your_complexity: 'O(n)',
        their_lines: 9,
        their_complexity: 'O(n²)',
        ai_summary: 'ты обогнал hash map → O(n), он застрял в брутфорсе O(n²) — рост в 4 раза при n=1000.',
      },
    }),
  ),

  // Phase 4-A: GET /arena/matches/my — paginated, filterable history.
  http.get(`${base}/arena/matches/my`, ({ request }) => {
    const url = new URL(request.url)
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20) || 20, 1), 100)
    const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0)
    const modeFilter = url.searchParams.get('mode') ?? ''
    const sectionFilter = url.searchParams.get('section') ?? ''

    const allItems = [
      { match_id: 'm1', mode: 'solo_1v1', section: 'algorithms', opp: 'kirill_dev', result: 'win', lp: 18, dur: 261 },
      { match_id: 'm2', mode: 'solo_1v1', section: 'algorithms', opp: 'nastya', result: 'loss', lp: -12, dur: 600 },
      { match_id: 'm3', mode: 'ranked', section: 'algorithms', opp: 'alexey', result: 'win', lp: 24, dur: 195 },
      { match_id: 'm4', mode: 'solo_1v1', section: 'sql', opp: 'vasya', result: 'win', lp: 16, dur: 320 },
      { match_id: 'm5', mode: 'ranked', section: 'go', opp: 'oleg', result: 'loss', lp: -8, dur: 540 },
      { match_id: 'm6', mode: 'solo_1v1', section: 'algorithms', opp: 'denis', result: 'win', lp: 14, dur: 240 },
      { match_id: 'm7', mode: 'duo_2v2', section: 'algorithms', opp: 'lera', result: 'win', lp: 20, dur: 420 },
      { match_id: 'm8', mode: 'solo_1v1', section: 'algorithms', opp: 'misha', result: 'loss', lp: -10, dur: 510 },
    ]

    const filtered = allItems.filter(
      (i) => (!modeFilter || i.mode === modeFilter) && (!sectionFilter || i.section === sectionFilter),
    )
    const page = filtered.slice(offset, offset + limit).map((i, n) => ({
      match_id: i.match_id,
      finished_at: new Date(Date.now() - n * 3600_000).toISOString(),
      mode: i.mode,
      section: i.section,
      opponent_user_id: '00000000-0000-0000-0000-000000000000',
      opponent_username: i.opp,
      opponent_avatar_url: '',
      result: i.result,
      lp_change: i.lp,
      duration_seconds: i.dur,
    }))
    return HttpResponse.json({ items: page, total: filtered.length })
  }),

  http.get(`${base}/matches/:id/end`, ({ params }) =>
    HttpResponse.json({
      id: params.id,
      result: 'W',
      verdict: 'Чисто, быстро, красиво',
      task: 'Median of Two Sorted Arrays',
      sub: 'побил соперника на 1:42',
      lp_delta: 18,
      lp_total: 2858,
      tier: 'Diamond III',
      next_tier: 'Diamond II · 482 LP',
      tier_progress: 78,
      stats: {
        time: '4:21',
        tests: '15/15',
        complexity: 'O(n)',
        lines: '10',
      },
      xp: {
        total: 240,
        breakdown: [
          { l: 'Победа в матче', v: '+120' },
          { l: 'Под 5 минут', v: '+80' },
          { l: 'Все тесты с 1 раза', v: '+40' },
        ],
        level: 24,
        progress: 6800,
        next_level_xp: 10000,
        progress_pct: 68,
      },
      streak_bonus: '5-WIN STREAK · +100 XP',
      your_code: 'func median(a, b []int) float64 {\n  i, j := 0, 0\n  m := make([]int, 0, len(a)+len(b))\n  for i < len(a) && j < len(b) {\n    if a[i] < b[j] { m = append(m,a[i]); i++\n    } else { m = append(m,b[j]); j++ }\n  }\n  ...\n}',
      their_code: 'func median(a, b []int) float64 {\n  all := append([]int{}, a...)\n  for _, x := range b { all = append(all, x) }\n  for i := range all {\n    for j := i+1; j < len(all); j++ {\n      if all[i] > all[j] { all[i],all[j]=all[j],all[i] }\n    }\n  }\n  ...\n}',
      your_label: '@you · O(n)',
      their_label: '@kirill_dev · O(n²)',
      your_meta: '10 lines',
      their_meta: '28 lines · TLE',
    }),
  ),
]
