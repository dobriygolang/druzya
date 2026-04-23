// TODO i18n
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Check, Trophy, Zap, Unlock, ArrowRight } from 'lucide-react'
import { Button } from '../components/Button'
import { OnboardingTopBar } from './OnboardingPage'

function Confetti() {
  const pieces = [
    { top: -20, left: -40, color: '#FBBF24', rot: 12 },
    { top: 30, left: -70, color: '#F472B6', rot: -18 },
    { top: 140, left: -50, color: '#22D3EE', rot: 30 },
    { top: -10, left: 180, color: '#582CFF', rot: -10 },
    { top: 60, left: 200, color: '#FBBF24', rot: 22 },
    { top: 150, left: 180, color: '#F472B6', rot: -25 },
  ]
  return (
    <>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute block"
          style={{
            top: p.top,
            left: p.left,
            width: 14,
            height: 18,
            background: p.color,
            transform: `rotate(${p.rot}deg)`,
            clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
          }}
        />
      ))}
    </>
  )
}

function RewardCard({
  icon,
  iconBg,
  title,
  sub,
}: {
  icon: React.ReactNode
  iconBg: string
  title: string
  sub: string
}) {
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface-1 p-5 text-center"
      style={{ width: 220 }}
    >
      <span className={`grid h-12 w-12 place-items-center rounded-full ${iconBg}`}>{icon}</span>
      <span className="font-display text-base font-bold text-text-primary">{title}</span>
      <span className="text-[12px] text-text-muted">{sub}</span>
    </div>
  )
}

export default function AllSetPage() {
  useEffect(() => {
    document.body.classList.add('v2')
    return () => document.body.classList.remove('v2')
  }, [])

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      {/* Onboarding теперь 3-шаговый (бывший step 1 — OAuth — переехал в /login).
          allDone={true} включает галочки для всех шагов. */}
      <OnboardingTopBar current={3} allDone showSkip={false} />
      <main
        className="flex flex-col items-center justify-center px-4 py-8 sm:px-8 lg:px-16 lg:py-14"
        style={{ gap: 28 }}
      >
        <div className="relative">
          <Confetti />
          <div
            className="grid place-items-center text-text-primary"
            style={{
              width: 160,
              height: 160,
              borderRadius: 80,
              background: 'linear-gradient(135deg, #10B981 0%, #22D3EE 100%)',
              boxShadow: '0 8px 40px rgba(16,185,129,0.5)',
            }}
          >
            <Check className="h-20 w-20 text-white" strokeWidth={3} />
          </div>
        </div>

        <h1 className="text-center font-display font-extrabold text-text-primary text-4xl sm:text-5xl lg:text-[64px]" style={{ lineHeight: 1.05 }}>
          Готово!
        </h1>
        <p className="max-w-[640px] text-center text-[16px] text-text-secondary">
          Аккаунт создан, стек настроен, первая kata пройдена. Добро пожаловать в druz9, @dima 🎉
        </p>

        <div className="flex flex-col gap-4 sm:flex-row">
          <RewardCard
            icon={<Trophy className="h-6 w-6 text-warn" />}
            iconBg="bg-warn/15"
            title="Первая кровь"
            sub="Достижение разблокировано"
          />
          <RewardCard
            icon={<Zap className="h-6 w-6 text-cyan" />}
            iconBg="bg-cyan/15"
            title="+500 XP"
            sub="Бонус за онбординг"
          />
          <RewardCard
            icon={<Unlock className="h-6 w-6 text-accent-hover" />}
            iconBg="bg-accent/15"
            title="Ranked unlock"
            sub="Доступ к 1v1-аренам"
          />
        </div>

        <div
          className="flex w-full max-w-[700px] flex-col items-start justify-between gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:p-7"
          style={{
            background: 'linear-gradient(135deg, #2D1B4D 0%, #582CFF 100%)',
          }}
        >
          <div className="flex flex-col gap-1">
            <span className="font-display text-[22px] font-bold text-text-primary">
              Найди первого соперника
            </span>
            <span className="text-[13px] text-white/80">
              Очередь подбирает противника твоего уровня — обычно 30 секунд
            </span>
          </div>
          <Link to="/arena">
            <Button
              variant="primary"
              iconRight={<ArrowRight className="h-4 w-4" />}
              className="!bg-white !text-bg shadow-none hover:!bg-white/90 hover:shadow-none"
            >
              В очередь
            </Button>
          </Link>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <Link
            to="/sanctum"
            className="rounded-full border border-border bg-surface-1 px-4 py-2 text-[13px] font-medium text-text-secondary hover:border-border-strong hover:text-text-primary"
          >
            Daily kata
          </Link>
          <Link
            to="/sanctum"
            className="rounded-full border border-border bg-surface-1 px-4 py-2 text-[13px] font-medium text-text-secondary hover:border-border-strong hover:text-text-primary"
          >
            Изучить режимы
          </Link>
          <Link
            to="/sanctum"
            className="rounded-full border border-border bg-surface-1 px-4 py-2 text-[13px] font-medium text-text-secondary hover:border-border-strong hover:text-text-primary"
          >
            Найти друзей
          </Link>
        </div>
      </main>
    </div>
  )
}
