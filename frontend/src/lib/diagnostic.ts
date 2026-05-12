// diagnostic.ts — F9 (Phase B+C) Diagnostic Quiz multi-track.
//
// Цель: replace Atlas-Pokedex first impression. Юзер выбирает track (Go /
// ML / English), отвечает на 8 quick questions → heuristic resolver выдаёт
// (a) suggested goal preset для F2 GoalWizard и (b) 3 first-week actions.
//
// Backend-free: questions hard-coded per-track, mapping детерминированный.
// Когда Phase C ship'нет TaskAtlasClassify / TaskCustomPathGenerate,
// заменим resolver'а на LLM call но сохраним same answer shape.

import type { GoalKind, TopTierCompany, UserGoal } from './goal'

export type DiagnosticTrack = 'go' | 'ml' | 'english'

export const TRACK_LABELS: Record<DiagnosticTrack, { label: string; hint: string }> = {
  go: {
    label: 'Go senior',
    hint: 'Backend на Go, distributed, sysdesign — подготовка к senior+ IT интервью',
  },
  ml: {
    label: 'ML engineering',
    hint: 'ML / DL / production ML — подготовка к MLE / DS / Research позиции',
  },
  english: {
    label: 'English fluency',
    hint: 'TOEFL / IELTS / CEFR B2-C1 — подготовка к international interviews и работе',
  },
}

export interface DiagnosticOption {
  id: string
  label: string
  hint?: string
}

export interface DiagnosticQuestion {
  id: string
  text: string
  options: DiagnosticOption[]
}

// 8 questions Go senior track. Каждый id используется в DiagnosticAnswers
// как key. Опции — exhaustive set, юзер выбирает один.
export const GO_QUESTIONS: DiagnosticQuestion[] = [
  {
    id: 'experience',
    text: 'Сколько лет на Go в проде?',
    options: [
      { id: '0_1', label: '<1 года', hint: 'свежий бэкендер / переход с другого языка' },
      { id: '1_3', label: '1-3 года', hint: 'middle developer' },
      { id: '3_5', label: '3-5 лет', hint: 'middle/senior' },
      { id: '5_plus', label: '5+ лет', hint: 'senior+ / staff' },
    ],
  },
  {
    id: 'strongest',
    text: 'Где себя чувствуешь увереннее всего?',
    options: [
      { id: 'algos', label: 'Алгоритмы + структуры', hint: 'LeetCode medium-hard solving fluently' },
      { id: 'concurrency', label: 'Concurrency + Go runtime', hint: 'goroutines, channels, GC, scheduler' },
      { id: 'sysdesign', label: 'System design', hint: 'distributed, sharding, caching, queues' },
      { id: 'backend_apis', label: 'API + микросервисы', hint: 'gRPC, REST, observability' },
    ],
  },
  {
    id: 'weakest',
    text: 'А где плывёшь?',
    options: [
      { id: 'algos', label: 'Алгоритмы', hint: 'теряешься на medium DP / графы' },
      { id: 'concurrency', label: 'Concurrency tricks', hint: 'data races, channels semantics' },
      { id: 'sysdesign', label: 'System design', hint: 'не знаешь как scale до миллионов RPS' },
      { id: 'databases', label: 'Базы + транзакции', hint: 'isolation levels, indices, partitioning' },
      { id: 'distributed', label: 'Распределённые системы', hint: 'consensus, replication, CAP' },
    ],
  },
  {
    id: 'target_co',
    text: 'Кто целевой работодатель?',
    options: [
      { id: 'top_tier', label: 'Top-tier (Yandex / Ozon / Tinkoff / VK / etc.)' },
      { id: 'big_tech', label: 'Big tech FAANG (Google / Meta / Amazon)' },
      { id: 'any_senior', label: 'Любая компания, фокус на senior level' },
      { id: 'startup', label: 'Стартап / scale-up' },
    ],
  },
  {
    id: 'target_level',
    text: 'Какой level метишь?',
    options: [
      { id: 'middle', label: 'Middle → Senior bump' },
      { id: 'senior', label: 'Senior IC' },
      { id: 'staff', label: 'Staff / Principal' },
    ],
  },
  {
    id: 'status',
    text: 'Где сейчас?',
    options: [
      { id: 'employed_growing', label: 'Работаю, готовлюсь без срочности' },
      { id: 'employed_searching', label: 'Работаю, активно ищу' },
      { id: 'between_jobs', label: 'Между офферами' },
      { id: 'refreshing', label: 'Освежаю скиллы, прицельных интервью нет' },
    ],
  },
  {
    id: 'daily_budget',
    text: 'Сколько часов в день можешь стабильно отдавать подготовке?',
    options: [
      { id: '0_1', label: '<1 часа', hint: '20-45 минут на focus' },
      { id: '1_2', label: '1-2 часа' },
      { id: '2_4', label: '2-4 часа' },
      { id: '4_plus', label: '4+ часов', hint: 'sabbatical / between jobs' },
    ],
  },
  {
    id: 'timeline',
    text: 'Когда хочешь быть готов?',
    options: [
      { id: '1m', label: 'Через месяц — горит' },
      { id: '3m', label: 'Через 3 месяца' },
      { id: '6m', label: 'Через 6 месяцев' },
      { id: '12m', label: 'Через год — основательно' },
    ],
  },
]

