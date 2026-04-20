import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import {
  Panel,
  PanelHead,
  PageHeader,
  Button,
  InsetGroove,
  Badge,
} from '../components/chrome'
import {
  useCreateAutopsy,
  type InterviewAutopsyInput,
} from '../lib/queries/autopsy'

/**
 * Interview Autopsy form (bible §20.1).
 * User logs a real interview after the fact:
 *  - company / role
 *  - sections covered
 *  - outcome + what went wrong
 *  - atlas nodes to retro-decay (AI re-prioritizes practice)
 *
 * Submit → POST /daily/autopsy → back to /daily with autopsy surfaced.
 */

const SECTIONS: InterviewAutopsyInput['sections'] = [
  'algorithms',
  'sql',
  'go',
  'system_design',
  'behavioral',
]
const SECTION_LABEL: Record<string, string> = {
  algorithms: 'Алгоритмы',
  sql: 'SQL',
  go: 'Go / Rust / Java',
  system_design: 'System Design',
  behavioral: 'Behavioral',
}

const OUTCOMES: Array<{
  key: InterviewAutopsyInput['outcome']
  label: string
  tone: 'normal' | 'hard' | 'boss' | 'dim'
}> = [
  { key: 'passed', label: 'Прошёл', tone: 'normal' },
  { key: 'rejected', label: 'Отказ', tone: 'boss' },
  { key: 'pending', label: 'Жду ответа', tone: 'hard' },
  { key: 'no_show', label: 'Слетел', tone: 'dim' },
]

// STUB: pool of node keys to offer for retro-decay. Real version will fetch
// from /profile/me/atlas and filter by those the user interacted with recently.
const CANDIDATE_NODES = [
  { key: 'algo_graphs', title: 'Graphs' },
  { key: 'algo_dp', title: 'Dynamic Programming' },
  { key: 'sd_scaling', title: 'Horizontal scaling' },
  { key: 'sd_cap', title: 'CAP theorem' },
  { key: 'sql_windows', title: 'Window functions' },
  { key: 'go_concurrency', title: 'Concurrency' },
  { key: 'beh_conflict', title: 'Conflict' },
]

