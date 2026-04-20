import { ReactNode } from 'react'
import { Topbar, LeftSidebar, RightSidebar } from './chrome'

type Props = {
  children: ReactNode
  sidebars?: boolean
  left?: ReactNode
  right?: ReactNode
}

export function AppShell({ children, sidebars = true, left, right }: Props) {
  if (!sidebars) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateRows: 'var(--topbar-height) 1fr',
          minHeight: '100vh',
        }}
      >
        <Topbar />
        <main style={{ minHeight: 0, overflow: 'auto' }}>{children}</main>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: 'var(--topbar-height) 1fr',
        minHeight: '100vh',
      }}
    >
      <Topbar />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'var(--sidebar-left) minmax(0, 1fr) var(--sidebar-right)',
          minHeight: 0,
        }}
      >
        {left ?? <LeftSidebar />}
        <main
          style={{
            padding: '20px',
            overflow: 'auto',
            minHeight: 0,
          }}
        >
          {children}
        </main>
        {right ?? <RightSidebar />}
      </div>
    </div>
  )
}
