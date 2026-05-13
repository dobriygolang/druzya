// Цель: дать юзеру 20-минутный self-check который генерит «ground truth»
// signal для F3 readiness. Без этого F3 опирается на self-reported
// diagnostic (F9) + activity proxy — а это slow / biased. Mini-mock = first
// honest evaluation pass.
//
// R2). Когда backend ship'нется, swap localStorage → RPC, UI keep'ит shape.
//
// Storage: один key с last result. История не хранится (один MVP signal —
// последний). Future iteration: история score по треку для slope.

import { logActivity } from './activity'

export type MiniMockTrack = 'go' | 'ml' | 'english'

export interface AlgoQuestion {
  id: string
  /** Plain prompt, без code blocks (MVP). */
  prompt: string
  options: string[]
  /** Index в options. */
  correctIndex: number
  /** Explanation после ответа — teach moment. */
  explanation: string
  /** Difficulty hint для grading scale. */
  difficulty: 'easy' | 'medium' | 'hard'
}

export interface SysDesignQuestion {
  id: string
  prompt: string
  /** Ключевые слова / концепты которые ожидаем увидеть в ответе. Lowercase. */
  keyPoints: string[]
  /** Hint visible while user types — направляющий, не spoiler. */
  hint: string
}

export interface MiniMockResult {
  /** ISO yyyy-mm-dd. */
  takenOn: string
  /** ms epoch. */
  takenAt: number
  track: MiniMockTrack
  algo: {
    questionId: string
    chosenIndex: number
    correct: boolean
    /** 0..5. */
    score: number
  }
  sysdesign: {
    questionId: string
    answerText: string
    /** Matched key points. */
    hits: string[]
    /** Total key points expected. */
    total: number
    /** 0..5. */
    score: number
  }
  /** Composite 0..5 (avg of algo + sysdesign). */
  overallScore: number
}

// ────────────────────────────────────────────────────────────────────────
// Content bank — handpicked questions per track. Не LLM-сгенерированный,

const GO_ALGO: AlgoQuestion[] = [
  {
    id: 'go_algo_1',
    prompt:
      'У тебя отсортированный массив целых чисел длины N. Какой подход найдёт пару с суммой = target за O(N) без extra memory?',
    options: [
      'Хеш-таблица: один проход, сохраняем target - x',
      'Two pointers: l=0, r=N-1, двигаемся навстречу',
      'Бинарный поиск каждого x',
      'Сортировка + linear scan',
    ],
    correctIndex: 1,
    explanation:
      'Two pointers использует фактом что массив отсортирован — не нужна hash-map (O(N) extra). Hash подход тоже O(N) time но O(N) memory.',
    difficulty: 'medium',
  },
  {
    id: 'go_algo_2',
    prompt:
      'BFS vs DFS для нахождения кратчайшего пути в невзвешенном связном графе. Что использовать и почему?',
    options: [
      'DFS — глубина гарантирует кратчайший',
      'BFS — слой за слоем, первое достижение = кратчайший',
      'Dijkstra — стандартный выбор',
      'Union-Find — детектирует цикл',
    ],
    correctIndex: 1,
    explanation:
      'BFS обходит вершины слоями уровней. Первый раз когда достигаем target — это минимальное число рёбер. DFS может пойти длинной веткой первой.',
    difficulty: 'easy',
  },
  {
    id: 'go_algo_3',
    prompt:
      'Sliding window maximum: массив N, окно k. Какой подход даёт O(N)?',
    options: [
      'Brute force каждое окно — O(N·k)',
      'Heap (priority queue) — O(N log k)',
      'Monotonic deque — O(N) amortized',
      'Segment tree — O(N log N)',
    ],
    correctIndex: 2,
    explanation:
      'Monotonic decreasing deque держит индексы кандидатов на максимум. Каждый элемент входит/выходит из deque один раз → amortized O(1) на push/pop, итог O(N).',
    difficulty: 'hard',
  },
]