export default function InterviewAutopsyPage() {
  const navigate = useNavigate()
  const create = useCreateAutopsy()

  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [sections, setSections] = useState<InterviewAutopsyInput['sections']>([])
  const [outcome, setOutcome] =
    useState<InterviewAutopsyInput['outcome']>('pending')
  const [whatWentWrong, setWhatWentWrong] = useState('')
  const [retroDecay, setRetroDecay] = useState<string[]>([])

  const canSubmit =
    company.trim().length > 0 &&
    role.trim().length > 0 &&
    sections.length > 0 &&
    !create.isPending

  const toggle = <T extends string>(arr: T[], item: T): T[] =>
    arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item]

  const onSubmit = async () => {
    if (!canSubmit) return
    try {
      const res = await create.mutateAsync({
        company: company.trim(),
        role: role.trim(),
        sections,
        outcome,
        what_went_wrong: whatWentWrong.trim(),
        retro_decay_nodes: retroDecay,
      })
      navigate(`/autopsy/${res.id}`)
    } catch {
      // STUB: error toast
    }
  }

  return (
    <AppShell sidebars={false}>
      <div style={{ padding: 20, maxWidth: 780, margin: '0 auto' }}>
        <PageHeader
          title="Разбор собеса"
          subtitle="INTERVIEW AUTOPSY · что пошло не так"
          right={
            <Button tone="ghost" onClick={() => navigate('/daily')}>
              ← В дейлик
            </Button>
          }
        />

        <Panel>
          <PanelHead>Данные встречи</PanelHead>
          <div
            style={{
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            {/* Company + role */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
              }}
            >
              <FormField label="Компания">
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Yandex / Ozon / Avito..."
                  style={inputStyle}
                />
              </FormField>
              <FormField label="Роль">
                <input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="Backend Senior"
                  style={inputStyle}
                />
              </FormField>
            </div>

            {/* Sections */}
            <FormField label="Разделы">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {SECTIONS.map((s) => {
                  const active = sections.includes(s)
                  return (
                    <button
                      key={s}
                      onClick={() => setSections(toggle(sections, s))}
                      className="tile-button"
                      style={{
                        padding: '6px 12px',
                        fontFamily: 'var(--font-display)',
                        fontSize: 11,
                        letterSpacing: '0.15em',
                        background: active
                          ? 'rgba(200,169,110,0.08)'
                          : 'var(--bg-inset)',
                        border: `1px solid ${
                          active ? 'var(--gold)' : 'var(--gold-faint)'
                        }`,
                        color: active ? 'var(--gold-bright)' : 'var(--text-mid)',
                        cursor: 'pointer',
                      }}
                    >
                      {SECTION_LABEL[s]}
                    </button>
                  )
                })}
              </div>
            </FormField>

            {/* Outcome */}
            <FormField label="Результат">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {OUTCOMES.map((o) => {
                  const active = outcome === o.key
                  return (
                    <button
                      key={o.key}
                      onClick={() => setOutcome(o.key)}
                      className="tile-button"
                      style={{
                        padding: '6px 12px',
                        fontSize: 11,
                        background: active
                          ? 'rgba(200,169,110,0.08)'
                          : 'var(--bg-inset)',
                        border: `1px solid ${
                          active ? 'var(--gold)' : 'var(--gold-faint)'
                        }`,
                        color: active ? 'var(--gold-bright)' : 'var(--text-mid)',
                        cursor: 'pointer',
                      }}
                    >
                      {o.label}
                    </button>
                  )
                })}
              </div>
            </FormField>

            {/* What went wrong */}
            <FormField label="Что пошло не так">
              <textarea
                value={whatWentWrong}
                onChange={(e) => setWhatWentWrong(e.target.value)}
                placeholder="Конкретные темы, где зашёл, где потерял нить, какие вопросы утопили..."
                rows={5}
                style={{
                  ...inputStyle,
                  resize: 'vertical',
                  minHeight: 110,
                  fontFamily: 'var(--font-code)',
                  fontSize: 12,
                }}
              />
            </FormField>

            {/* Retro-decay nodes */}
            <FormField label="Узлы атласа для retro-decay">
              <InsetGroove>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-mid)',
                    marginBottom: 8,
                  }}
                >
                  AI оценит, что из тебя вывалилось, и подсветит эти узлы
                  как «распадающиеся». Выбери 1–3.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {CANDIDATE_NODES.map((n) => {
                    const active = retroDecay.includes(n.key)
                    return (
                      <button
                        key={n.key}
                        onClick={() => setRetroDecay(toggle(retroDecay, n.key))}
                        className="tile-button"
                        style={{
                          padding: '4px 10px',
                          fontSize: 10,
                          fontFamily: 'var(--font-display)',
                          letterSpacing: '0.15em',
                          background: active
                            ? 'rgba(194,34,34,0.15)'
                            : 'var(--bg-inset)',
                          border: `1px solid ${
                            active ? 'var(--blood-lit)' : 'var(--gold-faint)'
                          }`,
                          color: active ? 'var(--blood-lit)' : 'var(--text-mid)',
                          cursor: 'pointer',
                        }}
                      >
                        {active ? '🗲 ' : ''}
                        {n.title}
                      </button>
                    )
                  })}
                </div>
              </InsetGroove>
            </FormField>

            {/* Submit */}
            <div
              style={{
                marginTop: 4,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                {canSubmit
                  ? 'Отправлено → AI обновит атлас и подстроит рекомендации.'
                  : 'Заполни компанию, роль и хотя бы один раздел.'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button tone="ghost" onClick={() => navigate('/daily')}>
                  Отменить
                </Button>
                <Button
                  tone="blood"
                  disabled={!canSubmit}
                  onClick={onSubmit}
                >
                  {create.isPending ? '…' : 'Отправить разбор'}
                </Button>
              </div>
            </div>

            {create.isError && (
              <Badge variant="boss">
                Не получилось отправить. Проверь подключение.
              </Badge>
            )}
          </div>
        </Panel>
      </div>
    </AppShell>
  )
}

function FormField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        className="caps"
        style={{
          color: 'var(--text-mid)',
          fontSize: 10,
          letterSpacing: '0.25em',
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

const inputStyle = {
  padding: '8px 10px',
  background: 'var(--bg-inset)',
  border: '1px solid var(--gold-faint)',
  color: 'var(--text-bright)',
  fontFamily: 'var(--font-body)',
  fontSize: 13,
  width: '100%',
  outline: 'none',
} as const
