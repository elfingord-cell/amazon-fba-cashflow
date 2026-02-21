import{a as he}from"./index-DN7VFcDZ.js";import{l as O,c as _,a as ye,b as ve}from"./store-DeED5oF-.js";import{p as ke}from"./forecastCsv-Bg9-7iuH.js";const te="VentoryOne Forecast importieren (CSV)",ae="forecast_view_v1",Se={search:"",range:"next12",onlyActive:!0,onlyWithForecast:!1,view:"units",collapsed:{}},u=(()=>{const e=ye(ae,{});return{...Se,...e,collapsed:e&&e.collapsed||{}}})();u.scrollLeft=Number(u.scrollLeft||0);function D(){ve(ae,{search:u.search,range:u.range,onlyActive:u.onlyActive,onlyWithForecast:u.onlyWithForecast,view:u.view,collapsed:u.collapsed})}function W(e){if(e==null)return null;if(typeof e=="number")return Number.isFinite(e)?e:null;const t=String(e).trim().replace(/\s+/g,"").replace(/[^0-9,.-]/g,"");if(!t)return null;const a=t.lastIndexOf(","),i=t.lastIndexOf("."),l=Math.max(a,i);let s=t;if(l>=0){const f=t.slice(0,l).replace(/[.,]/g,""),d=t.slice(l+1).replace(/[.,]/g,"");s=`${f}.${d}`}else s=t.replace(/[.,]/g,"");const o=Number(s);return Number.isFinite(o)?o:null}function Z(e){return e==null||!Number.isFinite(Number(e))?"0,00":Number(e).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function Ee(e){return e==null||!Number.isFinite(Number(e))?"—":Math.round(Number(e)).toLocaleString("de-DE",{maximumFractionDigits:0})}function $e(e){return e==null||!Number.isFinite(Number(e))?"—":`${Math.round(Number(e)).toLocaleString("de-DE",{maximumFractionDigits:0})} €`}function R(e){return`month-col ${e%2===1?"month-col-alt":""}`.trim()}function we(e){return e==="revenue"?"Umsatz":e==="profit"?"Gewinn":"Absatz"}function A(e,t){return e==="units"?Ee(t):$e(t)}function F(e){const t=e.filter(a=>Number.isFinite(a));return t.length?t.reduce((a,i)=>a+i,0):null}function G(e,t,a,i){return a.map(l=>{const s=t.map(o=>{const f=String((o==null?void 0:o.sku)||"").trim();if(!f)return null;const d=x(e,f,l);return H(i,d,o)});return F(s)})}function Ne(e){if(!e)return!1;if(typeof e.active=="boolean")return e.active;const t=String(e.status||"").trim().toLowerCase();return t?t==="active"||t==="aktiv":!0}function Me(e,t=[]){const a=new Map;e.forEach(o=>{const f=o.categoryId?String(o.categoryId):"";a.has(f)||a.set(f,[]),a.get(f).push(o)});const l=t.slice().sort((o,f)=>{const d=Number.isFinite(o.sortOrder)?o.sortOrder:0,N=Number.isFinite(f.sortOrder)?f.sortOrder:0;return d-N||String(o.name||"").localeCompare(String(f.name||""))}).map(o=>({id:String(o.id),name:o.name||"Ohne Kategorie",items:a.get(String(o.id))||[]})),s=a.get("")||[];return s.length&&l.push({id:"uncategorized",name:"Ohne Kategorie",items:s}),l.filter(o=>o.items.length)}function Le(e,t){const a=[],[i,l]=String(e).split("-").map(Number);for(let s=0;s<t;s+=1){const o=i+Math.floor((l-1+s)/12),f=(l-1+s)%12+1;a.push(`${o}-${String(f).padStart(2,"0")}`)}return a}function X(e,t){if(t==="all")return e;const a=Number(String(t).replace("next",""))||e.length;return e.slice(0,a)}function Ae(){const e=new Date;return`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}`}function Ce(e){const t=[];return[12,18,24].forEach(a=>{e.length>=a&&t.push({value:`next${a}`,label:`Nächste ${a}`})}),t.push({value:"all",label:"Alle"}),t}function ne(e,t,a){const i=e&&e.forecast,l=i&&i.forecastImport;if(!l)return null;const s=l[t];return s&&s[a]||null}function se(e,t,a){const i=e&&e.forecast,l=i&&i.forecastManual;if(!l)return null;const s=l[t];if(!s||typeof s!="object")return null;const o=s[a];return typeof o>"u"?null:o}function x(e,t,a){const i=se(e,t,a);if(i!=null)return i;const l=ne(e,t,a);return!l||typeof l!="object"||typeof l.units>"u"?null:l.units}function H(e,t,a){if(t==null||!Number.isFinite(Number(t)))return null;const i=Number(t);if(e==="units")return i;const l=W(a&&a.avgSellingPriceGrossEUR);if(!Number.isFinite(l))return null;const s=i*l;if(e==="revenue")return s;const o=W(a&&a.sellerboardMarginPct);return Number.isFinite(o)?s*(o/100):null}function Fe(e,t){const a=new Map,i=Array.isArray(e==null?void 0:e.products)?e.products:[];return t.forEach(l=>a.set(l,0)),i.forEach(l=>{const s=String((l==null?void 0:l.sku)||"").trim();s&&t.forEach(o=>{const f=x(e,s,o),d=H("revenue",f,l);Number.isFinite(d)&&a.set(o,(a.get(o)||0)+d)})}),a}function Y(e){let t=document.getElementById("forecast-toast");t||(t=document.createElement("div"),t.id="forecast-toast",t.className="po-toast",document.body.appendChild(t)),t.textContent=e,t.hidden=!1,setTimeout(()=>{t.hidden=!0},2200)}function ee(e){return typeof CSS<"u"&&typeof CSS.escape=="function"?CSS.escape(e):String(e).replace(/["\\]/g,"\\$&")}function Ie(e,t,a){const i=document.createElement("table");i.className="table-compact ui-table-standard forecast-tree-table forecast-month-totals-table",i.dataset.uiTable="true",i.dataset.stickyCols="1",i.dataset.stickyOwner="manual";const l=document.createElement("tbody"),s=document.createElement("tr");return s.className="forecast-month-totals-row row-summary",s.innerHTML=`
    <td class="tree-cell tree-summary tree-level-0 forecast-month-totals-label">
      <span class="tree-spacer" aria-hidden="true"></span>
      <span class="tree-label">Monatssumme (${we(a)})</span>
    </td>
    ${e.map((o,f)=>`<td class="forecast-cell forecast-total num ${R(f)}" data-month="${o}">${A(a,t[f])}</td>`).join("")}
    <td class="forecast-cell forecast-total num forecast-month-totals-placeholder" aria-hidden="true"></td>
    <td class="forecast-cell forecast-total num forecast-month-totals-placeholder" aria-hidden="true"></td>
    <td class="forecast-cell forecast-total num forecast-month-totals-placeholder" aria-hidden="true"></td>
  `,l.appendChild(s),i.appendChild(l),i}function Te(e,t,a,i,l,s){const o=Ae(),f=Number(o.split("-")[0]),d=document.createElement("table");d.className="table-compact ui-table-standard forecast-tree-table",d.dataset.uiTable="true",d.dataset.stickyCols="1",d.dataset.stickyOwner="manual";const N=`
    <th class="forecast-total">Summe (Auswahl)</th>
    <th class="forecast-total">Summe (Jahr)</th>
    <th class="forecast-total">Summe (Gesamt)</th>
  `,p=document.createElement("thead"),k=document.createElement("tr");k.innerHTML=`
    <th class="tree-header">Kategorie / Produkt</th>
    ${a.map((h,g)=>`<th class="${R(g)}">${h}</th>`).join("")}
    ${N.replaceAll("forecast-total","forecast-total num")}
  `,p.appendChild(k),d.appendChild(p);const y=document.createElement("tbody"),c=l.flatMap(h=>h.items),b=G(t,c,a,s),L=G(t,c,i,s),r=document.createElement("tr");r.className="forecast-category-row forecast-overall-row row-summary",r.innerHTML=`
    <td class="tree-cell tree-summary tree-level-0">
      <span class="tree-spacer" aria-hidden="true"></span>
      <span class="tree-label">Gesamt</span>
    </td>
    ${a.map((h,g)=>`<td class="forecast-cell forecast-total num ${R(g)}">${A(s,b[g])}</td>`).join("")}
    ${(()=>{const h=F(b.filter(Number.isFinite)),g=F(L.filter(Number.isFinite)),S=i.map(($,j)=>({month:$,value:L[j]})).filter($=>Number.isFinite($.value)&&Number($.month.split("-")[0])===f&&$.month>=o).map($=>$.value),I=F(S);return`
        <td class="forecast-cell forecast-total num">${A(s,h)}</td>
        <td class="forecast-cell forecast-total num">${A(s,I)}</td>
        <td class="forecast-cell forecast-total num">${A(s,g)}</td>
      `})()}
  `,y.appendChild(r),l.forEach(h=>{const g=!!u.collapsed[h.id],S=a.map(w=>{const E=h.items.map(P=>{const q=String(P.sku||"").trim(),U=x(t,q,w);return H(s,U,P)});return F(E)}),I=i.map(w=>{const E=h.items.map(P=>{const q=String(P.sku||"").trim(),U=x(t,q,w);return H(s,U,P)});return F(E)}),$=document.createElement("tr");$.className="forecast-category-row row-section";const j=F(S.filter(Number.isFinite)),T=F(I.filter(Number.isFinite)),re=i.map((w,E)=>({month:w,value:I[E]})).filter(w=>Number.isFinite(w.value)&&Number(w.month.split("-")[0])===f&&w.month>=o).map(w=>w.value),oe=F(re);$.innerHTML=`
      <td class="tree-cell tree-level-0">
        <button type="button" class="tree-toggle" data-category="${h.id}">
          ${g?"▶":"▼"}
        </button>
        <span class="tree-label">${h.name}</span>
        <span class="forecast-count muted">${h.items.length}</span>
      </td>
      ${a.map((w,E)=>`<td class="forecast-cell forecast-total num ${R(E)}">${A(s,S[E])}</td>`).join("")}
      <td class="forecast-cell forecast-total num">${A(s,j)}</td>
      <td class="forecast-cell forecast-total num">${A(s,oe)}</td>
      <td class="forecast-cell forecast-total num">${A(s,T)}</td>
    `,y.appendChild($),g||h.items.forEach(w=>{const E=String(w.sku||"").trim(),P=w.alias||E,q=document.createElement("tr");q.className="forecast-product-row row-detail",q.setAttribute("data-sku",E);const U=a.map(M=>{const z=x(t,E,M);return H(s,z,w)}),Q=i.map(M=>{const z=x(t,E,M);return H(s,z,w)}),ce=F(U.filter(Number.isFinite)),le=F(Q.filter(Number.isFinite)),ie=i.map((M,z)=>({month:M,value:Q[z]})).filter(M=>Number.isFinite(M.value)&&Number(M.month.split("-")[0])===f&&M.month>=o).map(M=>M.value),ue=F(ie);q.innerHTML=`
          <td class="tree-cell tree-level-1 forecast-product-cell">
            <span class="tree-spacer" aria-hidden="true"></span>
            <span class="coverage-sku-block">
              <span class="tree-label">${P}</span>
              <span class="forecast-sku muted">${E}</span>
            </span>
          </td>
          ${a.map((M,z)=>{const K=se(t,E,M),de=ne(t,E,M),fe=x(t,E,M),J=U[z],me=A(s,J),pe=K!=null?"forecast-manual":"",ge=K!=null?"Manuell":de?"Import":"",be=J==null&&fe!=null&&s!=="units"?"Produktdaten fehlen":ge;return`
              <td class="forecast-cell num ${pe} ${R(z)}" data-sku="${E}" data-month="${M}" title="${be}">
                <span class="forecast-value">${me}</span>
                ${K!=null?'<span class="forecast-manual-dot" aria-hidden="true"></span>':""}
              </td>
            `}).join("")}
          <td class="forecast-cell forecast-total num">${A(s,ce)}</td>
          <td class="forecast-cell forecast-total num">${A(s,ue)}</td>
          <td class="forecast-cell forecast-total num">${A(s,le)}</td>
        `,y.appendChild(q)})}),d.appendChild(y);let m=null;function n({commit:h}){if(!m)return;const g=m.closest("td"),S=g&&g.dataset?g.dataset.sku:null,I=g&&g.dataset?g.dataset.month:null,$=m.value;if(m.removeEventListener("keydown",v),m.removeEventListener("blur",V),m=null,h&&S&&I){const j=W($),T=O();B(T),T.forecast.forecastManual[S]||(T.forecast.forecastManual[S]={}),$.trim()===""||j==null?T.forecast.forecastManual[S]&&(delete T.forecast.forecastManual[S][I],Object.keys(T.forecast.forecastManual[S]).length||delete T.forecast.forecastManual[S]):T.forecast.forecastManual[S][I]=j,_(T),C(e);return}C(e)}function v(h){h.key==="Enter"?(h.preventDefault(),n({commit:!0})):h.key==="Escape"&&(h.preventDefault(),n({commit:!1}))}function V(){n({commit:!0})}return y.addEventListener("click",h=>{if(u.view!=="units")return;const g=h.target.closest("td[data-sku]");if(!g||m)return;const S=g.dataset.sku,I=g.dataset.month;if(!S||!I)return;const $=x(t,S,I);g.innerHTML=`<input class="forecast-input" type="text" inputmode="decimal" value="${$??""}" />`,m=g.querySelector("input"),m.addEventListener("keydown",v),m.addEventListener("blur",V),m.focus(),m.select()}),y.addEventListener("click",h=>{const g=h.target.closest("[data-category]");if(!g)return;const S=g.getAttribute("data-category");S&&(u.collapsed[S]=!u.collapsed[S],D(),C(e))}),d}function B(e){(!e.forecast||typeof e.forecast!="object")&&(e.forecast={items:[],settings:{useForecast:!1},forecastImport:{},forecastManual:{},lastImportAt:null,importSource:null}),Array.isArray(e.forecast.items)||(e.forecast.items=[]),(!e.forecast.settings||typeof e.forecast.settings!="object")&&(e.forecast.settings={useForecast:!1}),(!e.forecast.forecastImport||typeof e.forecast.forecastImport!="object")&&(e.forecast.forecastImport={}),(!e.forecast.forecastManual||typeof e.forecast.forecastManual!="object")&&(e.forecast.forecastManual={}),e.forecast.lastImportAt===void 0&&(e.forecast.lastImportAt=null),e.forecast.importSource===void 0&&(e.forecast.importSource=null)}function C(e){const t=O();B(t),e.innerHTML="";const a=Array.isArray(t.products)?t.products:[],i=Array.isArray(t.productCategories)?t.productCategories:[],l=window.__routeQuery||{},s=String(l.sku||"").trim(),o=String(l.month||"").trim();if(s){u.search="",u.onlyActive=!1,u.onlyWithForecast=!1;const r=a.find(m=>String((m==null?void 0:m.sku)||"").trim()===s);(r==null?void 0:r.categoryId)!=null&&(u.collapsed[String(r.categoryId)]=!1)}const f=Le(t.settings&&t.settings.startMonth||"2025-01",Number(t.settings&&t.settings.horizonMonths||18)),d=Ce(f);o&&!X(f,u.range).includes(o)&&(u.range="all"),d.some(r=>r.value===u.range)||(u.range=d[0]?d[0].value:"all");const N=X(f,u.range),p=u.search.trim().toLowerCase(),k=a.filter(r=>{if(u.onlyActive&&!Ne(r))return!1;if(p){const m=i.find(v=>String(v.id)===String(r.categoryId));if(![r.alias,r.sku,...r.tags||[],m?m.name:null].filter(Boolean).map(v=>String(v).toLowerCase()).some(v=>v.includes(p)))return!1}if(u.onlyWithForecast){const m=String(r.sku||"").trim();if(!N.some(v=>{const V=x(t,m,v);return Number.isFinite(Number(V))&&Number(V)>0}))return!1}return!0}),y=Me(k,i),c=document.createElement("section");c.className="card ui-page-shell forecast-page",c.innerHTML=`
    <header class="panel__header ui-page-head">
      <div>
        <p class="eyebrow">Werkzeuge</p>
        <h1>Absatzprognose (Ventory)</h1>
        <p class="text-muted">VentoryOne-Import, Vorschau und Übergabe an Umsätze/Payout.</p>
      </div>
      <div class="forecast-actions">
        <button class="btn secondary" type="button" data-ventory-csv>${te}</button>
        <button class="btn" type="button" data-forecast-save>Änderungen speichern</button>
      </div>
    </header>
    <div class="forecast-toolbar">
      <div class="forecast-toolbar-row">
        <label class="field">
          <span>Suche</span>
          <input type="search" data-forecast-search value="${u.search}" placeholder="SKU, Alias, Tag, Kategorie" />
        </label>
        <label class="field">
          <span>Monatsbereich</span>
          <select data-forecast-range>
            ${d.map(r=>`<option value="${r.value}" ${r.value===u.range?"selected":""}>${r.label}</option>`).join("")}
          </select>
        </label>
        <div class="forecast-view-toggle" role="group" aria-label="Forecast-Ansicht">
          <button class="btn ${u.view==="units"?"secondary":"ghost"}" type="button" data-forecast-view="units">Absatz</button>
          <button class="btn ${u.view==="revenue"?"secondary":"ghost"}" type="button" data-forecast-view="revenue">Umsatz</button>
          <button class="btn ${u.view==="profit"?"secondary":"ghost"}" type="button" data-forecast-view="profit">Gewinn</button>
        </div>
        <label class="toggle">
          <input type="checkbox" ${u.onlyActive?"checked":""} data-only-active />
          <span>Nur aktive Produkte</span>
        </label>
        <label class="toggle">
          <input type="checkbox" ${u.onlyWithForecast?"checked":""} data-only-forecast />
          <span>Nur Produkte mit Forecast</span>
        </label>
      </div>
      <div class="forecast-toolbar-row">
        <button class="btn secondary" type="button" data-expand="expand">Alles auf</button>
        <button class="btn secondary" type="button" data-expand="collapse">Alles zu</button>
        <button class="btn" type="button" data-forecast-transfer>Umsatz übertragen</button>
        <label class="toggle">
          <input type="checkbox" ${t.forecast.settings.useForecast?"checked":""} data-forecast-toggle />
          <span>Umsatz aus Prognose übernehmen</span>
        </label>
      </div>
    </div>
  `;const b=document.createElement("div");if(b.className="forecast-table-wrap ui-table-shell ui-scroll-host",y.length){const r=G(t,k,N,u.view),m=Ie(N,r,u.view);b.appendChild(m);const n=Te(e,t,N,f,y,u.view);b.appendChild(n),b.scrollLeft=u.scrollLeft||0,b.addEventListener("scroll",()=>{u.scrollLeft=b.scrollLeft},{passive:!0})}else{const r=document.createElement("div");r.className="muted",r.style.padding="12px",r.textContent="Keine Produkte gefunden.",b.appendChild(r)}c.appendChild(b),e.appendChild(c),c.querySelector("[data-forecast-toggle]").addEventListener("change",r=>{const m=O();B(m),m.forecast.settings.useForecast=r.target.checked,_(m)}),c.querySelector("[data-ventory-csv]").addEventListener("click",()=>{Ve(e)}),c.querySelector("[data-forecast-transfer]").addEventListener("click",()=>{xe(e,f,N)}),c.querySelector("[data-forecast-save]").addEventListener("click",()=>{const r=O();_(r),Y("Änderungen gespeichert.")}),c.querySelector("[data-forecast-search]").addEventListener("input",r=>{u.search=r.target.value,D(),C(e)}),c.querySelector("[data-forecast-range]").addEventListener("change",r=>{u.range=r.target.value,D(),C(e)}),c.querySelectorAll("[data-forecast-view]").forEach(r=>{r.addEventListener("click",()=>{const m=r.getAttribute("data-forecast-view");!m||m===u.view||(u.view=m,D(),C(e))})}),c.querySelector("[data-only-active]").addEventListener("change",r=>{u.onlyActive=r.target.checked,D(),C(e)}),c.querySelector("[data-only-forecast]").addEventListener("change",r=>{u.onlyWithForecast=r.target.checked,D(),C(e)}),c.querySelectorAll("[data-expand]").forEach(r=>{r.addEventListener("click",()=>{if(r.getAttribute("data-expand")==="collapse"){const n={};y.forEach(v=>{n[v.id]=!0}),u.collapsed=n}else u.collapsed={};D(),C(e)})});function L(){if(!s)return;const r=ee(s),m=o?`[data-month="${ee(o)}"]`:"",n=e.querySelector(`td[data-sku="${r}"]${m}`),v=n?n.closest("tr"):e.querySelector(`tr[data-sku="${r}"]`);v&&v.classList.add("row-focus"),n?(n.classList.add("cell-focus"),n.scrollIntoView({behavior:"smooth",block:"center",inline:"center"})):v&&v.scrollIntoView({behavior:"smooth",block:"center"}),window.__routeQuery={}}L()}function xe(e,t,a){const i=O();B(i);const l=Fe(i,t),s=t.map(c=>({month:c,revenue:Number(l.get(c)||0)})),o=new Set((a||[]).filter(c=>(l.get(c)||0)>0)),f=document.createElement("div");f.className="po-modal-backdrop",f.setAttribute("role","dialog"),f.setAttribute("aria-modal","true");const d=document.createElement("div");d.className="po-modal",d.innerHTML=`
    <header class="po-modal-header">
      <h3>Umsatz übertragen</h3>
      <button class="btn ghost" type="button" data-close aria-label="Schließen">✕</button>
    </header>
    <div class="po-modal-body">
      <p class="muted">Wähle die Monate aus, deren Prognose-Umsatz in den Tab <strong>Eingaben</strong> übertragen werden soll.</p>
      <div class="forecast-transfer-actions">
        <button class="btn secondary" type="button" data-select-all>Alle mit Umsatz</button>
        <button class="btn secondary" type="button" data-clear>Auswahl leeren</button>
      </div>
      <div class="forecast-transfer-list">
        ${s.map(c=>{const b=!Number.isFinite(c.revenue)||c.revenue<=0,L=o.has(c.month);return`
            <label class="forecast-transfer-row ${b?"is-disabled":""}">
              <input type="checkbox" data-month="${c.month}" ${L?"checked":""} ${b?"disabled":""} />
              <span>${c.month}</span>
              <span class="muted">${Z(c.revenue)} €</span>
            </label>
          `}).join("")}
      </div>
    </div>
    <footer class="po-modal-actions">
      <button class="btn" type="button" data-cancel>Abbrechen</button>
      <button class="btn primary" type="button" data-transfer disabled>Übertragen</button>
    </footer>
  `,f.appendChild(d),document.body.appendChild(f);const N=()=>f.remove();f.addEventListener("click",c=>{c.target===f&&N()}),d.querySelector("[data-close]").addEventListener("click",N),d.querySelector("[data-cancel]").addEventListener("click",N);const p=d.querySelector("[data-transfer]"),k=Array.from(d.querySelectorAll("input[data-month]"));function y(){const c=k.some(b=>b.checked);p.disabled=!c}d.querySelector("[data-select-all]").addEventListener("click",()=>{k.forEach(c=>{c.disabled||(c.checked=!0)}),y()}),d.querySelector("[data-clear]").addEventListener("click",()=>{k.forEach(c=>{c.checked=!1}),y()}),k.forEach(c=>{c.addEventListener("change",y)}),y(),p.addEventListener("click",()=>{const c=k.filter(n=>n.checked).map(n=>n.getAttribute("data-month")).filter(Boolean);if(!c.length)return;const b=O();B(b),Array.isArray(b.incomings)||(b.incomings=[]);const L=b.incomings.slice().reverse().find(n=>(n==null?void 0:n.payoutPct)!=null&&String(n.payoutPct).trim()!==""),r=(L==null?void 0:L.payoutPct)??"0",m=[];c.forEach(n=>{const v=Number(l.get(n)||0),V=Z(v),h=b.incomings.findIndex(g=>(g==null?void 0:g.month)===n);if(h>=0){const g=b.incomings[h];g.revenueEur=V,g.payoutPct||(g.payoutPct=r),g.source="forecast"}else b.incomings.push({month:n,revenueEur:V,payoutPct:r,source:"forecast"});m.push(n)}),b.incomings.sort((n,v)=>String(n.month||"").localeCompare(String(v.month||""))),_(b),Y(`Umsatz übertragen: ${m.length} Monat${m.length===1?"":"e"}.`),N(),C(e)})}function Ve(e){const t=document.createElement("div");t.className="po-modal-backdrop",t.setAttribute("role","dialog"),t.setAttribute("aria-modal","true");const a=document.createElement("div");a.className="po-modal",a.innerHTML=`
    <header class="po-modal-header">
      <h3>${te}</h3>
      <button class="btn ghost" type="button" data-close aria-label="Schließen">✕</button>
    </header>
    <div class="po-modal-body">
      <div class="form-grid">
        <label class="field">
          <span>Datei (.csv)</span>
          <input type="file" accept=".csv" data-file />
        </label>
        <label class="toggle">
          <input type="checkbox" data-overwrite checked />
          <span>Overwrite existing forecast values</span>
        </label>
      </div>
      <div class="panel preview-panel" data-summary hidden></div>
    </div>
    <footer class="po-modal-actions">
      <button class="btn" type="button" data-cancel>Abbrechen</button>
      <button class="btn primary" type="button" data-import disabled>Importieren</button>
    </footer>
  `,t.appendChild(a),document.body.appendChild(t);const i=()=>t.remove();t.addEventListener("click",p=>{p.target===t&&i()}),a.querySelector("[data-close]").addEventListener("click",i),a.querySelector("[data-cancel]").addEventListener("click",i);const l=a.querySelector("[data-file]"),s=a.querySelector("[data-overwrite]"),o=a.querySelector("[data-import]"),f=a.querySelector("[data-summary]");let d=null;function N(p){f.hidden=!1,f.innerHTML=`
      <h4>Import Summary</h4>
      <p>SKUs: <strong>${p.skuCount}</strong></p>
      <p>Monate: <strong>${p.monthCount}</strong></p>
      <p>Datensätze: <strong>${p.recordCount}</strong></p>
      <p>Ignorierte Zeilen (Gesamt): <strong>${p.ignoredTotal}</strong></p>
      ${p.unknownSkus.length?`<p class="text-muted">Unbekannte SKUs:</p><ul>${p.unknownSkus.map(k=>`<li>${k}</li>`).join("")}</ul>`:""}
      ${p.warnings.length?`<p class="text-muted">Hinweise:</p><ul>${p.warnings.map(k=>`<li>${k}</li>`).join("")}</ul>`:""}
    `}l.addEventListener("change",async p=>{const k=p.target.files&&p.target.files[0];if(k){d=null,o.disabled=!0,f.hidden=!0;try{const y=await k.text(),c=ke(y);if(c.error){alert(c.error);return}d=c,o.disabled=!c.records.length}catch(y){console.error(y),alert("Datei konnte nicht gelesen werden. Bitte erneut versuchen.")}}}),o.addEventListener("click",()=>{if(!d||!d.records||!d.records.length)return;const p=O();B(p);const k=Array.isArray(p.products)?p.products:[],y=new Set(k.map(n=>String(n.sku||"").trim())),c=new Date().toISOString(),b=s.checked,L=new Set,r=[];d.records.forEach(n=>{if(!y.has(n.sku)){L.add(n.sku);return}r.push(n)}),b?r.forEach(n=>{p.forecast.forecastImport[n.sku]||(p.forecast.forecastImport[n.sku]={}),p.forecast.forecastImport[n.sku][n.month]={units:n.units,revenueEur:n.revenueEur,profitEur:n.profitEur}}):r.forEach(n=>{p.forecast.forecastImport[n.sku]||(p.forecast.forecastImport[n.sku]={}),p.forecast.forecastImport[n.sku][n.month]||(p.forecast.forecastImport[n.sku][n.month]={units:n.units,revenueEur:n.revenueEur,profitEur:n.profitEur})}),p.forecast.lastImportAt=c,p.forecast.importSource="ventoryone",_(p);const m={skuCount:new Set(d.records.map(n=>n.sku)).size,monthCount:new Set(d.records.map(n=>n.month)).size,recordCount:d.records.length,ignoredTotal:d.ignoredTotal||0,unknownSkus:Array.from(L),warnings:d.warnings||[]};N(m),Y(`Import erfolgreich: ${r.length} Datensätze.`),C(e)})}function Oe(e){C(e);const t=he(()=>C(e));return{cleanup(){t()}}}export{Oe as default};