const GO_SYSDESIGN: SysDesignQuestion[] = [
  {
    id: 'go_sd_1',
    prompt:
      'Спроектируй URL shortener (как bit.ly). Перечисли ключевые компоненты + как генеришь короткие ID + как handle 1M req/s redirect.',
    keyPoints: [
      'base62',
      'redirect',
      'кеш',
      'cache',
      'redis',
      'memcached',
      'cdn',
      'database',
      'бд',
      'id',
      'collision',
      'hash',
      'counter',
      'snowflake',
      'shard',
      'replication',
      'partitioning',
      'rate limit',
      'analytics',
    ],
    hint:
      'Думай: hashing/counter для ID, hot reads → cache layer, write-once read-many access pattern.',
  },
  {
    id: 'go_sd_2',
    prompt:
      'Расскажи когда и зачем использовать CQRS (Command Query Responsibility Segregation). Какие trade-offs?',
    keyPoints: [
      'read',
      'write',
      'separation',
      'разделение',
      'eventual consistency',
      'eventual',
      'scale',
      'масштаб',
      'event sourcing',
      'projection',
      'read model',
      'write model',
      'optimization',
      'complexity',
      'сложность',
      'sync',
      'asynchronous',
    ],
    hint:
      'Думай: разные модели данных для команд и запросов, eventual consistency, когда оно overkill.',
  },
  {
    id: 'go_sd_3',
    prompt:
      'Стратегии cache invalidation в распределённой системе. Перечисли подходы + когда какой подходит.',
    keyPoints: [
      'ttl',
      'expire',
      'write-through',
      'write-back',
      'write-behind',
      'lru',
      'eviction',
      'invalidation',
      'inval',
      'pub/sub',
      'event',
      'версия',
      'version',
      'cache-aside',
      'lazy',
      'consistency',
    ],
    hint:
      'TTL, write-through, write-back, cache-aside; pub/sub для propagation; eviction policies.',
  },
]

const ML_ALGO: AlgoQuestion[] = [
  {
    id: 'ml_algo_1',
    prompt:
      'У тебя classification dataset с 99% класса A, 1% класса B. Random forest показывает 99% accuracy. Это хороший результат?',
    options: [
      'Да, 99% accuracy — отличный baseline',
      'Нет, baseline (always predict A) тоже даёт 99% — нужно смотреть precision/recall класса B',
      'Нужно увеличить n_estimators',
      'Применить one-hot encoding',
    ],
    correctIndex: 1,
    explanation:
      'Class imbalance: accuracy неинформативна. Если модель всегда predicts majority class — она получит accuracy = majority frequency. Лучше: precision, recall, F1, ROC-AUC, PR-AUC; SMOTE/class_weight.',
    difficulty: 'medium',
  },
  {
    id: 'ml_algo_2',
    prompt:
      'L1 vs L2 regularization. Чем они отличаются с точки зрения feature selection?',
    options: [
      'L1 и L2 эквивалентны',
      'L1 (Lasso) обнуляет коэффициенты → feature selection; L2 (Ridge) сжимает но не обнуляет',
      'L2 быстрее сходится',
      'L1 запрещает negative weights',
    ],
    correctIndex: 1,
    explanation:
      'L1 penalty (|w|) имеет gradient постоянный возле 0 → pushes weights ровно к 0 (sparse solution → feature selection). L2 penalty (w²) gradient линеен → equally shrinks all features.',
    difficulty: 'easy',
  },
  {
    id: 'ml_algo_3',
    prompt:
      'Transformer self-attention complexity по sequence length N?',
    options: [
      'O(N)',
      'O(N log N)',
      'O(N²)',
      'O(N³)',
    ],
    correctIndex: 2,
    explanation:
      'Self-attention computes attention matrix N×N (каждая позиция attends на каждую). Это O(N²) time + memory. Long-context оптимизации (Flash Attention, sparse attention) пытаются обойти этот bottleneck.',
    difficulty: 'medium',
  },
]

