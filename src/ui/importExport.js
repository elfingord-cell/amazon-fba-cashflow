
export function ImportExportView(state, save) {
  const el = document.createElement("section");
  el.innerHTML = `
    <div class="card">
      <h3>Export</h3>
      <p class="muted">Lädt eine JSON-Datei mit allen Daten herunter.</p>
      <button class="btn" id="btn-export">Export JSON</button>
    </div>
    <div class="card">
      <h3>Import</h3>
      <p class="muted">JSON-Datei auswählen. Bestehende Daten werden ersetzt.</p>
      <input type="file" id="file" accept="application/json" />
    </div>
  `;
  el.querySelector("#btn-export").addEventListener("click", () => {
    const { _computed, ...clean } = state || {};
    const data = JSON.stringify(clean, null, 2);
    const blob = new Blob([data], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g,"-");
    a.download = `fba-cashflow-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  el.querySelector("#file").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { const obj = JSON.parse(String(r.result||"{}")); save(obj); }
      catch { alert("Ungültige JSON-Datei."); }
      e.target.value = "";
    };
    r.readAsText(f);
  });
  return el;
}
