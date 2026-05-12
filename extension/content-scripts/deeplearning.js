// deeplearning.js — F5 content script для learn.deeplearning.ai (short
// courses + DLAI specializations). Catches lesson completion via
// «Continue to next lesson» / «Course completed» banners.

(() => {
  let lastDetected = ''

  function detect() {
    const nextBtn = Array.from(document.querySelectorAll('button, a')).find((el) =>
      /next lesson|complete course|continue/i.test((el.textContent || '').trim()),
    )
    const completedBanner = Array.from(document.querySelectorAll('h1, h2')).find((el) =>
      /course completed|lesson complete|congratulations/i.test((el.textContent || '').trim()),
    )
    if (!nextBtn && !completedBanner) return

    const url = window.location.href.split('?')[0].split('#')[0]
    if (url === lastDetected) return
    lastDetected = url
    const title = (document.querySelector('h1')?.textContent || document.title || 'DLAI lesson').trim()
    chrome.runtime.sendMessage({
      type: 'druz9.detection',
      resourceUrl: url,
      title,
      kind: 'finished',
      source: 'deeplearning.ai',
    })
  }

  const observer = new MutationObserver(() => detect())
  observer.observe(document.body, { childList: true, subtree: true })
  detect()
})()
