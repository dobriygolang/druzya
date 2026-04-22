// TODO i18n
import { Star, Video, Clock, ArrowUpDown, ChevronDown } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { useSlotsQuery } from '../lib/queries/slot'

function Header() {
  const { data, isError } = useSlotsQuery()
  const count = data?.slots?.length ?? 142
  return (
    <div className="flex flex-col items-start gap-4 px-4 pb-4 pt-6 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-20 lg:pt-7">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary">Live Mock Interview</h1>
        <p className="text-sm text-text-secondary">
          {isError
            ? 'Не удалось загрузить слоты'
            : `Peer-mock с реальными разработчиками · ${count} слотов доступно`}
        </p>
      </div>
      <div className="flex gap-3">
        <Button variant="ghost">Мои слоты</Button>
        <Button>Стать интервьюером</Button>
      </div>
    </div>
  )
}

function FilterChip({ label }: { label: string }) {
  return (
    <button className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-text-secondary hover:border-border-strong hover:text-text-primary">
      {label}
      <ChevronDown className="h-3.5 w-3.5" />
    </button>
  )
}

function FilterBar() {
  return (
    <div className="flex flex-col items-start gap-3 px-4 pb-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-20">
      <div className="flex items-center gap-2 overflow-x-auto">
        <FilterChip label="Algorithms" />
        <FilterChip label="Senior" />
        <FilterChip label="Go" />
        <FilterChip label="Эта неделя" />
        <FilterChip label="до 2000₽" />
      </div>
      <button className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-text-secondary">
        <ArrowUpDown className="h-3.5 w-3.5" />
        Сортировка: рейтинг
      </button>
    </div>
  )
}

const DAYS = [
  { day: 'Пн', date: '21 апр', count: 8, today: false, selected: false },
  { day: 'Вт', date: '22 апр', count: 12, today: true, selected: true },
  { day: 'Ср', date: '23 апр', count: 9, today: false, selected: false },
  { day: 'Чт', date: '24 апр', count: 11, today: false, selected: false },
  { day: 'Пт', date: '25 апр', count: 7, today: false, selected: false },
  { day: 'Сб', date: '26 апр', count: 4, today: false, selected: false },
  { day: 'Вс', date: '27 апр', count: 0, today: false, selected: false },
]

function MiniSlot({ time, taken }: { time: string; taken?: boolean }) {
  return (
    <div
      className={`rounded-md border px-2 py-1 text-[11px] ${
        taken
          ? 'border-border bg-surface-2 text-text-muted line-through'
          : 'border-accent/40 bg-accent/10 text-accent-hover'
      }`}
    >
      {time}
    </div>
  )
}