// 8 questions ML engineering track. Same id pattern (experience / strongest /
// weakest / target_co / target_level / status / daily_budget / timeline) так
// что resolver и downstream UI могут читать одну shape. Содержание ML-specific.
export const ML_QUESTIONS: DiagnosticQuestion[] = [
  {
    id: 'experience',
    text: 'Сколько лет в ML в проде / production?',
    options: [
      { id: '0_1', label: '<1 года', hint: 'свежий MLE / переход из smth-else' },
      { id: '1_3', label: '1-3 года', hint: 'junior/middle MLE' },
      { id: '3_5', label: '3-5 лет', hint: 'middle/senior MLE' },
      { id: '5_plus', label: '5+ лет', hint: 'senior+ / staff ML' },
    ],
  },
  {
    id: 'strongest',
    text: 'Где сильнее всего?',
    options: [
      { id: 'classical', label: 'Classical ML', hint: 'sklearn / gradient boosting / feature engineering' },
      { id: 'deep_learning', label: 'Deep Learning', hint: 'PyTorch / Transformers / fine-tuning' },
      { id: 'mlops', label: 'MLOps + production', hint: 'pipelines / monitoring / deploy / drift' },
      { id: 'research', label: 'Research / papers', hint: 'novel architectures / ablation / paper-reading' },
    ],
  },
  {
    id: 'weakest',
    text: 'А где плывёшь?',
    options: [
      { id: 'classical', label: 'Classical ML basics', hint: 'random forests / GBM / regularization tricks' },
      { id: 'deep_learning', label: 'Deep learning internals', hint: 'attention / optimizer math / training stability' },
      { id: 'mlops', label: 'MLOps + production', hint: 'model serving / monitoring / A/B testing' },
      { id: 'statistics', label: 'Statistics / experiments', hint: 'A/B test design, power analysis, causal' },
      { id: 'systems', label: 'ML systems design', hint: 'recsys / ranking / feature store / data pipelines' },
    ],
  },
  {
    id: 'target_co',
    text: 'Кто целевой работодатель?',
    options: [
      { id: 'top_tier', label: 'Top-tier RU (Yandex / VK / Tinkoff / Sber AI)' },
      { id: 'big_tech', label: 'Big tech (Google / Meta / OpenAI / Anthropic)' },
      { id: 'any_ml', label: 'Любая ML позиция, фокус на role' },
      { id: 'startup', label: 'AI стартап / scale-up' },
    ],
  },
  {
    id: 'target_level',
    text: 'Какую роль метишь?',
    options: [
      { id: 'mle', label: 'ML Engineer (production)' },
      { id: 'researcher', label: 'ML Researcher (papers + experiments)' },
      { id: 'applied', label: 'Applied ML Scientist' },
      { id: 'staff', label: 'Staff / Principal ML' },
    ],
  },
  {
    id: 'status',
    text: 'Где сейчас?',
    options: [
      { id: 'employed_growing', label: 'Работаю, готовлюсь без срочности' },
      { id: 'employed_searching', label: 'Работаю, активно ищу' },
      { id: 'between_jobs', label: 'Между офферами' },
      { id: 'refreshing', label: 'Освежаю скиллы, прицельных интервью нет' },
    ],
  },
  {
    id: 'daily_budget',
    text: 'Сколько часов в день можешь стабильно отдавать подготовке?',
    options: [
      { id: '0_1', label: '<1 часа', hint: 'paper-reading в обед' },
      { id: '1_2', label: '1-2 часа' },
      { id: '2_4', label: '2-4 часа' },
      { id: '4_plus', label: '4+ часов', hint: 'sabbatical / focused prep' },
    ],
  },
  {
    id: 'timeline',
    text: 'Когда хочешь быть готов?',
    options: [
      { id: '1m', label: 'Через месяц — горит' },
      { id: '3m', label: 'Через 3 месяца' },
      { id: '6m', label: 'Через 6 месяцев' },
      { id: '12m', label: 'Через год — основательно' },
    ],
  },
]

