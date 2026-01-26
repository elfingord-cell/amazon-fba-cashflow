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
  '#forecast': () => import('./ui/forecast.js'),
  '#fo': () => import('./ui/fo.js'),
  '#ust': () => import('./ui/ust.js'),
  '#produkte': () => import('./ui/products.js'),
  '#suppliers': () => import('./ui/suppliers.js'),
  '#settings': () => import('./ui/settings.js'),
  '#payments-export': () => import('./ui/paymentsExport.js'),
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

function parseHash(hash) {
  const normalised = normalizeHash(hash || '#dashboard');
  const [base, query] = normalised.split('?');
  const params = new URLSearchParams(query || '');
  const queryObj = {};
  params.forEach((value, key) => {
    queryObj[key] = value;
  });
  return { base, query: queryObj };
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
    ev.preventDefault();
    const targetHash = normalizeHash(link.getAttribute('href'));
    const currentHash = normalizeHash(location.hash);
    if (targetHash === currentHash) {
      renderRoute(targetHash);
    } else {
      location.hash = targetHash;
    }
    if (window.matchMedia('(max-width: 960px)').matches) {
      toggle.setAttribute('aria-expanded', 'false');
      layout.classList.add('sidebar-collapsed');
      sidebar.setAttribute('data-collapsed', 'true');
    }
  });
}

// akzeptiert verschiedene Modul-Formen
const pickRenderer = (mod) => (
  typeof mod?.default === 'function'
    ? mod.default
    : typeof mod?.render === 'function'
      ? mod.render
      : (mod?.default && typeof mod.default.render === 'function')
        ? mod.default.render
        : typeof mod?.mount === 'function'
          ? mod.mount
          : null
);

function renderRoute(forcedHash) {
  const candidate = typeof forcedHash === 'string' ? forcedHash : location.hash;
  const { base, query } = parseHash(candidate);
  const resolvedHash = routes[base] ? base : '#dashboard';
  window.__routeQuery = query;
  const loader = routes[resolvedHash];
  APP.classList.toggle('app-wide', resolvedHash === '#po' || resolvedHash === '#dashboard');
  setActiveTab(resolvedHash);
  if (typeof APP.__cleanup === 'function') {
    try { APP.__cleanup(); } catch {}
    APP.__cleanup = null;
  }
  APP.innerHTML = '';
  loader()
    .then(mod => {
      const fn = pickRenderer(mod);
      if (typeof fn === 'function') {
        const result = fn(APP);
        if (typeof APP.__cleanup !== 'function' && result && typeof result === 'object' && typeof result.cleanup === 'function') {
          APP.__cleanup = result.cleanup;
        }
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
window.addEventListener('state:changed', (event) => {
  const source = event?.detail?.source;
  const hash = normalizeHash(location.hash);
  if (source !== 'payment-update' || (hash !== '#po' && hash !== '#fo')) {
    renderRoute();
  }
});

initSidebarToggle();
renderRoute();
