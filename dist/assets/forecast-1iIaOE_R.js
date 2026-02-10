import{a as ve}from"./index-BzKrUq3k.js";import{l as P,c as K,g as ye,b as ke}from"./store-Dw0Hn2Rh.js";const Se={jan:"01",januar:"01",feb:"02",februar:"02",märz:"03",maerz:"03",mrz:"03",marz:"03",apr:"04",april:"04",mai:"05",jun:"06",juni:"06",jul:"07",juli:"07",aug:"08",august:"08",sep:"09",sept:"09",september:"09",okt:"10",oktober:"10",nov:"11",november:"11",dez:"12",dezember:"12"};function W(e){return String(e||"").toLowerCase().replace(/\s+/g," ").trim()}function Ee(e){if(!e)return null;const n=String(e).replace(/\s+/g," ").trim().match(/Erwartete Verkäufe\s+([A-Za-zÄÖÜäöüß\.]+)\s+(\d{4})/i);if(!n)return null;const s=n[1].replace(".","").toLowerCase(),a=n[2],r=Se[s];return r?`${a}-${r}`:null}function _(e){if(e==null)return null;if(typeof e=="number")return Number.isFinite(e)?e:null;const t=String(e).trim().replace(/\s+/g,"").replace(/[^0-9,.-]/g,"");if(!t)return null;const n=t.lastIndexOf(","),s=t.lastIndexOf("."),a=Math.max(n,s);let r=t;if(a>=0){const f=t.slice(0,a).replace(/[.,]/g,""),d=t.slice(a+1).replace(/[.,]/g,"");r=`${f}.${d}`}else r=t.replace(/[.,]/g,"");const o=Number(r);return Number.isFinite(o)?o:null}function J(e,t){let n=0,s=!1;for(let a=0;a<e.length;a+=1){const r=e[a];r==='"'?s&&e[a+1]==='"'?a+=1:s=!s:!s&&r===t&&(n+=1)}return n}function we(e){const t=e.slice(0,3);let n=0,s=0;return t.forEach(a=>{n+=J(a,";"),s+=J(a,",")}),n>=s?";":","}function $e(e,t){const n=[];let s="",a=!1;for(let r=0;r<e.length;r+=1){const o=e[r];o==='"'?a&&e[r+1]==='"'?(s+='"',r+=1):a=!a:!a&&o===t?(n.push(s),s=""):s+=o}return n.push(s),n}function Me(e){const n=String(e||"").replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`).filter(r=>r.length>0);if(!n.length)return{rows:[],delimiter:";"};const s=we(n);return{rows:n.map(r=>$e(r,s)),delimiter:s}}function Ne(e,t){const n=(t||[]).findIndex(s=>W(s)==="sku");return n>=0?n:(e||[]).findIndex(s=>W(s)==="sku")}function Ie(e,t){const n=[],s=[];return(e||[]).forEach((r,o)=>{if(!r||!String(r).includes("Erwartete Verkäufe"))return;const f=Ee(r);if(!f){n.push(`Monat konnte nicht erkannt werden: "${r}"`);return}s.push({month:f,start:o})}),s.length?{groups:s.map((r,o)=>{const f=o+1<s.length?s[o+1].start:(t||[]).length,d=t.slice(r.start,f).map(W),E=d.findIndex(v=>v==="einheiten"),i=d.findIndex(v=>v.startsWith("umsatz")),p=d.findIndex(v=>v.startsWith("gewinn"));return E<0&&n.push(`Monatsgruppe ${r.month} ohne Einheiten-Spalte gefunden.`),{month:r.month,unitsIndex:E>=0?r.start+E:null,revenueIndex:i>=0?r.start+i:null,profitIndex:p>=0?r.start+p:null}}),warnings:n}:{groups:[],warnings:n}}function Le(e){const{rows:t}=Me(e);if(t.length<2)return{error:"CSV-Header nicht erkannt",records:[],warnings:[]};const n=t[0]||[],s=t[1]||[],a=Ne(n,s);if(a<0)return{error:"Keine SKU-Spalte gefunden",records:[],warnings:[]};const{groups:r,warnings:o}=Ie(n,s);if(!r.length)return{error:"Monatsgruppen unvollständig",records:[],warnings:o};const f=[];let d=0;for(let E=2;E<t.length;E+=1){const i=t[E]||[],p=String(i[a]||"").trim();if(p){if(p.toLowerCase()==="gesamt"){d+=1;continue}r.forEach(v=>{if(v.unitsIndex==null)return;const u=_(i[v.unitsIndex]),y=v.revenueIndex!=null?_(i[v.revenueIndex]):null,$=v.profitIndex!=null?_(i[v.profitIndex]):null;u==null&&y==null&&$==null||f.push({sku:p,month:v.month,units:u,revenueEur:y,profitEur:$})})}}return{records:f,warnings:o,ignoredTotal:d,skuIndex:a,months:r.map(E=>E.month)}}const ne="VentoryOne Forecast importieren (CSV)",re="forecast_view_v1",Ae={search:"",range:"next12",onlyActive:!0,onlyWithForecast:!1,view:"units",collapsed:{}},m=(()=>{const e=ye(re,{});return{...Ae,...e,collapsed:e&&e.collapsed||{}}})();m.scrollLeft=Number(m.scrollLeft||0);function O(){ke(re,{search:m.search,range:m.range,onlyActive:m.onlyActive,onlyWithForecast:m.onlyWithForecast,view:m.view,collapsed:m.collapsed})}function G(e){if(e==null)return null;if(typeof e=="number")return Number.isFinite(e)?e:null;const t=String(e).trim().replace(/\s+/g,"").replace(/[^0-9,.-]/g,"");if(!t)return null;const n=t.lastIndexOf(","),s=t.lastIndexOf("."),a=Math.max(n,s);let r=t;if(a>=0){const f=t.slice(0,a).replace(/[.,]/g,""),d=t.slice(a+1).replace(/[.,]/g,"");r=`${f}.${d}`}else r=t.replace(/[.,]/g,"");const o=Number(r);return Number.isFinite(o)?o:null}function X(e){return e==null||!Number.isFinite(Number(e))?"0,00":Number(e).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function Ce(e){return e==null||!Number.isFinite(Number(e))?"—":Math.round(Number(e)).toLocaleString("de-DE",{maximumFractionDigits:0})}function xe(e){return e==null||!Number.isFinite(Number(e))?"—":`${Math.round(Number(e)).toLocaleString("de-DE",{maximumFractionDigits:0})} €`}function Fe(e){if(!e)return!1;if(typeof e.active=="boolean")return e.active;const t=String(e.status||"").trim().toLowerCase();return t?t==="active"||t==="aktiv":!0}function Te(e,t=[]){const n=new Map;e.forEach(o=>{const f=o.categoryId?String(o.categoryId):"";n.has(f)||n.set(f,[]),n.get(f).push(o)});const a=t.slice().sort((o,f)=>{const d=Number.isFinite(o.sortOrder)?o.sortOrder:0,E=Number.isFinite(f.sortOrder)?f.sortOrder:0;return d-E||String(o.name||"").localeCompare(String(f.name||""))}).map(o=>({id:String(o.id),name:o.name||"Ohne Kategorie",items:n.get(String(o.id))||[]})),r=n.get("")||[];return r.length&&a.push({id:"uncategorized",name:"Ohne Kategorie",items:r}),a.filter(o=>o.items.length)}function Ve(e,t){const n=[],[s,a]=String(e).split("-").map(Number);for(let r=0;r<t;r+=1){const o=s+Math.floor((a-1+r)/12),f=(a-1+r)%12+1;n.push(`${o}-${String(f).padStart(2,"0")}`)}return n}function ee(e,t){if(t==="all")return e;const n=Number(String(t).replace("next",""))||e.length;return e.slice(0,n)}function ze(){const e=new Date;return`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}`}function qe(e){const t=[];return[12,18,24].forEach(n=>{e.length>=n&&t.push({value:`next${n}`,label:`Nächste ${n}`})}),t.push({value:"all",label:"Alle"}),t}function se(e,t,n){const s=e&&e.forecast,a=s&&s.forecastImport;if(!a)return null;const r=a[t];return r&&r[n]||null}function ae(e,t,n){const s=e&&e.forecast,a=s&&s.forecastManual;if(!a)return null;const r=a[t];if(!r||typeof r!="object")return null;const o=r[n];return typeof o>"u"?null:o}function T(e,t,n){const s=ae(e,t,n);if(s!=null)return s;const a=se(e,t,n);return!a||typeof a!="object"||typeof a.units>"u"?null:a.units}function j(e,t,n){if(t==null||!Number.isFinite(Number(t)))return null;const s=Number(t);if(e==="units")return s;const a=G(n&&n.avgSellingPriceGrossEUR);if(!Number.isFinite(a))return null;const r=s*a;if(e==="revenue")return r;const o=G(n&&n.sellerboardMarginPct);return Number.isFinite(o)?r*(o/100):null}function De(e,t){const n=new Map,s=Array.isArray(e==null?void 0:e.products)?e.products:[];return t.forEach(a=>n.set(a,0)),s.forEach(a=>{const r=String((a==null?void 0:a.sku)||"").trim();r&&t.forEach(o=>{const f=T(e,r,o),d=j("revenue",f,a);Number.isFinite(d)&&n.set(o,(n.get(o)||0)+d)})}),n}function Y(e){let t=document.getElementById("forecast-toast");t||(t=document.createElement("div"),t.id="forecast-toast",t.className="po-toast",document.body.appendChild(t)),t.textContent=e,t.hidden=!1,setTimeout(()=>{t.hidden=!0},2200)}function te(e){return typeof CSS<"u"&&typeof CSS.escape=="function"?CSS.escape(e):String(e).replace(/["\\]/g,"\\$&")}function Oe(e,t,n,s,a,r){const o=ze(),f=Number(o.split("-")[0]),d=document.createElement("table");d.className="table-compact dashboard-tree-table forecast-tree-table",d.dataset.uiTable="true",d.dataset.stickyCols="0";const E=g=>`month-col ${g%2===1?"month-col-alt":""}`.trim(),i=g=>{const h=g.filter(S=>Number.isFinite(S));return h.length?h.reduce((S,M)=>S+M,0):null},p=g=>r==="units"?Ce(g):xe(g),v=`
    <th class="forecast-total">Summe (Auswahl)</th>
    <th class="forecast-total">Summe (Jahr)</th>
    <th class="forecast-total">Summe (Gesamt)</th>
  `,u=document.createElement("thead"),y=document.createElement("tr");y.innerHTML=`
    <th class="tree-header">Kategorie / Produkt</th>
    ${n.map((g,h)=>`<th class="${E(h)}">${g}</th>`).join("")}
    ${v.replaceAll("forecast-total","forecast-total num")}
  `,u.appendChild(y),d.appendChild(u);const $=document.createElement("tbody"),l=n.map(g=>{const h=a.flatMap(S=>S.items.map(M=>{const w=String(M.sku||"").trim(),F=T(t,w,g);return j(r,F,M)}));return i(h)}),k=s.map(g=>{const h=a.flatMap(S=>S.items.map(M=>{const w=String(M.sku||"").trim(),F=T(t,w,g);return j(r,F,M)}));return i(h)}),c=document.createElement("tr");c.className="forecast-category-row forecast-overall-row row-summary",c.innerHTML=`
    <td class="tree-cell tree-summary tree-level-0">
      <span class="tree-spacer" aria-hidden="true"></span>
      <span class="tree-label">Gesamt</span>
    </td>
    ${n.map((g,h)=>`<td class="forecast-cell forecast-total num ${E(h)}">${p(l[h])}</td>`).join("")}
    ${(()=>{const g=i(l.filter(Number.isFinite)),h=i(k.filter(Number.isFinite)),S=s.map((w,F)=>({month:w,value:k[F]})).filter(w=>Number.isFinite(w.value)&&Number(w.month.split("-")[0])===f&&w.month>=o).map(w=>w.value),M=i(S);return`
        <td class="forecast-cell forecast-total num">${p(g)}</td>
        <td class="forecast-cell forecast-total num">${p(M)}</td>
        <td class="forecast-cell forecast-total num">${p(h)}</td>
      `})()}
  `,$.appendChild(c),a.forEach(g=>{const h=!!m.collapsed[g.id],S=n.map(I=>{const N=g.items.map(D=>{const z=String(D.sku||"").trim(),H=T(t,z,I);return j(r,H,D)});return i(N)}),M=s.map(I=>{const N=g.items.map(D=>{const z=String(D.sku||"").trim(),H=T(t,z,I);return j(r,H,D)});return i(N)}),w=document.createElement("tr");w.className="forecast-category-row row-section";const F=i(S.filter(Number.isFinite)),x=i(M.filter(Number.isFinite)),oe=s.map((I,N)=>({month:I,value:M[N]})).filter(I=>Number.isFinite(I.value)&&Number(I.month.split("-")[0])===f&&I.month>=o).map(I=>I.value),ce=i(oe);w.innerHTML=`
      <td class="tree-cell tree-level-0">
        <button type="button" class="tree-toggle" data-category="${g.id}">
          ${h?"▶":"▼"}
        </button>
        <span class="tree-label">${g.name}</span>
        <span class="forecast-count muted">${g.items.length}</span>
      </td>
      ${n.map((I,N)=>`<td class="forecast-cell forecast-total num ${E(N)}">${p(S[N])}</td>`).join("")}
      <td class="forecast-cell forecast-total num">${p(F)}</td>
      <td class="forecast-cell forecast-total num">${p(ce)}</td>
      <td class="forecast-cell forecast-total num">${p(x)}</td>
    `,$.appendChild(w),h||g.items.forEach(I=>{const N=String(I.sku||"").trim(),D=I.alias||N,z=document.createElement("tr");z.className="forecast-product-row row-detail",z.setAttribute("data-sku",N);const H=n.map(L=>{const q=T(t,N,L);return j(r,q,I)}),Q=s.map(L=>{const q=T(t,N,L);return j(r,q,I)}),le=i(H.filter(Number.isFinite)),ie=i(Q.filter(Number.isFinite)),ue=s.map((L,q)=>({month:L,value:Q[q]})).filter(L=>Number.isFinite(L.value)&&Number(L.month.split("-")[0])===f&&L.month>=o).map(L=>L.value),de=i(ue);z.innerHTML=`
          <td class="tree-cell tree-level-1 forecast-product-cell">
            <span class="tree-spacer" aria-hidden="true"></span>
            <span class="coverage-sku-block">
              <span class="tree-label">${D}</span>
              <span class="forecast-sku muted">${N}</span>
            </span>
          </td>
          ${n.map((L,q)=>{const R=ae(t,N,L),fe=se(t,N,L),me=T(t,N,L),Z=H[q],pe=p(Z),ge=R!=null?"forecast-manual":"",he=R!=null?"Manuell":fe?"Import":"",be=Z==null&&me!=null&&r!=="units"?"Produktdaten fehlen":he;return`
              <td class="forecast-cell num ${ge} ${E(q)}" data-sku="${N}" data-month="${L}" title="${be}">
                <span class="forecast-value">${pe}</span>
                ${R!=null?'<span class="forecast-manual-dot" aria-hidden="true"></span>':""}
              </td>
            `}).join("")}
          <td class="forecast-cell forecast-total num">${p(le)}</td>
          <td class="forecast-cell forecast-total num">${p(de)}</td>
          <td class="forecast-cell forecast-total num">${p(ie)}</td>
        `,$.appendChild(z)})}),d.appendChild($);let b=null;function V({commit:g}){if(!b)return;const h=b.closest("td"),S=h&&h.dataset?h.dataset.sku:null,M=h&&h.dataset?h.dataset.month:null,w=b.value;if(b.removeEventListener("keydown",B),b.removeEventListener("blur",C),b=null,g&&S&&M){const F=G(w),x=P();U(x),x.forecast.forecastManual[S]||(x.forecast.forecastManual[S]={}),w.trim()===""||F==null?x.forecast.forecastManual[S]&&(delete x.forecast.forecastManual[S][M],Object.keys(x.forecast.forecastManual[S]).length||delete x.forecast.forecastManual[S]):x.forecast.forecastManual[S][M]=F,K(x),A(e);return}A(e)}function B(g){g.key==="Enter"?(g.preventDefault(),V({commit:!0})):g.key==="Escape"&&(g.preventDefault(),V({commit:!1}))}function C(){V({commit:!0})}return $.addEventListener("click",g=>{if(m.view!=="units")return;const h=g.target.closest("td[data-sku]");if(!h||b)return;const S=h.dataset.sku,M=h.dataset.month;if(!S||!M)return;const w=T(t,S,M);h.innerHTML=`<input class="forecast-input" type="text" inputmode="decimal" value="${w??""}" />`,b=h.querySelector("input"),b.addEventListener("keydown",B),b.addEventListener("blur",C),b.focus(),b.select()}),$.addEventListener("click",g=>{const h=g.target.closest("[data-category]");if(!h)return;const S=h.getAttribute("data-category");S&&(m.collapsed[S]=!m.collapsed[S],O(),A(e))}),d}function U(e){(!e.forecast||typeof e.forecast!="object")&&(e.forecast={items:[],settings:{useForecast:!1},forecastImport:{},forecastManual:{},lastImportAt:null,importSource:null}),Array.isArray(e.forecast.items)||(e.forecast.items=[]),(!e.forecast.settings||typeof e.forecast.settings!="object")&&(e.forecast.settings={useForecast:!1}),(!e.forecast.forecastImport||typeof e.forecast.forecastImport!="object")&&(e.forecast.forecastImport={}),(!e.forecast.forecastManual||typeof e.forecast.forecastManual!="object")&&(e.forecast.forecastManual={}),e.forecast.lastImportAt===void 0&&(e.forecast.lastImportAt=null),e.forecast.importSource===void 0&&(e.forecast.importSource=null)}function A(e){const t=P();U(t),e.innerHTML="";const n=Array.isArray(t.products)?t.products:[],s=Array.isArray(t.productCategories)?t.productCategories:[],a=window.__routeQuery||{},r=String(a.sku||"").trim(),o=String(a.month||"").trim();if(r){m.search="",m.onlyActive=!1,m.onlyWithForecast=!1;const l=n.find(k=>String((k==null?void 0:k.sku)||"").trim()===r);(l==null?void 0:l.categoryId)!=null&&(m.collapsed[String(l.categoryId)]=!1)}const f=Ve(t.settings&&t.settings.startMonth||"2025-01",Number(t.settings&&t.settings.horizonMonths||18)),d=qe(f);o&&!ee(f,m.range).includes(o)&&(m.range="all"),d.some(l=>l.value===m.range)||(m.range=d[0]?d[0].value:"all");const E=ee(f,m.range),i=m.search.trim().toLowerCase(),p=n.filter(l=>{if(m.onlyActive&&!Fe(l))return!1;if(i){const k=s.find(b=>String(b.id)===String(l.categoryId));if(![l.alias,l.sku,...l.tags||[],k?k.name:null].filter(Boolean).map(b=>String(b).toLowerCase()).some(b=>b.includes(i)))return!1}if(m.onlyWithForecast){const k=String(l.sku||"").trim();if(!E.some(b=>{const V=T(t,k,b);return Number.isFinite(Number(V))&&Number(V)>0}))return!1}return!0}),v=Te(p,s),u=document.createElement("section");u.className="panel",u.innerHTML=`
    <header class="panel__header">
      <div>
        <p class="eyebrow">Werkzeuge</p>
        <h1>Absatzprognose (Ventory)</h1>
        <p class="text-muted">VentoryOne-Import, Vorschau und Übergabe an Umsätze/Payout.</p>
      </div>
      <div class="forecast-actions">
        <button class="btn secondary" type="button" data-ventory-csv>${ne}</button>
        <button class="btn" type="button" data-forecast-save>Änderungen speichern</button>
      </div>
    </header>
    <div class="forecast-toolbar">
      <div class="forecast-toolbar-row">
        <label class="field">
          <span>Suche</span>
          <input type="search" data-forecast-search value="${m.search}" placeholder="SKU, Alias, Tag, Kategorie" />
        </label>
        <label class="field">
          <span>Monatsbereich</span>
          <select data-forecast-range>
            ${d.map(l=>`<option value="${l.value}" ${l.value===m.range?"selected":""}>${l.label}</option>`).join("")}
          </select>
        </label>
        <div class="forecast-view-toggle" role="group" aria-label="Forecast-Ansicht">
          <button class="btn ${m.view==="units"?"secondary":"ghost"}" type="button" data-forecast-view="units">Absatz</button>
          <button class="btn ${m.view==="revenue"?"secondary":"ghost"}" type="button" data-forecast-view="revenue">Umsatz</button>
          <button class="btn ${m.view==="profit"?"secondary":"ghost"}" type="button" data-forecast-view="profit">Gewinn</button>
        </div>
        <label class="toggle">
          <input type="checkbox" ${m.onlyActive?"checked":""} data-only-active />
          <span>Nur aktive Produkte</span>
        </label>
        <label class="toggle">
          <input type="checkbox" ${m.onlyWithForecast?"checked":""} data-only-forecast />
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
  `;const y=document.createElement("div");if(y.className="forecast-table-wrap dashboard-table-wrap",v.length){const l=Oe(e,t,E,f,v,m.view);y.appendChild(l),y.scrollLeft=m.scrollLeft||0,y.addEventListener("scroll",()=>{m.scrollLeft=y.scrollLeft},{passive:!0})}else{const l=document.createElement("div");l.className="muted",l.style.padding="12px",l.textContent="Keine Produkte gefunden.",y.appendChild(l)}u.appendChild(y),e.appendChild(u),u.querySelector("[data-forecast-toggle]").addEventListener("change",l=>{const k=P();U(k),k.forecast.settings.useForecast=l.target.checked,K(k)}),u.querySelector("[data-ventory-csv]").addEventListener("click",()=>{Pe(e)}),u.querySelector("[data-forecast-transfer]").addEventListener("click",()=>{je(e,f,E)}),u.querySelector("[data-forecast-save]").addEventListener("click",()=>{const l=P();K(l),Y("Änderungen gespeichert.")}),u.querySelector("[data-forecast-search]").addEventListener("input",l=>{m.search=l.target.value,O(),A(e)}),u.querySelector("[data-forecast-range]").addEventListener("change",l=>{m.range=l.target.value,O(),A(e)}),u.querySelectorAll("[data-forecast-view]").forEach(l=>{l.addEventListener("click",()=>{const k=l.getAttribute("data-forecast-view");!k||k===m.view||(m.view=k,O(),A(e))})}),u.querySelector("[data-only-active]").addEventListener("change",l=>{m.onlyActive=l.target.checked,O(),A(e)}),u.querySelector("[data-only-forecast]").addEventListener("change",l=>{m.onlyWithForecast=l.target.checked,O(),A(e)}),u.querySelectorAll("[data-expand]").forEach(l=>{l.addEventListener("click",()=>{if(l.getAttribute("data-expand")==="collapse"){const c={};v.forEach(b=>{c[b.id]=!0}),m.collapsed=c}else m.collapsed={};O(),A(e)})});function $(){if(!r)return;const l=te(r),k=o?`[data-month="${te(o)}"]`:"",c=e.querySelector(`td[data-sku="${l}"]${k}`),b=c?c.closest("tr"):e.querySelector(`tr[data-sku="${l}"]`);b&&b.classList.add("row-focus"),c?(c.classList.add("cell-focus"),c.scrollIntoView({behavior:"smooth",block:"center",inline:"center"})):b&&b.scrollIntoView({behavior:"smooth",block:"center"}),window.__routeQuery={}}$()}function je(e,t,n){const s=P();U(s);const a=De(s,t),r=t.map(u=>({month:u,revenue:Number(a.get(u)||0)})),o=new Set((n||[]).filter(u=>(a.get(u)||0)>0)),f=document.createElement("div");f.className="po-modal-backdrop",f.setAttribute("role","dialog"),f.setAttribute("aria-modal","true");const d=document.createElement("div");d.className="po-modal",d.innerHTML=`
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
        ${r.map(u=>{const y=!Number.isFinite(u.revenue)||u.revenue<=0,$=o.has(u.month);return`
            <label class="forecast-transfer-row ${y?"is-disabled":""}">
              <input type="checkbox" data-month="${u.month}" ${$?"checked":""} ${y?"disabled":""} />
              <span>${u.month}</span>
              <span class="muted">${X(u.revenue)} €</span>
            </label>
          `}).join("")}
      </div>
    </div>
    <footer class="po-modal-actions">
      <button class="btn" type="button" data-cancel>Abbrechen</button>
      <button class="btn primary" type="button" data-transfer disabled>Übertragen</button>
    </footer>
  `,f.appendChild(d),document.body.appendChild(f);const E=()=>f.remove();f.addEventListener("click",u=>{u.target===f&&E()}),d.querySelector("[data-close]").addEventListener("click",E),d.querySelector("[data-cancel]").addEventListener("click",E);const i=d.querySelector("[data-transfer]"),p=Array.from(d.querySelectorAll("input[data-month]"));function v(){const u=p.some(y=>y.checked);i.disabled=!u}d.querySelector("[data-select-all]").addEventListener("click",()=>{p.forEach(u=>{u.disabled||(u.checked=!0)}),v()}),d.querySelector("[data-clear]").addEventListener("click",()=>{p.forEach(u=>{u.checked=!1}),v()}),p.forEach(u=>{u.addEventListener("change",v)}),v(),i.addEventListener("click",()=>{const u=p.filter(c=>c.checked).map(c=>c.getAttribute("data-month")).filter(Boolean);if(!u.length)return;const y=P();U(y),Array.isArray(y.incomings)||(y.incomings=[]);const $=y.incomings.slice().reverse().find(c=>(c==null?void 0:c.payoutPct)!=null&&String(c.payoutPct).trim()!==""),l=($==null?void 0:$.payoutPct)??"0",k=[];u.forEach(c=>{const b=Number(a.get(c)||0),V=X(b),B=y.incomings.findIndex(C=>(C==null?void 0:C.month)===c);if(B>=0){const C=y.incomings[B];C.revenueEur=V,C.payoutPct||(C.payoutPct=l),C.source="forecast"}else y.incomings.push({month:c,revenueEur:V,payoutPct:l,source:"forecast"});k.push(c)}),y.incomings.sort((c,b)=>String(c.month||"").localeCompare(String(b.month||""))),K(y),Y(`Umsatz übertragen: ${k.length} Monat${k.length===1?"":"e"}.`),E(),A(e)})}function Pe(e){const t=document.createElement("div");t.className="po-modal-backdrop",t.setAttribute("role","dialog"),t.setAttribute("aria-modal","true");const n=document.createElement("div");n.className="po-modal",n.innerHTML=`
    <header class="po-modal-header">
      <h3>${ne}</h3>
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
  `,t.appendChild(n),document.body.appendChild(t);const s=()=>t.remove();t.addEventListener("click",i=>{i.target===t&&s()}),n.querySelector("[data-close]").addEventListener("click",s),n.querySelector("[data-cancel]").addEventListener("click",s);const a=n.querySelector("[data-file]"),r=n.querySelector("[data-overwrite]"),o=n.querySelector("[data-import]"),f=n.querySelector("[data-summary]");let d=null;function E(i){f.hidden=!1,f.innerHTML=`
      <h4>Import Summary</h4>
      <p>SKUs: <strong>${i.skuCount}</strong></p>
      <p>Monate: <strong>${i.monthCount}</strong></p>
      <p>Datensätze: <strong>${i.recordCount}</strong></p>
      <p>Ignorierte Zeilen (Gesamt): <strong>${i.ignoredTotal}</strong></p>
      ${i.unknownSkus.length?`<p class="text-muted">Unbekannte SKUs:</p><ul>${i.unknownSkus.map(p=>`<li>${p}</li>`).join("")}</ul>`:""}
      ${i.warnings.length?`<p class="text-muted">Hinweise:</p><ul>${i.warnings.map(p=>`<li>${p}</li>`).join("")}</ul>`:""}
    `}a.addEventListener("change",async i=>{const p=i.target.files&&i.target.files[0];if(p){d=null,o.disabled=!0,f.hidden=!0;try{const v=await p.text(),u=Le(v);if(u.error){alert(u.error);return}d=u,o.disabled=!u.records.length}catch(v){console.error(v),alert("Datei konnte nicht gelesen werden. Bitte erneut versuchen.")}}}),o.addEventListener("click",()=>{if(!d||!d.records||!d.records.length)return;const i=P();U(i);const p=Array.isArray(i.products)?i.products:[],v=new Set(p.map(c=>String(c.sku||"").trim())),u=new Date().toISOString(),y=r.checked,$=new Set,l=[];d.records.forEach(c=>{if(!v.has(c.sku)){$.add(c.sku);return}l.push(c)}),y?l.forEach(c=>{i.forecast.forecastImport[c.sku]||(i.forecast.forecastImport[c.sku]={}),i.forecast.forecastImport[c.sku][c.month]={units:c.units,revenueEur:c.revenueEur,profitEur:c.profitEur}}):l.forEach(c=>{i.forecast.forecastImport[c.sku]||(i.forecast.forecastImport[c.sku]={}),i.forecast.forecastImport[c.sku][c.month]||(i.forecast.forecastImport[c.sku][c.month]={units:c.units,revenueEur:c.revenueEur,profitEur:c.profitEur})}),i.forecast.lastImportAt=u,i.forecast.importSource="ventoryone",K(i);const k={skuCount:new Set(d.records.map(c=>c.sku)).size,monthCount:new Set(d.records.map(c=>c.month)).size,recordCount:d.records.length,ignoredTotal:d.ignoredTotal||0,unknownSkus:Array.from($),warnings:d.warnings||[]};E(k),Y(`Import erfolgreich: ${l.length} Datensätze.`),A(e)})}function Ke(e){A(e);const t=ve(()=>A(e));return{cleanup(){t()}}}export{Ke as default};
