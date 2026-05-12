// popup.js — F5 popup UI. Talks to background SW via chrome.runtime messages.
// Renders pending queue + mode picker + auth state.

async function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => resolve(res || {}))
  })
}

function pluralAgo(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} сек назад`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}ч назад`
  const d = Math.floor(h / 24)
  return `${d}д назад`
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

async function renderQueue() {
  const { queue = [] } = await send({ type: 'druz9.queue.get' })
  const list = document.getElementById('queue-list')
  const empty = document.getElementById('queue-empty')
  const pending = queue.filter((e) => e.status === 'pending_confirm' || e.status === 'failed')
  if (pending.length === 0) {
    list.innerHTML = ''
    empty.hidden = false
    return
  }
  empty.hidden = true
  list.innerHTML = pending
    .map(
      (e) => `
    <li data-id="${e.id}">
      <div class="title">${escape(e.title || '(без названия)')}</div>
      <div class="meta">${escape(e.source)} · ${pluralAgo(Date.now() - e.detectedAt)}${e.status === 'failed' ? ` · failed (${escape(e.failedReason || 'unknown')})` : ''}</div>
      <div class="actions">
        <button data-act="confirm">✓ log</button>
        <button data-act="dismiss">dismiss</button>
      </div>
    </li>
  `,
    )
    .join('')
  list.querySelectorAll('li').forEach((li) => {
    const id = li.dataset.id
    li.querySelector('[data-act="confirm"]').addEventListener('click', async () => {
      await send({ type: 'druz9.queue.confirm', id })
      void renderQueue()
    })
    li.querySelector('[data-act="dismiss"]').addEventListener('click', async () => {
      await send({ type: 'druz9.queue.dismiss', id })
      void renderQueue()
    })
  })
}

async function renderPrefs() {
  const { prefs } = await send({ type: 'druz9.prefs.get' })
  document.querySelectorAll('input[name="mode"]').forEach((input) => {
    input.checked = input.value === (prefs?.mode || 'confirm')
    input.addEventListener('change', async () => {
      if (input.checked) {
        await send({ type: 'druz9.prefs.set', prefs: { ...prefs, mode: input.value } })
      }
    })
  })
}

async function renderAuth() {
  const r = await chrome.storage.local.get('druz9.ext.token.v1')
  const token = r['druz9.ext.token.v1']
  const status = document.getElementById('auth-status')
  const btn = document.getElementById('auth-btn')
  if (token) {
    status.textContent = 'подключен'
    btn.textContent = 'Отключить'
    btn.onclick = async () => {
      await chrome.storage.local.remove('druz9.ext.token.v1')
      void renderAuth()
    }
  } else {
    status.textContent = 'не подключен'
    btn.textContent = 'Подключить'
    btn.onclick = () => {
      // Open druz9.online → юзер должен будет вручную скопировать token
      // из /profile/extension page после login (MVP). Backend Phase D:
      // дополнить OAuth-like extension flow.
      chrome.tabs?.create({ url: 'https://druz9.online/profile?tab=extension' })
    }
  }
}

void renderQueue()
void renderPrefs()
void renderAuth()

// Re-render on storage changes (auto-update badge).
chrome.storage?.onChanged.addListener(() => {
  void renderQueue()
  void renderAuth()
})
