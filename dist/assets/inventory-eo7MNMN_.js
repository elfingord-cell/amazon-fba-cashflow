import{l as cn,c as Qt,a as dn,b as un}from"./store-se7FKMzU.js";import{k as vt}from"./index-CKhyr0oQ.js";import{b as mn}from"./abcClassification-OyCi4s0h.js";import{c as Oe,r as hn,a as fn,g as Ve}from"./inventoryProjection-COGreoXP.js";const Ie="inventory_view_v1";function h(t){return String(t??"").replace(/[&<>"']/g,n=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[n])}function Pe(t){return typeof CSS<"u"&&typeof CSS.escape=="function"?CSS.escape(t):String(t).replace(/["\\]/g,"\\$&")}function Be(){const t=new Date;return`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}`}function Kt(t){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[n,e]=t.split("-").map(Number);return n*12+(e-1)}function Ke(t,n){const[e,o]=t.split("-").map(Number),l=e*12+(o-1)+n,i=Math.floor(l/12),s=l%12+1;return`${i}-${String(s).padStart(2,"0")}`}function pn(t,n){return Array.from({length:n},(e,o)=>Ke(t,o+1))}function Rt(t){if(!t)return"—";const[n,e]=t.split("-");return`${e}-${n}`}function ce(t){if(!t)return"—";const[n,e]=t.split("-");return`${e}/${n}`}function Zt(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return"";const n=t.getFullYear(),e=String(t.getMonth()+1).padStart(2,"0"),o=String(t.getDate()).padStart(2,"0");return`${n}-${e}-${o}`}function yn(t){if(!t)return null;const n=new Date(`${t}T00:00:00`);return Number.isNaN(n.getTime())?null:n}function vn(t){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[n,e]=t.split("-").map(Number);return new Date(n,e,0)}function me(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return null;const n=new Date(t.getTime());return n.setHours(23,59,59,999),n}function Ae(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"Bestandsaufnahme":`Bestandsaufnahme zum ${qt(t)}`}function gn(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return"—";const n=t.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}),e=t.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});return`${n} ${e}`}function bn(t){if(t==null||t==="")return{value:0,isRounded:!1};const n=vt(String(t));if(!Number.isFinite(n))return{value:0,isRounded:!1};const e=Math.round(n);return{value:e,isRounded:e!==n}}function Re(t,n,e){var f,E,b,S,U,v,w;const o=ne(e);if(!o)return null;const l=(b=(E=(f=t==null?void 0:t.forecast)==null?void 0:f.forecastManual)==null?void 0:E[n])==null?void 0:b[o],i=vt(l);if(Number.isFinite(i))return i;const s=(w=(v=(U=(S=t==null?void 0:t.forecast)==null?void 0:S.forecastImport)==null?void 0:U[n])==null?void 0:v[o])==null?void 0:w.units,u=vt(s);return Number.isFinite(u)?u:null}function K(t){return t==null||!Number.isFinite(Number(t))?"—":Math.round(Number(t)).toLocaleString("de-DE",{maximumFractionDigits:0})}function le(t,n,e){return Math.min(e,Math.max(n,t))}function Wt(t,n){const e=String(n||"").trim().toLowerCase();return e?t.filter(o=>String(o.alias||"").toLowerCase().includes(e)||String(o.sku||"").toLowerCase().includes(e)):t}function $n(t){if(!t)return!1;if(typeof t.active=="boolean")return t.active;const n=String(t.status||"").trim().toLowerCase();return n?n==="active"||n==="aktiv":!0}function ee(t,n=[]){const e=new Map;t.forEach(s=>{const u=s.categoryId?String(s.categoryId):"";e.has(u)||e.set(u,[]),e.get(u).push(s)});const l=n.slice().sort((s,u)=>{const f=Number.isFinite(s.sortOrder)?s.sortOrder:0,E=Number.isFinite(u.sortOrder)?u.sortOrder:0;return f-E||String(s.name||"").localeCompare(String(u.name||""))}).map(s=>({id:String(s.id),name:s.name||"Ohne Kategorie",items:e.get(String(s.id))||[]})),i=e.get("")||[];return i.length&&l.push({id:"uncategorized",name:"Ohne Kategorie",items:i}),l.filter(s=>s.items.length)}function wn(){const t=dn(Ie,{}),n=t.projectionMode==="doh"||t.projectionMode==="plan"?t.projectionMode:"units",e=t.snapshotViewMode==="eur"?"eur":"units";return{selectedMonth:t.selectedMonth||null,collapsed:t.collapsed&&typeof t.collapsed=="object"?t.collapsed:{},search:t.search||"",showSafety:t.showSafety!==!1,projectionMode:n,snapshotAsOfDate:t.snapshotAsOfDate||"",snapshotViewMode:e}}function rt(t){un(Ie,t)}function En(t,n){var s;const e=(((s=t.inventory)==null?void 0:s.snapshots)||[]).map(u=>u==null?void 0:u.month).filter(u=>/^\d{4}-\d{2}$/.test(u)).sort(),o=e[e.length-1],l=Be(),i=n.selectedMonth||o||l;return i||l}function Le({products:t,categories:n,view:e,collapsed:o}){const l=Wt(t,e.search),i=ee(l,n),s={...e.collapsed};i.forEach(u=>{s[u.id]=o}),e.collapsed=s,rt(e)}function ne(t){if(!t)return null;const n=String(t);if(/^\d{4}-\d{2}$/.test(n))return n;const e=n.match(/^(\d{2})-(\d{4})$/);return e?`${e[2]}-${e[1]}`:n}function He(t,n){var e;return(((e=t.inventory)==null?void 0:e.snapshots)||[]).find(o=>(o==null?void 0:o.month)===n)||null}function Ce(t,n){const e=He(t,n);if(e)return e;const o={month:n,items:[]};return t.inventory||(t.inventory={snapshots:[],settings:{}}),Array.isArray(t.inventory.snapshots)||(t.inventory.snapshots=[]),t.inventory.snapshots.push(o),o}function he(t,n){if(!t||!n)return null;Array.isArray(t.items)||(t.items=[]);let e=t.items.find(o=>String(o.sku||"").trim()===n);return e||(e={sku:n,amazonUnits:0,threePLUnits:0,note:""},t.items.push(e)),e}function je(t,n){var i;const e=Kt(n);if(e==null)return null;const o=(((i=t.inventory)==null?void 0:i.snapshots)||[]).filter(s=>(s==null?void 0:s.month)&&Kt(s.month)!=null).slice().sort((s,u)=>Kt(s.month)-Kt(u.month));let l=null;return o.forEach(s=>{const u=Kt(s.month);u!=null&&u<e&&(l=s)}),l}function Jt(t,n){if(!n)return"—";const o=(Array.isArray(t.suppliers)?t.suppliers:[]).find(l=>String(l.id||"")===String(n));return(o==null?void 0:o.name)||n||"—"}function ht(t){if(!t)return null;const n=new Date(t);return Number.isNaN(n.getTime())?null:n}function de(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?null:`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}`}function fe(t){const n=ht((t==null?void 0:t.etaManual)||(t==null?void 0:t.etaDate)||(t==null?void 0:t.eta));if(n)return n;const e=ht(t==null?void 0:t.etaComputed);if(e)return e;const o=ht(t==null?void 0:t.orderDate);if(!o)return null;const l=Number((t==null?void 0:t.prodDays)||0),i=Number((t==null?void 0:t.transitDays)||0),s=new Date(o.getTime());return s.setDate(s.getDate()+Math.max(0,l+i)),s}function kn(t){return ht((t==null?void 0:t.targetDeliveryDate)||(t==null?void 0:t.deliveryDate)||(t==null?void 0:t.etaDate))}function Sn(t){const n=String((t==null?void 0:t.status)||"").toUpperCase();return!(n==="CONVERTED"||n==="CANCELLED")}function xn(t,n,e){const o=e.map(i=>ne(i)).filter(Boolean),l=new Map;return t.forEach(i=>{const s=new Map;o.forEach(u=>{let f=0,E=!1;i.items.forEach(b=>{var v;const S=String((b==null?void 0:b.sku)||"").trim();if(!S)return;const U=(v=n.get(S))==null?void 0:v.get(u);Number.isFinite(U)&&(f+=U,E=!0)}),E&&s.set(u,f)}),l.set(i.id,s)}),l}function _t(t,n){var i;const e=((i=t==null?void 0:t.template)==null?void 0:i.fields)||(t==null?void 0:t.template)||{},o=vt(e.unitPriceUsd??(t==null?void 0:t.unitPriceUsd)??null);if(!Number.isFinite(o))return null;const l=String(e.currency||(n==null?void 0:n.defaultCurrency)||"EUR").toUpperCase();if(l==="EUR")return o;if(l==="USD"){const s=vt(n==null?void 0:n.fxRate);return!Number.isFinite(s)||s<=0?null:o/s}return null}function W(t){return t==null||!Number.isFinite(Number(t))?"—":Number(t).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function qt(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"—":t.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"})}function Mn(t,n){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[e,o]=t.split("-").map(Number);if(!Number.isFinite(e)||!Number.isFinite(o))return null;const l=String(n).toUpperCase();let i=1;return l==="MID"&&(i=15),l==="END"&&(i=new Date(e,o,0).getDate()),new Date(Date.UTC(e,o-1,i))}function Dn(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"—":t.toISOString().slice(0,10)}function Un(t){const n=ht((t==null?void 0:t.etdManual)||(t==null?void 0:t.etdDate));if(n)return n;const e=ht(t==null?void 0:t.orderDate);if(!e)return null;const o=Number((t==null?void 0:t.prodDays)||0),l=new Date(e.getTime());return l.setDate(l.getDate()+Math.max(0,o)),l}function pe(t){const n=new Map,e=new Set;function o(i,s){n.has(i)||n.set(i,new Map);const u=n.get(i);return u.has(s)||u.set(s,{events:[],hasPo:!1,hasFo:!1,poUnits:0,foUnits:0}),u.get(s)}function l(i,s,u){const f=o(i,s),E=f.events.find(b=>b.type===u.type&&b.id===u.id);E?E.qty+=u.qty:f.events.push({...u}),u.type==="PO"&&(f.hasPo=!0,f.poUnits+=u.qty),u.type==="FO"&&(f.hasFo=!0,f.foUnits+=u.qty)}return(t.pos||[]).forEach(i=>{if(!i||String(i.status||"").toUpperCase()==="CANCELLED")return;const s=Array.isArray(i.items)&&i.items.length?i.items:[{sku:i.sku,units:i.units}],f=ht(i.arrivalDate)||fe(i),E=f?de(f):null;s.forEach(b=>{const S=String((b==null?void 0:b.sku)||"").trim();if(!S)return;const U=vt((b==null?void 0:b.units)??0),v=Number.isFinite(U)?Math.round(U):0;if(!E){e.add(S);return}l(S,E,{type:"PO",id:String(i.id||i.poNo||S),label:i.poNo||i.id||"PO",supplier:Jt(t,i.supplierId||i.supplier),qty:v,date:f?f.toISOString().slice(0,10):"—",route:"#po",open:i.id||i.poNo||""})})}),(t.fos||[]).forEach(i=>{if(!i||!Sn(i))return;const s=Array.isArray(i.items)&&i.items.length?i.items:[{sku:i.sku,units:i.units}],f=ht(i.arrivalDate)||kn(i),E=f?de(f):null;E&&s.forEach(b=>{const S=String((b==null?void 0:b.sku)||"").trim();if(!S)return;const U=vt((b==null?void 0:b.units)??0),v=Number.isFinite(U)?Math.round(U):0;l(S,E,{type:"FO",id:String(i.id||i.foNo||S),label:i.foNo||i.id||"FO",supplier:Jt(t,i.supplierId||i.supplier),qty:v,date:f?f.toISOString().slice(0,10):"—",route:"#fo",open:i.id||i.foNo||""})})}),{inboundMap:n,missingEtaSkus:e}}function Nn({state:t,currentSnapshot:n,previousSnapshot:e,products:o,categories:l,currentMonth:i,asOfDate:s}){const u=t.settings||{},f=new Map;o.forEach(p=>{const g=String((p==null?void 0:p.sku)||"").trim();g&&f.set(g,p)});const E=new Map;(l||[]).forEach(p=>{(p==null?void 0:p.id)!=null&&E.set(String(p.id),p.name||"Ohne Kategorie")});const b=p=>{const g=(p==null?void 0:p.categoryId)!=null?String(p.categoryId):"";return g?{id:g,name:E.get(g)||"Ohne Kategorie"}:{id:"uncategorized",name:"Ohne Kategorie"}},S=p=>{const g=f.get(p);return _t(g,u)},U=()=>({measuredPrev:0,measuredCurr:0,inboundEur:0,salesEur:0,hasMissingEk:!1}),v=new Map,w=(p,g)=>(v.has(p)||v.set(p,{id:p,name:g,...U()}),v.get(p)),F=(p,g)=>{p&&(p.items||[]).forEach(M=>{const $=String(M.sku||"").trim();if(!$)return;const C=f.get($);if(!C)return;const P=Number(M.amazonUnits||0)+Number(M.threePLUnits||0),I=S($),Z=b(C),_=w(Z.id,Z.name);if(!Number.isFinite(I)){_.hasMissingEk=!0;return}_[g]+=P*I})};F(e,"measuredPrev"),F(n,"measuredCurr");const N=ne(i),{inboundMap:z}=pe(t);z.forEach((p,g)=>{const M=p.get(N);if(!M)return;const $=(M.poUnits||0)+(M.foUnits||0);if(!$)return;const C=f.get(g);if(!C)return;const P=S(g),I=b(C),Z=w(I.id,I.name);if(!Number.isFinite(P)){Z.hasMissingEk=!0;return}Z.inboundEur+=$*P}),o.forEach(p=>{const g=String((p==null?void 0:p.sku)||"").trim();if(!g)return;const M=Re(t,g,N);if(!Number.isFinite(M)||!M)return;const $=S(g),C=b(p),P=w(C.id,C.name);if(!Number.isFinite($)){P.hasMissingEk=!0;return}P.salesEur+=M*$});const q=Array.from(v.values()).map(p=>{const g=p.measuredCurr-p.measuredPrev,M=p.inboundEur-p.salesEur;return{...p,measuredDelta:g,expectedDelta:M,discrepancy:g-M}}).sort((p,g)=>Math.abs(g.discrepancy)-Math.abs(p.discrepancy)),Q=q.reduce((p,g)=>(p.measuredPrev+=g.measuredPrev,p.measuredCurr+=g.measuredCurr,p.measuredDelta+=g.measuredDelta,p.inboundEur+=g.inboundEur,p.salesEur+=g.salesEur,p.expectedDelta+=g.expectedDelta,p.discrepancy+=g.discrepancy,g.hasMissingEk&&(p.hasMissingEk=!0),p),{measuredPrev:0,measuredCurr:0,measuredDelta:0,inboundEur:0,salesEur:0,expectedDelta:0,discrepancy:0,hasMissingEk:!1});return{currentMonth:N,previousMonth:(e==null?void 0:e.month)||null,perCategory:q,totals:Q,forecastIsSurrogate:!0}}function Fn(t,n){const e=me(n)||new Date,o=t.settings||{},l=new Map;(t.products||[]).forEach(s=>{const u=String((s==null?void 0:s.sku)||"").trim();u&&l.set(u,s)});const i=[];return(t.pos||[]).forEach(s=>{if(!s||s.archived)return;const u=String(s.status||"").toUpperCase();if(u==="CANCELLED"||u==="ARRIVED"||u==="RECEIVED")return;const f=fe(s);if(!f||f>e)return;const E=Array.isArray(s.items)&&s.items.length?s.items:[{sku:s.sku,units:s.units}];let b=0,S=0,U=!1;E.forEach(v=>{const w=String((v==null?void 0:v.sku)||"").trim();if(!w)return;const F=Math.round(vt((v==null?void 0:v.units)??0)||0);b+=F;const N=l.get(w),z=_t(N,o);if(!Number.isFinite(z)){U=!0;return}S+=F*z}),i.push({id:s.id||s.poNo||"",label:s.poNo||s.id||"PO",supplier:Jt(t,s.supplierId||s.supplier),etaDate:f,etaLabel:qt(f),ageDays:Math.max(0,Math.round((e-f)/(24*60*60*1e3))),units:b,valueEur:S,hasMissingEk:U})}),i.sort((s,u)=>u.ageDays-s.ageDays),i}function qe(t,n){const e=new Map,o=new Date,l=me(n)||o,i=(s,u)=>{e.has(s)||e.set(s,{total:0,entries:[]});const f=e.get(s);f.total+=u.qty,f.entries.push(u)};return(t.pos||[]).forEach(s=>{if(!s||s.archived||String(s.status||"").toUpperCase()==="CANCELLED")return;const u=ht(s.orderDate);if(u&&u>l)return;const f=ht(s.arrivalDate)||ht(s.etaManual)||fe(s);if(f&&f<=l)return;const E=Un(s);(Array.isArray(s.items)&&s.items.length?s.items:[{sku:s.sku,units:s.units}]).forEach(S=>{const U=String((S==null?void 0:S.sku)||"").trim();if(!U)return;const v=vt((S==null?void 0:S.units)??0),w=Number.isFinite(v)?Math.round(v):0;w&&i(U,{type:"PO",id:String(s.id||s.poNo||U),label:s.poNo||s.id||"PO",supplier:Jt(t,s.supplierId||s.supplier),qty:w,etd:E?qt(E):"—",eta:f?qt(f):"—",route:"#po",open:s.id||s.poNo||""})})}),e}function Tn({alias:t,month:n,events:e}){if(!e||!e.length)return"";const o=e.map(l=>`
    <div class="inventory-tooltip-row">
      <div>
        <strong>${h(l.type)} ${h(l.label)}</strong>
        <div class="muted">${h(l.supplier||"—")}</div>
      </div>
      <div class="inventory-tooltip-meta">
        <div>${K(l.qty)}</div>
        <div class="muted">${h(l.date||"—")}</div>
      </div>
    </div>
    <div class="inventory-tooltip-actions">
      <button class="btn sm secondary inventory-link" type="button" data-route="${l.route}" data-open="${h(l.open)}">${l.type==="FO"?"Open FO":"Open PO"}</button>
    </div>
  `).join("");return`
    <div class="inventory-tooltip">
      <div class="inventory-tooltip-header">
        <div class="inventory-tooltip-title">Inbound arrivals in ${Rt(n)}</div>
        <div class="inventory-tooltip-alias">${h(t)}</div>
      </div>
      <div class="inventory-tooltip-body">${o}</div>
    </div>
  `}function Pn({alias:t,entries:n}){if(!n||!n.length)return"";const e=n.map(o=>`
    <div class="inventory-tooltip-row">
      <div>
        <strong>${h(o.type)} ${h(o.label)}</strong>
        <div class="muted">${h(o.supplier||"—")}</div>
      </div>
      <div class="inventory-tooltip-meta">
        <div>${K(o.qty)}</div>
        <div class="muted">ETD ${h(o.etd)} · ETA ${h(o.eta)}</div>
      </div>
    </div>
    <div class="inventory-tooltip-actions">
      <button class="btn sm secondary inventory-link" type="button" data-route="${o.route}" data-open="${h(o.open)}">Open ${o.type}</button>
    </div>
  `).join("");return`
    <div class="inventory-tooltip">
      <div class="inventory-tooltip-header">
        <div class="inventory-tooltip-title">In Transit</div>
        <div class="inventory-tooltip-alias">${h(t||"—")}</div>
      </div>
      <div class="inventory-tooltip-body">${e}</div>
    </div>
  `}function ue(t){return encodeURIComponent(t||"")}const Ht=new Map;function te(t,n,e){return`${t||"unknown"}:${n}:${e}`}function Et(t){if(t==null||!Number.isFinite(Number(t)))return"—";const n=Number(t);return`${n>0?"+":n<0?"−":""}${W(Math.abs(n))}`}function ze(t,n){const e=t-n,o=Math.abs(e),l=Math.max(Math.abs(t),Math.abs(n),1),i=o/l;return o<500?"ok":o<2e3?i<.5?"ok":"warn":i<.3?"ok":i<.6?"warn":"bad"}function An({reconciliation:t,stalePos:n,currentMonth:e,previousMonth:o}){const l=t.totals,i=ze(l.measuredDelta,l.expectedDelta),s=i==="ok"?"Plausibel":i==="warn"?"Auffällig":"Stark abweichend",u=`reco-status-${i}`,f=e?ce(e):"—",E=o?ce(o):"—",b=l.hasMissingEk?'<span class="cell-warning" title="Mindestens ein Produkt ohne EK">⚠︎ EK fehlt teils</span>':"",S=t.perCategory.length?t.perCategory.map(v=>`
          <tr class="reco-cat-row reco-cat-${ze(v.measuredDelta,v.expectedDelta)}">
            <td>${h(v.name)}${v.hasMissingEk?' <span class="cell-warning" title="EK fehlt">⚠︎</span>':""}</td>
            <td class="num">${W(v.measuredPrev)}</td>
            <td class="num">${W(v.measuredCurr)}</td>
            <td class="num"><strong>${Et(v.measuredDelta)}</strong></td>
            <td class="num">${W(v.inboundEur)}</td>
            <td class="num">${W(v.salesEur)}</td>
            <td class="num"><strong>${Et(v.expectedDelta)}</strong></td>
            <td class="num"><strong>${Et(v.discrepancy)}</strong></td>
          </tr>
        `).join(""):'<tr><td class="muted" colspan="8">Keine Kategorie-Daten verfügbar.</td></tr>',U=n.length?`
      <div class="reco-stale">
        <div class="reco-stale-head">
          <div>
            <h4>${n.length} PO${n.length===1?"":"s"} mit überfälliger ETA — Verbleib klären</h4>
            <p class="muted small">ETA liegt vor dem Snapshot-Stichtag, aber Status ist noch OPEN. Mögliche Ursachen: (a) Ware bereits im Bestand verbucht, PO nicht abgeschlossen → Doppelzählung im Warenwert; (b) Ware verspätet → ETA korrigieren; (c) PO storniert / vergessen → archivieren.</p>
          </div>
          <button class="btn secondary" id="reco-archive-all">Alle archivieren (${n.length})</button>
        </div>
        <table class="table-compact ui-table-standard reco-stale-table">
          <thead>
            <tr>
              <th>PO</th>
              <th>Lieferant</th>
              <th class="num">ETA</th>
              <th class="num">Alter (Tage)</th>
              <th class="num">Units</th>
              <th class="num">Warenwert €</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${n.map(v=>`
              <tr data-stale-po="${h(v.id)}">
                <td>${h(v.label)}</td>
                <td>${h(v.supplier||"—")}</td>
                <td class="num">${h(v.etaLabel)}</td>
                <td class="num">${K(v.ageDays)}</td>
                <td class="num">${K(v.units)}</td>
                <td class="num">${v.hasMissingEk?"⚠︎ ":""}${W(v.valueEur)}</td>
                <td><button class="btn sm secondary reco-archive-one" data-po-id="${h(v.id)}">Archivieren</button></td>
              </tr>
            `).join("")}
            <tr class="reco-stale-total">
              <td colspan="4"><strong>Summe offener Volumen</strong></td>
              <td class="num"><strong>${K(n.reduce((v,w)=>v+w.units,0))}</strong></td>
              <td class="num"><strong>${W(n.reduce((v,w)=>v+(Number.isFinite(w.valueEur)?w.valueEur:0),0))}</strong></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    `:'<div class="reco-stale-empty muted small">✓ Keine alten POs mit überfälliger ETA. In-Transit-Wert sollte sauber sein.</div>';return`
    <div class="reco-panel ${u}">
      <div class="reco-head">
        <div>
          <h3>Plausi-Check ${h(E)} → ${h(f)}</h3>
          <p class="muted small">
            Vergleicht die gemessene Bestandsveränderung (Snapshot-Δ in EUR, ohne In-Transit) gegen die erwartete (PO/FO-Eingänge − Verkaufs-Forecast).
            Verkäufe geschätzt aus Forecast — echte Sales-Daten fehlen.
          </p>
        </div>
        <div class="reco-status-pill">${h(s)} ${b}</div>
      </div>
      <div class="reco-headline-grid">
        <div class="reco-kpi">
          <span class="muted small">Bestandsveränderung gemessen</span>
          <strong class="reco-kpi-value">${Et(l.measuredDelta)}</strong>
          <span class="muted small">${W(l.measuredPrev)} → ${W(l.measuredCurr)}</span>
        </div>
        <div class="reco-kpi">
          <span class="muted small">Erwartete Veränderung</span>
          <strong class="reco-kpi-value">${Et(l.expectedDelta)}</strong>
          <span class="muted small">Wareneingänge ${W(l.inboundEur)} − Verkäufe ${W(l.salesEur)}</span>
        </div>
        <div class="reco-kpi reco-kpi-diff">
          <span class="muted small">Diskrepanz (Phantom-Bestand)</span>
          <strong class="reco-kpi-value">${Et(l.discrepancy)}</strong>
          <span class="muted small">Δ gemessen − Δ erwartet</span>
        </div>
      </div>
      <details class="reco-breakdown" ${i==="ok"?"":"open"}>
        <summary>Aufschlüsselung pro Kategorie (sortiert nach Diskrepanz)</summary>
        <table class="table-compact ui-table-standard reco-category-table">
          <thead>
            <tr>
              <th>Kategorie</th>
              <th class="num">Bestand ${h(E)} €</th>
              <th class="num">Bestand ${h(f)} €</th>
              <th class="num">Δ gemessen €</th>
              <th class="num">Wareneingänge €</th>
              <th class="num">Verkäufe (FC) €</th>
              <th class="num">Δ erwartet €</th>
              <th class="num">Diskrepanz €</th>
            </tr>
          </thead>
          <tbody>
            ${S}
            <tr class="reco-cat-total">
              <td><strong>Gesamt</strong></td>
              <td class="num"><strong>${W(l.measuredPrev)}</strong></td>
              <td class="num"><strong>${W(l.measuredCurr)}</strong></td>
              <td class="num"><strong>${Et(l.measuredDelta)}</strong></td>
              <td class="num"><strong>${W(l.inboundEur)}</strong></td>
              <td class="num"><strong>${W(l.salesEur)}</strong></td>
              <td class="num"><strong>${Et(l.expectedDelta)}</strong></td>
              <td class="num"><strong>${Et(l.discrepancy)}</strong></td>
            </tr>
          </tbody>
        </table>
      </details>
      ${U}
    </div>
  `}function Ln({state:t,view:n,snapshot:e,previousSnapshot:o,products:l,categories:i,asOfDate:s,snapshotMonth:u}){const f=Wt(l,n.search),E=n.snapshotViewMode==="eur"?"eur":"units",b=E==="eur",S=ee(f,i),U=new Map;((o==null?void 0:o.items)||[]).forEach(g=>{const M=String(g.sku||"").trim();M&&U.set(M,g)});const v=qe(t,s),w={amazonUnits:0,threePLUnits:0,totalUnits:0,inTransit:0,totalValue:0,amazonEur:0,threePlEur:0,totalEur:0,inTransitEur:0,deltaUnits:0,deltaEur:0,valueComplete:!0},F=g=>K(g),N=g=>Number.isFinite(g)?W(g):"—",z=S.map(g=>{const M=n.collapsed[g.id],$={amazonUnits:0,threePLUnits:0,totalUnits:0,inTransit:0,totalValue:0,amazonEur:0,threePlEur:0,totalEur:0,inTransitEur:0,deltaUnits:0,deltaEur:0,valueComplete:!0},C=g.items.map(_=>{const Y=String(_.sku||"").trim(),B=he(e,Y),ft=v.get(Y),gt=ft?ft.total:0,lt=U.get(Y),kt=Number((B==null?void 0:B.amazonUnits)||0),St=Number((B==null?void 0:B.threePLUnits)||0),ct=kt+St,nt=ct+gt,xt=((lt==null?void 0:lt.amazonUnits)||0)+((lt==null?void 0:lt.threePLUnits)||0),j=ct-xt,x=_t(_,t.settings||{}),O=Number.isFinite(x)?nt*x:null,tt=Number.isFinite(x)?kt*x:null,G=Number.isFinite(x)?St*x:null,bt=Number.isFinite(x)?ct*x:null,$t=Number.isFinite(x)?gt*x:null,J=Number.isFinite(x)?j*x:null,R=!Number.isFinite(x),dt=ft&&ft.entries.length?Pn({alias:_.alias||Y,entries:ft.entries}):"";$.amazonUnits+=kt,$.threePLUnits+=St,$.totalUnits+=ct,$.inTransit+=gt,$.deltaUnits+=j,R?$.valueComplete=!1:($.totalValue+=O,$.amazonEur+=tt,$.threePlEur+=G,$.totalEur+=bt,$.inTransitEur+=$t,$.deltaEur+=J);const Ut=Ht.get(te(u,Y,"amazonUnits")),Mt=Ht.get(te(u,Y,"threePLUnits")),ut=b?`<td class="num inventory-value" data-field="amazonEur">${N(tt)}</td>`:`<td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="amazonUnits" value="${h(Ut??String((B==null?void 0:B.amazonUnits)??0))}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>`,Ct=b?`<td class="num inventory-value" data-field="threePlEur">${N(G)}</td>`:`<td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="threePLUnits" value="${h(Mt??String((B==null?void 0:B.threePLUnits)??0))}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>`,jt=b?`<td class="num inventory-value" data-field="totalEur">${N(bt)}</td>`:`<td class="num inventory-value" data-field="totalUnits">${F(ct)}</td>`,wt=b?`<td class="num inventory-value inventory-in-transit" data-field="inTransitEur" data-tooltip-html="${ue(dt)}">${N($t)}</td>`:`<td class="num inventory-value inventory-in-transit" data-tooltip-html="${ue(dt)}">${F(gt)}</td>`,zt=b?`<td class="num inventory-value" data-field="deltaEur">${N(J)}</td>`:`<td class="num inventory-value" data-field="delta">${F(j)}</td>`;return`
        <tr class="inventory-row ${M?"is-collapsed":""}" data-sku="${h(Y)}" data-category="${h(g.id)}">
          <td class="inventory-col-sku sticky-cell">${h(Y)}</td>
          <td class="inventory-col-alias sticky-cell">${h(_.alias||"—")}</td>
          ${ut}
          ${Ct}
          ${jt}
          ${wt}
          <td class="num">
            ${R?'<span class="cell-warning" title="EK fehlt im Produkt">⚠︎</span>':""}
            <span data-field="ekEur">${Number.isFinite(x)?W(x):"—"}</span>
          </td>
          <td class="num inventory-value" data-field="totalValue">${Number.isFinite(O)?W(O):"—"}</td>
          ${zt}
          <td><input class="inventory-input note" data-field="note" value="${h((B==null?void 0:B.note)||"")}" /></td>
        </tr>
      `}).join("");w.amazonUnits+=$.amazonUnits,w.threePLUnits+=$.threePLUnits,w.totalUnits+=$.totalUnits,w.inTransit+=$.inTransit,w.deltaUnits+=$.deltaUnits,$.valueComplete?(w.totalValue+=$.totalValue,w.amazonEur+=$.amazonEur,w.threePlEur+=$.threePlEur,w.totalEur+=$.totalEur,w.inTransitEur+=$.inTransitEur,w.deltaEur+=$.deltaEur):w.valueComplete=!1;const P=`Zwischensumme ${g.name}`,I=$.valueComplete?"":' <span class="cell-warning" title="Mindestens ein Produkt ohne EK">⚠︎</span>',Z=b?`
        <td class="num">${N($.amazonEur)}</td>
        <td class="num">${N($.threePlEur)}</td>
        <td class="num">${N($.totalEur)}</td>
        <td class="num">${N($.inTransitEur)}</td>
        <td class="num"></td>
        <td class="num">${N($.totalValue)}${I}</td>
        <td class="num">${N($.deltaEur)}</td>
        <td></td>
      `:`
        <td class="num">${F($.amazonUnits)}</td>
        <td class="num">${F($.threePLUnits)}</td>
        <td class="num">${F($.totalUnits)}</td>
        <td class="num">${F($.inTransit)}</td>
        <td class="num"></td>
        <td class="num">${N($.totalValue)}${I}</td>
        <td class="num">${F($.deltaUnits)}</td>
        <td></td>
      `;return`
        <tr class="inventory-category-row" data-category-row="${h(g.id)}">
          <th class="inventory-col-sku sticky-cell" colspan="2">
            <button type="button" class="tree-toggle" data-category="${h(g.id)}">${M?"▸":"▾"}</button>
            <span class="tree-label">${h(g.name)}</span>
            <span class="muted">(${g.items.length})</span>
          </th>
          <th colspan="8"></th>
        </tr>
        ${C}
        <tr class="inventory-subtotal-row ${M?"is-collapsed":""}" data-category-subtotal="${h(g.id)}">
          <td class="inventory-col-sku sticky-cell" colspan="2"><strong>${h(P)}</strong></td>
          ${Z}
        </tr>
      `}).join(""),q=w.valueComplete?"":' <span class="cell-warning" title="Mindestens ein Produkt ohne EK">⚠︎</span>',Q=b?`
      <td class="num">${N(w.amazonEur)}</td>
      <td class="num">${N(w.threePlEur)}</td>
      <td class="num">${N(w.totalEur)}</td>
      <td class="num">${N(w.inTransitEur)}</td>
      <td class="num"></td>
      <td class="num">${N(w.totalValue)}${q}</td>
      <td class="num">${N(w.deltaEur)}</td>
      <td></td>
    `:`
      <td class="num">${F(w.amazonUnits)}</td>
      <td class="num">${F(w.threePLUnits)}</td>
      <td class="num">${F(w.totalUnits)}</td>
      <td class="num">${F(w.inTransit)}</td>
      <td class="num"></td>
      <td class="num">${N(w.totalValue)}${q}</td>
      <td class="num">${F(w.deltaUnits)}</td>
      <td></td>
    `,p=S.length?`
    <tr class="inventory-grandtotal-row">
      <td class="inventory-col-sku sticky-cell" colspan="2"><strong>Gesamtsumme</strong></td>
      ${Q}
    </tr>
  `:"";return`
    <table class="table-compact ui-table-standard inventory-table inventory-snapshot-table" data-ui-table="true" data-sticky-cols="2" data-sticky-owner="manual" data-view-mode="${h(E)}">
      <thead>
        <tr>
          <th class="inventory-col-sku sticky-header">SKU</th>
          <th class="inventory-col-alias sticky-header">Alias</th>
          <th class="num">${b?"Amazon €":"Amazon Units"}</th>
          <th class="num">${b?"3PL €":"3PL Units"}</th>
          <th class="num">${b?"Total €":"Total Units"}</th>
          <th class="num">${b?"In Transit €":"In Transit"}</th>
          <th class="num">EK (EUR)</th>
          <th class="num">Warenwert €</th>
          <th class="num">${b?"Delta € vs prev":"Delta vs prev"}</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        ${z||'<tr><td class="muted" colspan="10">Keine Produkte gefunden.</td></tr>'}
        ${p}
      </tbody>
    </table>
  `}function Lt(t,n=";"){const e=String(t??"");return e?e.includes('"')||e.includes(`
`)||e.includes(n)?`"${e.replace(/"/g,'""')}"`:e:""}function ot(t){return t==null||!Number.isFinite(Number(t))?"":Math.round(Number(t)).toLocaleString("de-DE",{maximumFractionDigits:0})}function yt(t){return t==null||!Number.isFinite(Number(t))?"":Number(t).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function Cn({state:t,view:n,snapshot:e,products:o,categories:l,asOfDate:i}){const s=Wt(o,n.search),u=ee(s,l),f=qe(t,i),E=new Map;((e==null?void 0:e.items)||[]).forEach(z=>{const q=String(z.sku||"").trim();q&&E.set(q,z)});const b=[],S=[];let U=0,v=0,w=0,F=0,N=0;return u.forEach(z=>{z.items.forEach(q=>{const Q=String(q.sku||"").trim();if(!Q)return;const p=q.alias||"",g=E.get(Q)||{amazonUnits:0,threePLUnits:0},M=Number((g==null?void 0:g.amazonUnits)||0),$=Number((g==null?void 0:g.threePLUnits)||0),C=f.get(Q),P=C?C.total:0,I=_t(q,t.settings||{}),Z=M+$+P,_=M+$,Y=Number.isFinite(I)?Z*I:null,B=Number.isFinite(I)?_*I:null;Number.isFinite(I)||S.push(p?`${Q} (${p})`:Q),Number.isFinite(M)&&(U+=M),Number.isFinite($)&&(v+=$),Number.isFinite(P)&&(w+=P),Number.isFinite(Y)&&(F+=Y),Number.isFinite(B)&&(N+=B),b.push({sku:Q,alias:p,amazonUnits:M,threePlUnits:$,inTransitUnits:P,ekEur:I,rowValue:Y,rowValueWarehouse:B})})}),{rows:b,totals:{amazonUnits:U,majamoUnits:v,inTransitUnits:w,totalUnits:U+v+w,totalValue:F,totalValueWarehouse:N},missingEk:S}}function jn({title:t,rows:n,totals:e,missingEk:o}){const l=";",i=[];t&&(i.push(Lt(t,l)),i.push(""));const s=["SKU","Alias","Bestand Amazon (Stk)","Bestand majamo (Stk)","In Transit (Stk)","EK-Preis (EUR / Stk)","Warenwert ohne In-Transit (EUR)","Warenwert inkl. In-Transit (EUR)"];i.push(s.map(f=>Lt(f,l)).join(l)),n.forEach(f=>{const E=[f.sku,f.alias,ot(f.amazonUnits),ot(f.threePlUnits),ot(f.inTransitUnits),yt(f.ekEur),yt(f.rowValueWarehouse),yt(f.rowValue)];i.push(E.map(b=>Lt(b,l)).join(l))});const u=["Gesamtsumme","",ot(e.amazonUnits),ot(e.majamoUnits),ot(e.inTransitUnits),"",yt(e.totalValueWarehouse),yt(e.totalValue)];return i.push(u.map(f=>Lt(f,l)).join(l)),i.push(""),i.push(Lt("Hinweis: 'Warenwert ohne In-Transit' = nur physisch im Lager (Amazon + majamo). Für BWA-Bestandsbewertung typischerweise diese Spalte verwenden, sofern In-Transit-Eigentum erst beim Eintreffen übergeht.",l)),o.length&&(i.push(""),i.push(Lt(`Fehlender EK-Preis für: ${o.join(", ")}`,l))),i.join(`
`)}function zn({title:t,fileName:n,rows:e,totals:o,missingEk:l,generatedAt:i}){const s=e.map(E=>`
      <tr>
        <td>${h(E.sku)}</td>
        <td>${h(E.alias||"")}</td>
        <td class="num">${ot(E.amazonUnits)}</td>
        <td class="num">${ot(E.threePlUnits)}</td>
        <td class="num">${ot(E.inTransitUnits)}</td>
        <td class="num">${yt(E.ekEur)}</td>
        <td class="num">${yt(E.rowValueWarehouse)}</td>
        <td class="num">${yt(E.rowValue)}</td>
      </tr>
  `).join(""),u=`
      <tr class="totals">
        <td>Gesamtsumme</td>
        <td></td>
        <td class="num">${ot(o.amazonUnits)}</td>
        <td class="num">${ot(o.majamoUnits)}</td>
        <td class="num">${ot(o.inTransitUnits)}</td>
        <td class="num"></td>
        <td class="num">${yt(o.totalValueWarehouse)}</td>
        <td class="num">${yt(o.totalValue)}</td>
      </tr>
  `,f=l.length?`<div class="warning">Fehlender EK-Preis für: ${h(l.join(", "))}</div>`:"";return`
    <!doctype html>
    <html lang="de">
      <head>
        <meta charset="utf-8" />
        <title>${h(n||t)}</title>
        <style>
          body { font-family: "Inter", system-ui, sans-serif; margin: 32px; color: #0f172a; }
          h1 { font-size: 20px; margin: 0 0 6px; }
          .meta { font-size: 12px; color: #475569; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border-bottom: 1px solid #e2e8f0; padding: 8px; text-align: left; }
          th { background: #f8fafc; font-weight: 600; color: #475569; }
          .num { text-align: right; font-variant-numeric: tabular-nums; }
          .totals td { font-weight: 700; background: #f1f5f9; }
          .hint { margin-top: 12px; font-size: 11px; color: #475569; }
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
              <th class="num">Warenwert ohne In-Transit (EUR)</th>
              <th class="num">Warenwert inkl. In-Transit (EUR)</th>
            </tr>
          </thead>
          <tbody>
            ${s}
            ${u}
          </tbody>
        </table>
        <p class="hint">Hinweis: "Warenwert ohne In-Transit" = nur physisch im Lager (Amazon + majamo). Für BWA-Bestandsbewertung typischerweise diese Spalte verwenden.</p>
        ${f}
        <script>
          window.addEventListener("load", () => {
            setTimeout(() => window.print(), 250);
          });
        <\/script>
      </body>
    </html>
  `}function On({state:t,view:n,snapshot:e,products:o,categories:l,months:i,projectionData:s=null,inboundData:u=null}){const f=Wt(o,n.search),E=ee(f,l),b=new Map,S=s||Oe({state:t,months:i,products:f,snapshot:e,projectionMode:n.projectionMode}),U=S.months;f.forEach(p=>{const g=String((p==null?void 0:p.sku)||"").trim();if(!g)return;const M=new Map;U.forEach($=>{var P;const C=(P=S.perSkuMonth.get(g))==null?void 0:P.get($);Number.isFinite(C==null?void 0:C.forecastUnits)&&M.set($,C.forecastUnits)}),b.set(g,M)});const v=n.projectionMode==="plan"?xn(E,b,i):new Map,w=new Map;((e==null?void 0:e.items)||[]).forEach(p=>{const g=String(p.sku||"").trim();g&&w.set(g,p)});const{inboundMap:F,missingEtaSkus:N}=u||pe(t),z=mn(t).bySku,q=E.map(p=>{const g=n.collapsed[p.id],M=p.items.map(C=>{var ct;const P=String(C.sku||"").trim(),I=C.alias||"—",Z=((ct=z==null?void 0:z.get(P.toLowerCase()))==null?void 0:ct.abcClass)||"—",_=hn(C,t),Y=fn(C,t),B=Number.isFinite(_)?K(_):"—",ft=Number.isFinite(Y)?K(Y):"—",gt=`
        <button class="inventory-drilldown-trigger" type="button" data-action="open-drilldown" data-sku="${h(P)}" data-alias="${h(I)}" title="SKU Verlauf öffnen" aria-label="SKU Verlauf öffnen">
          <span aria-hidden="true">&#128200;</span>
        </button>
      `;let lt=0;const kt=i.map(nt=>{var Ot;const xt=F.get(P),j=xt?xt.get(nt):null;j&&j.poUnits+j.foUnits;const x=(Ot=S.perSkuMonth.get(P))==null?void 0:Ot.get(nt),O=(x==null?void 0:x.forecastUnits)??null,tt=(x==null?void 0:x.endAvailable)??null,G=(x==null?void 0:x.forecastMissing)??!0,bt=Number.isFinite(x==null?void 0:x.safetyUnits)?x.safetyUnits:null,$t=Number.isFinite(x==null?void 0:x.safetyDays)?x.safetyDays:null,J=Number.isFinite(x==null?void 0:x.daysToOos)?x.daysToOos:null,R=j!=null&&j.hasPo&&(j!=null&&j.hasFo)?"inventory-cell inbound-both":j!=null&&j.hasPo?"inventory-cell inbound-po":j!=null&&j.hasFo?"inventory-cell inbound-fo":"inventory-cell",dt=(x==null?void 0:x.doh)??null,Ut=n.projectionMode==="doh",Mt=n.projectionMode==="plan",ut=Ut?Number.isFinite(dt)&&dt<=0:Number.isFinite(tt)&&tt<=0,Ct=Mt?Number.isFinite(O)?K(O):"—":G?"—":ut?'0 <span class="inventory-warning-icon">⚠︎</span>':Ut?dt==null?"—":K(dt):K(tt),jt=Mt?"":Ve({endAvailable:tt,safetyUnits:bt,doh:dt,safetyDays:$t,daysToOos:J,projectionMode:n.projectionMode}),wt=Mt?"":G?"incomplete":"",zt=j?`
            ${j.hasPo?'<span class="inventory-inbound-marker po"></span>':""}
            ${j.hasFo?'<span class="inventory-inbound-marker fo"></span>':""}
          `:"",Nt=j?Tn({alias:I,month:nt,events:j.events}):"",se=Nt?Nt.replace(/\s+/g," ").trim():"",Ft=Nt?`inventory-inbound-${P}-${nt}-${lt++}`:"";return`
          <td class="num ${R} ${jt} ${wt} inventory-projection-cell" data-month="${h(nt)}" ${Nt?`data-tooltip-html="${ue(se)}"`:""} ${Ft?`data-tooltip-id="${Ft}"`:""}>
            <span class="inventory-cell-value">${Ct}</span>
            ${zt}
          </td>
        `}).join(""),St=N.has(P)?'<span class="cell-warning" title="PO ohne ETA wird nicht gezählt">⚠︎</span>':"";return`
        <tr class="inventory-row ${g?"is-collapsed":""}" data-sku="${h(P)}" data-category="${h(p.id)}">
          <td class="inventory-col-sku sticky-cell">${St}${h(P)}</td>
          <td class="inventory-col-alias sticky-cell">
            <div class="inventory-alias-cell">
              <span class="inventory-alias-text">${h(I)}</span>
              ${gt}
            </div>
          </td>
          <td class="inventory-col-abc sticky-cell">${h(Z)}</td>
          <td class="inventory-col-safety-days sticky-cell num">${h(B)}</td>
          <td class="inventory-col-coverage-days sticky-cell num">${h(ft)}</td>
          ${kt}
        </tr>
      `}).join(""),$=n.projectionMode==="plan"?i.map(C=>{var _;const P=ne(C),I=(_=v.get(p.id))==null?void 0:_.get(P);return`<td class="num inventory-projection-group-cell">${Number.isFinite(I)?K(I):"—"}</td>`}).join(""):`<th colspan="${i.length}"></th>`;return`
      <tr class="inventory-category-row" data-category-row="${h(p.id)}">
        <th class="inventory-col-sku sticky-cell" colspan="5">
          <button type="button" class="tree-toggle" data-category="${h(p.id)}">${g?"▸":"▾"}</button>
          <span class="tree-label">${h(p.name)}</span>
          <span class="muted">(${p.items.length})</span>
        </th>
        ${$}
      </tr>
      ${M}
    `}).join("");return`
    <table class="table-compact ui-table-standard inventory-table inventory-projection-table" data-ui-table="true" data-sticky-cols="5" data-sticky-owner="manual">
      <thead>
        <tr>
          <th class="inventory-col-sku sticky-header">SKU</th>
          <th class="inventory-col-alias sticky-header">Alias</th>
          <th class="inventory-col-abc sticky-header">ABC</th>
          <th class="inventory-col-safety-days sticky-header" data-ui-tooltip="Sicherheitsbestand in Days on Hand">Safety DOH</th>
          <th class="inventory-col-coverage-days sticky-header" data-ui-tooltip="Bestellreichweite in Days on Hand">Coverage DOH</th>
          ${i.map(p=>`<th class="num">${Rt(p)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${q||`<tr><td class="muted" colspan="${i.length+5}">Keine Produkte gefunden.</td></tr>`}
      </tbody>
    </table>
  `}function Vn(t,n,e,o,l){var Q;if(!t||!n||!o)return;const i=String(o.sku||"").trim(),s=he(n,i),u=(Q=e==null?void 0:e.items)==null?void 0:Q.find(p=>String(p.sku||"").trim()===i),f=Number(s.amazonUnits||0)+Number(s.threePLUnits||0),E=((u==null?void 0:u.amazonUnits)||0)+((u==null?void 0:u.threePLUnits)||0),b=f-E,S=t.querySelector(".inventory-in-transit"),U=vt((S==null?void 0:S.textContent)||0),v=f+(Number.isFinite(U)?U:0),w=_t(o,l.settings||{}),F=Number.isFinite(w)?v*w:null,N=t.querySelector('[data-field="totalUnits"]'),z=t.querySelector('[data-field="delta"]'),q=t.querySelector('[data-field="totalValue"]');N&&(N.textContent=K(f)),z&&(z.textContent=K(b)),q&&(q.textContent=Number.isFinite(F)?W(F):"—")}function et(t){var we,Ee,ke;const n=cn(),e=wn(),o=window.__routeQuery||{},l=String(o.sku||"").trim(),i=String(o.month||"").trim();l&&(e.search="",e.projectionMode="doh"),/^\d{4}-\d{2}$/.test(i)&&(e.selectedMonth=Ke(i,-1));const s=En(n,e);e.selectedMonth=s,rt(e),t._inventoryCleanup&&(t._inventoryCleanup(),t._inventoryCleanup=null);const u=He(n,s)||{month:s,items:[]},f=je(n,s),E=Array.isArray(n.productCategories)?n.productCategories:[],b=(n.products||[]).filter($n),S=yn(e.snapshotAsOfDate),U=S?de(S):null;let v=S&&U===s?S:vn(s);v||(v=new Date),(!S||U!==s)&&(e.snapshotAsOfDate=Zt(v),rt(e));const w=me(v);if(l){const a=b.find(d=>String((d==null?void 0:d.sku)||"").trim()===l);(a==null?void 0:a.categoryId)!=null&&(e.collapsed[String(a.categoryId)]=!1,rt(e))}const F=Number(((Ee=(we=n.inventory)==null?void 0:we.settings)==null?void 0:Ee.projectionMonths)||12),N=[6,12,18],z=pn(s,N.includes(F)?F:12),q=Wt(b,e.search),Q=Oe({state:n,months:z,products:q,snapshot:u,projectionMode:e.projectionMode}),p=pe(n),g=e.projectionMode==="plan",M=Cn({state:n,view:e,snapshot:u,products:b,categories:E,asOfDate:w}),$=M.missingEk.length,C=Nn({state:n,currentSnapshot:u,previousSnapshot:f,products:b,categories:E,currentMonth:s,asOfDate:w}),P=Fn(n,w),I=f?An({reconciliation:C,stalePos:P,currentMonth:s,previousMonth:f.month}):'<div class="reco-panel reco-status-empty"><div class="muted small">Plausi-Check verfügbar sobald ein Vormonats-Snapshot existiert.</div></div>';t.innerHTML=`
    <section class="card inventory-card">
      <div class="inventory-header ui-page-head">
        <div>
          <h2>Inventory</h2>
          <p class="muted">Month-end Snapshots und Bestandsplanung. Lokal gespeichert.</p>
        </div>
        <div class="inventory-search">
          <input type="search" placeholder="SKU oder Alias suchen" value="${h(e.search)}" />
        </div>
      </div>
      <div class="inventory-toolbar ui-toolbar-row">
        <label class="inventory-field">
          <span class="muted">Snapshot Monat</span>
          <select id="inventory-month"></select>
        </label>
        <button class="btn secondary" id="inventory-copy">Copy from previous month</button>
        <button class="btn secondary" id="inventory-expand-all">Alles auf</button>
        <button class="btn secondary" id="inventory-collapse-all">Alles zu</button>
        <div class="inventory-toggle-group">
          <span class="muted">Anzeige</span>
          <div class="segment-control">
            <input type="radio" id="snapshot-mode-units" name="snapshot-view-mode" value="units" ${e.snapshotViewMode==="units"?"checked":""} />
            <label for="snapshot-mode-units">Einheiten</label>
            <input type="radio" id="snapshot-mode-eur" name="snapshot-view-mode" value="eur" ${e.snapshotViewMode==="eur"?"checked":""} />
            <label for="snapshot-mode-eur">EUR</label>
          </div>
        </div>
        <span class="muted small">${f?`Vorheriger Snapshot: ${Rt(f.month)}`:"Kein vorheriger Snapshot vorhanden."}</span>
      </div>
      <div class="inventory-export">
        <div class="inventory-export-controls">
          <label class="inventory-field">
            <span class="muted">Bestandsaufnahme zum</span>
            <input type="date" id="inventory-export-date" value="${h(Zt(v))}" />
          </label>
          <button class="btn secondary" id="inventory-export-csv">Export CSV</button>
          <button class="btn secondary" id="inventory-export-pdf">Export PDF</button>
        </div>
        <div class="inventory-export-meta">
          <span class="muted small">Export für Buchführung: SKU, Bestände, In-Transit, EK-Preis, Warenwert (mit + ohne In-Transit)</span>
          ${$?`<span class="inventory-export-warning">⚠︎ EK fehlt (${$})</span>`:""}
        </div>
      </div>
      ${I}
      <div class="inventory-table-wrap ui-table-shell">
        <div class="inventory-table-scroll ui-scroll-host">
          ${Ln({state:n,view:e,snapshot:u,previousSnapshot:f,products:b,categories:E,asOfDate:w,snapshotMonth:s})}
        </div>
      </div>
    </section>

    <section class="card inventory-card">
      <div class="inventory-header ui-page-head">
        <div>
          <h3>Projection (next ${N.includes(F)?F:12} months)</h3>
          <p class="muted">End-of-Month verfügbares Lager in DE (Amazon + 3PL).</p>
        </div>
        <div class="inventory-controls">
          <label class="inventory-field">
            <span class="muted">Horizon</span>
            <select id="inventory-horizon">
              ${N.map(a=>`<option value="${a}" ${a===F?"selected":""}>${a} Monate</option>`).join("")}
            </select>
          </label>
          <div class="inventory-toggle-group">
            <span class="muted">Anzeige</span>
            <div class="segment-control">
              <input type="radio" id="inventory-mode-units" name="inventory-mode" value="units" ${e.projectionMode==="units"?"checked":""} />
              <label for="inventory-mode-units">Units</label>
              <input type="radio" id="inventory-mode-doh" name="inventory-mode" value="doh" ${e.projectionMode==="doh"?"checked":""} />
              <label for="inventory-mode-doh">Days on hand</label>
              <input type="radio" id="inventory-mode-plan" name="inventory-mode" value="plan" ${e.projectionMode==="plan"?"checked":""} />
              <label for="inventory-mode-plan">Plan-Absatz</label>
            </div>
          </div>
          <label class="inventory-toggle">
            <input type="checkbox" id="inventory-safety" ${e.showSafety?"checked":""} />
            <span>Show safety threshold</span>
          </label>
        </div>
      </div>
      <div class="inventory-table-wrap ui-table-shell">
        <div class="inventory-table-scroll ui-scroll-host">
          ${On({state:n,view:e,snapshot:u,products:b,categories:E,months:z,projectionData:Q,inboundData:p})}
        </div>
      </div>
      <div class="inventory-legend">
        ${g?"":`
          <span class="inventory-legend-item"><span class="legend-swatch safety-negative"></span> Stockout / unter Safety</span>
          <span class="inventory-legend-item"><span class="legend-swatch safety-low"></span> Unter Safety (OOS &lt; Safety-Tage)</span>
        `}
        <span class="inventory-legend-item"><span class="legend-swatch inbound-po"></span> Inbound PO</span>
        <span class="inventory-legend-item"><span class="legend-swatch inbound-fo"></span> Inbound FO</span>
      </div>
    </section>
    <div id="inventory-tooltip-layer" class="inventory-tooltip-layer" hidden></div>
  `;const Z=t.querySelector("#inventory-month");if(Z){const a=(((ke=n.inventory)==null?void 0:ke.snapshots)||[]).map(r=>r==null?void 0:r.month).filter(r=>/^\d{4}-\d{2}$/.test(r)),d=new Set([...a,Be(),s]),m=Array.from(d).sort();Z.innerHTML=m.map(r=>`<option value="${r}" ${r===s?"selected":""}>${Rt(r)}</option>`).join(""),Z.addEventListener("change",r=>{e.selectedMonth=r.target.value,rt(e),et(t)})}const _=t.querySelector("#inventory-export-date");_&&_.addEventListener("change",a=>{e.snapshotAsOfDate=a.target.value,rt(e),et(t)});const Y=t.querySelector("#inventory-export-csv");Y&&Y.addEventListener("click",()=>{if(!M.rows.length){window.alert("Keine Daten für den Export vorhanden.");return}const a=Ae(v),d=jn({title:a,rows:M.rows,totals:M.totals,missingEk:M.missingEk}),m=`bestandsaufnahme_${Zt(v)}.csv`,r=new Blob([d],{type:"text/csv"}),c=URL.createObjectURL(r),k=document.createElement("a");k.href=c,k.download=m,document.body.append(k),k.click(),k.remove(),URL.revokeObjectURL(c)});const B=t.querySelector("#inventory-export-pdf");B&&B.addEventListener("click",()=>{if(!M.rows.length){window.alert("Keine Daten für den Export vorhanden.");return}const a=Ae(v),d=gn(new Date),m=`bestandsaufnahme_${Zt(v)}.pdf`,r=zn({title:a,fileName:m,rows:M.rows,totals:M.totals,missingEk:M.missingEk,generatedAt:d}),c=window.open("","_blank","noopener,noreferrer");c&&(c.document.open(),c.document.write(r),c.document.close())});const ft=t.querySelector(".inventory-search input");ft&&ft.addEventListener("input",a=>{e.search=a.target.value||"",rt(e),et(t)});const gt=t.querySelector("#inventory-copy");gt&&gt.addEventListener("click",()=>{const a=Ce(n,s),d=je(n,s);a.items=(b||[]).map(m=>{var k;const r=String(m.sku||"").trim(),c=(k=d==null?void 0:d.items)==null?void 0:k.find(T=>String(T.sku||"").trim()===r);return{sku:r,amazonUnits:(c==null?void 0:c.amazonUnits)??0,threePLUnits:(c==null?void 0:c.threePLUnits)??0,note:(c==null?void 0:c.note)??""}}),Qt(n),et(t)});const lt=t.querySelector("#inventory-expand-all");lt&&lt.addEventListener("click",()=>{Le({products:b,categories:E,view:e,collapsed:!1}),et(t)});const kt=t.querySelector("#inventory-collapse-all");kt&&kt.addEventListener("click",()=>{Le({products:b,categories:E,view:e,collapsed:!0}),et(t)}),t.querySelectorAll("input[name='snapshot-view-mode']").forEach(a=>{a.addEventListener("change",d=>{const m=d.target.value==="eur"?"eur":"units";e.snapshotViewMode!==m&&(e.snapshotViewMode=m,rt(e),et(t))})});const St=a=>{if(!a.length)return;const d=new Set(a.map(String));let m=0;(n.pos||[]).forEach(r=>{const c=String((r==null?void 0:r.id)||(r==null?void 0:r.poNo)||"");c&&d.has(c)&&!r.archived&&(r.archived=!0,m+=1)}),m&&(Qt(n),et(t))},ct=t.querySelector("#reco-archive-all");ct&&ct.addEventListener("click",()=>{const a=P.map(d=>d.id).filter(Boolean);a.length&&window.confirm(`${a.length} alte PO${a.length===1?"":"s"} archivieren? Sie zählen danach nicht mehr als In-Transit.`)&&St(a)}),t.querySelectorAll(".reco-archive-one").forEach(a=>{a.addEventListener("click",d=>{const m=d.currentTarget.getAttribute("data-po-id");m&&St([m])})});const nt=t.querySelector(".inventory-snapshot-table");let xt=null;const j=()=>{xt&&clearTimeout(xt),xt=setTimeout(()=>{const a=Ce(n,s);a!==u&&(a.items=u.items),Qt(n)},250)};if(nt){const a=m=>{const r=m.closest("tr[data-sku]");if(!r)return null;const c=r.getAttribute("data-sku"),k=b.find(L=>String(L.sku||"").trim()===c);if(!k)return null;const T=he(u,c),A=m.dataset.field;return{row:r,sku:c,product:k,item:T,field:A}},d=m=>{var at;const r=a(m);if(!r)return;const{row:c,sku:k,product:T,item:A,field:L}=r;if(L!=="amazonUnits"&&L!=="threePLUnits")return;const st=te(s,k,L),H=Ht.get(st)??m.value,{value:it,isRounded:pt}=bn(H);Ht.delete(st),m.value=String(it),(at=m.closest("td"))==null||at.classList.toggle("inventory-input-warn",pt),L==="amazonUnits"&&(A.amazonUnits=it),L==="threePLUnits"&&(A.threePLUnits=it),Vn(c,u,f,T,n),j()};nt.addEventListener("click",m=>{const r=m.target.closest("button.tree-toggle[data-category]");if(!r)return;const c=r.getAttribute("data-category");e.collapsed[c]=!e.collapsed[c],rt(e),et(t)}),nt.addEventListener("input",m=>{var L;const r=m.target.closest("input.inventory-input");if(!r)return;const c=a(r);if(!c)return;const{sku:k,item:T,field:A}=c;if(A==="note"){T.note=r.value,j();return}if(A==="amazonUnits"||A==="threePLUnits"){const st=te(s,k,A);Ht.set(st,r.value),(L=r.closest("td"))==null||L.classList.remove("inventory-input-warn")}}),nt.addEventListener("blur",m=>{const r=m.target.closest("input.inventory-input");if(!r)return;const c=a(r);c&&c.field!=="note"&&d(r)},!0),nt.addEventListener("keydown",m=>{if(m.key!=="Enter")return;const r=m.target.closest("input.inventory-input");if(!r)return;const c=a(r);!c||c.field==="note"||(m.preventDefault(),d(r))})}const x=t.querySelector(".inventory-projection-table");x&&(x.addEventListener("click",a=>{const d=a.target.closest("button.tree-toggle[data-category]");if(!d)return;const m=d.getAttribute("data-category");e.collapsed[m]=!e.collapsed[m],rt(e),et(t)}),x.addEventListener("click",a=>{const d=a.target.closest("button.inventory-drilldown-trigger[data-action='open-drilldown']");if(d){const A=String(d.getAttribute("data-sku")||"").trim(),L=String(d.getAttribute("data-alias")||A).trim();if(!A)return;a.preventDefault(),a.stopPropagation(),We({sku:A,alias:L});return}if(a.target.closest("button.tree-toggle[data-category]"))return;const r=a.target.closest("td.inventory-projection-cell");if(!r)return;const c=r.closest("tr[data-sku]");if(!c)return;const k=c.getAttribute("data-sku"),T=r.getAttribute("data-month");!k||!T||(a.stopPropagation(),jt(r,{sku:k,month:T}))}));const O=t.querySelector("#inventory-tooltip-layer");let tt=null,G=null,bt=null,$t=null,J="units",R=null;function dt(a){if(!O||O.hidden)return;const d=12,m=window.innerWidth-O.offsetWidth-8,r=window.innerHeight-O.offsetHeight-8,c=Math.min(a.clientX+d,m),k=Math.min(a.clientY+d,r);O.style.left=`${Math.max(8,c)}px`,O.style.top=`${Math.max(8,k)}px`}function Ut(a,d,m){if(!O||!d)return;let r=d;try{r=decodeURIComponent(d)}catch{r=d}O.innerHTML=r,O.hidden=!1,O.classList.add("is-visible"),tt=a,dt(m)}function Mt(){O&&(O.hidden=!0,O.classList.remove("is-visible"),O.innerHTML="",tt=null)}function ut(){G&&G.remove(),G=null,bt=null}function Ct(a){if(!G||!a)return;const d=a.getBoundingClientRect(),m=8,r=window.innerWidth-G.offsetWidth-m,c=window.innerHeight-G.offsetHeight-m,k=Math.min(d.left,r),T=Math.min(d.bottom+6,c);G.style.left=`${Math.max(m,k)}px`,G.style.top=`${Math.max(m,T)}px`}function jt(a,{sku:d,month:m}){var it;if(!a||!d||!m)return;if(bt===a&&G){ut();return}ut();const r=((it=n.settings)==null?void 0:it.monthAnchorDay)||"START",c=Mn(m,r),k=Dn(c),T=qt(c),A=ce(m),L=Re(n,d,m),st=Number.isFinite(L)?`<div class="inventory-cell-popover-meta">Plan-Absatz in diesem Monat: ${K(L)}</div>`:"",H=document.createElement("div");H.className="inventory-cell-popover",H.innerHTML=`
      <div class="inventory-cell-popover-title">Aktion für ${h(d)}</div>
      ${st}
      <button class="inventory-cell-popover-action" type="button" data-action="fo">
        FO erstellen – Ankunft in ${h(A)} <span class="muted">(Anker: ${h(T)})</span>
      </button>
      <button class="inventory-cell-popover-action" type="button" data-action="po">
        PO erstellen – Bestellung in ${h(A)} <span class="muted">(Anker: ${h(T)})</span>
      </button>
      <button class="inventory-cell-popover-action" type="button" data-action="po-arrival">
        PO rückwärts – Ankunft in ${h(A)} <span class="muted">(Anker: ${h(T)})</span>
      </button>
    `,H.addEventListener("click",pt=>{const at=pt.target.closest("button[data-action]");if(!at)return;const Dt=at.dataset.action,X=new URLSearchParams;X.set("create","1"),X.set("sku",d),X.set("anchorMonth",m),X.set("anchorDate",k),Dt==="fo"?(X.set("target",k),location.hash=`#fo?${X.toString()}`):Dt==="po"?(X.set("orderDate",k),X.set("anchorMode","order"),location.hash=`#po?${X.toString()}`):Dt==="po-arrival"&&(X.set("anchorMode","arrival"),location.hash=`#po?${X.toString()}`),ut()}),document.body.appendChild(H),G=H,bt=a,Ct(a)}function wt(){R&&(clearTimeout(R),R=null),$t&&($t.remove(),$t=null,J="units")}function zt(a){const d=Q.perSkuMonth.get(a)||new Map,m=p.inboundMap.get(a)||new Map;return z.map(r=>{const c=d.get(r)||null,k=m.get(r)||null;return{month:r,endAvailable:Number.isFinite(c==null?void 0:c.endAvailable)?Number(c.endAvailable):null,doh:Number.isFinite(c==null?void 0:c.doh)?Number(c.doh):null,safetyUnits:Number.isFinite(c==null?void 0:c.safetyUnits)?Number(c.safetyUnits):null,safetyDays:Number.isFinite(c==null?void 0:c.safetyDays)?Number(c.safetyDays):null,daysToOos:Number.isFinite(c==null?void 0:c.daysToOos)?Number(c.daysToOos):null,forecastUnits:Number.isFinite(c==null?void 0:c.forecastUnits)?Number(c.forecastUnits):null,events:Array.isArray(k==null?void 0:k.events)?k.events:[]}})}function Nt({alias:a,monthData:d}){const m=J==="doh"?"Bestand Monatsende (DOH)":"Bestand Monatsende (DE verfügbar)",r=J==="doh"?Number.isFinite(d.doh)?`${K(d.doh)} DOH`:"—":Number.isFinite(d.endAvailable)?`${K(d.endAvailable)} Units`:"—",c=Number.isFinite(d.forecastUnits)?`${K(d.forecastUnits)} Units`:"—",k=d.events.length?d.events.map(T=>{const A=T.open?`<button class="btn sm secondary inventory-link" type="button" data-route="${h(T.route||"")}" data-open="${h(T.open||"")}">Open ${h(T.type||"")}</button>`:"";return`
          <div class="inventory-drilldown-arrival">
            <div class="inventory-drilldown-arrival-main">
              <div><strong>${h(T.type||"—")} ${h(T.label||T.id||"—")}</strong></div>
              <div class="muted">${h(T.date||"—")}</div>
            </div>
            <div class="inventory-drilldown-arrival-meta">
              <div>+${K(T.qty)} Units</div>
              ${A}
            </div>
          </div>
        `}).join(""):'<div class="inventory-drilldown-tooltip-empty">Keine Ankünfte.</div>';return`
      <div class="inventory-drilldown-tooltip-header">
        <div class="inventory-drilldown-tooltip-title">${h(d.month)}</div>
        <div class="muted">${h(a||"—")}</div>
      </div>
      <div class="inventory-drilldown-tooltip-kpis">
        <div>${m}: <strong>${r}</strong></div>
        <div>Plan-Absatz: <strong>${c}</strong></div>
      </div>
      <div class="inventory-drilldown-tooltip-arrivals">${k}</div>
    `}function se(a,d){if(!a||!d)return;const m=14,r=window.innerWidth-a.offsetWidth-12,c=window.innerHeight-a.offsetHeight-12,k=le(d.clientX+m,8,Math.max(8,r)),T=le(d.clientY+m,8,Math.max(8,c));a.style.left=`${k}px`,a.style.top=`${T}px`}function Ft(a){a&&(a.hidden=!0,a.innerHTML="")}function Ot(a,{sku:d,alias:m}){var Ue;const r=a==null?void 0:a.querySelector("[data-drilldown-chart]"),c=a==null?void 0:a.querySelector(".inventory-drilldown-tooltip");if(!r||!c)return;R&&(clearTimeout(R),R=null),Ft(c);const k=zt(d).map(y=>{const D=e.showSafety?Ve({endAvailable:y.endAvailable,safetyUnits:y.safetyUnits,doh:y.doh,safetyDays:y.safetyDays,daysToOos:y.daysToOos,projectionMode:J==="doh"?"doh":"units"}):"";return{...y,riskClass:D}});if(!k.length){r.innerHTML='<div class="muted">Keine Projektion vorhanden.</div>';return}const T=k.length,A=72,L=56,st=20,H=18,it=210,pt=H+it+36,at=86,Dt=pt+at,X=L+st+T*A,Ye=Dt+34,ie=k.map(y=>J==="doh"?y.doh:y.endAvailable),Ge=k.map(y=>J==="doh"?y.safetyDays:y.safetyUnits),Vt=ie.filter(y=>Number.isFinite(y));e.showSafety&&Ge.forEach(y=>{Number.isFinite(y)&&Vt.push(y)});let Tt=Vt.length?Math.min(...Vt):0,Pt=Vt.length?Math.max(...Vt):1;Tt=Math.min(Tt,0),Pt<=Tt&&(Pt=Tt+1);const Xe=Math.max(1,...k.map(y=>Number.isFinite(y.forecastUnits)?y.forecastUnits:0)),It=y=>L+y*A+A/2,Bt=y=>H+(Pt-y)/(Pt-Tt)*it,Qe=y=>{const D=Number.isFinite(y)?Math.max(0,y):0;return pt+at-D/Xe*at},Se=4,Ze=Array.from({length:Se+1},(y,D)=>{const V=D/Se,mt=Pt-(Pt-Tt)*V;return{value:mt,y:Bt(mt)}}),Gt=[];let At=[];ie.forEach((y,D)=>{if(!Number.isFinite(y)){At.length&&Gt.push(At),At=[];return}At.push({x:It(D),y:Bt(y),index:D})}),At.length&&Gt.push(At);const xe=Math.max(12,Math.round(A*.42)),Je=k.map((y,D)=>{if(!e.showSafety||!y.riskClass)return"";const V=y.riskClass==="safety-negative"?"inventory-drilldown-band-negative":"inventory-drilldown-band-low",mt=L+D*A;return`<rect class="${V}" x="${mt}" y="${H}" width="${A}" height="${Dt-H+1}"></rect>`}).join(""),tn=Ze.map(y=>`
      <line class="inventory-drilldown-grid" x1="${L}" y1="${y.y.toFixed(2)}" x2="${X-st}" y2="${y.y.toFixed(2)}"></line>
      <text class="inventory-drilldown-axis-label" x="${L-8}" y="${(y.y+3).toFixed(2)}" text-anchor="end">${h(K(y.value))}</text>
    `).join(""),en=Gt.map(y=>`<polyline class="inventory-drilldown-stock-line" points="${y.map(V=>`${V.x.toFixed(2)},${V.y.toFixed(2)}`).join(" ")}"></polyline>`).join(""),nn=Gt.reduce((y,D)=>y.concat(D),[]).map(y=>`<circle class="inventory-drilldown-stock-dot" cx="${y.x.toFixed(2)}" cy="${y.y.toFixed(2)}" r="3.4"></circle>`).join(""),sn=k.map((y,D)=>{if(!Number.isFinite(y.forecastUnits)||y.forecastUnits<=0)return"";const V=It(D)-xe/2,mt=Qe(y.forecastUnits),Xt=Math.max(1,pt+at-mt);return`<rect class="inventory-drilldown-plan-bar" x="${V.toFixed(2)}" y="${mt.toFixed(2)}" width="${xe}" height="${Xt.toFixed(2)}" rx="3"></rect>`}).join(""),an=k.map((y,D)=>{if(!y.events.length)return"";const V=y.events.some(oe=>oe.type==="PO"),mt=y.events.some(oe=>oe.type==="FO"),Xt=V&&mt?"PO+FO":V?"PO":"FO",Ne=ie[D],ln=Number.isFinite(Ne)?Bt(Ne):H+14,Fe=le(ln-22,H+2,H+it-18),re=Xt.length>2?36:24,Te=It(D)-re/2;return`
        <rect class="inventory-drilldown-arrival-pill" x="${Te.toFixed(2)}" y="${Fe.toFixed(2)}" width="${re}" height="14" rx="7"></rect>
        <text class="inventory-drilldown-arrival-pill-text" x="${(Te+re/2).toFixed(2)}" y="${(Fe+10.2).toFixed(2)}" text-anchor="middle">${Xt}</text>
      `}).join(""),rn=k.map((y,D)=>`
      <text class="inventory-drilldown-axis-label" x="${It(D).toFixed(2)}" y="${(Dt+16).toFixed(2)}" text-anchor="middle">${h(Rt(y.month))}</text>
    `).join(""),on=k.map((y,D)=>{const V=L+D*A;return`<rect class="inventory-drilldown-hit" data-index="${D}" x="${V}" y="${H}" width="${A}" height="${Dt-H+18}"></rect>`}).join("");let ae="";if(e.showSafety&&J==="doh"){const y=(Ue=k.find(D=>Number.isFinite(D.safetyDays)))==null?void 0:Ue.safetyDays;if(Number.isFinite(y)){const D=Bt(y);ae=`
          <line class="inventory-drilldown-safety-line" x1="${L}" y1="${D.toFixed(2)}" x2="${X-st}" y2="${D.toFixed(2)}"></line>
          <text class="inventory-drilldown-axis-label" x="${X-st}" y="${(D-6).toFixed(2)}" text-anchor="end">Safety ${h(K(y))}</text>
        `}}else if(e.showSafety){const y=[];let D=[];k.forEach((V,mt)=>{if(!Number.isFinite(V.safetyUnits)){D.length&&y.push(D),D=[];return}D.push(`${It(mt).toFixed(2)},${Bt(V.safetyUnits).toFixed(2)}`)}),D.length&&y.push(D),ae=y.map(V=>`<polyline class="inventory-drilldown-safety-line" points="${V.join(" ")}"></polyline>`).join("")}r.innerHTML=`
      <svg class="inventory-drilldown-svg" viewBox="0 0 ${X} ${Ye}" role="img" aria-label="SKU Verlauf ${h(m||d)} (${h(d)})">
        ${Je}
        ${tn}
        <line class="inventory-drilldown-axis" x1="${L}" y1="${(H+it).toFixed(2)}" x2="${X-st}" y2="${(H+it).toFixed(2)}"></line>
        <line class="inventory-drilldown-axis" x1="${L}" y1="${(pt+at).toFixed(2)}" x2="${X-st}" y2="${(pt+at).toFixed(2)}"></line>
        <text class="inventory-drilldown-axis-label" x="${L}" y="${(H-6).toFixed(2)}">${J==="doh"?"DOH":"Units"}</text>
        <text class="inventory-drilldown-axis-label" x="${L}" y="${(pt-8).toFixed(2)}">Plan-Absatz (Units)</text>
        ${ae}
        ${sn}
        ${en}
        ${nn}
        ${an}
        ${rn}
        ${on}
      </svg>
    `;const Me=()=>{R&&clearTimeout(R),R=setTimeout(()=>{c.matches(":hover")||Ft(c)},120)},De=(y,D)=>{R&&(clearTimeout(R),R=null);const V=k[D];V&&(c.innerHTML=Nt({alias:m,monthData:V}),c.hidden=!1,se(c,y))};r.querySelectorAll(".inventory-drilldown-hit").forEach(y=>{const D=Number(y.getAttribute("data-index"));y.onmouseenter=V=>De(V,D),y.onmousemove=V=>De(V,D),y.onmouseleave=()=>Me()}),r.onmouseleave=()=>Me(),c.onmouseenter=()=>{R&&(clearTimeout(R),R=null)},c.onmouseleave=()=>Ft(c)}function We({sku:a,alias:d}){if(!a)return;wt(),J="units";const m=d||a,r=document.createElement("div");r.className="po-modal-backdrop inventory-drilldown-backdrop",r.setAttribute("role","dialog"),r.setAttribute("aria-modal","true"),r.innerHTML=`
      <div class="po-modal inventory-drilldown-modal">
        <header class="po-modal-header">
          <div>
            <strong>SKU Verlauf – ${h(m)} (${h(a)})</strong>
            <div class="muted small">Zeitraum: ${h(z[0]||"—")} bis ${h(z[z.length-1]||"—")}</div>
          </div>
          <button class="btn ghost" type="button" data-drilldown-close aria-label="Schließen">✕</button>
        </header>
        <div class="po-modal-body">
          <div class="inventory-drilldown-toolbar">
            <span class="muted">Anzeige</span>
            <div class="segment-control">
              <input type="radio" id="inventory-drilldown-units" name="inventory-drilldown-mode" value="units" checked />
              <label for="inventory-drilldown-units">Units</label>
              <input type="radio" id="inventory-drilldown-doh" name="inventory-drilldown-mode" value="doh" />
              <label for="inventory-drilldown-doh">Days on Hand</label>
            </div>
          </div>
          <div class="inventory-drilldown-chart-wrap">
            <div class="inventory-drilldown-chart" data-drilldown-chart></div>
          </div>
          <div class="inventory-drilldown-note muted small">Linie: Bestand Monatsende · Balken: Plan-Absatz · Marker: PO/FO-Ankünfte</div>
        </div>
        <footer class="po-modal-actions">
          <button class="btn secondary" type="button" data-drilldown-close>Schließen</button>
        </footer>
      </div>
      <div class="inventory-drilldown-tooltip" hidden></div>
    `,r.addEventListener("click",c=>{if(c.target===r||c.target.closest("[data-drilldown-close]")){wt();return}const k=c.target.closest(".inventory-link");if(!k)return;const T=k.getAttribute("data-route"),A=k.getAttribute("data-open");if(!T||!A)return;const L=new URLSearchParams;L.set("open",A),location.hash=`${T}?${L.toString()}`,wt()}),r.addEventListener("change",c=>{const k=c.target.closest("input[name='inventory-drilldown-mode']");k&&(J=k.value==="doh"?"doh":"units",Ot(r,{sku:a,alias:m}))}),document.body.appendChild(r),$t=r,Ot(r,{sku:a,alias:m})}t.addEventListener("mouseover",a=>{const d=a.target.closest("[data-tooltip-html]");if(!d||d===tt)return;const m=d.getAttribute("data-tooltip-html");m&&Ut(d,m,a)}),t.addEventListener("mousemove",a=>{tt&&dt(a)}),t.addEventListener("mouseout",a=>{if(!tt||a.relatedTarget&&O&&O.contains(a.relatedTarget))return;const d=a.target.closest("[data-tooltip-html]");d&&d===tt&&Mt()}),O&&O.addEventListener("mouseleave",()=>{Mt()});const ye=a=>{if(!G||G.contains(a.target))return;const d=a.target.closest("td.inventory-projection-cell");d&&bt===d||ut()},ve=a=>{a.key==="Escape"&&(ut(),wt())};document.addEventListener("click",ye),document.addEventListener("keydown",ve);const Yt=t.querySelector(".inventory-table-scroll"),ge=()=>ut();Yt&&Yt.addEventListener("scroll",ge),t.addEventListener("click",a=>{const d=a.target.closest(".inventory-link");if(!d)return;const m=d.getAttribute("data-route"),r=d.getAttribute("data-open");if(!m||!r)return;const c=new URLSearchParams;c.set("open",r),location.hash=`${m}?${c.toString()}`});const be=t.querySelector("#inventory-horizon");be&&be.addEventListener("change",a=>{const d=Number(a.target.value||12);n.inventory||(n.inventory={snapshots:[],settings:{}}),n.inventory.settings||(n.inventory.settings={}),n.inventory.settings.projectionMonths=d,Qt(n),et(t)});const $e=t.querySelector("#inventory-safety");$e&&$e.addEventListener("change",a=>{e.showSafety=a.target.checked,rt(e),et(t)}),t.querySelectorAll("input[name='inventory-mode']").forEach(a=>{a.addEventListener("change",d=>{const m=d.target.value;e.projectionMode=m==="doh"||m==="plan"?m:"units",rt(e),et(t)})});function _e(){if(!l)return;const a=Pe(l),d=/^\d{4}-\d{2}$/.test(i)?`[data-month="${Pe(i)}"]`:"[data-month]",m=t.querySelector(`.inventory-projection-table tr[data-sku="${a}"] td${d}`),r=m?m.closest("tr[data-sku]"):t.querySelector(`.inventory-projection-table tr[data-sku="${a}"]`);r&&r.classList.add("row-focus"),m?(m.classList.add("cell-focus"),m.scrollIntoView({behavior:"smooth",block:"center",inline:"center"})):r&&r.scrollIntoView({behavior:"smooth",block:"center"}),window.__routeQuery={}}_e(),t._inventoryCleanup=()=>{document.removeEventListener("click",ye),document.removeEventListener("keydown",ve),Yt&&Yt.removeEventListener("scroll",ge),ut(),wt()}}const qn={render:et};export{qn as default,et as render};
