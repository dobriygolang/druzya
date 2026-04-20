import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Editor, { type Monaco } from '@monaco-editor/react'
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

// Monaco druz9-noir theme — matches site tokens.css (dark + gold accents)
function defineDruz9Theme(monaco: Monaco) {
  monaco.editor.defineTheme('druz9-noir', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6b5f54', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'e8c87a' },
      { token: 'string', foreground: '9a8c76' },
      { token: 'number', foreground: '6a9fd4' },
      { token: 'type', foreground: 'e09b3a' },
      { token: 'identifier.function', foreground: 'e8c87a' },
    ],
    colors: {
      'editor.background': '#0a0c10',
      'editor.foreground': '#e8dcc8',
      'editor.lineHighlightBackground': '#14100f',
      'editor.selectionBackground': '#2a1a1633',
      'editorCursor.foreground': '#e8c87a',
      'editorLineNumber.foreground': '#4a3c28',
      'editorLineNumber.activeForeground': '#c8a96e',
      'editorIndentGuide.background': '#1c1710',
      'editorIndentGuide.activeBackground': '#4a3c28',
    },
  })
}

export default function MockSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { t } = useTranslation()
  const { data: session } = useMockSessionQuery(sessionId)
  const sendMsg = useSendMockMessage(sessionId)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<MockMessage[]>([])
  const [code, setCode] = useState<string>('')
  const initRef = useRef(false)
  useEffect(() => {
    if (!initRef.current && session?.task?.starter_code?.go) {
      setCode(session.task.starter_code.go)
      initRef.current = true
    }
  }, [session?.task?.starter_code?.go])

  // Session timer — starts counting up from mount (STUB: should derive from
  // session.started_at when backend wires it).
  const [elapsedMs, setElapsedMs] = useState(0)
  const startedRef = useRef<number>(Date.now())
  useEffect(() => {
    const id = setInterval(() => {
      setElapsedMs(Date.now() - startedRef.current)
    }, 1000)
    return () => clearInterval(id)
  }, [])
  const mm = Math.floor(elapsedMs / 60000).toString().padStart(2, '0')
  const ss = Math.floor((elapsedMs % 60000) / 1000).toString().padStart(2, '0')

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                className="mono"
                title="Session time"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  border: '1px solid var(--gold-faint)',
                  background: 'var(--bg-inset)',
                  color: 'var(--gold-bright)',
                  fontSize: 13,
                  letterSpacing: '0.08em',
                }}
              >
                <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>
                  ⏱
                </span>
                <span>
                  {mm}:{ss}
                </span>
              </div>
              <Link to={`/mock/${sessionId}/result`} style={{ textDecoration: 'none' }}>
                <Button tone="primary">{t('mock.finish')}</Button>
              </Link>
            </div>
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
                    <div
                      className="caps"
                      style={{
                        color: 'var(--gold-dim)',
                        marginBottom: 6,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>{t('mock.code')} · Go</span>
                      <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>
                        MONACO · ⌘+S TO RUN
                      </span>
                    </div>
                    <div
                      style={{
                        height: 320,
                        border: '1px solid var(--gold-faint)',
                        background: '#0a0c10',
                      }}
                    >
                      <Editor
                        height="100%"
                        defaultLanguage="go"
                        language="go"
                        value={code}
                        onChange={(v) => setCode(v ?? '')}
                        beforeMount={defineDruz9Theme}
                        theme="druz9-noir"
                        options={{
                          fontFamily:
                            "JetBrains Mono, Menlo, ui-monospace, monospace",
                          fontSize: 13,
                          lineHeight: 20,
                          minimap: { enabled: false },
                          scrollBeyondLastLine: false,
                          padding: { top: 10, bottom: 10 },
                          renderLineHighlight: 'line',
                          smoothScrolling: true,
                          cursorBlinking: 'smooth',
                          fontLigatures: true,
                          tabSize: 2,
                          wordWrap: 'on',
                        }}
                      />
                    </div>
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