function WeekCalendar() {
  return (
    <Card className="flex-col p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-text-primary">Неделя 21–27 апреля</h3>
        <span className="font-mono text-[11px] text-text-muted">51 слот</span>
      </div>
      <div className="grid grid-cols-7 gap-2 overflow-x-auto">
        {DAYS.map((d) => (
          <div
            key={d.day}
            className={`flex flex-col gap-2 rounded-lg border p-2 ${
              d.today ? 'border-accent bg-accent/5' : 'border-border bg-surface-2'
            }`}
          >
            <div className="flex flex-col">
              <span className="font-mono text-[11px] text-text-muted">{d.day}</span>
              <span className={`text-sm font-bold ${d.today ? 'text-cyan' : 'text-text-primary'}`}>{d.date}</span>
              <span className="font-mono text-[10px] text-text-muted">{d.count} слотов</span>
            </div>
            <div className="flex flex-col gap-1">
              {d.count === 0 ? (
                <span className="text-center text-xs text-text-muted">—</span>
              ) : (
                <>
                  <MiniSlot time="14:00" />
                  <MiniSlot time="16:30" taken={d.day === 'Чт'} />
                  {d.count > 8 && <MiniSlot time="19:00" />}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

type Interviewer = {
  nick: string
  tier: string
  rating: string
  reviews: number
  tags: string[]
  time: string
  duration: string
  price: string
  stats: string
  badge?: string
  noRating?: boolean
  gradient: 'violet-cyan' | 'pink-violet' | 'cyan-violet' | 'success-cyan'
}

const SLOTS: Interviewer[] = [
  {
    nick: '@kirill_dev',
    tier: 'Senior @ VK',
    rating: '4.9',
    reviews: 87,
    tags: ['Algorithms', 'System Design'],
    time: '22 апр · 16:30',
    duration: '60 мин',
    price: '1 800₽',
    stats: '120 интервью',
    gradient: 'violet-cyan',
  },
  {
    nick: '@nastya_dev',
    tier: 'Senior @ Yandex',
    rating: '4.8',
    reviews: 64,
    tags: ['Frontend', 'React'],
    time: '22 апр · 19:00',
    duration: '45 мин',
    price: '1 500₽',
    stats: '92 интервью',
    gradient: 'pink-violet',
  },
  {
    nick: '@alexey_p',
    tier: 'Staff @ Avito',
    rating: '5.0',
    reviews: 52,
    tags: ['Backend', 'Go', 'DDD'],
    time: '22 апр · 20:30',
    duration: '90 мин',
    price: '2 500₽',
    stats: '78 интервью',
    badge: 'TOP',
    gradient: 'cyan-violet',
  },
  {
    nick: '@vasya',
    tier: 'Mid @ Tinkoff',
    rating: '—',
    reviews: 0,
    tags: ['Python', 'SQL'],
    time: '22 апр · 21:00',
    duration: '60 мин',
    price: '900₽',
    stats: 'Новичок',
    noRating: true,
    gradient: 'success-cyan',
  },
]

function SlotCard({ s }: { s: Interviewer }) {
  return (
    <Card className="flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
      <Avatar size="lg" gradient={s.gradient} initials={s.nick[1]?.toUpperCase()} />
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-text-primary">{s.nick}</span>
          <span className="font-mono text-[11px] text-text-muted">{s.tier}</span>
          {s.badge && (
            <span className="rounded-full bg-warn/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-warn">{s.badge}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {s.noRating ? (
            <span className="font-mono text-[11px] text-text-muted">Нет рейтинга</span>
          ) : (
            <>
              <Star className="h-3.5 w-3.5 fill-warn text-warn" />
              <span className="font-mono text-[12px] font-semibold text-warn">{s.rating}</span>
              <span className="font-mono text-[11px] text-text-muted">· {s.reviews} отзывов</span>
            </>
          )}
        </div>
        <div className="mt-0.5 flex gap-1.5">
          {s.tags.map((t) => (
            <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary">
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-cyan" />
          <span className="text-sm font-semibold text-text-primary">{s.time}</span>
        </div>
        <span className="font-mono text-[11px] text-text-muted">{s.duration}</span>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="rounded-full bg-success/15 px-2.5 py-1 font-mono text-[12px] font-semibold text-success">{s.price}</span>
        <span className="font-mono text-[11px] text-text-muted">{s.stats}</span>
      </div>
      <Button>Забронировать</Button>
    </Card>
  )
}

function TopInterviewers() {
  const rows = [
    { rank: 1, name: '@alexey_p', sub: 'Staff @ Avito · 5.0★', medal: 'warn' },
    { rank: 2, name: '@kirill_dev', sub: 'Senior @ VK · 4.9★', medal: 'silver' },
    { rank: 3, name: '@nastya_dev', sub: 'Senior @ Yandex · 4.8★', medal: 'accent' },
    { rank: 4, name: '@misha_b', sub: 'Senior @ Ozon · 4.7★', medal: 'plain' },
    { rank: 5, name: '@olga_t', sub: 'Senior @ Sber · 4.6★', medal: 'plain' },
  ]
  const medalBg = (m: string) =>
    m === 'warn' ? 'bg-warn text-bg' : m === 'silver' ? 'bg-border-strong text-text-secondary' : m === 'accent' ? 'bg-accent text-text-primary' : 'bg-border-strong text-text-secondary'
  return (
    <Card className="flex-col gap-2 p-5">
      <h3 className="mb-1 font-display text-base font-bold text-text-primary">Топ интервьюеров</h3>
      {rows.map((r) => (
        <div key={r.rank} className="flex items-center gap-3 py-1.5">
          <span className={`grid h-6 w-6 place-items-center rounded-full font-display text-[12px] font-bold ${medalBg(r.medal)}`}>
            {r.rank}
          </span>
          <Avatar size="sm" gradient="violet-cyan" initials={r.name[1]?.toUpperCase()} />
          <div className="flex flex-1 flex-col">
            <span className="text-sm font-semibold text-text-primary">{r.name}</span>
            <span className="font-mono text-[11px] text-text-muted">{r.sub}</span>
          </div>
        </div>
      ))}
    </Card>
  )
}

function PromoCard() {
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-gradient-to-br from-accent to-pink p-5 shadow-glow">
      <h3 className="font-display text-lg font-bold text-text-primary">Стань интервьюером</h3>
      <p className="text-xs text-white/80">Зарабатывай на mock-интервью · от 1 500₽ за слот</p>
      <div className="flex justify-between">
        <div className="flex flex-col">
          <span className="font-display text-lg font-bold text-text-primary">87₽K</span>
          <span className="text-[11px] text-white/70">в месяц топ-10</span>
        </div>
        <div className="flex flex-col">
          <span className="font-display text-lg font-bold text-text-primary">4.8★</span>
          <span className="text-[11px] text-white/70">средний рейтинг</span>
        </div>
        <div className="flex flex-col">
          <span className="font-display text-lg font-bold text-text-primary">142</span>
          <span className="text-[11px] text-white/70">активных</span>
        </div>
      </div>
      <button className="inline-flex items-center justify-center rounded-md bg-white/20 px-3.5 py-2 text-xs font-semibold text-text-primary hover:bg-white/30">
        Подать заявку
      </button>
    </div>
  )
}

function MyBookings() {
  const items = [
    { who: '@kirill_dev', when: 'Сегодня · 16:30', topic: 'Algorithms · 60 мин' },
    { who: '@nastya_dev', when: 'Чт · 19:00', topic: 'Frontend · 45 мин' },
  ]
  return (
    <Card className="flex-col gap-3 p-5">
      <h3 className="font-display text-base font-bold text-text-primary">Мои брони</h3>
      {items.map((i) => (
        <div key={i.who} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
          <div className="flex items-center gap-2">
            <Avatar size="sm" gradient="violet-cyan" initials={i.who[1]?.toUpperCase()} />
            <span className="text-sm font-semibold text-text-primary">{i.who}</span>
            <span className="ml-auto font-mono text-[11px] text-cyan">{i.when}</span>
          </div>
          <span className="font-mono text-[11px] text-text-muted">{i.topic}</span>
          <button className="inline-flex w-fit items-center gap-1.5 rounded-md bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success hover:bg-success/25">
            <Video className="h-3 w-3" /> Google Meet
          </button>
        </div>
      ))}
    </Card>
  )
}

function SlotList() {
  const { data, isError } = useSlotsQuery()
  const gradients = ['violet-cyan', 'pink-violet', 'cyan-violet', 'success-cyan'] as const
  const slots: Interviewer[] = data?.slots?.length
    ? data.slots.map((s, i) => ({
        nick: `@${s.mentor.username}`,
        tier: s.mentor.title,
        rating: '—',
        reviews: 0,
        tags: [s.section],
        time: new Date(s.starts_at).toLocaleString('ru', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }),
        duration: `${s.duration_min} мин`,
        price: s.price_ai_credits === 0 ? 'Бесплатно' : `${s.price_ai_credits} AI`,
        stats: `ELO ${s.mentor.elo}`,
        noRating: true,
        gradient: gradients[i % gradients.length],
      }))
    : SLOTS
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-display text-base font-bold text-text-primary">
        {isError ? 'Не удалось загрузить' : `Доступные слоты · ${slots.length}`}
      </h3>
      {slots.map((s) => (
        <SlotCard key={s.nick + s.time} s={s} />
      ))}
    </div>
  )
}

export default function SlotsPage() {
  return (
    <AppShellV2>
      <Header />
      <FilterBar />
      <div className="flex flex-col gap-4 px-4 pb-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:pb-7">
        <div className="flex flex-1 flex-col gap-5">
          <WeekCalendar />
          <SlotList />
        </div>
        <div className="flex w-full flex-col gap-5 lg:w-[380px]">
          <TopInterviewers />
          <PromoCard />
          <MyBookings />
        </div>
      </div>
    </AppShellV2>
  )
}
