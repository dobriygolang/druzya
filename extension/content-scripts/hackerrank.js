// hackerrank.js — F5 content script. Detects «Congratulations!» on
// challenge submission pass.

(() => {
  let lastDetected = ''

  function detect() {
    const banner = Array.from(document.querySelectorAll('h1, h2, h3, .submission-status')).find((el) =>
      /\bsuccess\b|\baccepted\b|\bpassed\b|congratulations/i.test((el.textContent || '').trim()),
    )
    if (!banner) return

    const url = window.location.href.split('?')[0].split('#')[0]
    if (url === lastDetected) return
    lastDetected = url
    const title = (document.querySelector('h1')?.textContent || document.title || 'HackerRank challenge').trim()
    chrome.runtime.sendMessage({
      type: 'druz9.detection',
      resourceUrl: url,
      title,
      kind: 'finished',
      source: 'hackerrank',
    })
  }

  const observer = new MutationObserver(() => detect())
  observer.observe(document.body, { childList: true, subtree: true })
  detect()
})()
