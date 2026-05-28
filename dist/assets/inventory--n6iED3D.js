import{l as un,c as Zt,a as mn,b as hn}from"./store-C4DDJ3RY.js";import{k as ht}from"./index-BNKwo5al.js";import{b as fn}from"./abcClassification-DTu_0ZSO.js";import{c as Oe,r as pn,a as yn,g as Ve}from"./inventoryProjection-DBB7U817.js";const Ie="inventory_view_v1";function h(t){return String(t??"").replace(/[&<>"']/g,n=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[n])}function Pe(t){return typeof CSS<"u"&&typeof CSS.escape=="function"?CSS.escape(t):String(t).replace(/["\\]/g,"\\$&")}function Be(){const t=new Date;return`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}`}function Rt(t){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[n,e]=t.split("-").map(Number);return n*12+(e-1)}function Ke(t,n){const[e,o]=t.split("-").map(Number),l=e*12+(o-1)+n,i=Math.floor(l/12),s=l%12+1;return`${i}-${String(s).padStart(2,"0")}`}function vn(t,n){return Array.from({length:n},(e,o)=>Ke(t,o+1))}function Ht(t){if(!t)return"—";const[n,e]=t.split("-");return`${e}-${n}`}function ce(t){if(!t)return"—";const[n,e]=t.split("-");return`${e}/${n}`}function Jt(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return"";const n=t.getFullYear(),e=String(t.getMonth()+1).padStart(2,"0"),o=String(t.getDate()).padStart(2,"0");return`${n}-${e}-${o}`}function gn(t){if(!t)return null;const n=new Date(`${t}T00:00:00`);return Number.isNaN(n.getTime())?null:n}function bn(t){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[n,e]=t.split("-").map(Number);return new Date(n,e,0)}function me(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return null;const n=new Date(t.getTime());return n.setHours(23,59,59,999),n}function Ae(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"Bestandsaufnahme":`Bestandsaufnahme zum ${Ct(t)}`}function $n(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return"—";const n=t.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}),e=t.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});return`${n} ${e}`}function wn(t){if(t==null||t==="")return{value:0,isRounded:!1};const n=ht(String(t));if(!Number.isFinite(n))return{value:0,isRounded:!1};const e=Math.round(n);return{value:e,isRounded:e!==n}}function Re(t,n,e){var f,$,y,S,D,g,k;const o=ne(e);if(!o)return null;const l=(y=($=(f=t==null?void 0:t.forecast)==null?void 0:f.forecastManual)==null?void 0:$[n])==null?void 0:y[o],i=ht(l);if(Number.isFinite(i))return i;const s=(k=(g=(D=(S=t==null?void 0:t.forecast)==null?void 0:S.forecastImport)==null?void 0:D[n])==null?void 0:g[o])==null?void 0:k.units,d=ht(s);return Number.isFinite(d)?d:null}function K(t){return t==null||!Number.isFinite(Number(t))?"—":Math.round(Number(t)).toLocaleString("de-DE",{maximumFractionDigits:0})}function le(t,n,e){return Math.min(e,Math.max(n,t))}function _t(t,n){const e=String(n||"").trim().toLowerCase();return e?t.filter(o=>String(o.alias||"").toLowerCase().includes(e)||String(o.sku||"").toLowerCase().includes(e)):t}function En(t){if(!t)return!1;if(typeof t.active=="boolean")return t.active;const n=String(t.status||"").trim().toLowerCase();return n?n==="active"||n==="aktiv":!0}function ee(t,n=[]){const e=new Map;t.forEach(s=>{const d=s.categoryId?String(s.categoryId):"";e.has(d)||e.set(d,[]),e.get(d).push(s)});const l=n.slice().sort((s,d)=>{const f=Number.isFinite(s.sortOrder)?s.sortOrder:0,$=Number.isFinite(d.sortOrder)?d.sortOrder:0;return f-$||String(s.name||"").localeCompare(String(d.name||""))}).map(s=>({id:String(s.id),name:s.name||"Ohne Kategorie",items:e.get(String(s.id))||[]})),i=e.get("")||[];return i.length&&l.push({id:"uncategorized",name:"Ohne Kategorie",items:i}),l.filter(s=>s.items.length)}function kn(){const t=mn(Ie,{}),n=t.projectionMode==="doh"||t.projectionMode==="plan"?t.projectionMode:"units",e=t.snapshotViewMode==="eur"?"eur":"units";return{selectedMonth:t.selectedMonth||null,collapsed:t.collapsed&&typeof t.collapsed=="object"?t.collapsed:{},search:t.search||"",showSafety:t.showSafety!==!1,projectionMode:n,snapshotAsOfDate:t.snapshotAsOfDate||"",snapshotViewMode:e}}function rt(t){hn(Ie,t)}function Sn(t,n){var s;const e=(((s=t.inventory)==null?void 0:s.snapshots)||[]).map(d=>d==null?void 0:d.month).filter(d=>/^\d{4}-\d{2}$/.test(d)).sort(),o=e[e.length-1],l=Be(),i=n.selectedMonth||o||l;return i||l}function Le({products:t,categories:n,view:e,collapsed:o}){const l=_t(t,e.search),i=ee(l,n),s={...e.collapsed};i.forEach(d=>{s[d.id]=o}),e.collapsed=s,rt(e)}function ne(t){if(!t)return null;const n=String(t);if(/^\d{4}-\d{2}$/.test(n))return n;const e=n.match(/^(\d{2})-(\d{4})$/);return e?`${e[2]}-${e[1]}`:n}function He(t,n){var e;return(((e=t.inventory)==null?void 0:e.snapshots)||[]).find(o=>(o==null?void 0:o.month)===n)||null}function Ce(t,n){const e=He(t,n);if(e)return e;const o={month:n,items:[]};return t.inventory||(t.inventory={snapshots:[],settings:{}}),Array.isArray(t.inventory.snapshots)||(t.inventory.snapshots=[]),t.inventory.snapshots.push(o),o}function he(t,n){if(!t||!n)return null;Array.isArray(t.items)||(t.items=[]);let e=t.items.find(o=>String(o.sku||"").trim()===n);return e||(e={sku:n,amazonUnits:0,threePLUnits:0,note:""},t.items.push(e)),e}function je(t,n){var i;const e=Rt(n);if(e==null)return null;const o=(((i=t.inventory)==null?void 0:i.snapshots)||[]).filter(s=>(s==null?void 0:s.month)&&Rt(s.month)!=null).slice().sort((s,d)=>Rt(s.month)-Rt(d.month));let l=null;return o.forEach(s=>{const d=Rt(s.month);d!=null&&d<e&&(l=s)}),l}function Wt(t,n){if(!n)return"—";const o=(Array.isArray(t.suppliers)?t.suppliers:[]).find(l=>String(l.id||"")===String(n));return(o==null?void 0:o.name)||n||"—"}function Ut(t){if(!t)return null;const n=new Date(t);return Number.isNaN(n.getTime())?null:n}function de(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?null:`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}`}function fe(t){const n=Ut((t==null?void 0:t.etaManual)||(t==null?void 0:t.etaDate)||(t==null?void 0:t.eta));if(n)return n;const e=Ut(t==null?void 0:t.etaComputed);if(e)return e;const o=Ut(t==null?void 0:t.orderDate);if(!o)return null;const l=Number((t==null?void 0:t.prodDays)||0),i=Number((t==null?void 0:t.transitDays)||0),s=new Date(o.getTime());return s.setDate(s.getDate()+Math.max(0,l+i)),s}function qe(t){return Ut((t==null?void 0:t.targetDeliveryDate)||(t==null?void 0:t.deliveryDate)||(t==null?void 0:t.etaDate))}function We(t){const n=String((t==null?void 0:t.status)||"").toUpperCase();return!(n==="CONVERTED"||n==="CANCELLED")}function xn(t,n,e){const o=e.map(i=>ne(i)).filter(Boolean),l=new Map;return t.forEach(i=>{const s=new Map;o.forEach(d=>{let f=0,$=!1;i.items.forEach(y=>{var g;const S=String((y==null?void 0:y.sku)||"").trim();if(!S)return;const D=(g=n.get(S))==null?void 0:g.get(d);Number.isFinite(D)&&(f+=D,$=!0)}),$&&s.set(d,f)}),l.set(i.id,s)}),l}function Yt(t,n){var i;const e=((i=t==null?void 0:t.template)==null?void 0:i.fields)||(t==null?void 0:t.template)||{},o=ht(e.unitPriceUsd??(t==null?void 0:t.unitPriceUsd)??null);if(!Number.isFinite(o))return null;const l=String(e.currency||(n==null?void 0:n.defaultCurrency)||"EUR").toUpperCase();if(l==="EUR")return o;if(l==="USD"){const s=ht(n==null?void 0:n.fxRate);return!Number.isFinite(s)||s<=0?null:o/s}return null}function W(t){return t==null||!Number.isFinite(Number(t))?"—":Number(t).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function Ct(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"—":t.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"})}function Mn(t,n){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[e,o]=t.split("-").map(Number);if(!Number.isFinite(e)||!Number.isFinite(o))return null;const l=String(n).toUpperCase();let i=1;return l==="MID"&&(i=15),l==="END"&&(i=new Date(e,o,0).getDate()),new Date(Date.UTC(e,o-1,i))}function Un(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"—":t.toISOString().slice(0,10)}function Dn(t){const n=Ut((t==null?void 0:t.etdManual)||(t==null?void 0:t.etdDate));if(n)return n;const e=Ut(t==null?void 0:t.orderDate);if(!e)return null;const o=Number((t==null?void 0:t.prodDays)||0),l=new Date(e.getTime());return l.setDate(l.getDate()+Math.max(0,o)),l}function pe(t){const n=new Map,e=new Set;function o(i,s){n.has(i)||n.set(i,new Map);const d=n.get(i);return d.has(s)||d.set(s,{events:[],hasPo:!1,hasFo:!1,poUnits:0,foUnits:0}),d.get(s)}function l(i,s,d){const f=o(i,s),$=f.events.find(y=>y.type===d.type&&y.id===d.id);$?$.qty+=d.qty:f.events.push({...d}),d.type==="PO"&&(f.hasPo=!0,f.poUnits+=d.qty),d.type==="FO"&&(f.hasFo=!0,f.foUnits+=d.qty)}return(t.pos||[]).forEach(i=>{if(!i||String(i.status||"").toUpperCase()==="CANCELLED")return;const s=Array.isArray(i.items)&&i.items.length?i.items:[{sku:i.sku,units:i.units}],f=Ut(i.arrivalDate)||fe(i),$=f?de(f):null;s.forEach(y=>{const S=String((y==null?void 0:y.sku)||"").trim();if(!S)return;const D=ht((y==null?void 0:y.units)??0),g=Number.isFinite(D)?Math.round(D):0;if(!$){e.add(S);return}l(S,$,{type:"PO",id:String(i.id||i.poNo||S),label:i.poNo||i.id||"PO",supplier:Wt(t,i.supplierId||i.supplier),qty:g,date:f?f.toISOString().slice(0,10):"—",route:"#po",open:i.id||i.poNo||""})})}),(t.fos||[]).forEach(i=>{if(!i||!We(i))return;const s=Array.isArray(i.items)&&i.items.length?i.items:[{sku:i.sku,units:i.units}],f=Ut(i.arrivalDate)||qe(i),$=f?de(f):null;$&&s.forEach(y=>{const S=String((y==null?void 0:y.sku)||"").trim();if(!S)return;const D=ht((y==null?void 0:y.units)??0),g=Number.isFinite(D)?Math.round(D):0;l(S,$,{type:"FO",id:String(i.id||i.foNo||S),label:i.foNo||i.id||"FO",supplier:Wt(t,i.supplierId||i.supplier),qty:g,date:f?f.toISOString().slice(0,10):"—",route:"#fo",open:i.id||i.foNo||""})})}),{inboundMap:n,missingEtaSkus:e}}function Nn({state:t,currentSnapshot:n,previousSnapshot:e,products:o,categories:l,currentMonth:i,asOfDate:s}){const d=t.settings||{},f=new Map;o.forEach(p=>{const b=String((p==null?void 0:p.sku)||"").trim();b&&f.set(b,p)});const $=new Map;(l||[]).forEach(p=>{(p==null?void 0:p.id)!=null&&$.set(String(p.id),p.name||"Ohne Kategorie")});const y=p=>{const b=(p==null?void 0:p.categoryId)!=null?String(p.categoryId):"";return b?{id:b,name:$.get(b)||"Ohne Kategorie"}:{id:"uncategorized",name:"Ohne Kategorie"}},S=p=>{const b=f.get(p);return Yt(b,d)},D=()=>({measuredPrev:0,measuredCurr:0,inboundEur:0,salesEur:0,hasMissingEk:!1}),g=new Map,k=(p,b)=>(g.has(p)||g.set(p,{id:p,name:b,...D()}),g.get(p)),F=(p,b)=>{p&&(p.items||[]).forEach(M=>{const w=String(M.sku||"").trim();if(!w)return;const C=f.get(w);if(!C)return;const P=Number(M.amazonUnits||0)+Number(M.threePLUnits||0),I=S(w),Z=y(C),_=k(Z.id,Z.name);if(!Number.isFinite(I)){_.hasMissingEk=!0;return}_[b]+=P*I})};F(e,"measuredPrev"),F(n,"measuredCurr");const N=ne(i),{inboundMap:z}=pe(t);z.forEach((p,b)=>{const M=p.get(N);if(!M)return;const w=(M.poUnits||0)+(M.foUnits||0);if(!w)return;const C=f.get(b);if(!C)return;const P=S(b),I=y(C),Z=k(I.id,I.name);if(!Number.isFinite(P)){Z.hasMissingEk=!0;return}Z.inboundEur+=w*P}),o.forEach(p=>{const b=String((p==null?void 0:p.sku)||"").trim();if(!b)return;const M=Re(t,b,N);if(!Number.isFinite(M)||!M)return;const w=S(b),C=y(p),P=k(C.id,C.name);if(!Number.isFinite(w)){P.hasMissingEk=!0;return}P.salesEur+=M*w});const q=Array.from(g.values()).map(p=>{const b=p.measuredCurr-p.measuredPrev,M=p.inboundEur-p.salesEur;return{...p,measuredDelta:b,expectedDelta:M,discrepancy:b-M}}).sort((p,b)=>Math.abs(b.discrepancy)-Math.abs(p.discrepancy)),Q=q.reduce((p,b)=>(p.measuredPrev+=b.measuredPrev,p.measuredCurr+=b.measuredCurr,p.measuredDelta+=b.measuredDelta,p.inboundEur+=b.inboundEur,p.salesEur+=b.salesEur,p.expectedDelta+=b.expectedDelta,p.discrepancy+=b.discrepancy,b.hasMissingEk&&(p.hasMissingEk=!0),p),{measuredPrev:0,measuredCurr:0,measuredDelta:0,inboundEur:0,salesEur:0,expectedDelta:0,discrepancy:0,hasMissingEk:!1});return{currentMonth:N,previousMonth:(e==null?void 0:e.month)||null,perCategory:q,totals:Q,forecastIsSurrogate:!0}}function Fn(t,n){const e=me(n)||new Date,o=t.settings||{},l=new Map;(t.products||[]).forEach(s=>{const d=String((s==null?void 0:s.sku)||"").trim();d&&l.set(d,s)});const i=[];return(t.pos||[]).forEach(s=>{if(!s||s.archived)return;const d=String(s.status||"").toUpperCase();if(d==="CANCELLED"||d==="ARRIVED"||d==="RECEIVED")return;const f=fe(s);if(!f||f>e)return;const $=Array.isArray(s.items)&&s.items.length?s.items:[{sku:s.sku,units:s.units}];let y=0,S=0,D=!1;$.forEach(g=>{const k=String((g==null?void 0:g.sku)||"").trim();if(!k)return;const F=Math.round(ht((g==null?void 0:g.units)??0)||0);y+=F;const N=l.get(k),z=Yt(N,o);if(!Number.isFinite(z)){D=!0;return}S+=F*z}),i.push({id:s.id||s.poNo||"",label:s.poNo||s.id||"PO",supplier:Wt(t,s.supplierId||s.supplier),etaDate:f,etaLabel:Ct(f),ageDays:Math.max(0,Math.round((e-f)/(24*60*60*1e3))),units:y,valueEur:S,hasMissingEk:D})}),i.sort((s,d)=>d.ageDays-s.ageDays),i}function _e(t,n){const e=new Map,o=new Date,l=me(n)||o,i=(s,d)=>{e.has(s)||e.set(s,{total:0,entries:[]});const f=e.get(s);f.total+=d.qty,f.entries.push(d)};return(t.pos||[]).forEach(s=>{if(!s||s.archived||String(s.status||"").toUpperCase()==="CANCELLED")return;const d=fe(s);if(d&&d<=l)return;const f=Dn(s);(Array.isArray(s.items)&&s.items.length?s.items:[{sku:s.sku,units:s.units}]).forEach(y=>{const S=String((y==null?void 0:y.sku)||"").trim();if(!S)return;const D=ht((y==null?void 0:y.units)??0),g=Number.isFinite(D)?Math.round(D):0;g&&i(S,{type:"PO",id:String(s.id||s.poNo||S),label:s.poNo||s.id||"PO",supplier:Wt(t,s.supplierId||s.supplier),qty:g,etd:f?Ct(f):"—",eta:d?Ct(d):"—",route:"#po",open:s.id||s.poNo||""})})}),(t.fos||[]).forEach(s=>{if(!s||!We(s))return;const d=qe(s);if(d&&d<=l)return;(Array.isArray(s.items)&&s.items.length?s.items:[{sku:s.sku,units:s.units}]).forEach($=>{const y=String(($==null?void 0:$.sku)||"").trim();if(!y)return;const S=ht(($==null?void 0:$.units)??0),D=Number.isFinite(S)?Math.round(S):0;D&&i(y,{type:"FO",id:String(s.id||s.foNo||y),label:s.foNo||s.id||"FO",supplier:Wt(t,s.supplierId||s.supplier),qty:D,etd:"—",eta:d?Ct(d):"—",route:"#fo",open:s.id||s.foNo||""})})}),e}function Tn({alias:t,month:n,events:e}){if(!e||!e.length)return"";const o=e.map(l=>`
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
        <div class="inventory-tooltip-title">Inbound arrivals in ${Ht(n)}</div>
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
  `}function ue(t){return encodeURIComponent(t||"")}const qt=new Map;function te(t,n,e){return`${t||"unknown"}:${n}:${e}`}function wt(t){if(t==null||!Number.isFinite(Number(t)))return"—";const n=Number(t);return`${n>0?"+":n<0?"−":""}${W(Math.abs(n))}`}function ze(t,n){const e=t-n,o=Math.abs(e),l=Math.max(Math.abs(t),Math.abs(n),1),i=o/l;return o<500?"ok":o<2e3?i<.5?"ok":"warn":i<.3?"ok":i<.6?"warn":"bad"}function An({reconciliation:t,stalePos:n,currentMonth:e,previousMonth:o}){const l=t.totals,i=ze(l.measuredDelta,l.expectedDelta),s=i==="ok"?"Plausibel":i==="warn"?"Auffällig":"Stark abweichend",d=`reco-status-${i}`,f=e?ce(e):"—",$=o?ce(o):"—",y=l.hasMissingEk?'<span class="cell-warning" title="Mindestens ein Produkt ohne EK">⚠︎ EK fehlt teils</span>':"",S=t.perCategory.length?t.perCategory.map(g=>`
          <tr class="reco-cat-row reco-cat-${ze(g.measuredDelta,g.expectedDelta)}">
            <td>${h(g.name)}${g.hasMissingEk?' <span class="cell-warning" title="EK fehlt">⚠︎</span>':""}</td>
            <td class="num">${W(g.measuredPrev)}</td>
            <td class="num">${W(g.measuredCurr)}</td>
            <td class="num"><strong>${wt(g.measuredDelta)}</strong></td>
            <td class="num">${W(g.inboundEur)}</td>
            <td class="num">${W(g.salesEur)}</td>
            <td class="num"><strong>${wt(g.expectedDelta)}</strong></td>
            <td class="num"><strong>${wt(g.discrepancy)}</strong></td>
          </tr>
        `).join(""):'<tr><td class="muted" colspan="8">Keine Kategorie-Daten verfügbar.</td></tr>',D=n.length?`
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
            ${n.map(g=>`
              <tr data-stale-po="${h(g.id)}">
                <td>${h(g.label)}</td>
                <td>${h(g.supplier||"—")}</td>
                <td class="num">${h(g.etaLabel)}</td>
                <td class="num">${K(g.ageDays)}</td>
                <td class="num">${K(g.units)}</td>
                <td class="num">${g.hasMissingEk?"⚠︎ ":""}${W(g.valueEur)}</td>
                <td><button class="btn sm secondary reco-archive-one" data-po-id="${h(g.id)}">Archivieren</button></td>
              </tr>
            `).join("")}
            <tr class="reco-stale-total">
              <td colspan="4"><strong>Summe offener Volumen</strong></td>
              <td class="num"><strong>${K(n.reduce((g,k)=>g+k.units,0))}</strong></td>
              <td class="num"><strong>${W(n.reduce((g,k)=>g+(Number.isFinite(k.valueEur)?k.valueEur:0),0))}</strong></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    `:'<div class="reco-stale-empty muted small">✓ Keine alten POs mit überfälliger ETA. In-Transit-Wert sollte sauber sein.</div>';return`
    <div class="reco-panel ${d}">
      <div class="reco-head">
        <div>
          <h3>Plausi-Check ${h($)} → ${h(f)}</h3>
          <p class="muted small">
            Vergleicht die gemessene Bestandsveränderung (Snapshot-Δ in EUR, ohne In-Transit) gegen die erwartete (PO/FO-Eingänge − Verkaufs-Forecast).
            Verkäufe geschätzt aus Forecast — echte Sales-Daten fehlen.
          </p>
        </div>
        <div class="reco-status-pill">${h(s)} ${y}</div>
      </div>
      <div class="reco-headline-grid">
        <div class="reco-kpi">
          <span class="muted small">Bestandsveränderung gemessen</span>
          <strong class="reco-kpi-value">${wt(l.measuredDelta)}</strong>
          <span class="muted small">${W(l.measuredPrev)} → ${W(l.measuredCurr)}</span>
        </div>
        <div class="reco-kpi">
          <span class="muted small">Erwartete Veränderung</span>
          <strong class="reco-kpi-value">${wt(l.expectedDelta)}</strong>
          <span class="muted small">Wareneingänge ${W(l.inboundEur)} − Verkäufe ${W(l.salesEur)}</span>
        </div>
        <div class="reco-kpi reco-kpi-diff">
          <span class="muted small">Diskrepanz (Phantom-Bestand)</span>
          <strong class="reco-kpi-value">${wt(l.discrepancy)}</strong>
          <span class="muted small">Δ gemessen − Δ erwartet</span>
        </div>
      </div>
      <details class="reco-breakdown" ${i==="ok"?"":"open"}>
        <summary>Aufschlüsselung pro Kategorie (sortiert nach Diskrepanz)</summary>
        <table class="table-compact ui-table-standard reco-category-table">
          <thead>
            <tr>
              <th>Kategorie</th>
              <th class="num">Bestand ${h($)} €</th>
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
              <td class="num"><strong>${wt(l.measuredDelta)}</strong></td>
              <td class="num"><strong>${W(l.inboundEur)}</strong></td>
              <td class="num"><strong>${W(l.salesEur)}</strong></td>
              <td class="num"><strong>${wt(l.expectedDelta)}</strong></td>
              <td class="num"><strong>${wt(l.discrepancy)}</strong></td>
            </tr>
          </tbody>
        </table>
      </details>
      ${D}
    </div>
  `}function Ln({state:t,view:n,snapshot:e,previousSnapshot:o,products:l,categories:i,asOfDate:s,snapshotMonth:d}){const f=_t(l,n.search),$=n.snapshotViewMode==="eur"?"eur":"units",y=$==="eur",S=ee(f,i),D=new Map;((o==null?void 0:o.items)||[]).forEach(b=>{const M=String(b.sku||"").trim();M&&D.set(M,b)});const g=_e(t,s),k={amazonUnits:0,threePLUnits:0,totalUnits:0,inTransit:0,totalValue:0,amazonEur:0,threePlEur:0,totalEur:0,inTransitEur:0,deltaUnits:0,deltaEur:0,valueComplete:!0},F=b=>K(b),N=b=>Number.isFinite(b)?W(b):"—",z=S.map(b=>{const M=n.collapsed[b.id],w={amazonUnits:0,threePLUnits:0,totalUnits:0,inTransit:0,totalValue:0,amazonEur:0,threePlEur:0,totalEur:0,inTransitEur:0,deltaUnits:0,deltaEur:0,valueComplete:!0},C=b.items.map(_=>{const Y=String(_.sku||"").trim(),B=he(e,Y),ft=g.get(Y),vt=ft?ft.total:0,lt=D.get(Y),Et=Number((B==null?void 0:B.amazonUnits)||0),kt=Number((B==null?void 0:B.threePLUnits)||0),ct=Et+kt,nt=ct+vt,St=((lt==null?void 0:lt.amazonUnits)||0)+((lt==null?void 0:lt.threePLUnits)||0),j=ct-St,x=Yt(_,t.settings||{}),O=Number.isFinite(x)?nt*x:null,tt=Number.isFinite(x)?Et*x:null,G=Number.isFinite(x)?kt*x:null,gt=Number.isFinite(x)?ct*x:null,bt=Number.isFinite(x)?vt*x:null,J=Number.isFinite(x)?j*x:null,R=!Number.isFinite(x),dt=ft&&ft.entries.length?Pn({alias:_.alias||Y,entries:ft.entries}):"";w.amazonUnits+=Et,w.threePLUnits+=kt,w.totalUnits+=ct,w.inTransit+=vt,w.deltaUnits+=j,R?w.valueComplete=!1:(w.totalValue+=O,w.amazonEur+=tt,w.threePlEur+=G,w.totalEur+=gt,w.inTransitEur+=bt,w.deltaEur+=J);const Dt=qt.get(te(d,Y,"amazonUnits")),xt=qt.get(te(d,Y,"threePLUnits")),ut=y?`<td class="num inventory-value" data-field="amazonEur">${N(tt)}</td>`:`<td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="amazonUnits" value="${h(Dt??String((B==null?void 0:B.amazonUnits)??0))}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>`,jt=y?`<td class="num inventory-value" data-field="threePlEur">${N(G)}</td>`:`<td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="threePLUnits" value="${h(xt??String((B==null?void 0:B.threePLUnits)??0))}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>`,zt=y?`<td class="num inventory-value" data-field="totalEur">${N(gt)}</td>`:`<td class="num inventory-value" data-field="totalUnits">${F(ct)}</td>`,$t=y?`<td class="num inventory-value inventory-in-transit" data-field="inTransitEur" data-tooltip-html="${ue(dt)}">${N(bt)}</td>`:`<td class="num inventory-value inventory-in-transit" data-tooltip-html="${ue(dt)}">${F(vt)}</td>`,Ot=y?`<td class="num inventory-value" data-field="deltaEur">${N(J)}</td>`:`<td class="num inventory-value" data-field="delta">${F(j)}</td>`;return`
        <tr class="inventory-row ${M?"is-collapsed":""}" data-sku="${h(Y)}" data-category="${h(b.id)}">
          <td class="inventory-col-sku sticky-cell">${h(Y)}</td>
          <td class="inventory-col-alias sticky-cell">${h(_.alias||"—")}</td>
          ${ut}
          ${jt}
          ${zt}
          ${$t}
          <td class="num">
            ${R?'<span class="cell-warning" title="EK fehlt im Produkt">⚠︎</span>':""}
            <span data-field="ekEur">${Number.isFinite(x)?W(x):"—"}</span>
          </td>
          <td class="num inventory-value" data-field="totalValue">${Number.isFinite(O)?W(O):"—"}</td>
          ${Ot}
          <td><input class="inventory-input note" data-field="note" value="${h((B==null?void 0:B.note)||"")}" /></td>
        </tr>
      `}).join("");k.amazonUnits+=w.amazonUnits,k.threePLUnits+=w.threePLUnits,k.totalUnits+=w.totalUnits,k.inTransit+=w.inTransit,k.deltaUnits+=w.deltaUnits,w.valueComplete?(k.totalValue+=w.totalValue,k.amazonEur+=w.amazonEur,k.threePlEur+=w.threePlEur,k.totalEur+=w.totalEur,k.inTransitEur+=w.inTransitEur,k.deltaEur+=w.deltaEur):k.valueComplete=!1;const P=`Zwischensumme ${b.name}`,I=w.valueComplete?"":' <span class="cell-warning" title="Mindestens ein Produkt ohne EK">⚠︎</span>',Z=y?`
        <td class="num">${N(w.amazonEur)}</td>
        <td class="num">${N(w.threePlEur)}</td>
        <td class="num">${N(w.totalEur)}</td>
        <td class="num">${N(w.inTransitEur)}</td>
        <td class="num"></td>
        <td class="num">${N(w.totalValue)}${I}</td>
        <td class="num">${N(w.deltaEur)}</td>
        <td></td>
      `:`
        <td class="num">${F(w.amazonUnits)}</td>
        <td class="num">${F(w.threePLUnits)}</td>
        <td class="num">${F(w.totalUnits)}</td>
        <td class="num">${F(w.inTransit)}</td>
        <td class="num"></td>
        <td class="num">${N(w.totalValue)}${I}</td>
        <td class="num">${F(w.deltaUnits)}</td>
        <td></td>
      `;return`
        <tr class="inventory-category-row" data-category-row="${h(b.id)}">
          <th class="inventory-col-sku sticky-cell" colspan="2">
            <button type="button" class="tree-toggle" data-category="${h(b.id)}">${M?"▸":"▾"}</button>
            <span class="tree-label">${h(b.name)}</span>
            <span class="muted">(${b.items.length})</span>
          </th>
          <th colspan="8"></th>
        </tr>
        ${C}
        <tr class="inventory-subtotal-row ${M?"is-collapsed":""}" data-category-subtotal="${h(b.id)}">
          <td class="inventory-col-sku sticky-cell" colspan="2"><strong>${h(P)}</strong></td>
          ${Z}
        </tr>
      `}).join(""),q=k.valueComplete?"":' <span class="cell-warning" title="Mindestens ein Produkt ohne EK">⚠︎</span>',Q=y?`
      <td class="num">${N(k.amazonEur)}</td>
      <td class="num">${N(k.threePlEur)}</td>
      <td class="num">${N(k.totalEur)}</td>
      <td class="num">${N(k.inTransitEur)}</td>
      <td class="num"></td>
      <td class="num">${N(k.totalValue)}${q}</td>
      <td class="num">${N(k.deltaEur)}</td>
      <td></td>
    `:`
      <td class="num">${F(k.amazonUnits)}</td>
      <td class="num">${F(k.threePLUnits)}</td>
      <td class="num">${F(k.totalUnits)}</td>
      <td class="num">${F(k.inTransit)}</td>
      <td class="num"></td>
      <td class="num">${N(k.totalValue)}${q}</td>
      <td class="num">${F(k.deltaUnits)}</td>
      <td></td>
    `,p=S.length?`
    <tr class="inventory-grandtotal-row">
      <td class="inventory-col-sku sticky-cell" colspan="2"><strong>Gesamtsumme</strong></td>
      ${Q}
    </tr>
  `:"";return`
    <table class="table-compact ui-table-standard inventory-table inventory-snapshot-table" data-ui-table="true" data-sticky-cols="2" data-sticky-owner="manual" data-view-mode="${h($)}">
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
`)||e.includes(n)?`"${e.replace(/"/g,'""')}"`:e:""}function ot(t){return t==null||!Number.isFinite(Number(t))?"":Math.round(Number(t)).toLocaleString("de-DE",{maximumFractionDigits:0})}function yt(t){return t==null||!Number.isFinite(Number(t))?"":Number(t).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function Cn({state:t,view:n,snapshot:e,products:o,categories:l,asOfDate:i}){const s=_t(o,n.search),d=ee(s,l),f=_e(t,i),$=new Map;((e==null?void 0:e.items)||[]).forEach(z=>{const q=String(z.sku||"").trim();q&&$.set(q,z)});const y=[],S=[];let D=0,g=0,k=0,F=0,N=0;return d.forEach(z=>{z.items.forEach(q=>{const Q=String(q.sku||"").trim();if(!Q)return;const p=q.alias||"",b=$.get(Q)||{amazonUnits:0,threePLUnits:0},M=Number((b==null?void 0:b.amazonUnits)||0),w=Number((b==null?void 0:b.threePLUnits)||0),C=f.get(Q),P=C?C.total:0,I=Yt(q,t.settings||{}),Z=M+w+P,_=M+w,Y=Number.isFinite(I)?Z*I:null,B=Number.isFinite(I)?_*I:null;Number.isFinite(I)||S.push(p?`${Q} (${p})`:Q),Number.isFinite(M)&&(D+=M),Number.isFinite(w)&&(g+=w),Number.isFinite(P)&&(k+=P),Number.isFinite(Y)&&(F+=Y),Number.isFinite(B)&&(N+=B),y.push({sku:Q,alias:p,amazonUnits:M,threePlUnits:w,inTransitUnits:P,ekEur:I,rowValue:Y,rowValueWarehouse:B})})}),{rows:y,totals:{amazonUnits:D,majamoUnits:g,inTransitUnits:k,totalUnits:D+g+k,totalValue:F,totalValueWarehouse:N},missingEk:S}}function jn({title:t,rows:n,totals:e,missingEk:o}){const l=";",i=[];t&&(i.push(Lt(t,l)),i.push(""));const s=["SKU","Alias","Bestand Amazon (Stk)","Bestand majamo (Stk)","In Transit (Stk)","EK-Preis (EUR / Stk)","Warenwert ohne In-Transit (EUR)","Warenwert inkl. In-Transit (EUR)"];i.push(s.map(f=>Lt(f,l)).join(l)),n.forEach(f=>{const $=[f.sku,f.alias,ot(f.amazonUnits),ot(f.threePlUnits),ot(f.inTransitUnits),yt(f.ekEur),yt(f.rowValueWarehouse),yt(f.rowValue)];i.push($.map(y=>Lt(y,l)).join(l))});const d=["Gesamtsumme","",ot(e.amazonUnits),ot(e.majamoUnits),ot(e.inTransitUnits),"",yt(e.totalValueWarehouse),yt(e.totalValue)];return i.push(d.map(f=>Lt(f,l)).join(l)),i.push(""),i.push(Lt("Hinweis: 'Warenwert ohne In-Transit' = nur physisch im Lager (Amazon + majamo). Für BWA-Bestandsbewertung typischerweise diese Spalte verwenden, sofern In-Transit-Eigentum erst beim Eintreffen übergeht.",l)),o.length&&(i.push(""),i.push(Lt(`Fehlender EK-Preis für: ${o.join(", ")}`,l))),i.join(`
`)}function zn({title:t,fileName:n,rows:e,totals:o,missingEk:l,generatedAt:i}){const s=e.map($=>`
      <tr>
        <td>${h($.sku)}</td>
        <td>${h($.alias||"")}</td>
        <td class="num">${ot($.amazonUnits)}</td>
        <td class="num">${ot($.threePlUnits)}</td>
        <td class="num">${ot($.inTransitUnits)}</td>
        <td class="num">${yt($.ekEur)}</td>
        <td class="num">${yt($.rowValueWarehouse)}</td>
        <td class="num">${yt($.rowValue)}</td>
      </tr>
  `).join(""),d=`
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
            ${d}
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
  `}function On({state:t,view:n,snapshot:e,products:o,categories:l,months:i,projectionData:s=null,inboundData:d=null}){const f=_t(o,n.search),$=ee(f,l),y=new Map,S=s||Oe({state:t,months:i,products:f,snapshot:e,projectionMode:n.projectionMode}),D=S.months;f.forEach(p=>{const b=String((p==null?void 0:p.sku)||"").trim();if(!b)return;const M=new Map;D.forEach(w=>{var P;const C=(P=S.perSkuMonth.get(b))==null?void 0:P.get(w);Number.isFinite(C==null?void 0:C.forecastUnits)&&M.set(w,C.forecastUnits)}),y.set(b,M)});const g=n.projectionMode==="plan"?xn($,y,i):new Map,k=new Map;((e==null?void 0:e.items)||[]).forEach(p=>{const b=String(p.sku||"").trim();b&&k.set(b,p)});const{inboundMap:F,missingEtaSkus:N}=d||pe(t),z=fn(t).bySku,q=$.map(p=>{const b=n.collapsed[p.id],M=p.items.map(C=>{var ct;const P=String(C.sku||"").trim(),I=C.alias||"—",Z=((ct=z==null?void 0:z.get(P.toLowerCase()))==null?void 0:ct.abcClass)||"—",_=pn(C,t),Y=yn(C,t),B=Number.isFinite(_)?K(_):"—",ft=Number.isFinite(Y)?K(Y):"—",vt=`
        <button class="inventory-drilldown-trigger" type="button" data-action="open-drilldown" data-sku="${h(P)}" data-alias="${h(I)}" title="SKU Verlauf öffnen" aria-label="SKU Verlauf öffnen">
          <span aria-hidden="true">&#128200;</span>
        </button>
      `;let lt=0;const Et=i.map(nt=>{var Vt;const St=F.get(P),j=St?St.get(nt):null;j&&j.poUnits+j.foUnits;const x=(Vt=S.perSkuMonth.get(P))==null?void 0:Vt.get(nt),O=(x==null?void 0:x.forecastUnits)??null,tt=(x==null?void 0:x.endAvailable)??null,G=(x==null?void 0:x.forecastMissing)??!0,gt=Number.isFinite(x==null?void 0:x.safetyUnits)?x.safetyUnits:null,bt=Number.isFinite(x==null?void 0:x.safetyDays)?x.safetyDays:null,J=Number.isFinite(x==null?void 0:x.daysToOos)?x.daysToOos:null,R=j!=null&&j.hasPo&&(j!=null&&j.hasFo)?"inventory-cell inbound-both":j!=null&&j.hasPo?"inventory-cell inbound-po":j!=null&&j.hasFo?"inventory-cell inbound-fo":"inventory-cell",dt=(x==null?void 0:x.doh)??null,Dt=n.projectionMode==="doh",xt=n.projectionMode==="plan",ut=Dt?Number.isFinite(dt)&&dt<=0:Number.isFinite(tt)&&tt<=0,jt=xt?Number.isFinite(O)?K(O):"—":G?"—":ut?'0 <span class="inventory-warning-icon">⚠︎</span>':Dt?dt==null?"—":K(dt):K(tt),zt=xt?"":Ve({endAvailable:tt,safetyUnits:gt,doh:dt,safetyDays:bt,daysToOos:J,projectionMode:n.projectionMode}),$t=xt?"":G?"incomplete":"",Ot=j?`
            ${j.hasPo?'<span class="inventory-inbound-marker po"></span>':""}
            ${j.hasFo?'<span class="inventory-inbound-marker fo"></span>':""}
          `:"",Nt=j?Tn({alias:I,month:nt,events:j.events}):"",se=Nt?Nt.replace(/\s+/g," ").trim():"",Ft=Nt?`inventory-inbound-${P}-${nt}-${lt++}`:"";return`
          <td class="num ${R} ${zt} ${$t} inventory-projection-cell" data-month="${h(nt)}" ${Nt?`data-tooltip-html="${ue(se)}"`:""} ${Ft?`data-tooltip-id="${Ft}"`:""}>
            <span class="inventory-cell-value">${jt}</span>
            ${Ot}
          </td>
        `}).join(""),kt=N.has(P)?'<span class="cell-warning" title="PO ohne ETA wird nicht gezählt">⚠︎</span>':"";return`
        <tr class="inventory-row ${b?"is-collapsed":""}" data-sku="${h(P)}" data-category="${h(p.id)}">
          <td class="inventory-col-sku sticky-cell">${kt}${h(P)}</td>
          <td class="inventory-col-alias sticky-cell">
            <div class="inventory-alias-cell">
              <span class="inventory-alias-text">${h(I)}</span>
              ${vt}
            </div>
          </td>
          <td class="inventory-col-abc sticky-cell">${h(Z)}</td>
          <td class="inventory-col-safety-days sticky-cell num">${h(B)}</td>
          <td class="inventory-col-coverage-days sticky-cell num">${h(ft)}</td>
          ${Et}
        </tr>
      `}).join(""),w=n.projectionMode==="plan"?i.map(C=>{var _;const P=ne(C),I=(_=g.get(p.id))==null?void 0:_.get(P);return`<td class="num inventory-projection-group-cell">${Number.isFinite(I)?K(I):"—"}</td>`}).join(""):`<th colspan="${i.length}"></th>`;return`
      <tr class="inventory-category-row" data-category-row="${h(p.id)}">
        <th class="inventory-col-sku sticky-cell" colspan="5">
          <button type="button" class="tree-toggle" data-category="${h(p.id)}">${b?"▸":"▾"}</button>
          <span class="tree-label">${h(p.name)}</span>
          <span class="muted">(${p.items.length})</span>
        </th>
        ${w}
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
  `}function Vn(t,n,e,o,l){var Q;if(!t||!n||!o)return;const i=String(o.sku||"").trim(),s=he(n,i),d=(Q=e==null?void 0:e.items)==null?void 0:Q.find(p=>String(p.sku||"").trim()===i),f=Number(s.amazonUnits||0)+Number(s.threePLUnits||0),$=((d==null?void 0:d.amazonUnits)||0)+((d==null?void 0:d.threePLUnits)||0),y=f-$,S=t.querySelector(".inventory-in-transit"),D=ht((S==null?void 0:S.textContent)||0),g=f+(Number.isFinite(D)?D:0),k=Yt(o,l.settings||{}),F=Number.isFinite(k)?g*k:null,N=t.querySelector('[data-field="totalUnits"]'),z=t.querySelector('[data-field="delta"]'),q=t.querySelector('[data-field="totalValue"]');N&&(N.textContent=K(f)),z&&(z.textContent=K(y)),q&&(q.textContent=Number.isFinite(F)?W(F):"—")}function et(t){var we,Ee,ke;const n=un(),e=kn(),o=window.__routeQuery||{},l=String(o.sku||"").trim(),i=String(o.month||"").trim();l&&(e.search="",e.projectionMode="doh"),/^\d{4}-\d{2}$/.test(i)&&(e.selectedMonth=Ke(i,-1));const s=Sn(n,e);e.selectedMonth=s,rt(e),t._inventoryCleanup&&(t._inventoryCleanup(),t._inventoryCleanup=null);const d=He(n,s)||{month:s,items:[]},f=je(n,s),$=Array.isArray(n.productCategories)?n.productCategories:[],y=(n.products||[]).filter(En),S=gn(e.snapshotAsOfDate),D=S?de(S):null;let g=S&&D===s?S:bn(s);g||(g=new Date),(!S||D!==s)&&(e.snapshotAsOfDate=Jt(g),rt(e));const k=me(g);if(l){const a=y.find(u=>String((u==null?void 0:u.sku)||"").trim()===l);(a==null?void 0:a.categoryId)!=null&&(e.collapsed[String(a.categoryId)]=!1,rt(e))}const F=Number(((Ee=(we=n.inventory)==null?void 0:we.settings)==null?void 0:Ee.projectionMonths)||12),N=[6,12,18],z=vn(s,N.includes(F)?F:12),q=_t(y,e.search),Q=Oe({state:n,months:z,products:q,snapshot:d,projectionMode:e.projectionMode}),p=pe(n),b=e.projectionMode==="plan",M=Cn({state:n,view:e,snapshot:d,products:y,categories:$,asOfDate:k}),w=M.missingEk.length,C=Nn({state:n,currentSnapshot:d,previousSnapshot:f,products:y,categories:$,currentMonth:s,asOfDate:k}),P=Fn(n,k),I=f?An({reconciliation:C,stalePos:P,currentMonth:s,previousMonth:f.month}):'<div class="reco-panel reco-status-empty"><div class="muted small">Plausi-Check verfügbar sobald ein Vormonats-Snapshot existiert.</div></div>';t.innerHTML=`
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
        <span class="muted small">${f?`Vorheriger Snapshot: ${Ht(f.month)}`:"Kein vorheriger Snapshot vorhanden."}</span>
      </div>
      <div class="inventory-export">
        <div class="inventory-export-controls">
          <label class="inventory-field">
            <span class="muted">Bestandsaufnahme zum</span>
            <input type="date" id="inventory-export-date" value="${h(Jt(g))}" />
          </label>
          <button class="btn secondary" id="inventory-export-csv">Export CSV</button>
          <button class="btn secondary" id="inventory-export-pdf">Export PDF</button>
        </div>
        <div class="inventory-export-meta">
          <span class="muted small">Export für Buchführung: SKU, Bestände, In-Transit, EK-Preis, Warenwert (mit + ohne In-Transit)</span>
          ${w?`<span class="inventory-export-warning">⚠︎ EK fehlt (${w})</span>`:""}
        </div>
      </div>
      ${I}
      <div class="inventory-table-wrap ui-table-shell">
        <div class="inventory-table-scroll ui-scroll-host">
          ${Ln({state:n,view:e,snapshot:d,previousSnapshot:f,products:y,categories:$,asOfDate:k,snapshotMonth:s})}
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
          ${On({state:n,view:e,snapshot:d,products:y,categories:$,months:z,projectionData:Q,inboundData:p})}
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
  `;const Z=t.querySelector("#inventory-month");if(Z){const a=(((ke=n.inventory)==null?void 0:ke.snapshots)||[]).map(r=>r==null?void 0:r.month).filter(r=>/^\d{4}-\d{2}$/.test(r)),u=new Set([...a,Be(),s]),m=Array.from(u).sort();Z.innerHTML=m.map(r=>`<option value="${r}" ${r===s?"selected":""}>${Ht(r)}</option>`).join(""),Z.addEventListener("change",r=>{e.selectedMonth=r.target.value,rt(e),et(t)})}const _=t.querySelector("#inventory-export-date");_&&_.addEventListener("change",a=>{e.snapshotAsOfDate=a.target.value,rt(e),et(t)});const Y=t.querySelector("#inventory-export-csv");Y&&Y.addEventListener("click",()=>{if(!M.rows.length){window.alert("Keine Daten für den Export vorhanden.");return}const a=Ae(g),u=jn({title:a,rows:M.rows,totals:M.totals,missingEk:M.missingEk}),m=`bestandsaufnahme_${Jt(g)}.csv`,r=new Blob([u],{type:"text/csv"}),c=URL.createObjectURL(r),E=document.createElement("a");E.href=c,E.download=m,document.body.append(E),E.click(),E.remove(),URL.revokeObjectURL(c)});const B=t.querySelector("#inventory-export-pdf");B&&B.addEventListener("click",()=>{if(!M.rows.length){window.alert("Keine Daten für den Export vorhanden.");return}const a=Ae(g),u=$n(new Date),m=`bestandsaufnahme_${Jt(g)}.pdf`,r=zn({title:a,fileName:m,rows:M.rows,totals:M.totals,missingEk:M.missingEk,generatedAt:u}),c=window.open("","_blank","noopener,noreferrer");c&&(c.document.open(),c.document.write(r),c.document.close())});const ft=t.querySelector(".inventory-search input");ft&&ft.addEventListener("input",a=>{e.search=a.target.value||"",rt(e),et(t)});const vt=t.querySelector("#inventory-copy");vt&&vt.addEventListener("click",()=>{const a=Ce(n,s),u=je(n,s);a.items=(y||[]).map(m=>{var E;const r=String(m.sku||"").trim(),c=(E=u==null?void 0:u.items)==null?void 0:E.find(T=>String(T.sku||"").trim()===r);return{sku:r,amazonUnits:(c==null?void 0:c.amazonUnits)??0,threePLUnits:(c==null?void 0:c.threePLUnits)??0,note:(c==null?void 0:c.note)??""}}),Zt(n),et(t)});const lt=t.querySelector("#inventory-expand-all");lt&&lt.addEventListener("click",()=>{Le({products:y,categories:$,view:e,collapsed:!1}),et(t)});const Et=t.querySelector("#inventory-collapse-all");Et&&Et.addEventListener("click",()=>{Le({products:y,categories:$,view:e,collapsed:!0}),et(t)}),t.querySelectorAll("input[name='snapshot-view-mode']").forEach(a=>{a.addEventListener("change",u=>{const m=u.target.value==="eur"?"eur":"units";e.snapshotViewMode!==m&&(e.snapshotViewMode=m,rt(e),et(t))})});const kt=a=>{if(!a.length)return;const u=new Set(a.map(String));let m=0;(n.pos||[]).forEach(r=>{const c=String((r==null?void 0:r.id)||(r==null?void 0:r.poNo)||"");c&&u.has(c)&&!r.archived&&(r.archived=!0,m+=1)}),m&&(Zt(n),et(t))},ct=t.querySelector("#reco-archive-all");ct&&ct.addEventListener("click",()=>{const a=P.map(u=>u.id).filter(Boolean);a.length&&window.confirm(`${a.length} alte PO${a.length===1?"":"s"} archivieren? Sie zählen danach nicht mehr als In-Transit.`)&&kt(a)}),t.querySelectorAll(".reco-archive-one").forEach(a=>{a.addEventListener("click",u=>{const m=u.currentTarget.getAttribute("data-po-id");m&&kt([m])})});const nt=t.querySelector(".inventory-snapshot-table");let St=null;const j=()=>{St&&clearTimeout(St),St=setTimeout(()=>{const a=Ce(n,s);a!==d&&(a.items=d.items),Zt(n)},250)};if(nt){const a=m=>{const r=m.closest("tr[data-sku]");if(!r)return null;const c=r.getAttribute("data-sku"),E=y.find(L=>String(L.sku||"").trim()===c);if(!E)return null;const T=he(d,c),A=m.dataset.field;return{row:r,sku:c,product:E,item:T,field:A}},u=m=>{var at;const r=a(m);if(!r)return;const{row:c,sku:E,product:T,item:A,field:L}=r;if(L!=="amazonUnits"&&L!=="threePLUnits")return;const st=te(s,E,L),H=qt.get(st)??m.value,{value:it,isRounded:pt}=wn(H);qt.delete(st),m.value=String(it),(at=m.closest("td"))==null||at.classList.toggle("inventory-input-warn",pt),L==="amazonUnits"&&(A.amazonUnits=it),L==="threePLUnits"&&(A.threePLUnits=it),Vn(c,d,f,T,n),j()};nt.addEventListener("click",m=>{const r=m.target.closest("button.tree-toggle[data-category]");if(!r)return;const c=r.getAttribute("data-category");e.collapsed[c]=!e.collapsed[c],rt(e),et(t)}),nt.addEventListener("input",m=>{var L;const r=m.target.closest("input.inventory-input");if(!r)return;const c=a(r);if(!c)return;const{sku:E,item:T,field:A}=c;if(A==="note"){T.note=r.value,j();return}if(A==="amazonUnits"||A==="threePLUnits"){const st=te(s,E,A);qt.set(st,r.value),(L=r.closest("td"))==null||L.classList.remove("inventory-input-warn")}}),nt.addEventListener("blur",m=>{const r=m.target.closest("input.inventory-input");if(!r)return;const c=a(r);c&&c.field!=="note"&&u(r)},!0),nt.addEventListener("keydown",m=>{if(m.key!=="Enter")return;const r=m.target.closest("input.inventory-input");if(!r)return;const c=a(r);!c||c.field==="note"||(m.preventDefault(),u(r))})}const x=t.querySelector(".inventory-projection-table");x&&(x.addEventListener("click",a=>{const u=a.target.closest("button.tree-toggle[data-category]");if(!u)return;const m=u.getAttribute("data-category");e.collapsed[m]=!e.collapsed[m],rt(e),et(t)}),x.addEventListener("click",a=>{const u=a.target.closest("button.inventory-drilldown-trigger[data-action='open-drilldown']");if(u){const A=String(u.getAttribute("data-sku")||"").trim(),L=String(u.getAttribute("data-alias")||A).trim();if(!A)return;a.preventDefault(),a.stopPropagation(),Ye({sku:A,alias:L});return}if(a.target.closest("button.tree-toggle[data-category]"))return;const r=a.target.closest("td.inventory-projection-cell");if(!r)return;const c=r.closest("tr[data-sku]");if(!c)return;const E=c.getAttribute("data-sku"),T=r.getAttribute("data-month");!E||!T||(a.stopPropagation(),zt(r,{sku:E,month:T}))}));const O=t.querySelector("#inventory-tooltip-layer");let tt=null,G=null,gt=null,bt=null,J="units",R=null;function dt(a){if(!O||O.hidden)return;const u=12,m=window.innerWidth-O.offsetWidth-8,r=window.innerHeight-O.offsetHeight-8,c=Math.min(a.clientX+u,m),E=Math.min(a.clientY+u,r);O.style.left=`${Math.max(8,c)}px`,O.style.top=`${Math.max(8,E)}px`}function Dt(a,u,m){if(!O||!u)return;let r=u;try{r=decodeURIComponent(u)}catch{r=u}O.innerHTML=r,O.hidden=!1,O.classList.add("is-visible"),tt=a,dt(m)}function xt(){O&&(O.hidden=!0,O.classList.remove("is-visible"),O.innerHTML="",tt=null)}function ut(){G&&G.remove(),G=null,gt=null}function jt(a){if(!G||!a)return;const u=a.getBoundingClientRect(),m=8,r=window.innerWidth-G.offsetWidth-m,c=window.innerHeight-G.offsetHeight-m,E=Math.min(u.left,r),T=Math.min(u.bottom+6,c);G.style.left=`${Math.max(m,E)}px`,G.style.top=`${Math.max(m,T)}px`}function zt(a,{sku:u,month:m}){var it;if(!a||!u||!m)return;if(gt===a&&G){ut();return}ut();const r=((it=n.settings)==null?void 0:it.monthAnchorDay)||"START",c=Mn(m,r),E=Un(c),T=Ct(c),A=ce(m),L=Re(n,u,m),st=Number.isFinite(L)?`<div class="inventory-cell-popover-meta">Plan-Absatz in diesem Monat: ${K(L)}</div>`:"",H=document.createElement("div");H.className="inventory-cell-popover",H.innerHTML=`
      <div class="inventory-cell-popover-title">Aktion für ${h(u)}</div>
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
    `,H.addEventListener("click",pt=>{const at=pt.target.closest("button[data-action]");if(!at)return;const Mt=at.dataset.action,X=new URLSearchParams;X.set("create","1"),X.set("sku",u),X.set("anchorMonth",m),X.set("anchorDate",E),Mt==="fo"?(X.set("target",E),location.hash=`#fo?${X.toString()}`):Mt==="po"?(X.set("orderDate",E),X.set("anchorMode","order"),location.hash=`#po?${X.toString()}`):Mt==="po-arrival"&&(X.set("anchorMode","arrival"),location.hash=`#po?${X.toString()}`),ut()}),document.body.appendChild(H),G=H,gt=a,jt(a)}function $t(){R&&(clearTimeout(R),R=null),bt&&(bt.remove(),bt=null,J="units")}function Ot(a){const u=Q.perSkuMonth.get(a)||new Map,m=p.inboundMap.get(a)||new Map;return z.map(r=>{const c=u.get(r)||null,E=m.get(r)||null;return{month:r,endAvailable:Number.isFinite(c==null?void 0:c.endAvailable)?Number(c.endAvailable):null,doh:Number.isFinite(c==null?void 0:c.doh)?Number(c.doh):null,safetyUnits:Number.isFinite(c==null?void 0:c.safetyUnits)?Number(c.safetyUnits):null,safetyDays:Number.isFinite(c==null?void 0:c.safetyDays)?Number(c.safetyDays):null,daysToOos:Number.isFinite(c==null?void 0:c.daysToOos)?Number(c.daysToOos):null,forecastUnits:Number.isFinite(c==null?void 0:c.forecastUnits)?Number(c.forecastUnits):null,events:Array.isArray(E==null?void 0:E.events)?E.events:[]}})}function Nt({alias:a,monthData:u}){const m=J==="doh"?"Bestand Monatsende (DOH)":"Bestand Monatsende (DE verfügbar)",r=J==="doh"?Number.isFinite(u.doh)?`${K(u.doh)} DOH`:"—":Number.isFinite(u.endAvailable)?`${K(u.endAvailable)} Units`:"—",c=Number.isFinite(u.forecastUnits)?`${K(u.forecastUnits)} Units`:"—",E=u.events.length?u.events.map(T=>{const A=T.open?`<button class="btn sm secondary inventory-link" type="button" data-route="${h(T.route||"")}" data-open="${h(T.open||"")}">Open ${h(T.type||"")}</button>`:"";return`
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
        <div class="inventory-drilldown-tooltip-title">${h(u.month)}</div>
        <div class="muted">${h(a||"—")}</div>
      </div>
      <div class="inventory-drilldown-tooltip-kpis">
        <div>${m}: <strong>${r}</strong></div>
        <div>Plan-Absatz: <strong>${c}</strong></div>
      </div>
      <div class="inventory-drilldown-tooltip-arrivals">${E}</div>
    `}function se(a,u){if(!a||!u)return;const m=14,r=window.innerWidth-a.offsetWidth-12,c=window.innerHeight-a.offsetHeight-12,E=le(u.clientX+m,8,Math.max(8,r)),T=le(u.clientY+m,8,Math.max(8,c));a.style.left=`${E}px`,a.style.top=`${T}px`}function Ft(a){a&&(a.hidden=!0,a.innerHTML="")}function Vt(a,{sku:u,alias:m}){var De;const r=a==null?void 0:a.querySelector("[data-drilldown-chart]"),c=a==null?void 0:a.querySelector(".inventory-drilldown-tooltip");if(!r||!c)return;R&&(clearTimeout(R),R=null),Ft(c);const E=Ot(u).map(v=>{const U=e.showSafety?Ve({endAvailable:v.endAvailable,safetyUnits:v.safetyUnits,doh:v.doh,safetyDays:v.safetyDays,daysToOos:v.daysToOos,projectionMode:J==="doh"?"doh":"units"}):"";return{...v,riskClass:U}});if(!E.length){r.innerHTML='<div class="muted">Keine Projektion vorhanden.</div>';return}const T=E.length,A=72,L=56,st=20,H=18,it=210,pt=H+it+36,at=86,Mt=pt+at,X=L+st+T*A,Xe=Mt+34,ie=E.map(v=>J==="doh"?v.doh:v.endAvailable),Qe=E.map(v=>J==="doh"?v.safetyDays:v.safetyUnits),It=ie.filter(v=>Number.isFinite(v));e.showSafety&&Qe.forEach(v=>{Number.isFinite(v)&&It.push(v)});let Tt=It.length?Math.min(...It):0,Pt=It.length?Math.max(...It):1;Tt=Math.min(Tt,0),Pt<=Tt&&(Pt=Tt+1);const Ze=Math.max(1,...E.map(v=>Number.isFinite(v.forecastUnits)?v.forecastUnits:0)),Bt=v=>L+v*A+A/2,Kt=v=>H+(Pt-v)/(Pt-Tt)*it,Je=v=>{const U=Number.isFinite(v)?Math.max(0,v):0;return pt+at-U/Ze*at},Se=4,tn=Array.from({length:Se+1},(v,U)=>{const V=U/Se,mt=Pt-(Pt-Tt)*V;return{value:mt,y:Kt(mt)}}),Xt=[];let At=[];ie.forEach((v,U)=>{if(!Number.isFinite(v)){At.length&&Xt.push(At),At=[];return}At.push({x:Bt(U),y:Kt(v),index:U})}),At.length&&Xt.push(At);const xe=Math.max(12,Math.round(A*.42)),en=E.map((v,U)=>{if(!e.showSafety||!v.riskClass)return"";const V=v.riskClass==="safety-negative"?"inventory-drilldown-band-negative":"inventory-drilldown-band-low",mt=L+U*A;return`<rect class="${V}" x="${mt}" y="${H}" width="${A}" height="${Mt-H+1}"></rect>`}).join(""),nn=tn.map(v=>`
      <line class="inventory-drilldown-grid" x1="${L}" y1="${v.y.toFixed(2)}" x2="${X-st}" y2="${v.y.toFixed(2)}"></line>
      <text class="inventory-drilldown-axis-label" x="${L-8}" y="${(v.y+3).toFixed(2)}" text-anchor="end">${h(K(v.value))}</text>
    `).join(""),sn=Xt.map(v=>`<polyline class="inventory-drilldown-stock-line" points="${v.map(V=>`${V.x.toFixed(2)},${V.y.toFixed(2)}`).join(" ")}"></polyline>`).join(""),an=Xt.reduce((v,U)=>v.concat(U),[]).map(v=>`<circle class="inventory-drilldown-stock-dot" cx="${v.x.toFixed(2)}" cy="${v.y.toFixed(2)}" r="3.4"></circle>`).join(""),rn=E.map((v,U)=>{if(!Number.isFinite(v.forecastUnits)||v.forecastUnits<=0)return"";const V=Bt(U)-xe/2,mt=Je(v.forecastUnits),Qt=Math.max(1,pt+at-mt);return`<rect class="inventory-drilldown-plan-bar" x="${V.toFixed(2)}" y="${mt.toFixed(2)}" width="${xe}" height="${Qt.toFixed(2)}" rx="3"></rect>`}).join(""),on=E.map((v,U)=>{if(!v.events.length)return"";const V=v.events.some(oe=>oe.type==="PO"),mt=v.events.some(oe=>oe.type==="FO"),Qt=V&&mt?"PO+FO":V?"PO":"FO",Ne=ie[U],dn=Number.isFinite(Ne)?Kt(Ne):H+14,Fe=le(dn-22,H+2,H+it-18),re=Qt.length>2?36:24,Te=Bt(U)-re/2;return`
        <rect class="inventory-drilldown-arrival-pill" x="${Te.toFixed(2)}" y="${Fe.toFixed(2)}" width="${re}" height="14" rx="7"></rect>
        <text class="inventory-drilldown-arrival-pill-text" x="${(Te+re/2).toFixed(2)}" y="${(Fe+10.2).toFixed(2)}" text-anchor="middle">${Qt}</text>
      `}).join(""),ln=E.map((v,U)=>`
      <text class="inventory-drilldown-axis-label" x="${Bt(U).toFixed(2)}" y="${(Mt+16).toFixed(2)}" text-anchor="middle">${h(Ht(v.month))}</text>
    `).join(""),cn=E.map((v,U)=>{const V=L+U*A;return`<rect class="inventory-drilldown-hit" data-index="${U}" x="${V}" y="${H}" width="${A}" height="${Mt-H+18}"></rect>`}).join("");let ae="";if(e.showSafety&&J==="doh"){const v=(De=E.find(U=>Number.isFinite(U.safetyDays)))==null?void 0:De.safetyDays;if(Number.isFinite(v)){const U=Kt(v);ae=`
          <line class="inventory-drilldown-safety-line" x1="${L}" y1="${U.toFixed(2)}" x2="${X-st}" y2="${U.toFixed(2)}"></line>
          <text class="inventory-drilldown-axis-label" x="${X-st}" y="${(U-6).toFixed(2)}" text-anchor="end">Safety ${h(K(v))}</text>
        `}}else if(e.showSafety){const v=[];let U=[];E.forEach((V,mt)=>{if(!Number.isFinite(V.safetyUnits)){U.length&&v.push(U),U=[];return}U.push(`${Bt(mt).toFixed(2)},${Kt(V.safetyUnits).toFixed(2)}`)}),U.length&&v.push(U),ae=v.map(V=>`<polyline class="inventory-drilldown-safety-line" points="${V.join(" ")}"></polyline>`).join("")}r.innerHTML=`
      <svg class="inventory-drilldown-svg" viewBox="0 0 ${X} ${Xe}" role="img" aria-label="SKU Verlauf ${h(m||u)} (${h(u)})">
        ${en}
        ${nn}
        <line class="inventory-drilldown-axis" x1="${L}" y1="${(H+it).toFixed(2)}" x2="${X-st}" y2="${(H+it).toFixed(2)}"></line>
        <line class="inventory-drilldown-axis" x1="${L}" y1="${(pt+at).toFixed(2)}" x2="${X-st}" y2="${(pt+at).toFixed(2)}"></line>
        <text class="inventory-drilldown-axis-label" x="${L}" y="${(H-6).toFixed(2)}">${J==="doh"?"DOH":"Units"}</text>
        <text class="inventory-drilldown-axis-label" x="${L}" y="${(pt-8).toFixed(2)}">Plan-Absatz (Units)</text>
        ${ae}
        ${rn}
        ${sn}
        ${an}
        ${on}
        ${ln}
        ${cn}
      </svg>
    `;const Me=()=>{R&&clearTimeout(R),R=setTimeout(()=>{c.matches(":hover")||Ft(c)},120)},Ue=(v,U)=>{R&&(clearTimeout(R),R=null);const V=E[U];V&&(c.innerHTML=Nt({alias:m,monthData:V}),c.hidden=!1,se(c,v))};r.querySelectorAll(".inventory-drilldown-hit").forEach(v=>{const U=Number(v.getAttribute("data-index"));v.onmouseenter=V=>Ue(V,U),v.onmousemove=V=>Ue(V,U),v.onmouseleave=()=>Me()}),r.onmouseleave=()=>Me(),c.onmouseenter=()=>{R&&(clearTimeout(R),R=null)},c.onmouseleave=()=>Ft(c)}function Ye({sku:a,alias:u}){if(!a)return;$t(),J="units";const m=u||a,r=document.createElement("div");r.className="po-modal-backdrop inventory-drilldown-backdrop",r.setAttribute("role","dialog"),r.setAttribute("aria-modal","true"),r.innerHTML=`
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
    `,r.addEventListener("click",c=>{if(c.target===r||c.target.closest("[data-drilldown-close]")){$t();return}const E=c.target.closest(".inventory-link");if(!E)return;const T=E.getAttribute("data-route"),A=E.getAttribute("data-open");if(!T||!A)return;const L=new URLSearchParams;L.set("open",A),location.hash=`${T}?${L.toString()}`,$t()}),r.addEventListener("change",c=>{const E=c.target.closest("input[name='inventory-drilldown-mode']");E&&(J=E.value==="doh"?"doh":"units",Vt(r,{sku:a,alias:m}))}),document.body.appendChild(r),bt=r,Vt(r,{sku:a,alias:m})}t.addEventListener("mouseover",a=>{const u=a.target.closest("[data-tooltip-html]");if(!u||u===tt)return;const m=u.getAttribute("data-tooltip-html");m&&Dt(u,m,a)}),t.addEventListener("mousemove",a=>{tt&&dt(a)}),t.addEventListener("mouseout",a=>{if(!tt||a.relatedTarget&&O&&O.contains(a.relatedTarget))return;const u=a.target.closest("[data-tooltip-html]");u&&u===tt&&xt()}),O&&O.addEventListener("mouseleave",()=>{xt()});const ye=a=>{if(!G||G.contains(a.target))return;const u=a.target.closest("td.inventory-projection-cell");u&&gt===u||ut()},ve=a=>{a.key==="Escape"&&(ut(),$t())};document.addEventListener("click",ye),document.addEventListener("keydown",ve);const Gt=t.querySelector(".inventory-table-scroll"),ge=()=>ut();Gt&&Gt.addEventListener("scroll",ge),t.addEventListener("click",a=>{const u=a.target.closest(".inventory-link");if(!u)return;const m=u.getAttribute("data-route"),r=u.getAttribute("data-open");if(!m||!r)return;const c=new URLSearchParams;c.set("open",r),location.hash=`${m}?${c.toString()}`});const be=t.querySelector("#inventory-horizon");be&&be.addEventListener("change",a=>{const u=Number(a.target.value||12);n.inventory||(n.inventory={snapshots:[],settings:{}}),n.inventory.settings||(n.inventory.settings={}),n.inventory.settings.projectionMonths=u,Zt(n),et(t)});const $e=t.querySelector("#inventory-safety");$e&&$e.addEventListener("change",a=>{e.showSafety=a.target.checked,rt(e),et(t)}),t.querySelectorAll("input[name='inventory-mode']").forEach(a=>{a.addEventListener("change",u=>{const m=u.target.value;e.projectionMode=m==="doh"||m==="plan"?m:"units",rt(e),et(t)})});function Ge(){if(!l)return;const a=Pe(l),u=/^\d{4}-\d{2}$/.test(i)?`[data-month="${Pe(i)}"]`:"[data-month]",m=t.querySelector(`.inventory-projection-table tr[data-sku="${a}"] td${u}`),r=m?m.closest("tr[data-sku]"):t.querySelector(`.inventory-projection-table tr[data-sku="${a}"]`);r&&r.classList.add("row-focus"),m?(m.classList.add("cell-focus"),m.scrollIntoView({behavior:"smooth",block:"center",inline:"center"})):r&&r.scrollIntoView({behavior:"smooth",block:"center"}),window.__routeQuery={}}Ge(),t._inventoryCleanup=()=>{document.removeEventListener("click",ye),document.removeEventListener("keydown",ve),Gt&&Gt.removeEventListener("scroll",ge),ut(),$t()}}const qn={render:et};export{qn as default,et as render};
