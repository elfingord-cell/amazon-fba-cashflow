import{a as P,l as O,i as w,r as R,j as U}from"./index-CAzQztwo.js";import{p as T,f as q}from"./cashflow-rmBKYUQ9.js";import{c as G}from"./vatPreview-DzvrCVGo.js";import"./planProducts-CfB8BW_g.js";const H=new Intl.DateTimeFormat("de-DE",{month:"short",year:"numeric"}),j=new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}),_={deBrutto:"DE-Brutto",outputUst:"Output-USt",vstFees:"VSt Fees",fixkostenVst:"Fixkosten-VSt",eustErstattung:"EUSt-Erstattung",zahllast:"Zahllast"},Z={deBrutto:[{label:"SKU / Alias",getValue:t=>[t.label,t.sublabel].filter(Boolean).join(" – "),align:"left"},{label:"Units",getValue:t=>{var e;return((e=t.meta)==null?void 0:e.units)!=null?K(t.meta.units):"–"},align:"num"},{label:"Preis",getValue:t=>{var e;return((e=t.meta)==null?void 0:e.price)!=null?n(t.meta.price):"–"},align:"num"},{label:"Umsatzbeitrag",getValue:t=>n(t.amount),align:"num"}],outputUst:[{label:"Posten",getValue:t=>t.label,align:"left"},{label:"Betrag",getValue:t=>n(t.amount),align:"num"}],vstFees:[{label:"Quelle/Typ",getValue:t=>t.label,align:"left"},{label:"Basis",getValue:t=>t.sublabel||"–",align:"left"},{label:"VSt Betrag",getValue:t=>n(t.amount),align:"num"}],fixkostenVst:[{label:"Name",getValue:t=>t.label,align:"left"},{label:"VSt Anteil",getValue:t=>n(t.amount),align:"num"}],eustErstattung:[{label:"PO/FO",getValue:t=>t.label||"–",align:"left"},{label:"Event",getValue:t=>t.sublabel||"–",align:"left"},{label:"Datum",getValue:t=>t.date?j.format(new Date(t.date)):"–",align:"left"},{label:"Betrag",getValue:t=>n(t.amount),align:"num"}],zahllast:[{label:"Komponente",getValue:t=>t.label,align:"left"},{label:"Betrag",getValue:t=>n(t.amount),align:"num"}]};function n(t){return q(Number(t||0))}function K(t,e=0){return Number.isFinite(Number(t))?Number(t).toLocaleString("de-DE",{minimumFractionDigits:e,maximumFractionDigits:e}):"–"}function B(t){const[e,s]=t.split("-").map(Number);return H.format(new Date(e,s-1,1))}function M(t){const e=Number(String(t??"").replace(",","."));return Number.isFinite(e)?e:0}function Q(t){const e=document.createElement("div");return e.className="vat-preview-toolbar",e.innerHTML=`
    <label>
      EUSt-Lag (Monate)
      <input type="number" id="vat-eust-lag" min="0" value="${t.settings.eustLagMonths}" aria-label="EUSt Lag Monate" />
    </label>
    <label>
      DE-Anteil
      <input type="number" id="vat-de-share" step="0.01" min="0" max="1" value="${t.settings.deShareDefault}" aria-label="DE-Anteil Standard" />
    </label>
    <label>
      Gebührensatz
      <input type="number" id="vat-fee-rate" step="0.01" min="0" max="1" value="${t.settings.feeRateDefault}" aria-label="Gebührensatz Standard" />
    </label>
    <label>
      Fixkosten-VSt
      <input type="text" id="vat-fix-input" inputmode="decimal" value="${n(t.settings.fixInputDefault)}" aria-label="Fixkosten Vorsteuer Standard" />
    </label>
    <div class="vat-preview-toolbar-actions">
      <button type="button" class="btn secondary sm" id="vat-reset" aria-label="Alle zurücksetzen">Alle zurücksetzen</button>
    </div>
  `,e}function W(t,e){const s=m=>{const i=String(m??"");return i.includes(";")||i.includes(`
`)||i.includes('"')?`"${i.replace(/"/g,'""')}"`:i},c=t.map(m=>s(m.label)).join(";"),r=e.map(m=>t.map(i=>s(i.getValue(m))).join(";"));return[c,...r].join(`
`)}function J(t){var s;if((s=navigator.clipboard)!=null&&s.writeText)return navigator.clipboard.writeText(t);const e=document.createElement("textarea");e.value=t,e.style.position="fixed",e.style.opacity="0",document.body.appendChild(e),e.focus(),e.select();try{document.execCommand("copy")}finally{document.body.removeChild(e)}return Promise.resolve()}function X(t,e,s){var A,F;const c=(A=e==null?void 0:e.details)==null?void 0:A[s];if(!c)return;const r=_[s]||s,m=B(e.month),i=Array.isArray(c.items)?c.items:[],E=Z[s]||[{label:"Posten",getValue:o=>o.label,align:"left"},{label:"Betrag",getValue:o=>n(o.amount),align:"num"}],u=document.createElement("div");u.className="po-modal-backdrop vat-detail-modal",u.setAttribute("role","dialog"),u.setAttribute("aria-modal","true");const v=document.createElement("div");v.className="po-modal vat-detail-modal-frame",v.innerHTML=`
    <header class="po-modal-header">
      <div>
        <h3>Details – ${r} – ${m}</h3>
        ${c.formula?`<p class="muted small">${c.formula}</p>`:""}
      </div>
      <button class="btn ghost" type="button" data-close aria-label="Schließen">✕</button>
    </header>
  `;const g=document.createElement("div");if(g.className="po-modal-body",c.notes){const o=document.createElement("p");o.className="muted small vat-detail-notes",o.textContent=c.notes,g.appendChild(o)}const S=document.createElement("div");S.className="vat-detail-controls";let a="",l=i;const d=document.createElement("input");d.type="search",d.placeholder="Suche in Details",d.className="vat-detail-search",i.length>50&&S.appendChild(d);const f=document.createElement("div");f.className="muted small vat-detail-limit",i.length>50&&(f.textContent="Es werden nur die ersten 50 Zeilen angezeigt (Nutze Suche oder CSV kopieren).");const p=document.createElement("div");p.className="vat-detail-table-wrap ui-table-shell ui-scroll-host";const x=document.createElement("table");x.className="table-compact ui-table-standard vat-detail-table",x.innerHTML=`
    <thead>
      <tr>
        ${E.map(o=>`<th class="${o.align==="num"?"num":""}">${o.label}</th>`).join("")}
      </tr>
    </thead>
    <tbody></tbody>
    <tfoot>
      <tr>
        <td class="vat-detail-sum" colspan="${Math.max(1,E.length-1)}">Summe</td>
        <td class="num vat-detail-sum">${n(c.total??0)}</td>
      </tr>
    </tfoot>
  `,p.appendChild(x);const h=document.createElement("p");h.className="muted small vat-detail-empty",h.textContent="Keine Details verfügbar.";function b(){if(!a)l=i;else{const o=a.toLowerCase();l=i.filter(C=>{var L;return[C.label,C.sublabel,C.date,(L=C.meta)==null?void 0:L.sourceNumber].filter(Boolean).map(k=>String(k).toLowerCase()).join(" ").includes(o)})}}function y(){b();const o=x.querySelector("tbody");if(o.innerHTML="",!l.length){p.replaceWith(h);return}p.isConnected||h.replaceWith(p),(i.length>50&&!a?l.slice(0,50):l).forEach(z=>{const L=document.createElement("tr");E.forEach(k=>{const I=document.createElement("td");k.align==="num"&&(I.className="num"),I.textContent=k.getValue(z),L.appendChild(I)}),o.appendChild(L)})}d.addEventListener("input",o=>{a=o.target.value||"",y()});const V=document.createElement("footer");V.className="po-modal-actions";const $=document.createElement("button");$.type="button",$.className="btn secondary",$.textContent="CSV kopieren",$.addEventListener("click",()=>{b();const o=W(E,l);J(o)});const D=document.createElement("button");D.type="button",D.className="btn",D.textContent="Schließen",V.append($,D),S.childNodes.length&&g.appendChild(S),f.textContent&&g.appendChild(f),g.appendChild(i.length?p:h),v.appendChild(g),v.appendChild(V),u.appendChild(v),document.body.appendChild(u);function N(){u.remove()}u.addEventListener("click",o=>{o.target===u&&N()}),(F=v.querySelector("[data-close]"))==null||F.addEventListener("click",N),D.addEventListener("click",N),y()}function Y(t){const e=document.createElement("div");return e.className="vat-preview-kpis",e.innerHTML=`
    <div class="vat-preview-kpi">
      <span class="label">Output-USt gesamt</span>
      <span class="value">${n(t.totals.outVat)}</span>
    </div>
    <div class="vat-preview-kpi">
      <span class="label">VSt Fees gesamt</span>
      <span class="value">${n(t.totals.feeInputVat)}</span>
    </div>
    <div class="vat-preview-kpi">
      <span class="label">Fixkosten-VSt gesamt</span>
      <span class="value">${n(t.totals.fixInputVat)}</span>
    </div>
    <div class="vat-preview-kpi">
      <span class="label">Zahllast gesamt</span>
      <span class="value ${t.totals.payable<0?"is-negative":""}">${n(t.totals.payable)}</span>
    </div>
  `,e}function tt(t,e){var i,E,u,v,g,S;const s=document.createElement("div");s.className="panel vat-panel",s.innerHTML=`
    <div class="panel-header">
      <div>
        <h2>USt-Vorschau (DE)</h2>
        <p class="muted">19 % DE, Gebührenquote, Fixkosten-VSt und EUSt-Erstattung pro Monat</p>
      </div>
    </div>
    <div class="vat-preview-table-wrap table-wrap ui-table-shell ui-scroll-host">
      <table class="table-compact ui-table-standard vat-preview-table" aria-label="USt Vorschau Tabelle">
        <thead>
          <tr>
            <th>Monat</th>
            <th class="num">DE-Brutto</th>
            <th class="num">Output-USt</th>
            <th class="num">VSt Fees</th>
            <th class="num">Fixkosten-VSt</th>
            <th class="num">EUSt-Erstattung</th>
            <th class="num">Zahllast</th>
            <th class="vat-preview-actions-col"></th>
          </tr>
        </thead>
        <tbody class="vat-body"></tbody>
        <tfoot>
          <tr class="vat-preview-summary">
            <td>Summe</td>
            <td class="num">${n(e.totals.grossDe)}</td>
            <td class="num">${n(e.totals.outVat)}</td>
            <td class="num">${n(e.totals.feeInputVat)}</td>
            <td class="num">${n(e.totals.fixInputVat)}</td>
            <td class="num">${n(e.totals.eustRefund)}</td>
            <td class="num vat-payable ${e.totals.payable<0?"is-negative":""}">${n(e.totals.payable)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p class="muted small">Vereinfachte Schätzung (19 % DE; ohne RC/OSS). EUSt-Erstattung wird automatisch aus POs (Monatsende + Lag) übernommen.</p>
  `;const c=s.querySelector(".vat-body");e.rows.forEach((a,l)=>{const d=e.monthConfig[a.month],f=B(a.month),p=a.payable<0?"is-negative":"",x=l===0?"disabled":"",h=document.createElement("tr");h.className="vat-preview-row",h.dataset.month=a.month,h.innerHTML=`
      <td class="mono">${f}</td>
      <td class="num"><button class="vat-detail-trigger" type="button" data-detail-key="deBrutto" data-month="${a.month}" title="Details anzeigen">${n(a.grossDe)}</button></td>
      <td class="num"><button class="vat-detail-trigger" type="button" data-detail-key="outputUst" data-month="${a.month}" title="Details anzeigen">${n(a.outVat)}</button></td>
      <td class="num"><button class="vat-detail-trigger" type="button" data-detail-key="vstFees" data-month="${a.month}" title="Details anzeigen">${n(a.feeInputVat)}</button></td>
      <td class="num"><button class="vat-detail-trigger" type="button" data-detail-key="fixkostenVst" data-month="${a.month}" title="Details anzeigen">${n(a.fixInputVat)}</button></td>
      <td class="num"><button class="vat-detail-trigger" type="button" data-detail-key="eustErstattung" data-month="${a.month}" title="Details anzeigen">${n(a.eustRefund)}</button></td>
      <td class="num vat-payable ${p}"><button class="vat-detail-trigger ${p}" type="button" data-detail-key="zahllast" data-month="${a.month}" title="Details anzeigen">${n(a.payable)}</button></td>
      <td class="vat-preview-action">
        <button type="button" class="btn secondary sm" data-toggle="${a.month}" aria-expanded="false">Bearbeiten</button>
      </td>
    `;const b=document.createElement("tr");b.className="vat-preview-details",b.dataset.details=a.month,b.hidden=!0,b.innerHTML=`
      <td colspan="8">
        <div class="vat-preview-details-inner">
          <div class="vat-preview-fields">
            <label>
              DE-Anteil
              <input type="number" step="0.01" min="0" max="1" data-month="${a.month}" data-field="deShare" value="${d.deShare}" aria-label="DE-Anteil" />
            </label>
            <label>
              Gebührensatz
              <input type="number" step="0.01" min="0" max="1" data-month="${a.month}" data-field="feeRateOfGross" value="${d.feeRateOfGross}" aria-label="Gebührensatz" />
            </label>
            <label>
              Fixkosten-VSt
              <input type="text" inputmode="decimal" data-month="${a.month}" data-field="fixInputVat" value="${n(d.fixInputVat)}" aria-label="Fixkosten Vorsteuer" />
            </label>
          </div>
          <div class="vat-preview-actions">
            <button type="button" class="btn secondary sm" data-copy-prev="${a.month}" ${x} aria-label="Vormonat übernehmen">Vormonat übernehmen</button>
          </div>
        </div>
      </td>
    `,c.appendChild(h),c.appendChild(b)});const r=Q(e),m=Y(e);(i=s.querySelector(".panel-header"))==null||i.after(r),r.after(m),(E=r.querySelector("#vat-eust-lag"))==null||E.addEventListener("change",a=>{w({eustLagMonths:Number(a.target.value)||0})}),(u=r.querySelector("#vat-de-share"))==null||u.addEventListener("change",a=>{w({deShareDefault:M(a.target.value)})}),(v=r.querySelector("#vat-fee-rate"))==null||v.addEventListener("change",a=>{w({feeRateDefault:M(a.target.value)})}),(g=r.querySelector("#vat-fix-input"))==null||g.addEventListener("change",a=>{w({fixInputDefault:T(a.target.value)})}),(S=r.querySelector("#vat-reset"))==null||S.addEventListener("click",()=>{R()}),c.addEventListener("change",a=>{const l=a.target,d=l.getAttribute("data-field"),f=l.getAttribute("data-month");if(!d||!f)return;const p=d==="fixInputVat"?T(l.value):M(l.value);U(f,{[d]:p})}),c.addEventListener("click",a=>{const l=a.target.closest("[data-toggle]");if(l){const b=l.getAttribute("data-toggle"),y=c.querySelector(`[data-details="${b}"]`),V=l.getAttribute("aria-expanded")==="true";y&&(y.hidden=V,l.setAttribute("aria-expanded",String(!V)),l.textContent=V?"Bearbeiten":"Schließen");return}const d=a.target.closest(".vat-detail-trigger");if(d){const b=d.getAttribute("data-month"),y=d.getAttribute("data-detail-key"),V=e.rows.find($=>$.month===b);V&&y&&X(t,V,y);return}const f=a.target.closest("[data-copy-prev]");if(!f)return;const p=f.getAttribute("data-copy-prev"),x=e.months,h=x.indexOf(p);if(h>0){const b=x[h-1],y=e.monthConfig[b];U(p,{deShare:y.deShare,feeRateOfGross:y.feeRateOfGross,fixInputVat:y.fixInputVat})}}),t.appendChild(s)}function st(t){const e=t;e.innerHTML="";function s(){const r=O(),m=G(r),i={};m.months.forEach(u=>{var v,g,S,a,l,d;i[u]={deShare:Number(((g=(v=r.vatPreviewMonths)==null?void 0:v[u])==null?void 0:g.deShare)??r.settings.vatPreview.deShareDefault??.8),feeRateOfGross:Number(((a=(S=r.vatPreviewMonths)==null?void 0:S[u])==null?void 0:a.feeRateOfGross)??r.settings.vatPreview.feeRateDefault??.38),fixInputVat:T(((d=(l=r.vatPreviewMonths)==null?void 0:l[u])==null?void 0:d.fixInputVat)??r.settings.vatPreview.fixInputDefault??0)}}),m.settings=r.settings.vatPreview,m.monthConfig=i,m.months=m.months,e.innerHTML="",tt(e,m);const E=window.__routeQuery||{};if(E.month){const u=e.querySelector(`.vat-preview-row[data-month="${E.month}"]`);u&&(u.classList.add("row-focus"),u.scrollIntoView({block:"center",behavior:"smooth"}),window.__routeQuery={})}}return s(),{cleanup:P(()=>s())}}export{st as default};
