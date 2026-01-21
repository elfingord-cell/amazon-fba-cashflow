// src/main.js
// Hash-Router, Active Tabs, Live-Refresh (storage + custom event)
// Toleranter Modul-Loader: akzeptiert default export FUNCTION, named export render FUNCTION,
// oder default-Objekt mit .render FUNCTION.

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

// akzeptiert verschiedene Modul-Formen
function pickRenderer(mod) {
  if (!mod) return null;
  if (typeof mod.default === 'function') return mod.default;
  if (typeof mod.render === 'function') return mod.render;
  if (mod.default && typeof mod.default.render === 'function') return mod.default.render;
  if (typeof mod.mount === 'function') return mod.mount;
  return null;
}

function renderRoute() {
  const hash = location.hash || '#dashboard';
  const loader = routes[hash] || routes['#dashboard'];
  setActiveTab(hash);
  loader()
    .then(mod => {
      const fn = pickRenderer(mod);
      if (typeof fn === 'function') {
        fn(APP);
        initTableEnhancements(APP);
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

renderRoute();

function initTableEnhancements(root) {
  const tables = root.querySelectorAll("table");
  tables.forEach((table) => {
    addHeaderTooltips(table);
    enableColumnResizing(table);
  });
}

function addHeaderTooltips(table) {
  const headers = table.querySelectorAll("thead th");
  headers.forEach((th) => {
    const label = th.textContent?.trim();
    if (!label) return;
    th.setAttribute("title", label);
    if (!th.hasAttribute("aria-label")) th.setAttribute("aria-label", label);
  });
}

function enableColumnResizing(table) {
  const headerRow = table.querySelector("thead tr:last-child");
  if (!headerRow) return;
  const headers = Array.from(headerRow.querySelectorAll("th"));
  if (!headers.length) return;
  table.classList.add("table-resizable");
  if (!table.style.tableLayout) table.style.tableLayout = "fixed";
  headers.forEach((th, index) => {
    if (th.colSpan && th.colSpan > 1) return;
    if (th.querySelector(".col-resize-handle")) return;
    const handle = document.createElement("span");
    handle.className = "col-resize-handle";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", "Spaltenbreite anpassen");
    handle.addEventListener("pointerdown", (event) => {
      startColumnResize(event, table, index);
    });
    th.appendChild(handle);
  });
}

function startColumnResize(event, table, index) {
  event.preventDefault();
  event.stopPropagation();
  const headerRow = table.querySelector("thead tr:last-child");
  if (!headerRow) return;
  const headerCell = headerRow.children[index];
  if (!headerCell) return;

  const startX = event.clientX;
  const startWidth = headerCell.getBoundingClientRect().width;
  const minWidth = 60;

  const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
  const footerRows = Array.from(table.querySelectorAll("tfoot tr"));
  const rows = bodyRows.concat(footerRows);

  table.classList.add("is-resizing");
  const previousCursor = document.body.style.cursor;
  const previousSelect = document.body.style.userSelect;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";

  const setWidth = (width) => {
    const nextWidth = `${Math.max(minWidth, width)}px`;
    headerCell.style.width = nextWidth;
    rows.forEach((row) => {
      const cell = row.children[index];
      if (cell) cell.style.width = nextWidth;
    });
  };

  const onMove = (moveEvent) => {
    const delta = moveEvent.clientX - startX;
    setWidth(startWidth + delta);
  };

  const onUp = () => {
    table.classList.remove("is-resizing");
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousSelect;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
