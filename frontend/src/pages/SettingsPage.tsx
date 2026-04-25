import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  User,
  CreditCard,
  Plug,
  Bell,
  Sparkles,
  Shield,
  Palette,
  AlertTriangle,
  Code2,
  Copy,
  MessageCircle,
  Send,
  Globe,
  Monitor,
  Sun,
  Moon,
  Languages,
  Check,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { FormField } from '../components/FormField'
import { AIModelRow, PremiumUpgradeHint } from '../components/AIModelRow'
import { cn } from '../lib/cn'
import { useProfileQuery } from '../lib/queries/profile'
import { useAIModelsQuery } from '../lib/queries/ai'
import {
  useAIVacanciesModelQuery,
  useUpdateAIVacanciesModel,
  useUpdateProfileSettings,
} from '../lib/queries/settings'
import { gradientStyleForUser } from '../lib/avatarGradients'
import { useTheme, type ThemeMode } from '../lib/theme'
import { changeLanguage, currentLanguage, type Lang } from '../lib/i18n'
import { BillingTab } from './settings/BillingTab'

type NavId =
  | 'account'
  | 'billing'
  | 'integrations'
  | 'notifications'
  | 'ai'
  | 'privacy'
  | 'appearance'
  | 'danger'

function useNav() {
  const { t } = useTranslation('settings')
  return [
    { id: 'account' as const, label: t('nav.account'), icon: User },
    { id: 'billing' as const, label: t('nav.billing'), icon: CreditCard, badge: 'Premium' },
    { id: 'integrations' as const, label: t('nav.integrations'), icon: Plug },
    { id: 'notifications' as const, label: t('nav.notifications'), icon: Bell },
    { id: 'ai' as const, label: t('nav.ai'), icon: Sparkles },
    { id: 'privacy' as const, label: t('nav.privacy'), icon: Shield },
    { id: 'appearance' as const, label: t('nav.appearance'), icon: Palette },
    { id: 'danger' as const, label: t('nav.danger'), icon: AlertTriangle, danger: true },
  ]
}

