// mocks/handlers/lingua.ts — MSW handlers для /lingua API.
//
// In-memory mock state: reading materials, vocab queue, listening tracks,
// speaking exercises + history. Mutations append to the array так что UI
// flows можно exercise'ить локально без backend'а.
import { http, HttpResponse, type DefaultBodyType, type PathParams } from 'msw'

const base = '/api/v1'

// ─── Types ─────────────────────────────────────────────────────────────────

type WireMaterial = {
  id: string
  source_kind: string
  source_url: string
  title: string
  body_md: string
  total_chars: number
  archived_at: string | null
  created_at: string
  updated_at: string
  book_chapter: number
  has_book_chapter: boolean
  book_total_chapters: number
  has_book_total: boolean
}

type WireSession = {
  id: string
  material_id: string
  chars_read: number
  chars_total: number
  started_at: string
  ended_at: string | null
  ai_summary_score: number
  has_score: boolean
  summary_md: string
}

type WireVocab = {
  word: string
  translation: string
  context_md: string
  source_material: string
  box: number
  next_review_at: string | null
  reviewed_count: number
  learned_at: string | null
  created_at: string
}

type WireListening = {
  id: string
  title: string
  audio_url: string
  transcript_md: string
  archived_at: string | null
  created_at: string
  updated_at: string
}

type WireExercise = {
  id: string
  level: string
  topic: string
  prompt: string
  audio_url: string
}

type WireSpeakingSession = {
  id: string
  exercise_id: string
  prompt: string
  user_transcript: string
  pronunciation_score: number
  fluency_score: number
  coach_feedback: string
  created_at: string
}

// ─── Seed state ────────────────────────────────────────────────────────────

function nowIso(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400000).toISOString()
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const READING_BODY_SAMPLE = `Negative capability is what Keats called the capacity to dwell with uncertainty without irritably reaching after fact and reason. Senior engineers practise it daily: a flake in CI may yield to a rerun, or may unmask a real concurrency hazard.

The discipline is to delay closure. Form a hypothesis, write the experiment that would disprove it, and run that experiment before you commit to a story. Most production bugs root in the moment someone skipped that step under time pressure.`

const READING_BODY_SAMPLE_2 = `LRU cache eviction is straightforward in concept but fiddly in execution. The textbook trick is a doubly-linked list keyed by hash map. On access, splice the node to the head; on insert past capacity, drop the tail. Both operations are O(1) amortised.

What surprises people is the memory overhead — each node carries forward + backward pointers plus the map entry. At hundreds of thousands of keys, that overhead dwarfs the value payload for small types.`

const readingMaterials: WireMaterial[] = [
  {
    id: 'r-001',
    source_kind: 'paste',
    source_url: '',
    title: 'On negative capability — engineering edition',
    body_md: READING_BODY_SAMPLE,
    total_chars: READING_BODY_SAMPLE.length,
    archived_at: null,
    created_at: nowIso(-3),
    updated_at: nowIso(-1),
    book_chapter: 0,
    has_book_chapter: false,
    book_total_chapters: 0,
    has_book_total: false,
  },
  {
    id: 'r-002',
    source_kind: 'paste',
    source_url: '',
    title: 'LRU caches in production',
    body_md: READING_BODY_SAMPLE_2,
    total_chars: READING_BODY_SAMPLE_2.length,
    archived_at: null,
    created_at: nowIso(-5),
    updated_at: nowIso(-2),
    book_chapter: 0,
    has_book_chapter: false,
    book_total_chapters: 0,
    has_book_total: false,
  },
  {
    id: 'r-003',
    source_kind: 'url',
    source_url: 'https://example.com/articles/probabilistic-thinking',
    title: 'Probabilistic thinking under pressure',
    body_md: 'A short article body would go here. Click words to add them to your SRS queue.',
    total_chars: 80,
    archived_at: null,
    created_at: nowIso(-7),
    updated_at: nowIso(-6),
    book_chapter: 0,
    has_book_chapter: false,
    book_total_chapters: 0,
    has_book_total: false,
  },
  {
    id: 'r-004',
    source_kind: 'book',
    source_url: '',
    title: 'Designing Data-Intensive Applications — Ch. 4',
    body_md: 'Chapter notes go here.',
    total_chars: 2400,
    archived_at: null,
    created_at: nowIso(-10),
    updated_at: nowIso(-1),
    book_chapter: 4,
    has_book_chapter: true,
    book_total_chapters: 12,
    has_book_total: true,
  },
  {
    id: 'r-005',
    source_kind: 'paste',
    source_url: '',
    title: 'Coaching notes — week of May 5',
    body_md: 'Misc notes for the week.',
    total_chars: 320,
    archived_at: null,
    created_at: nowIso(-12),
    updated_at: nowIso(-12),
    book_chapter: 0,
    has_book_chapter: false,
    book_total_chapters: 0,
    has_book_total: false,
  },
]

