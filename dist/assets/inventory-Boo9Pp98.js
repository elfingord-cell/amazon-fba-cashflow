import{l as un,c as Zt,a as mn,b as hn}from"./store-BxxNQAKz.js";import{k as ht}from"./index-Da2sM-BG.js";import{b as fn}from"./abcClassification-DsoltykQ.js";import{c as Oe,r as pn,a as yn,g as Ve}from"./inventoryProjection-BDFxXil1.js";const Ie="inventory_view_v1";function h(t){return String(t??"").replace(/[&<>"']/g,n=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[n])}function Pe(t){return typeof CSS<"u"&&typeof CSS.escape=="function"?CSS.escape(t):String(t).replace(/["\\]/g,"\\$&")}function Be(){const t=new Date;return`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}`}function Rt(t){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[n,e]=t.split("-").map(Number);return n*12+(e-1)}function Ke(t,n){const[e,c]=t.split("-").map(Number),o=e*12+(c-1)+n,i=Math.floor(o/12),s=o%12+1;return`${i}-${String(s).padStart(2,"0")}`}function vn(t,n){return Array.from({length:n},(e,c)=>Ke(t,c+1))}function Ht(t){if(!t)return"—";const[n,e]=t.split("-");return`${e}-${n}`}function ce(t){if(!t)return"—";const[n,e]=t.split("-");return`${e}/${n}`}function Jt(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return"";const n=t.getFullYear(),e=String(t.getMonth()+1).padStart(2,"0"),c=String(t.getDate()).padStart(2,"0");return`${n}-${e}-${c}`}function gn(t){if(!t)return null;const n=new Date(`${t}T00:00:00`);return Number.isNaN(n.getTime())?null:n}function bn(t){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[n,e]=t.split("-").map(Number);return new Date(n,e,0)}function me(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return null;const n=new Date(t.getTime());return n.setHours(23,59,59,999),n}function Ae(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"Bestandsaufnahme":`Bestandsaufnahme zum ${Ct(t)}`}function $n(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return"—";const n=t.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}),e=t.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});return`${n} ${e}`}function wn(t){if(t==null||t==="")return{value:0,isRounded:!1};const n=ht(String(t));if(!Number.isFinite(n))return{value:0,isRounded:!1};const e=Math.round(n);return{value:e,isRounded:e!==n}}function Re(t,n,e){var p,b,y,S,D,$,k;const c=ne(e);if(!c)return null;const o=(y=(b=(p=t==null?void 0:t.forecast)==null?void 0:p.forecastManual)==null?void 0:b[n])==null?void 0:y[c],i=ht(o);if(Number.isFinite(i))return i;const s=(k=($=(D=(S=t==null?void 0:t.forecast)==null?void 0:S.forecastImport)==null?void 0:D[n])==null?void 0:$[c])==null?void 0:k.units,r=ht(s);return Number.isFinite(r)?r:null}function K(t){return t==null||!Number.isFinite(Number(t))?"—":Math.round(Number(t)).toLocaleString("de-DE",{maximumFractionDigits:0})}function le(t,n,e){return Math.min(e,Math.max(n,t))}function _t(t,n){const e=String(n||"").trim().toLowerCase();return e?t.filter(c=>String(c.alias||"").toLowerCase().includes(e)||String(c.sku||"").toLowerCase().includes(e)):t}function En(t){if(!t)return!1;if(typeof t.active=="boolean")return t.active;const n=String(t.status||"").trim().toLowerCase();return n?n==="active"||n==="aktiv":!0}function ee(t,n=[]){const e=new Map;t.forEach(s=>{const r=s.categoryId?String(s.categoryId):"";e.has(r)||e.set(r,[]),e.get(r).push(s)});const o=n.slice().sort((s,r)=>{const p=Number.isFinite(s.sortOrder)?s.sortOrder:0,b=Number.isFinite(r.sortOrder)?r.sortOrder:0;return p-b||String(s.name||"").localeCompare(String(r.name||""))}).map(s=>({id:String(s.id),name:s.name||"Ohne Kategorie",items:e.get(String(s.id))||[]})),i=e.get("")||[];return i.length&&o.push({id:"uncategorized",name:"Ohne Kategorie",items:i}),o.filter(s=>s.items.length)}function kn(){const t=mn(Ie,{}),n=t.projectionMode==="doh"||t.projectionMode==="plan"?t.projectionMode:"units",e=t.snapshotViewMode==="eur"?"eur":"units";return{selectedMonth:t.selectedMonth||null,collapsed:t.collapsed&&typeof t.collapsed=="object"?t.collapsed:{},search:t.search||"",showSafety:t.showSafety!==!1,projectionMode:n,snapshotAsOfDate:t.snapshotAsOfDate||"",snapshotViewMode:e}}function rt(t){hn(Ie,t)}function Sn(t,n){var s;const e=(((s=t.inventory)==null?void 0:s.snapshots)||[]).map(r=>r==null?void 0:r.month).filter(r=>/^\d{4}-\d{2}$/.test(r)).sort(),c=e[e.length-1],o=Be(),i=n.selectedMonth||c||o;return i||o}function Le({products:t,categories:n,view:e,collapsed:c}){const o=_t(t,e.search),i=ee(o,n),s={...e.collapsed};i.forEach(r=>{s[r.id]=c}),e.collapsed=s,rt(e)}function ne(t){if(!t)return null;const n=String(t);if(/^\d{4}-\d{2}$/.test(n))return n;const e=n.match(/^(\d{2})-(\d{4})$/);return e?`${e[2]}-${e[1]}`:n}function He(t,n){var e;return(((e=t.inventory)==null?void 0:e.snapshots)||[]).find(c=>(c==null?void 0:c.month)===n)||null}function Ce(t,n){const e=He(t,n);if(e)return e;const c={month:n,items:[]};return t.inventory||(t.inventory={snapshots:[],settings:{}}),Array.isArray(t.inventory.snapshots)||(t.inventory.snapshots=[]),t.inventory.snapshots.push(c),c}function he(t,n){if(!t||!n)return null;Array.isArray(t.items)||(t.items=[]);let e=t.items.find(c=>String(c.sku||"").trim()===n);return e||(e={sku:n,amazonUnits:0,threePLUnits:0,note:""},t.items.push(e)),e}function je(t,n){var i;const e=Rt(n);if(e==null)return null;const c=(((i=t.inventory)==null?void 0:i.snapshots)||[]).filter(s=>(s==null?void 0:s.month)&&Rt(s.month)!=null).slice().sort((s,r)=>Rt(s.month)-Rt(r.month));let o=null;return c.forEach(s=>{const r=Rt(s.month);r!=null&&r<e&&(o=s)}),o}function Wt(t,n){if(!n)return"—";const c=(Array.isArray(t.suppliers)?t.suppliers:[]).find(o=>String(o.id||"")===String(n));return(c==null?void 0:c.name)||n||"—"}function Lt(t){if(!t)return null;const n=new Date(t);return Number.isNaN(n.getTime())?null:n}function de(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?null:`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}`}function fe(t){const n=Lt((t==null?void 0:t.etaManual)||(t==null?void 0:t.etaDate)||(t==null?void 0:t.eta));if(n)return n;const e=Lt(t==null?void 0:t.etaComputed);if(e)return e;const c=Lt(t==null?void 0:t.orderDate);if(!c)return null;const o=Number((t==null?void 0:t.prodDays)||0),i=Number((t==null?void 0:t.transitDays)||0),s=new Date(c.getTime());return s.setDate(s.getDate()+Math.max(0,o+i)),s}function qe(t){return Lt((t==null?void 0:t.targetDeliveryDate)||(t==null?void 0:t.deliveryDate)||(t==null?void 0:t.etaDate))}function We(t){const n=String((t==null?void 0:t.status)||"").toUpperCase();return!(n==="CONVERTED"||n==="CANCELLED")}function xn(t,n,e){const c=e.map(i=>ne(i)).filter(Boolean),o=new Map;return t.forEach(i=>{const s=new Map;c.forEach(r=>{let p=0,b=!1;i.items.forEach(y=>{var $;const S=String((y==null?void 0:y.sku)||"").trim();if(!S)return;const D=($=n.get(S))==null?void 0:$.get(r);Number.isFinite(D)&&(p+=D,b=!0)}),b&&s.set(r,p)}),o.set(i.id,s)}),o}function Yt(t,n){var i;const e=((i=t==null?void 0:t.template)==null?void 0:i.fields)||(t==null?void 0:t.template)||{},c=ht(e.unitPriceUsd??(t==null?void 0:t.unitPriceUsd)??null);if(!Number.isFinite(c))return null;const o=String(e.currency||(n==null?void 0:n.defaultCurrency)||"EUR").toUpperCase();if(o==="EUR")return c;if(o==="USD"){const s=ht(n==null?void 0:n.fxRate);return!Number.isFinite(s)||s<=0?null:c/s}return null}function W(t){return t==null||!Number.isFinite(Number(t))?"—":Number(t).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function Ct(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"—":t.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"})}function Mn(t,n){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[e,c]=t.split("-").map(Number);if(!Number.isFinite(e)||!Number.isFinite(c))return null;const o=String(n).toUpperCase();let i=1;return o==="MID"&&(i=15),o==="END"&&(i=new Date(e,c,0).getDate()),new Date(Date.UTC(e,c-1,i))}function Un(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"—":t.toISOString().slice(0,10)}function Dn(t){const n=Lt((t==null?void 0:t.etdManual)||(t==null?void 0:t.etdDate));if(n)return n;const e=Lt(t==null?void 0:t.orderDate);if(!e)return null;const c=Number((t==null?void 0:t.prodDays)||0),o=new Date(e.getTime());return o.setDate(o.getDate()+Math.max(0,c)),o}function pe(t){const n=new Map,e=new Set;function c(i,s){n.has(i)||n.set(i,new Map);const r=n.get(i);return r.has(s)||r.set(s,{events:[],hasPo:!1,hasFo:!1,poUnits:0,foUnits:0}),r.get(s)}function o(i,s,r){const p=c(i,s),b=p.events.find(y=>y.type===r.type&&y.id===r.id);b?b.qty+=r.qty:p.events.push({...r}),r.type==="PO"&&(p.hasPo=!0,p.poUnits+=r.qty),r.type==="FO"&&(p.hasFo=!0,p.foUnits+=r.qty)}return(t.pos||[]).forEach(i=>{if(!i||i.archived)return;const s=Array.isArray(i.items)&&i.items.length?i.items:[{sku:i.sku,units:i.units}],r=fe(i),p=r?de(r):null;s.forEach(b=>{const y=String((b==null?void 0:b.sku)||"").trim();if(!y)return;const S=ht((b==null?void 0:b.units)??0),D=Number.isFinite(S)?Math.round(S):0;if(!p){e.add(y);return}o(y,p,{type:"PO",id:String(i.id||i.poNo||y),label:i.poNo||i.id||"PO",supplier:Wt(t,i.supplierId||i.supplier),qty:D,date:r?r.toISOString().slice(0,10):"—",route:"#po",open:i.id||i.poNo||""})})}),(t.fos||[]).forEach(i=>{if(!i||!We(i))return;const s=Array.isArray(i.items)&&i.items.length?i.items:[{sku:i.sku,units:i.units}],r=qe(i),p=r?de(r):null;p&&s.forEach(b=>{const y=String((b==null?void 0:b.sku)||"").trim();if(!y)return;const S=ht((b==null?void 0:b.units)??0),D=Number.isFinite(S)?Math.round(S):0;o(y,p,{type:"FO",id:String(i.id||i.foNo||y),label:i.foNo||i.id||"FO",supplier:Wt(t,i.supplierId||i.supplier),qty:D,date:r?r.toISOString().slice(0,10):"—",route:"#fo",open:i.id||i.foNo||""})})}),{inboundMap:n,missingEtaSkus:e}}function Nn({state:t,currentSnapshot:n,previousSnapshot:e,products:c,categories:o,currentMonth:i,asOfDate:s}){const r=t.settings||{},p=new Map;c.forEach(f=>{const g=String((f==null?void 0:f.sku)||"").trim();g&&p.set(g,f)});const b=new Map;(o||[]).forEach(f=>{(f==null?void 0:f.id)!=null&&b.set(String(f.id),f.name||"Ohne Kategorie")});const y=f=>{const g=(f==null?void 0:f.categoryId)!=null?String(f.categoryId):"";return g?{id:g,name:b.get(g)||"Ohne Kategorie"}:{id:"uncategorized",name:"Ohne Kategorie"}},S=f=>{const g=p.get(f);return Yt(g,r)},D=()=>({measuredPrev:0,measuredCurr:0,inboundEur:0,salesEur:0,hasMissingEk:!1}),$=new Map,k=(f,g)=>($.has(f)||$.set(f,{id:f,name:g,...D()}),$.get(f)),F=(f,g)=>{f&&(f.items||[]).forEach(M=>{const w=String(M.sku||"").trim();if(!w)return;const C=p.get(w);if(!C)return;const P=Number(M.amazonUnits||0)+Number(M.threePLUnits||0),I=S(w),Z=y(C),_=k(Z.id,Z.name);if(!Number.isFinite(I)){_.hasMissingEk=!0;return}_[g]+=P*I})};F(e,"measuredPrev"),F(n,"measuredCurr");const N=ne(i),{inboundMap:z}=pe(t);z.forEach((f,g)=>{const M=f.get(N);if(!M)return;const w=(M.poUnits||0)+(M.foUnits||0);if(!w)return;const C=p.get(g);if(!C)return;const P=S(g),I=y(C),Z=k(I.id,I.name);if(!Number.isFinite(P)){Z.hasMissingEk=!0;return}Z.inboundEur+=w*P}),c.forEach(f=>{const g=String((f==null?void 0:f.sku)||"").trim();if(!g)return;const M=Re(t,g,N);if(!Number.isFinite(M)||!M)return;const w=S(g),C=y(f),P=k(C.id,C.name);if(!Number.isFinite(w)){P.hasMissingEk=!0;return}P.salesEur+=M*w});const q=Array.from($.values()).map(f=>{const g=f.measuredCurr-f.measuredPrev,M=f.inboundEur-f.salesEur;return{...f,measuredDelta:g,expectedDelta:M,discrepancy:g-M}}).sort((f,g)=>Math.abs(g.discrepancy)-Math.abs(f.discrepancy)),Q=q.reduce((f,g)=>(f.measuredPrev+=g.measuredPrev,f.measuredCurr+=g.measuredCurr,f.measuredDelta+=g.measuredDelta,f.inboundEur+=g.inboundEur,f.salesEur+=g.salesEur,f.expectedDelta+=g.expectedDelta,f.discrepancy+=g.discrepancy,g.hasMissingEk&&(f.hasMissingEk=!0),f),{measuredPrev:0,measuredCurr:0,measuredDelta:0,inboundEur:0,salesEur:0,expectedDelta:0,discrepancy:0,hasMissingEk:!1});return{currentMonth:N,previousMonth:(e==null?void 0:e.month)||null,perCategory:q,totals:Q,forecastIsSurrogate:!0}}function Fn(t,n){const e=me(n)||new Date,c=t.settings||{},o=new Map;(t.products||[]).forEach(s=>{const r=String((s==null?void 0:s.sku)||"").trim();r&&o.set(r,s)});const i=[];return(t.pos||[]).forEach(s=>{if(!s||s.archived)return;const r=String(s.status||"").toUpperCase();if(r==="CANCELLED"||r==="ARRIVED"||r==="RECEIVED")return;const p=fe(s);if(!p||p>e)return;const b=Array.isArray(s.items)&&s.items.length?s.items:[{sku:s.sku,units:s.units}];let y=0,S=0,D=!1;b.forEach($=>{const k=String(($==null?void 0:$.sku)||"").trim();if(!k)return;const F=Math.round(ht(($==null?void 0:$.units)??0)||0);y+=F;const N=o.get(k),z=Yt(N,c);if(!Number.isFinite(z)){D=!0;return}S+=F*z}),i.push({id:s.id||s.poNo||"",label:s.poNo||s.id||"PO",supplier:Wt(t,s.supplierId||s.supplier),etaDate:p,etaLabel:Ct(p),ageDays:Math.max(0,Math.round((e-p)/(24*60*60*1e3))),units:y,valueEur:S,hasMissingEk:D})}),i.sort((s,r)=>r.ageDays-s.ageDays),i}function _e(t,n){const e=new Map,c=new Date,o=me(n)||c,i=(s,r)=>{e.has(s)||e.set(s,{total:0,entries:[]});const p=e.get(s);p.total+=r.qty,p.entries.push(r)};return(t.pos||[]).forEach(s=>{if(!s||s.archived||String(s.status||"").toUpperCase()==="CANCELLED")return;const r=fe(s);if(r&&r<=o)return;const p=Dn(s);(Array.isArray(s.items)&&s.items.length?s.items:[{sku:s.sku,units:s.units}]).forEach(y=>{const S=String((y==null?void 0:y.sku)||"").trim();if(!S)return;const D=ht((y==null?void 0:y.units)??0),$=Number.isFinite(D)?Math.round(D):0;$&&i(S,{type:"PO",id:String(s.id||s.poNo||S),label:s.poNo||s.id||"PO",supplier:Wt(t,s.supplierId||s.supplier),qty:$,etd:p?Ct(p):"—",eta:r?Ct(r):"—",route:"#po",open:s.id||s.poNo||""})})}),(t.fos||[]).forEach(s=>{if(!s||!We(s))return;const r=qe(s);if(r&&r<=o)return;(Array.isArray(s.items)&&s.items.length?s.items:[{sku:s.sku,units:s.units}]).forEach(b=>{const y=String((b==null?void 0:b.sku)||"").trim();if(!y)return;const S=ht((b==null?void 0:b.units)??0),D=Number.isFinite(S)?Math.round(S):0;D&&i(y,{type:"FO",id:String(s.id||s.foNo||y),label:s.foNo||s.id||"FO",supplier:Wt(t,s.supplierId||s.supplier),qty:D,etd:"—",eta:r?Ct(r):"—",route:"#fo",open:s.id||s.foNo||""})})}),e}function Tn({alias:t,month:n,events:e}){if(!e||!e.length)return"";const c=e.map(o=>`
    <div class="inventory-tooltip-row">
      <div>
        <strong>${h(o.type)} ${h(o.label)}</strong>
        <div class="muted">${h(o.supplier||"—")}</div>
      </div>
      <div class="inventory-tooltip-meta">
        <div>${K(o.qty)}</div>
        <div class="muted">${h(o.date||"—")}</div>
      </div>
    </div>
    <div class="inventory-tooltip-actions">
      <button class="btn sm secondary inventory-link" type="button" data-route="${o.route}" data-open="${h(o.open)}">${o.type==="FO"?"Open FO":"Open PO"}</button>
    </div>
  `).join("");return`
    <div class="inventory-tooltip">
      <div class="inventory-tooltip-header">
        <div class="inventory-tooltip-title">Inbound arrivals in ${Ht(n)}</div>
        <div class="inventory-tooltip-alias">${h(t)}</div>
      </div>
      <div class="inventory-tooltip-body">${c}</div>
    </div>
  `}function Pn({alias:t,entries:n}){if(!n||!n.length)return"";const e=n.map(c=>`
    <div class="inventory-tooltip-row">
      <div>
        <strong>${h(c.type)} ${h(c.label)}</strong>
        <div class="muted">${h(c.supplier||"—")}</div>
      </div>
      <div class="inventory-tooltip-meta">
        <div>${K(c.qty)}</div>
        <div class="muted">ETD ${h(c.etd)} · ETA ${h(c.eta)}</div>
      </div>
    </div>
    <div class="inventory-tooltip-actions">
      <button class="btn sm secondary inventory-link" type="button" data-route="${c.route}" data-open="${h(c.open)}">Open ${c.type}</button>
    </div>
  `).join("");return`
    <div class="inventory-tooltip">
      <div class="inventory-tooltip-header">
        <div class="inventory-tooltip-title">In Transit</div>
        <div class="inventory-tooltip-alias">${h(t||"—")}</div>
      </div>
      <div class="inventory-tooltip-body">${e}</div>
    </div>
  `}function ue(t){return encodeURIComponent(t||"")}const qt=new Map;function te(t,n,e){return`${t||"unknown"}:${n}:${e}`}function wt(t){if(t==null||!Number.isFinite(Number(t)))return"—";const n=Number(t);return`${n>0?"+":n<0?"−":""}${W(Math.abs(n))}`}function ze(t,n){const e=Math.abs(t),c=Math.abs(n),o=t-n,i=Math.max(e,c,1),s=Math.abs(o)/i;return Math.abs(o)<100||s<.05?"ok":s<.2?"warn":"bad"}function An({reconciliation:t,stalePos:n,currentMonth:e,previousMonth:c}){const o=t.totals,i=ze(o.measuredDelta,o.expectedDelta),s=i==="ok"?"Plausibel":i==="warn"?"Auffällig":"Stark abweichend",r=`reco-status-${i}`,p=e?ce(e):"—",b=c?ce(c):"—",y=o.hasMissingEk?'<span class="cell-warning" title="Mindestens ein Produkt ohne EK">⚠︎ EK fehlt teils</span>':"",S=t.perCategory.length?t.perCategory.map($=>`
          <tr class="reco-cat-row reco-cat-${ze($.measuredDelta,$.expectedDelta)}">
            <td>${h($.name)}${$.hasMissingEk?' <span class="cell-warning" title="EK fehlt">⚠︎</span>':""}</td>
            <td class="num">${W($.measuredPrev)}</td>
            <td class="num">${W($.measuredCurr)}</td>
            <td class="num"><strong>${wt($.measuredDelta)}</strong></td>
            <td class="num">${W($.inboundEur)}</td>
            <td class="num">${W($.salesEur)}</td>
            <td class="num"><strong>${wt($.expectedDelta)}</strong></td>
            <td class="num"><strong>${wt($.discrepancy)}</strong></td>
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
            ${n.map($=>`
              <tr data-stale-po="${h($.id)}">
                <td>${h($.label)}</td>
                <td>${h($.supplier||"—")}</td>
                <td class="num">${h($.etaLabel)}</td>
                <td class="num">${K($.ageDays)}</td>
                <td class="num">${K($.units)}</td>
                <td class="num">${$.hasMissingEk?"⚠︎ ":""}${W($.valueEur)}</td>
                <td><button class="btn sm secondary reco-archive-one" data-po-id="${h($.id)}">Archivieren</button></td>
              </tr>
            `).join("")}
            <tr class="reco-stale-total">
              <td colspan="4"><strong>Summe offener Volumen</strong></td>
              <td class="num"><strong>${K(n.reduce(($,k)=>$+k.units,0))}</strong></td>
              <td class="num"><strong>${W(n.reduce(($,k)=>$+(Number.isFinite(k.valueEur)?k.valueEur:0),0))}</strong></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    `:'<div class="reco-stale-empty muted small">✓ Keine alten POs mit überfälliger ETA. In-Transit-Wert sollte sauber sein.</div>';return`
    <div class="reco-panel ${r}">
      <div class="reco-head">
        <div>
          <h3>Plausi-Check ${h(b)} → ${h(p)}</h3>
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
          <strong class="reco-kpi-value">${wt(o.measuredDelta)}</strong>
          <span class="muted small">${W(o.measuredPrev)} → ${W(o.measuredCurr)}</span>
        </div>
        <div class="reco-kpi">
          <span class="muted small">Erwartete Veränderung</span>
          <strong class="reco-kpi-value">${wt(o.expectedDelta)}</strong>
          <span class="muted small">Wareneingänge ${W(o.inboundEur)} − Verkäufe ${W(o.salesEur)}</span>
        </div>
        <div class="reco-kpi reco-kpi-diff">
          <span class="muted small">Diskrepanz (Phantom-Bestand)</span>
          <strong class="reco-kpi-value">${wt(o.discrepancy)}</strong>
          <span class="muted small">Δ gemessen − Δ erwartet</span>
        </div>
      </div>
      <details class="reco-breakdown" ${i==="ok"?"":"open"}>
        <summary>Aufschlüsselung pro Kategorie (sortiert nach Diskrepanz)</summary>
        <table class="table-compact ui-table-standard reco-category-table">
          <thead>
            <tr>
              <th>Kategorie</th>
              <th class="num">Bestand ${h(b)} €</th>
              <th class="num">Bestand ${h(p)} €</th>
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
              <td class="num"><strong>${W(o.measuredPrev)}</strong></td>
              <td class="num"><strong>${W(o.measuredCurr)}</strong></td>
              <td class="num"><strong>${wt(o.measuredDelta)}</strong></td>
              <td class="num"><strong>${W(o.inboundEur)}</strong></td>
              <td class="num"><strong>${W(o.salesEur)}</strong></td>
              <td class="num"><strong>${wt(o.expectedDelta)}</strong></td>
              <td class="num"><strong>${wt(o.discrepancy)}</strong></td>
            </tr>
          </tbody>
        </table>
      </details>
      ${D}
    </div>
  `}function Ln({state:t,view:n,snapshot:e,previousSnapshot:c,products:o,categories:i,asOfDate:s,snapshotMonth:r}){const p=_t(o,n.search),b=n.snapshotViewMode==="eur"?"eur":"units",y=b==="eur",S=ee(p,i),D=new Map;((c==null?void 0:c.items)||[]).forEach(g=>{const M=String(g.sku||"").trim();M&&D.set(M,g)});const $=_e(t,s),k={amazonUnits:0,threePLUnits:0,totalUnits:0,inTransit:0,totalValue:0,amazonEur:0,threePlEur:0,totalEur:0,inTransitEur:0,deltaUnits:0,deltaEur:0,valueComplete:!0},F=g=>K(g),N=g=>Number.isFinite(g)?W(g):"—",z=S.map(g=>{const M=n.collapsed[g.id],w={amazonUnits:0,threePLUnits:0,totalUnits:0,inTransit:0,totalValue:0,amazonEur:0,threePlEur:0,totalEur:0,inTransitEur:0,deltaUnits:0,deltaEur:0,valueComplete:!0},C=g.items.map(_=>{const Y=String(_.sku||"").trim(),B=he(e,Y),ft=$.get(Y),vt=ft?ft.total:0,lt=D.get(Y),Et=Number((B==null?void 0:B.amazonUnits)||0),kt=Number((B==null?void 0:B.threePLUnits)||0),ct=Et+kt,nt=ct+vt,St=((lt==null?void 0:lt.amazonUnits)||0)+((lt==null?void 0:lt.threePLUnits)||0),j=ct-St,x=Yt(_,t.settings||{}),O=Number.isFinite(x)?nt*x:null,tt=Number.isFinite(x)?Et*x:null,G=Number.isFinite(x)?kt*x:null,gt=Number.isFinite(x)?ct*x:null,bt=Number.isFinite(x)?vt*x:null,J=Number.isFinite(x)?j*x:null,R=!Number.isFinite(x),dt=ft&&ft.entries.length?Pn({alias:_.alias||Y,entries:ft.entries}):"";w.amazonUnits+=Et,w.threePLUnits+=kt,w.totalUnits+=ct,w.inTransit+=vt,w.deltaUnits+=j,R?w.valueComplete=!1:(w.totalValue+=O,w.amazonEur+=tt,w.threePlEur+=G,w.totalEur+=gt,w.inTransitEur+=bt,w.deltaEur+=J);const Ut=qt.get(te(r,Y,"amazonUnits")),xt=qt.get(te(r,Y,"threePLUnits")),ut=y?`<td class="num inventory-value" data-field="amazonEur">${N(tt)}</td>`:`<td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="amazonUnits" value="${h(Ut??String((B==null?void 0:B.amazonUnits)??0))}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>`,jt=y?`<td class="num inventory-value" data-field="threePlEur">${N(G)}</td>`:`<td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="threePLUnits" value="${h(xt??String((B==null?void 0:B.threePLUnits)??0))}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>`,zt=y?`<td class="num inventory-value" data-field="totalEur">${N(gt)}</td>`:`<td class="num inventory-value" data-field="totalUnits">${F(ct)}</td>`,$t=y?`<td class="num inventory-value inventory-in-transit" data-field="inTransitEur" data-tooltip-html="${ue(dt)}">${N(bt)}</td>`:`<td class="num inventory-value inventory-in-transit" data-tooltip-html="${ue(dt)}">${F(vt)}</td>`,Ot=y?`<td class="num inventory-value" data-field="deltaEur">${N(J)}</td>`:`<td class="num inventory-value" data-field="delta">${F(j)}</td>`;return`
        <tr class="inventory-row ${M?"is-collapsed":""}" data-sku="${h(Y)}" data-category="${h(g.id)}">
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
      `}).join("");k.amazonUnits+=w.amazonUnits,k.threePLUnits+=w.threePLUnits,k.totalUnits+=w.totalUnits,k.inTransit+=w.inTransit,k.deltaUnits+=w.deltaUnits,w.valueComplete?(k.totalValue+=w.totalValue,k.amazonEur+=w.amazonEur,k.threePlEur+=w.threePlEur,k.totalEur+=w.totalEur,k.inTransitEur+=w.inTransitEur,k.deltaEur+=w.deltaEur):k.valueComplete=!1;const P=`Zwischensumme ${g.name}`,I=w.valueComplete?"":' <span class="cell-warning" title="Mindestens ein Produkt ohne EK">⚠︎</span>',Z=y?`
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
    `,f=S.length?`
    <tr class="inventory-grandtotal-row">
      <td class="inventory-col-sku sticky-cell" colspan="2"><strong>Gesamtsumme</strong></td>
      ${Q}
    </tr>
  `:"";return`
    <table class="table-compact ui-table-standard inventory-table inventory-snapshot-table" data-ui-table="true" data-sticky-cols="2" data-sticky-owner="manual" data-view-mode="${h(b)}">
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
        ${f}
      </tbody>
    </table>
  `}function At(t,n=";"){const e=String(t??"");return e?e.includes('"')||e.includes(`
`)||e.includes(n)?`"${e.replace(/"/g,'""')}"`:e:""}function ot(t){return t==null||!Number.isFinite(Number(t))?"":Math.round(Number(t)).toLocaleString("de-DE",{maximumFractionDigits:0})}function yt(t){return t==null||!Number.isFinite(Number(t))?"":Number(t).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function Cn({state:t,view:n,snapshot:e,products:c,categories:o,asOfDate:i}){const s=_t(c,n.search),r=ee(s,o),p=_e(t,i),b=new Map;((e==null?void 0:e.items)||[]).forEach(z=>{const q=String(z.sku||"").trim();q&&b.set(q,z)});const y=[],S=[];let D=0,$=0,k=0,F=0,N=0;return r.forEach(z=>{z.items.forEach(q=>{const Q=String(q.sku||"").trim();if(!Q)return;const f=q.alias||"",g=b.get(Q)||{amazonUnits:0,threePLUnits:0},M=Number((g==null?void 0:g.amazonUnits)||0),w=Number((g==null?void 0:g.threePLUnits)||0),C=p.get(Q),P=C?C.total:0,I=Yt(q,t.settings||{}),Z=M+w+P,_=M+w,Y=Number.isFinite(I)?Z*I:null,B=Number.isFinite(I)?_*I:null;Number.isFinite(I)||S.push(f?`${Q} (${f})`:Q),Number.isFinite(M)&&(D+=M),Number.isFinite(w)&&($+=w),Number.isFinite(P)&&(k+=P),Number.isFinite(Y)&&(F+=Y),Number.isFinite(B)&&(N+=B),y.push({sku:Q,alias:f,amazonUnits:M,threePlUnits:w,inTransitUnits:P,ekEur:I,rowValue:Y,rowValueWarehouse:B})})}),{rows:y,totals:{amazonUnits:D,majamoUnits:$,inTransitUnits:k,totalUnits:D+$+k,totalValue:F,totalValueWarehouse:N},missingEk:S}}function jn({title:t,rows:n,totals:e,missingEk:c}){const o=";",i=[];t&&(i.push(At(t,o)),i.push(""));const s=["SKU","Alias","Bestand Amazon (Stk)","Bestand majamo (Stk)","In Transit (Stk)","EK-Preis (EUR / Stk)","Warenwert ohne In-Transit (EUR)","Warenwert inkl. In-Transit (EUR)"];i.push(s.map(p=>At(p,o)).join(o)),n.forEach(p=>{const b=[p.sku,p.alias,ot(p.amazonUnits),ot(p.threePlUnits),ot(p.inTransitUnits),yt(p.ekEur),yt(p.rowValueWarehouse),yt(p.rowValue)];i.push(b.map(y=>At(y,o)).join(o))});const r=["Gesamtsumme","",ot(e.amazonUnits),ot(e.majamoUnits),ot(e.inTransitUnits),"",yt(e.totalValueWarehouse),yt(e.totalValue)];return i.push(r.map(p=>At(p,o)).join(o)),i.push(""),i.push(At("Hinweis: 'Warenwert ohne In-Transit' = nur physisch im Lager (Amazon + majamo). Für BWA-Bestandsbewertung typischerweise diese Spalte verwenden, sofern In-Transit-Eigentum erst beim Eintreffen übergeht.",o)),c.length&&(i.push(""),i.push(At(`Fehlender EK-Preis für: ${c.join(", ")}`,o))),i.join(`
`)}function zn({title:t,fileName:n,rows:e,totals:c,missingEk:o,generatedAt:i}){const s=e.map(b=>`
      <tr>
        <td>${h(b.sku)}</td>
        <td>${h(b.alias||"")}</td>
        <td class="num">${ot(b.amazonUnits)}</td>
        <td class="num">${ot(b.threePlUnits)}</td>
        <td class="num">${ot(b.inTransitUnits)}</td>
        <td class="num">${yt(b.ekEur)}</td>
        <td class="num">${yt(b.rowValueWarehouse)}</td>
        <td class="num">${yt(b.rowValue)}</td>
      </tr>
  `).join(""),r=`
      <tr class="totals">
        <td>Gesamtsumme</td>
        <td></td>
        <td class="num">${ot(c.amazonUnits)}</td>
        <td class="num">${ot(c.majamoUnits)}</td>
        <td class="num">${ot(c.inTransitUnits)}</td>
        <td class="num"></td>
        <td class="num">${yt(c.totalValueWarehouse)}</td>
        <td class="num">${yt(c.totalValue)}</td>
      </tr>
  `,p=o.length?`<div class="warning">Fehlender EK-Preis für: ${h(o.join(", "))}</div>`:"";return`
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
            ${r}
          </tbody>
        </table>
        <p class="hint">Hinweis: "Warenwert ohne In-Transit" = nur physisch im Lager (Amazon + majamo). Für BWA-Bestandsbewertung typischerweise diese Spalte verwenden.</p>
        ${p}
        <script>
          window.addEventListener("load", () => {
            setTimeout(() => window.print(), 250);
          });
        <\/script>
      </body>
    </html>
  `}function On({state:t,view:n,snapshot:e,products:c,categories:o,months:i,projectionData:s=null,inboundData:r=null}){const p=_t(c,n.search),b=ee(p,o),y=new Map,S=s||Oe({state:t,months:i,products:p,snapshot:e,projectionMode:n.projectionMode}),D=S.months;p.forEach(f=>{const g=String((f==null?void 0:f.sku)||"").trim();if(!g)return;const M=new Map;D.forEach(w=>{var P;const C=(P=S.perSkuMonth.get(g))==null?void 0:P.get(w);Number.isFinite(C==null?void 0:C.forecastUnits)&&M.set(w,C.forecastUnits)}),y.set(g,M)});const $=n.projectionMode==="plan"?xn(b,y,i):new Map,k=new Map;((e==null?void 0:e.items)||[]).forEach(f=>{const g=String(f.sku||"").trim();g&&k.set(g,f)});const{inboundMap:F,missingEtaSkus:N}=r||pe(t),z=fn(t).bySku,q=b.map(f=>{const g=n.collapsed[f.id],M=f.items.map(C=>{var ct;const P=String(C.sku||"").trim(),I=C.alias||"—",Z=((ct=z==null?void 0:z.get(P.toLowerCase()))==null?void 0:ct.abcClass)||"—",_=pn(C,t),Y=yn(C,t),B=Number.isFinite(_)?K(_):"—",ft=Number.isFinite(Y)?K(Y):"—",vt=`
        <button class="inventory-drilldown-trigger" type="button" data-action="open-drilldown" data-sku="${h(P)}" data-alias="${h(I)}" title="SKU Verlauf öffnen" aria-label="SKU Verlauf öffnen">
          <span aria-hidden="true">&#128200;</span>
        </button>
      `;let lt=0;const Et=i.map(nt=>{var Vt;const St=F.get(P),j=St?St.get(nt):null;j&&j.poUnits+j.foUnits;const x=(Vt=S.perSkuMonth.get(P))==null?void 0:Vt.get(nt),O=(x==null?void 0:x.forecastUnits)??null,tt=(x==null?void 0:x.endAvailable)??null,G=(x==null?void 0:x.forecastMissing)??!0,gt=Number.isFinite(x==null?void 0:x.safetyUnits)?x.safetyUnits:null,bt=Number.isFinite(x==null?void 0:x.safetyDays)?x.safetyDays:null,J=Number.isFinite(x==null?void 0:x.daysToOos)?x.daysToOos:null,R=j!=null&&j.hasPo&&(j!=null&&j.hasFo)?"inventory-cell inbound-both":j!=null&&j.hasPo?"inventory-cell inbound-po":j!=null&&j.hasFo?"inventory-cell inbound-fo":"inventory-cell",dt=(x==null?void 0:x.doh)??null,Ut=n.projectionMode==="doh",xt=n.projectionMode==="plan",ut=Ut?Number.isFinite(dt)&&dt<=0:Number.isFinite(tt)&&tt<=0,jt=xt?Number.isFinite(O)?K(O):"—":G?"—":ut?'0 <span class="inventory-warning-icon">⚠︎</span>':Ut?dt==null?"—":K(dt):K(tt),zt=xt?"":Ve({endAvailable:tt,safetyUnits:gt,doh:dt,safetyDays:bt,daysToOos:J,projectionMode:n.projectionMode}),$t=xt?"":G?"incomplete":"",Ot=j?`
            ${j.hasPo?'<span class="inventory-inbound-marker po"></span>':""}
            ${j.hasFo?'<span class="inventory-inbound-marker fo"></span>':""}
          `:"",Dt=j?Tn({alias:I,month:nt,events:j.events}):"",se=Dt?Dt.replace(/\s+/g," ").trim():"",Nt=Dt?`inventory-inbound-${P}-${nt}-${lt++}`:"";return`
          <td class="num ${R} ${zt} ${$t} inventory-projection-cell" data-month="${h(nt)}" ${Dt?`data-tooltip-html="${ue(se)}"`:""} ${Nt?`data-tooltip-id="${Nt}"`:""}>
            <span class="inventory-cell-value">${jt}</span>
            ${Ot}
          </td>
        `}).join(""),kt=N.has(P)?'<span class="cell-warning" title="PO ohne ETA wird nicht gezählt">⚠︎</span>':"";return`
        <tr class="inventory-row ${g?"is-collapsed":""}" data-sku="${h(P)}" data-category="${h(f.id)}">
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
      `}).join(""),w=n.projectionMode==="plan"?i.map(C=>{var _;const P=ne(C),I=(_=$.get(f.id))==null?void 0:_.get(P);return`<td class="num inventory-projection-group-cell">${Number.isFinite(I)?K(I):"—"}</td>`}).join(""):`<th colspan="${i.length}"></th>`;return`
      <tr class="inventory-category-row" data-category-row="${h(f.id)}">
        <th class="inventory-col-sku sticky-cell" colspan="5">
          <button type="button" class="tree-toggle" data-category="${h(f.id)}">${g?"▸":"▾"}</button>
          <span class="tree-label">${h(f.name)}</span>
          <span class="muted">(${f.items.length})</span>
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
          ${i.map(f=>`<th class="num">${Ht(f)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${q||`<tr><td class="muted" colspan="${i.length+5}">Keine Produkte gefunden.</td></tr>`}
      </tbody>
    </table>
  `}function Vn(t,n,e,c,o){var Q;if(!t||!n||!c)return;const i=String(c.sku||"").trim(),s=he(n,i),r=(Q=e==null?void 0:e.items)==null?void 0:Q.find(f=>String(f.sku||"").trim()===i),p=Number(s.amazonUnits||0)+Number(s.threePLUnits||0),b=((r==null?void 0:r.amazonUnits)||0)+((r==null?void 0:r.threePLUnits)||0),y=p-b,S=t.querySelector(".inventory-in-transit"),D=ht((S==null?void 0:S.textContent)||0),$=p+(Number.isFinite(D)?D:0),k=Yt(c,o.settings||{}),F=Number.isFinite(k)?$*k:null,N=t.querySelector('[data-field="totalUnits"]'),z=t.querySelector('[data-field="delta"]'),q=t.querySelector('[data-field="totalValue"]');N&&(N.textContent=K(p)),z&&(z.textContent=K(y)),q&&(q.textContent=Number.isFinite(F)?W(F):"—")}function et(t){var we,Ee,ke;const n=un(),e=kn(),c=window.__routeQuery||{},o=String(c.sku||"").trim(),i=String(c.month||"").trim();o&&(e.search="",e.projectionMode="doh"),/^\d{4}-\d{2}$/.test(i)&&(e.selectedMonth=Ke(i,-1));const s=Sn(n,e);e.selectedMonth=s,rt(e),t._inventoryCleanup&&(t._inventoryCleanup(),t._inventoryCleanup=null);const r=He(n,s)||{month:s,items:[]},p=je(n,s),b=Array.isArray(n.productCategories)?n.productCategories:[],y=(n.products||[]).filter(En),S=gn(e.snapshotAsOfDate),D=S?de(S):null;let $=S&&D===s?S:bn(s);$||($=new Date),(!S||D!==s)&&(e.snapshotAsOfDate=Jt($),rt(e));const k=me($);if(o){const a=y.find(u=>String((u==null?void 0:u.sku)||"").trim()===o);(a==null?void 0:a.categoryId)!=null&&(e.collapsed[String(a.categoryId)]=!1,rt(e))}const F=Number(((Ee=(we=n.inventory)==null?void 0:we.settings)==null?void 0:Ee.projectionMonths)||12),N=[6,12,18],z=vn(s,N.includes(F)?F:12),q=_t(y,e.search),Q=Oe({state:n,months:z,products:q,snapshot:r,projectionMode:e.projectionMode}),f=pe(n),g=e.projectionMode==="plan",M=Cn({state:n,view:e,snapshot:r,products:y,categories:b,asOfDate:k}),w=M.missingEk.length,C=Nn({state:n,currentSnapshot:r,previousSnapshot:p,products:y,categories:b,currentMonth:s,asOfDate:k}),P=Fn(n,k),I=p?An({reconciliation:C,stalePos:P,currentMonth:s,previousMonth:p.month}):'<div class="reco-panel reco-status-empty"><div class="muted small">Plausi-Check verfügbar sobald ein Vormonats-Snapshot existiert.</div></div>';t.innerHTML=`
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
        <span class="muted small">${p?`Vorheriger Snapshot: ${Ht(p.month)}`:"Kein vorheriger Snapshot vorhanden."}</span>
      </div>
      <div class="inventory-export">
        <div class="inventory-export-controls">
          <label class="inventory-field">
            <span class="muted">Bestandsaufnahme zum</span>
            <input type="date" id="inventory-export-date" value="${h(Jt($))}" />
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
          ${Ln({state:n,view:e,snapshot:r,previousSnapshot:p,products:y,categories:b,asOfDate:k,snapshotMonth:s})}
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
          ${On({state:n,view:e,snapshot:r,products:y,categories:b,months:z,projectionData:Q,inboundData:f})}
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
  `;const Z=t.querySelector("#inventory-month");if(Z){const a=(((ke=n.inventory)==null?void 0:ke.snapshots)||[]).map(l=>l==null?void 0:l.month).filter(l=>/^\d{4}-\d{2}$/.test(l)),u=new Set([...a,Be(),s]),m=Array.from(u).sort();Z.innerHTML=m.map(l=>`<option value="${l}" ${l===s?"selected":""}>${Ht(l)}</option>`).join(""),Z.addEventListener("change",l=>{e.selectedMonth=l.target.value,rt(e),et(t)})}const _=t.querySelector("#inventory-export-date");_&&_.addEventListener("change",a=>{e.snapshotAsOfDate=a.target.value,rt(e),et(t)});const Y=t.querySelector("#inventory-export-csv");Y&&Y.addEventListener("click",()=>{if(!M.rows.length){window.alert("Keine Daten für den Export vorhanden.");return}const a=Ae($),u=jn({title:a,rows:M.rows,totals:M.totals,missingEk:M.missingEk}),m=`bestandsaufnahme_${Jt($)}.csv`,l=new Blob([u],{type:"text/csv"}),d=URL.createObjectURL(l),E=document.createElement("a");E.href=d,E.download=m,document.body.append(E),E.click(),E.remove(),URL.revokeObjectURL(d)});const B=t.querySelector("#inventory-export-pdf");B&&B.addEventListener("click",()=>{if(!M.rows.length){window.alert("Keine Daten für den Export vorhanden.");return}const a=Ae($),u=$n(new Date),m=`bestandsaufnahme_${Jt($)}.pdf`,l=zn({title:a,fileName:m,rows:M.rows,totals:M.totals,missingEk:M.missingEk,generatedAt:u}),d=window.open("","_blank","noopener,noreferrer");d&&(d.document.open(),d.document.write(l),d.document.close())});const ft=t.querySelector(".inventory-search input");ft&&ft.addEventListener("input",a=>{e.search=a.target.value||"",rt(e),et(t)});const vt=t.querySelector("#inventory-copy");vt&&vt.addEventListener("click",()=>{const a=Ce(n,s),u=je(n,s);a.items=(y||[]).map(m=>{var E;const l=String(m.sku||"").trim(),d=(E=u==null?void 0:u.items)==null?void 0:E.find(T=>String(T.sku||"").trim()===l);return{sku:l,amazonUnits:(d==null?void 0:d.amazonUnits)??0,threePLUnits:(d==null?void 0:d.threePLUnits)??0,note:(d==null?void 0:d.note)??""}}),Zt(n),et(t)});const lt=t.querySelector("#inventory-expand-all");lt&&lt.addEventListener("click",()=>{Le({products:y,categories:b,view:e,collapsed:!1}),et(t)});const Et=t.querySelector("#inventory-collapse-all");Et&&Et.addEventListener("click",()=>{Le({products:y,categories:b,view:e,collapsed:!0}),et(t)}),t.querySelectorAll("input[name='snapshot-view-mode']").forEach(a=>{a.addEventListener("change",u=>{const m=u.target.value==="eur"?"eur":"units";e.snapshotViewMode!==m&&(e.snapshotViewMode=m,rt(e),et(t))})});const kt=a=>{if(!a.length)return;const u=new Set(a.map(String));let m=0;(n.pos||[]).forEach(l=>{const d=String((l==null?void 0:l.id)||(l==null?void 0:l.poNo)||"");d&&u.has(d)&&!l.archived&&(l.archived=!0,m+=1)}),m&&(Zt(n),et(t))},ct=t.querySelector("#reco-archive-all");ct&&ct.addEventListener("click",()=>{const a=P.map(u=>u.id).filter(Boolean);a.length&&window.confirm(`${a.length} alte PO${a.length===1?"":"s"} archivieren? Sie zählen danach nicht mehr als In-Transit.`)&&kt(a)}),t.querySelectorAll(".reco-archive-one").forEach(a=>{a.addEventListener("click",u=>{const m=u.currentTarget.getAttribute("data-po-id");m&&kt([m])})});const nt=t.querySelector(".inventory-snapshot-table");let St=null;const j=()=>{St&&clearTimeout(St),St=setTimeout(()=>{const a=Ce(n,s);a!==r&&(a.items=r.items),Zt(n)},250)};if(nt){const a=m=>{const l=m.closest("tr[data-sku]");if(!l)return null;const d=l.getAttribute("data-sku"),E=y.find(L=>String(L.sku||"").trim()===d);if(!E)return null;const T=he(r,d),A=m.dataset.field;return{row:l,sku:d,product:E,item:T,field:A}},u=m=>{var at;const l=a(m);if(!l)return;const{row:d,sku:E,product:T,item:A,field:L}=l;if(L!=="amazonUnits"&&L!=="threePLUnits")return;const st=te(s,E,L),H=qt.get(st)??m.value,{value:it,isRounded:pt}=wn(H);qt.delete(st),m.value=String(it),(at=m.closest("td"))==null||at.classList.toggle("inventory-input-warn",pt),L==="amazonUnits"&&(A.amazonUnits=it),L==="threePLUnits"&&(A.threePLUnits=it),Vn(d,r,p,T,n),j()};nt.addEventListener("click",m=>{const l=m.target.closest("button.tree-toggle[data-category]");if(!l)return;const d=l.getAttribute("data-category");e.collapsed[d]=!e.collapsed[d],rt(e),et(t)}),nt.addEventListener("input",m=>{var L;const l=m.target.closest("input.inventory-input");if(!l)return;const d=a(l);if(!d)return;const{sku:E,item:T,field:A}=d;if(A==="note"){T.note=l.value,j();return}if(A==="amazonUnits"||A==="threePLUnits"){const st=te(s,E,A);qt.set(st,l.value),(L=l.closest("td"))==null||L.classList.remove("inventory-input-warn")}}),nt.addEventListener("blur",m=>{const l=m.target.closest("input.inventory-input");if(!l)return;const d=a(l);d&&d.field!=="note"&&u(l)},!0),nt.addEventListener("keydown",m=>{if(m.key!=="Enter")return;const l=m.target.closest("input.inventory-input");if(!l)return;const d=a(l);!d||d.field==="note"||(m.preventDefault(),u(l))})}const x=t.querySelector(".inventory-projection-table");x&&(x.addEventListener("click",a=>{const u=a.target.closest("button.tree-toggle[data-category]");if(!u)return;const m=u.getAttribute("data-category");e.collapsed[m]=!e.collapsed[m],rt(e),et(t)}),x.addEventListener("click",a=>{const u=a.target.closest("button.inventory-drilldown-trigger[data-action='open-drilldown']");if(u){const A=String(u.getAttribute("data-sku")||"").trim(),L=String(u.getAttribute("data-alias")||A).trim();if(!A)return;a.preventDefault(),a.stopPropagation(),Ye({sku:A,alias:L});return}if(a.target.closest("button.tree-toggle[data-category]"))return;const l=a.target.closest("td.inventory-projection-cell");if(!l)return;const d=l.closest("tr[data-sku]");if(!d)return;const E=d.getAttribute("data-sku"),T=l.getAttribute("data-month");!E||!T||(a.stopPropagation(),zt(l,{sku:E,month:T}))}));const O=t.querySelector("#inventory-tooltip-layer");let tt=null,G=null,gt=null,bt=null,J="units",R=null;function dt(a){if(!O||O.hidden)return;const u=12,m=window.innerWidth-O.offsetWidth-8,l=window.innerHeight-O.offsetHeight-8,d=Math.min(a.clientX+u,m),E=Math.min(a.clientY+u,l);O.style.left=`${Math.max(8,d)}px`,O.style.top=`${Math.max(8,E)}px`}function Ut(a,u,m){if(!O||!u)return;let l=u;try{l=decodeURIComponent(u)}catch{l=u}O.innerHTML=l,O.hidden=!1,O.classList.add("is-visible"),tt=a,dt(m)}function xt(){O&&(O.hidden=!0,O.classList.remove("is-visible"),O.innerHTML="",tt=null)}function ut(){G&&G.remove(),G=null,gt=null}function jt(a){if(!G||!a)return;const u=a.getBoundingClientRect(),m=8,l=window.innerWidth-G.offsetWidth-m,d=window.innerHeight-G.offsetHeight-m,E=Math.min(u.left,l),T=Math.min(u.bottom+6,d);G.style.left=`${Math.max(m,E)}px`,G.style.top=`${Math.max(m,T)}px`}function zt(a,{sku:u,month:m}){var it;if(!a||!u||!m)return;if(gt===a&&G){ut();return}ut();const l=((it=n.settings)==null?void 0:it.monthAnchorDay)||"START",d=Mn(m,l),E=Un(d),T=Ct(d),A=ce(m),L=Re(n,u,m),st=Number.isFinite(L)?`<div class="inventory-cell-popover-meta">Plan-Absatz in diesem Monat: ${K(L)}</div>`:"",H=document.createElement("div");H.className="inventory-cell-popover",H.innerHTML=`
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
    `,H.addEventListener("click",pt=>{const at=pt.target.closest("button[data-action]");if(!at)return;const Mt=at.dataset.action,X=new URLSearchParams;X.set("create","1"),X.set("sku",u),X.set("anchorMonth",m),X.set("anchorDate",E),Mt==="fo"?(X.set("target",E),location.hash=`#fo?${X.toString()}`):Mt==="po"?(X.set("orderDate",E),X.set("anchorMode","order"),location.hash=`#po?${X.toString()}`):Mt==="po-arrival"&&(X.set("anchorMode","arrival"),location.hash=`#po?${X.toString()}`),ut()}),document.body.appendChild(H),G=H,gt=a,jt(a)}function $t(){R&&(clearTimeout(R),R=null),bt&&(bt.remove(),bt=null,J="units")}function Ot(a){const u=Q.perSkuMonth.get(a)||new Map,m=f.inboundMap.get(a)||new Map;return z.map(l=>{const d=u.get(l)||null,E=m.get(l)||null;return{month:l,endAvailable:Number.isFinite(d==null?void 0:d.endAvailable)?Number(d.endAvailable):null,doh:Number.isFinite(d==null?void 0:d.doh)?Number(d.doh):null,safetyUnits:Number.isFinite(d==null?void 0:d.safetyUnits)?Number(d.safetyUnits):null,safetyDays:Number.isFinite(d==null?void 0:d.safetyDays)?Number(d.safetyDays):null,daysToOos:Number.isFinite(d==null?void 0:d.daysToOos)?Number(d.daysToOos):null,forecastUnits:Number.isFinite(d==null?void 0:d.forecastUnits)?Number(d.forecastUnits):null,events:Array.isArray(E==null?void 0:E.events)?E.events:[]}})}function Dt({alias:a,monthData:u}){const m=J==="doh"?"Bestand Monatsende (DOH)":"Bestand Monatsende (DE verfügbar)",l=J==="doh"?Number.isFinite(u.doh)?`${K(u.doh)} DOH`:"—":Number.isFinite(u.endAvailable)?`${K(u.endAvailable)} Units`:"—",d=Number.isFinite(u.forecastUnits)?`${K(u.forecastUnits)} Units`:"—",E=u.events.length?u.events.map(T=>{const A=T.open?`<button class="btn sm secondary inventory-link" type="button" data-route="${h(T.route||"")}" data-open="${h(T.open||"")}">Open ${h(T.type||"")}</button>`:"";return`
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
        <div>${m}: <strong>${l}</strong></div>
        <div>Plan-Absatz: <strong>${d}</strong></div>
      </div>
      <div class="inventory-drilldown-tooltip-arrivals">${E}</div>
    `}function se(a,u){if(!a||!u)return;const m=14,l=window.innerWidth-a.offsetWidth-12,d=window.innerHeight-a.offsetHeight-12,E=le(u.clientX+m,8,Math.max(8,l)),T=le(u.clientY+m,8,Math.max(8,d));a.style.left=`${E}px`,a.style.top=`${T}px`}function Nt(a){a&&(a.hidden=!0,a.innerHTML="")}function Vt(a,{sku:u,alias:m}){var De;const l=a==null?void 0:a.querySelector("[data-drilldown-chart]"),d=a==null?void 0:a.querySelector(".inventory-drilldown-tooltip");if(!l||!d)return;R&&(clearTimeout(R),R=null),Nt(d);const E=Ot(u).map(v=>{const U=e.showSafety?Ve({endAvailable:v.endAvailable,safetyUnits:v.safetyUnits,doh:v.doh,safetyDays:v.safetyDays,daysToOos:v.daysToOos,projectionMode:J==="doh"?"doh":"units"}):"";return{...v,riskClass:U}});if(!E.length){l.innerHTML='<div class="muted">Keine Projektion vorhanden.</div>';return}const T=E.length,A=72,L=56,st=20,H=18,it=210,pt=H+it+36,at=86,Mt=pt+at,X=L+st+T*A,Xe=Mt+34,ie=E.map(v=>J==="doh"?v.doh:v.endAvailable),Qe=E.map(v=>J==="doh"?v.safetyDays:v.safetyUnits),It=ie.filter(v=>Number.isFinite(v));e.showSafety&&Qe.forEach(v=>{Number.isFinite(v)&&It.push(v)});let Ft=It.length?Math.min(...It):0,Tt=It.length?Math.max(...It):1;Ft=Math.min(Ft,0),Tt<=Ft&&(Tt=Ft+1);const Ze=Math.max(1,...E.map(v=>Number.isFinite(v.forecastUnits)?v.forecastUnits:0)),Bt=v=>L+v*A+A/2,Kt=v=>H+(Tt-v)/(Tt-Ft)*it,Je=v=>{const U=Number.isFinite(v)?Math.max(0,v):0;return pt+at-U/Ze*at},Se=4,tn=Array.from({length:Se+1},(v,U)=>{const V=U/Se,mt=Tt-(Tt-Ft)*V;return{value:mt,y:Kt(mt)}}),Xt=[];let Pt=[];ie.forEach((v,U)=>{if(!Number.isFinite(v)){Pt.length&&Xt.push(Pt),Pt=[];return}Pt.push({x:Bt(U),y:Kt(v),index:U})}),Pt.length&&Xt.push(Pt);const xe=Math.max(12,Math.round(A*.42)),en=E.map((v,U)=>{if(!e.showSafety||!v.riskClass)return"";const V=v.riskClass==="safety-negative"?"inventory-drilldown-band-negative":"inventory-drilldown-band-low",mt=L+U*A;return`<rect class="${V}" x="${mt}" y="${H}" width="${A}" height="${Mt-H+1}"></rect>`}).join(""),nn=tn.map(v=>`
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
        `}}else if(e.showSafety){const v=[];let U=[];E.forEach((V,mt)=>{if(!Number.isFinite(V.safetyUnits)){U.length&&v.push(U),U=[];return}U.push(`${Bt(mt).toFixed(2)},${Kt(V.safetyUnits).toFixed(2)}`)}),U.length&&v.push(U),ae=v.map(V=>`<polyline class="inventory-drilldown-safety-line" points="${V.join(" ")}"></polyline>`).join("")}l.innerHTML=`
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
    `;const Me=()=>{R&&clearTimeout(R),R=setTimeout(()=>{d.matches(":hover")||Nt(d)},120)},Ue=(v,U)=>{R&&(clearTimeout(R),R=null);const V=E[U];V&&(d.innerHTML=Dt({alias:m,monthData:V}),d.hidden=!1,se(d,v))};l.querySelectorAll(".inventory-drilldown-hit").forEach(v=>{const U=Number(v.getAttribute("data-index"));v.onmouseenter=V=>Ue(V,U),v.onmousemove=V=>Ue(V,U),v.onmouseleave=()=>Me()}),l.onmouseleave=()=>Me(),d.onmouseenter=()=>{R&&(clearTimeout(R),R=null)},d.onmouseleave=()=>Nt(d)}function Ye({sku:a,alias:u}){if(!a)return;$t(),J="units";const m=u||a,l=document.createElement("div");l.className="po-modal-backdrop inventory-drilldown-backdrop",l.setAttribute("role","dialog"),l.setAttribute("aria-modal","true"),l.innerHTML=`
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
    `,l.addEventListener("click",d=>{if(d.target===l||d.target.closest("[data-drilldown-close]")){$t();return}const E=d.target.closest(".inventory-link");if(!E)return;const T=E.getAttribute("data-route"),A=E.getAttribute("data-open");if(!T||!A)return;const L=new URLSearchParams;L.set("open",A),location.hash=`${T}?${L.toString()}`,$t()}),l.addEventListener("change",d=>{const E=d.target.closest("input[name='inventory-drilldown-mode']");E&&(J=E.value==="doh"?"doh":"units",Vt(l,{sku:a,alias:m}))}),document.body.appendChild(l),bt=l,Vt(l,{sku:a,alias:m})}t.addEventListener("mouseover",a=>{const u=a.target.closest("[data-tooltip-html]");if(!u||u===tt)return;const m=u.getAttribute("data-tooltip-html");m&&Ut(u,m,a)}),t.addEventListener("mousemove",a=>{tt&&dt(a)}),t.addEventListener("mouseout",a=>{if(!tt||a.relatedTarget&&O&&O.contains(a.relatedTarget))return;const u=a.target.closest("[data-tooltip-html]");u&&u===tt&&xt()}),O&&O.addEventListener("mouseleave",()=>{xt()});const ye=a=>{if(!G||G.contains(a.target))return;const u=a.target.closest("td.inventory-projection-cell");u&&gt===u||ut()},ve=a=>{a.key==="Escape"&&(ut(),$t())};document.addEventListener("click",ye),document.addEventListener("keydown",ve);const Gt=t.querySelector(".inventory-table-scroll"),ge=()=>ut();Gt&&Gt.addEventListener("scroll",ge),t.addEventListener("click",a=>{const u=a.target.closest(".inventory-link");if(!u)return;const m=u.getAttribute("data-route"),l=u.getAttribute("data-open");if(!m||!l)return;const d=new URLSearchParams;d.set("open",l),location.hash=`${m}?${d.toString()}`});const be=t.querySelector("#inventory-horizon");be&&be.addEventListener("change",a=>{const u=Number(a.target.value||12);n.inventory||(n.inventory={snapshots:[],settings:{}}),n.inventory.settings||(n.inventory.settings={}),n.inventory.settings.projectionMonths=u,Zt(n),et(t)});const $e=t.querySelector("#inventory-safety");$e&&$e.addEventListener("change",a=>{e.showSafety=a.target.checked,rt(e),et(t)}),t.querySelectorAll("input[name='inventory-mode']").forEach(a=>{a.addEventListener("change",u=>{const m=u.target.value;e.projectionMode=m==="doh"||m==="plan"?m:"units",rt(e),et(t)})});function Ge(){if(!o)return;const a=Pe(o),u=/^\d{4}-\d{2}$/.test(i)?`[data-month="${Pe(i)}"]`:"[data-month]",m=t.querySelector(`.inventory-projection-table tr[data-sku="${a}"] td${u}`),l=m?m.closest("tr[data-sku]"):t.querySelector(`.inventory-projection-table tr[data-sku="${a}"]`);l&&l.classList.add("row-focus"),m?(m.classList.add("cell-focus"),m.scrollIntoView({behavior:"smooth",block:"center",inline:"center"})):l&&l.scrollIntoView({behavior:"smooth",block:"center"}),window.__routeQuery={}}Ge(),t._inventoryCleanup=()=>{document.removeEventListener("click",ye),document.removeEventListener("keydown",ve),Gt&&Gt.removeEventListener("scroll",ge),ut(),$t()}}const qn={render:et};export{qn as default,et as render};
