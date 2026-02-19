import{l as _,s as p}from"./index-elUAAuqx.js";import{e as w}from"./cashflow-BOzsDTyz.js";import"./planProducts-BY0Y95Lf.js";function h(n,t=document){return t.querySelector(n)}function k(n){return Array.isArray(n)?n:[]}function I(n){if(n==null)return 0;const t=String(n).trim().replace(/\s+/g,"").replace(/[€]/g,"").replace(/\./g,"").replace(",","."),d=Number(t);return Number.isFinite(d)?d:0}function Q(n){if(n==null)return null;const t=String(n).trim().replace(/\s+/g,"").replace(/[^0-9,.-]/g,"");if(!t)return null;const d=t.lastIndexOf(","),l=t.lastIndexOf("."),f=Math.max(d,l);let u=t;if(f>=0){const b=t.slice(0,f).replace(/[.,]/g,""),x=t.slice(f+1).replace(/[.,]/g,"");u=`${b}.${x}`}else u=t.replace(/[.,]/g,"");const m=Number(u);return Number.isFinite(m)?m:null}function v(n){return Number(I(n)||0).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function F(n){return n==null||!Number.isFinite(Number(n))?"":Math.round(Number(n)).toLocaleString("de-DE",{maximumFractionDigits:0})}function J(n){const t=I(n);return Number(t||0).toLocaleString("de-DE",{minimumFractionDigits:0,maximumFractionDigits:2})}function W(n){if(!n)return"";if(/^\d{4}-\d{2}-\d{2}$/.test(n))return n;const t=n.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);return t?`${t[3]}-${t[2]}-${t[1]}`:""}function O(n){if(!n)return"";if(!/^\d{4}-\d{2}-\d{2}$/.test(n))return n;const[t,d,l]=n.split("-");return`${l}.${d}.${t}`}function G(n){if(!/^\d{4}-\d{2}$/.test(n||""))return n;const[t,d]=n.split("-").map(Number),l=new Date(t,d-1,1);l.setMonth(l.getMonth()+1);const f=l.getFullYear(),u=String(l.getMonth()+1).padStart(2,"0");return`${f}-${u}`}function X(n,t){if(!/^\d{4}-\d{2}$/.test(n))return n;const[d,l]=n.split("-").map(Number),f=new Date(d,l-1+t,1);return`${f.getFullYear()}-${String(f.getMonth()+1).padStart(2,"0")}`}function R(n,t){if(!t)return[];if(!/^\d{4}-\d{2}$/.test(n)||!/^\d{4}-\d{2}$/.test(t))return[];const[d,l]=n.split("-").map(Number),[f,u]=t.split("-").map(Number),m=d*12+(l-1),b=f*12+(u-1);if(b<m)return[];const x=[];for(let y=m;y<=b;y+=1){const $=Math.floor(y/12),L=y%12+1;x.push(`${$}-${String(L).padStart(2,"0")}`)}return x}function tt(n){const t=[];return[12,18,24].forEach(d=>{n.length>=d&&t.push({value:`next${d}`,label:`Nächste ${d}`})}),n.length&&t.push({value:"all",label:"Alle"}),t}function et(n,t){if(!n.length)return[];if(t==="all")return n.slice();const d=Number(String(t).replace("next",""))||0;return!Number.isFinite(d)||d<=0?n.slice():n.slice(0,d)}const z={range:"next12"};function nt(n){return n?/^\d{4}-\d{2}$/.test(n)?n:/^\d{4}-\d{2}-\d{2}$/.test(n)?n.slice(0,7):"":""}async function it(n){var C,A,K,H,B;const t=_();t.incomings=k(t.incomings),t.extras=k(t.extras),t.dividends=k(t.dividends),t.actuals=k(t.actuals),t.monthlyActuals=t.monthlyActuals&&typeof t.monthlyActuals=="object"?t.monthlyActuals:{},t.settings=t.settings||{},n.innerHTML=`
    <section class="card">
      <div class="ui-page-head">
        <div>
          <h2>Eingaben</h2>
        </div>
      </div>
      <div class="grid two">
        <label>
          Opening Balance (€)
          <input id="opening" inputmode="decimal" value="${v(t.settings.openingBalance||"0")}" aria-describedby="opening-help">
          <small id="opening-help" class="muted">Kommazahlen erlaubt (z. B. 150.000,00).</small>
        </label>
        <label>
          Startmonat
          <input id="startMonth" type="month" value="${t.settings.startMonth||"2025-01"}" aria-describedby="start-help">
          <small id="start-help" class="muted">Planungsbeginn, bestimmt die Zeithorizont-Achse.</small>
        </label>
      </div>
    </section>

    <section class="card">
      <h3>Umsätze × Payout</h3>
      <p class="muted">Optional können Umsätze aus der <a href="#forecast">Absatzprognose</a> übernommen werden.</p>
      <div class="income-legend">
        <span class="income-source-tag income-source-forecast">Prognose</span>
        <span class="income-source-tag income-source-manual">Manuell</span>
      </div>
      <div class="table-wrap ui-table-shell ui-scroll-host">
        <table class="table ui-table-standard">
          <thead><tr><th>Monat</th><th>Umsatz (€)</th><th>Payout (%)</th><th>Quelle</th><th></th></tr></thead>
          <tbody id="income-rows"></tbody>
        </table>
      </div>
      <button class="btn" id="income-add">+ Monat hinzufügen</button>
    </section>

    <section class="card">
      <h3>Extras (Ein-/Auszahlungen)</h3>
      <div class="table-wrap ui-table-shell ui-scroll-host">
        <table class="table ui-table-standard">
          <thead><tr><th>Datum (TT.MM.JJJJ)</th><th>Label</th><th>Betrag (€)</th><th></th></tr></thead>
          <tbody id="extras-rows"></tbody>
        </table>
      </div>
      <button class="btn" id="extra-add">+ Extra hinzufügen</button>
    </section>

    <section class="card">
      <h3>Fixkosten (Übersicht)</h3>
      <p class="muted">Pflege und Detailbearbeitung im Tab <strong>Fixkosten</strong>. Übersicht der geplanten Zahlungen im aktuellen Planungshorizont.</p>
      <div class="table-wrap ui-table-shell ui-scroll-host">
        <table class="table ui-table-standard">
          <thead><tr><th>Monat</th><th>Summe (€)</th><th>Bezahlt (€)</th><th>Offen (€)</th></tr></thead>
          <tbody id="fix-summary-rows"></tbody>
        </table>
      </div>
      <a class="btn secondary" href="#fixkosten">Zum Fixkosten-Tab</a>
    </section>

    <section class="card">
      <h3>Dividenden & KapESt</h3>
      <div class="table-wrap ui-table-shell ui-scroll-host">
        <table class="table ui-table-standard">
          <thead><tr><th>Monat</th><th>Label</th><th>Betrag (€)</th><th></th></tr></thead>
          <tbody id="dividend-rows"></tbody>
        </table>
      </div>
      <button class="btn" id="dividend-add">+ Dividenden-Zeile</button>
    </section>

    <section class="card">
      <div class="monthly-actuals-header">
        <div>
          <h3>Monats-Realdaten</h3>
          <p class="muted">Erfasse Ist-Umsätze, Auszahlungsquote und Kontostand je Monat. Werte werden im Dashboard für die Planung genutzt.</p>
        </div>
        <div class="monthly-actuals-controls">
          <label class="dashboard-range">
            <span>Monatsbereich</span>
            <select id="monthly-actuals-range"></select>
          </label>
          <div class="monthly-actuals-actions">
            <span class="muted" id="monthly-actuals-changes">Keine Änderungen</span>
            <button class="btn secondary" type="button" id="monthly-actuals-discard" disabled>Änderungen verwerfen</button>
            <button class="btn" type="button" id="monthly-actuals-save" disabled>Änderungen speichern</button>
          </div>
        </div>
      </div>
      <div class="table-wrap ui-table-shell ui-scroll-host">
        <table class="table ui-table-standard">
          <thead>
            <tr>
              <th>Monat</th>
              <th>Realer Umsatz (€)</th>
              <th>Reale Auszahlungsquote (%)</th>
              <th>Realer Kontostand Monatsende (€)</th>
            </tr>
          </thead>
          <tbody id="monthly-actuals-rows"></tbody>
        </table>
      </div>
    </section>
  `;const d=h("#income-rows",n),l=h("#extras-rows",n),f=h("#fix-summary-rows",n),u=h("#dividend-rows",n),m=h("#monthly-actuals-rows",n),b=h("#monthly-actuals-range",n),x=h("#monthly-actuals-changes",n),y=h("#monthly-actuals-discard",n),$=h("#monthly-actuals-save",n);function L(){if(!t.incomings.length){d.innerHTML='<tr><td colspan="5" class="muted">Keine Einträge</td></tr>';return}d.innerHTML=t.incomings.map((a,e)=>{const i=a.source==="forecast"?"forecast":"manual",s=i==="forecast"?"Prognose":"Manuell",r=i==="forecast"?"income-source-forecast":"income-source-manual";return`
          <tr data-idx="${e}" data-month="${a.month||""}" class="${r}">
            <td><input type="month" data-field="month" value="${a.month||""}"></td>
            <td><input type="text" data-field="revenueEur" inputmode="decimal" value="${v(a.revenueEur)}"></td>
            <td><input type="text" data-field="payoutPct" inputmode="decimal" value="${J(a.payoutPct)}"></td>
            <td><span class="income-source-tag ${r}">${s}</span></td>
            <td><button class="btn danger" data-remove="${e}">Entfernen</button></td>
          </tr>
        `}).join("")}function P(){if(!t.extras.length){l.innerHTML='<tr><td colspan="4" class="muted">Keine Einträge</td></tr>';return}l.innerHTML=t.extras.map((a,e)=>{const i=a.date||(a.month?`${a.month}-01`:"");return`
          <tr data-idx="${e}">
            <td><input type="text" placeholder="TT.MM.JJJJ" data-field="date" value="${O(i)}"></td>
            <td><input type="text" data-field="label" value="${a.label||""}"></td>
            <td><input type="text" inputmode="decimal" data-field="amountEur" value="${v(a.amountEur)}"></td>
            <td><button class="btn danger" data-remove="${e}">Entfernen</button></td>
          </tr>
        `}).join("")}function q(){const a=w(t,{today:new Date});if(!a.length){f.innerHTML='<tr><td colspan="4" class="muted">Keine Fixkosten geplant.</td></tr>';return}const e=new Map;a.forEach(s=>{e.has(s.month)||e.set(s.month,{total:0,paid:0});const r=e.get(s.month);r.total+=s.amount||0,s.paid&&(r.paid+=s.amount||0)});const i=Array.from(e.entries()).sort((s,r)=>s[0]<r[0]?-1:1).map(([s,r])=>{const o=Math.max(0,r.total-r.paid);return`
          <tr>
            <td>${s}</td>
            <td>${v(r.total)} €</td>
            <td>${v(r.paid)} €</td>
            <td>${v(o)} €</td>
          </tr>
        `}).join("");f.innerHTML=i}function T(){if(!t.dividends.length){u.innerHTML='<tr><td colspan="4" class="muted">Keine Einträge</td></tr>';return}u.innerHTML=t.dividends.map((a,e)=>`
        <tr data-idx="${e}">
          <td><input type="month" data-field="month" value="${a.month||""}"></td>
          <td><input type="text" data-field="label" value="${a.label||""}"></td>
          <td><input type="text" inputmode="decimal" data-field="amountEur" value="${v(a.amountEur)}"></td>
          <td><button class="btn danger" data-remove="${e}">Entfernen</button></td>
        </tr>
      `).join("")}let E=structuredClone(t.monthlyActuals||{}),g=structuredClone(E);const N=new Set;function D(){const a=N.size;x&&(x.textContent=a?`${a} Änderungen`:"Keine Änderungen"),y&&(y.disabled=!a),$&&($.disabled=!a)}function S(){const a=t.settings.startMonth||"2025-01",e=Number(t.settings.horizonMonths||12)||12,i=X(a,e-1),s=R(a,i),r=tt(s);r.length&&!r.some(c=>c.value===z.range)&&(z.range=r[0].value),b&&(b.innerHTML=r.map(c=>`<option value="${c.value}" ${c.value===z.range?"selected":""}>${c.label}</option>`).join(""));const o=r.length?et(s,z.range):s;if(!o.length){m.innerHTML='<tr><td colspan="4" class="muted">Keine Monate verfügbar.</td></tr>';return}m.innerHTML=o.map(c=>{const M=g[c]||{};return`
          <tr data-month="${c}">
            <td>${c}</td>
            <td><input type="text" inputmode="decimal" data-field="realRevenueEUR" value="${F(M.realRevenueEUR)}"></td>
            <td><input type="text" inputmode="decimal" data-field="realPayoutRatePct" value="${F(M.realPayoutRatePct)}"></td>
            <td><input type="text" inputmode="decimal" data-field="realClosingBalanceEUR" value="${F(M.realClosingBalanceEUR)}"></td>
          </tr>
        `}).join("")}L(),P(),q(),T(),S();function V(){const a=window.__routeQuery||{};if(!a.month)return;const e=a.month,i=d.querySelector(`tr[data-month="${e}"]`);i&&(i.classList.add("row-focus"),i.scrollIntoView({block:"center",behavior:"smooth"}),window.__routeQuery={})}V(),(C=h("#opening",n))==null||C.addEventListener("blur",a=>{const e=v(a.target.value);a.target.value=e,t.settings.openingBalance=e,p(t)}),(A=h("#startMonth",n))==null||A.addEventListener("change",a=>{t.settings.startMonth=a.target.value,p(t)}),(K=h("#income-add",n))==null||K.addEventListener("click",()=>{const a=t.incomings[t.incomings.length-1],e=a?G(a.month||t.settings.startMonth||""):t.settings.startMonth||"";t.incomings.push({month:e,revenueEur:"0,00",payoutPct:"0",source:"manual"}),p(t),L()}),(H=h("#extra-add",n))==null||H.addEventListener("click",()=>{t.extras.push({date:"",month:t.settings.startMonth||"",label:"",amountEur:"0,00"}),p(t),P()}),(B=h("#dividend-add",n))==null||B.addEventListener("click",()=>{t.dividends.push({month:t.settings.startMonth||"",label:"Dividende",amountEur:"0,00"}),p(t),T()}),b==null||b.addEventListener("change",()=>{z.range=b.value,S()}),d==null||d.addEventListener("input",a=>{const e=a.target.closest("tr");if(!e)return;const i=Number(e.dataset.idx),s=a.target.dataset.field;s&&t.incomings[i]&&(t.incomings[i][s]=a.target.value,["month","revenueEur","payoutPct"].includes(s)&&(t.incomings[i].source="manual"))}),d==null||d.addEventListener("focusout",a=>{const e=a.target.closest("input");if(!e)return;const i=e.closest("tr");if(!i)return;const s=Number(i.dataset.idx),r=e.dataset.field;if(r&&t.incomings[s])if(r==="revenueEur"){const o=v(e.value);t.incomings[s][r]=o,e.value=o}else if(r==="payoutPct"){const o=J(e.value);t.incomings[s][r]=o,e.value=o}else r==="month"&&(t.incomings[s][r]=e.value)}),d==null||d.addEventListener("change",()=>{p(t)}),d==null||d.addEventListener("click",a=>{const e=a.target.closest("button[data-remove]");if(!e)return;const i=Number(e.dataset.remove);t.incomings.splice(i,1),p(t),L()}),l==null||l.addEventListener("input",a=>{const e=a.target.closest("tr");if(!e)return;const i=Number(e.dataset.idx),s=a.target.dataset.field;s&&t.extras[i]&&(t.extras[i][s]=a.target.value)}),l==null||l.addEventListener("focusout",a=>{const e=a.target.closest("input");if(!e)return;const i=e.closest("tr");if(!i)return;const s=Number(i.dataset.idx),r=e.dataset.field;if(r&&t.extras[s])if(r==="amountEur"){const o=v(e.value);t.extras[s][r]=o,e.value=o}else if(r==="date"){const o=W(e.value);t.extras[s].date=o,t.extras[s].month=nt(o),e.value=o?O(o):""}else t.extras[s][r]=e.value.trim()}),l==null||l.addEventListener("change",()=>{p(t)}),l==null||l.addEventListener("click",a=>{const e=a.target.closest("button[data-remove]");if(!e)return;const i=Number(e.dataset.remove);t.extras.splice(i,1),p(t),P()}),u==null||u.addEventListener("input",a=>{const e=a.target.closest("tr");if(!e)return;const i=Number(e.dataset.idx),s=a.target.dataset.field;s&&t.dividends[i]&&(t.dividends[i][s]=a.target.value)}),u==null||u.addEventListener("focusout",a=>{const e=a.target.closest("input");if(!e)return;const i=e.closest("tr");if(!i)return;const s=Number(i.dataset.idx),r=e.dataset.field;if(r&&t.dividends[s])if(r==="amountEur"){const o=v(e.value);t.dividends[s][r]=o,e.value=o}else t.dividends[s][r]=e.value.trim()}),u==null||u.addEventListener("change",()=>{p(t)}),u==null||u.addEventListener("click",a=>{const e=a.target.closest("button[data-remove]");if(!e)return;const i=Number(e.dataset.remove);t.dividends.splice(i,1),p(t),T()}),m==null||m.addEventListener("input",a=>{var U;const e=a.target.closest("input[data-field]");if(!e)return;const i=e.closest("tr[data-month]");if(!i)return;const s=i.dataset.month,r=e.dataset.field,o=Q(e.value),c=o==null?null:Math.round(o);g[s]||(g[s]={}),c==null?(delete g[s][r],Object.keys(g[s]).length||delete g[s]):g[s][r]=c;const M=Number((U=E==null?void 0:E[s])==null?void 0:U[r]),Y=Number.isFinite(M)?M:null,Z=c!==Y,j=`${s}:${r}`;Z?N.add(j):N.delete(j),D()}),m==null||m.addEventListener("focusout",a=>{var c;const e=a.target.closest("input[data-field]");if(!e)return;const i=e.closest("tr[data-month]");if(!i)return;const s=i.dataset.month,r=e.dataset.field,o=(c=g==null?void 0:g[s])==null?void 0:c[r];e.value=F(o)}),y==null||y.addEventListener("click",()=>{g=structuredClone(E),N.clear(),S(),D()}),$==null||$.addEventListener("click",()=>{t.monthlyActuals=structuredClone(g),p(t),E=structuredClone(g),N.clear(),S(),D()}),D()}export{it as render};
