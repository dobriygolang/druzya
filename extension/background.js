// background.js — F5 (Phase D 2026-05-12) Chrome MV3 service worker.
//
// Receives detection events from content scripts via chrome.runtime.onMessage,
// dedupes per (resourceUrl, hour-bucket), enqueues for confirm popup OR
// auto-logs based on user preference, and POSTs to backend `LogResource`
// or stores locally for later sync.
//
// MVP without backend wire: каждое detection попадает в local queue.
// Юзер открывает popup → видит pending activities → confirms / dismisses.
// После confirm — попытка POST к https://druz9.online/api/log_resource;
// если 401 / offline — остаётся в queue до next attempt.
//
// Wire shape to backend matches LogResource UC (existing intelligence
// service): { resource_url, kind, atlas_node_id?, occurred_at }.

const STORAGE_KEY_QUEUE = 'druz9.ext.queue.v1'
const STORAGE_KEY_TOKEN = 'druz9.ext.token.v1'
const STORAGE_KEY_PREFS = 'druz9.ext.prefs.v1'
const API_BASE = 'https://druz9.online'

const DEFAULT_PREFS = {
  // 'auto' = silently log; 'confirm' = popup нужен; 'off' = ignore all detections
  mode: 'confirm',
  dedupeWindowMs: 60 * 60 * 1000, // 1 hour
}

async function getPrefs() {
  const r = await chrome.storage.local.get(STORAGE_KEY_PREFS)
  return { ...DEFAULT_PREFS, ...(r[STORAGE_KEY_PREFS] || {}) }
}

async function setPrefs(prefs) {
  await chrome.storage.local.set({ [STORAGE_KEY_PREFS]: prefs })
}

async function getQueue() {
  const r = await chrome.storage.local.get(STORAGE_KEY_QUEUE)
  return Array.isArray(r[STORAGE_KEY_QUEUE]) ? r[STORAGE_KEY_QUEUE] : []
}

async function setQueue(items) {
  await chrome.storage.local.set({ [STORAGE_KEY_QUEUE]: items })
}

async function getToken() {
  const r = await chrome.storage.local.get(STORAGE_KEY_TOKEN)
  return r[STORAGE_KEY_TOKEN] || null
}

function bucketKey(url) {
  // Hour bucket: same problem solved twice within hour → не считаем дублем.
  const hour = Math.floor(Date.now() / (60 * 60 * 1000))
  return `${url}::${hour}`
}

async function enqueueDetection(event) {
  const prefs = await getPrefs()
  if (prefs.mode === 'off') return
  const queue = await getQueue()
  const key = bucketKey(event.resourceUrl)
  if (queue.some((e) => bucketKey(e.resourceUrl) === key)) return // dedupe
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...event,
    detectedAt: Date.now(),
    status: prefs.mode === 'auto' ? 'pending_upload' : 'pending_confirm',
  }
  queue.push(entry)
  await setQueue(queue)
  // Badge count для popup нудим юзера.
  await updateBadge(queue.filter((e) => e.status === 'pending_confirm').length)
  // Если auto-mode — попытаемся upload сразу.
  if (prefs.mode === 'auto') void tryUpload()
}

async function updateBadge(n) {
  try {
    await chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' })
    await chrome.action.setBadgeBackgroundColor({ color: '#FF3B30' })
  } catch {
    /* ignore */
  }
}

async function tryUpload() {
  const token = await getToken()
  if (!token) return // юзер не подключил аккаунт — упёрлось бы в 401
  const queue = await getQueue()
  const uploadable = queue.filter((e) => e.status === 'pending_upload')
  if (uploadable.length === 0) return

  for (const entry of uploadable) {
    try {
      const res = await fetch(`${API_BASE}/api/log_resource`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          resource_url: entry.resourceUrl,
          kind: entry.kind, // 'finished' | 'clicked' | etc.
          occurred_at: new Date(entry.detectedAt).toISOString(),
          atlas_node_id: entry.atlasNodeId || '',
          source: entry.source,
        }),
      })
      if (res.ok) entry.status = 'logged'
      else if (res.status === 401) {
        await chrome.storage.local.remove(STORAGE_KEY_TOKEN)
        break // нужно re-auth — выходим из цикла
      } else {
        entry.status = 'failed'
        entry.failedReason = `HTTP ${res.status}`
      }
    } catch (e) {
      entry.status = 'failed'
      entry.failedReason = String(e)
    }
  }
  await setQueue(queue.filter((e) => e.status !== 'logged'))
  await updateBadge(queue.filter((e) => e.status === 'pending_confirm').length)
}

// Listen for content-script messages.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'druz9.detection') {
    void enqueueDetection({
      resourceUrl: msg.resourceUrl,
      title: msg.title,
      kind: msg.kind || 'finished',
      source: msg.source,
      atlasNodeId: msg.atlasNodeId || '',
    })
    sendResponse({ ok: true })
    return true
  }
  if (msg?.type === 'druz9.queue.get') {
    void getQueue().then((q) => sendResponse({ queue: q }))
    return true // async response
  }
  if (msg?.type === 'druz9.queue.confirm') {
    void (async () => {
      const queue = await getQueue()
      const entry = queue.find((e) => e.id === msg.id)
      if (entry) {
        entry.status = 'pending_upload'
        await setQueue(queue)
        void tryUpload()
      }
      sendResponse({ ok: true })
    })()
    return true
  }
  if (msg?.type === 'druz9.queue.dismiss') {
    void (async () => {
      const queue = (await getQueue()).filter((e) => e.id !== msg.id)
      await setQueue(queue)
      await updateBadge(queue.filter((e) => e.status === 'pending_confirm').length)
      sendResponse({ ok: true })
    })()
    return true
  }
  if (msg?.type === 'druz9.token.set') {
    void chrome.storage.local
      .set({ [STORAGE_KEY_TOKEN]: msg.token })
      .then(() => sendResponse({ ok: true }))
    return true
  }
  if (msg?.type === 'druz9.prefs.set') {
    void setPrefs(msg.prefs).then(() => sendResponse({ ok: true }))
    return true
  }
  if (msg?.type === 'druz9.prefs.get') {
    void getPrefs().then((p) => sendResponse({ prefs: p }))
    return true
  }
  return false
})

// Periodic retry для failed uploads.
chrome.alarms?.create('druz9.retry', { periodInMinutes: 15 })
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === 'druz9.retry') void tryUpload()
})
