import{a as ge,l as j,o as R,g as be,q as he,t as ve}from"./index-Q77JbDRq.js";const X="VentoryOne Forecast importieren (CSV)",ee="forecast_view_v1",ye={search:"",range:"next12",onlyActive:!0,onlyWithForecast:!1,view:"units",collapsed:{}},u=(()=>{const e=be(ee,{});return{...ye,...e,collapsed:e&&e.collapsed||{}}})();u.scrollLeft=Number(u.scrollLeft||0);function D(){ve(ee,{search:u.search,range:u.range,onlyActive:u.onlyActive,onlyWithForecast:u.onlyWithForecast,view:u.view,collapsed:u.collapsed})}function K(e){if(e==null)return null;if(typeof e=="number")return Number.isFinite(e)?e:null;const t=String(e).trim().replace(/\s+/g,"").replace(/[^0-9,.-]/g,"");if(!t)return null;const a=t.lastIndexOf(","),m=t.lastIndexOf("."),l=Math.max(a,m);let i=t;if(l>=0){const f=t.slice(0,l).replace(/[.,]/g,""),d=t.slice(l+1).replace(/[.,]/g,"");i=`${f}.${d}`}else i=t.replace(/[.,]/g,"");const c=Number(i);return Number.isFinite(c)?c:null}function Q(e){return e==null||!Number.isFinite(Number(e))?"0,00":Number(e).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function ke(e){return e==null||!Number.isFinite(Number(e))?"—":Math.round(Number(e)).toLocaleString("de-DE",{maximumFractionDigits:0})}function Se(e){return e==null||!Number.isFinite(Number(e))?"—":`${Math.round(Number(e)).toLocaleString("de-DE",{maximumFractionDigits:0})} €`}function Ee(e){if(!e)return!1;if(typeof e.active=="boolean")return e.active;const t=String(e.status||"").trim().toLowerCase();return t?t==="active"||t==="aktiv":!0}function $e(e,t=[]){const a=new Map;e.forEach(c=>{const f=c.categoryId?String(c.categoryId):"";a.has(f)||a.set(f,[]),a.get(f).push(c)});const l=t.slice().sort((c,f)=>{const d=Number.isFinite(c.sortOrder)?c.sortOrder:0,w=Number.isFinite(f.sortOrder)?f.sortOrder:0;return d-w||String(c.name||"").localeCompare(String(f.name||""))}).map(c=>({id:String(c.id),name:c.name||"Ohne Kategorie",items:a.get(String(c.id))||[]})),i=a.get("")||[];return i.length&&l.push({id:"uncategorized",name:"Ohne Kategorie",items:i}),l.filter(c=>c.items.length)}function we(e,t){const a=[],[m,l]=String(e).split("-").map(Number);for(let i=0;i<t;i+=1){const c=m+Math.floor((l-1+i)/12),f=(l-1+i)%12+1;a.push(`${c}-${String(f).padStart(2,"0")}`)}return a}function J(e,t){if(t==="all")return e;const a=Number(String(t).replace("next",""))||e.length;return e.slice(0,a)}function Ne(){const e=new Date;return`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}`}function Me(e){const t=[];return[12,18,24].forEach(a=>{e.length>=a&&t.push({value:`next${a}`,label:`Nächste ${a}`})}),t.push({value:"all",label:"Alle"}),t}function te(e,t,a){const m=e&&e.forecast,l=m&&m.forecastImport;if(!l)return null;const i=l[t];return i&&i[a]||null}function ne(e,t,a){const m=e&&e.forecast,l=m&&m.forecastManual;if(!l)return null;const i=l[t];if(!i||typeof i!="object")return null;const c=i[a];return typeof c>"u"?null:c}function T(e,t,a){const m=ne(e,t,a);if(m!=null)return m;const l=te(e,t,a);return!l||typeof l!="object"||typeof l.units>"u"?null:l.units}function O(e,t,a){if(t==null||!Number.isFinite(Number(t)))return null;const m=Number(t);if(e==="units")return m;const l=K(a&&a.avgSellingPriceGrossEUR);if(!Number.isFinite(l))return null;const i=m*l;if(e==="revenue")return i;const c=K(a&&a.sellerboardMarginPct);return Number.isFinite(c)?i*(c/100):null}function Ae(e,t){const a=new Map,m=Array.isArray(e==null?void 0:e.products)?e.products:[];return t.forEach(l=>a.set(l,0)),m.forEach(l=>{const i=String((l==null?void 0:l.sku)||"").trim();i&&t.forEach(c=>{const f=T(e,i,c),d=O("revenue",f,l);Number.isFinite(d)&&a.set(c,(a.get(c)||0)+d)})}),a}function W(e){let t=document.getElementById("forecast-toast");t||(t=document.createElement("div"),t.id="forecast-toast",t.className="po-toast",document.body.appendChild(t)),t.textContent=e,t.hidden=!1,setTimeout(()=>{t.hidden=!0},2200)}function Z(e){return typeof CSS<"u"&&typeof CSS.escape=="function"?CSS.escape(e):String(e).replace(/["\\]/g,"\\$&")}function Le(e,t,a,m,l,i){const c=Ne(),f=Number(c.split("-")[0]),d=document.createElement("table");d.className="table-compact dashboard-tree-table forecast-tree-table",d.dataset.uiTable="true",d.dataset.stickyCols="1";const w=p=>`month-col ${p%2===1?"month-col-alt":""}`.trim(),o=p=>{const g=p.filter(y=>Number.isFinite(y));return g.length?g.reduce((y,E)=>y+E,0):null},h=p=>i==="units"?ke(p):Se(p),A=`
    <th class="forecast-total">Summe (Auswahl)</th>
    <th class="forecast-total">Summe (Jahr)</th>
    <th class="forecast-total">Summe (Gesamt)</th>
  `,r=document.createElement("thead"),k=document.createElement("tr");k.innerHTML=`
    <th class="tree-header">Kategorie / Produkt</th>
    ${a.map((p,g)=>`<th class="${w(g)}">${p}</th>`).join("")}
    ${A.replaceAll("forecast-total","forecast-total num")}
  `,r.appendChild(k),d.appendChild(r);const N=document.createElement("tbody"),s=a.map(p=>{const g=l.flatMap(y=>y.items.map(E=>{const S=String(E.sku||"").trim(),x=T(t,S,p);return O(i,x,E)}));return o(g)}),v=m.map(p=>{const g=l.flatMap(y=>y.items.map(E=>{const S=String(E.sku||"").trim(),x=T(t,S,p);return O(i,x,E)}));return o(g)}),n=document.createElement("tr");n.className="forecast-category-row forecast-overall-row row-summary",n.innerHTML=`
    <td class="tree-cell tree-summary tree-level-0">
      <span class="tree-spacer" aria-hidden="true"></span>
      <span class="tree-label">Gesamt</span>
    </td>
    ${a.map((p,g)=>`<td class="forecast-cell forecast-total num ${w(g)}">${h(s[g])}</td>`).join("")}
    ${(()=>{const p=o(s.filter(Number.isFinite)),g=o(v.filter(Number.isFinite)),y=m.map((S,x)=>({month:S,value:v[x]})).filter(S=>Number.isFinite(S.value)&&Number(S.month.split("-")[0])===f&&S.month>=c).map(S=>S.value),E=o(y);return`
        <td class="forecast-cell forecast-total num">${h(p)}</td>
        <td class="forecast-cell forecast-total num">${h(E)}</td>
        <td class="forecast-cell forecast-total num">${h(g)}</td>
      `})()}
  `,N.appendChild(n),l.forEach(p=>{const g=!!u.collapsed[p.id],y=a.map(M=>{const $=p.items.map(z=>{const V=String(z.sku||"").trim(),U=T(t,V,M);return O(i,U,z)});return o($)}),E=m.map(M=>{const $=p.items.map(z=>{const V=String(z.sku||"").trim(),U=T(t,V,M);return O(i,U,z)});return o($)}),S=document.createElement("tr");S.className="forecast-category-row row-section";const x=o(y.filter(Number.isFinite)),I=o(E.filter(Number.isFinite)),ae=m.map((M,$)=>({month:M,value:E[$]})).filter(M=>Number.isFinite(M.value)&&Number(M.month.split("-")[0])===f&&M.month>=c).map(M=>M.value),se=o(ae);S.innerHTML=`
      <td class="tree-cell tree-level-0">
        <button type="button" class="tree-toggle" data-category="${p.id}">
          ${g?"▶":"▼"}
        </button>
        <span class="tree-label">${p.name}</span>
        <span class="forecast-count muted">${p.items.length}</span>
      </td>
      ${a.map((M,$)=>`<td class="forecast-cell forecast-total num ${w($)}">${h(y[$])}</td>`).join("")}
      <td class="forecast-cell forecast-total num">${h(x)}</td>
      <td class="forecast-cell forecast-total num">${h(se)}</td>
      <td class="forecast-cell forecast-total num">${h(I)}</td>
    `,N.appendChild(S),g||p.items.forEach(M=>{const $=String(M.sku||"").trim(),z=M.alias||$,V=document.createElement("tr");V.className="forecast-product-row row-detail",V.setAttribute("data-sku",$);const U=a.map(L=>{const P=T(t,$,L);return O(i,P,M)}),Y=m.map(L=>{const P=T(t,$,L);return O(i,P,M)}),re=o(U.filter(Number.isFinite)),oe=o(Y.filter(Number.isFinite)),ce=m.map((L,P)=>({month:L,value:Y[P]})).filter(L=>Number.isFinite(L.value)&&Number(L.month.split("-")[0])===f&&L.month>=c).map(L=>L.value),le=o(ce);V.innerHTML=`
          <td class="tree-cell tree-level-1 forecast-product-cell">
            <span class="tree-spacer" aria-hidden="true"></span>
            <span class="coverage-sku-block">
              <span class="tree-label">${z}</span>
              <span class="forecast-sku muted">${$}</span>
            </span>
          </td>
          ${a.map((L,P)=>{const _=ne(t,$,L),ie=te(t,$,L),ue=T(t,$,L),G=U[P],de=h(G),fe=_!=null?"forecast-manual":"",me=_!=null?"Manuell":ie?"Import":"",pe=G==null&&ue!=null&&i!=="units"?"Produktdaten fehlen":me;return`
              <td class="forecast-cell num ${fe} ${w(P)}" data-sku="${$}" data-month="${L}" title="${pe}">
                <span class="forecast-value">${de}</span>
                ${_!=null?'<span class="forecast-manual-dot" aria-hidden="true"></span>':""}
              </td>
            `}).join("")}
          <td class="forecast-cell forecast-total num">${h(re)}</td>
          <td class="forecast-cell forecast-total num">${h(le)}</td>
          <td class="forecast-cell forecast-total num">${h(oe)}</td>
        `,N.appendChild(V)})}),d.appendChild(N);let b=null;function q({commit:p}){if(!b)return;const g=b.closest("td"),y=g&&g.dataset?g.dataset.sku:null,E=g&&g.dataset?g.dataset.month:null,S=b.value;if(b.removeEventListener("keydown",H),b.removeEventListener("blur",F),b=null,p&&y&&E){const x=K(S),I=j();B(I),I.forecast.forecastManual[y]||(I.forecast.forecastManual[y]={}),S.trim()===""||x==null?I.forecast.forecastManual[y]&&(delete I.forecast.forecastManual[y][E],Object.keys(I.forecast.forecastManual[y]).length||delete I.forecast.forecastManual[y]):I.forecast.forecastManual[y][E]=x,R(I),C(e);return}C(e)}function H(p){p.key==="Enter"?(p.preventDefault(),q({commit:!0})):p.key==="Escape"&&(p.preventDefault(),q({commit:!1}))}function F(){q({commit:!0})}return N.addEventListener("click",p=>{if(u.view!=="units")return;const g=p.target.closest("td[data-sku]");if(!g||b)return;const y=g.dataset.sku,E=g.dataset.month;if(!y||!E)return;const S=T(t,y,E);g.innerHTML=`<input class="forecast-input" type="text" inputmode="decimal" value="${S??""}" />`,b=g.querySelector("input"),b.addEventListener("keydown",H),b.addEventListener("blur",F),b.focus(),b.select()}),N.addEventListener("click",p=>{const g=p.target.closest("[data-category]");if(!g)return;const y=g.getAttribute("data-category");y&&(u.collapsed[y]=!u.collapsed[y],D(),C(e))}),d}function B(e){(!e.forecast||typeof e.forecast!="object")&&(e.forecast={items:[],settings:{useForecast:!1},forecastImport:{},forecastManual:{},lastImportAt:null,importSource:null}),Array.isArray(e.forecast.items)||(e.forecast.items=[]),(!e.forecast.settings||typeof e.forecast.settings!="object")&&(e.forecast.settings={useForecast:!1}),(!e.forecast.forecastImport||typeof e.forecast.forecastImport!="object")&&(e.forecast.forecastImport={}),(!e.forecast.forecastManual||typeof e.forecast.forecastManual!="object")&&(e.forecast.forecastManual={}),e.forecast.lastImportAt===void 0&&(e.forecast.lastImportAt=null),e.forecast.importSource===void 0&&(e.forecast.importSource=null)}function C(e){const t=j();B(t),e.innerHTML="";const a=Array.isArray(t.products)?t.products:[],m=Array.isArray(t.productCategories)?t.productCategories:[],l=window.__routeQuery||{},i=String(l.sku||"").trim(),c=String(l.month||"").trim();if(i){u.search="",u.onlyActive=!1,u.onlyWithForecast=!1;const s=a.find(v=>String((v==null?void 0:v.sku)||"").trim()===i);(s==null?void 0:s.categoryId)!=null&&(u.collapsed[String(s.categoryId)]=!1)}const f=we(t.settings&&t.settings.startMonth||"2025-01",Number(t.settings&&t.settings.horizonMonths||18)),d=Me(f);c&&!J(f,u.range).includes(c)&&(u.range="all"),d.some(s=>s.value===u.range)||(u.range=d[0]?d[0].value:"all");const w=J(f,u.range),o=u.search.trim().toLowerCase(),h=a.filter(s=>{if(u.onlyActive&&!Ee(s))return!1;if(o){const v=m.find(b=>String(b.id)===String(s.categoryId));if(![s.alias,s.sku,...s.tags||[],v?v.name:null].filter(Boolean).map(b=>String(b).toLowerCase()).some(b=>b.includes(o)))return!1}if(u.onlyWithForecast){const v=String(s.sku||"").trim();if(!w.some(b=>{const q=T(t,v,b);return Number.isFinite(Number(q))&&Number(q)>0}))return!1}return!0}),A=$e(h,m),r=document.createElement("section");r.className="panel",r.innerHTML=`
    <header class="panel__header">
      <div>
        <p class="eyebrow">Werkzeuge</p>
        <h1>Absatzprognose (Ventory)</h1>
        <p class="text-muted">VentoryOne-Import, Vorschau und Übergabe an Umsätze/Payout.</p>
      </div>
      <div class="forecast-actions">
        <button class="btn secondary" type="button" data-ventory-csv>${X}</button>
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
            ${d.map(s=>`<option value="${s.value}" ${s.value===u.range?"selected":""}>${s.label}</option>`).join("")}
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
        <button class="btn secondary" type="button" data-expand="expand">Alle auf</button>
        <button class="btn secondary" type="button" data-expand="collapse">Alle zu</button>
        <button class="btn" type="button" data-forecast-transfer>Umsatz übertragen</button>
        <label class="toggle">
          <input type="checkbox" ${t.forecast.settings.useForecast?"checked":""} data-forecast-toggle />
          <span>Umsatz aus Prognose übernehmen</span>
        </label>
      </div>
    </div>
  `;const k=document.createElement("div");if(k.className="forecast-table-wrap dashboard-table-wrap",A.length){const s=Le(e,t,w,f,A,u.view);k.appendChild(s),k.scrollLeft=u.scrollLeft||0,k.addEventListener("scroll",()=>{u.scrollLeft=k.scrollLeft},{passive:!0})}else{const s=document.createElement("div");s.className="muted",s.style.padding="12px",s.textContent="Keine Produkte gefunden.",k.appendChild(s)}r.appendChild(k),e.appendChild(r),r.querySelector("[data-forecast-toggle]").addEventListener("change",s=>{const v=j();B(v),v.forecast.settings.useForecast=s.target.checked,R(v)}),r.querySelector("[data-ventory-csv]").addEventListener("click",()=>{Fe(e)}),r.querySelector("[data-forecast-transfer]").addEventListener("click",()=>{Ce(e,f,w)}),r.querySelector("[data-forecast-save]").addEventListener("click",()=>{const s=j();R(s),W("Änderungen gespeichert.")}),r.querySelector("[data-forecast-search]").addEventListener("input",s=>{u.search=s.target.value,D(),C(e)}),r.querySelector("[data-forecast-range]").addEventListener("change",s=>{u.range=s.target.value,D(),C(e)}),r.querySelectorAll("[data-forecast-view]").forEach(s=>{s.addEventListener("click",()=>{const v=s.getAttribute("data-forecast-view");!v||v===u.view||(u.view=v,D(),C(e))})}),r.querySelector("[data-only-active]").addEventListener("change",s=>{u.onlyActive=s.target.checked,D(),C(e)}),r.querySelector("[data-only-forecast]").addEventListener("change",s=>{u.onlyWithForecast=s.target.checked,D(),C(e)}),r.querySelectorAll("[data-expand]").forEach(s=>{s.addEventListener("click",()=>{if(s.getAttribute("data-expand")==="collapse"){const n={};A.forEach(b=>{n[b.id]=!0}),u.collapsed=n}else u.collapsed={};D(),C(e)})});function N(){if(!i)return;const s=Z(i),v=c?`[data-month="${Z(c)}"]`:"",n=e.querySelector(`td[data-sku="${s}"]${v}`),b=n?n.closest("tr"):e.querySelector(`tr[data-sku="${s}"]`);b&&b.classList.add("row-focus"),n?(n.classList.add("cell-focus"),n.scrollIntoView({behavior:"smooth",block:"center",inline:"center"})):b&&b.scrollIntoView({behavior:"smooth",block:"center"}),window.__routeQuery={}}N()}function Ce(e,t,a){const m=j();B(m);const l=Ae(m,t),i=t.map(r=>({month:r,revenue:Number(l.get(r)||0)})),c=new Set((a||[]).filter(r=>(l.get(r)||0)>0)),f=document.createElement("div");f.className="po-modal-backdrop",f.setAttribute("role","dialog"),f.setAttribute("aria-modal","true");const d=document.createElement("div");d.className="po-modal",d.innerHTML=`
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
        ${i.map(r=>{const k=!Number.isFinite(r.revenue)||r.revenue<=0,N=c.has(r.month);return`
            <label class="forecast-transfer-row ${k?"is-disabled":""}">
              <input type="checkbox" data-month="${r.month}" ${N?"checked":""} ${k?"disabled":""} />
              <span>${r.month}</span>
              <span class="muted">${Q(r.revenue)} €</span>
            </label>
          `}).join("")}
      </div>
    </div>
    <footer class="po-modal-actions">
      <button class="btn" type="button" data-cancel>Abbrechen</button>
      <button class="btn primary" type="button" data-transfer disabled>Übertragen</button>
    </footer>
  `,f.appendChild(d),document.body.appendChild(f);const w=()=>f.remove();f.addEventListener("click",r=>{r.target===f&&w()}),d.querySelector("[data-close]").addEventListener("click",w),d.querySelector("[data-cancel]").addEventListener("click",w);const o=d.querySelector("[data-transfer]"),h=Array.from(d.querySelectorAll("input[data-month]"));function A(){const r=h.some(k=>k.checked);o.disabled=!r}d.querySelector("[data-select-all]").addEventListener("click",()=>{h.forEach(r=>{r.disabled||(r.checked=!0)}),A()}),d.querySelector("[data-clear]").addEventListener("click",()=>{h.forEach(r=>{r.checked=!1}),A()}),h.forEach(r=>{r.addEventListener("change",A)}),A(),o.addEventListener("click",()=>{const r=h.filter(n=>n.checked).map(n=>n.getAttribute("data-month")).filter(Boolean);if(!r.length)return;const k=j();B(k),Array.isArray(k.incomings)||(k.incomings=[]);const N=k.incomings.slice().reverse().find(n=>(n==null?void 0:n.payoutPct)!=null&&String(n.payoutPct).trim()!==""),s=(N==null?void 0:N.payoutPct)??"0",v=[];r.forEach(n=>{const b=Number(l.get(n)||0),q=Q(b),H=k.incomings.findIndex(F=>(F==null?void 0:F.month)===n);if(H>=0){const F=k.incomings[H];F.revenueEur=q,F.payoutPct||(F.payoutPct=s),F.source="forecast"}else k.incomings.push({month:n,revenueEur:q,payoutPct:s,source:"forecast"});v.push(n)}),k.incomings.sort((n,b)=>String(n.month||"").localeCompare(String(b.month||""))),R(k),W(`Umsatz übertragen: ${v.length} Monat${v.length===1?"":"e"}.`),w(),C(e)})}function Fe(e){const t=document.createElement("div");t.className="po-modal-backdrop",t.setAttribute("role","dialog"),t.setAttribute("aria-modal","true");const a=document.createElement("div");a.className="po-modal",a.innerHTML=`
    <header class="po-modal-header">
      <h3>${X}</h3>
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
  `,t.appendChild(a),document.body.appendChild(t);const m=()=>t.remove();t.addEventListener("click",o=>{o.target===t&&m()}),a.querySelector("[data-close]").addEventListener("click",m),a.querySelector("[data-cancel]").addEventListener("click",m);const l=a.querySelector("[data-file]"),i=a.querySelector("[data-overwrite]"),c=a.querySelector("[data-import]"),f=a.querySelector("[data-summary]");let d=null;function w(o){f.hidden=!1,f.innerHTML=`
      <h4>Import Summary</h4>
      <p>SKUs: <strong>${o.skuCount}</strong></p>
      <p>Monate: <strong>${o.monthCount}</strong></p>
      <p>Datensätze: <strong>${o.recordCount}</strong></p>
      <p>Ignorierte Zeilen (Gesamt): <strong>${o.ignoredTotal}</strong></p>
      ${o.unknownSkus.length?`<p class="text-muted">Unbekannte SKUs:</p><ul>${o.unknownSkus.map(h=>`<li>${h}</li>`).join("")}</ul>`:""}
      ${o.warnings.length?`<p class="text-muted">Hinweise:</p><ul>${o.warnings.map(h=>`<li>${h}</li>`).join("")}</ul>`:""}
    `}l.addEventListener("change",async o=>{const h=o.target.files&&o.target.files[0];if(h){d=null,c.disabled=!0,f.hidden=!0;try{const A=await h.text(),r=he(A);if(r.error){alert(r.error);return}d=r,c.disabled=!r.records.length}catch(A){console.error(A),alert("Datei konnte nicht gelesen werden. Bitte erneut versuchen.")}}}),c.addEventListener("click",()=>{if(!d||!d.records||!d.records.length)return;const o=j();B(o);const h=Array.isArray(o.products)?o.products:[],A=new Set(h.map(n=>String(n.sku||"").trim())),r=new Date().toISOString(),k=i.checked,N=new Set,s=[];d.records.forEach(n=>{if(!A.has(n.sku)){N.add(n.sku);return}s.push(n)}),k?s.forEach(n=>{o.forecast.forecastImport[n.sku]||(o.forecast.forecastImport[n.sku]={}),o.forecast.forecastImport[n.sku][n.month]={units:n.units,revenueEur:n.revenueEur,profitEur:n.profitEur}}):s.forEach(n=>{o.forecast.forecastImport[n.sku]||(o.forecast.forecastImport[n.sku]={}),o.forecast.forecastImport[n.sku][n.month]||(o.forecast.forecastImport[n.sku][n.month]={units:n.units,revenueEur:n.revenueEur,profitEur:n.profitEur})}),o.forecast.lastImportAt=r,o.forecast.importSource="ventoryone",R(o);const v={skuCount:new Set(d.records.map(n=>n.sku)).size,monthCount:new Set(d.records.map(n=>n.month)).size,recordCount:d.records.length,ignoredTotal:d.ignoredTotal||0,unknownSkus:Array.from(N),warnings:d.warnings||[]};w(v),W(`Import erfolgreich: ${s.length} Datensätze.`),C(e)})}function Te(e){C(e);const t=ge(()=>C(e));return{cleanup(){t()}}}export{Te as default};
