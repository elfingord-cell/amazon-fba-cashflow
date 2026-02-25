import{l as P,F as w,G as I,s as A}from"./index--WS4jb3p.js";import{e as z}from"./cashflow-CaudacDm.js";import"./planProducts-BED_pyum.js";const $=(t,e=document)=>e.querySelector(t),y=t=>String(t??"").replace(/[&<>"]/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[e]);function p(t){return Number(String(t??0).replace(/\./g,"").replace(",","."))||0}function J(t,e){return(t||[]).reduce((i,d)=>i+(p(e(d))||0),0)}function S(t){return(Number(t)||0).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function B(t){var f,b;const e=[],i=[];p(t.openingEur)<0&&e.push("Opening darf nicht negativ sein."),(f=t==null?void 0:t.settings)!=null&&f.startMonth||e.push("Startmonat fehlt (settings.startMonth)."),(b=t==null?void 0:t.settings)!=null&&b.horizonMonths||e.push("Zeitraum (Monate) fehlt (settings.horizonMonths)."),(t.incomings||[]).forEach((n,r)=>{n.month||e.push(`Umsatz-Zeile ${r+1}: Monat fehlt.`);const c=p(n.revenueEur);(!Number.isFinite(c)||c<0)&&e.push(`Umsatz-Zeile ${r+1}: Umsatz ungültig.`);let o=n.payoutPct;o>1&&(o=o/100),o>=0&&o<=1||e.push(`Umsatz-Zeile ${r+1}: Quote muss zwischen 0 und 1 liegen (oder 0–100%).`)}),(t.extras||[]).forEach((n,r)=>{n.month||i.push(`Extras-Zeile ${r+1}: Monat fehlt (wird beim Import/Export dennoch übernommen).`),Number.isFinite(p(n.amountEur))||e.push(`Extras-Zeile ${r+1}: Betrag ungültig.`)}),(t.fixcosts||[]).forEach((n,r)=>{n.name||e.push(`Fixkosten ${r+1}: Name fehlt.`),p(n.amount)>0||e.push(`Fixkosten ${r+1}: Betrag ungültig.`),n.startMonth&&n.endMonth&&n.startMonth>n.endMonth&&e.push(`Fixkosten ${r+1}: Startmonat darf nicht nach Endmonat liegen.`)});const d=t.fixcostOverrides||{};return Object.entries(d).forEach(([n,r])=>{!r||typeof r!="object"||Object.entries(r).forEach(([c,o])=>{o&&o.amount&&!Number.isFinite(p(o.amount))&&e.push(`Fixkosten-Override ${n} ${c}: Betrag ungültig.`),o&&o.dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(o.dueDate)&&i.push(`Fixkosten-Override ${n} ${c}: Fälligkeit im Format JJJJ-MM-TT angeben.`)})}),{errors:e,warns:i}}function U(t){var d;const{_computed:e,...i}=structuredClone(t||{});return!i.openingEur&&((d=i==null?void 0:i.settings)!=null&&d.openingBalance)&&(i.openingEur=i.settings.openingBalance),i!=null&&i.settings&&delete i.settings.openingBalance,i.export={forecast:L(i)},i}function L(t){var M,x,v,E;const e=(t==null?void 0:t.settings)||{},i=e.startMonth||"2025-01",d=Number(e.horizonMonths||18),f=[],[b,n]=String(i).split("-").map(Number);for(let s=0;s<d;s+=1){const g=b+Math.floor((n-1+s)/12),h=(n-1+s)%12+1;f.push(`${g}-${String(h).padStart(2,"0")}`)}const r=((M=t==null?void 0:t.forecast)==null?void 0:M.forecastManual)||{},c=((x=t==null?void 0:t.forecast)==null?void 0:x.forecastImport)||{},o=((t==null?void 0:t.products)||[]).filter(s=>s==null?void 0:s.sku).map(s=>{const g=String(s.sku||"").trim(),h={},a=[];return f.forEach(l=>{var k,N,O;const m=((k=r==null?void 0:r[g])==null?void 0:k[l])??null,u=((O=(N=c==null?void 0:c[g])==null?void 0:N[l])==null?void 0:O.units)??null,F=m??u??null;h[l]=F,m!=null&&a.push(l)}),{sku:g,alias:s.alias||"",categoryId:s.categoryId||"",avgSellingPriceGrossEUR:Number.isFinite(Number(s.avgSellingPriceGrossEUR))?Number(s.avgSellingPriceGrossEUR):null,sellerboardMarginPct:Number.isFinite(Number(s.sellerboardMarginPct))?Number(s.sellerboardMarginPct):null,values:h,meta:{manualOverridesMonths:a}}});return{generatedAt:new Date().toISOString(),sourcePriority:["manual","ventoryOne"],lastImportAt:((v=t==null?void 0:t.forecast)==null?void 0:v.lastImportAt)||null,forecastLastImportedAt:((E=t==null?void 0:t.forecast)==null?void 0:E.lastImportAt)||null,months:f,items:o}}async function D(t){var x,v,E,s,g,h;let e=P();e.settings=e.settings||{startMonth:"2025-02",horizonMonths:18,openingBalance:"50.000,00"},e.incomings=Array.isArray(e.incomings)?e.incomings:[],e.extras=Array.isArray(e.extras)?e.extras:[],e.fixcosts=Array.isArray(e.fixcosts)?e.fixcosts:[],e.fixcostOverrides=e.fixcostOverrides&&typeof e.fixcostOverrides=="object"?e.fixcostOverrides:{};const i=(e.incomings||[]).reduce((a,l)=>{const m=p(l.revenueEur);let u=l.payoutPct;return u>1&&(u=u/100),a+m*(u||0)},0),d=J(e.extras,a=>a.amountEur),b=z(e,{today:new Date}).reduce((a,l)=>a+(l.amount||0),0),{errors:n,warns:r}=B(e),c=n.length===0,o=U(e),M=JSON.stringify(o,null,2);t.innerHTML=`
    <section class="card">
      <h2>Export / Import</h2>

      <div class="row" style="gap:8px; flex-wrap:wrap">
        <button id="btn-dl" class="btn${c?"":" disabled"}" title="${c?"":"Bitte Fehler beheben, dann exportieren."}" ${c?"":'disabled aria-disabled="true"'}>
          JSON herunterladen
        </button>
        <button id="btn-dl-backup" class="btn secondary">
          Backup JSON herunterladen
        </button>
        <label class="btn" for="file-imp" style="cursor:pointer">JSON importieren</label>
        <input id="file-imp" type="file" accept="application/json" class="hidden" />
        <button id="btn-seed" class="btn secondary">Testdaten laden</button>
        <span class="muted">Namespace: localStorage</span>
      </div>

      <div class="grid two" style="margin-top:12px">
        <div class="card soft">
          <h3 class="muted">Aktueller Stand (kurz)</h3>
          <ul class="simple">
            <li>Opening: <b>${S(p(e.openingEur))} €</b></li>
            <li>Sales × Payout: <b>${S(i)} €</b></li>
            <li>Extras (Σ): <b>${S(d)} €</b></li>
            <li>Fixkosten (Σ): <b>${S(b)} €</b></li>
            <li>Zeitraum: <b>${y(((x=e==null?void 0:e.settings)==null?void 0:x.startMonth)||"—")}, ${y(((v=e==null?void 0:e.settings)==null?void 0:v.horizonMonths)||0)} Monate</b></li>
          </ul>
        </div>

        <div class="card soft">
          <h3 class="muted">Validierung</h3>
          ${n.length===0&&r.length===0?`
            <div class="ok">✔︎ Keine Probleme gefunden.</div>
          `:`
            ${n.length?`<div class="danger" style="margin-bottom:6px"><b>Fehler</b><ul class="simple">${n.map(a=>`<li>${y(a)}</li>`).join("")}</ul></div>`:""}
            ${r.length?`<div class="warn"><b>Hinweise</b><ul class="simple">${r.map(a=>`<li>${y(a)}</li>`).join("")}</ul></div>`:""}
          `}
        </div>
      </div>

      <div class="card soft" style="margin-top:12px">
        <h3 class="muted">JSON Vorschau</h3>
        <pre style="white-space:pre-wrap;background:#fff;border:1px solid #eee;border-radius:8px;padding:8px;max-height:420px;overflow:auto">${y(M)}</pre>
      </div>
    </section>
  `,(E=$("#btn-dl"))==null||E.addEventListener("click",()=>{c&&w(o)}),(s=$("#btn-dl-backup"))==null||s.addEventListener("click",()=>{w(P())}),(g=$("#file-imp"))==null||g.addEventListener("change",a=>{var m;const l=(m=a.target.files)==null?void 0:m[0];l&&(I(l,u=>{if(!u||u.__error){alert("Ungültige JSON-Datei."+(u!=null&&u.__error?`
${u.__error}`:""));return}const{state:F,warnings:k}=u;window.dispatchEvent(new CustomEvent("remote-sync:local-import")),A(F),alert("Import übernommen."),D(t)}),a.target.value="")}),(h=$("#btn-seed"))==null||h.addEventListener("click",()=>{var l,m;const a={...e,openingEur:"10.000,00",incomings:[{month:((l=e==null?void 0:e.settings)==null?void 0:l.startMonth)||"2025-02",revenueEur:"20.000,00",payoutPct:.85},{month:"2025-03",revenueEur:"22.000,00",payoutPct:.85}],extras:[{month:"2025-04",label:"USt-Erstattung",amountEur:"1.500,00"}],fixcosts:[{id:"fix-export-demo",name:"Fixkosten",category:"Miete",amount:"2.000,00",frequency:"monthly",intervalMonths:1,anchor:"LAST",startMonth:((m=e==null?void 0:e.settings)==null?void 0:m.startMonth)||"2025-02",endMonth:"",proration:{enabled:!1,method:"none"},autoPaid:!0,notes:"Demo-Position"}],fixcostOverrides:{}};A(a),alert("Testdaten geladen."),D(t)})}export{D as render};
