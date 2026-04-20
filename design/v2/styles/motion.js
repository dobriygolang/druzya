/* ============================================================
   DRUZ·IX — motion runtime
   - Intercepts same-origin <a href="*.html"> clicks, drops a veil,
     then navigates. On load, body's dm-fade-in handles re-entry.
   - Spawns cinder/dust particles at low density.
   - Honors reduced-motion + localStorage('druz9.motion') = 'off'.
   ============================================================ */
(function () {
  'use strict';

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionOff = (() => {
    try { return localStorage.getItem('druz9.motion') === 'off'; } catch { return false; }
  })();
  if (motionOff) document.documentElement.dataset.motion = 'off';

  // ============ VEIL ============
  function makeVeil() {
    if (document.getElementById('dm-veil')) return document.getElementById('dm-veil');
    const v = document.createElement('div');
    v.id = 'dm-veil';
    const g = document.createElement('div');
    g.className = 'dm-veil-glyph';
    g.textContent = '✦';
    v.appendChild(g);
    document.body.appendChild(v);
    return v;
  }

  function isInternalHtmlLink(a) {
    if (!a || !a.href) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download')) return false;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return false;
    if (!/\.html$/i.test(url.pathname)) return false;
    // Skip if same page + hash
    if (url.pathname === location.pathname && url.hash) return false;
    return true;
  }

  document.addEventListener('click', (e) => {
    if (prefersReduced || motionOff) return;
    const a = e.target.closest('a');
    if (!isInternalHtmlLink(a)) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

    e.preventDefault();
    const veil = makeVeil();
    veil.classList.add('dm-veil-active');

    setTimeout(() => { location.href = a.href; }, 340);
  }, { capture: true });

  // ============ CINDERS ============
  function spawnCinders() {
    if (prefersReduced || motionOff) return;
    let layer = document.getElementById('dm-cinders');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'dm-cinders';
      document.body.appendChild(layer);
    }

    const COUNT = 24;   // total particles alive
    const DUST_RATIO = 0.55;

    function spawn() {
      const el = document.createElement('div');
      const isDust = Math.random() < DUST_RATIO;
      el.className = 'dm-cinder' + (isDust ? ' dust' : '');
      const size = isDust
        ? 1 + Math.random() * 2
        : 1.5 + Math.random() * 2.5;
      el.style.width  = size + 'px';
      el.style.height = size + 'px';
      el.style.left = (Math.random() * 100) + 'vw';
      el.style.setProperty('--cinder-dx', ((Math.random() - 0.5) * 160) + 'px');
      el.style.setProperty('--cinder-dy', '-' + (100 + Math.random() * 20) + 'vh');
      const dur = (isDust ? 22 : 14) + Math.random() * 10;
      el.style.setProperty('--cinder-dur', dur + 's');
      el.style.setProperty('--cinder-opacity', (isDust ? 0.35 : 0.7) + Math.random() * 0.15);
      layer.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }

    // Prime with staggered spawns so not all start at bottom
    for (let i = 0; i < COUNT; i++) {
      setTimeout(spawn, Math.random() * 18000);
    }
    // Steady replenishment
    setInterval(spawn, 800);
  }

  // ============ RIPPLE ============
  document.addEventListener('click', (e) => {
    if (prefersReduced || motionOff) return;
    const target = e.target.closest('.dm-ripple, .btn, a.card');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    target.style.setProperty('--rx', (e.clientX - rect.left) + 'px');
    target.style.setProperty('--ry', (e.clientY - rect.top) + 'px');
    target.classList.remove('dm-ripple-go');
    void target.offsetWidth; // reflow
    target.classList.add('dm-ripple', 'dm-ripple-go');
    setTimeout(() => target.classList.remove('dm-ripple-go'), 600);
  }, { capture: true });

  // ============ BOOT ============
  function boot() {
    makeVeil();
    spawnCinders();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
