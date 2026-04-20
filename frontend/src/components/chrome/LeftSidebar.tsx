import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CharacterPortrait } from './CharacterPortrait'
import { useProfileQuery } from '../../lib/queries/profile'

type MenuItem = {
  key: string
  label: string
  icon: string
  to: string
}
type MenuGroup = { groupKey: string; items: MenuItem[] }

// Menu groups (bible: Russian in left sidebar)
const MENU: MenuGroup[] = [
  {
    groupKey: 'practice',
    items: [
      { key: 'ai-mock', label: 'AI-мок', icon: '◈', to: '/mock/mock-session-1' },
      {
        key: 'ai-native',
        label: 'AI-Native',
        icon: '⚜',
        to: '/native/native-session-1',
      },
      { key: 'daily', label: 'Дейлик', icon: '✦', to: '/daily' },
    ],
  },
  {
    groupKey: 'trials',
    items: [
      { key: 'arena', label: 'Арена', icon: '⚔', to: '/arena' },
      { key: 'guild', label: 'Гильдия', icon: '◉', to: '/guild' },
      { key: 'slots', label: 'Слоты', icon: '⏱', to: '/slots' },
    ],
  },
  {
    groupKey: 'training',
    items: [
      { key: 'atlas', label: 'Атлас скиллов', icon: '◈', to: '/atlas' },
      { key: 'codex', label: 'Кодекс', icon: '⊕', to: '/codex' },
      { key: 'achievements', label: 'Достижения', icon: '✧', to: '/achievements' },
    ],
  },
]

const ATTR_ORDER: Array<{
  en: string
  ru: string
  key: 'intellect' | 'strength' | 'dexterity' | 'will'
  /** CSS var for the bar fill — matches flask colors on the right column */
  fillVar: string
}> = [
  { en: 'Intellect', ru: 'Разум', key: 'intellect', fillVar: 'var(--sec-algo-accent)' }, // Insight — blue
  { en: 'Strength', ru: 'Сила', key: 'strength', fillVar: 'var(--blood-lit)' }, // Resolve — red
  { en: 'Dexterity', ru: 'Ловкость', key: 'dexterity', fillVar: 'var(--sec-beh-accent)' }, // Ichor — green
  { en: 'Will', ru: 'Воля', key: 'will', fillVar: 'var(--gold)' }, // Vigor — gold
]

export function LeftSidebar() {
  const { t } = useTranslation()
  const { data: profile } = useProfileQuery()
  const { pathname } = useLocation()

  const name = profile?.display_name ?? 'Aleksei'
  const title = profile?.title ?? 'Ascendant'
  const level = profile?.level ?? 24
  const attrs = profile?.attributes ?? {
    intellect: 82,
    strength: 74,
    dexterity: 91,
    will: 67,
  }

  return (
    <aside
      style={{
        width: 'var(--sidebar-left)',
        flexShrink: 0,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--gold-dim)',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 0',
        position: 'relative',
        overflow: 'auto',
      }}
    >
      {/* Character block */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '0 16px 20px',
          borderBottom: '1px solid var(--gold-faint)',
        }}
      >
        <CharacterPortrait size={160} level={level} />
        <div
          className="heraldic"
          style={{
            color: 'var(--gold-bright)',
            fontSize: 13,
            marginTop: 10,
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 10,
            color: 'var(--gold)',
            letterSpacing: '0.2em',
            marginTop: 4,
            textAlign: 'center',
          }}
        >
          {title.toUpperCase()}
        </div>

        {/* Attributes — segmented bars (v1 style) */}
        <div
          style={{
            width: '100%',
            marginTop: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {ATTR_ORDER.map((a) => {
            const val = attrs[a.key] ?? 0
            const segCount = 20
            const filled = Math.round((val / 100) * segCount)
            return (
              <div
                key={a.key}
                style={{ display: 'flex', flexDirection: 'column', gap: 3 }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 9,
                    letterSpacing: '0.2em',
                    fontFamily: 'var(--font-display)',
                  }}
                >
                  <span style={{ color: 'var(--text-mid)' }}>
                    {a.ru.toUpperCase()}
                  </span>
                  <span style={{ color: 'var(--gold-bright)' }}>{val}</span>
                </div>
                <div
                  className="seg-bar"
                  style={{ height: 6, ['--seg-on' as string]: a.fillVar }}
                >
                  {Array.from({ length: segCount }).map((_, i) => (
                    <span key={i} className={i < filled ? 'on' : ''} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Menu */}
      <nav
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '14px 0',
          flex: 1,
        }}
      >
        {MENU.map((g) => (
          <div key={g.groupKey} style={{ marginBottom: 12 }}>
            <div
              style={{
                padding: '6px 16px',
                fontFamily: 'var(--font-heraldic)',
                fontSize: 10,
                color: 'var(--text-mid)',
                letterSpacing: '0.25em',
                textTransform: 'uppercase',
              }}
            >
              ✦ {t(`menu.${g.groupKey}`)} ✦
            </div>
            {g.items.map((it) => {
              const isActive = pathname.startsWith(it.to.split('/').slice(0, 2).join('/'))
              return (
                <NavLink
                  key={it.key}
                  to={it.to}
                  className="nav-link"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '7px 16px',
                    color: isActive ? 'var(--gold-bright)' : 'var(--text-mid)',
                    background: isActive
                      ? 'rgba(200,169,110,0.06)'
                      : 'transparent',
                    borderLeft: isActive
                      ? '2px solid var(--gold)'
                      : '2px solid transparent',
                    fontFamily: 'var(--font-display)',
                    fontSize: 11,
                    letterSpacing: '0.1em',
                    textDecoration: 'none',
                  }}
                >
                  <span
                    className="nav-icon"
                    style={{
                      color: isActive ? 'var(--gold)' : 'var(--gold-dim)',
                      width: 14,
                      transition: 'color 140ms ease',
                    }}
                  >
                    {it.icon}
                  </span>
                  <span>{it.label}</span>
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>
    </aside>
  )
}