const ML_SYSDESIGN: SysDesignQuestion[] = [
  {
    id: 'ml_sd_1',
    prompt:
      'Спроектируй ML system для product recommendation (e-commerce). Какие компоненты + offline vs online flow?',
    keyPoints: [
      'feature store',
      'feature',
      'offline',
      'online',
      'training',
      'inference',
      'pipeline',
      'embedding',
      'candidate generation',
      'ranking',
      'collaborative filtering',
      'content-based',
      'a/b',
      'monitor',
      'drift',
      'logging',
      'metric',
      'latency',
    ],
    hint:
      'Подумай: candidate generation + ranking, offline training pipeline, online feature serving, A/B testing.',
  },
  {
    id: 'ml_sd_2',
    prompt:
      'Production ML model деградирует на новых данных. Какие виды drift возможны и как мониторить?',
    keyPoints: [
      'data drift',
      'feature drift',
      'covariate',
      'concept drift',
      'label drift',
      'distribution',
      'kolmogorov',
      'psi',
      'population stability index',
      'monitor',
      'alert',
      'retrain',
      'shadow model',
      'canary',
    ],
    hint:
      'Думай: data drift vs concept drift, статистические тесты на распределения, retraining strategy.',
  },
]

const ENGLISH_ALGO: AlgoQuestion[] = [
  {
    id: 'en_q_1',
    prompt: 'Choose the most natural way to answer "Tell me about a difficult project you led."',
    options: [
      'I have led many projects.',
      'Sure — let me walk you through one from last year. The challenge was...',
      'Yes I led project.',
      'My english is bad, sorry.',
    ],
    correctIndex: 1,
    explanation:
      'STAR-pattern openings («Let me walk you through») signal structured thinking. Generic «I have led many» wastes the interviewer\'s time.',
    difficulty: 'easy',
  },
  {
    id: 'en_q_2',
    prompt: 'Which sentence uses the conditional correctly?',
    options: [
      'If I would have known, I would tell you.',
      'If I had known, I would have told you.',
      'If I knew, I will tell you.',
      'If I know, I would have told you.',
    ],
    correctIndex: 1,
    explanation:
      'Past unreal conditional: «If + had + past participle, would have + past participle». Common mistake: doubling «would» в if-clause.',
    difficulty: 'medium',
  },
]

const ENGLISH_SYSDESIGN: SysDesignQuestion[] = [
  {
    id: 'en_sd_1',
    prompt:
      'Write a 3-sentence elevator pitch about a project you led. Focus on: what, why it mattered, your role.',
    keyPoints: [
      'project',
      'team',
      'lead',
      'led',
      'role',
      'goal',
      'outcome',
      'because',
      'so that',
      'impact',
      'because',
      'я',
      'i',
    ],
    hint: 'Use STAR-like structure: situation, task, action, result — in 3 sentences.',
  },
]

const TRACK_CONTENT: Record<MiniMockTrack, { algo: AlgoQuestion[]; sysdesign: SysDesignQuestion[] }> = {
  go: { algo: GO_ALGO, sysdesign: GO_SYSDESIGN },
  ml: { algo: ML_ALGO, sysdesign: ML_SYSDESIGN },
  english: { algo: ENGLISH_ALGO, sysdesign: ENGLISH_SYSDESIGN },
}

/**
 * Pick deterministic question pair для current take. MVP: pseudo-random но
 * stable per-day (одни и те же вопросы появляются если юзер открывает page
 * 5 раз в день — иначе грейминг).
 */
export function pickQuestions(track: MiniMockTrack): {
  algo: AlgoQuestion
  sysdesign: SysDesignQuestion
} {
  const content = TRACK_CONTENT[track]
  const today = new Date()
  const dayN = today.getFullYear() * 365 + today.getMonth() * 31 + today.getDate()
  const algo = content.algo[dayN % content.algo.length]
  const sysdesign = content.sysdesign[dayN % content.sysdesign.length]
  return { algo, sysdesign }
}