const vocabQueue: WireVocab[] = [
  { word: 'parsimonious', translation: 'экономный', context_md: 'The architect favoured a parsimonious schema.', source_material: 'r-001', box: 1, next_review_at: nowIso(-1), reviewed_count: 1, learned_at: null, created_at: nowIso(-2) },
  { word: 'obfuscate', translation: 'затемнять', context_md: 'Side-effects obfuscate the data flow.', source_material: 'r-002', box: 0, next_review_at: nowIso(0), reviewed_count: 0, learned_at: null, created_at: nowIso(-1) },
  { word: 'idempotent', translation: 'идемпотентный', context_md: 'Retry-safe APIs must be idempotent.', source_material: 'r-001', box: 2, next_review_at: nowIso(0), reviewed_count: 3, learned_at: null, created_at: nowIso(-5) },
  { word: 'taxonomy', translation: 'таксономия', context_md: 'A clean taxonomy makes onboarding cheaper.', source_material: 'r-003', box: 1, next_review_at: nowIso(0), reviewed_count: 1, learned_at: null, created_at: nowIso(-3) },
  { word: 'heuristic', translation: 'эвристика', context_md: 'We rely on a few heuristics here.', source_material: 'r-001', box: 0, next_review_at: nowIso(0), reviewed_count: 0, learned_at: null, created_at: nowIso(-1) },
  { word: 'monotonic', translation: 'монотонный', context_md: 'Timestamps must be monotonic per-shard.', source_material: 'r-002', box: 1, next_review_at: nowIso(-1), reviewed_count: 2, learned_at: null, created_at: nowIso(-4) },
  { word: 'concurrency', translation: 'параллелизм', context_md: 'Concurrency bugs hide in narrow windows.', source_material: 'r-001', box: 2, next_review_at: nowIso(0), reviewed_count: 4, learned_at: null, created_at: nowIso(-6) },
  { word: 'orthogonal', translation: 'ортогональный', context_md: 'These features should stay orthogonal.', source_material: 'r-002', box: 0, next_review_at: nowIso(0), reviewed_count: 0, learned_at: null, created_at: nowIso(-1) },
  { word: 'pragmatic', translation: 'прагматичный', context_md: 'Pragmatic over elegant in v1.', source_material: 'r-003', box: 1, next_review_at: nowIso(0), reviewed_count: 1, learned_at: null, created_at: nowIso(-2) },
  { word: 'deterministic', translation: 'детерминированный', context_md: 'Deterministic tests are cheaper to debug.', source_material: 'r-001', box: 2, next_review_at: nowIso(0), reviewed_count: 5, learned_at: null, created_at: nowIso(-8) },
  { word: 'salient', translation: 'существенный', context_md: 'The salient detail is the timeout.', source_material: 'r-001', box: 0, next_review_at: nowIso(0), reviewed_count: 0, learned_at: null, created_at: nowIso(-1) },
  { word: 'cohort', translation: 'когорта', context_md: 'A cohort of users hit the same path.', source_material: 'r-003', box: 1, next_review_at: nowIso(0), reviewed_count: 1, learned_at: null, created_at: nowIso(-2) },
]

