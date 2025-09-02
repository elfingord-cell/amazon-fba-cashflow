// FBA-CF-0004b — Export/Import View
// - Live-Refresh: JSON-Vorschau + Summary reagieren auf State-Changes
// - "Import übernehmen" parst jetzt standardmäßig den aktuellen Text aus der Vorschau/Textarea
// - Beibehalt: BOM-Strip, Validator, Paste-Import, Testdaten

import { loadState, saveState, addStateListener } from "../data/storageLocal.js";
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
          <div class="row" style="gap:8px; margin-top:8px; flex-wrap: wrap">
            <button class="btn" id="btn-apply" disabled>Import übernehmen</button>
            <button class="btn" id="btn-clear" style="display:none">Vorschau verwerfen</button>
            <button class="btn" id="btn-paste">Aus Zwischenablage einfügen</button>
            <button class="btn" id="btn-apply-text">Aus Text übernehmen</button>
          </div>
          <h4 style="margin-top:16px">Vorschau / Text-Import</h4>
          <textarea id="ta-import" class="inpt" style="min-height:220px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace"></textarea>
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
  const btnPaste = $("#btn-paste", root);
  const btnApplyText = $("#btn-apply-text", root);
  const elMeta = $("#import-meta", root);

  // --- Initial: Summary + JSON-Dump
  taJson.value = pretty(state);
  elSummary.innerHTML = renderSummary(state);

  // --- LIVE-REFRESH: aktualisiere JSON-Vorschau + Summary bei State-Änderungen
  const off = addStateListener(() => {
    const s = loadState();
    taJson.value = pretty(s);
    elSummary.innerHTML = renderSummary(s);
  });

  // Export: Datei
  btnExport.addEventListener("click", () => {
    // immer aktuellen Stand ziehen
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
      toast("Kopieren nicht möglich (Berechtigung). Bitte JSON manuell markieren und kopieren.");
    }
  });

  // Testdaten laden
  btnSample.addEventListener("click", () => {
    const next = withTestdata(loadState());
    saveState(next); // triggert live-refresh
    // live listener aktualisiert Preview/Summary automatisch
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
      const raw = await f.text();
      const txt = stripBOM(raw);
      const obj = JSON.parse(txt);
      const { ok, msg } = quickValidate(obj);
      if (!ok) {
        elMeta.innerHTML = `<span style="color:#b00020">${escapeHtml(msg)}</span>`;
        return;
      }
      importObj = obj;                 // Merke Original
      taImport.value = pretty(obj);    // …aber Textarea ist editierbar
      elMeta.textContent = `${f.name} • ${formatBytes(f.size)} • gültig`;
      btnApply.disabled = false;
      btnClear.style.display = "inline-block";
    } catch (e) {
      elMeta.innerHTML = `<span style="color:#b00020">Ungültige JSON-Datei: ${escapeHtml(e?.message || e)}</span>`;
    }
  });

  // Import anwenden (priorisiert Textarea-Inhalt; fallback: importObj)
  btnApply.addEventListener("click", () => {
    const txt = String(taImport.value || "").trim();
    let candidate = importObj;
    if (txt) {
      try {
        candidate = JSON.parse(stripBOM(txt));
      } catch (e) {
        elMeta.innerHTML = `<span style="color:#b00020">Ungültige JSON (Text): ${escapeHtml(e?.message || e)}</span>`;
        return;
      }
    }
    if (!candidate) {
      elMeta.innerHTML = `<span style="color:#b00020">Kein Import vorhanden. Datei wählen oder Text einfügen.</span>`;
      return;
    }
    const { ok, msg } = quickValidate(candidate);
    if (!ok) {
      elMeta.innerHTML = `<span style="color:#b00020">${escapeHtml(msg)}</span>`;
      return;
    }
    applyImport(candidate, "Import übernommen.");
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

  // Paste-Import (Zwischenablage → Textarea)
  btnPaste.addEventListener("click", async () => {
    try {
      const txt = await navigator.clipboard.readText();
      taImport.value = txt;
      elMeta.textContent = "Zwischenablage eingefügt. Prüfe und übernehme ggf. aus Text.";
      btnApply.disabled = false;
      btnClear.style.display = "inline-block";
    } catch {
      toast("Zwischenablage nicht verfügbar. Bitte Text manuell in das Feld einfügen.");
    }
  });

  // Aus Text übernehmen (explizit)
  btnApplyText.addEventListener("click", () => {
    try {
      const txt = stripBOM(String(taImport.value || ""));
      const obj = JSON.parse(txt);
      const { ok, msg } = quickValidate(obj);
      if (!ok) {
        elMeta.innerHTML = `<span style="color:#b00020">${escapeHtml(msg)}</span>`;
        return;
      }
      applyImport(obj, "Import (aus Text) übernommen.");
    } catch (e) {
      elMeta.innerHTML = `<span style="color:#b00020">Ungültige JSON (Text): ${escapeHtml(e?.message || e)}</span>`;
    }
  });

  // Cleanup Listener beim Navigationswechsel
  // (nicht zwingend notwendig, aber sauber)
  root._cleanup = () => { try { off && off(); } catch {} };

  // ---- Helfer
  function $(sel, el = document) { return el.querySelector(sel); }
  function pretty(obj) { return JSON.stringify(obj, null, 2); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function stripBOM(s) { return s.replace(/^\uFEFF/, "").trim(); }
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
    return {
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
  }
  function quickValidate(obj) {
    if (typeof obj !== "object" || obj === null) {
      return { ok: false, msg: "Root muss ein Objekt sein." };
    }
    if (obj.settings && typeof obj.settings !== "object") {
      return { ok: false, msg: "settings muss ein Objekt sein." };
    }
    for (const k of ["extras", "outgoings", "incomings"]) {
      if (k in obj && !Array.isArray(obj[k])) {
        return { ok: false, msg: `${k} muss Array sein.` };
      }
    }
    return { ok: true, msg: "ok" };
  }
  function applyImport(obj, msg) {
    saveState(obj);
    // Live-Listener aktualisiert Preview/Summary automatisch.
    taImport.value = "";
    elMeta.textContent = msg;
    btnApply.disabled = true;
    btnClear.style.display = "none";
    inFile.value = "";
    toast(msg + " Dashboard aktualisiert sich automatisch.");
  }
  function toast(txt) {
    const div = document.createElement("div");
    div.textContent = txt;
    div.style.cssText = "position:fixed;right:12px;bottom:12px;background:#111;color:#fff;padding:8px 10px;border-radius:10px;opacity:.95;z-index:9999";
    document.body.appendChild(div);
    setTimeout(()=> div.remove(), 1800);
  }
}
