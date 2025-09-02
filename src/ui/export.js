// FBA-CF-0004 — Export/Import (JSON) + Testdaten
import { loadState, saveState, storage } from "../data/storageLocal.js";
import { fmtEUR } from "../domain/metrics.js";

export async function render(root) {
  const state = loadState();
  root.innerHTML = `
    <section class="card">
      <div class="row" style="align-items:center">
        <h2 style="margin:0">Export / Import</h2>
        <div style="flex:1"></div>
        <button class="btn" id="btn-export-file">Export als Datei</button>
        <button class="btn" id="btn-copy-json">Inhalte kopieren</button>
        <button class="btn" id="btn-load-sample">Testdaten laden</button>
      </div>
      <p class="muted">Der aktuelle Stand wird lokal im Browser gespeichert (localStorage). Du kannst ihn als JSON exportieren oder eine JSON-Datei importieren.</p>

      <div class="grid two" style="gap:16px; align-items:start">
        <div>
          <h3>Aktueller Stand (Kurzüberblick)</h3>
          <div id="summary" class="muted"></div>
          <h4 style="margin-top:12px">JSON-Vorschau</h4>
          <textarea id="ta-json" class="inpt" style="min-height:220px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace"></textarea>
        </div>
        <div>
          <h3>Import</h3>
          <input id="file-input" type="file" accept="application/json" />
          <div id="import-meta" class="muted" style="margin-top:8px"></div>
          <div class="row" style="gap:8px; margin-top:8px">
            <button class="btn" id="btn-apply" disabled>Import übernehmen</button>
            <button class="btn" id="btn-clear" style="display:none">Vorschau verwerfen</button>
          </div>
          <h4 style="margin-top:16px">Vorschau (Import-Datei)</h4>
          <textarea id="ta-import" class="inpt" style="min-height:220px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace" readonly></textarea>
        </div>
      </div>
    </section>
  `;

  // --- Elemente
  const elSummary = $("#summary", root);
  const taJson = $("#ta-json", root);
  const taImport = $("#ta-import", root);
  const inFile = $("#file-input", root);
  const btnExport = $("#btn-export-file", root);
  const btnCopy = $("#btn-copy-json", root);
  const btnSample = $("#btn-load-sample", root);
  const btnApply = $("#btn-apply", root);
  const btnClear = $("#btn-clear", root);
  const elMeta = $("#import-meta", root);

  // --- Initial: Summary + JSON-Dump
  taJson.value = pretty(state);
  elSummary.innerHTML = renderSummary(state);

  // Export: Datei
  btnExport.addEventListener("click", () => {
    const json = pretty(loadState());
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const ts = tsName();
    downloadBlob(blob, `fba-cf-export-${ts}.json`);
  });

  // Export: Kopieren
  btnCopy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(pretty(loadState()));
      toast("JSON in die Zwischenablage kopiert.");
    } catch {
      toast("Kopieren nicht möglich (Browserrecht). Bitte die JSON-Vorschau manuell markieren und kopieren.");
    }
  });

  // Testdaten laden
  btnSample.addEventListener("click", () => {
    const next = withTestdata(loadState());
    saveState(next); // löst live-refresh aus
    taJson.value = pretty(next);
    elSummary.innerHTML = renderSummary(next);
    toast("Testdaten geladen.");
  });

  // Import: Datei wählen → Vorschau
  let importObj = null;
  inFile.addEventListener("change", async () => {
    importObj = null;
    btnApply.disabled = true;
    elMeta.textContent = "";
    taImport.value = "";

    const f = inFile.files && inFile.files[0];
    if (!f) return;
    try {
      const txt = await f.text();
      const obj = JSON.parse(txt);
      const { ok, msg } = quickValidate(obj);
      if (!ok) {
        elMeta.innerHTML = `<span style="color:#b00020">${escapeHtml(msg)}</span>`;
        return;
      }
      importObj = obj;
      taImport.value = pretty(importObj);
      elMeta.textContent = `${f.name} • ${formatBytes(f.size)} • gültig`;
      btnApply.disabled = false;
      btnClear.style.display = "inline-block";
    } catch (e) {
      elMeta.innerHTML = `<span style="color:#b00020">Ungültige JSON-Datei.</span>`;
    }
  });

  // Import anwenden
  btnApply.addEventListener("click", () => {
    if (!importObj) return;
    // Vollständiger Replace ist hier beabsichtigt (einfach, nachvollziehbar)
    saveState(importObj);
    taJson.value = pretty(importObj);
    elSummary.innerHTML = renderSummary(importObj);
    taImport.value = "";
    elMeta.textContent = "Import übernommen.";
    btnApply.disabled = true;
    btnClear.style.display = "none";
    inFile.value = "";
    toast("Import übernommen. Dashboard aktualisiert sich automatisch.");
  });

  // Vorschau verwerfen
  btnClear.addEventListener("click", () => {
    importObj = null;
    taImport.value = "";
    elMeta.textContent = "";
    btnApply.disabled = true;
    btnClear.style.display = "none";
    inFile.value = "";
  });

  // ---- Helfer
  function $(sel, el = document) { return el.querySelector(sel); }
  function pretty(obj) { return JSON.stringify(obj, null, 2); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function tsName() {
    const d = new Date();
    const z = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
  }
  function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  function formatBytes(b) {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b/1024).toFixed(1)} KB`;
    return `${(b/1024/1024).toFixed(2)} MB`;
  }
  function sum(arr) { return (arr || []).reduce((a, r) => a + toNum(r.amountEur), 0); }
  function toNum(x) {
    if (x == null) return 0;
    if (typeof x === "number") return x;
    return Number(String(x).replace(/\./g, "").replace(",", ".")) || 0;
  }
  function pctStr(p) {
    if (p == null || !isFinite(p)) return "—";
    const v = p > 1 ? p : p * 100;
    return v.toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " %";
  }

  function renderSummary(s) {
    const opening = (s.openingEur != null) ? s.openingEur : toNum(s.settings?.openingBalance || 0);
    const monthly = s.monthlyAmazonEur || 0;
    const payout = s.payoutPct ?? null;
    const extras = sum(s.extras);
    const outs = sum(s.outgoings);
    const start = s.settings?.startMonth || "—";
    const horizon = s.settings?.horizonMonths || "—";
    return `
      <ul style="margin:0; padding-left:18px">
        <li>Opening: <b>${fmtEUR(opening)}</b></li>
        <li>Monatlicher Umsatz: <b>${fmtEUR(monthly)}</b></li>
        <li>Payout-Quote: <b>${pctStr(payout)}</b></li>
        <li>Extras gesamt: <b>${fmtEUR(extras)}</b> • Ausgaben gesamt: <b>${fmtEUR(outs)}</b></li>
        <li>Startmonat: <b>${start}</b> • Horizont: <b>${horizon}</b> Monate</li>
      </ul>`;
  }

  function withTestdata(s) {
    // setzt/überschreibt nur relevante Felder
    const next = {
      ...s,
      openingEur: 50000.25,
      monthlyAmazonEur: 22500,
      payoutPct: 0.85,
      settings: { ...(s.settings||{}), startMonth: "2025-02", horizonMonths: 18, openingBalance: "50.000,00" },
      extras: [
        { month: "2025-03", label: "USt-Erstattung", amountEur: "1.500,00" },
        { month: "2025-05", label: "Einmaliger Zufluss", amountEur: "2.000,00" }
      ],
      outgoings: [
        { month: "2025-02", label: "Fixkosten", amountEur: "2.000,00" },
        { month: "2025-04", label: "Sonderausgabe", amountEur: "1.000,00" }
      ]
    };
    return next;
  }

  function toast(msg) {
    // sehr einfache Einblendung
    const div = document.createElement("div");
    div.textContent = msg;
    div.style.cssText = "position:fixed;right:12px;bottom:12px;background:#111;color:#fff;padding:8px 10px;border-radius:10px;opacity:.95;z-index:9999";
    document.body.appendChild(div);
    setTimeout(()=> div.remove(), 1800);
  }
}
