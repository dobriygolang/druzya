// leetcode.js — F5 content script. Detects «Accepted» submission на
// /problems/<slug>/ pages.
//
// Strategy: MutationObserver watches <main> для «Accepted» banner.
// LeetCode SPA-навигация → URL изменяется без full reload, поэтому
// также слушаем popstate и re-init observer.

(() => {
  let lastDetected = ''

  function detectAccepted() {
    // LeetCode SPA renders submission verdict в data-cy="status" или
    // в banner с text "Accepted". Catch both:
    const candidates = [
      ...document.querySelectorAll('[data-cy="status"]'),
      ...document.querySelectorAll('[data-e2e-locator="submission-result"]'),
      ...document.querySelectorAll('.text-green-s, .text-success-s'),
    ]
    for (const el of candidates) {
      const text = (el.textContent || '').trim().toLowerCase()
      if (text.includes('accepted')) {
        const url = window.location.href.split('?')[0].split('#')[0]
        if (url === lastDetected) return
        lastDetected = url
        const titleEl = document.querySelector('h1, [data-cy="question-title"]')
        const title = (titleEl?.textContent || document.title || 'LeetCode problem').trim()
        chrome.runtime.sendMessage({
          type: 'druz9.detection',
          resourceUrl: url,
          title,
          kind: 'finished',
          source: 'leetcode',
        })
        return
      }
    }
  }

  const observer = new MutationObserver(() => detectAccepted())
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })

  // Reset on SPA navigation.
  let prevUrl = window.location.href
  setInterval(() => {
    if (window.location.href !== prevUrl) {
      prevUrl = window.location.href
      lastDetected = ''
    }
  }, 1000)

  detectAccepted()
})()
