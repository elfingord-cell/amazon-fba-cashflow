// FBA-CF-0004h — Export/Import-View (konsistente Normalisierung + quickValidate)
// - Vorschau/Export zeigen openingEur & settings.openingBalance konsistent (de-DE)
// - quickValidate: leichtgewichtige Schema-Prüfung für Import
// - FIX: nur eine einzige $-Helper-Funktion

import { loadState, saveState, addStateListener } from "../data/storageLocal.js";
import { fmtEUR } from "../domain/metrics.js";

export async function render(root) {
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
          <h4 style="margin-top:12px">JSON-Vorschau (normalisiert)</h4>
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
          <textarea id="ta-import" class="inpt" style="min-height:220px; font-family: ui-monospace, Menlo, monospace"></textarea>
        </div>
      </div>
    </section>
  `;

  // Einziger Query-Helper
  function $(sel, el = root) { return el.querySelector(sel); }

  const elSummary    = $("#summary");
  const taJson       = $("#ta-json");
  const taImport     = $("#ta-import");
  const inFile       = $("#file-input");
  const btnExport    = $("#btn-export-file");
  const btnCopy      = $("#btn-copy-json");
  const btnSample    = $("#btn-load-sample");
  const btnApply     = $("#btn-apply");
  const btnClear     = $("#btn-clear");
  const btnPaste     = $("#btn-paste");
  const btnApplyText = $("#btn-apply-text");
  const elMeta       = $("#import-meta");

  // Initial & Live-Refresh
  const redraw = () => {
    const s = loadState();
    const norm = normalizeForExport(s);
    taJson.value = pretty(norm);
    elSummary.innerHTML = renderSummary(norm);
  };
  redraw();
  const off = addStateListener(redraw);

  // Export Datei
  btnExport.addEventListener("click", () => {
    const json = pretty(normalizeForExport(loadState()));
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const ts = tsName();
    downloadBlob(blob, `fba-cf-export-${ts}.json`);
  });

  // Export in Zwischenablage
  btnCopy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(pretty(normalizeForExport(loadState())));
      toast("JSON in die Zwischenablage kopiert.");
    } catch {
      toast("Kopieren nicht möglich. Bitte JSON manuell markieren und kopieren.");
    }
  });

  // Testdaten laden
  btnSample.addEventListener("click", () => {
    const base = loadState();
    const next = {
      ...base,
      openingEur: 50000.25,
      settings: { ...(base.settings||{}), openingBalance: "50.000,25", startMonth: "2025-02", horizonMonths: 18 },
      monthlyAmazonEur: 22500,
      payoutPct: 0.85,
      extras: [
        { month: "2025-03", label: "USt-Erstattung", amountEur: "1.500,00" },
        { month: "2025-05", label: "Einmaliger Zufluss", amountEur: "2.000,00" }
      ],
      outgoings: [
        { month: "2025-02", label: "Fixkosten", amountEur: "2.000,00" },
        { month: "2025-04", label: "Sonderausgabe", amountEur: "1.000,00" }
      ]
    };
    saveState(next);
    toast("Testdaten geladen.");
  });

  // Import: Datei → Vorschau
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
      if (!ok) { elMeta.innerHTML = `<span style="color:#b00020">${escapeHtml(msg)}</span>`; return; }
      importObj = obj;
      taImport.value = pretty(obj);
      elMeta.textContent = `${f.name} • ${formatBytes(f.size)} • gültig`;
      btnApply.disabled = false;
      btnClear.style.display = "inline-block";
    } catch (e) {
      elMeta.innerHTML = `<span style="color:#b00020">Ungültige JSON-Datei: ${escapeHtml(e?.message || e)}</span>`;
    }
  });

  // Import übernehmen (Textarea priorisiert; sonst Dateiobjekt)
  btnApply.addEventListener("click", () => {
    const txt = String(taImport.value || "").trim();
    let candidate = importObj;
    if (txt) {
      try { candidate = JSON.parse(stripBOM(txt)); }
      catch (e) { elMeta.innerHTML = `<span style="color:#b00020">Ungültige JSON (Text): ${escapeHtml(e?.message || e)}</span>`; return; }
    }
    if (!candidate) { elMeta.innerHTML = `<span style="color:#b00020">Kein Import vorhanden.</span>`; return; }
    const { ok, msg } = quickValidate(candidate);
    if (!ok) { elMeta.innerHTML = `<span style="color:#b00020">${escapeHtml(msg)}</span>`; return; }
    saveState(candidate);
    taImport.value = "";
    elMeta.textContent = "Import übernommen.";
    btnApply.disabled = true;
    btnClear.style.display = "none";
    inFile.value = "";
    toast("Import übernommen. Dashboard/Preview aktualisieren sich.");
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

  // Paste-Import
  btnPaste.addEventListener("click", async () => {
    try {
      const txt = await navigator.clipboard.readText();
      taImport.value = txt;
      elMeta.textContent = "Zwischenablage eingefügt. Prüfe/übernimm bei Bedarf.";
      btnApply.disabled = false;
      btnClear.style.display = "inline-block";
    } catch {
      toast("Zwischenablage nicht verfügbar. Bitte Text manuell einfügen.");
    }
  });

  // Aus Text übernehmen (explizit)
  btnApplyText.addEventListener("click", () => {
    try {
      const txt = stripBOM(String(taImport.value || ""));
      const obj = JSON.parse(txt);
      const { ok, msg } = quickValidate(obj);
      if (!ok) { elMeta.innerHTML = `<span style="color:#b00020">Ungültige JSON (Text): ${escapeHtml(msg)}</span>`; return; }
      saveState(obj);
      taImport.value = "";
      elMeta.textContent = "Import (aus Text) übernommen.";
      btnApply.disabled = true;
      btnClear.style.display = "none";
      inFile.value = "";
      toast("Import übernommen. Dashboard/Preview aktualisieren sich.");
    } catch (e) {
      elMeta.innerHTML = `<span style="color:#b00020">Ungültige JSON (Text): ${escapeHtml(e?.message || e)}</span>`;
    }
  });

  // Cleanup bei Navigationswechsel
  root._cleanup = () => { try { off && off(); } catch {} };

  // ---- Helpers ----
  function normalizeForExport(s) {
    const out = structuredClone(s || {});
    let n = NaN;
    if (typeof out.openingEur === "number" && isFinite(out.openingEur)) n = out.openingEur;
    else if (out?.settings?.openingBalance) n = toNum(out.settings.openingBalance);
    if (!isFinite(n)) n = 0;
    out.openingEur = n;
    out.settings = out.settings || {};
    out.settings.openingBalance = n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return out;
  }
  function pretty(obj) { return JSON.stringify(obj, null, 2); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function stripBOM(s) { return s.replace(/^\uFEFF/, "").trim(); }
  function tsName() { const d=new Date(); const z=(n)=>String(n).padStart(2,"0"); return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`; }
  function downloadBlob(blob, filename) { const a=document.createElement("a"); const url=URL.createObjectURL(blob); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
  function formatBytes(b) { if (b<1024) return `${b} B`; if (b<1024*1024) return `${(b/1024).toFixed(1)} KB`; return `${(b/1024/1024).toFixed(2)} MB`; }
  function toNum(x){ if(x==null) return 0; if(typeof x==="number") return x; return Number(String(x).replace(/\./g,"").replace(",", "."))||0; }
  function sum(arr) { return (arr||[]).reduce((a,r)=> a + toNum(r.amountEur), 0); }
  function pctStr(p){ if(p==null||!isFinite(p)) return "—"; const v=p>1?p:p*100; return v.toLocaleString("de-DE",{maximumFractionDigits:2})+" %"; }
  function toast(txt) {
    const div = document.createElement("div");
    div.textContent = txt;
    div.style.cssText = "position:fixed;right:12px;bottom:12px;background:#111;color:#fff;padding:8px 10px;border-radius:10px;opacity:.95;z-index:9999";
    document.body.appendChild(div);
    setTimeout(()=> div.remove(), 1800);
  }
  function renderSummary(s) {
    const opening = (typeof s.openingEur === "number" && isFinite(s.openingEur)) ? s.openingEur : toNum(s.settings?.openingBalance || 0);
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

  // --- quickValidate: einfache Schema-Prüfung ---
  function quickValidate(obj) {
    if (obj == null || typeof obj !== "object") {
      return { ok: false, msg: "Import muss ein JSON-Objekt sein." };
    }
    // erlaubte Top-Level-Felder (weich)
    const allowedTop = new Set([
      "settings","openingEur","monthlyAmazonEur","payoutPct","extras","outgoings"
    ]);
    for (const k of Object.keys(obj)) {
      if (!allowedTop.has(k)) {
        // nicht hart ablehnen; nur Hinweis
      }
    }
    // settings
    if (obj.settings != null) {
      if (typeof obj.settings !== "object") return { ok:false, msg:"'settings' muss ein Objekt sein." };
      if ("startMonth" in obj.settings && typeof obj.settings.startMonth !== "string") return { ok:false, msg:"'settings.startMonth' muss String sein (YYYY-MM)." };
      if ("horizonMonths" in obj.settings && !Number.isFinite(obj.settings.horizonMonths)) return { ok:false, msg:"'settings.horizonMonths' muss Zahl sein." };
      if ("openingBalance" in obj.settings && typeof obj.settings.openingBalance !== "string") return { ok:false, msg:"'settings.openingBalance' muss String im de-DE Format sein (z.B. 1.000,00)." };
    }
    // openingEur
    if ("openingEur" in obj && !Number.isFinite(obj.openingEur)) {
      return { ok:false, msg:"'openingEur' muss eine Zahl sein." };
    }
    // monthlyAmazonEur / payoutPct
    if ("monthlyAmazonEur" in obj && !Number.isFinite(obj.monthlyAmazonEur)) {
      return { ok:false, msg:"'monthlyAmazonEur' muss eine Zahl sein." };
    }
    if ("payoutPct" in obj && !Number.isFinite(obj.payoutPct)) {
      return { ok:false, msg:"'payoutPct' muss eine Zahl sein (0.85 = 85%)." };
    }
    // extras / outgoings Arrays
    const checkArr = (arr, name) => {
      if (!Array.isArray(arr)) return { ok:false, msg:`'${name}' muss ein Array sein.` };
      for (let i=0;i<arr.length;i++){
        const r = arr[i];
        if (r==null || typeof r!=="object") return { ok:false, msg:`'${name}[${i}]' muss ein Objekt sein.` };
        if (!("month" in r) && !("date" in r)) return { ok:false, msg:`'${name}[${i}]' braucht 'month' (YYYY-MM) oder 'date' (ISO).` };
        if ("month" in r && typeof r.month!=="string") return { ok:false, msg:`'${name}[${i}].month' muss String sein.` };
        if ("date" in r && typeof r.date!=="string") return { ok:false, msg:`'${name}[${i}].date' muss String sein.` };
        if ("label" in r && typeof r.label!=="string") return { ok:false, msg:`'${name}[${i}].label' muss String sein.` };
        if (!("amountEur" in r)) return { ok:false, msg:`'${name}[${i}]' braucht 'amountEur'.` };
        const t = typeof r.amountEur;
        if (!(t==="string" || t==="number")) return { ok:false, msg:`'${name}[${i}].amountEur' muss String (de-DE) oder Zahl sein.` };
      }
      return {ok:true};
    };
    if ("extras" in obj){ const r = checkArr(obj.extras, "extras"); if(!r.ok) return r; }
    if ("outgoings" in obj){ const r = checkArr(obj.outgoings, "outgoings"); if(!r.ok) return r; }
    return { ok:true, msg:"OK" };
  }
}
