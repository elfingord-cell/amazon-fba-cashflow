import{l as un,c as Zt,a as mn,b as hn}from"./store-BbhpJfdt.js";import{k as ft}from"./index-xbzRa1vz.js";import{b as fn}from"./abcClassification-BOdYB9Gg.js";import{c as Oe,r as pn,a as yn,g as Ve}from"./inventoryProjection-Dp8zq60_.js";const Ie="inventory_view_v1";function f(t){return String(t??"").replace(/[&<>"']/g,n=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[n])}function Pe(t){return typeof CSS<"u"&&typeof CSS.escape=="function"?CSS.escape(t):String(t).replace(/["\\]/g,"\\$&")}function Be(){const t=new Date;return`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}`}function Rt(t){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[n,e]=t.split("-").map(Number);return n*12+(e-1)}function Ke(t,n){const[e,l]=t.split("-").map(Number),r=e*12+(l-1)+n,i=Math.floor(r/12),s=r%12+1;return`${i}-${String(s).padStart(2,"0")}`}function vn(t,n){return Array.from({length:n},(e,l)=>Ke(t,l+1))}function Ht(t){if(!t)return"—";const[n,e]=t.split("-");return`${e}-${n}`}function ce(t){if(!t)return"—";const[n,e]=t.split("-");return`${e}/${n}`}function Jt(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return"";const n=t.getFullYear(),e=String(t.getMonth()+1).padStart(2,"0"),l=String(t.getDate()).padStart(2,"0");return`${n}-${e}-${l}`}function gn(t){if(!t)return null;const n=new Date(`${t}T00:00:00`);return Number.isNaN(n.getTime())?null:n}function bn(t){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[n,e]=t.split("-").map(Number);return new Date(n,e,0)}function me(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return null;const n=new Date(t.getTime());return n.setHours(23,59,59,999),n}function Ae(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"Bestandsaufnahme":`Bestandsaufnahme zum ${Ct(t)}`}function $n(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return"—";const n=t.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}),e=t.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});return`${n} ${e}`}function wn(t){if(t==null||t==="")return{value:0,isRounded:!1};const n=ft(String(t));if(!Number.isFinite(n))return{value:0,isRounded:!1};const e=Math.round(n);return{value:e,isRounded:e!==n}}function Re(t,n,e){var m,E,y,S,U,v,w;const l=ne(e);if(!l)return null;const r=(y=(E=(m=t==null?void 0:t.forecast)==null?void 0:m.forecastManual)==null?void 0:E[n])==null?void 0:y[l],i=ft(r);if(Number.isFinite(i))return i;const s=(w=(v=(U=(S=t==null?void 0:t.forecast)==null?void 0:S.forecastImport)==null?void 0:U[n])==null?void 0:v[l])==null?void 0:w.units,d=ft(s);return Number.isFinite(d)?d:null}function K(t){return t==null||!Number.isFinite(Number(t))?"—":Math.round(Number(t)).toLocaleString("de-DE",{maximumFractionDigits:0})}function le(t,n,e){return Math.min(e,Math.max(n,t))}function _t(t,n){const e=String(n||"").trim().toLowerCase();return e?t.filter(l=>String(l.alias||"").toLowerCase().includes(e)||String(l.sku||"").toLowerCase().includes(e)):t}function En(t){if(!t)return!1;if(typeof t.active=="boolean")return t.active;const n=String(t.status||"").trim().toLowerCase();return n?n==="active"||n==="aktiv":!0}function ee(t,n=[]){const e=new Map;t.forEach(s=>{const d=s.categoryId?String(s.categoryId):"";e.has(d)||e.set(d,[]),e.get(d).push(s)});const r=n.slice().sort((s,d)=>{const m=Number.isFinite(s.sortOrder)?s.sortOrder:0,E=Number.isFinite(d.sortOrder)?d.sortOrder:0;return m-E||String(s.name||"").localeCompare(String(d.name||""))}).map(s=>({id:String(s.id),name:s.name||"Ohne Kategorie",items:e.get(String(s.id))||[]})),i=e.get("")||[];return i.length&&r.push({id:"uncategorized",name:"Ohne Kategorie",items:i}),r.filter(s=>s.items.length)}function kn(){const t=mn(Ie,{}),n=t.projectionMode==="doh"||t.projectionMode==="plan"?t.projectionMode:"units",e=t.snapshotViewMode==="eur"?"eur":"units";return{selectedMonth:t.selectedMonth||null,collapsed:t.collapsed&&typeof t.collapsed=="object"?t.collapsed:{},search:t.search||"",showSafety:t.showSafety!==!1,projectionMode:n,snapshotAsOfDate:t.snapshotAsOfDate||"",snapshotViewMode:e}}function ot(t){hn(Ie,t)}function Sn(t,n){var s;const e=(((s=t.inventory)==null?void 0:s.snapshots)||[]).map(d=>d==null?void 0:d.month).filter(d=>/^\d{4}-\d{2}$/.test(d)).sort(),l=e[e.length-1],r=Be(),i=n.selectedMonth||l||r;return i||r}function Le({products:t,categories:n,view:e,collapsed:l}){const r=_t(t,e.search),i=ee(r,n),s={...e.collapsed};i.forEach(d=>{s[d.id]=l}),e.collapsed=s,ot(e)}function ne(t){if(!t)return null;const n=String(t);if(/^\d{4}-\d{2}$/.test(n))return n;const e=n.match(/^(\d{2})-(\d{4})$/);return e?`${e[2]}-${e[1]}`:n}function He(t,n){var e;return(((e=t.inventory)==null?void 0:e.snapshots)||[]).find(l=>(l==null?void 0:l.month)===n)||null}function Ce(t,n){const e=He(t,n);if(e)return e;const l={month:n,items:[]};return t.inventory||(t.inventory={snapshots:[],settings:{}}),Array.isArray(t.inventory.snapshots)||(t.inventory.snapshots=[]),t.inventory.snapshots.push(l),l}function he(t,n){if(!t||!n)return null;Array.isArray(t.items)||(t.items=[]);let e=t.items.find(l=>String(l.sku||"").trim()===n);return e||(e={sku:n,amazonUnits:0,threePLUnits:0,note:""},t.items.push(e)),e}function je(t,n){var i;const e=Rt(n);if(e==null)return null;const l=(((i=t.inventory)==null?void 0:i.snapshots)||[]).filter(s=>(s==null?void 0:s.month)&&Rt(s.month)!=null).slice().sort((s,d)=>Rt(s.month)-Rt(d.month));let r=null;return l.forEach(s=>{const d=Rt(s.month);d!=null&&d<e&&(r=s)}),r}function Wt(t,n){if(!n)return"—";const l=(Array.isArray(t.suppliers)?t.suppliers:[]).find(r=>String(r.id||"")===String(n));return(l==null?void 0:l.name)||n||"—"}function it(t){if(!t)return null;const n=new Date(t);return Number.isNaN(n.getTime())?null:n}function de(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?null:`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}`}function fe(t){const n=it((t==null?void 0:t.etaManual)||(t==null?void 0:t.etaDate)||(t==null?void 0:t.eta));if(n)return n;const e=it(t==null?void 0:t.etaComputed);if(e)return e;const l=it(t==null?void 0:t.orderDate);if(!l)return null;const r=Number((t==null?void 0:t.prodDays)||0),i=Number((t==null?void 0:t.transitDays)||0),s=new Date(l.getTime());return s.setDate(s.getDate()+Math.max(0,r+i)),s}function qe(t){return it((t==null?void 0:t.targetDeliveryDate)||(t==null?void 0:t.deliveryDate)||(t==null?void 0:t.etaDate))}function We(t){const n=String((t==null?void 0:t.status)||"").toUpperCase();return!(n==="CONVERTED"||n==="CANCELLED")}function xn(t,n,e){const l=e.map(i=>ne(i)).filter(Boolean),r=new Map;return t.forEach(i=>{const s=new Map;l.forEach(d=>{let m=0,E=!1;i.items.forEach(y=>{var v;const S=String((y==null?void 0:y.sku)||"").trim();if(!S)return;const U=(v=n.get(S))==null?void 0:v.get(d);Number.isFinite(U)&&(m+=U,E=!0)}),E&&s.set(d,m)}),r.set(i.id,s)}),r}function Yt(t,n){var i;const e=((i=t==null?void 0:t.template)==null?void 0:i.fields)||(t==null?void 0:t.template)||{},l=ft(e.unitPriceUsd??(t==null?void 0:t.unitPriceUsd)??null);if(!Number.isFinite(l))return null;const r=String(e.currency||(n==null?void 0:n.defaultCurrency)||"EUR").toUpperCase();if(r==="EUR")return l;if(r==="USD"){const s=ft(n==null?void 0:n.fxRate);return!Number.isFinite(s)||s<=0?null:l/s}return null}function W(t){return t==null||!Number.isFinite(Number(t))?"—":Number(t).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function Ct(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"—":t.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"})}function Mn(t,n){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[e,l]=t.split("-").map(Number);if(!Number.isFinite(e)||!Number.isFinite(l))return null;const r=String(n).toUpperCase();let i=1;return r==="MID"&&(i=15),r==="END"&&(i=new Date(e,l,0).getDate()),new Date(Date.UTC(e,l-1,i))}function Dn(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"—":t.toISOString().slice(0,10)}function Un(t){const n=it((t==null?void 0:t.etdManual)||(t==null?void 0:t.etdDate));if(n)return n;const e=it(t==null?void 0:t.orderDate);if(!e)return null;const l=Number((t==null?void 0:t.prodDays)||0),r=new Date(e.getTime());return r.setDate(r.getDate()+Math.max(0,l)),r}function pe(t){const n=new Map,e=new Set;function l(i,s){n.has(i)||n.set(i,new Map);const d=n.get(i);return d.has(s)||d.set(s,{events:[],hasPo:!1,hasFo:!1,poUnits:0,foUnits:0}),d.get(s)}function r(i,s,d){const m=l(i,s),E=m.events.find(y=>y.type===d.type&&y.id===d.id);E?E.qty+=d.qty:m.events.push({...d}),d.type==="PO"&&(m.hasPo=!0,m.poUnits+=d.qty),d.type==="FO"&&(m.hasFo=!0,m.foUnits+=d.qty)}return(t.pos||[]).forEach(i=>{if(!i||String(i.status||"").toUpperCase()==="CANCELLED")return;const s=Array.isArray(i.items)&&i.items.length?i.items:[{sku:i.sku,units:i.units}],m=it(i.arrivalDate)||fe(i),E=m?de(m):null;s.forEach(y=>{const S=String((y==null?void 0:y.sku)||"").trim();if(!S)return;const U=ft((y==null?void 0:y.units)??0),v=Number.isFinite(U)?Math.round(U):0;if(!E){e.add(S);return}r(S,E,{type:"PO",id:String(i.id||i.poNo||S),label:i.poNo||i.id||"PO",supplier:Wt(t,i.supplierId||i.supplier),qty:v,date:m?m.toISOString().slice(0,10):"—",route:"#po",open:i.id||i.poNo||""})})}),(t.fos||[]).forEach(i=>{if(!i||!We(i))return;const s=Array.isArray(i.items)&&i.items.length?i.items:[{sku:i.sku,units:i.units}],m=it(i.arrivalDate)||qe(i),E=m?de(m):null;E&&s.forEach(y=>{const S=String((y==null?void 0:y.sku)||"").trim();if(!S)return;const U=ft((y==null?void 0:y.units)??0),v=Number.isFinite(U)?Math.round(U):0;r(S,E,{type:"FO",id:String(i.id||i.foNo||S),label:i.foNo||i.id||"FO",supplier:Wt(t,i.supplierId||i.supplier),qty:v,date:m?m.toISOString().slice(0,10):"—",route:"#fo",open:i.id||i.foNo||""})})}),{inboundMap:n,missingEtaSkus:e}}function Nn({state:t,currentSnapshot:n,previousSnapshot:e,products:l,categories:r,currentMonth:i,asOfDate:s}){const d=t.settings||{},m=new Map;l.forEach(p=>{const b=String((p==null?void 0:p.sku)||"").trim();b&&m.set(b,p)});const E=new Map;(r||[]).forEach(p=>{(p==null?void 0:p.id)!=null&&E.set(String(p.id),p.name||"Ohne Kategorie")});const y=p=>{const b=(p==null?void 0:p.categoryId)!=null?String(p.categoryId):"";return b?{id:b,name:E.get(b)||"Ohne Kategorie"}:{id:"uncategorized",name:"Ohne Kategorie"}},S=p=>{const b=m.get(p);return Yt(b,d)},U=()=>({measuredPrev:0,measuredCurr:0,inboundEur:0,salesEur:0,hasMissingEk:!1}),v=new Map,w=(p,b)=>(v.has(p)||v.set(p,{id:p,name:b,...U()}),v.get(p)),F=(p,b)=>{p&&(p.items||[]).forEach(M=>{const $=String(M.sku||"").trim();if(!$)return;const C=m.get($);if(!C)return;const P=Number(M.amazonUnits||0)+Number(M.threePLUnits||0),I=S($),Z=y(C),_=w(Z.id,Z.name);if(!Number.isFinite(I)){_.hasMissingEk=!0;return}_[b]+=P*I})};F(e,"measuredPrev"),F(n,"measuredCurr");const N=ne(i),{inboundMap:z}=pe(t);z.forEach((p,b)=>{const M=p.get(N);if(!M)return;const $=(M.poUnits||0)+(M.foUnits||0);if(!$)return;const C=m.get(b);if(!C)return;const P=S(b),I=y(C),Z=w(I.id,I.name);if(!Number.isFinite(P)){Z.hasMissingEk=!0;return}Z.inboundEur+=$*P}),l.forEach(p=>{const b=String((p==null?void 0:p.sku)||"").trim();if(!b)return;const M=Re(t,b,N);if(!Number.isFinite(M)||!M)return;const $=S(b),C=y(p),P=w(C.id,C.name);if(!Number.isFinite($)){P.hasMissingEk=!0;return}P.salesEur+=M*$});const q=Array.from(v.values()).map(p=>{const b=p.measuredCurr-p.measuredPrev,M=p.inboundEur-p.salesEur;return{...p,measuredDelta:b,expectedDelta:M,discrepancy:b-M}}).sort((p,b)=>Math.abs(b.discrepancy)-Math.abs(p.discrepancy)),Q=q.reduce((p,b)=>(p.measuredPrev+=b.measuredPrev,p.measuredCurr+=b.measuredCurr,p.measuredDelta+=b.measuredDelta,p.inboundEur+=b.inboundEur,p.salesEur+=b.salesEur,p.expectedDelta+=b.expectedDelta,p.discrepancy+=b.discrepancy,b.hasMissingEk&&(p.hasMissingEk=!0),p),{measuredPrev:0,measuredCurr:0,measuredDelta:0,inboundEur:0,salesEur:0,expectedDelta:0,discrepancy:0,hasMissingEk:!1});return{currentMonth:N,previousMonth:(e==null?void 0:e.month)||null,perCategory:q,totals:Q,forecastIsSurrogate:!0}}function Fn(t,n){const e=me(n)||new Date,l=t.settings||{},r=new Map;(t.products||[]).forEach(s=>{const d=String((s==null?void 0:s.sku)||"").trim();d&&r.set(d,s)});const i=[];return(t.pos||[]).forEach(s=>{if(!s||s.archived)return;const d=String(s.status||"").toUpperCase();if(d==="CANCELLED"||d==="ARRIVED"||d==="RECEIVED")return;const m=fe(s);if(!m||m>e)return;const E=Array.isArray(s.items)&&s.items.length?s.items:[{sku:s.sku,units:s.units}];let y=0,S=0,U=!1;E.forEach(v=>{const w=String((v==null?void 0:v.sku)||"").trim();if(!w)return;const F=Math.round(ft((v==null?void 0:v.units)??0)||0);y+=F;const N=r.get(w),z=Yt(N,l);if(!Number.isFinite(z)){U=!0;return}S+=F*z}),i.push({id:s.id||s.poNo||"",label:s.poNo||s.id||"PO",supplier:Wt(t,s.supplierId||s.supplier),etaDate:m,etaLabel:Ct(m),ageDays:Math.max(0,Math.round((e-m)/(24*60*60*1e3))),units:y,valueEur:S,hasMissingEk:U})}),i.sort((s,d)=>d.ageDays-s.ageDays),i}function _e(t,n){const e=new Map,l=new Date,r=me(n)||l,i=(s,d)=>{e.has(s)||e.set(s,{total:0,entries:[]});const m=e.get(s);m.total+=d.qty,m.entries.push(d)};return(t.pos||[]).forEach(s=>{if(!s||s.archived||String(s.status||"").toUpperCase()==="CANCELLED")return;const d=it(s.orderDate);if(d&&d>r)return;const m=it(s.arrivalDate)||it(s.etaManual)||fe(s);if(m&&m<=r)return;const E=Un(s);(Array.isArray(s.items)&&s.items.length?s.items:[{sku:s.sku,units:s.units}]).forEach(S=>{const U=String((S==null?void 0:S.sku)||"").trim();if(!U)return;const v=ft((S==null?void 0:S.units)??0),w=Number.isFinite(v)?Math.round(v):0;w&&i(U,{type:"PO",id:String(s.id||s.poNo||U),label:s.poNo||s.id||"PO",supplier:Wt(t,s.supplierId||s.supplier),qty:w,etd:E?Ct(E):"—",eta:m?Ct(m):"—",route:"#po",open:s.id||s.poNo||""})})}),(t.fos||[]).forEach(s=>{if(!s||!We(s))return;const d=it(s.orderDate);if(d&&d>r)return;const m=it(s.arrivalDate)||qe(s);if(m&&m<=r)return;(Array.isArray(s.items)&&s.items.length?s.items:[{sku:s.sku,units:s.units}]).forEach(y=>{const S=String((y==null?void 0:y.sku)||"").trim();if(!S)return;const U=ft((y==null?void 0:y.units)??0),v=Number.isFinite(U)?Math.round(U):0;v&&i(S,{type:"FO",id:String(s.id||s.foNo||S),label:s.foNo||s.id||"FO",supplier:Wt(t,s.supplierId||s.supplier),qty:v,etd:"—",eta:m?Ct(m):"—",route:"#fo",open:s.id||s.foNo||""})})}),e}function Tn({alias:t,month:n,events:e}){if(!e||!e.length)return"";const l=e.map(r=>`
    <div class="inventory-tooltip-row">
      <div>
        <strong>${f(r.type)} ${f(r.label)}</strong>
        <div class="muted">${f(r.supplier||"—")}</div>
      </div>
      <div class="inventory-tooltip-meta">
        <div>${K(r.qty)}</div>
        <div class="muted">${f(r.date||"—")}</div>
      </div>
    </div>
    <div class="inventory-tooltip-actions">
      <button class="btn sm secondary inventory-link" type="button" data-route="${r.route}" data-open="${f(r.open)}">${r.type==="FO"?"Open FO":"Open PO"}</button>
    </div>
  `).join("");return`
    <div class="inventory-tooltip">
      <div class="inventory-tooltip-header">
        <div class="inventory-tooltip-title">Inbound arrivals in ${Ht(n)}</div>
        <div class="inventory-tooltip-alias">${f(t)}</div>
      </div>
      <div class="inventory-tooltip-body">${l}</div>
    </div>
  `}function Pn({alias:t,entries:n}){if(!n||!n.length)return"";const e=n.map(l=>`
    <div class="inventory-tooltip-row">
      <div>
        <strong>${f(l.type)} ${f(l.label)}</strong>
        <div class="muted">${f(l.supplier||"—")}</div>
      </div>
      <div class="inventory-tooltip-meta">
        <div>${K(l.qty)}</div>
        <div class="muted">ETD ${f(l.etd)} · ETA ${f(l.eta)}</div>
      </div>
    </div>
    <div class="inventory-tooltip-actions">
      <button class="btn sm secondary inventory-link" type="button" data-route="${l.route}" data-open="${f(l.open)}">Open ${l.type}</button>
    </div>
  `).join("");return`
    <div class="inventory-tooltip">
      <div class="inventory-tooltip-header">
        <div class="inventory-tooltip-title">In Transit</div>
        <div class="inventory-tooltip-alias">${f(t||"—")}</div>
      </div>
      <div class="inventory-tooltip-body">${e}</div>
    </div>
  `}function ue(t){return encodeURIComponent(t||"")}const qt=new Map;function te(t,n,e){return`${t||"unknown"}:${n}:${e}`}function Et(t){if(t==null||!Number.isFinite(Number(t)))return"—";const n=Number(t);return`${n>0?"+":n<0?"−":""}${W(Math.abs(n))}`}function ze(t,n){const e=t-n,l=Math.abs(e),r=Math.max(Math.abs(t),Math.abs(n),1),i=l/r;return l<500?"ok":l<2e3?i<.5?"ok":"warn":i<.3?"ok":i<.6?"warn":"bad"}function An({reconciliation:t,stalePos:n,currentMonth:e,previousMonth:l}){const r=t.totals,i=ze(r.measuredDelta,r.expectedDelta),s=i==="ok"?"Plausibel":i==="warn"?"Auffällig":"Stark abweichend",d=`reco-status-${i}`,m=e?ce(e):"—",E=l?ce(l):"—",y=r.hasMissingEk?'<span class="cell-warning" title="Mindestens ein Produkt ohne EK">⚠︎ EK fehlt teils</span>':"",S=t.perCategory.length?t.perCategory.map(v=>`
          <tr class="reco-cat-row reco-cat-${ze(v.measuredDelta,v.expectedDelta)}">
            <td>${f(v.name)}${v.hasMissingEk?' <span class="cell-warning" title="EK fehlt">⚠︎</span>':""}</td>
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
              <tr data-stale-po="${f(v.id)}">
                <td>${f(v.label)}</td>
                <td>${f(v.supplier||"—")}</td>
                <td class="num">${f(v.etaLabel)}</td>
                <td class="num">${K(v.ageDays)}</td>
                <td class="num">${K(v.units)}</td>
                <td class="num">${v.hasMissingEk?"⚠︎ ":""}${W(v.valueEur)}</td>
                <td><button class="btn sm secondary reco-archive-one" data-po-id="${f(v.id)}">Archivieren</button></td>
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
    <div class="reco-panel ${d}">
      <div class="reco-head">
        <div>
          <h3>Plausi-Check ${f(E)} → ${f(m)}</h3>
          <p class="muted small">
            Vergleicht die gemessene Bestandsveränderung (Snapshot-Δ in EUR, ohne In-Transit) gegen die erwartete (PO/FO-Eingänge − Verkaufs-Forecast).
            Verkäufe geschätzt aus Forecast — echte Sales-Daten fehlen.
          </p>
        </div>
        <div class="reco-status-pill">${f(s)} ${y}</div>
      </div>
      <div class="reco-headline-grid">
        <div class="reco-kpi">
          <span class="muted small">Bestandsveränderung gemessen</span>
          <strong class="reco-kpi-value">${Et(r.measuredDelta)}</strong>
          <span class="muted small">${W(r.measuredPrev)} → ${W(r.measuredCurr)}</span>
        </div>
        <div class="reco-kpi">
          <span class="muted small">Erwartete Veränderung</span>
          <strong class="reco-kpi-value">${Et(r.expectedDelta)}</strong>
          <span class="muted small">Wareneingänge ${W(r.inboundEur)} − Verkäufe ${W(r.salesEur)}</span>
        </div>
        <div class="reco-kpi reco-kpi-diff">
          <span class="muted small">Diskrepanz (Phantom-Bestand)</span>
          <strong class="reco-kpi-value">${Et(r.discrepancy)}</strong>
          <span class="muted small">Δ gemessen − Δ erwartet</span>
        </div>
      </div>
      <details class="reco-breakdown" ${i==="ok"?"":"open"}>
        <summary>Aufschlüsselung pro Kategorie (sortiert nach Diskrepanz)</summary>
        <table class="table-compact ui-table-standard reco-category-table">
          <thead>
            <tr>
              <th>Kategorie</th>
              <th class="num">Bestand ${f(E)} €</th>
              <th class="num">Bestand ${f(m)} €</th>
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
              <td class="num"><strong>${W(r.measuredPrev)}</strong></td>
              <td class="num"><strong>${W(r.measuredCurr)}</strong></td>
              <td class="num"><strong>${Et(r.measuredDelta)}</strong></td>
              <td class="num"><strong>${W(r.inboundEur)}</strong></td>
              <td class="num"><strong>${W(r.salesEur)}</strong></td>
              <td class="num"><strong>${Et(r.expectedDelta)}</strong></td>
              <td class="num"><strong>${Et(r.discrepancy)}</strong></td>
            </tr>
          </tbody>
        </table>
      </details>
      ${U}
    </div>
  `}function Ln({state:t,view:n,snapshot:e,previousSnapshot:l,products:r,categories:i,asOfDate:s,snapshotMonth:d}){const m=_t(r,n.search),E=n.snapshotViewMode==="eur"?"eur":"units",y=E==="eur",S=ee(m,i),U=new Map;((l==null?void 0:l.items)||[]).forEach(b=>{const M=String(b.sku||"").trim();M&&U.set(M,b)});const v=_e(t,s),w={amazonUnits:0,threePLUnits:0,totalUnits:0,inTransit:0,totalValue:0,amazonEur:0,threePlEur:0,totalEur:0,inTransitEur:0,deltaUnits:0,deltaEur:0,valueComplete:!0},F=b=>K(b),N=b=>Number.isFinite(b)?W(b):"—",z=S.map(b=>{const M=n.collapsed[b.id],$={amazonUnits:0,threePLUnits:0,totalUnits:0,inTransit:0,totalValue:0,amazonEur:0,threePlEur:0,totalEur:0,inTransitEur:0,deltaUnits:0,deltaEur:0,valueComplete:!0},C=b.items.map(_=>{const Y=String(_.sku||"").trim(),B=he(e,Y),pt=v.get(Y),gt=pt?pt.total:0,ct=U.get(Y),kt=Number((B==null?void 0:B.amazonUnits)||0),St=Number((B==null?void 0:B.threePLUnits)||0),dt=kt+St,nt=dt+gt,xt=((ct==null?void 0:ct.amazonUnits)||0)+((ct==null?void 0:ct.threePLUnits)||0),j=dt-xt,x=Yt(_,t.settings||{}),O=Number.isFinite(x)?nt*x:null,tt=Number.isFinite(x)?kt*x:null,G=Number.isFinite(x)?St*x:null,bt=Number.isFinite(x)?dt*x:null,$t=Number.isFinite(x)?gt*x:null,J=Number.isFinite(x)?j*x:null,R=!Number.isFinite(x),ut=pt&&pt.entries.length?Pn({alias:_.alias||Y,entries:pt.entries}):"";$.amazonUnits+=kt,$.threePLUnits+=St,$.totalUnits+=dt,$.inTransit+=gt,$.deltaUnits+=j,R?$.valueComplete=!1:($.totalValue+=O,$.amazonEur+=tt,$.threePlEur+=G,$.totalEur+=bt,$.inTransitEur+=$t,$.deltaEur+=J);const Ut=qt.get(te(d,Y,"amazonUnits")),Mt=qt.get(te(d,Y,"threePLUnits")),mt=y?`<td class="num inventory-value" data-field="amazonEur">${N(tt)}</td>`:`<td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="amazonUnits" value="${f(Ut??String((B==null?void 0:B.amazonUnits)??0))}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>`,jt=y?`<td class="num inventory-value" data-field="threePlEur">${N(G)}</td>`:`<td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="threePLUnits" value="${f(Mt??String((B==null?void 0:B.threePLUnits)??0))}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>`,zt=y?`<td class="num inventory-value" data-field="totalEur">${N(bt)}</td>`:`<td class="num inventory-value" data-field="totalUnits">${F(dt)}</td>`,wt=y?`<td class="num inventory-value inventory-in-transit" data-field="inTransitEur" data-tooltip-html="${ue(ut)}">${N($t)}</td>`:`<td class="num inventory-value inventory-in-transit" data-tooltip-html="${ue(ut)}">${F(gt)}</td>`,Ot=y?`<td class="num inventory-value" data-field="deltaEur">${N(J)}</td>`:`<td class="num inventory-value" data-field="delta">${F(j)}</td>`;return`
        <tr class="inventory-row ${M?"is-collapsed":""}" data-sku="${f(Y)}" data-category="${f(b.id)}">
          <td class="inventory-col-sku sticky-cell">${f(Y)}</td>
          <td class="inventory-col-alias sticky-cell">${f(_.alias||"—")}</td>
          ${mt}
          ${jt}
          ${zt}
          ${wt}
          <td class="num">
            ${R?'<span class="cell-warning" title="EK fehlt im Produkt">⚠︎</span>':""}
            <span data-field="ekEur">${Number.isFinite(x)?W(x):"—"}</span>
          </td>
          <td class="num inventory-value" data-field="totalValue">${Number.isFinite(O)?W(O):"—"}</td>
          ${Ot}
          <td><input class="inventory-input note" data-field="note" value="${f((B==null?void 0:B.note)||"")}" /></td>
        </tr>
      `}).join("");w.amazonUnits+=$.amazonUnits,w.threePLUnits+=$.threePLUnits,w.totalUnits+=$.totalUnits,w.inTransit+=$.inTransit,w.deltaUnits+=$.deltaUnits,$.valueComplete?(w.totalValue+=$.totalValue,w.amazonEur+=$.amazonEur,w.threePlEur+=$.threePlEur,w.totalEur+=$.totalEur,w.inTransitEur+=$.inTransitEur,w.deltaEur+=$.deltaEur):w.valueComplete=!1;const P=`Zwischensumme ${b.name}`,I=$.valueComplete?"":' <span class="cell-warning" title="Mindestens ein Produkt ohne EK">⚠︎</span>',Z=y?`
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
        <tr class="inventory-category-row" data-category-row="${f(b.id)}">
          <th class="inventory-col-sku sticky-cell" colspan="2">
            <button type="button" class="tree-toggle" data-category="${f(b.id)}">${M?"▸":"▾"}</button>
            <span class="tree-label">${f(b.name)}</span>
            <span class="muted">(${b.items.length})</span>
          </th>
          <th colspan="8"></th>
        </tr>
        ${C}
        <tr class="inventory-subtotal-row ${M?"is-collapsed":""}" data-category-subtotal="${f(b.id)}">
          <td class="inventory-col-sku sticky-cell" colspan="2"><strong>${f(P)}</strong></td>
          ${Z}
        </tr>
      `}).join(""),q=w.valueComplete?"":' <span class="cell-warning" title="Mindestens ein Produkt ohne EK">⚠︎</span>',Q=y?`
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
    <table class="table-compact ui-table-standard inventory-table inventory-snapshot-table" data-ui-table="true" data-sticky-cols="2" data-sticky-owner="manual" data-view-mode="${f(E)}">
      <thead>
        <tr>
          <th class="inventory-col-sku sticky-header">SKU</th>
          <th class="inventory-col-alias sticky-header">Alias</th>
          <th class="num">${y?"Amazon €":"Amazon Units"}</th>
          <th class="num">${y?"3PL €":"3PL Units"}</th>
          <th class="num">${y?"Total €":"Total Units"}</th>
          <th class="num">${y?"In Transit €":"In Transit"}</th>
          <th class="num">EK (EUR)</th>
          <th class="num">Warenwert €</th>
          <th class="num">${y?"Delta € vs prev":"Delta vs prev"}</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        ${z||'<tr><td class="muted" colspan="10">Keine Produkte gefunden.</td></tr>'}
        ${p}
      </tbody>
    </table>
  `}function Lt(t,n=";"){const e=String(t??"");return e?e.includes('"')||e.includes(`
`)||e.includes(n)?`"${e.replace(/"/g,'""')}"`:e:""}function lt(t){return t==null||!Number.isFinite(Number(t))?"":Math.round(Number(t)).toLocaleString("de-DE",{maximumFractionDigits:0})}function vt(t){return t==null||!Number.isFinite(Number(t))?"":Number(t).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function Cn({state:t,view:n,snapshot:e,products:l,categories:r,asOfDate:i}){const s=_t(l,n.search),d=ee(s,r),m=_e(t,i),E=new Map;((e==null?void 0:e.items)||[]).forEach(z=>{const q=String(z.sku||"").trim();q&&E.set(q,z)});const y=[],S=[];let U=0,v=0,w=0,F=0,N=0;return d.forEach(z=>{z.items.forEach(q=>{const Q=String(q.sku||"").trim();if(!Q)return;const p=q.alias||"",b=E.get(Q)||{amazonUnits:0,threePLUnits:0},M=Number((b==null?void 0:b.amazonUnits)||0),$=Number((b==null?void 0:b.threePLUnits)||0),C=m.get(Q),P=C?C.total:0,I=Yt(q,t.settings||{}),Z=M+$+P,_=M+$,Y=Number.isFinite(I)?Z*I:null,B=Number.isFinite(I)?_*I:null;Number.isFinite(I)||S.push(p?`${Q} (${p})`:Q),Number.isFinite(M)&&(U+=M),Number.isFinite($)&&(v+=$),Number.isFinite(P)&&(w+=P),Number.isFinite(Y)&&(F+=Y),Number.isFinite(B)&&(N+=B),y.push({sku:Q,alias:p,amazonUnits:M,threePlUnits:$,inTransitUnits:P,ekEur:I,rowValue:Y,rowValueWarehouse:B})})}),{rows:y,totals:{amazonUnits:U,majamoUnits:v,inTransitUnits:w,totalUnits:U+v+w,totalValue:F,totalValueWarehouse:N},missingEk:S}}function jn({title:t,rows:n,totals:e,missingEk:l}){const r=";",i=[];t&&(i.push(Lt(t,r)),i.push(""));const s=["SKU","Alias","Bestand Amazon (Stk)","Bestand majamo (Stk)","In Transit (Stk)","EK-Preis (EUR / Stk)","Warenwert ohne In-Transit (EUR)","Warenwert inkl. In-Transit (EUR)"];i.push(s.map(m=>Lt(m,r)).join(r)),n.forEach(m=>{const E=[m.sku,m.alias,lt(m.amazonUnits),lt(m.threePlUnits),lt(m.inTransitUnits),vt(m.ekEur),vt(m.rowValueWarehouse),vt(m.rowValue)];i.push(E.map(y=>Lt(y,r)).join(r))});const d=["Gesamtsumme","",lt(e.amazonUnits),lt(e.majamoUnits),lt(e.inTransitUnits),"",vt(e.totalValueWarehouse),vt(e.totalValue)];return i.push(d.map(m=>Lt(m,r)).join(r)),i.push(""),i.push(Lt("Hinweis: 'Warenwert ohne In-Transit' = nur physisch im Lager (Amazon + majamo). Für BWA-Bestandsbewertung typischerweise diese Spalte verwenden, sofern In-Transit-Eigentum erst beim Eintreffen übergeht.",r)),l.length&&(i.push(""),i.push(Lt(`Fehlender EK-Preis für: ${l.join(", ")}`,r))),i.join(`
`)}function zn({title:t,fileName:n,rows:e,totals:l,missingEk:r,generatedAt:i}){const s=e.map(E=>`
      <tr>
        <td>${f(E.sku)}</td>
        <td>${f(E.alias||"")}</td>
        <td class="num">${lt(E.amazonUnits)}</td>
        <td class="num">${lt(E.threePlUnits)}</td>
        <td class="num">${lt(E.inTransitUnits)}</td>
        <td class="num">${vt(E.ekEur)}</td>
        <td class="num">${vt(E.rowValueWarehouse)}</td>
        <td class="num">${vt(E.rowValue)}</td>
      </tr>
  `).join(""),d=`
      <tr class="totals">
        <td>Gesamtsumme</td>
        <td></td>
        <td class="num">${lt(l.amazonUnits)}</td>
        <td class="num">${lt(l.majamoUnits)}</td>
        <td class="num">${lt(l.inTransitUnits)}</td>
        <td class="num"></td>
        <td class="num">${vt(l.totalValueWarehouse)}</td>
        <td class="num">${vt(l.totalValue)}</td>
      </tr>
  `,m=r.length?`<div class="warning">Fehlender EK-Preis für: ${f(r.join(", "))}</div>`:"";return`
    <!doctype html>
    <html lang="de">
      <head>
        <meta charset="utf-8" />
        <title>${f(n||t)}</title>
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
        <h1>${f(t)}</h1>
        <div class="meta">Erstellt am: ${f(i)}</div>
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
            ${d}
          </tbody>
        </table>
        <p class="hint">Hinweis: "Warenwert ohne In-Transit" = nur physisch im Lager (Amazon + majamo). Für BWA-Bestandsbewertung typischerweise diese Spalte verwenden.</p>
        ${m}
        <script>
          window.addEventListener("load", () => {
            setTimeout(() => window.print(), 250);
          });
        <\/script>
      </body>
    </html>
  `}function On({state:t,view:n,snapshot:e,products:l,categories:r,months:i,projectionData:s=null,inboundData:d=null}){const m=_t(l,n.search),E=ee(m,r),y=new Map,S=s||Oe({state:t,months:i,products:m,snapshot:e,projectionMode:n.projectionMode}),U=S.months;m.forEach(p=>{const b=String((p==null?void 0:p.sku)||"").trim();if(!b)return;const M=new Map;U.forEach($=>{var P;const C=(P=S.perSkuMonth.get(b))==null?void 0:P.get($);Number.isFinite(C==null?void 0:C.forecastUnits)&&M.set($,C.forecastUnits)}),y.set(b,M)});const v=n.projectionMode==="plan"?xn(E,y,i):new Map,w=new Map;((e==null?void 0:e.items)||[]).forEach(p=>{const b=String(p.sku||"").trim();b&&w.set(b,p)});const{inboundMap:F,missingEtaSkus:N}=d||pe(t),z=fn(t).bySku,q=E.map(p=>{const b=n.collapsed[p.id],M=p.items.map(C=>{var dt;const P=String(C.sku||"").trim(),I=C.alias||"—",Z=((dt=z==null?void 0:z.get(P.toLowerCase()))==null?void 0:dt.abcClass)||"—",_=pn(C,t),Y=yn(C,t),B=Number.isFinite(_)?K(_):"—",pt=Number.isFinite(Y)?K(Y):"—",gt=`
        <button class="inventory-drilldown-trigger" type="button" data-action="open-drilldown" data-sku="${f(P)}" data-alias="${f(I)}" title="SKU Verlauf öffnen" aria-label="SKU Verlauf öffnen">
          <span aria-hidden="true">&#128200;</span>
        </button>
      `;let ct=0;const kt=i.map(nt=>{var Vt;const xt=F.get(P),j=xt?xt.get(nt):null;j&&j.poUnits+j.foUnits;const x=(Vt=S.perSkuMonth.get(P))==null?void 0:Vt.get(nt),O=(x==null?void 0:x.forecastUnits)??null,tt=(x==null?void 0:x.endAvailable)??null,G=(x==null?void 0:x.forecastMissing)??!0,bt=Number.isFinite(x==null?void 0:x.safetyUnits)?x.safetyUnits:null,$t=Number.isFinite(x==null?void 0:x.safetyDays)?x.safetyDays:null,J=Number.isFinite(x==null?void 0:x.daysToOos)?x.daysToOos:null,R=j!=null&&j.hasPo&&(j!=null&&j.hasFo)?"inventory-cell inbound-both":j!=null&&j.hasPo?"inventory-cell inbound-po":j!=null&&j.hasFo?"inventory-cell inbound-fo":"inventory-cell",ut=(x==null?void 0:x.doh)??null,Ut=n.projectionMode==="doh",Mt=n.projectionMode==="plan",mt=Ut?Number.isFinite(ut)&&ut<=0:Number.isFinite(tt)&&tt<=0,jt=Mt?Number.isFinite(O)?K(O):"—":G?"—":mt?'0 <span class="inventory-warning-icon">⚠︎</span>':Ut?ut==null?"—":K(ut):K(tt),zt=Mt?"":Ve({endAvailable:tt,safetyUnits:bt,doh:ut,safetyDays:$t,daysToOos:J,projectionMode:n.projectionMode}),wt=Mt?"":G?"incomplete":"",Ot=j?`
            ${j.hasPo?'<span class="inventory-inbound-marker po"></span>':""}
            ${j.hasFo?'<span class="inventory-inbound-marker fo"></span>':""}
          `:"",Nt=j?Tn({alias:I,month:nt,events:j.events}):"",se=Nt?Nt.replace(/\s+/g," ").trim():"",Ft=Nt?`inventory-inbound-${P}-${nt}-${ct++}`:"";return`
          <td class="num ${R} ${zt} ${wt} inventory-projection-cell" data-month="${f(nt)}" ${Nt?`data-tooltip-html="${ue(se)}"`:""} ${Ft?`data-tooltip-id="${Ft}"`:""}>
            <span class="inventory-cell-value">${jt}</span>
            ${Ot}
          </td>
        `}).join(""),St=N.has(P)?'<span class="cell-warning" title="PO ohne ETA wird nicht gezählt">⚠︎</span>':"";return`
        <tr class="inventory-row ${b?"is-collapsed":""}" data-sku="${f(P)}" data-category="${f(p.id)}">
          <td class="inventory-col-sku sticky-cell">${St}${f(P)}</td>
          <td class="inventory-col-alias sticky-cell">
            <div class="inventory-alias-cell">
              <span class="inventory-alias-text">${f(I)}</span>
              ${gt}
            </div>
          </td>
          <td class="inventory-col-abc sticky-cell">${f(Z)}</td>
          <td class="inventory-col-safety-days sticky-cell num">${f(B)}</td>
          <td class="inventory-col-coverage-days sticky-cell num">${f(pt)}</td>
          ${kt}
        </tr>
      `}).join(""),$=n.projectionMode==="plan"?i.map(C=>{var _;const P=ne(C),I=(_=v.get(p.id))==null?void 0:_.get(P);return`<td class="num inventory-projection-group-cell">${Number.isFinite(I)?K(I):"—"}</td>`}).join(""):`<th colspan="${i.length}"></th>`;return`
      <tr class="inventory-category-row" data-category-row="${f(p.id)}">
        <th class="inventory-col-sku sticky-cell" colspan="5">
          <button type="button" class="tree-toggle" data-category="${f(p.id)}">${b?"▸":"▾"}</button>
          <span class="tree-label">${f(p.name)}</span>
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
          ${i.map(p=>`<th class="num">${Ht(p)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${q||`<tr><td class="muted" colspan="${i.length+5}">Keine Produkte gefunden.</td></tr>`}
      </tbody>
    </table>
  `}function Vn(t,n,e,l,r){var Q;if(!t||!n||!l)return;const i=String(l.sku||"").trim(),s=he(n,i),d=(Q=e==null?void 0:e.items)==null?void 0:Q.find(p=>String(p.sku||"").trim()===i),m=Number(s.amazonUnits||0)+Number(s.threePLUnits||0),E=((d==null?void 0:d.amazonUnits)||0)+((d==null?void 0:d.threePLUnits)||0),y=m-E,S=t.querySelector(".inventory-in-transit"),U=ft((S==null?void 0:S.textContent)||0),v=m+(Number.isFinite(U)?U:0),w=Yt(l,r.settings||{}),F=Number.isFinite(w)?v*w:null,N=t.querySelector('[data-field="totalUnits"]'),z=t.querySelector('[data-field="delta"]'),q=t.querySelector('[data-field="totalValue"]');N&&(N.textContent=K(m)),z&&(z.textContent=K(y)),q&&(q.textContent=Number.isFinite(F)?W(F):"—")}function et(t){var we,Ee,ke;const n=un(),e=kn(),l=window.__routeQuery||{},r=String(l.sku||"").trim(),i=String(l.month||"").trim();r&&(e.search="",e.projectionMode="doh"),/^\d{4}-\d{2}$/.test(i)&&(e.selectedMonth=Ke(i,-1));const s=Sn(n,e);e.selectedMonth=s,ot(e),t._inventoryCleanup&&(t._inventoryCleanup(),t._inventoryCleanup=null);const d=He(n,s)||{month:s,items:[]},m=je(n,s),E=Array.isArray(n.productCategories)?n.productCategories:[],y=(n.products||[]).filter(En),S=gn(e.snapshotAsOfDate),U=S?de(S):null;let v=S&&U===s?S:bn(s);v||(v=new Date),(!S||U!==s)&&(e.snapshotAsOfDate=Jt(v),ot(e));const w=me(v);if(r){const a=y.find(u=>String((u==null?void 0:u.sku)||"").trim()===r);(a==null?void 0:a.categoryId)!=null&&(e.collapsed[String(a.categoryId)]=!1,ot(e))}const F=Number(((Ee=(we=n.inventory)==null?void 0:we.settings)==null?void 0:Ee.projectionMonths)||12),N=[6,12,18],z=vn(s,N.includes(F)?F:12),q=_t(y,e.search),Q=Oe({state:n,months:z,products:q,snapshot:d,projectionMode:e.projectionMode}),p=pe(n),b=e.projectionMode==="plan",M=Cn({state:n,view:e,snapshot:d,products:y,categories:E,asOfDate:w}),$=M.missingEk.length,C=Nn({state:n,currentSnapshot:d,previousSnapshot:m,products:y,categories:E,currentMonth:s,asOfDate:w}),P=Fn(n,w),I=m?An({reconciliation:C,stalePos:P,currentMonth:s,previousMonth:m.month}):'<div class="reco-panel reco-status-empty"><div class="muted small">Plausi-Check verfügbar sobald ein Vormonats-Snapshot existiert.</div></div>';t.innerHTML=`
    <section class="card inventory-card">
      <div class="inventory-header ui-page-head">
        <div>
          <h2>Inventory</h2>
          <p class="muted">Month-end Snapshots und Bestandsplanung. Lokal gespeichert.</p>
        </div>
        <div class="inventory-search">
          <input type="search" placeholder="SKU oder Alias suchen" value="${f(e.search)}" />
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
        <span class="muted small">${m?`Vorheriger Snapshot: ${Ht(m.month)}`:"Kein vorheriger Snapshot vorhanden."}</span>
      </div>
      <div class="inventory-export">
        <div class="inventory-export-controls">
          <label class="inventory-field">
            <span class="muted">Bestandsaufnahme zum</span>
            <input type="date" id="inventory-export-date" value="${f(Jt(v))}" />
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
          ${Ln({state:n,view:e,snapshot:d,previousSnapshot:m,products:y,categories:E,asOfDate:w,snapshotMonth:s})}
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
          ${On({state:n,view:e,snapshot:d,products:y,categories:E,months:z,projectionData:Q,inboundData:p})}
        </div>
      </div>
      <div class="inventory-legend">
        ${b?"":`
          <span class="inventory-legend-item"><span class="legend-swatch safety-negative"></span> Stockout / unter Safety</span>
          <span class="inventory-legend-item"><span class="legend-swatch safety-low"></span> Unter Safety (OOS &lt; Safety-Tage)</span>
        `}
        <span class="inventory-legend-item"><span class="legend-swatch inbound-po"></span> Inbound PO</span>
        <span class="inventory-legend-item"><span class="legend-swatch inbound-fo"></span> Inbound FO</span>
      </div>
    </section>
    <div id="inventory-tooltip-layer" class="inventory-tooltip-layer" hidden></div>
  `;const Z=t.querySelector("#inventory-month");if(Z){const a=(((ke=n.inventory)==null?void 0:ke.snapshots)||[]).map(o=>o==null?void 0:o.month).filter(o=>/^\d{4}-\d{2}$/.test(o)),u=new Set([...a,Be(),s]),h=Array.from(u).sort();Z.innerHTML=h.map(o=>`<option value="${o}" ${o===s?"selected":""}>${Ht(o)}</option>`).join(""),Z.addEventListener("change",o=>{e.selectedMonth=o.target.value,ot(e),et(t)})}const _=t.querySelector("#inventory-export-date");_&&_.addEventListener("change",a=>{e.snapshotAsOfDate=a.target.value,ot(e),et(t)});const Y=t.querySelector("#inventory-export-csv");Y&&Y.addEventListener("click",()=>{if(!M.rows.length){window.alert("Keine Daten für den Export vorhanden.");return}const a=Ae(v),u=jn({title:a,rows:M.rows,totals:M.totals,missingEk:M.missingEk}),h=`bestandsaufnahme_${Jt(v)}.csv`,o=new Blob([u],{type:"text/csv"}),c=URL.createObjectURL(o),k=document.createElement("a");k.href=c,k.download=h,document.body.append(k),k.click(),k.remove(),URL.revokeObjectURL(c)});const B=t.querySelector("#inventory-export-pdf");B&&B.addEventListener("click",()=>{if(!M.rows.length){window.alert("Keine Daten für den Export vorhanden.");return}const a=Ae(v),u=$n(new Date),h=`bestandsaufnahme_${Jt(v)}.pdf`,o=zn({title:a,fileName:h,rows:M.rows,totals:M.totals,missingEk:M.missingEk,generatedAt:u}),c=window.open("","_blank","noopener,noreferrer");c&&(c.document.open(),c.document.write(o),c.document.close())});const pt=t.querySelector(".inventory-search input");pt&&pt.addEventListener("input",a=>{e.search=a.target.value||"",ot(e),et(t)});const gt=t.querySelector("#inventory-copy");gt&&gt.addEventListener("click",()=>{const a=Ce(n,s),u=je(n,s);a.items=(y||[]).map(h=>{var k;const o=String(h.sku||"").trim(),c=(k=u==null?void 0:u.items)==null?void 0:k.find(T=>String(T.sku||"").trim()===o);return{sku:o,amazonUnits:(c==null?void 0:c.amazonUnits)??0,threePLUnits:(c==null?void 0:c.threePLUnits)??0,note:(c==null?void 0:c.note)??""}}),Zt(n),et(t)});const ct=t.querySelector("#inventory-expand-all");ct&&ct.addEventListener("click",()=>{Le({products:y,categories:E,view:e,collapsed:!1}),et(t)});const kt=t.querySelector("#inventory-collapse-all");kt&&kt.addEventListener("click",()=>{Le({products:y,categories:E,view:e,collapsed:!0}),et(t)}),t.querySelectorAll("input[name='snapshot-view-mode']").forEach(a=>{a.addEventListener("change",u=>{const h=u.target.value==="eur"?"eur":"units";e.snapshotViewMode!==h&&(e.snapshotViewMode=h,ot(e),et(t))})});const St=a=>{if(!a.length)return;const u=new Set(a.map(String));let h=0;(n.pos||[]).forEach(o=>{const c=String((o==null?void 0:o.id)||(o==null?void 0:o.poNo)||"");c&&u.has(c)&&!o.archived&&(o.archived=!0,h+=1)}),h&&(Zt(n),et(t))},dt=t.querySelector("#reco-archive-all");dt&&dt.addEventListener("click",()=>{const a=P.map(u=>u.id).filter(Boolean);a.length&&window.confirm(`${a.length} alte PO${a.length===1?"":"s"} archivieren? Sie zählen danach nicht mehr als In-Transit.`)&&St(a)}),t.querySelectorAll(".reco-archive-one").forEach(a=>{a.addEventListener("click",u=>{const h=u.currentTarget.getAttribute("data-po-id");h&&St([h])})});const nt=t.querySelector(".inventory-snapshot-table");let xt=null;const j=()=>{xt&&clearTimeout(xt),xt=setTimeout(()=>{const a=Ce(n,s);a!==d&&(a.items=d.items),Zt(n)},250)};if(nt){const a=h=>{const o=h.closest("tr[data-sku]");if(!o)return null;const c=o.getAttribute("data-sku"),k=y.find(L=>String(L.sku||"").trim()===c);if(!k)return null;const T=he(d,c),A=h.dataset.field;return{row:o,sku:c,product:k,item:T,field:A}},u=h=>{var rt;const o=a(h);if(!o)return;const{row:c,sku:k,product:T,item:A,field:L}=o;if(L!=="amazonUnits"&&L!=="threePLUnits")return;const st=te(s,k,L),H=qt.get(st)??h.value,{value:at,isRounded:yt}=wn(H);qt.delete(st),h.value=String(at),(rt=h.closest("td"))==null||rt.classList.toggle("inventory-input-warn",yt),L==="amazonUnits"&&(A.amazonUnits=at),L==="threePLUnits"&&(A.threePLUnits=at),Vn(c,d,m,T,n),j()};nt.addEventListener("click",h=>{const o=h.target.closest("button.tree-toggle[data-category]");if(!o)return;const c=o.getAttribute("data-category");e.collapsed[c]=!e.collapsed[c],ot(e),et(t)}),nt.addEventListener("input",h=>{var L;const o=h.target.closest("input.inventory-input");if(!o)return;const c=a(o);if(!c)return;const{sku:k,item:T,field:A}=c;if(A==="note"){T.note=o.value,j();return}if(A==="amazonUnits"||A==="threePLUnits"){const st=te(s,k,A);qt.set(st,o.value),(L=o.closest("td"))==null||L.classList.remove("inventory-input-warn")}}),nt.addEventListener("blur",h=>{const o=h.target.closest("input.inventory-input");if(!o)return;const c=a(o);c&&c.field!=="note"&&u(o)},!0),nt.addEventListener("keydown",h=>{if(h.key!=="Enter")return;const o=h.target.closest("input.inventory-input");if(!o)return;const c=a(o);!c||c.field==="note"||(h.preventDefault(),u(o))})}const x=t.querySelector(".inventory-projection-table");x&&(x.addEventListener("click",a=>{const u=a.target.closest("button.tree-toggle[data-category]");if(!u)return;const h=u.getAttribute("data-category");e.collapsed[h]=!e.collapsed[h],ot(e),et(t)}),x.addEventListener("click",a=>{const u=a.target.closest("button.inventory-drilldown-trigger[data-action='open-drilldown']");if(u){const A=String(u.getAttribute("data-sku")||"").trim(),L=String(u.getAttribute("data-alias")||A).trim();if(!A)return;a.preventDefault(),a.stopPropagation(),Ye({sku:A,alias:L});return}if(a.target.closest("button.tree-toggle[data-category]"))return;const o=a.target.closest("td.inventory-projection-cell");if(!o)return;const c=o.closest("tr[data-sku]");if(!c)return;const k=c.getAttribute("data-sku"),T=o.getAttribute("data-month");!k||!T||(a.stopPropagation(),zt(o,{sku:k,month:T}))}));const O=t.querySelector("#inventory-tooltip-layer");let tt=null,G=null,bt=null,$t=null,J="units",R=null;function ut(a){if(!O||O.hidden)return;const u=12,h=window.innerWidth-O.offsetWidth-8,o=window.innerHeight-O.offsetHeight-8,c=Math.min(a.clientX+u,h),k=Math.min(a.clientY+u,o);O.style.left=`${Math.max(8,c)}px`,O.style.top=`${Math.max(8,k)}px`}function Ut(a,u,h){if(!O||!u)return;let o=u;try{o=decodeURIComponent(u)}catch{o=u}O.innerHTML=o,O.hidden=!1,O.classList.add("is-visible"),tt=a,ut(h)}function Mt(){O&&(O.hidden=!0,O.classList.remove("is-visible"),O.innerHTML="",tt=null)}function mt(){G&&G.remove(),G=null,bt=null}function jt(a){if(!G||!a)return;const u=a.getBoundingClientRect(),h=8,o=window.innerWidth-G.offsetWidth-h,c=window.innerHeight-G.offsetHeight-h,k=Math.min(u.left,o),T=Math.min(u.bottom+6,c);G.style.left=`${Math.max(h,k)}px`,G.style.top=`${Math.max(h,T)}px`}function zt(a,{sku:u,month:h}){var at;if(!a||!u||!h)return;if(bt===a&&G){mt();return}mt();const o=((at=n.settings)==null?void 0:at.monthAnchorDay)||"START",c=Mn(h,o),k=Dn(c),T=Ct(c),A=ce(h),L=Re(n,u,h),st=Number.isFinite(L)?`<div class="inventory-cell-popover-meta">Plan-Absatz in diesem Monat: ${K(L)}</div>`:"",H=document.createElement("div");H.className="inventory-cell-popover",H.innerHTML=`
      <div class="inventory-cell-popover-title">Aktion für ${f(u)}</div>
      ${st}
      <button class="inventory-cell-popover-action" type="button" data-action="fo">
        FO erstellen – Ankunft in ${f(A)} <span class="muted">(Anker: ${f(T)})</span>
      </button>
      <button class="inventory-cell-popover-action" type="button" data-action="po">
        PO erstellen – Bestellung in ${f(A)} <span class="muted">(Anker: ${f(T)})</span>
      </button>
      <button class="inventory-cell-popover-action" type="button" data-action="po-arrival">
        PO rückwärts – Ankunft in ${f(A)} <span class="muted">(Anker: ${f(T)})</span>
      </button>
    `,H.addEventListener("click",yt=>{const rt=yt.target.closest("button[data-action]");if(!rt)return;const Dt=rt.dataset.action,X=new URLSearchParams;X.set("create","1"),X.set("sku",u),X.set("anchorMonth",h),X.set("anchorDate",k),Dt==="fo"?(X.set("target",k),location.hash=`#fo?${X.toString()}`):Dt==="po"?(X.set("orderDate",k),X.set("anchorMode","order"),location.hash=`#po?${X.toString()}`):Dt==="po-arrival"&&(X.set("anchorMode","arrival"),location.hash=`#po?${X.toString()}`),mt()}),document.body.appendChild(H),G=H,bt=a,jt(a)}function wt(){R&&(clearTimeout(R),R=null),$t&&($t.remove(),$t=null,J="units")}function Ot(a){const u=Q.perSkuMonth.get(a)||new Map,h=p.inboundMap.get(a)||new Map;return z.map(o=>{const c=u.get(o)||null,k=h.get(o)||null;return{month:o,endAvailable:Number.isFinite(c==null?void 0:c.endAvailable)?Number(c.endAvailable):null,doh:Number.isFinite(c==null?void 0:c.doh)?Number(c.doh):null,safetyUnits:Number.isFinite(c==null?void 0:c.safetyUnits)?Number(c.safetyUnits):null,safetyDays:Number.isFinite(c==null?void 0:c.safetyDays)?Number(c.safetyDays):null,daysToOos:Number.isFinite(c==null?void 0:c.daysToOos)?Number(c.daysToOos):null,forecastUnits:Number.isFinite(c==null?void 0:c.forecastUnits)?Number(c.forecastUnits):null,events:Array.isArray(k==null?void 0:k.events)?k.events:[]}})}function Nt({alias:a,monthData:u}){const h=J==="doh"?"Bestand Monatsende (DOH)":"Bestand Monatsende (DE verfügbar)",o=J==="doh"?Number.isFinite(u.doh)?`${K(u.doh)} DOH`:"—":Number.isFinite(u.endAvailable)?`${K(u.endAvailable)} Units`:"—",c=Number.isFinite(u.forecastUnits)?`${K(u.forecastUnits)} Units`:"—",k=u.events.length?u.events.map(T=>{const A=T.open?`<button class="btn sm secondary inventory-link" type="button" data-route="${f(T.route||"")}" data-open="${f(T.open||"")}">Open ${f(T.type||"")}</button>`:"";return`
          <div class="inventory-drilldown-arrival">
            <div class="inventory-drilldown-arrival-main">
              <div><strong>${f(T.type||"—")} ${f(T.label||T.id||"—")}</strong></div>
              <div class="muted">${f(T.date||"—")}</div>
            </div>
            <div class="inventory-drilldown-arrival-meta">
              <div>+${K(T.qty)} Units</div>
              ${A}
            </div>
          </div>
        `}).join(""):'<div class="inventory-drilldown-tooltip-empty">Keine Ankünfte.</div>';return`
      <div class="inventory-drilldown-tooltip-header">
        <div class="inventory-drilldown-tooltip-title">${f(u.month)}</div>
        <div class="muted">${f(a||"—")}</div>
      </div>
      <div class="inventory-drilldown-tooltip-kpis">
        <div>${h}: <strong>${o}</strong></div>
        <div>Plan-Absatz: <strong>${c}</strong></div>
      </div>
      <div class="inventory-drilldown-tooltip-arrivals">${k}</div>
    `}function se(a,u){if(!a||!u)return;const h=14,o=window.innerWidth-a.offsetWidth-12,c=window.innerHeight-a.offsetHeight-12,k=le(u.clientX+h,8,Math.max(8,o)),T=le(u.clientY+h,8,Math.max(8,c));a.style.left=`${k}px`,a.style.top=`${T}px`}function Ft(a){a&&(a.hidden=!0,a.innerHTML="")}function Vt(a,{sku:u,alias:h}){var Ue;const o=a==null?void 0:a.querySelector("[data-drilldown-chart]"),c=a==null?void 0:a.querySelector(".inventory-drilldown-tooltip");if(!o||!c)return;R&&(clearTimeout(R),R=null),Ft(c);const k=Ot(u).map(g=>{const D=e.showSafety?Ve({endAvailable:g.endAvailable,safetyUnits:g.safetyUnits,doh:g.doh,safetyDays:g.safetyDays,daysToOos:g.daysToOos,projectionMode:J==="doh"?"doh":"units"}):"";return{...g,riskClass:D}});if(!k.length){o.innerHTML='<div class="muted">Keine Projektion vorhanden.</div>';return}const T=k.length,A=72,L=56,st=20,H=18,at=210,yt=H+at+36,rt=86,Dt=yt+rt,X=L+st+T*A,Xe=Dt+34,ie=k.map(g=>J==="doh"?g.doh:g.endAvailable),Qe=k.map(g=>J==="doh"?g.safetyDays:g.safetyUnits),It=ie.filter(g=>Number.isFinite(g));e.showSafety&&Qe.forEach(g=>{Number.isFinite(g)&&It.push(g)});let Tt=It.length?Math.min(...It):0,Pt=It.length?Math.max(...It):1;Tt=Math.min(Tt,0),Pt<=Tt&&(Pt=Tt+1);const Ze=Math.max(1,...k.map(g=>Number.isFinite(g.forecastUnits)?g.forecastUnits:0)),Bt=g=>L+g*A+A/2,Kt=g=>H+(Pt-g)/(Pt-Tt)*at,Je=g=>{const D=Number.isFinite(g)?Math.max(0,g):0;return yt+rt-D/Ze*rt},Se=4,tn=Array.from({length:Se+1},(g,D)=>{const V=D/Se,ht=Pt-(Pt-Tt)*V;return{value:ht,y:Kt(ht)}}),Xt=[];let At=[];ie.forEach((g,D)=>{if(!Number.isFinite(g)){At.length&&Xt.push(At),At=[];return}At.push({x:Bt(D),y:Kt(g),index:D})}),At.length&&Xt.push(At);const xe=Math.max(12,Math.round(A*.42)),en=k.map((g,D)=>{if(!e.showSafety||!g.riskClass)return"";const V=g.riskClass==="safety-negative"?"inventory-drilldown-band-negative":"inventory-drilldown-band-low",ht=L+D*A;return`<rect class="${V}" x="${ht}" y="${H}" width="${A}" height="${Dt-H+1}"></rect>`}).join(""),nn=tn.map(g=>`
      <line class="inventory-drilldown-grid" x1="${L}" y1="${g.y.toFixed(2)}" x2="${X-st}" y2="${g.y.toFixed(2)}"></line>
      <text class="inventory-drilldown-axis-label" x="${L-8}" y="${(g.y+3).toFixed(2)}" text-anchor="end">${f(K(g.value))}</text>
    `).join(""),sn=Xt.map(g=>`<polyline class="inventory-drilldown-stock-line" points="${g.map(V=>`${V.x.toFixed(2)},${V.y.toFixed(2)}`).join(" ")}"></polyline>`).join(""),an=Xt.reduce((g,D)=>g.concat(D),[]).map(g=>`<circle class="inventory-drilldown-stock-dot" cx="${g.x.toFixed(2)}" cy="${g.y.toFixed(2)}" r="3.4"></circle>`).join(""),rn=k.map((g,D)=>{if(!Number.isFinite(g.forecastUnits)||g.forecastUnits<=0)return"";const V=Bt(D)-xe/2,ht=Je(g.forecastUnits),Qt=Math.max(1,yt+rt-ht);return`<rect class="inventory-drilldown-plan-bar" x="${V.toFixed(2)}" y="${ht.toFixed(2)}" width="${xe}" height="${Qt.toFixed(2)}" rx="3"></rect>`}).join(""),on=k.map((g,D)=>{if(!g.events.length)return"";const V=g.events.some(oe=>oe.type==="PO"),ht=g.events.some(oe=>oe.type==="FO"),Qt=V&&ht?"PO+FO":V?"PO":"FO",Ne=ie[D],dn=Number.isFinite(Ne)?Kt(Ne):H+14,Fe=le(dn-22,H+2,H+at-18),re=Qt.length>2?36:24,Te=Bt(D)-re/2;return`
        <rect class="inventory-drilldown-arrival-pill" x="${Te.toFixed(2)}" y="${Fe.toFixed(2)}" width="${re}" height="14" rx="7"></rect>
        <text class="inventory-drilldown-arrival-pill-text" x="${(Te+re/2).toFixed(2)}" y="${(Fe+10.2).toFixed(2)}" text-anchor="middle">${Qt}</text>
      `}).join(""),ln=k.map((g,D)=>`
      <text class="inventory-drilldown-axis-label" x="${Bt(D).toFixed(2)}" y="${(Dt+16).toFixed(2)}" text-anchor="middle">${f(Ht(g.month))}</text>
    `).join(""),cn=k.map((g,D)=>{const V=L+D*A;return`<rect class="inventory-drilldown-hit" data-index="${D}" x="${V}" y="${H}" width="${A}" height="${Dt-H+18}"></rect>`}).join("");let ae="";if(e.showSafety&&J==="doh"){const g=(Ue=k.find(D=>Number.isFinite(D.safetyDays)))==null?void 0:Ue.safetyDays;if(Number.isFinite(g)){const D=Kt(g);ae=`
          <line class="inventory-drilldown-safety-line" x1="${L}" y1="${D.toFixed(2)}" x2="${X-st}" y2="${D.toFixed(2)}"></line>
          <text class="inventory-drilldown-axis-label" x="${X-st}" y="${(D-6).toFixed(2)}" text-anchor="end">Safety ${f(K(g))}</text>
        `}}else if(e.showSafety){const g=[];let D=[];k.forEach((V,ht)=>{if(!Number.isFinite(V.safetyUnits)){D.length&&g.push(D),D=[];return}D.push(`${Bt(ht).toFixed(2)},${Kt(V.safetyUnits).toFixed(2)}`)}),D.length&&g.push(D),ae=g.map(V=>`<polyline class="inventory-drilldown-safety-line" points="${V.join(" ")}"></polyline>`).join("")}o.innerHTML=`
      <svg class="inventory-drilldown-svg" viewBox="0 0 ${X} ${Xe}" role="img" aria-label="SKU Verlauf ${f(h||u)} (${f(u)})">
        ${en}
        ${nn}
        <line class="inventory-drilldown-axis" x1="${L}" y1="${(H+at).toFixed(2)}" x2="${X-st}" y2="${(H+at).toFixed(2)}"></line>
        <line class="inventory-drilldown-axis" x1="${L}" y1="${(yt+rt).toFixed(2)}" x2="${X-st}" y2="${(yt+rt).toFixed(2)}"></line>
        <text class="inventory-drilldown-axis-label" x="${L}" y="${(H-6).toFixed(2)}">${J==="doh"?"DOH":"Units"}</text>
        <text class="inventory-drilldown-axis-label" x="${L}" y="${(yt-8).toFixed(2)}">Plan-Absatz (Units)</text>
        ${ae}
        ${rn}
        ${sn}
        ${an}
        ${on}
        ${ln}
        ${cn}
      </svg>
    `;const Me=()=>{R&&clearTimeout(R),R=setTimeout(()=>{c.matches(":hover")||Ft(c)},120)},De=(g,D)=>{R&&(clearTimeout(R),R=null);const V=k[D];V&&(c.innerHTML=Nt({alias:h,monthData:V}),c.hidden=!1,se(c,g))};o.querySelectorAll(".inventory-drilldown-hit").forEach(g=>{const D=Number(g.getAttribute("data-index"));g.onmouseenter=V=>De(V,D),g.onmousemove=V=>De(V,D),g.onmouseleave=()=>Me()}),o.onmouseleave=()=>Me(),c.onmouseenter=()=>{R&&(clearTimeout(R),R=null)},c.onmouseleave=()=>Ft(c)}function Ye({sku:a,alias:u}){if(!a)return;wt(),J="units";const h=u||a,o=document.createElement("div");o.className="po-modal-backdrop inventory-drilldown-backdrop",o.setAttribute("role","dialog"),o.setAttribute("aria-modal","true"),o.innerHTML=`
      <div class="po-modal inventory-drilldown-modal">
        <header class="po-modal-header">
          <div>
            <strong>SKU Verlauf – ${f(h)} (${f(a)})</strong>
            <div class="muted small">Zeitraum: ${f(z[0]||"—")} bis ${f(z[z.length-1]||"—")}</div>
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
    `,o.addEventListener("click",c=>{if(c.target===o||c.target.closest("[data-drilldown-close]")){wt();return}const k=c.target.closest(".inventory-link");if(!k)return;const T=k.getAttribute("data-route"),A=k.getAttribute("data-open");if(!T||!A)return;const L=new URLSearchParams;L.set("open",A),location.hash=`${T}?${L.toString()}`,wt()}),o.addEventListener("change",c=>{const k=c.target.closest("input[name='inventory-drilldown-mode']");k&&(J=k.value==="doh"?"doh":"units",Vt(o,{sku:a,alias:h}))}),document.body.appendChild(o),$t=o,Vt(o,{sku:a,alias:h})}t.addEventListener("mouseover",a=>{const u=a.target.closest("[data-tooltip-html]");if(!u||u===tt)return;const h=u.getAttribute("data-tooltip-html");h&&Ut(u,h,a)}),t.addEventListener("mousemove",a=>{tt&&ut(a)}),t.addEventListener("mouseout",a=>{if(!tt||a.relatedTarget&&O&&O.contains(a.relatedTarget))return;const u=a.target.closest("[data-tooltip-html]");u&&u===tt&&Mt()}),O&&O.addEventListener("mouseleave",()=>{Mt()});const ye=a=>{if(!G||G.contains(a.target))return;const u=a.target.closest("td.inventory-projection-cell");u&&bt===u||mt()},ve=a=>{a.key==="Escape"&&(mt(),wt())};document.addEventListener("click",ye),document.addEventListener("keydown",ve);const Gt=t.querySelector(".inventory-table-scroll"),ge=()=>mt();Gt&&Gt.addEventListener("scroll",ge),t.addEventListener("click",a=>{const u=a.target.closest(".inventory-link");if(!u)return;const h=u.getAttribute("data-route"),o=u.getAttribute("data-open");if(!h||!o)return;const c=new URLSearchParams;c.set("open",o),location.hash=`${h}?${c.toString()}`});const be=t.querySelector("#inventory-horizon");be&&be.addEventListener("change",a=>{const u=Number(a.target.value||12);n.inventory||(n.inventory={snapshots:[],settings:{}}),n.inventory.settings||(n.inventory.settings={}),n.inventory.settings.projectionMonths=u,Zt(n),et(t)});const $e=t.querySelector("#inventory-safety");$e&&$e.addEventListener("change",a=>{e.showSafety=a.target.checked,ot(e),et(t)}),t.querySelectorAll("input[name='inventory-mode']").forEach(a=>{a.addEventListener("change",u=>{const h=u.target.value;e.projectionMode=h==="doh"||h==="plan"?h:"units",ot(e),et(t)})});function Ge(){if(!r)return;const a=Pe(r),u=/^\d{4}-\d{2}$/.test(i)?`[data-month="${Pe(i)}"]`:"[data-month]",h=t.querySelector(`.inventory-projection-table tr[data-sku="${a}"] td${u}`),o=h?h.closest("tr[data-sku]"):t.querySelector(`.inventory-projection-table tr[data-sku="${a}"]`);o&&o.classList.add("row-focus"),h?(h.classList.add("cell-focus"),h.scrollIntoView({behavior:"smooth",block:"center",inline:"center"})):o&&o.scrollIntoView({behavior:"smooth",block:"center"}),window.__routeQuery={}}Ge(),t._inventoryCleanup=()=>{document.removeEventListener("click",ye),document.removeEventListener("keydown",ve),Gt&&Gt.removeEventListener("scroll",ge),mt(),wt()}}const qn={render:et};export{qn as default,et as render};