const listeningMaterials: WireListening[] = [
  {
    id: 'l-001',
    title: 'Lex Fridman — Sam Altman (excerpt)',
    audio_url: 'https://example.com/audio/lex-altman.mp3',
    transcript_md: `So the question isn't whether AGI will arrive — it's what trajectory it takes.

I think about three things when I evaluate new model releases: capability, reliability, and steerability. Capability is the headline. Reliability is whether you can build on it. Steerability is whether you can shape its behaviour.`,
    archived_at: null,
    created_at: nowIso(-4),
    updated_at: nowIso(-4),
  },
  {
    id: 'l-002',
    title: 'YC Office Hours — debugging at scale',
    audio_url: 'https://example.com/audio/yc-debug.mp3',
    transcript_md: 'The hardest debugging happens when you trust the wrong layer of the stack. Most senior engineers spend years calibrating that intuition.',
    archived_at: null,
    created_at: nowIso(-9),
    updated_at: nowIso(-9),
  },
  {
    id: 'l-003',
    title: 'Andrej Karpathy — transformers from scratch',
    audio_url: 'https://example.com/audio/karpathy-transformers.mp3',
    transcript_md: '',
    archived_at: null,
    created_at: nowIso(-14),
    updated_at: nowIso(-14),
  },
]

const speakingExercises: WireExercise[] = [
  { id: 'sp-001', level: 'B1', topic: 'introductions', prompt: 'Tell me about a project you shipped last month. What was hard?', audio_url: '' },
  { id: 'sp-002', level: 'B1', topic: 'daily', prompt: 'Walk me through what you did this morning before opening your laptop.', audio_url: '' },
  { id: 'sp-003', level: 'B2', topic: 'technical', prompt: 'Explain how database indexes work to a smart non-engineer.', audio_url: '' },
  { id: 'sp-004', level: 'B2', topic: 'product', prompt: 'Describe a time a user gave you feedback that changed your roadmap.', audio_url: '' },
  { id: 'sp-005', level: 'B2', topic: 'system-design', prompt: 'Walk me through the rate-limiting strategy you would choose for a public API.', audio_url: '' },
  { id: 'sp-006', level: 'C1', topic: 'leadership', prompt: 'How do you handle disagreement with a senior engineer who you think is wrong?', audio_url: '' },
  { id: 'sp-007', level: 'C1', topic: 'architecture', prompt: 'Compare event sourcing and CRUD for a billing system. Where does each break down?', audio_url: '' },
  { id: 'sp-008', level: 'C1', topic: 'reflection', prompt: 'Describe a technical decision you made that you would reverse with hindsight.', audio_url: '' },
]