// 8 questions English fluency track. Shape mirrors других tracks; content
// align'ится с CEFR / TOEFL / IELTS reality.
export const ENGLISH_QUESTIONS: DiagnosticQuestion[] = [
  {
    id: 'experience',
    text: 'Какой текущий уровень English?',
    options: [
      { id: '0_1', label: 'A2 — beginner+', hint: 'basic conversation, struggling with anything technical' },
      { id: '1_3', label: 'B1 — intermediate', hint: 'OK на простых meeting, ломаюсь на abstract topics' },
      { id: '3_5', label: 'B2 — upper-int', hint: 'свободные meetings, fluency provider gaps есть' },
      { id: '5_plus', label: 'C1+ — advanced', hint: 'native-grade, refinement only' },
    ],
  },
  {
    id: 'strongest',
    text: 'Что лучше всего?',
    options: [
      { id: 'reading', label: 'Reading', hint: 'спокойно читаю tech blog / papers' },
      { id: 'writing', label: 'Writing', hint: 'pull requests / docs пишу без особых усилий' },
      { id: 'listening', label: 'Listening', hint: 'YouTube / podcasts без subtitles' },
      { id: 'speaking', label: 'Speaking', hint: 'meetings / interviews — могу долго говорить' },
    ],
  },
  {
    id: 'weakest',
    text: 'А где провал?',
    options: [
      { id: 'speaking', label: 'Speaking fluency', hint: 'тяжело в realtime / спотыкаюсь / akcent' },
      { id: 'listening', label: 'Listening (fast / acc)', hint: 'не разбираю Indian / Aussie / strong British' },
      { id: 'writing', label: 'Writing structure', hint: 'формальные emails / argumentative essays' },
      { id: 'grammar', label: 'Grammar (advanced)', hint: 'past perfect / subjunctive / conditionals' },
      { id: 'vocab', label: 'Active vocabulary', hint: 'много words знаю passively, не использую' },
    ],
  },
  {
    id: 'target_co',
    text: 'Зачем нужен English?',
    options: [
      { id: 'top_tier', label: 'Top-tier RU с English-speaking team (Yandex Global / EPAM)' },
      { id: 'big_tech', label: 'International big tech (FAANG / European)' },
      { id: 'any_ml', label: 'Релокация — любая роль' },
      { id: 'startup', label: 'Удалёнка / freelance / startup' },
    ],
  },
  {
    id: 'target_level',
    text: 'Какой target?',
    options: [
      { id: 'mle', label: 'TOEFL 100+ (US / Canada relocation)' },
      { id: 'researcher', label: 'IELTS 7+ (UK / Aus / NZ)' },
      { id: 'applied', label: 'CEFR B2 — для работы в EN team' },
      { id: 'staff', label: 'CEFR C1+ — fluent для leadership' },
    ],
  },
  {
    id: 'status',
    text: 'Где сейчас?',
    options: [
      { id: 'employed_growing', label: 'Работаю, готовлюсь без срочности' },
      { id: 'employed_searching', label: 'Работаю, есть interview-pipe' },
      { id: 'between_jobs', label: 'Между офферами' },
      { id: 'refreshing', label: 'Освежаю — exam дата ещё далеко' },
    ],
  },
  {
    id: 'daily_budget',
    text: 'Сколько часов в день можешь отдавать?',
    options: [
      { id: '0_1', label: '<1 часа', hint: '15-30 мин active speaking + 30 мин YouTube' },
      { id: '1_2', label: '1-2 часа' },
      { id: '2_4', label: '2-4 часа', hint: 'serious prep — speaking sessions + Anki' },
      { id: '4_plus', label: '4+ часов', hint: 'immersion mode' },
    ],
  },
  {
    id: 'timeline',
    text: 'Когда нужен result?',
    options: [
      { id: '1m', label: 'Через месяц — exam близко' },
      { id: '3m', label: 'Через 3 месяца' },
      { id: '6m', label: 'Через 6 месяцев' },
      { id: '12m', label: 'Через год — основательно' },
    ],
  },
]

