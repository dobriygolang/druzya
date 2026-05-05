// Статический контент страницы /help. FAQ + categories + contacts —
// контент-данные, не runtime-state. Нет смысла плодить ручку /help в backend
// ради статики; редактируется здесь, попадает в bundle при build.
//
// Если в будущем потребуется CMS / dynamic articles — заменить импорт в
// pages/HelpPage.tsx на useQuery к новому endpoint'у.

import type { ReactNode } from 'react'
import {
  Rocket,
  Swords,
  Shield,
  Crown,
  Sparkles,
  Lock,
  MessageCircle,
  Mail,
  Send,
  Code as Github,
} from 'lucide-react'
import { createElement } from 'react'

export type HelpCategory = {
  slug: string
  icon: ReactNode
  color: string
  bg: string
  label: string
  count: number
}

export type HelpFAQ = {
  id: string
  question: string
  answer: ReactNode // JSX чтобы вставить ссылки/код-блоки
  tags?: string[]
}

export type HelpContact = {
  kind: 'email' | 'telegram' | 'discord' | 'github'
  icon: ReactNode
  label: string
  value: string
  href?: string
}

const ic = (Comp: typeof Rocket, cls = 'h-5 w-5') => createElement(Comp, { className: cls })

// Identity 2026-05-04: arena/cohort выпилены, gamification — нет.
// Категории — продуктовые поверхности: Mock / Atlas / Coach / Tutor toolkit.
export const HELP_CATEGORIES: HelpCategory[] = [
  { slug: 'start', icon: ic(Rocket), color: 'text-text-secondary', bg: 'bg-text-primary/10', label: 'Старт', count: 8 },
  { slug: 'mock', icon: ic(Swords), color: 'text-text-primary', bg: 'bg-text-primary/15', label: 'Mock-сессии', count: 12 },
  { slug: 'atlas', icon: ic(Shield), color: 'text-text-secondary', bg: 'bg-text-primary/10', label: 'Atlas и треки', count: 9 },
  { slug: 'premium', icon: ic(Crown), color: 'text-text-primary', bg: 'bg-text-primary/10', label: 'Подписка', count: 6 },
  { slug: 'ai', icon: ic(Sparkles), color: 'text-text-secondary', bg: 'bg-text-primary/10', label: 'AI-coach', count: 9 },
  { slug: 'security', icon: ic(Lock), color: 'text-text-secondary', bg: 'bg-text-primary/10', label: 'Безопасность', count: 5 },
]

export const HELP_TOTAL_ARTICLES = HELP_CATEGORIES.reduce((s, c) => s + c.count, 0)

export const HELP_FAQ: HelpFAQ[] = [
  {
    id: 'strict-mock',
    question: 'Чем strict mock отличается от AI-mode?',
    tags: ['Mock', 'Watermark'],
    answer:
      'Strict — без AI и без подсказок, Cue блокируется на сервере. AI-mode — с inline coach. Watermark разделяет результат на «честно» и «с AI» — это объективная валюта готовности.',
  },
  {
    id: 'premium',
    question: 'Что даёт Pro?',
    tags: ['Подписка', 'Биллинг'],
    answer:
      'Pro: безлимит mock (AI / strict), AI-tutor с памятью (4 layers), Cue copilot без лимита, multi-track Atlas + Insights. Free навсегда: 1 mock в неделю, Atlas + Codex, tutor toolkit.',
  },
  {
    id: 'tracks',
    question: 'Сколько треков и как переключиться?',
    tags: ['Tracks', 'English'],
    answer:
      'Главный трек: dev (Go senior). Sub-mode «go deep» для language internals/runtime/distributed. Орт-модификатор «english» — opt-in toggle в Hone settings. Когда выключен, English-surfaces скрыты.',
  },
  {
    id: 'ai-models',
    question: 'Какие AI модели доступны?',
    tags: ['AI', 'LLM cascade'],
    answer:
      'Free LLM cascade: groq → cerebras → google → cloudflare → mistral → openrouter → deepseek → ollama. Никаких платных API в production-цепочке. Модель можно поменять в Настройках → AI.',
  },
  {
    id: 'tutor-toolkit',
    question: 'Что входит в free tutor toolkit?',
    tags: ['Tutor', 'Free'],
    answer:
      'Бесплатно для преподавателей: assignments queue, student snapshots, AI pre-session brief, общий календарь, shared reading library, session notes. Двусторонний рынок без денежного шага.',
  },
  {
    id: 'refund',
    question: 'Возврат денег за подписку',
    tags: ['Биллинг'],
    answer:
      'Если подписка была активна меньше 14 дней — возврат полной суммы по запросу в support@druz9.online или через @druz9_support в Telegram. После 14 дней возврат не предусмотрен, но подписка работает до конца оплаченного периода после отмены.',
  },
]

export const HELP_QUICK_QUESTIONS = ['Strict vs AI-mock', 'Что даёт Pro', 'Подключить тутора']

export const HELP_CONTACTS: HelpContact[] = [
  {
    kind: 'email',
    icon: ic(Mail, 'h-3.5 w-3.5'),
    label: 'Email',
    value: 'support@druz9.online',
    href: 'mailto:support@druz9.online',
  },
  {
    kind: 'telegram',
    icon: ic(Send, 'h-3.5 w-3.5'),
    label: 'Telegram',
    value: '@druz9_support',
    href: 'https://t.me/druz9_support',
  },
  {
    kind: 'discord',
    icon: ic(MessageCircle, 'h-3.5 w-3.5'),
    label: 'Discord',
    value: 'discord.gg/druz9',
    href: 'https://discord.gg/druz9',
  },
  {
    kind: 'github',
    icon: ic(Github, 'h-3.5 w-3.5'),
    label: 'GitHub',
    value: 'dobriygolang/druzya',
    href: 'https://github.com/dobriygolang/druzya',
  },
]
