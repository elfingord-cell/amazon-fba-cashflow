// src/ui/fo.js
import { loadState, saveState } from "../data/storageLocal.js";

const fmtDE = (n)=> (Number(n)||0).toLocaleString("de-DE", {minimumFractionDigits:2, maximumFractionDigits:2});
const parseDE = (s)=> {
  if (s==null) return 0;
  const v = String(s).trim().replace(/\./g,"").replace(",",".");
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function render(root){
  const state = loadState();
  state.orders ||= {}; state.orders.fos ||= [];
  const fos = state.orders.fos;

  function redraw(){
    root.innerHTML = `
      <section class="card">
        <h2>Freight/Other (FO)</h2>
        <p class="muted">Einmalige, datumsgenaue Ausgaben (z. B. zusätzliche Freight, Gebühren). Positive Beträge werden als Kosten verbucht.</p>
        <table>
          <thead><tr><th style="width:160px">Datum</th><th>Label</th><th style="width:180px">Betrag (€)</th><th style="width:80px"></th></tr></thead>
          <tbody>
            ${fos.map((r,i)=>`
              <tr>
                <td><input type="date" value="${r.date||""}" data-i="${i}" data-k="date"></td>
                <td><input type="text" value="${r.label||""}" data-i="${i}" data-k="label"></td>
                <td><input type="text" value="${r.amountEur ?? ""}" data-i="${i}" data-k="amountEur" placeholder="0,00"></td>
                <td><button class="btn danger" data-i="${i}" data-act="del">×</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div style="margin-top:10px; display:flex; gap:8px">
          <button class="btn" data-act="add">+ FO hinzufügen</button>
          <span class="muted">Format: „1.234,56“ oder „1234.56“</span>
        </div>
      </section>
    `;

    root.querySelectorAll("input").forEach(inp=>{
      inp.addEventListener("change", (e)=>{
        const i = Number(e.target.getAttribute("data-i"));
        const k = e.target.getAttribute("data-k");
        const val = e.target.value;
        if (k==="amountEur"){
          // bei Blur in DE-Format normalisieren
          const num = parseDE(val);
          fos[i][k] = fmtDE(num);
        }else{
          fos[i][k] = val;
        }
        saveState(state);
      });
      if (inp.getAttribute("data-k")==="amountEur"){
        inp.addEventListener("blur", (e)=>{
          const i = Number(e.target.getAttribute("data-i"));
          const num = parseDE(e.target.value);
          e.target.value = fmtDE(num);
          fos[i].amountEur = e.target.value;
          saveState(state);
        });
      }
    });
    root.querySelectorAll("[data-act='del']").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const i = Number(btn.getAttribute("data-i"));
        fos.splice(i,1); saveState(state); redraw();
      });
    });
    const addBtn = root.querySelector("[data-act='add']");
    addBtn?.addEventListener("click", ()=>{
      const today = new Date(); const dd = String(today.getDate()).padStart(2,"0");
      const mm = String(today.getMonth()+1).padStart(2,"0"); const yy = today.getFullYear();
      fos.push({ date:`${yy}-${mm}-${dd}`, label:"", amountEur:"0,00" });
      saveState(state); redraw();
    });
  }
  redraw();
}
