// codewars.js — F5 content script. Codewars shows «Kata Successfully
// Completed!» modal after Pass tests.

(() => {
  let lastDetected = ''

  function detect() {
    const banner = Array.from(document.querySelectorAll('h1, h2, h3')).find((el) =>
      /successfully completed|kata.*passed/i.test((el.textContent || '').trim()),
    )
    if (!banner) return

    const url = window.location.href.split('?')[0].split('#')[0]
    if (url === lastDetected) return
    lastDetected = url
    const title = (document.querySelector('h4.ml-2, h1')?.textContent || document.title || 'Codewars kata').trim()
    chrome.runtime.sendMessage({
      type: 'druz9.detection',
      resourceUrl: url,
      title,
      kind: 'finished',
      source: 'codewars',
    })
  }

  const observer = new MutationObserver(() => detect())
  observer.observe(document.body, { childList: true, subtree: true })
  detect()
})()
