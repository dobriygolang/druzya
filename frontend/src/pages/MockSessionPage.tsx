import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AppShell } from '../components/AppShell'
import {
  Panel,
  PanelHead,
  PageHeader,
  Badge,
  Button,
  InsetGroove,
} from '../components/chrome'
import {
  useMockSessionQuery,
  useSendMockMessage,
  type MockMessage,
} from '../lib/queries/mock'

export default function MockSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { t } = useTranslation()
  const { data: session } = useMockSessionQuery(sessionId)
  const sendMsg = useSendMockMessage(sessionId)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<MockMessage[]>([])

  const onSend = async () => {
    if (!input.trim()) return
    const userMsg: MockMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: input,
      created_at: new Date().toISOString(),
    }
    setPending((p) => [...p, userMsg])
    setInput('')
    try {
      const reply = await sendMsg.mutateAsync(userMsg.content)
      setPending((p) => [...p, reply])
    } catch {
      // STUB: surface error UI once error pattern is finalized
    }
  }

  const allMessages = [...(session?.last_messages ?? []), ...pending]

  return (
    <AppShell sidebars={false}>
      <div style={{ padding: 20 }}>
        <PageHeader
          title={t('mock.title')}
          subtitle={t('mock.subtitle')}
          right={
            <Link to={`/mock/${sessionId}/result`} style={{ textDecoration: 'none' }}>
              <Button tone="primary">{t('mock.finish')}</Button>
            </Link>
          }
        />

        <div
          data-stagger
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 20,
            height: 'calc(100vh - 180px)',
          }}
        >
          <Panel style={{ display: 'flex', flexDirection: 'column' }}>
            <PanelHead subtitle="TASK">{t('mock.task')}</PanelHead>
            <div
              style={{
                padding: 20,
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {session && (
                <>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Badge variant="hard">{session.task.difficulty}</Badge>
                    <Badge variant="dim">{session.section}</Badge>
                  </div>
                  <div
                    className="heraldic"
                    style={{ color: 'var(--gold-bright)', fontSize: 16 }}
                  >
                    {session.task.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-bright)',
                      lineHeight: 1.6,
                    }}
                  >
                    {session.task.description}
                  </div>
                  <InsetGroove>
                    <div
                      className="caps"
                      style={{ color: 'var(--gold-dim)', marginBottom: 6 }}
                    >
                      Example
                    </div>
                    {session.task.example_cases.map((ex, i) => (
                      <div key={i} className="mono" style={{ fontSize: 12 }}>
                        <div style={{ color: 'var(--text-mid)' }}>
                          in: {ex.input}
                        </div>
                        <div style={{ color: 'var(--gold-bright)' }}>
                          out: {ex.output}
                        </div>
                      </div>
                    ))}
                  </InsetGroove>
                  <InsetGroove>
                    {/* STUB: Monaco editor — replaced with pre until wired to @monaco-editor/react */}
                    <div
                      className="caps"
                      style={{ color: 'var(--gold-dim)', marginBottom: 6 }}
                    >
                      {t('mock.code')} · Go
                    </div>
                    <pre
                      className="mono"
                      style={{
                        fontSize: 12,
                        color: 'var(--text-bright)',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {session.task.starter_code.go ?? '// STUB'}
                    </pre>
                  </InsetGroove>
                </>
              )}
            </div>
          </Panel>

          <Panel style={{ display: 'flex', flexDirection: 'column' }}>
            <PanelHead subtitle="CHAT">{t('mock.chat')}</PanelHead>
            <div
              style={{
                padding: 20,
                overflow: 'auto',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {allMessages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    padding: '10px 14px',
                    background:
                      m.role === 'user'
                        ? 'var(--bg-panel)'
                        : 'var(--bg-inset)',
                    border: `1px solid ${
                      m.role === 'user' ? 'var(--gold)' : 'var(--gold-dim)'
                    }`,
                    fontSize: 12,
                    color: 'var(--text-bright)',
                  }}
                >
                  <div
                    className="caps"
                    style={{
                      color:
                        m.role === 'user'
                          ? 'var(--gold)'
                          : 'var(--ember-lit)',
                      marginBottom: 4,
                    }}
                  >
                    {m.role}
                  </div>
                  {m.content}
                </div>
              ))}
              {allMessages.length === 0 && (
                <div style={{ color: 'var(--text-dim)' }}>
                  {t('common.empty')}
                </div>
              )}
            </div>
            <div
              style={{
                padding: 12,
                borderTop: '1px solid var(--gold-dim)',
                display: 'flex',
                gap: 8,
              }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void onSend()
                  }
                }}
                style={{
                  flex: 1,
                  minHeight: 44,
                  padding: 10,
                  background: 'var(--bg-inset)',
                  border: '1px solid var(--gold-dim)',
                  color: 'var(--text-bright)',
                  fontFamily: 'var(--font-code)',
                  fontSize: 12,
                  resize: 'vertical',
                }}
              />
              <Button
                tone="primary"
                onClick={() => void onSend()}
                disabled={sendMsg.isPending}
              >
                {t('mock.send')}
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  )
}
