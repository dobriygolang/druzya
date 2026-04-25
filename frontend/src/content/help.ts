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

export const HELP_CATEGORIES: HelpCategory[] = [
  { slug: 'start', icon: ic(Rocket), color: 'text-text-secondary', bg: 'bg-text-primary/10', label: 'Старт', count: 8 },
  { slug: 'arena', icon: ic(Swords), color: 'text-text-primary', bg: 'bg-text-primary/15', label: 'Арена и матчи', count: 14 },
  { slug: 'cohort', icon: ic(Shield), color: 'text-text-secondary', bg: 'bg-text-primary/10', label: 'Когорты', count: 11 },
  { slug: 'premium', icon: ic(Crown), color: 'text-warn', bg: 'bg-warn/15', label: 'Premium', count: 6 },
  { slug: 'ai', icon: ic(Sparkles), color: 'text-text-secondary', bg: 'bg-text-primary/10', label: 'AI-собеседование', count: 9 },
  { slug: 'security', icon: ic(Lock), color: 'text-success', bg: 'bg-success/15', label: 'Безопасность', count: 5 },
]

export const HELP_TOTAL_ARTICLES = HELP_CATEGORIES.reduce((s, c) => s + c.count, 0)

export const HELP_FAQ: HelpFAQ[] = [
  {
    id: 'lp',
    question: 'Как считается LP?',
    tags: ['MMR vs LP', 'Сезонный сброс', 'Decay'],
    answer:
      'LP начисляется за победы в ranked-матчах и зависит от разницы рейтингов соперников. Базовое значение — 20 LP, корректируется на основе MMR-формулы (Elo-подобная). Минимум +5 LP за победу, максимум +35 LP. При поражении удерживается от −12 до −22 LP.',
  },
  {
    id: 'premium',
    question: 'Что даёт Premium?',
    tags: ['Подписка', 'Биллинг'],
    answer:
      'Premium даёт безлимит mock-интервью с моделью GPT-4o (вместо free GPT-4o-mini), премиальные TTS-голоса для разбора, расширенную аналитику в weekly-report и эксклюзивные бейджи. Цена 490₽/мес или 4900₽/год. Оплата через Boosty, отмена в любой момент.',
  },
  {
    id: 'cohort-create',
    question: 'Как создать когорту?',
    tags: ['Когорты'],
    answer:
      'Создание когорты откроется после достижения 1500 ELO в любой из секций (algorithms / SQL / etc). Стоимость регистрации — 5000 XP. Когорта имеет до 30 участников, своё название и эмблему. Раз в неделю — cohort war против другой когорты того же тира.',
  },
  {
    id: 'ai-models',
    question: 'Какие AI модели доступны?',
    tags: ['AI', 'OpenRouter'],
    answer:
      'Бесплатно: GPT-4o-mini для mock-интервью + браузерный TTS. Premium: GPT-4o + Edge TTS Premium голос. Модель и провайдер можно поменять в Настройках → AI.',
  },
  {
    id: 'streak-freeze',
    question: 'Как работает Streak Freeze?',
    tags: ['Daily', 'Стрик'],
    answer:
      'Freeze автоматически защищает streak если ты пропустил день. Каждые 7 дней непрерывного решения daily-kata получаешь 1 freeze (максимум 3). Дополнительные можно купить за 100 💎.',
  },
  {
    id: 'refund',
    question: 'Возврат денег за подписку',
    tags: ['Биллинг'],
    answer:
      'Если подписка была активна меньше 14 дней — возврат полной суммы по запросу в support@druz9.online или через @druz9_support в Telegram. После 14 дней возврат не предусмотрен, но подписка работает до конца оплаченного периода после отмены.',
  },
]

export const HELP_QUICK_QUESTIONS = ['Как поднять LP?', 'Создать когорту', 'Купить Premium']

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
