// src/main.js
// Hash-Router, Active Tabs, Live-Refresh (storage + custom event)
// Toleranter Modul-Loader: akzeptiert default export FUNCTION, named export render FUNCTION,
// oder default-Objekt mit .render FUNCTION.

const APP = document.getElementById('app');
const STATE_KEY = 'amazon_fba_cashflow_v1';

const routes = {
  '#dashboard': () => import('./ui/dashboard.js'),
  '#eingaben': () => import('./ui/eingaben.js'),
  '#fixkosten': () => import('./ui/fixkosten.js'),
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

function normalizeHash(hash) {
  if (!hash) return '#dashboard';
  return hash.startsWith('#') ? hash : `#${hash}`;
}

function initSidebarToggle() {
  const toggle = document.querySelector('.sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  const layout = document.querySelector('.layout');
  if (!toggle || !sidebar || !layout) return;
  const mq = window.matchMedia('(max-width: 960px)');
  function applyMatch() {
    if (mq.matches) {
      toggle.setAttribute('aria-expanded', 'false');
      layout.classList.add('sidebar-collapsed');
      sidebar.setAttribute('data-collapsed', 'true');
    } else {
      toggle.setAttribute('aria-expanded', 'true');
      layout.classList.remove('sidebar-collapsed');
      sidebar.removeAttribute('data-collapsed');
    }
  }
  applyMatch();
  mq.addEventListener('change', applyMatch);
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    const next = !expanded;
    toggle.setAttribute('aria-expanded', String(next));
    layout.classList.toggle('sidebar-collapsed', !next);
    if (!next) {
      sidebar.setAttribute('data-collapsed', 'true');
    } else {
      sidebar.removeAttribute('data-collapsed');
    }
  });
  sidebar.addEventListener('click', ev => {
    const link = ev.target.closest('a[data-tab]');
    if (!link) return;
    const targetHash = normalizeHash(link.getAttribute('href'));
    if (targetHash === normalizeHash(location.hash)) {
      ev.preventDefault();
      renderRoute(targetHash);
    }
    if (window.matchMedia('(max-width: 960px)').matches) {
      toggle.setAttribute('aria-expanded', 'false');
      layout.classList.add('sidebar-collapsed');
      sidebar.setAttribute('data-collapsed', 'true');
    }
  });
}

// akzeptiert verschiedene Modul-Formen
function pickRenderer(mod) {
  if (!mod) return null;
  if (typeof mod.default === 'function') return mod.default;
  if (typeof mod.render === 'function') return mod.render;
  if (mod.default && typeof mod.default.render === 'function') return mod.default.render;
  if (typeof mod.mount === 'function') return mod.mount;
  return null;
}

function renderRoute(forcedHash) {
  const candidate = typeof forcedHash === 'string' ? forcedHash : location.hash;
  const hash = normalizeHash(candidate);
  const loader = routes[hash] || routes['#dashboard'];
  setActiveTab(hash);
  APP.innerHTML = '';
  loader()
    .then(mod => {
      const fn = pickRenderer(mod);
      if (typeof fn === 'function') {
        fn(APP);
      } else {
        console.warn('Route-Modul ohne passenden Export. Verfügbare Keys:', Object.keys(mod || {}));
        APP.innerHTML = `<section class="panel">
          <h2>Hinweis</h2>
          <p>Route <code>${hash}</code> hat kein gültiges Modul-Export-Muster.</p>
          <p>Erwartet: <code>export default function(el){...}</code> <em>oder</em> <code>export function render(el){...}</code>.</p>
        </section>`;
      }
    })
    .catch(err => {
      console.error(err);
      APP.innerHTML = `<section class="panel"><p>Fehler beim Laden: ${escapeHtml(err?.message || String(err))}</p></section>`;
    });
}

window.addEventListener('hashchange', renderRoute);
window.addEventListener('storage', (e) => {
  if (!e || e.key === STATE_KEY) renderRoute();
});
window.addEventListener('state:changed', renderRoute);

initSidebarToggle();
renderRoute();