/**
 * Grade algo answer. 0 если неверно, scale by difficulty otherwise:
 *   easy correct = 3, medium = 4, hard = 5.
 *
 * Soft floor 0 (not negative — partial-credit MVP).
 */
export function gradeAlgo(q: AlgoQuestion, chosenIndex: number): number {
  if (chosenIndex !== q.correctIndex) return 0
  switch (q.difficulty) {
    case 'easy':
      return 3
    case 'medium':
      return 4
    case 'hard':
      return 5
  }
}

/**
 * Grade sysdesign open-text answer by keyword presence. Case-insensitive
 * substring match (allows Russian / English mixed).
 *
 * Score = matched / total * 5, clamped to 0..5.
 *
 * MVP heuristic: не оценивает quality of reasoning, лишь coverage. Backend
 * Phase E применит LLM rubric grading для quality dimensions.
 */
export function gradeSysDesign(q: SysDesignQuestion, answerText: string): {
  hits: string[]
  total: number
  score: number
} {
  const normalized = answerText.toLowerCase()
  const hits: string[] = []
  for (const kp of q.keyPoints) {
    if (normalized.includes(kp.toLowerCase())) {
      // Avoid double-count synonyms (e.g., «кеш» + «cache»).
      if (!hits.some((h) => h === kp)) hits.push(kp)
    }
  }
  const total = q.keyPoints.length
  const ratio = total === 0 ? 0 : hits.length / total
  // Soft scaling — even partial coverage gets credit. 30% of keys ≈ 3.0 score.
  const score = Math.max(0, Math.min(5, Math.round(ratio * 7 * 10) / 10))
  return { hits, total, score }
}

const KEY = 'druz9.mini_mock.last.v1'

export function saveResult(result: MiniMockResult): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(result))
  } catch {
    /* quota — silent */
  }
  // Cross-product wire: лог как mock activity → F5 / streak / readiness
  // boost естественно пикнут.
  logActivity({
    kind: 'mock',
    title: `Mini-mock · ${result.track} · ${result.overallScore.toFixed(1)}/5`,
    source: 'diagnostic',
    minutes: 20,
  })
}

export function loadResult(): MiniMockResult | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as MiniMockResult
    if (parsed && typeof parsed.overallScore === 'number') return parsed
    return null
  } catch {
    return null
  }
}

export function clearResult(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Age в днях от takenAt. null если result отсутствует.
 */
export function resultAgeDays(): number | null {
  const r = loadResult()
  if (!r) return null
  return Math.floor((Date.now() - r.takenAt) / (24 * 60 * 60 * 1000))
}

/**
 * Compose readiness factor из last mini-mock result. Используется в F3
 * computeReadiness. Возвращает null если result отсутствует ИЛИ старше
 * 14 дней (stale signal, не учитываем).
 *
 * Tier mapping:
 *   overall ≥ 4.0 → +15 «mini-mock strong»
 *   3.0 ≤ overall < 4.0 → +5 «mini-mock OK»
 *   2.0 ≤ overall < 3.0 → −5 «mini-mock weak — gaps выявлены»
 *   overall < 2.0 → −10 «mini-mock failed — критический gap»
 */
export function computeMiniMockFactor(): { delta: number; reason: string } | null {
  const r = loadResult()
  if (!r) return null
  const ageDays = Math.floor((Date.now() - r.takenAt) / (24 * 60 * 60 * 1000))
  if (ageDays > 14) return null

  if (r.overallScore >= 4.0) {
    return { delta: 15, reason: `Mini-mock ${r.overallScore.toFixed(1)}/5 — solid signal` }
  }
  if (r.overallScore >= 3.0) {
    return { delta: 5, reason: `Mini-mock ${r.overallScore.toFixed(1)}/5 — OK baseline` }
  }
  if (r.overallScore >= 2.0) {
    return { delta: -5, reason: `Mini-mock ${r.overallScore.toFixed(1)}/5 — gaps выявлены` }
  }
  return { delta: -10, reason: `Mini-mock ${r.overallScore.toFixed(1)}/5 — критический gap` }
}
