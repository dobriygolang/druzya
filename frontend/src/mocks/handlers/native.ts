import { http, HttpResponse } from 'msw'

const base = '/api/v1'

const score = {
  status: 'in_progress',
  ai_fraction: 0.42,
  human_fraction: 0.58,
  scores: {
    authorship: 78,
    comprehension: 72,
    refactor_quality: 65,
    coverage: 84,
  },
  gates: [
    { key: 'tests_green', passed: true, note: '18/18 cases' },
    { key: 'coverage_80', passed: true, note: '84% lines' },
    {
      key: 'comprehension',
      passed: false,
      note: 'AI-вопрос по trade-offs не зачтён',
    },
    { key: 'no_leak', passed: true, note: 'no copy-paste flagged' },
  ],
  overall: 72,
}

const provenance = {
  nodes: [
    {
      id: 'n0',
      kind: 'human' as const,
      label: 'Initial scaffold',
      parents: [],
      timestamp: '2026-04-20T10:00:00Z',
    },
    {
      id: 'n1',
      kind: 'ai' as const,
      label: 'AI suggestion: hash-map approach',
      parents: ['n0'],
      timestamp: '2026-04-20T10:04:00Z',
    },
    {
      id: 'n2',
      kind: 'human' as const,
      label: 'Refactor: extract helper',
      parents: ['n1'],
      timestamp: '2026-04-20T10:09:00Z',
    },
    {
      id: 'n3',
      kind: 'test' as const,
      label: 'Edge case: empty input',
      parents: ['n2'],
      timestamp: '2026-04-20T10:11:00Z',
    },
    {
      id: 'n4',
      kind: 'ai' as const,
      label: 'AI suggestion: stream over batch',
      parents: ['n2'],
      timestamp: '2026-04-20T10:14:00Z',
    },
    {
      id: 'n5',
      kind: 'human' as const,
      label: 'Reject AI: keeping batch',
      parents: ['n4'],
      timestamp: '2026-04-20T10:16:00Z',
    },
    {
      id: 'n6',
      kind: 'merge' as const,
      label: 'Final merge',
      parents: ['n3', 'n5'],
      timestamp: '2026-04-20T10:18:00Z',
    },
  ],
}

export const nativeHandlers = [
  http.get(`${base}/native/session/:id/score`, ({ params }) =>
    HttpResponse.json({ ...score, session_id: params.id }),
  ),
  http.get(`${base}/native/session/:id/provenance`, ({ params }) =>
    HttpResponse.json({ ...provenance, session_id: params.id }),
  ),
]
