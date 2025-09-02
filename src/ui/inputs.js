// FBA-CF-0004e — Eingaben: Opening sofort speichern (ohne Cursor-Sprung)
// - Speichern auf input & change
// - Formatieren erst auf blur (de-DE)
// - Live-Refresh bei externen Änderungen

import { loadState, saveState, addStateListener } from "../data/storageLocal.js";

export async function render(root) {
  const s = loadState();
  const startMonth = s?.settings?.startMonth ?? "2025-02";
  const horizon = s?.settings?.horizonMonths ?? 18;
  const openingStr = s?.settings?.openingBalance ?? "50.000,00";

  root.innerHTML = `
    <section class="card">
      <h2>Eingaben</h2>
      <div class="grid two" style="gap:16px">
        <div>
          <label class="lbl" for="in-opening">Opening (EUR, de-DE)</label>
          <input id="in-opening" class="inpt" inputmode="decimal" autocomplete="off" spellcheck="false" />
          <small class="muted">Beispiel: <code>1000</code> oder <code>1.000,00</code>. Während des Tippens keine Autoformatierung; beim Verlassen wird formatiert.</small>
        </div>
        <div>
          <label class="lbl" for="in-start">Startmonat (YYYY-MM)</label>
          <input id="in-start" class="inpt" placeholder="2025-02" />
        </div>
        <div>
          <label class="lbl" for="in-horizon">Horizont (Monate)</label>
          <input id="in-horizon" class="inpt" type="number" min="1" max="36" />
        </div>
      </div>
      <div id="saved" class="muted" style="margin-top:8px; display:none">Gespeichert.</div>
    </section>
  `;

  const $ = (sel, el = root) => el.querySelector(sel);
  const elOpening = $("#in-opening");
  const elStart   = $("#in-start");
  const elHorizon = $("#in-horizon");
  const elSaved   = $("#saved");

  // Initiale Werte (Rohstring, keine Live-Formatierung)
  elOpening.value = openingStr;
  elStart.value = startMonth;
  elHorizon.value = String(horizon);

  // de-DE Helfer
  const parseDE = (x) => {
    if (x == null) return NaN;
    if (typeof x === "number") return x;
    const t = String(x).trim();
    if (!t) return NaN;
    return Number(t.replace(/\./g, "").replace(",", "."));
  };
  const fmtDE = (n) => {
    if (!isFinite(n)) return "0,00";
    return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const showSaved = () => {
    elSaved.style.display = "inline";
    clearTimeout(showSaved._t);
    showSaved._t = setTimeout(() => { elSaved.style.display = "none"; }, 700);
  };

  // Sofort speichern beim Tippen (Opening als Rohstring)
  const persistOpeningRaw = () => {
    const raw = elOpening.value; // unverändert
    const st = loadState();
    const next = { ...st, settings: { ...(st.settings || {}) } };
    next.settings.openingBalance = raw;
    saveState(next);             // storage kanonisiert openingEur automatisch
    showSaved();
  };
  elOpening.addEventListener("input", persistOpeningRaw);
  elOpening.addEventListener("change", persistOpeningRaw);

  // Beim Verlassen formatiert speichern
  elOpening.addEventListener("blur", () => {
    const n = parseDE(elOpening.value);
    const formatted = fmtDE(isFinite(n) ? n : 0);
    if (elOpening.value !== formatted) {
      elOpening.value = formatted;
      const st = loadState();
      const next = { ...st, settings: { ...(st.settings || {}) } };
      next.settings.openingBalance = formatted;
      saveState(next);
      showSaved();
    }
  });

  // Startmonat/Horizont speichern (instant)
  const persistSettings = () => {
    const st = loadState();
    const next = { ...st, settings: { ...(st.settings || {}) } };
    next.settings.startMonth = elStart.value || "2025-02";
    next.settings.horizonMonths = Math.max(1, Math.min(36, Number(elHorizon.value || 18) || 18));
    saveState(next);
    showSaved();
  };
  elStart.addEventListener("input", persistSettings);
  elStart.addEventListener("change", persistSettings);
  elHorizon.addEventListener("input", persistSettings);
  elHorizon.addEventListener("change", persistSettings);

  // Live-Refresh (falls Werte z.B. via Import geändert wurden)
  const off = addStateListener(() => {
    const st = loadState();
    const str = st?.settings?.openingBalance ?? "";
    if (document.activeElement !== elOpening) elOpening.value = str;
    if (document.activeElement !== elStart) elStart.value = st?.settings?.startMonth ?? "2025-02";
    if (document.activeElement !== elHorizon) elHorizon.value = String(st?.settings?.horizonMonths ?? 18);
  });

  // Cleanup bei Tabwechsel
  root._cleanup = () => { try { off && off(); } catch {} };
}