export const QUESTIONS_BY_TRACK: Record<DiagnosticTrack, DiagnosticQuestion[]> = {
  go: GO_QUESTIONS,
  ml: ML_QUESTIONS,
  english: ENGLISH_QUESTIONS,
}

/** Helper для UI — возвращает question bank для текущего track'а. */
export function getQuestionsForTrack(track: DiagnosticTrack): DiagnosticQuestion[] {
  return QUESTIONS_BY_TRACK[track]
}

export type AnswerMap = Record<string, string>

export interface DiagnosticAction {
  /** Stable id для дедупа — две карточки с одним id выбираются один раз. */
  id: string
  title: string
  /** 1-line почему это рекомендация — связь с answers. */
  rationale: string
  /** Куда ведёт CTA. /atlas/track/* / /mock / external URL. */
  href: string
  /** Тип ресурса — рендеринг иконки. */
  kind: 'mock' | 'atlas' | 'codex' | 'external'
}

export interface DiagnosticResult {
  /** F2 goal preset который имеет смысл из ответов. Юзер потом может
   * подтвердить «Принять» или открыть GoalWizardModal и подредактировать. */
  goalDraft: Omit<UserGoal, 'createdAt' | 'updatedAt'>
  /** 3 first-week actions, ranked by relevance. */
  actions: DiagnosticAction[]
}

