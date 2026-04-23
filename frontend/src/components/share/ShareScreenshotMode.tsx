// ShareScreenshotMode — wrapper that forces an exact 1200×630 viewport when
// the URL carries ?screenshot=1. Used by the backend OG-image renderer
// (puppeteer hits /weekly/share/{token}?screenshot=1 and crops the
// #screenshot-stage element).
//
// Behaviour:
//  - Off (default): renders children as-is.
//  - On: sets body class to hide chrome (footer CTA, scrollbar) and renders
//    children inside a fixed 1200×630 stage. Mobile breakpoints don't apply
//    inside the stage because we hard-set the width — `sm:`/`lg:` rules
//    behave as if on desktop (good — OG-card должен выглядеть как desktop).

import { useEffect, type ReactNode } from 'react'

export function useScreenshotMode(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('screenshot') === '1'
}

export function ShareScreenshotMode({ children }: { children: ReactNode }) {
  const on = useScreenshotMode()

  useEffect(() => {
    if (!on) return
    document.body.classList.add('share-screenshot-mode')
    return () => {
      document.body.classList.remove('share-screenshot-mode')
    }
  }, [on])

  if (!on) return <>{children}</>

  return (
    <div
      id="screenshot-stage"
      style={{
        width: '1200px',
        height: '630px',
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: 'rgb(var(--color-bg))',
      }}
    >
      <div className="flex h-full w-full flex-col gap-6 p-12">{children}</div>
    </div>
  )
}

export default ShareScreenshotMode
