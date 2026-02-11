import{l as nn,c as At,g as en,b as sn}from"./store-kRkpVkNt.js";import{p as X}from"./index-LScGhqvu.js";import{b as on}from"./abcClassification-BFoIvtOK.js";import{c as rn,r as an,a as ln,g as cn}from"./inventoryProjection-DdsNkC1h.js";const Ht="inventory_view_v1";function h(t){return String(t??"").replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e])}function Rt(t){return typeof CSS<"u"&&typeof CSS.escape=="function"?CSS.escape(t):String(t).replace(/["\\]/g,"\\$&")}function _t(){const t=new Date;return`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}`}function mt(t){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[e,n]=t.split("-").map(Number);return e*12+(n-1)}function Wt(t,e){const[n,r]=t.split("-").map(Number),l=n*12+(r-1)+e,i=Math.floor(l/12),s=l%12+1;return`${i}-${String(s).padStart(2,"0")}`}function un(t,e){return Array.from({length:e},(n,r)=>Wt(t,r+1))}function wt(t){if(!t)return"—";const[e,n]=t.split("-");return`${n}-${e}`}function dn(t){if(!t)return"—";const[e,n]=t.split("-");return`${n}/${e}`}function kt(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return"";const e=t.getFullYear(),n=String(t.getMonth()+1).padStart(2,"0"),r=String(t.getDate()).padStart(2,"0");return`${e}-${n}-${r}`}function mn(t){if(!t)return null;const e=new Date(`${t}T00:00:00`);return Number.isNaN(e.getTime())?null:e}function fn(t){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[e,n]=t.split("-").map(Number);return new Date(e,n,0)}function Yt(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return null;const e=new Date(t.getTime());return e.setHours(23,59,59,999),e}function qt(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"Bestandsaufnahme":`Bestandsaufnahme zum ${pt(t)}`}function pn(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return"—";const e=t.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}),n=t.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});return`${e} ${n}`}function hn(t){if(t==null||t==="")return{value:0,isRounded:!1};const e=X(String(t));if(!Number.isFinite(e))return{value:0,isRounded:!1};const n=Math.round(e);return{value:n,isRounded:n!==e}}function yn(t,e,n){var f,m,p,b,S,g,M;const r=Ct(n);if(!r)return null;const l=(p=(m=(f=t==null?void 0:t.forecast)==null?void 0:f.forecastManual)==null?void 0:m[e])==null?void 0:p[r],i=X(l);if(Number.isFinite(i))return i;const s=(M=(g=(S=(b=t==null?void 0:t.forecast)==null?void 0:b.forecastImport)==null?void 0:S[e])==null?void 0:g[r])==null?void 0:M.units,o=X(s);return Number.isFinite(o)?o:null}function C(t){return t==null||!Number.isFinite(Number(t))?"—":Math.round(Number(t)).toLocaleString("de-DE",{maximumFractionDigits:0})}function Nt(t,e){const n=String(e||"").trim().toLowerCase();return n?t.filter(r=>String(r.alias||"").toLowerCase().includes(n)||String(r.sku||"").toLowerCase().includes(n)):t}function vn(t){if(!t)return!1;if(typeof t.active=="boolean")return t.active;const e=String(t.status||"").trim().toLowerCase();return e?e==="active"||e==="aktiv":!0}function Ut(t,e=[]){const n=new Map;t.forEach(s=>{const o=s.categoryId?String(s.categoryId):"";n.has(o)||n.set(o,[]),n.get(o).push(s)});const l=e.slice().sort((s,o)=>{const f=Number.isFinite(s.sortOrder)?s.sortOrder:0,m=Number.isFinite(o.sortOrder)?o.sortOrder:0;return f-m||String(s.name||"").localeCompare(String(o.name||""))}).map(s=>({id:String(s.id),name:s.name||"Ohne Kategorie",items:n.get(String(s.id))||[]})),i=n.get("")||[];return i.length&&l.push({id:"uncategorized",name:"Ohne Kategorie",items:i}),l.filter(s=>s.items.length)}function gn(){const t=en(Ht,{}),e=t.projectionMode==="doh"||t.projectionMode==="plan"?t.projectionMode:"units";return{selectedMonth:t.selectedMonth||null,collapsed:t.collapsed&&typeof t.collapsed=="object"?t.collapsed:{},search:t.search||"",showSafety:t.showSafety!==!1,projectionMode:e,snapshotAsOfDate:t.snapshotAsOfDate||""}}function W(t){sn(Ht,t)}function bn(t,e){var s;const n=(((s=t.inventory)==null?void 0:s.snapshots)||[]).map(o=>o==null?void 0:o.month).filter(o=>/^\d{4}-\d{2}$/.test(o)).sort(),r=n[n.length-1],l=_t(),i=e.selectedMonth||r||l;return i||l}function Kt({products:t,categories:e,view:n,collapsed:r}){const l=Nt(t,n.search),i=Ut(l,e),s={...n.collapsed};i.forEach(o=>{s[o.id]=r}),n.collapsed=s,W(n)}function Ct(t){if(!t)return null;const e=String(t);if(/^\d{4}-\d{2}$/.test(e))return e;const n=e.match(/^(\d{2})-(\d{4})$/);return n?`${n[2]}-${n[1]}`:e}function Gt(t,e){var n;return(((n=t.inventory)==null?void 0:n.snapshots)||[]).find(r=>(r==null?void 0:r.month)===e)||null}function Vt(t,e){const n=Gt(t,e);if(n)return n;const r={month:e,items:[]};return t.inventory||(t.inventory={snapshots:[],settings:{}}),Array.isArray(t.inventory.snapshots)||(t.inventory.snapshots=[]),t.inventory.snapshots.push(r),r}function zt(t,e){if(!t||!e)return null;Array.isArray(t.items)||(t.items=[]);let n=t.items.find(r=>String(r.sku||"").trim()===e);return n||(n={sku:e,amazonUnits:0,threePLUnits:0,note:""},t.items.push(n)),n}function Bt(t,e){var i;const n=mt(e);if(n==null)return null;const r=(((i=t.inventory)==null?void 0:i.snapshots)||[]).filter(s=>(s==null?void 0:s.month)&&mt(s.month)!=null).slice().sort((s,o)=>mt(s.month)-mt(o.month));let l=null;return r.forEach(s=>{const o=mt(s.month);o!=null&&o<n&&(l=s)}),l}function Et(t,e){if(!e)return"—";const r=(Array.isArray(t.suppliers)?t.suppliers:[]).find(l=>String(l.id||"")===String(e));return(r==null?void 0:r.name)||e||"—"}function ct(t){if(!t)return null;const e=new Date(t);return Number.isNaN(e.getTime())?null:e}function Ft(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?null:`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}`}function Qt(t){const e=ct((t==null?void 0:t.etaManual)||(t==null?void 0:t.etaDate)||(t==null?void 0:t.eta));if(e)return e;const n=ct(t==null?void 0:t.etaComputed);if(n)return n;const r=ct(t==null?void 0:t.orderDate);if(!r)return null;const l=Number((t==null?void 0:t.prodDays)||0),i=Number((t==null?void 0:t.transitDays)||0),s=new Date(r.getTime());return s.setDate(s.getDate()+Math.max(0,l+i)),s}function Xt(t){return ct((t==null?void 0:t.targetDeliveryDate)||(t==null?void 0:t.deliveryDate)||(t==null?void 0:t.etaDate))}function Jt(t){const e=String((t==null?void 0:t.status)||"").toUpperCase();return!(e==="CONVERTED"||e==="CANCELLED")}function $n(t,e,n){const r=n.map(i=>Ct(i)).filter(Boolean),l=new Map;return t.forEach(i=>{const s=new Map;r.forEach(o=>{let f=0,m=!1;i.items.forEach(p=>{var g;const b=String((p==null?void 0:p.sku)||"").trim();if(!b)return;const S=(g=e.get(b))==null?void 0:g.get(o);Number.isFinite(S)&&(f+=S,m=!0)}),m&&s.set(o,f)}),l.set(i.id,s)}),l}function Ot(t,e){var i;const n=((i=t==null?void 0:t.template)==null?void 0:i.fields)||(t==null?void 0:t.template)||{},r=X(n.unitPriceUsd??(t==null?void 0:t.unitPriceUsd)??null);if(!Number.isFinite(r))return null;const l=String(n.currency||(e==null?void 0:e.defaultCurrency)||"EUR").toUpperCase();if(l==="EUR")return r;if(l==="USD"){const s=X(e==null?void 0:e.fxRate);return!Number.isFinite(s)||s<=0?null:r/s}return null}function jt(t){return t==null||!Number.isFinite(Number(t))?"—":Number(t).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function pt(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"—":t.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"})}function Sn(t,e){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[n,r]=t.split("-").map(Number);if(!Number.isFinite(n)||!Number.isFinite(r))return null;const l=String(e).toUpperCase();let i=1;return l==="MID"&&(i=15),l==="END"&&(i=new Date(n,r,0).getDate()),new Date(Date.UTC(n,r-1,i))}function kn(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"—":t.toISOString().slice(0,10)}function wn(t){const e=ct((t==null?void 0:t.etdManual)||(t==null?void 0:t.etdDate));if(e)return e;const n=ct(t==null?void 0:t.orderDate);if(!n)return null;const r=Number((t==null?void 0:t.prodDays)||0),l=new Date(n.getTime());return l.setDate(l.getDate()+Math.max(0,r)),l}function En(t){const e=new Map,n=new Set;function r(i,s){e.has(i)||e.set(i,new Map);const o=e.get(i);return o.has(s)||o.set(s,{events:[],hasPo:!1,hasFo:!1,poUnits:0,foUnits:0}),o.get(s)}function l(i,s,o){const f=r(i,s),m=f.events.find(p=>p.type===o.type&&p.id===o.id);m?m.qty+=o.qty:f.events.push({...o}),o.type==="PO"&&(f.hasPo=!0,f.poUnits+=o.qty),o.type==="FO"&&(f.hasFo=!0,f.foUnits+=o.qty)}return(t.pos||[]).forEach(i=>{if(!i||i.archived)return;const s=Array.isArray(i.items)&&i.items.length?i.items:[{sku:i.sku,units:i.units}],o=Qt(i),f=o?Ft(o):null;s.forEach(m=>{const p=String((m==null?void 0:m.sku)||"").trim();if(!p)return;const b=X((m==null?void 0:m.units)??0),S=Number.isFinite(b)?Math.round(b):0;if(!f){n.add(p);return}l(p,f,{type:"PO",id:String(i.id||i.poNo||p),label:i.poNo||i.id||"PO",supplier:Et(t,i.supplierId||i.supplier),qty:S,date:o?o.toISOString().slice(0,10):"—",route:"#po",open:i.id||i.poNo||""})})}),(t.fos||[]).forEach(i=>{if(!i||!Jt(i))return;const s=Array.isArray(i.items)&&i.items.length?i.items:[{sku:i.sku,units:i.units}],o=Xt(i),f=o?Ft(o):null;f&&s.forEach(m=>{const p=String((m==null?void 0:m.sku)||"").trim();if(!p)return;const b=X((m==null?void 0:m.units)??0),S=Number.isFinite(b)?Math.round(b):0;l(p,f,{type:"FO",id:String(i.id||i.foNo||p),label:i.foNo||i.id||"FO",supplier:Et(t,i.supplierId||i.supplier),qty:S,date:o?o.toISOString().slice(0,10):"—",route:"#fo",open:i.id||i.foNo||""})})}),{inboundMap:e,missingEtaSkus:n}}function Zt(t,e){const n=new Map,r=new Date,l=Yt(e)||r,i=(s,o)=>{n.has(s)||n.set(s,{total:0,entries:[]});const f=n.get(s);f.total+=o.qty,f.entries.push(o)};return(t.pos||[]).forEach(s=>{if(!s||s.archived||String(s.status||"").toUpperCase()==="CANCELLED")return;const o=Qt(s);if(o&&o<=l)return;const f=wn(s);(Array.isArray(s.items)&&s.items.length?s.items:[{sku:s.sku,units:s.units}]).forEach(p=>{const b=String((p==null?void 0:p.sku)||"").trim();if(!b)return;const S=X((p==null?void 0:p.units)??0),g=Number.isFinite(S)?Math.round(S):0;g&&i(b,{type:"PO",id:String(s.id||s.poNo||b),label:s.poNo||s.id||"PO",supplier:Et(t,s.supplierId||s.supplier),qty:g,etd:f?pt(f):"—",eta:o?pt(o):"—",route:"#po",open:s.id||s.poNo||""})})}),(t.fos||[]).forEach(s=>{if(!s||!Jt(s))return;const o=Xt(s);if(o&&o<=l)return;(Array.isArray(s.items)&&s.items.length?s.items:[{sku:s.sku,units:s.units}]).forEach(m=>{const p=String((m==null?void 0:m.sku)||"").trim();if(!p)return;const b=X((m==null?void 0:m.units)??0),S=Number.isFinite(b)?Math.round(b):0;S&&i(p,{type:"FO",id:String(s.id||s.foNo||p),label:s.foNo||s.id||"FO",supplier:Et(t,s.supplierId||s.supplier),qty:S,etd:"—",eta:o?pt(o):"—",route:"#fo",open:s.id||s.foNo||""})})}),n}function Dn({alias:t,month:e,events:n}){if(!n||!n.length)return"";const r=n.map(l=>`
    <div class="inventory-tooltip-row">
      <div>
        <strong>${h(l.type)} ${h(l.label)}</strong>
        <div class="muted">${h(l.supplier||"—")}</div>
      </div>
      <div class="inventory-tooltip-meta">
        <div>${C(l.qty)}</div>
        <div class="muted">${h(l.date||"—")}</div>
      </div>
    </div>
    <div class="inventory-tooltip-actions">
      <button class="btn sm secondary inventory-link" type="button" data-route="${l.route}" data-open="${h(l.open)}">${l.type==="FO"?"Open FO":"Open PO"}</button>
    </div>
  `).join("");return`
    <div class="inventory-tooltip">
      <div class="inventory-tooltip-header">
        <div class="inventory-tooltip-title">Inbound arrivals in ${wt(e)}</div>
        <div class="inventory-tooltip-alias">${h(t)}</div>
      </div>
      <div class="inventory-tooltip-body">${r}</div>
    </div>
  `}function Nn({alias:t,entries:e}){if(!e||!e.length)return"";const n=e.map(r=>`
    <div class="inventory-tooltip-row">
      <div>
        <strong>${h(r.type)} ${h(r.label)}</strong>
        <div class="muted">${h(r.supplier||"—")}</div>
      </div>
      <div class="inventory-tooltip-meta">
        <div>${C(r.qty)}</div>
        <div class="muted">ETD ${h(r.etd)} · ETA ${h(r.eta)}</div>
      </div>
    </div>
    <div class="inventory-tooltip-actions">
      <button class="btn sm secondary inventory-link" type="button" data-route="${r.route}" data-open="${h(r.open)}">Open ${r.type}</button>
    </div>
  `).join("");return`
    <div class="inventory-tooltip">
      <div class="inventory-tooltip-header">
        <div class="inventory-tooltip-title">In Transit</div>
        <div class="inventory-tooltip-alias">${h(t||"—")}</div>
      </div>
      <div class="inventory-tooltip-body">${n}</div>
    </div>
  `}function tn(t){return encodeURIComponent(t||"")}const ht=new Map;function Dt(t,e,n){return`${t||"unknown"}:${e}:${n}`}function Un({state:t,view:e,snapshot:n,previousSnapshot:r,products:l,categories:i,asOfDate:s,snapshotMonth:o}){const f=Nt(l,e.search),m=Ut(f,i),p=new Map;((r==null?void 0:r.items)||[]).forEach(g=>{const M=String(g.sku||"").trim();M&&p.set(M,g)});const b=Zt(t,s);return`
    <table class="table-compact inventory-table inventory-snapshot-table" data-ui-table="true" data-sticky-cols="3">
      <thead>
        <tr>
          <th class="inventory-col-sku sticky-header">SKU</th>
          <th class="inventory-col-alias sticky-header">Alias</th>
          <th class="inventory-col-category sticky-header">Kategorie</th>
          <th class="num">Amazon Units</th>
          <th class="num">3PL Units</th>
          <th class="num">Total Units</th>
          <th class="num">In Transit</th>
          <th class="num">EK (EUR)</th>
          <th class="num">Warenwert €</th>
          <th class="num">Delta vs prev</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        ${m.map(g=>{const M=e.collapsed[g.id],A=g.items.map(T=>{const N=String(T.sku||"").trim(),v=zt(n,N),$=b.get(N),P=$?$.total:0,L=p.get(N),U=Number((v==null?void 0:v.amazonUnits)||0),x=Number((v==null?void 0:v.threePLUnits)||0),F=U+x,R=F+P,q=((L==null?void 0:L.amazonUnits)||0)+((L==null?void 0:L.threePLUnits)||0),H=F-q,Y=Ot(T,t.settings||{}),G=Number.isFinite(Y)?R*Y:null,Z=!Number.isFinite(Y),ot=$&&$.entries.length?Nn({alias:T.alias||N,entries:$.entries}):"",tt=ht.get(Dt(o,N,"amazonUnits")),E=ht.get(Dt(o,N,"threePLUnits"));return`
        <tr class="inventory-row ${M?"is-collapsed":""}" data-sku="${h(N)}" data-category="${h(g.id)}">
          <td class="inventory-col-sku sticky-cell">${h(N)}</td>
          <td class="inventory-col-alias sticky-cell">${h(T.alias||"—")}</td>
          <td class="inventory-col-category sticky-cell">${h(g.name)}</td>
          <td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="amazonUnits" value="${h(tt??String((v==null?void 0:v.amazonUnits)??0))}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>
          <td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="threePLUnits" value="${h(E??String((v==null?void 0:v.threePLUnits)??0))}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>
          <td class="num inventory-value" data-field="totalUnits">${C(F)}</td>
          <td class="num inventory-value inventory-in-transit" data-tooltip-html="${tn(ot)}">${C(P)}</td>
          <td class="num">
            ${Z?'<span class="cell-warning" title="EK fehlt im Produkt">⚠︎</span>':""}
            <span data-field="ekEur">${Number.isFinite(Y)?jt(Y):"—"}</span>
          </td>
          <td class="num inventory-value" data-field="totalValue">${Number.isFinite(G)?jt(G):"—"}</td>
          <td class="num inventory-value" data-field="delta">${C(H)}</td>
          <td><input class="inventory-input note" data-field="note" value="${h((v==null?void 0:v.note)||"")}" /></td>
        </tr>
      `}).join("");return`
        <tr class="inventory-category-row" data-category-row="${h(g.id)}">
          <th class="inventory-col-sku sticky-cell" colspan="3">
            <button type="button" class="tree-toggle" data-category="${h(g.id)}">${M?"▸":"▾"}</button>
            <span class="tree-label">${h(g.name)}</span>
            <span class="muted">(${g.items.length})</span>
          </th>
          <th colspan="8"></th>
        </tr>
        ${A}
      `}).join("")||'<tr><td class="muted" colspan="11">Keine Produkte gefunden.</td></tr>'}
      </tbody>
    </table>
  `}function ft(t,e=";"){const n=String(t??"");return n?n.includes('"')||n.includes(`
`)||n.includes(e)?`"${n.replace(/"/g,'""')}"`:n:""}function B(t){return t==null||!Number.isFinite(Number(t))?"":Math.round(Number(t)).toLocaleString("de-DE",{maximumFractionDigits:0})}function ut(t){return t==null||!Number.isFinite(Number(t))?"":Number(t).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function Mn({state:t,view:e,snapshot:n,products:r,categories:l,asOfDate:i}){const s=Nt(r,e.search),o=Ut(s,l),f=Zt(t,i),m=new Map;((n==null?void 0:n.items)||[]).forEach(T=>{const N=String(T.sku||"").trim();N&&m.set(N,T)});const p=[],b=[];let S=0,g=0,M=0,A=0;return o.forEach(T=>{T.items.forEach(N=>{const v=String(N.sku||"").trim();if(!v)return;const $=N.alias||"",P=m.get(v)||{amazonUnits:0,threePLUnits:0},L=Number((P==null?void 0:P.amazonUnits)||0),U=Number((P==null?void 0:P.threePLUnits)||0),x=f.get(v),F=x?x.total:0,R=Ot(N,t.settings||{}),q=L+U+F,H=Number.isFinite(R)?q*R:null;Number.isFinite(R)||b.push($?`${v} (${$})`:v),Number.isFinite(L)&&(S+=L),Number.isFinite(U)&&(g+=U),Number.isFinite(F)&&(M+=F),Number.isFinite(H)&&(A+=H),p.push({sku:v,alias:$,amazonUnits:L,threePlUnits:U,inTransitUnits:F,ekEur:R,rowValue:H})})}),{rows:p,totals:{amazonUnits:S,majamoUnits:g,inTransitUnits:M,totalUnits:S+g+M,totalValue:A},missingEk:b}}function Ln({title:t,rows:e,totals:n,missingEk:r}){const l=";",i=[];t&&(i.push(ft(t,l)),i.push(""));const s=["SKU","Alias","Bestand Amazon (Stk)","Bestand majamo (Stk)","In Transit (Stk)","EK-Preis (EUR / Stk)","Warenwert (EUR)"];i.push(s.map(f=>ft(f,l)).join(l)),e.forEach(f=>{const m=[f.sku,f.alias,B(f.amazonUnits),B(f.threePlUnits),B(f.inTransitUnits),ut(f.ekEur),ut(f.rowValue)];i.push(m.map(p=>ft(p,l)).join(l))});const o=["Gesamtsumme Warenwert (EUR)","",B(n.amazonUnits),B(n.majamoUnits),B(n.inTransitUnits),"",ut(n.totalValue)];return i.push(o.map(f=>ft(f,l)).join(l)),r.length&&(i.push(""),i.push(ft(`Fehlender EK-Preis für: ${r.join(", ")}`,l))),i.join(`
`)}function xn({title:t,fileName:e,rows:n,totals:r,missingEk:l,generatedAt:i}){const s=n.map(m=>`
      <tr>
        <td>${h(m.sku)}</td>
        <td>${h(m.alias||"")}</td>
        <td class="num">${B(m.amazonUnits)}</td>
        <td class="num">${B(m.threePlUnits)}</td>
        <td class="num">${B(m.inTransitUnits)}</td>
        <td class="num">${ut(m.ekEur)}</td>
        <td class="num">${ut(m.rowValue)}</td>
      </tr>
  `).join(""),o=`
      <tr class="totals">
        <td>Gesamtsumme Warenwert (EUR)</td>
        <td></td>
        <td class="num">${B(r.amazonUnits)}</td>
        <td class="num">${B(r.majamoUnits)}</td>
        <td class="num">${B(r.inTransitUnits)}</td>
        <td class="num"></td>
        <td class="num">${ut(r.totalValue)}</td>
      </tr>
  `,f=l.length?`<div class="warning">Fehlender EK-Preis für: ${h(l.join(", "))}</div>`:"";return`
    <!doctype html>
    <html lang="de">
      <head>
        <meta charset="utf-8" />
        <title>${h(e||t)}</title>
        <style>
          body { font-family: "Inter", system-ui, sans-serif; margin: 32px; color: #0f172a; }
          h1 { font-size: 20px; margin: 0 0 6px; }
          .meta { font-size: 12px; color: #475569; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border-bottom: 1px solid #e2e8f0; padding: 8px; text-align: left; }
          th { background: #f8fafc; font-weight: 600; color: #475569; }
          .num { text-align: right; font-variant-numeric: tabular-nums; }
          .totals td { font-weight: 700; background: #f1f5f9; }
          .warning { margin-top: 12px; font-size: 12px; color: #b45309; }
          @media print {
            body { margin: 16px; }
            .actions { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="actions">
          <button onclick="window.print()">Drucken / Als PDF speichern</button>
        </div>
        <h1>${h(t)}</h1>
        <div class="meta">Erstellt am: ${h(i)}</div>
        <table data-ui-table="true">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Alias</th>
              <th class="num">Bestand Amazon (Stk)</th>
              <th class="num">Bestand majamo (Stk)</th>
              <th class="num">In Transit (Stk)</th>
              <th class="num">EK-Preis (EUR / Stk)</th>
              <th class="num">Warenwert (EUR)</th>
            </tr>
          </thead>
          <tbody>
            ${s}
            ${o}
          </tbody>
        </table>
        ${f}
        <script>
          window.addEventListener("load", () => {
            setTimeout(() => window.print(), 250);
          });
        <\/script>
      </body>
    </html>
  `}function Pn({state:t,view:e,snapshot:n,products:r,categories:l,months:i}){const s=Nt(r,e.search),o=Ut(s,l),f=new Map,m=rn({state:t,months:i,products:s,snapshot:n,projectionMode:e.projectionMode}),p=m.months;s.forEach(v=>{const $=String((v==null?void 0:v.sku)||"").trim();if(!$)return;const P=new Map;p.forEach(L=>{var x;const U=(x=m.perSkuMonth.get($))==null?void 0:x.get(L);Number.isFinite(U==null?void 0:U.forecastUnits)&&P.set(L,U.forecastUnits)}),f.set($,P)});const b=e.projectionMode==="plan"?$n(o,f,i):new Map,S=new Map;((n==null?void 0:n.items)||[]).forEach(v=>{const $=String(v.sku||"").trim();$&&S.set($,v)});const{inboundMap:g,missingEtaSkus:M}=En(t),A=on(t).bySku,T=o.map(v=>{const $=e.collapsed[v.id],P=v.items.map(U=>{var E;const x=String(U.sku||"").trim(),F=U.alias||"—",R=((E=A==null?void 0:A.get(x.toLowerCase()))==null?void 0:E.abcClass)||"—",q=an(U,t),H=ln(U,t),Y=Number.isFinite(q)?C(q):"—",G=Number.isFinite(H)?C(H):"—";let Z=0;const ot=i.map(K=>{var d;const j=g.get(x),w=j?j.get(K):null;w&&w.poUnits+w.foUnits;const D=(d=m.perSkuMonth.get(x))==null?void 0:d.get(K),yt=(D==null?void 0:D.forecastUnits)??null,nt=(D==null?void 0:D.endAvailable)??null,Q=(D==null?void 0:D.forecastMissing)??!0,Mt=Number.isFinite(D==null?void 0:D.safetyUnits)?D.safetyUnits:null,Lt=Number.isFinite(D==null?void 0:D.safetyDays)?D.safetyDays:null,vt=w!=null&&w.hasPo&&(w!=null&&w.hasFo)?"inventory-cell inbound-both":w!=null&&w.hasPo?"inventory-cell inbound-po":w!=null&&w.hasFo?"inventory-cell inbound-fo":"inventory-cell",J=(D==null?void 0:D.doh)??null,et=e.projectionMode==="doh",rt=e.projectionMode==="plan",gt=et?Number.isFinite(J)&&J<=0:Number.isFinite(nt)&&nt<=0,bt=rt?Number.isFinite(yt)?C(yt):"—":Q?"—":gt?'0 <span class="inventory-warning-icon">⚠︎</span>':et?J==null?"—":C(J):C(nt),It=rt?"":cn({endAvailable:nt,safetyUnits:Mt,doh:J,safetyDays:Lt,projectionMode:e.projectionMode}),xt=rt?"":Q?"incomplete":"",$t=w?`
            ${w.hasPo?'<span class="inventory-inbound-marker po"></span>':""}
            ${w.hasFo?'<span class="inventory-inbound-marker fo"></span>':""}
          `:"",st=w?Dn({alias:F,month:K,events:w.events}):"",St=st?st.replace(/\s+/g," ").trim():"",a=st?`inventory-inbound-${x}-${K}-${Z++}`:"";return`
          <td class="num ${vt} ${It} ${xt} inventory-projection-cell" data-month="${h(K)}" ${st?`data-tooltip-html="${tn(St)}"`:""} ${a?`data-tooltip-id="${a}"`:""}>
            <span class="inventory-cell-value">${bt}</span>
            ${$t}
          </td>
        `}).join(""),tt=M.has(x)?'<span class="cell-warning" title="PO ohne ETA wird nicht gezählt">⚠︎</span>':"";return`
        <tr class="inventory-row ${$?"is-collapsed":""}" data-sku="${h(x)}" data-category="${h(v.id)}">
          <td class="inventory-col-sku sticky-cell">${tt}${h(x)}</td>
          <td class="inventory-col-alias sticky-cell">${h(F)}</td>
          <td class="inventory-col-abc sticky-cell">${h(R)}</td>
          <td class="inventory-col-safety-days sticky-cell num">${h(Y)}</td>
          <td class="inventory-col-coverage-days sticky-cell num">${h(G)}</td>
          ${ot}
        </tr>
      `}).join(""),L=e.projectionMode==="plan"?i.map(U=>{var q;const x=Ct(U),F=(q=b.get(v.id))==null?void 0:q.get(x);return`<td class="num inventory-projection-group-cell">${Number.isFinite(F)?C(F):"—"}</td>`}).join(""):`<th colspan="${i.length}"></th>`;return`
      <tr class="inventory-category-row" data-category-row="${h(v.id)}">
        <th class="inventory-col-sku sticky-cell" colspan="5">
          <button type="button" class="tree-toggle" data-category="${h(v.id)}">${$?"▸":"▾"}</button>
          <span class="tree-label">${h(v.name)}</span>
          <span class="muted">(${v.items.length})</span>
        </th>
        ${L}
      </tr>
      ${P}
    `}).join("");return`
    <table class="table-compact inventory-table inventory-projection-table" data-ui-table="true" data-sticky-cols="5">
      <thead>
        <tr>
          <th class="inventory-col-sku sticky-header">SKU</th>
          <th class="inventory-col-alias sticky-header">Alias</th>
          <th class="inventory-col-abc sticky-header">ABC</th>
          <th class="inventory-col-safety-days sticky-header" data-ui-tooltip="Sicherheitsbestand in Days on Hand">Safety DOH</th>
          <th class="inventory-col-coverage-days sticky-header" data-ui-tooltip="Bestellreichweite in Days on Hand">Coverage DOH</th>
          ${i.map(v=>`<th class="num">${wt(v)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${T||`<tr><td class="muted" colspan="${i.length+5}">Keine Produkte gefunden.</td></tr>`}
      </tbody>
    </table>
  `}function Tn(t,e,n,r,l){var $;if(!t||!e||!r)return;const i=String(r.sku||"").trim(),s=zt(e,i),o=($=n==null?void 0:n.items)==null?void 0:$.find(P=>String(P.sku||"").trim()===i),f=Number(s.amazonUnits||0)+Number(s.threePLUnits||0),m=((o==null?void 0:o.amazonUnits)||0)+((o==null?void 0:o.threePLUnits)||0),p=f-m,b=t.querySelector(".inventory-in-transit"),S=X((b==null?void 0:b.textContent)||0),g=f+(Number.isFinite(S)?S:0),M=Ot(r,l.settings||{}),A=Number.isFinite(M)?g*M:null,T=t.querySelector('[data-field="totalUnits"]'),N=t.querySelector('[data-field="delta"]'),v=t.querySelector('[data-field="totalValue"]');T&&(T.textContent=C(f)),N&&(N.textContent=C(p)),v&&(v.textContent=Number.isFinite(A)?jt(A):"—")}function V(t){var $t,st,St;const e=nn(),n=gn(),r=window.__routeQuery||{},l=String(r.sku||"").trim(),i=String(r.month||"").trim();l&&(n.search="",n.projectionMode="doh"),/^\d{4}-\d{2}$/.test(i)&&(n.selectedMonth=Wt(i,-1));const s=bn(e,n);n.selectedMonth=s,W(n),t._inventoryCleanup&&(t._inventoryCleanup(),t._inventoryCleanup=null);const o=Gt(e,s)||{month:s,items:[]},f=Bt(e,s),m=Array.isArray(e.productCategories)?e.productCategories:[],p=(e.products||[]).filter(vn),b=mn(n.snapshotAsOfDate),S=b?Ft(b):null;let g=b&&S===s?b:fn(s);g||(g=new Date),(!b||S!==s)&&(n.snapshotAsOfDate=kt(g),W(n));const M=Yt(g);if(l){const a=p.find(d=>String((d==null?void 0:d.sku)||"").trim()===l);(a==null?void 0:a.categoryId)!=null&&(n.collapsed[String(a.categoryId)]=!1,W(n))}const A=Number(((st=($t=e.inventory)==null?void 0:$t.settings)==null?void 0:st.projectionMonths)||12),T=[6,12,18],N=un(s,T.includes(A)?A:12),v=n.projectionMode==="plan",$=Mn({state:e,view:n,snapshot:o,products:p,categories:m,asOfDate:M}),P=$.missingEk.length;t.innerHTML=`
    <section class="card inventory-card">
      <div class="inventory-header">
        <div>
          <h2>Inventory</h2>
          <p class="muted">Month-end Snapshots und Bestandsplanung. Lokal gespeichert.</p>
        </div>
        <div class="inventory-search">
          <input type="search" placeholder="SKU oder Alias suchen" value="${h(n.search)}" />
        </div>
      </div>
      <div class="inventory-toolbar">
        <label class="inventory-field">
          <span class="muted">Snapshot Monat</span>
          <select id="inventory-month"></select>
        </label>
        <button class="btn secondary" id="inventory-copy">Copy from previous month</button>
        <button class="btn secondary" id="inventory-expand-all">Alles aufklappen</button>
        <button class="btn secondary" id="inventory-collapse-all">Alles zuklappen</button>
        <span class="muted small">${f?`Vorheriger Snapshot: ${wt(f.month)}`:"Kein vorheriger Snapshot vorhanden."}</span>
      </div>
      <div class="inventory-export">
        <div class="inventory-export-controls">
          <label class="inventory-field">
            <span class="muted">Bestandsaufnahme zum</span>
            <input type="date" id="inventory-export-date" value="${h(kt(g))}" />
          </label>
          <button class="btn secondary" id="inventory-export-csv">Export CSV</button>
          <button class="btn secondary" id="inventory-export-pdf">Export PDF</button>
        </div>
        <div class="inventory-export-meta">
          <span class="muted small">Export für Buchführung: SKU, Bestände, In-Transit, EK-Preis, Warenwert</span>
          ${P?`<span class="inventory-export-warning">⚠︎ EK fehlt (${P})</span>`:""}
        </div>
      </div>
      <div class="inventory-table-wrap">
        <div class="inventory-table-scroll">
          ${Un({state:e,view:n,snapshot:o,previousSnapshot:f,products:p,categories:m,asOfDate:M,snapshotMonth:s})}
        </div>
      </div>
    </section>

    <section class="card inventory-card">
      <div class="inventory-header">
        <div>
          <h3>Projection (next ${T.includes(A)?A:12} months)</h3>
          <p class="muted">End-of-Month verfügbares Lager in DE (Amazon + 3PL).</p>
        </div>
        <div class="inventory-controls">
          <label class="inventory-field">
            <span class="muted">Horizon</span>
            <select id="inventory-horizon">
              ${T.map(a=>`<option value="${a}" ${a===A?"selected":""}>${a} Monate</option>`).join("")}
            </select>
          </label>
          <div class="inventory-toggle-group">
            <span class="muted">Anzeige</span>
            <div class="segment-control">
              <input type="radio" id="inventory-mode-units" name="inventory-mode" value="units" ${n.projectionMode==="units"?"checked":""} />
              <label for="inventory-mode-units">Units</label>
              <input type="radio" id="inventory-mode-doh" name="inventory-mode" value="doh" ${n.projectionMode==="doh"?"checked":""} />
              <label for="inventory-mode-doh">Days on hand</label>
              <input type="radio" id="inventory-mode-plan" name="inventory-mode" value="plan" ${n.projectionMode==="plan"?"checked":""} />
              <label for="inventory-mode-plan">Plan-Absatz</label>
            </div>
          </div>
          <label class="inventory-toggle">
            <input type="checkbox" id="inventory-safety" ${n.showSafety?"checked":""} />
            <span>Show safety threshold</span>
          </label>
        </div>
      </div>
      <div class="inventory-table-wrap">
        <div class="inventory-table-scroll">
          ${Pn({state:e,view:n,snapshot:o,products:p,categories:m,months:N})}
        </div>
      </div>
      <div class="inventory-legend">
        ${v?"":`
          <span class="inventory-legend-item"><span class="legend-swatch safety-negative"></span> Stockout / unter Safety</span>
          <span class="inventory-legend-item"><span class="legend-swatch safety-low"></span> Unter Safety (Units)</span>
        `}
        <span class="inventory-legend-item"><span class="legend-swatch inbound-po"></span> Inbound PO</span>
        <span class="inventory-legend-item"><span class="legend-swatch inbound-fo"></span> Inbound FO</span>
      </div>
    </section>
    <div id="inventory-tooltip-layer" class="inventory-tooltip-layer" hidden></div>
  `;const L=t.querySelector("#inventory-month");if(L){const a=(((St=e.inventory)==null?void 0:St.snapshots)||[]).map(u=>u==null?void 0:u.month).filter(u=>/^\d{4}-\d{2}$/.test(u)),d=new Set([...a,_t(),s]),c=Array.from(d).sort();L.innerHTML=c.map(u=>`<option value="${u}" ${u===s?"selected":""}>${wt(u)}</option>`).join(""),L.addEventListener("change",u=>{n.selectedMonth=u.target.value,W(n),V(t)})}const U=t.querySelector("#inventory-export-date");U&&U.addEventListener("change",a=>{n.snapshotAsOfDate=a.target.value,W(n),V(t)});const x=t.querySelector("#inventory-export-csv");x&&x.addEventListener("click",()=>{if(!$.rows.length){window.alert("Keine Daten für den Export vorhanden.");return}const a=qt(g),d=Ln({title:a,rows:$.rows,totals:$.totals,missingEk:$.missingEk}),c=`bestandsaufnahme_${kt(g)}.csv`,u=new Blob([d],{type:"text/csv"}),y=URL.createObjectURL(u),k=document.createElement("a");k.href=y,k.download=c,document.body.append(k),k.click(),k.remove(),URL.revokeObjectURL(y)});const F=t.querySelector("#inventory-export-pdf");F&&F.addEventListener("click",()=>{if(!$.rows.length){window.alert("Keine Daten für den Export vorhanden.");return}const a=qt(g),d=pn(new Date),c=`bestandsaufnahme_${kt(g)}.pdf`,u=xn({title:a,fileName:c,rows:$.rows,totals:$.totals,missingEk:$.missingEk,generatedAt:d}),y=window.open("","_blank","noopener,noreferrer");y&&(y.document.open(),y.document.write(u),y.document.close())});const R=t.querySelector(".inventory-search input");R&&R.addEventListener("input",a=>{n.search=a.target.value||"",W(n),V(t)});const q=t.querySelector("#inventory-copy");q&&q.addEventListener("click",()=>{const a=Vt(e,s),d=Bt(e,s);a.items=(p||[]).map(c=>{var k;const u=String(c.sku||"").trim(),y=(k=d==null?void 0:d.items)==null?void 0:k.find(z=>String(z.sku||"").trim()===u);return{sku:u,amazonUnits:(y==null?void 0:y.amazonUnits)??0,threePLUnits:(y==null?void 0:y.threePLUnits)??0,note:(y==null?void 0:y.note)??""}}),At(e),V(t)});const H=t.querySelector("#inventory-expand-all");H&&H.addEventListener("click",()=>{Kt({products:p,categories:m,view:n,collapsed:!1}),V(t)});const Y=t.querySelector("#inventory-collapse-all");Y&&Y.addEventListener("click",()=>{Kt({products:p,categories:m,view:n,collapsed:!0}),V(t)});const G=t.querySelector(".inventory-snapshot-table");let Z=null;const ot=()=>{Z&&clearTimeout(Z),Z=setTimeout(()=>{const a=Vt(e,s);a!==o&&(a.items=o.items),At(e)},250)};if(G){const a=c=>{const u=c.closest("tr[data-sku]");if(!u)return null;const y=u.getAttribute("data-sku"),k=p.find(I=>String(I.sku||"").trim()===y);if(!k)return null;const z=zt(o,y),O=c.dataset.field;return{row:u,sku:y,product:k,item:z,field:O}},d=c=>{var dt;const u=a(c);if(!u)return;const{row:y,sku:k,product:z,item:O,field:I}=u;if(I!=="amazonUnits"&&I!=="threePLUnits")return;const at=Dt(s,k,I),it=ht.get(at)??c.value,{value:lt,isRounded:Pt}=hn(it);ht.delete(at),c.value=String(lt),(dt=c.closest("td"))==null||dt.classList.toggle("inventory-input-warn",Pt),I==="amazonUnits"&&(O.amazonUnits=lt),I==="threePLUnits"&&(O.threePLUnits=lt),Tn(y,o,f,z,e),ot()};G.addEventListener("click",c=>{const u=c.target.closest("button.tree-toggle[data-category]");if(!u)return;const y=u.getAttribute("data-category");n.collapsed[y]=!n.collapsed[y],W(n),V(t)}),G.addEventListener("input",c=>{var I;const u=c.target.closest("input.inventory-input");if(!u)return;const y=a(u);if(!y)return;const{sku:k,item:z,field:O}=y;if(O==="note"){z.note=u.value,ot();return}if(O==="amazonUnits"||O==="threePLUnits"){const at=Dt(s,k,O);ht.set(at,u.value),(I=u.closest("td"))==null||I.classList.remove("inventory-input-warn")}}),G.addEventListener("blur",c=>{const u=c.target.closest("input.inventory-input");if(!u)return;const y=a(u);y&&y.field!=="note"&&d(u)},!0),G.addEventListener("keydown",c=>{if(c.key!=="Enter")return;const u=c.target.closest("input.inventory-input");if(!u)return;const y=a(u);!y||y.field==="note"||(c.preventDefault(),d(u))})}const tt=t.querySelector(".inventory-projection-table");tt&&(tt.addEventListener("click",a=>{const d=a.target.closest("button.tree-toggle[data-category]");if(!d)return;const c=d.getAttribute("data-category");n.collapsed[c]=!n.collapsed[c],W(n),V(t)}),tt.addEventListener("click",a=>{if(a.target.closest("button.tree-toggle[data-category]"))return;const c=a.target.closest("td.inventory-projection-cell");if(!c)return;const u=c.closest("tr[data-sku]");if(!u)return;const y=u.getAttribute("data-sku"),k=c.getAttribute("data-month");!y||!k||(a.stopPropagation(),Lt(c,{sku:y,month:k}))}));const E=t.querySelector("#inventory-tooltip-layer");let K=null,j=null,w=null;function D(a){if(!E||E.hidden)return;const d=12,c=window.innerWidth-E.offsetWidth-8,u=window.innerHeight-E.offsetHeight-8,y=Math.min(a.clientX+d,c),k=Math.min(a.clientY+d,u);E.style.left=`${Math.max(8,y)}px`,E.style.top=`${Math.max(8,k)}px`}function yt(a,d,c){if(!E||!d)return;let u=d;try{u=decodeURIComponent(d)}catch{u=d}E.innerHTML=u,E.hidden=!1,E.classList.add("is-visible"),K=a,D(c)}function nt(){E&&(E.hidden=!0,E.classList.remove("is-visible"),E.innerHTML="",K=null)}function Q(){j&&j.remove(),j=null,w=null}function Mt(a){if(!j||!a)return;const d=a.getBoundingClientRect(),c=8,u=window.innerWidth-j.offsetWidth-c,y=window.innerHeight-j.offsetHeight-c,k=Math.min(d.left,u),z=Math.min(d.bottom+6,y);j.style.left=`${Math.max(c,k)}px`,j.style.top=`${Math.max(c,z)}px`}function Lt(a,{sku:d,month:c}){var lt;if(!a||!d||!c)return;if(w===a&&j){Q();return}Q();const u=((lt=e.settings)==null?void 0:lt.monthAnchorDay)||"START",y=Sn(c,u),k=kn(y),z=pt(y),O=dn(c),I=yn(e,d,c),at=Number.isFinite(I)?`<div class="inventory-cell-popover-meta">Plan-Absatz in diesem Monat: ${C(I)}</div>`:"",it=document.createElement("div");it.className="inventory-cell-popover",it.innerHTML=`
      <div class="inventory-cell-popover-title">Aktion für ${h(d)}</div>
      ${at}
      <button class="inventory-cell-popover-action" type="button" data-action="fo">
        FO erstellen – Ankunft in ${h(O)} <span class="muted">(Anker: ${h(z)})</span>
      </button>
      <button class="inventory-cell-popover-action" type="button" data-action="po">
        PO erstellen – Bestellung in ${h(O)} <span class="muted">(Anker: ${h(z)})</span>
      </button>
      <button class="inventory-cell-popover-action" type="button" data-action="po-arrival">
        PO rückwärts – Ankunft in ${h(O)} <span class="muted">(Anker: ${h(z)})</span>
      </button>
    `,it.addEventListener("click",Pt=>{const dt=Pt.target.closest("button[data-action]");if(!dt)return;const Tt=dt.dataset.action,_=new URLSearchParams;_.set("create","1"),_.set("sku",d),_.set("anchorMonth",c),_.set("anchorDate",k),Tt==="fo"?(_.set("target",k),location.hash=`#fo?${_.toString()}`):Tt==="po"?(_.set("orderDate",k),_.set("anchorMode","order"),location.hash=`#po?${_.toString()}`):Tt==="po-arrival"&&(_.set("anchorMode","arrival"),location.hash=`#po?${_.toString()}`),Q()}),document.body.appendChild(it),j=it,w=a,Mt(a)}t.addEventListener("mouseover",a=>{const d=a.target.closest("[data-tooltip-html]");if(!d||d===K)return;const c=d.getAttribute("data-tooltip-html");c&&yt(d,c,a)}),t.addEventListener("mousemove",a=>{K&&D(a)}),t.addEventListener("mouseout",a=>{if(!K||a.relatedTarget&&E&&E.contains(a.relatedTarget))return;const d=a.target.closest("[data-tooltip-html]");d&&d===K&&nt()}),E&&E.addEventListener("mouseleave",()=>{nt()});const vt=a=>{if(!j||j.contains(a.target))return;const d=a.target.closest("td.inventory-projection-cell");d&&w===d||Q()},J=a=>{a.key==="Escape"&&Q()};document.addEventListener("click",vt),document.addEventListener("keydown",J);const et=t.querySelector(".inventory-table-scroll"),rt=()=>Q();et&&et.addEventListener("scroll",rt),t.addEventListener("click",a=>{const d=a.target.closest(".inventory-link");if(!d)return;const c=d.getAttribute("data-route"),u=d.getAttribute("data-open");if(!c||!u)return;const y=new URLSearchParams;y.set("open",u),location.hash=`${c}?${y.toString()}`});const gt=t.querySelector("#inventory-horizon");gt&&gt.addEventListener("change",a=>{const d=Number(a.target.value||12);e.inventory||(e.inventory={snapshots:[],settings:{}}),e.inventory.settings||(e.inventory.settings={}),e.inventory.settings.projectionMonths=d,At(e),V(t)});const bt=t.querySelector("#inventory-safety");bt&&bt.addEventListener("change",a=>{n.showSafety=a.target.checked,W(n),V(t)}),t.querySelectorAll("input[name='inventory-mode']").forEach(a=>{a.addEventListener("change",d=>{const c=d.target.value;n.projectionMode=c==="doh"||c==="plan"?c:"units",W(n),V(t)})});function xt(){if(!l)return;const a=Rt(l),d=/^\d{4}-\d{2}$/.test(i)?`[data-month="${Rt(i)}"]`:"[data-month]",c=t.querySelector(`.inventory-projection-table tr[data-sku="${a}"] td${d}`),u=c?c.closest("tr[data-sku]"):t.querySelector(`.inventory-projection-table tr[data-sku="${a}"]`);u&&u.classList.add("row-focus"),c?(c.classList.add("cell-focus"),c.scrollIntoView({behavior:"smooth",block:"center",inline:"center"})):u&&u.scrollIntoView({behavior:"smooth",block:"center"}),window.__routeQuery={}}xt(),t._inventoryCleanup=()=>{document.removeEventListener("click",vt),document.removeEventListener("keydown",J),et&&et.removeEventListener("scroll",rt),Q()}}const zn={render:V};export{zn as default,V as render};