const speakingHistory: WireSpeakingSession[] = [
  { id: 'sh-001', exercise_id: 'sp-003', prompt: 'Explain how database indexes work to a smart non-engineer.', user_transcript: 'An index is like a book index — it lets you find pages without reading every page…', pronunciation_score: 72, fluency_score: 68, coach_feedback: 'Solid framing. Slow down on technical terms — "B-tree" came out as "bee-tree".', created_at: nowIso(-1) },
  { id: 'sh-002', exercise_id: 'sp-001', prompt: 'Tell me about a project you shipped last month. What was hard?', user_transcript: 'Last month I shipped a feature for our reading module…', pronunciation_score: 78, fluency_score: 74, coach_feedback: 'Nice pace. Watch the past tense on irregular verbs.', created_at: nowIso(-2) },
  { id: 'sh-003', exercise_id: 'sp-005', prompt: 'Walk me through the rate-limiting strategy you would choose for a public API.', user_transcript: 'I would use a token bucket per API key…', pronunciation_score: 81, fluency_score: 79, coach_feedback: 'Strong. Try "leaky bucket" with a clearer L sound.', created_at: nowIso(-4) },
  { id: 'sh-004', exercise_id: 'sp-006', prompt: 'How do you handle disagreement with a senior engineer who you think is wrong?', user_transcript: 'I try to share the evidence I have and ask what I am missing…', pronunciation_score: 76, fluency_score: 80, coach_feedback: 'Confident tone. Word "evidence" — stress the first syllable.', created_at: nowIso(-6) },
  { id: 'sh-005', exercise_id: 'sp-002', prompt: 'Walk me through what you did this morning before opening your laptop.', user_transcript: 'I made coffee and walked the dog…', pronunciation_score: 85, fluency_score: 82, coach_feedback: 'Natural rhythm.', created_at: nowIso(-8) },
  { id: 'sh-006', exercise_id: 'sp-004', prompt: 'Describe a time a user gave you feedback that changed your roadmap.', user_transcript: 'A user said the SRS interval was too aggressive…', pronunciation_score: 74, fluency_score: 71, coach_feedback: 'Pause for breath at clause boundaries.', created_at: nowIso(-10) },
]

// ─── Helpers ───────────────────────────────────────────────────────────────

function totalChars(body: string): number {
  return body.length
}

// ─── Handlers ──────────────────────────────────────────────────────────────

