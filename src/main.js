// src/main.js
// Hash-Router, Active Tabs, Live-Refresh (storage + custom event)

const APP = document.getElementById('app');
const STATE_KEY = 'amazon_fba_cashflow_v1';

const routes = {
  '#dashboard': () => import('./ui/dashboard.js'),
  '#eingaben': () => import('./ui/eingaben.js'),
  '#po': () => import('./ui/po.js'),
  '#fo': () => import('./ui/fo.js'),
  '#export': () => import('./ui/export.js'),
  '#plan': () =>
    import('./ui/plan.js').catch(() => ({
      default: (el) => { el.innerHTML = `<section class="panel"><h2>Plan</h2><p>Stub – folgt.</p></section>`; }
    })),
  '#debug': () =>
    import('./ui/debug.js').catch(() => ({
      default: (el) => {
        let json = {};
        try { json = JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch {}
        el.innerHTML = `<section class="panel"><h2>Debug</h2><pre class="mono">${escapeHtml(JSON.stringify(json, null, 2))}</pre></section>`;
      }
    })),
};

function escapeHtml(str){return String(str).replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));}

function setActiveTab(hash) {
  document.querySelectorAll('a[data-tab]').forEach(a => {
    if (a.getAttribute('href') === hash) a.classList.add('active');
    else a.classList.remove('active');
  });
}

function renderRoute() {
  const hash = location.hash || '#dashboard';
  const loader = routes[hash] || routes['#dashboard'];
  setActiveTab(hash);
  loader()
    .then(mod => {
      const fn = mod && mod.default;
      if (typeof fn === 'function') fn(APP);
      else APP.innerHTML = `<section class="panel"><p>Route ${hash} hat kein gültiges Modul.</p></section>`;
    })
    .catch(err => {
      console.error(err);
      APP.innerHTML = `<section class="panel"><p>Fehler beim Laden: ${err?.message || err}</p></section>`;
    });
}

window.addEventListener('hashchange', renderRoute);
window.addEventListener('storage', (e) => {
  if (!e || e.key === STATE_KEY) renderRoute();
});
window.addEventListener('state:changed', renderRoute); // optionaler Custom-Event

renderRoute();