// resolve() — pure deterministic mapper. Без LLM. Track-aware. Heuristic edges:
//
//   Go track:
//   - weakest='algos' → recommend «Algo mock» как первый action
//   - weakest='sysdesign' OR target_level='staff' → SysDesign mock
//   - status='employed_searching' OR timeline='1m' → Mock pipeline ASAP
//
//   ML track:
//   - weakest='classical' → recommend ods.ai ML course + Kaggle
//   - weakest='deep_learning' → fast.ai / Karpathy lectures
//   - weakest='mlops' → production ML deep-dive + book
//   - weakest='systems' → ML system design (Chip Huyen book)
//
//   English track:
//   - weakest='speaking' → daily speaking session (italki / VR practice)
//   - target='TOEFL 100+' → focused prep на 4-section breakdown
//   - timeline='1m' → ramp-up mode (exam-style daily drills)
//
// target_date резолвится из timeline в future date относительно «сегодня».
export function resolveDiagnostic(
  answers: AnswerMap,
  track: DiagnosticTrack = 'go',
): DiagnosticResult {
  const todayMs = Date.now()
  const months: Record<string, number> = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }
  const timelineKey = answers.timeline ?? '6m'
  const monthsAhead = months[timelineKey] ?? 6
  const target = new Date(todayMs)
  target.setMonth(target.getMonth() + monthsAhead)
  const targetDate = target.toISOString().slice(0, 10) // yyyy-mm-dd

  // Goal draft mapping — track-aware. ML и English routes mostly через
  // their own goal kinds (ml_offer / english_target); top-tier co остаётся
  // как modifier.
  let goalKind: GoalKind = 'any_senior'
  let goalCompany: TopTierCompany | undefined
  let goalText: string | undefined
  const targetCo = answers.target_co
  const targetLevel = answers.target_level

  if (track === 'english') {
    // English track — goal kind=english_target. targetLevel определяет text.
    goalKind = 'english_target'
    if (targetLevel === 'mle') goalText = 'TOEFL 100+'
    else if (targetLevel === 'researcher') goalText = 'IELTS 7+'
    else if (targetLevel === 'applied') goalText = 'CEFR B2+'
    else if (targetLevel === 'staff') goalText = 'CEFR C1+'
  } else if (track === 'ml') {
    // ML track — goal kind=ml_offer. Top-tier modifier preserves company.
    if (targetCo === 'top_tier') {
      goalKind = 'top_tier_co'
      goalCompany = 'Yandex'
    } else if (targetCo === 'big_tech') {
      goalKind = 'top_tier_co'
      goalCompany = 'Google'
    } else {
      goalKind = 'ml_offer'
    }
  } else {
    // Go track — existing logic.
    if (targetCo === 'top_tier') {
      goalKind = 'top_tier_co'
      goalCompany = 'Yandex'
    } else if (targetCo === 'big_tech') {
      goalKind = 'top_tier_co'
      goalCompany = 'Google'
    } else {
      goalKind = 'any_senior'
    }
  }

  const goalDraft: Omit<UserGoal, 'createdAt' | 'updatedAt'> = {
    kind: goalKind,
    targetCompany: goalCompany,
    targetText: goalText,
    targetDate,
  }

  // Action recommendations — heuristic, deterministic. Каждый action генерится
  // когда match'ится condition; в конце score-sort'им и берём top 3.
  const candidates: Array<DiagnosticAction & { score: number }> = []

  const weakest = answers.weakest
  const exp = answers.experience
  const status = answers.status
  const dailyBudget = answers.daily_budget

  // ── Track-specific recommendations ─────────────────────────────────────
  if (track === 'ml') {
    // ML weak-area focus actions.
    if (weakest === 'classical') {
      candidates.push({
        id: 'ml-classical-deep',
        title: 'ods.ai ML course + 1 Kaggle competition',
        rationale: 'Classical ML — основа MLE interview. ods.ai лучший RU course; Kaggle drill даёт practical.',
        href: '/codex',
        kind: 'codex',
        score: 95,
      })
    }
    if (weakest === 'deep_learning') {
      candidates.push({
        id: 'ml-dl-deep',
        title: 'Karpathy «Zero to Hero» + fast.ai pt2',
        rationale: 'Лучшие materials для DL internals. Без них на DL screens плывёшь.',
        href: '/codex',
        kind: 'codex',
        score: 95,
      })
    }
    if (weakest === 'mlops') {
      candidates.push({
        id: 'ml-mlops-deep',
        title: 'Chip Huyen «Designing ML Systems» (ch.3-7)',
        rationale: 'Production ML — самая дорогая зона роста для MLE senior offer.',
        href: '/codex',
        kind: 'codex',
        score: 90,
      })
    }
    if (weakest === 'systems') {
      candidates.push({
        id: 'ml-systems-deep',
        title: 'ML system design (recsys / ranking / feature store)',
        rationale: 'ML system design — отдельный screen, без него staff offer закрыть нельзя.',
        href: '/atlas/track/ml-systems',
        kind: 'atlas',
        score: 90,
      })
    }
    if (weakest === 'statistics') {
      candidates.push({
        id: 'ml-stats-deep',
        title: 'A/B testing + causal inference (Stats refresher)',
        rationale: 'Senior MLE expected to design experiments — без статов interview rejected.',
        href: '/codex',
        kind: 'codex',
        score: 85,
      })
    }
  }

  if (track === 'english') {
    // English weak-area focus actions.
    if (weakest === 'speaking') {
      candidates.push({
        id: 'en-speaking-daily',
        title: 'Daily speaking session (italki / VR / shadowing)',
        rationale: 'Speaking only improves через speaking. 30 мин/день active output обязательно.',
        href: '/codex',
        kind: 'external',
        score: 100,
      })
    }
    if (weakest === 'listening') {
      candidates.push({
        id: 'en-listening-immersion',
        title: 'Listening immersion (podcasts + YouTube без subtitles)',
        rationale: 'Daily 30+ мин с native acc + diverse accents. Acoustic training даёт результат за 2-3 мес.',
        href: '/codex',
        kind: 'external',
        score: 95,
      })
    }
    if (weakest === 'writing') {
      candidates.push({
        id: 'en-writing-drill',
        title: 'Writing drills (Toefl-style essays / formal emails)',
        rationale: 'Структура важнее grammar — practice 30 мин/день с feedback (AI / italki tutor).',
        href: '/codex',
        kind: 'codex',
        score: 85,
      })
    }
    if (weakest === 'grammar') {
      candidates.push({
        id: 'en-grammar-drill',
        title: 'Grammar deep-dive (Murphy ch.7-15 + drill)',
        rationale: 'Advanced grammar — Murphy/Hewings лучший resource. Систематический passage.',
        href: '/codex',
        kind: 'codex',
        score: 80,
      })
    }
    if (weakest === 'vocab') {
      candidates.push({
        id: 'en-vocab-active',
        title: 'Anki SRS — active vocab daily',
        rationale: 'Passive→active conversion через spaced repetition. 20 cards/day = 2k слов за квартал.',
        href: '/codex',
        kind: 'external',
        score: 75,
      })
    }
    // Universal English exam prep — если timeline tight.
    if (timelineKey === '1m' || timelineKey === '3m') {
      candidates.push({
        id: 'en-exam-prep',
        title: 'Exam-style mock test (TOEFL / IELTS sample)',
        rationale: 'Sample test раз в неделю — best calibration для exam-pacing.',
        href: '/mock',
        kind: 'mock',
        score: 90,
      })
    }
  }

  // 1. Mock pipeline ASAP — для тех кто горит / активно ищет (Go + ML).
  if (
    track !== 'english' &&
    (status === 'employed_searching' || status === 'between_jobs' || timelineKey === '1m')
  ) {
    candidates.push({
      id: 'mock-pipeline',
      title: 'Сыграть mock-pipeline (HR + Algo + SysDesign)',
      rationale: 'Срочность интервью — лучше калибровать рано чем поздно. Mock даст baseline 5-axis radar.',
      href: '/mock',
      kind: 'mock',
      score: 100,
    })
  }

  // 2. Algo focus mock — если weakest=algos OR target_level=staff (где
  // алгоритмы важны для FAANG-style screens).
  if (weakest === 'algos' || targetLevel === 'staff' || (exp === '0_1' || exp === '1_3')) {
    candidates.push({
      id: 'algo-mock',
      title: 'Algo mock-сессия (medium-hard)',
      rationale:
        weakest === 'algos'
          ? 'Сам указал algos как слабое место — таргет первый.'
          : 'FAANG / staff role — algo screen решающий.',
      href: '/mock?stage=algo',
      kind: 'mock',
      score: 90,
    })
  }

  // 3. System design — если weakest=sysdesign / target_level=staff / target_co=top_tier.
  if (weakest === 'sysdesign' || targetLevel === 'staff' || targetCo === 'big_tech') {
    candidates.push({
      id: 'sysdesign-deep',
      title: 'System Design deep-dive (DDIA + 2 mock)',
      rationale:
        weakest === 'sysdesign'
          ? 'Sys-design — твой weakest. Без него senior offer не закроешь.'
          : 'Staff / FAANG роль — sys-design экзамен критичен.',
      href: '/atlas/track/system-design',
      kind: 'atlas',
      score: 85,
    })
  }

  // 4. Concurrency deep — если weakest=concurrency.
  if (weakest === 'concurrency') {
    candidates.push({
      id: 'concurrency-go',
      title: 'Go concurrency internals (Strang + Go in 50 examples)',
      rationale: 'Channels semantics + goroutine scheduling — Go senior must-know.',
      href: '/atlas/track/go-concurrency',
      kind: 'atlas',
      score: 80,
    })
  }

  // 5. Distributed systems — если weakest=distributed OR target_level=staff.
  if (weakest === 'distributed' || targetLevel === 'staff') {
    candidates.push({
      id: 'distributed-deep',
      title: 'Distributed systems (Kleinberg + Raft paper)',
      rationale: 'Consensus + replication + CAP — обязательная база для senior+.',
      href: '/atlas/track/distributed-systems',
      kind: 'atlas',
      score: 75,
    })
  }

  // 6. Databases deep — если weakest=databases.
  if (weakest === 'databases') {
    candidates.push({
      id: 'databases-deep',
      title: 'DB internals (DDIA ch.3-7 + Postgres EXPLAIN drills)',
      rationale: 'Isolation levels + indices + partitioning ставят senior apart от middle.',
      href: '/atlas/track/databases',
      kind: 'atlas',
      score: 70,
    })
  }

  // 7. Daily focus block setup — если daily_budget>=2h. Это setup не action,
  // но юзеру важно его сразу установить (Hone discoverability).
  if (dailyBudget === '2_4' || dailyBudget === '4_plus') {
    candidates.push({
      id: 'hone-setup',
      title: 'Настроить daily focus (Hone)',
      rationale: '2+ часов в день = нужен structured plan. Hone делает auto-categorise.',
      href: '/today',
      kind: 'external',
      score: 60,
    })
  }

  // 8. Codex review — если experience=5+ + status=refreshing → курсы не нужны,
  // нужен review.
  if (exp === '5_plus' && status === 'refreshing') {
    candidates.push({
      id: 'codex-senior',
      title: 'Прочесть Codex по senior-skip-the-basics topics',
      rationale: 'Опытному ревью важнее чем re-learning. Codex — самые плотные refresher\'ы.',
      href: '/codex',
      kind: 'codex',
      score: 55,
    })
  }

  // Default fallback — если ничего не match'нулось (нереалистично т.к.
  // questions exhaustive, но defensive):
  if (candidates.length === 0) {
    candidates.push(
      {
        id: 'mock-pipeline-fallback',
        title: 'Начать с mock-pipeline',
        rationale: 'Baseline diagnostic — увидеть свой 5-axis radar.',
        href: '/mock',
        kind: 'mock',
        score: 50,
      },
      {
        id: 'atlas-explore',
        title: 'Изучить Skill Atlas',
        rationale: 'Карта тем — выбрать что подтянуть.',
        href: '/atlas',
        kind: 'atlas',
        score: 40,
      },
      {
        id: 'codex-fallback',
        title: 'Полистать Codex',
        rationale: 'Curated reading library — узнать что есть.',
        href: '/codex',
        kind: 'codex',
        score: 30,
      },
    )
  }

  candidates.sort((a, b) => b.score - a.score)
  const actions = candidates.slice(0, 3).map(({ score: _score, ...rest }) => rest)

  return { goalDraft, actions }
}

