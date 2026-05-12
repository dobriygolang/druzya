// neetcode.js — F5 content script. NeetCode embeds LeetCode submissions.
// Catches when юзер solves problem via NeetCode IDE (rare) OR clicks
// «Mark complete» checkbox in problem list.

(() => {
  let lastDetected = ''

  function detect() {
    // NeetCode renders a checkmark when problem is marked done.
    const completed = document.querySelector('[class*="completed" i], [data-state="checked"]')
    if (!completed) return

    const url = window.location.href.split('?')[0].split('#')[0]
    if (url === lastDetected) return
    lastDetected = url
    const title = (document.querySelector('h1')?.textContent || document.title || 'NeetCode problem').trim()
    chrome.runtime.sendMessage({
      type: 'druz9.detection',
      resourceUrl: url,
      title,
      kind: 'finished',
      source: 'neetcode',
    })
  }

  const observer = new MutationObserver(() => detect())
  observer.observe(document.body, { childList: true, subtree: true })
  detect()
})()