function Sidebar({ active, setActive }: { active: NavId; setActive: (id: NavId) => void }) {
  const NAV = useNav()
  return (
    <nav className="flex h-fit w-full flex-row gap-1 overflow-x-auto rounded-2xl bg-surface-2 p-3 lg:w-[240px] lg:flex-col lg:overflow-x-visible">
      {NAV.map((item) => {
        const Icon = item.icon
        const isActive = active === item.id
        const isDanger = 'danger' in item && item.danger
        return (
          <button
            key={item.id}
            onClick={() => setActive(item.id)}
            className={cn(
              'flex h-10 shrink-0 items-center gap-2.5 rounded-md px-3 text-[13px] font-semibold transition-colors',
              isActive
                ? 'bg-text-primary text-text-primary'
                : isDanger
                  ? 'text-danger hover:bg-danger/10'
                  : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary',
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1 text-left">{item.label}</span>
            {'badge' in item && item.badge && (
              <span className="rounded-full bg-warn/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-warn">
                {item.badge}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

function ProfileCard() {
  const { t } = useTranslation('settings')
  const { data: profile, isError, isLoading } = useProfileQuery()
  const username = profile?.username ?? (isLoading ? '' : '—')
  const display = profile?.display_name ?? (isLoading ? '' : '—')
  const email = profile?.email ?? ''
  const initial = (profile?.display_name ?? 'Д').charAt(0).toUpperCase()
  return (
    <Card className="flex-col gap-5 p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-text-primary">{t('profile')}</h3>
        {isError && (
          <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
            {t('load_failed')}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="flex flex-col items-center gap-2">
          <div
            className="grid place-items-center rounded-full font-display text-3xl font-extrabold text-white"
            style={{ width: 96, height: 96, ...gradientStyleForUser(profile?.username) }}
          >
            {initial}
          </div>
          <button className="font-mono text-[11px] font-semibold text-text-primary hover:underline">
            {t('change')}
          </button>
        </div>
        <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField key={`u-${username}`} label={t('fields.username')} defaultValue={username} prefix="@" />
          <FormField key={`d-${display}`} label={t('fields.display')} defaultValue={display} />
          <FormField key={`e-${email}`} label={t('fields.email')} defaultValue={email} />
          <FormField label={t('fields.city')} defaultValue={t('city')} />
          <div className="col-span-2">
            <FormField label={t('fields.bio')} defaultValue={profile?.title ?? t('bio_default')} multiline />
          </div>
        </div>
      </div>
    </Card>
  )
}

function AccountInfoCard() {
  const { t } = useTranslation('settings')
  const { data: profile, isLoading } = useProfileQuery()
  const id = profile?.id ?? (isLoading ? '' : '—')
  const created = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })
    : ''
  const plan = profile?.subscription?.plan ?? 'FREE'
  // Subscription expiry is shown only for paid plans. The proto field
  // `current_period_end` is set to 0-Timestamp on FREE; we treat "" or
  // "1970-01-01T00:00:00Z" as «нет даты».
  const expiry = profile?.subscription?.current_period_end ?? ''
  const expiryDate = expiry && !expiry.startsWith('1970-')
    ? new Date(expiry).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })
    : ''
  return (
    <Card className="flex-col gap-0 p-0">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h3 className="font-display text-lg font-bold text-text-primary">{t('account_card')}</h3>
      </div>
      <div className="flex flex-col">
        <InfoRow label={t('rows.id')}>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[13px] text-text-primary">{id}</span>
            <button className="grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-primary">
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </InfoRow>
        <InfoRow label={t('rows.registered')}>
          <span className="text-[13px] text-text-secondary">{created}</span>
        </InfoRow>
        <InfoRow label={t('rows.plan')}>
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-text-secondary">
              {plan}
            </span>
            {expiryDate && (
              <span className="font-mono text-[11px] text-text-muted">
                до {expiryDate}
              </span>
            )}
            {/* Wave-11: «Управлять» → /pricing (was a no-op Button). */}
            <Link to="/pricing">
              <Button variant="ghost" size="sm">
                {t('buy_premium')}
              </Button>
            </Link>
          </div>
        </InfoRow>
        <InfoRow label={t('rows.devices')} last>
          <span className="text-[13px] text-text-secondary">{t('devices_value')}</span>
        </InfoRow>
      </div>
    </Card>
  )
}

function InfoRow({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-6 py-3.5',
        !last && 'border-b border-border',
      )}
    >
      <span className="text-[13px] font-semibold text-text-secondary">{label}</span>
      {children}
    </div>
  )
}

const INTEGRATIONS = [
  { name: 'GitHub', icon: Code2, connected: true },
  { name: 'Discord', icon: MessageCircle, connected: true },
  { name: 'Telegram', icon: Send, connected: false },
  { name: 'Yandex', icon: Globe, connected: false },
] as const

function IntegrationsCard() {
  const { t } = useTranslation('settings')
  return (
    <Card className="flex-col gap-4 p-6">
      <h3 className="font-display text-lg font-bold text-text-primary">{t('integrations_title')}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {INTEGRATIONS.map((i) => {
          const Icon = i.icon
          return (
            <div
              key={i.name}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface-1 p-4"
            >
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-surface-2 text-text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <div className="flex flex-1 flex-col">
                <span className="text-sm font-semibold text-text-primary">{i.name}</span>
                <span
                  className={cn(
                    'font-mono text-[11px]',
                    i.connected ? 'text-success' : 'text-text-muted',
                  )}
                >
                  {i.connected ? t('connected') : t('not_connected')}
                </span>
              </div>
              <Button variant="ghost" size="sm">
                {i.connected ? t('manage') : t('connect')}
              </Button>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function AppearanceCard() {
  const { t } = useTranslation('settings')
  const { theme, set } = useTheme()
  const options: { id: ThemeMode; icon: typeof Sun; label: string; desc: string }[] = [
    { id: 'auto', icon: Monitor, label: t('theme_auto'), desc: t('theme_auto_desc') },
    { id: 'dark', icon: Moon, label: t('theme_dark'), desc: t('theme_dark_desc') },
    { id: 'light', icon: Sun, label: t('theme_light'), desc: t('theme_light_desc') },
  ]
  const [, force] = useState(0)
  const [lang, setLang] = useState<Lang>(currentLanguage())
  const onLang = (l: Lang) => {
    setLang(l)
    void changeLanguage(l).then(() => force((x) => x + 1))
  }
  return (
    <Card className="flex-col gap-6 p-6">
      <h3 className="font-display text-lg font-bold text-text-primary">{t('appearance_title')}</h3>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[14px] font-semibold text-text-primary">{t('theme_label')}</span>
          <span className="text-[12px] text-text-muted">{t('theme_desc')}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {options.map((o) => {
            const Icon = o.icon
            const active = theme === o.id
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => set(o.id)}
                className={cn(
                  'relative flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all',
                  active
                    ? 'border-text-primary bg-text-primary/10'
                    : 'border-border bg-surface-1 hover:border-border-strong',
                )}
              >
                {active && (
                  <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-text-primary text-text-primary">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
                <Icon className="h-5 w-5 text-text-primary" />
                <span className="text-[14px] font-bold text-text-primary">{o.label}</span>
                <span className="font-mono text-[11px] text-text-muted">{o.desc}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[14px] font-semibold text-text-primary">{t('language_label')}</span>
          <span className="text-[12px] text-text-muted">{t('language_desc')}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(['ru', 'en'] as const).map((l) => {
            const active = lang === l
            return (
              <button
                key={l}
                type="button"
                onClick={() => onLang(l)}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-4 text-left transition-all',
                  active
                    ? 'border-text-primary bg-text-primary/10'
                    : 'border-border bg-surface-1 hover:border-border-strong',
                )}
              >
                <Languages className="h-5 w-5 text-text-primary" />
                <span className="flex-1 text-[14px] font-bold text-text-primary">
                  {l === 'ru' ? 'Русский' : 'English'}
                </span>
                {active && (
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-text-primary text-text-primary">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

// Dev-only: lets QA flip the simulated subscription tier so the voice gate
// (premium-only TTS) can be exercised end-to-end against MSW. The handler
// reads `localStorage['druz9_user_tier']` at request time.
function DevTierCard() {
  const initial = (() => {
    try {
      return localStorage.getItem('druz9_user_tier') ?? 'free'
    } catch {
      return 'free'
    }
  })()
  const [tier, setTier] = useState(initial)
  const tiers = ['free', 'premium', 'pro'] as const
  const set = (t: 'free' | 'premium' | 'pro') => {
    try {
      localStorage.setItem('druz9_user_tier', t)
    } catch {
      /* noop */
    }
    setTier(t)
    // Force a refetch of /profile/me so consumers see the new tier.
    window.dispatchEvent(new Event('storage'))
    window.location.reload()
  }
  return (
    <Card className="flex-col gap-3 border-warn/40 p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-text-primary">Dev: switch tier</h3>
        <span className="rounded-full bg-warn/20 px-2 py-0.5 font-mono text-[10px] font-bold text-warn">
          DEV ONLY
        </span>
      </div>
      <p className="text-[12px] text-text-muted">
        Симулирует подписку. Premium включает proxy к Edge TTS — Free fallback'ит на браузерный голос.
      </p>
      <div className="flex gap-2">
        {tiers.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => set(t)}
            className={cn(
              'flex-1 rounded-md border px-3 py-2 font-mono text-[11px] font-semibold uppercase transition-colors',
              tier === t
                ? 'border-text-primary bg-text-primary/15 text-text-primary'
                : 'border-border bg-surface-1 text-text-secondary hover:bg-surface-2',
            )}
          >
            {t}
          </button>
        ))}
      </div>
    </Card>
  )
}

// AICoachCard — per-user picker for the OpenRouter model that generates the
// weekly AI Coach narrative. Previously OPENROUTER_INSIGHT_MODEL was a single
// env var hardcoded per deployment, which meant free users could silently
// trigger expensive Claude calls while premium users were locked out of the
// "good" models. The catalogue is served dynamically from /ai/models (DB-
// backed registry) so new ids appear here without a frontend release.
//
// Free-tier users see premium rows dimmed with a 💎 badge; clicking one is a
// no-op (backend would reject with InvalidArgument anyway — anti-fallback
// policy: we surface the gate at source, not fake it). Leaving everything
// selected means "server default", which is the cheapest free model.
function AICoachCard() {
  const { t } = useTranslation('settings')
  const { data: profile } = useProfileQuery()
  const { data: catalogue, isLoading, isError } = useAIModelsQuery()
  const update = useUpdateProfileSettings()
  const tier = profile?.tier ?? 'free'
  const isPremium = tier === 'premium' || tier === 'pro'
  // Local state — we don't have a GET /profile/me/settings yet, so the
  // picker seeds from "" (server default) and persists via the PUT
  // response. Once AIADMIN lands a GET endpoint this can hydrate from it.
  const [selected, setSelected] = useState<string>('')
  const items = catalogue?.items ?? []
  const available = catalogue?.available ?? false

  const onPick = (id: string) => {
    // Cannot pick a premium model as a free user — hard-stop client-side
    // so the user gets immediate feedback instead of a round-trip 400.
    const model = items.find((m) => m.id === id)
    if (model && model.tier === 'premium' && !isPremium) {
      return
    }
    setSelected(id)
    update.mutate({ ai_insight_model: id })
  }

  return (
    <Card className="flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-lg font-bold text-text-primary">
            {t('ai_coach_title', { defaultValue: 'AI Coach — модель' })}
          </h3>
          <p className="text-[12px] text-text-muted">
            {t('ai_coach_desc', {
              defaultValue:
                'Выбор LLM для недельного инсайта. Пусто ⇒ дефолтная бесплатная модель. Premium-модели доступны на платной подписке.',
            })}
          </p>
        </div>
        {update.isPending && (
          <span className="font-mono text-[10px] text-text-muted">saving…</span>
        )}
      </div>

      {isLoading && (
        <div className="font-mono text-[11px] text-text-muted">loading…</div>
      )}
      {isError && (
        <div className="rounded-md bg-danger/15 px-3 py-2 font-mono text-[11px] text-danger">
          {t('ai_coach_load_failed', { defaultValue: 'Не удалось загрузить каталог моделей' })}
        </div>
      )}
      {!isLoading && !isError && !available && (
        <div className="rounded-md bg-surface-2 px-3 py-2 font-mono text-[11px] text-text-muted">
          {t('ai_coach_unavailable', {
            defaultValue: 'AI Coach сейчас отключён (OPENROUTER_API_KEY не задан)',
          })}
        </div>
      )}
      {available && items.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* Default row — empty string maps to server-default free model */}
          <AIModelRow
            id=""
            label={t('ai_coach_default', { defaultValue: 'По умолчанию (бесплатная)' })}
            meta={t('ai_coach_default_desc', { defaultValue: 'сервер выбирает модель под ваш тариф' })}
            tier="free"
            selected={selected === ''}
            onSelect={onPick}
          />
          {items.map((m) => {
            const locked = m.tier === 'premium' && !isPremium
            return (
              <AIModelRow
                key={m.id}
                id={m.id}
                label={m.label}
                meta={`${m.provider} · ${m.id}`}
                tier={m.tier}
                selected={selected === m.id}
                locked={locked}
                isVirtual={m.is_virtual}
                onSelect={onPick}
              />
            )
          })}
          {/* Inline upgrade hint — single, unobtrusive, only when something
              is actually locked (i.e. user is free-tier and at least one
              premium model exists in the catalogue). */}
          {!isPremium && items.some((m) => m.tier === 'premium') && (
            <PremiumUpgradeHint />
          )}
        </div>
      )}
      {update.isError && (
        <div className="rounded-md bg-danger/15 px-3 py-2 font-mono text-[11px] text-danger">
          {t('ai_coach_save_failed', { defaultValue: 'Не удалось сохранить выбор' })}
        </div>
      )}
    </Card>
  )
}

// VacanciesModelCard — mirrors AICoachCard but targets the extractor that
// powers the «Разобрать» flow on /vacancies. Hydrates from the dedicated
// GET /profile/me/ai-vacancies-model (unlike insight's seed-from-empty),
// so the row reflects the user's stored preference on mount. Uses the
// `?use=vacancies` filter so only JSON-capable models show up.
function VacanciesModelCard() {
  const { data: profile } = useProfileQuery()
  const { data: catalogue, isLoading, isError } = useAIModelsQuery('vacancies')
  const { data: current } = useAIVacanciesModelQuery()
  const update = useUpdateAIVacanciesModel()
  const tier = profile?.tier ?? 'free'
  const isPremium = tier === 'premium' || tier === 'pro'
  const items = catalogue?.items ?? []
  const available = catalogue?.available ?? false
  const selected = current?.model_id ?? ''

  const onPick = (id: string) => {
    const model = items.find((m) => m.id === id)
    if (model && model.tier === 'premium' && !isPremium) return
    update.mutate(id)
  }

  return (
    <Card className="flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-lg font-bold text-text-primary">
            Разбор вакансий — модель
          </h3>
          <p className="text-[12px] text-text-muted">
            Выбор LLM для извлечения скиллов из вакансии при клике «Разобрать»
            на /vacancies. Пусто ⇒ бесплатная qwen3-coder. Работают только
            модели, надёжно держащие strict-JSON вывод.
          </p>
        </div>
        {update.isPending && (
          <span className="font-mono text-[10px] text-text-muted">saving…</span>
        )}
      </div>

      {isLoading && (
        <div className="font-mono text-[11px] text-text-muted">loading…</div>
      )}
      {isError && (
        <div className="rounded-md bg-danger/15 px-3 py-2 font-mono text-[11px] text-danger">
          Не удалось загрузить каталог моделей
        </div>
      )}
      {!isLoading && !isError && !available && (
        <div className="rounded-md bg-surface-2 px-3 py-2 font-mono text-[11px] text-text-muted">
          Разбор вакансий сейчас отключён (OPENROUTER_API_KEY не задан)
        </div>
      )}
      {available && items.length > 0 && (
        <div className="flex flex-col gap-2">
          <AIModelRow
            id=""
            label="По умолчанию (бесплатная)"
            meta="сервер использует qwen3-coder:free"
            tier="free"
            selected={selected === ''}
            onSelect={onPick}
          />
          {items.map((m) => {
            const locked = m.tier === 'premium' && !isPremium
            return (
              <AIModelRow
                key={m.id}
                id={m.id}
                label={m.label}
                meta={`${m.provider} · ${m.id}`}
                tier={m.tier}
                selected={selected === m.id}
                locked={locked}
                isVirtual={m.is_virtual}
                onSelect={onPick}
              />
            )
          })}
          {!isPremium && items.some((m) => m.tier === 'premium') && (
            <PremiumUpgradeHint />
          )}
        </div>
      )}
      {update.isError && (
        <div className="rounded-md bg-danger/15 px-3 py-2 font-mono text-[11px] text-danger">
          Не удалось сохранить выбор
        </div>
      )}
    </Card>
  )
}

export default function SettingsPage() {
  const { t } = useTranslation('settings')
  const [active, setActive] = useState<NavId>('account')
  return (
    <AppShellV2>
      <div className="flex flex-col gap-8 px-4 py-6 sm:px-8 lg:px-10 lg:py-10">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-3xl font-bold leading-[1.1] text-text-primary lg:text-[40px]">{t('title')}</h1>
          <p className="text-sm text-text-secondary">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex flex-col gap-6 lg:flex-row">
          <Sidebar active={active} setActive={setActive} />
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <ProfileCard />
            <AccountInfoCard />
            {/* Wave-11: billing-secção (управление подпиской, история чеков,
                cancel-flow). Sidebar nav-item «billing» уже подсвечивает её
                как часть страницы — фактический tab-switch появится, когда
                страница станет нативно tabbed (сейчас всё стэкается). */}
            {active === 'billing' && <BillingTab />}
            <IntegrationsCard />
            <AICoachCard />
            <VacanciesModelCard />
            <AppearanceCard />
            <DevTierCard />
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
