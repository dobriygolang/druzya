// Personas — expert-mode presets for the compact quick-prompt flow.
//
// Each persona bundles:
//   • a system-prompt prefix that steers the LLM toward a narrow expertise
//     (React / System Design / SRE / Behavioral / DSA)
//   • a suggested llmchain model family (via backend Task routing) —
//     "reasoning" for system-design, "coder" for React, etc.
//   • a brand color driving the compact-window brand-mark gradient so
//     the user gets instant visual feedback for "I'm in the right mode"
//
// The prefix is prepended CLIENT-SIDE to the user's promptText at
// analyze.start time. We deliberately do NOT push this through a new
// proto field because:
//   1. Proto regen is a pain in this codebase (buf tooling + 15 service
//      mod updates). We did the same dance for vacancies/ai-model — kept
//      it REST-only for the same reason.
//   2. LLMs treat a "[Instructions: you are X]\n\n<user text>" prefix as
//      authoritatively as a system message. The baked-in copilot system
//      prompt still applies; the persona just adds narrowed focus.
//
// Keep prompts in Russian — default UI language. English works too
// since the LLM is bilingual; user is likely to type in Russian anyway.

import type { Task } from './llm-tasks';

export interface Persona {
  /** Stable id; used in zustand store + analytics. Never rename without
   *  a migration — users' last pick is persisted by id. */
  id: string;
  /** UI label. Short — compact dropdown rows are ~22 chars wide. */
  label: string;
  /** One-line tooltip shown on hover of the dropdown row. */
  hint: string;
  /** Emoji used as the row icon. Avoid Unicode-only glyphs that don't
   *  render on older macOS (pre-Monterey). Tested set below works. */
  icon: string;
  /** CSS gradient applied to the compact brand-mark when this persona
   *  is active. Two-stop gradient — short enough to keep the 22×22 mark
   *  readable at small sizes. */
  brandGradient: string;
  /** Task hint. When persona switches, we nudge the selected-model to
   *  a sensible default for that task — user can still override via
   *  the picker. undefined = keep whatever was selected. */
  suggestedTask?: Task;
  /** System-prompt prefix prepended to the user's first message of a
   *  turn. Includes a newline separator so the LLM sees it as a
   *  standalone instruction block. */
  prefix: string;
}

/**
 * Default persona — no prefix, no model override. Keeps behavior
 * identical to pre-personas shipping for users who just type and
 * don't touch the picker.
 */
export const DefaultPersona: Persona = {
  id: 'default',
  label: 'Обычный',
  hint: 'Без специализации — универсальный режим',
  icon: '💬',
  brandGradient: 'linear-gradient(135deg, var(--d-accent) 0%, var(--d-accent-2) 100%)',
  prefix: '',
};

/**
 * Personas catalog. Order here = order in the dropdown. Default first
 * so the picker opens showing "none" as a reset option.
 */
export const Personas: Persona[] = [
  DefaultPersona,
  {
    id: 'react',
    label: 'React Expert',
    hint: 'React · TypeScript · Next.js · performance',
    icon: '⚛️',
    brandGradient: 'linear-gradient(135deg, #61dafb 0%, #3178c6 100%)',
    suggestedTask: 'coder',
    prefix:
      'Инструкция: ты senior React-разработчик. Отвечаешь строго в контексте ' +
      'React / TypeScript / Next.js / React Query / Zustand. Всегда показывай ' +
      'рабочий код в fenced-блоке с language-тегом. Упоминай re-render impact, ' +
      'hooks rules, concurrent-режим когда это уместно. Если вопрос вне ' +
      'фронтенд-стека — честно скажи что это не твоя специализация.',
  },
  {
    id: 'system-design',
    label: 'System Design',
    hint: 'Distributed systems · SRE · capacity planning',
    icon: '🏛️',
    brandGradient: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
    suggestedTask: 'reasoning',
    prefix:
      'Инструкция: ты senior system-design интервьюер из FAANG. Отвечаешь ' +
      'по схеме: (1) clarify requirements — что именно строим, какой QPS, SLA, ' +
      'consistency; (2) high-level architecture — компоненты и их API; ' +
      '(3) deep-dives — шардирование, кеш, очереди, репликация; (4) trade-offs — ' +
      'где cut corners на MVP. Числовые прикидки (QPS, storage, bandwidth) ' +
      'обязательно. Рисуй ASCII-диаграммы когда помогает.',
  },
  {
    id: 'go-sre',
    label: 'Go / SRE',
    hint: 'Go · Kubernetes · observability · incident response',
    icon: '🐹',
    brandGradient: 'linear-gradient(135deg, #00add8 0%, #5ac8e6 100%)',
    suggestedTask: 'coder',
    prefix:
      'Инструкция: ты senior Go-разработчик и SRE. Отвечаешь в контексте ' +
      'Go / gRPC / Kubernetes / Prometheus / OpenTelemetry. Для кода — ' +
      'идиоматичный Go с корректной обработкой ошибок (errors.Is/As, ' +
      'wrapping), context-propagation и отсутствием goroutine-ликов. ' +
      'Для infra-вопросов — объясняй через debugging-first lens: какие ' +
      'метрики / логи / traces смотреть, какие k8s-события, как ' +
      'воспроизвести. Ссылайся на конкретные Go-пакеты и k8s-объекты.',
  },
  {
    id: 'behavioral',
    label: 'Behavioral',
    hint: 'STAR · leadership · conflict · trade-offs',
    icon: '🎭',
    brandGradient: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
    suggestedTask: 'insight',
    prefix:
      'Инструкция: ты поведенческий коуч для Big-Tech интервью. Отвечаешь ' +
      'строго по STAR-формату (Situation · Task · Action · Result) когда ' +
      'это ответ на поведенческий вопрос. Фокус на метриках результата, ' +
      'конкретных решениях и lessons learned. Если вопрос — это framework ' +
      'самого интервьюера (тип "how to tell stories"), дай компактный ' +
      'шаблон. Никакой воды; каждое предложение должно нести факт или ' +
      'инструкцию.',
  },
  {
    id: 'dsa',
    label: 'DSA',
    hint: 'Algorithms · data structures · LeetCode-style problems',
    icon: '🧮',
    brandGradient: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
    suggestedTask: 'coder',
    prefix:
      'Инструкция: ты senior интервьюер по алгоритмам. Отвечаешь по схеме: ' +
      '(1) переформулируй задачу своими словами + edge-cases; ' +
      '(2) brute-force подход + его сложность; ' +
      '(3) оптимальное решение с обоснованием почему именно так; ' +
      '(4) код на Go или Python — выбор по контексту вопроса; ' +
      '(5) анализ time/space complexity строго в O-нотации. ' +
      'Именуй паттерн (two pointers, sliding window, monotonic stack…) ' +
      'явно.',
  },
];

export function findPersona(id: string): Persona {
  return Personas.find((p) => p.id === id) ?? DefaultPersona;
}
