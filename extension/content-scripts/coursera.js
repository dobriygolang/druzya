// coursera.js — F5 content script. Detects lecture / quiz completion
// on Coursera SPA. Course slug в URL + completion banner observed.

(() => {
  let lastDetected = ''

  function detect() {
    // Coursera signals completion через aria labels / checkmarks. Catches:
    //   - «Marked complete» button toggle state
    //   - quiz «Passed» banner с score
    const completeBtn = document.querySelector('button[aria-label*="complete" i]')
    const quizPassed = Array.from(document.querySelectorAll('h1, h2, h3, span')).find((el) =>
      /\bpassed\b|\bcompleted\b/i.test((el.textContent || '').trim().toLowerCase()),
    )
    if (!completeBtn && !quizPassed) return
    if (completeBtn?.getAttribute('aria-pressed') === 'false') return

    const url = window.location.href.split('?')[0].split('#')[0]
    if (url === lastDetected) return
    lastDetected = url
    const title = (document.querySelector('h1')?.textContent || document.title || 'Coursera').trim()
    chrome.runtime.sendMessage({
      type: 'druz9.detection',
      resourceUrl: url,
      title,
      kind: 'finished',
      source: 'coursera',
    })
  }

  const observer = new MutationObserver(() => detect())
  observer.observe(document.body, { childList: true, subtree: true })
  detect()
})()