export const linguaHandlers = [
  // /hone/settings — exposes english_active flag so the AppShell nav can
  // conditionally show «Lingua». Default mock = English ON so the new
  // surface is visible in dev. Toggle via localStorage('lingua_english_off').
  http.get(`${base}/hone/settings`, () => {
    const off = typeof window !== 'undefined' && window.localStorage.getItem('lingua_english_off') === '1'
    return HttpResponse.json({
      active_track: off ? 'general' : 'english',
      english_active: !off,
    })
  }),

  // List materials
  http.get(`${base}/hone/reading/materials`, ({ request }) => {
    const url = new URL(request.url)
    const limit = Number(url.searchParams.get('limit') ?? 100)
    const items = readingMaterials
      .filter((m) => !m.archived_at)
      .slice(0, limit)
      .map((m) => ({ ...m, body_md: '' }))
    return HttpResponse.json({ items, next_cursor: '' })
  }),
  http.get<{ id: string }, DefaultBodyType>(`${base}/hone/reading/materials/:id`, ({ params }) => {
    const m = readingMaterials.find((x) => x.id === params.id)
    if (!m) return HttpResponse.json({ message: 'not found' }, { status: 404 })
    return HttpResponse.json(m)
  }),
  http.post<PathParams, Partial<WireMaterial>>(`${base}/hone/reading/materials`, async ({ request }) => {
    const body = (await request.json()) as Partial<WireMaterial>
    const created: WireMaterial = {
      id: `r-${uuid().slice(0, 8)}`,
      source_kind: body.source_kind ?? 'paste',
      source_url: body.source_url ?? '',
      title: body.title ?? '(untitled)',
      body_md: body.body_md ?? '',
      total_chars: totalChars(body.body_md ?? ''),
      archived_at: null,
      created_at: nowIso(0),
      updated_at: nowIso(0),
      book_chapter: body.book_chapter ?? 0,
      has_book_chapter: Boolean(body.has_book_chapter),
      book_total_chapters: body.book_total_chapters ?? 0,
      has_book_total: Boolean(body.has_book_total),
    }
    readingMaterials.unshift(created)
    return HttpResponse.json(created)
  }),
  http.post<{ id: string }>(`${base}/hone/reading/materials/:id/archive`, ({ params }) => {
    const m = readingMaterials.find((x) => x.id === params.id)
    if (m) m.archived_at = nowIso(0)
    return HttpResponse.json({})
  }),

  // Sessions
  http.post<PathParams, { material_id?: string }>(`${base}/hone/reading/sessions`, async ({ request }) => {
    const body = (await request.json()) as { material_id?: string }
    const materialId = body.material_id ?? ''
    const m = readingMaterials.find((x) => x.id === materialId)
    const session: WireSession = {
      id: `s-${uuid().slice(0, 8)}`,
      material_id: materialId,
      chars_read: 0,
      chars_total: m?.total_chars ?? 0,
      started_at: nowIso(0),
      ended_at: null,
      ai_summary_score: 0,
      has_score: false,
      summary_md: '',
    }
    return HttpResponse.json(session)
  }),
  http.post<{ session_id: string }, { chars_read?: number; summary_md?: string }>(
    `${base}/hone/reading/sessions/:session_id/end`,
    async ({ request, params }) => {
      const body = (await request.json()) as { chars_read?: number; summary_md?: string }
      const hasSummary = (body.summary_md ?? '').trim().length > 0
      const session: WireSession = {
        id: params.session_id,
        material_id: '',
        chars_read: body.chars_read ?? 0,
        chars_total: 0,
        started_at: nowIso(0),
        ended_at: nowIso(0),
        ai_summary_score: hasSummary ? 76 : 0,
        has_score: hasSummary,
        summary_md: body.summary_md ?? '',
      }
      return HttpResponse.json({ session })
    },
  ),

  // Vocab
  http.get(`${base}/hone/reading/vocab/due`, ({ request }) => {
    const url = new URL(request.url)
    const limit = Number(url.searchParams.get('limit') ?? 20)
    return HttpResponse.json({ items: vocabQueue.slice(0, limit) })
  }),
  http.get<{ material_id: string }>(`${base}/hone/reading/materials/:material_id/vocab`, ({ params, request }) => {
    const url = new URL(request.url)
    const limit = Number(url.searchParams.get('limit') ?? 50)
    const items = vocabQueue.filter((v) => v.source_material === params.material_id).slice(0, limit)
    return HttpResponse.json({ items })
  }),
  http.post<PathParams, Partial<WireVocab>>(`${base}/hone/reading/vocab`, async ({ request }) => {
    const body = (await request.json()) as Partial<WireVocab>
    const existing = vocabQueue.find((v) => v.word === body.word)
    if (existing) {
      if (body.translation) existing.translation = body.translation
      if (body.context_md) existing.context_md = body.context_md
      return HttpResponse.json(existing)
    }
    const created: WireVocab = {
      word: body.word ?? '',
      translation: body.translation ?? '',
      context_md: body.context_md ?? '',
      source_material: body.source_material ?? '',
      box: 0,
      next_review_at: nowIso(0),
      reviewed_count: 0,
      learned_at: null,
      created_at: nowIso(0),
    }
    vocabQueue.push(created)
    return HttpResponse.json(created)
  }),
  http.post<PathParams, { word?: string; correct?: boolean }>(
    `${base}/hone/reading/vocab/review`,
    async ({ request }) => {
      const body = (await request.json()) as { word?: string; correct?: boolean }
      const v = vocabQueue.find((x) => x.word === body.word)
      if (!v) return HttpResponse.json({ message: 'not found' }, { status: 404 })
      v.reviewed_count += 1
      v.box = body.correct ? Math.min(5, v.box + 1) : Math.max(0, v.box - 1)
      v.next_review_at = nowIso(body.correct ? 2 : 0)
      return HttpResponse.json(v)
    },
  ),

  // Writing
  http.post<PathParams, { text?: string; title?: string }>(
    `${base}/hone/writing/grade`,
    async ({ request }) => {
      const body = (await request.json()) as { text?: string; title?: string }
      const text = body.text ?? ''
      const wc = text.trim().split(/\s+/).length
      const score = Math.max(45, Math.min(90, 60 + Math.floor(wc / 20)))
      const issues = [
        {
          excerpt: text.split('.')[0]?.slice(0, 60) ?? 'sentence',
          category: 'grammar',
          suggestion: 'Consider tightening this opening — shorter sentences land harder.',
          explanation: 'Native readers parse 12-18 word sentences fastest. This one is just over.',
        },
        {
          excerpt: text.split(' ').slice(0, 3).join(' '),
          category: 'style',
          suggestion: 'Lead with the verb rather than the subject.',
          explanation: 'Active voice gives the reader the action first.',
        },
      ].filter((i) => i.excerpt.length > 3)
      return HttpResponse.json({ overall_score: score, issues })
    },
  ),

  // Listening
  http.get(`${base}/hone/listening/materials`, () => {
    const items = listeningMaterials.filter((m) => !m.archived_at).map((m) => ({ ...m, transcript_md: '' }))
    return HttpResponse.json({ items, next_cursor: '' })
  }),
  http.get<{ id: string }>(`${base}/hone/listening/materials/:id`, ({ params }) => {
    const m = listeningMaterials.find((x) => x.id === params.id)
    if (!m) return HttpResponse.json({ message: 'not found' }, { status: 404 })
    return HttpResponse.json(m)
  }),
  http.post<PathParams, Partial<WireListening>>(`${base}/hone/listening/materials`, async ({ request }) => {
    const body = (await request.json()) as Partial<WireListening>
    const created: WireListening = {
      id: `l-${uuid().slice(0, 8)}`,
      title: body.title ?? '(untitled)',
      audio_url: body.audio_url ?? '',
      transcript_md: body.transcript_md ?? '',
      archived_at: null,
      created_at: nowIso(0),
      updated_at: nowIso(0),
    }
    listeningMaterials.unshift(created)
    return HttpResponse.json(created)
  }),
  http.post<{ id: string }>(`${base}/hone/listening/materials/:id/archive`, ({ params }) => {
    const m = listeningMaterials.find((x) => x.id === params.id)
    if (m) m.archived_at = nowIso(0)
    return HttpResponse.json({})
  }),
  http.post<PathParams, { url?: string; language_hint?: string }>(
    `${base}/hone/listening/youtube`,
    async ({ request }) => {
      const body = (await request.json()) as { url?: string }
      const created: WireListening = {
        id: `l-${uuid().slice(0, 8)}`,
        title: `YouTube import — ${body.url ?? ''}`,
        audio_url: body.url ?? '',
        transcript_md: 'Auto-captions are ingested here in production.',
        archived_at: null,
        created_at: nowIso(0),
        updated_at: nowIso(0),
      }
      listeningMaterials.unshift(created)
      return HttpResponse.json(created)
    },
  ),
  // Phase K Wave 15 — Sergey-curated ready library (static).
  http.get(`${base}/hone/listening/curated`, ({ request }) => {
    const url = new URL(request.url)
    const level = (url.searchParams.get('level') ?? '').toUpperCase()
    const all = [
      {
        id: 'sed-amazon-leadership',
        title: 'Amazon Leadership Principles with Colin Bryar and Bill Carr',
        speaker: 'Jeff Meyerson',
        url: 'https://softwareengineeringdaily.com/2021/03/15/amazon-leadership-principles/',
        level: 'B2',
        estimated_minutes: 60,
        topic: 'engineering culture',
        tags: ['leadership', 'amazon', 'culture'],
        source: 'Software Engineering Daily',
        why: 'Двое экс-Amazon рассказывают про process language.',
      },
      {
        id: 'changelog-go-2-was-a-lie',
        title: 'Go 2 was a lie',
        speaker: 'Russ Cox',
        url: 'https://changelog.com/gotime/100',
        level: 'B2',
        estimated_minutes: 75,
        topic: 'Go language',
        tags: ['golang', 'language-design'],
        source: 'Go Time (Changelog)',
        why: 'Russ Cox разворачивает Go 2 vision.',
      },
      {
        id: 'lex-karpathy-2',
        title: 'Andrej Karpathy: Tesla AI, Self-Driving, Optimus, Aliens, and AGI',
        speaker: 'Andrej Karpathy',
        url: 'https://lexfridman.com/andrej-karpathy-2/',
        level: 'C1',
        estimated_minutes: 210,
        topic: 'AI / ML',
        tags: ['ai', 'karpathy'],
        source: 'Lex Fridman Podcast',
        why: 'Karpathy на ML и AI.',
      },
      {
        id: 'hanselminutes-rust-bridge',
        title: 'Building a Bridge to Rust',
        speaker: 'Mara Bos',
        url: 'https://hanselminutes.com/848/building-a-bridge-to-rust-with-mara-bos',
        level: 'B1',
        estimated_minutes: 30,
        topic: 'languages',
        tags: ['rust', 'education'],
        source: 'Hanselminutes',
        why: 'Slow deliberate diction для B1 listening.',
      },
      {
        id: 'ted-simon-sinek',
        title: 'How great leaders inspire action',
        speaker: 'Simon Sinek',
        url: 'https://www.ted.com/talks/simon_sinek_how_great_leaders_inspire_action',
        level: 'B1',
        estimated_minutes: 18,
        topic: 'leadership',
        tags: ['leadership', 'communication'],
        source: 'TED',
        why: 'Sinek «Why» talk — narrative structure для interviews.',
      },
      {
        id: 'strangeloop-rich-hickey',
        title: 'Simple Made Easy',
        speaker: 'Rich Hickey',
        url: 'https://www.youtube.com/watch?v=SxdOUGdseq4',
        level: 'C1',
        estimated_minutes: 60,
        topic: 'programming philosophy',
        tags: ['clojure', 'complexity'],
        source: 'Strange Loop',
        why: 'Hickey классика — senior+ vocabulary.',
      },
    ]
    const items = level === 'B1' || level === 'B2' || level === 'C1'
      ? all.filter((t) => t.level === level)
      : all
    return HttpResponse.json({ items })
  }),

  // Speaking
  http.get(`${base}/hone/speaking/exercises`, ({ request }) => {
    const url = new URL(request.url)
    const level = url.searchParams.get('level') ?? ''
    const items = level ? speakingExercises.filter((e) => e.level === level) : speakingExercises
    return HttpResponse.json({ items })
  }),
  http.get(`${base}/hone/speaking/history`, ({ request }) => {
    const url = new URL(request.url)
    const limit = Number(url.searchParams.get('limit') ?? 14)
    return HttpResponse.json({ items: speakingHistory.slice(0, limit) })
  }),
  http.post<PathParams, { exercise_id?: string; client_session_id?: string }>(
    `${base}/hone/speaking/grade`,
    async ({ request }) => {
      const body = (await request.json()) as { exercise_id?: string }
      const ex = speakingExercises.find((e) => e.id === body.exercise_id)
      const prompt = ex?.prompt ?? ''
      const pron = 70 + Math.floor(Math.random() * 20)
      const flu = 65 + Math.floor(Math.random() * 25)
      const session: WireSpeakingSession = {
        id: `sh-${uuid().slice(0, 8)}`,
        exercise_id: body.exercise_id ?? '',
        prompt,
        user_transcript: prompt,
        pronunciation_score: pron,
        fluency_score: flu,
        coach_feedback: 'Solid attempt. Stress the first syllable on multi-syllable terms.',
        created_at: nowIso(0),
      }
      speakingHistory.unshift(session)
      const words = prompt.split(/\s+/).slice(0, 10)
      return HttpResponse.json({
        id: session.id,
        user_transcript: prompt,
        pronunciation_score: pron,
        fluency_score: flu,
        coach_feedback: session.coach_feedback,
        word_diffs: words.map((w, i) => ({
          status: i % 4 === 0 ? 'substitute' : 'match',
          expected: w.replace(/[^A-Za-z']/g, '') || 'word',
          actual: w.replace(/[^A-Za-z']/g, '') || 'word',
        })),
        created_at: nowIso(0),
      })
    },
  ),
]