// Storage helpers — persist quiz progress / result / track в localStorage
// так что reload во время прохождения не теряет ответы.
const PROGRESS_KEY = 'druz9.diagnostic.progress.v1'
const RESULT_KEY = 'druz9.diagnostic.result.v1'
const TRACK_KEY = 'druz9.diagnostic.track.v1'

const TRACK_VALUES: DiagnosticTrack[] = ['go', 'ml', 'english']

export function saveTrack(track: DiagnosticTrack): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TRACK_KEY, track)
  } catch {
    /* ignore */
  }
}

export function loadTrack(): DiagnosticTrack | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(TRACK_KEY)
    return raw && (TRACK_VALUES as string[]).includes(raw) ? (raw as DiagnosticTrack) : null
  } catch {
    return null
  }
}

export function clearTrack(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(TRACK_KEY)
  } catch {
    /* ignore */
  }
}

export function saveProgress(answers: AnswerMap): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(answers))
  } catch {
    /* ignore */
  }
}

export function loadProgress(): AnswerMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY)
    return raw ? (JSON.parse(raw) as AnswerMap) : {}
  } catch {
    return {}
  }
}

export function clearProgress(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(PROGRESS_KEY)
  } catch {
    /* ignore */
  }
}

export function saveResult(result: DiagnosticResult): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RESULT_KEY, JSON.stringify(result))
  } catch {
    /* ignore */
  }
}

export function loadResult(): DiagnosticResult | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(RESULT_KEY)
    return raw ? (JSON.parse(raw) as DiagnosticResult) : null
  } catch {
    return null
  }
}
