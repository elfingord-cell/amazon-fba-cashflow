import{l as ee,c as nn,a as se,b as ie}from"./store-CXiTZ7hZ.js";import{p as rt}from"./index-Dsq1NbgA.js";import{b as oe}from"./abcClassification-DMTDJ3gR.js";import{c as Dn,r as re,a as ae,g as En}from"./inventoryProjection-BWCMGWlk.js";const Fn="inventory_view_v1";function h(t){return String(t??"").replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e])}function kn(t){return typeof CSS<"u"&&typeof CSS.escape=="function"?CSS.escape(t):String(t).replace(/["\\]/g,"\\$&")}function Ln(){const t=new Date;return`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}`}function Ft(t){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[e,n]=t.split("-").map(Number);return e*12+(n-1)}function An(t,e){const[n,c]=t.split("-").map(Number),m=n*12+(c-1)+e,i=Math.floor(m/12),s=m%12+1;return`${i}-${String(s).padStart(2,"0")}`}function le(t,e){return Array.from({length:e},(n,c)=>An(t,c+1))}function At(t){if(!t)return"—";const[e,n]=t.split("-");return`${n}-${e}`}function ce(t){if(!t)return"—";const[e,n]=t.split("-");return`${n}/${e}`}function Rt(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return"";const e=t.getFullYear(),n=String(t.getMonth()+1).padStart(2,"0"),c=String(t.getDate()).padStart(2,"0");return`${e}-${n}-${c}`}function de(t){if(!t)return null;const e=new Date(`${t}T00:00:00`);return Number.isNaN(e.getTime())?null:e}function ue(t){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[e,n]=t.split("-").map(Number);return new Date(e,n,0)}function Tn(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return null;const e=new Date(t.getTime());return e.setHours(23,59,59,999),e}function xn(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"Bestandsaufnahme":`Bestandsaufnahme zum ${Tt(t)}`}function me(t){if(!(t instanceof Date)||Number.isNaN(t.getTime()))return"—";const e=t.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}),n=t.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});return`${e} ${n}`}function fe(t){if(t==null||t==="")return{value:0,isRounded:!1};const e=rt(String(t));if(!Number.isFinite(e))return{value:0,isRounded:!1};const n=Math.round(e);return{value:n,isRounded:n!==e}}function he(t,e,n){var y,p,g,$,D,w,O;const c=rn(n);if(!c)return null;const m=(g=(p=(y=t==null?void 0:t.forecast)==null?void 0:y.forecastManual)==null?void 0:p[e])==null?void 0:g[c],i=rt(m);if(Number.isFinite(i))return i;const s=(O=(w=(D=($=t==null?void 0:t.forecast)==null?void 0:$.forecastImport)==null?void 0:D[e])==null?void 0:w[c])==null?void 0:O.units,l=rt(s);return Number.isFinite(l)?l:null}function V(t){return t==null||!Number.isFinite(Number(t))?"—":Math.round(Number(t)).toLocaleString("de-DE",{maximumFractionDigits:0})}function en(t,e,n){return Math.min(n,Math.max(e,t))}function jt(t,e){const n=String(e||"").trim().toLowerCase();return n?t.filter(c=>String(c.alias||"").toLowerCase().includes(n)||String(c.sku||"").toLowerCase().includes(n)):t}function ye(t){if(!t)return!1;if(typeof t.active=="boolean")return t.active;const e=String(t.status||"").trim().toLowerCase();return e?e==="active"||e==="aktiv":!0}function Wt(t,e=[]){const n=new Map;t.forEach(s=>{const l=s.categoryId?String(s.categoryId):"";n.has(l)||n.set(l,[]),n.get(l).push(s)});const m=e.slice().sort((s,l)=>{const y=Number.isFinite(s.sortOrder)?s.sortOrder:0,p=Number.isFinite(l.sortOrder)?l.sortOrder:0;return y-p||String(s.name||"").localeCompare(String(l.name||""))}).map(s=>({id:String(s.id),name:s.name||"Ohne Kategorie",items:n.get(String(s.id))||[]})),i=n.get("")||[];return i.length&&m.push({id:"uncategorized",name:"Ohne Kategorie",items:i}),m.filter(s=>s.items.length)}function pe(){const t=se(Fn,{}),e=t.projectionMode==="doh"||t.projectionMode==="plan"?t.projectionMode:"units";return{selectedMonth:t.selectedMonth||null,collapsed:t.collapsed&&typeof t.collapsed=="object"?t.collapsed:{},search:t.search||"",showSafety:t.showSafety!==!1,projectionMode:e,snapshotAsOfDate:t.snapshotAsOfDate||""}}function it(t){ie(Fn,t)}function ve(t,e){var s;const n=(((s=t.inventory)==null?void 0:s.snapshots)||[]).map(l=>l==null?void 0:l.month).filter(l=>/^\d{4}-\d{2}$/.test(l)).sort(),c=n[n.length-1],m=Ln(),i=e.selectedMonth||c||m;return i||m}function Un({products:t,categories:e,view:n,collapsed:c}){const m=jt(t,n.search),i=Wt(m,e),s={...n.collapsed};i.forEach(l=>{s[l.id]=c}),n.collapsed=s,it(n)}function rn(t){if(!t)return null;const e=String(t);if(/^\d{4}-\d{2}$/.test(e))return e;const n=e.match(/^(\d{2})-(\d{4})$/);return n?`${n[2]}-${n[1]}`:e}function Pn(t,e){var n;return(((n=t.inventory)==null?void 0:n.snapshots)||[]).find(c=>(c==null?void 0:c.month)===e)||null}function Mn(t,e){const n=Pn(t,e);if(n)return n;const c={month:e,items:[]};return t.inventory||(t.inventory={snapshots:[],settings:{}}),Array.isArray(t.inventory.snapshots)||(t.inventory.snapshots=[]),t.inventory.snapshots.push(c),c}function an(t,e){if(!t||!e)return null;Array.isArray(t.items)||(t.items=[]);let n=t.items.find(c=>String(c.sku||"").trim()===e);return n||(n={sku:e,amazonUnits:0,threePLUnits:0,note:""},t.items.push(n)),n}function Nn(t,e){var i;const n=Ft(e);if(n==null)return null;const c=(((i=t.inventory)==null?void 0:i.snapshots)||[]).filter(s=>(s==null?void 0:s.month)&&Ft(s.month)!=null).slice().sort((s,l)=>Ft(s.month)-Ft(l.month));let m=null;return c.forEach(s=>{const l=Ft(s.month);l!=null&&l<n&&(m=s)}),m}function Kt(t,e){if(!e)return"—";const c=(Array.isArray(t.suppliers)?t.suppliers:[]).find(m=>String(m.id||"")===String(e));return(c==null?void 0:c.name)||e||"—"}function wt(t){if(!t)return null;const e=new Date(t);return Number.isNaN(e.getTime())?null:e}function sn(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?null:`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}`}function jn(t){const e=wt((t==null?void 0:t.etaManual)||(t==null?void 0:t.etaDate)||(t==null?void 0:t.eta));if(e)return e;const n=wt(t==null?void 0:t.etaComputed);if(n)return n;const c=wt(t==null?void 0:t.orderDate);if(!c)return null;const m=Number((t==null?void 0:t.prodDays)||0),i=Number((t==null?void 0:t.transitDays)||0),s=new Date(c.getTime());return s.setDate(s.getDate()+Math.max(0,m+i)),s}function Cn(t){return wt((t==null?void 0:t.targetDeliveryDate)||(t==null?void 0:t.deliveryDate)||(t==null?void 0:t.etaDate))}function On(t){const e=String((t==null?void 0:t.status)||"").toUpperCase();return!(e==="CONVERTED"||e==="CANCELLED")}function ge(t,e,n){const c=n.map(i=>rn(i)).filter(Boolean),m=new Map;return t.forEach(i=>{const s=new Map;c.forEach(l=>{let y=0,p=!1;i.items.forEach(g=>{var w;const $=String((g==null?void 0:g.sku)||"").trim();if(!$)return;const D=(w=e.get($))==null?void 0:w.get(l);Number.isFinite(D)&&(y+=D,p=!0)}),p&&s.set(l,y)}),m.set(i.id,s)}),m}function ln(t,e){var i;const n=((i=t==null?void 0:t.template)==null?void 0:i.fields)||(t==null?void 0:t.template)||{},c=rt(n.unitPriceUsd??(t==null?void 0:t.unitPriceUsd)??null);if(!Number.isFinite(c))return null;const m=String(n.currency||(e==null?void 0:e.defaultCurrency)||"EUR").toUpperCase();if(m==="EUR")return c;if(m==="USD"){const s=rt(e==null?void 0:e.fxRate);return!Number.isFinite(s)||s<=0?null:c/s}return null}function on(t){return t==null||!Number.isFinite(Number(t))?"—":Number(t).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function Tt(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"—":t.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"})}function be(t,e){if(!/^\d{4}-\d{2}$/.test(t||""))return null;const[n,c]=t.split("-").map(Number);if(!Number.isFinite(n)||!Number.isFinite(c))return null;const m=String(e).toUpperCase();let i=1;return m==="MID"&&(i=15),m==="END"&&(i=new Date(n,c,0).getDate()),new Date(Date.UTC(n,c-1,i))}function $e(t){return!(t instanceof Date)||Number.isNaN(t.getTime())?"—":t.toISOString().slice(0,10)}function we(t){const e=wt((t==null?void 0:t.etdManual)||(t==null?void 0:t.etdDate));if(e)return e;const n=wt(t==null?void 0:t.orderDate);if(!n)return null;const c=Number((t==null?void 0:t.prodDays)||0),m=new Date(n.getTime());return m.setDate(m.getDate()+Math.max(0,c)),m}function zn(t){const e=new Map,n=new Set;function c(i,s){e.has(i)||e.set(i,new Map);const l=e.get(i);return l.has(s)||l.set(s,{events:[],hasPo:!1,hasFo:!1,poUnits:0,foUnits:0}),l.get(s)}function m(i,s,l){const y=c(i,s),p=y.events.find(g=>g.type===l.type&&g.id===l.id);p?p.qty+=l.qty:y.events.push({...l}),l.type==="PO"&&(y.hasPo=!0,y.poUnits+=l.qty),l.type==="FO"&&(y.hasFo=!0,y.foUnits+=l.qty)}return(t.pos||[]).forEach(i=>{if(!i||i.archived)return;const s=Array.isArray(i.items)&&i.items.length?i.items:[{sku:i.sku,units:i.units}],l=jn(i),y=l?sn(l):null;s.forEach(p=>{const g=String((p==null?void 0:p.sku)||"").trim();if(!g)return;const $=rt((p==null?void 0:p.units)??0),D=Number.isFinite($)?Math.round($):0;if(!y){n.add(g);return}m(g,y,{type:"PO",id:String(i.id||i.poNo||g),label:i.poNo||i.id||"PO",supplier:Kt(t,i.supplierId||i.supplier),qty:D,date:l?l.toISOString().slice(0,10):"—",route:"#po",open:i.id||i.poNo||""})})}),(t.fos||[]).forEach(i=>{if(!i||!On(i))return;const s=Array.isArray(i.items)&&i.items.length?i.items:[{sku:i.sku,units:i.units}],l=Cn(i),y=l?sn(l):null;y&&s.forEach(p=>{const g=String((p==null?void 0:p.sku)||"").trim();if(!g)return;const $=rt((p==null?void 0:p.units)??0),D=Number.isFinite($)?Math.round($):0;m(g,y,{type:"FO",id:String(i.id||i.foNo||g),label:i.foNo||i.id||"FO",supplier:Kt(t,i.supplierId||i.supplier),qty:D,date:l?l.toISOString().slice(0,10):"—",route:"#fo",open:i.id||i.foNo||""})})}),{inboundMap:e,missingEtaSkus:n}}function In(t,e){const n=new Map,c=new Date,m=Tn(e)||c,i=(s,l)=>{n.has(s)||n.set(s,{total:0,entries:[]});const y=n.get(s);y.total+=l.qty,y.entries.push(l)};return(t.pos||[]).forEach(s=>{if(!s||s.archived||String(s.status||"").toUpperCase()==="CANCELLED")return;const l=jn(s);if(l&&l<=m)return;const y=we(s);(Array.isArray(s.items)&&s.items.length?s.items:[{sku:s.sku,units:s.units}]).forEach(g=>{const $=String((g==null?void 0:g.sku)||"").trim();if(!$)return;const D=rt((g==null?void 0:g.units)??0),w=Number.isFinite(D)?Math.round(D):0;w&&i($,{type:"PO",id:String(s.id||s.poNo||$),label:s.poNo||s.id||"PO",supplier:Kt(t,s.supplierId||s.supplier),qty:w,etd:y?Tt(y):"—",eta:l?Tt(l):"—",route:"#po",open:s.id||s.poNo||""})})}),(t.fos||[]).forEach(s=>{if(!s||!On(s))return;const l=Cn(s);if(l&&l<=m)return;(Array.isArray(s.items)&&s.items.length?s.items:[{sku:s.sku,units:s.units}]).forEach(p=>{const g=String((p==null?void 0:p.sku)||"").trim();if(!g)return;const $=rt((p==null?void 0:p.units)??0),D=Number.isFinite($)?Math.round($):0;D&&i(g,{type:"FO",id:String(s.id||s.foNo||g),label:s.foNo||s.id||"FO",supplier:Kt(t,s.supplierId||s.supplier),qty:D,etd:"—",eta:l?Tt(l):"—",route:"#fo",open:s.id||s.foNo||""})})}),n}function Se({alias:t,month:e,events:n}){if(!n||!n.length)return"";const c=n.map(m=>`
    <div class="inventory-tooltip-row">
      <div>
        <strong>${h(m.type)} ${h(m.label)}</strong>
        <div class="muted">${h(m.supplier||"—")}</div>
      </div>
      <div class="inventory-tooltip-meta">
        <div>${V(m.qty)}</div>
        <div class="muted">${h(m.date||"—")}</div>
      </div>
    </div>
    <div class="inventory-tooltip-actions">
      <button class="btn sm secondary inventory-link" type="button" data-route="${m.route}" data-open="${h(m.open)}">${m.type==="FO"?"Open FO":"Open PO"}</button>
    </div>
  `).join("");return`
    <div class="inventory-tooltip">
      <div class="inventory-tooltip-header">
        <div class="inventory-tooltip-title">Inbound arrivals in ${At(e)}</div>
        <div class="inventory-tooltip-alias">${h(t)}</div>
      </div>
      <div class="inventory-tooltip-body">${c}</div>
    </div>
  `}function ke({alias:t,entries:e}){if(!e||!e.length)return"";const n=e.map(c=>`
    <div class="inventory-tooltip-row">
      <div>
        <strong>${h(c.type)} ${h(c.label)}</strong>
        <div class="muted">${h(c.supplier||"—")}</div>
      </div>
      <div class="inventory-tooltip-meta">
        <div>${V(c.qty)}</div>
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
      <div class="inventory-tooltip-body">${n}</div>
    </div>
  `}function Vn(t){return encodeURIComponent(t||"")}const Pt=new Map;function Bt(t,e,n){return`${t||"unknown"}:${e}:${n}`}function xe({state:t,view:e,snapshot:n,previousSnapshot:c,products:m,categories:i,asOfDate:s,snapshotMonth:l}){const y=jt(m,e.search),p=Wt(y,i),g=new Map;((c==null?void 0:c.items)||[]).forEach(w=>{const O=String(w.sku||"").trim();O&&g.set(O,w)});const $=In(t,s);return`
    <table class="table-compact ui-table-standard inventory-table inventory-snapshot-table" data-ui-table="true" data-sticky-cols="2" data-sticky-owner="manual">
      <thead>
        <tr>
          <th class="inventory-col-sku sticky-header">SKU</th>
          <th class="inventory-col-alias sticky-header">Alias</th>
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
        ${p.map(w=>{const O=e.collapsed[w.id],K=w.items.map(H=>{const M=String(H.sku||"").trim(),N=an(n,M),R=$.get(M),k=R?R.total:0,T=g.get(M),j=Number((N==null?void 0:N.amazonUnits)||0),X=Number((N==null?void 0:N.threePLUnits)||0),A=j+X,P=A+k,_=((T==null?void 0:T.amazonUnits)||0)+((T==null?void 0:T.threePLUnits)||0),et=A-_,W=ln(H,t.settings||{}),dt=Number.isFinite(W)?P*W:null,yt=!Number.isFinite(W),pt=R&&R.entries.length?ke({alias:H.alias||M,entries:R.entries}):"",at=Pt.get(Bt(l,M,"amazonUnits")),mt=Pt.get(Bt(l,M,"threePLUnits"));return`
        <tr class="inventory-row ${O?"is-collapsed":""}" data-sku="${h(M)}" data-category="${h(w.id)}">
          <td class="inventory-col-sku sticky-cell">${h(M)}</td>
          <td class="inventory-col-alias sticky-cell">${h(H.alias||"—")}</td>
          <td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="amazonUnits" value="${h(at??String((N==null?void 0:N.amazonUnits)??0))}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>
          <td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="threePLUnits" value="${h(mt??String((N==null?void 0:N.threePLUnits)??0))}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>
          <td class="num inventory-value" data-field="totalUnits">${V(A)}</td>
          <td class="num inventory-value inventory-in-transit" data-tooltip-html="${Vn(pt)}">${V(k)}</td>
          <td class="num">
            ${yt?'<span class="cell-warning" title="EK fehlt im Produkt">⚠︎</span>':""}
            <span data-field="ekEur">${Number.isFinite(W)?on(W):"—"}</span>
          </td>
          <td class="num inventory-value" data-field="totalValue">${Number.isFinite(dt)?on(dt):"—"}</td>
          <td class="num inventory-value" data-field="delta">${V(et)}</td>
          <td><input class="inventory-input note" data-field="note" value="${h((N==null?void 0:N.note)||"")}" /></td>
        </tr>
      `}).join("");return`
        <tr class="inventory-category-row" data-category-row="${h(w.id)}">
          <th class="inventory-col-sku sticky-cell" colspan="2">
            <button type="button" class="tree-toggle" data-category="${h(w.id)}">${O?"▸":"▾"}</button>
            <span class="tree-label">${h(w.name)}</span>
            <span class="muted">(${w.items.length})</span>
          </th>
          <th colspan="8"></th>
        </tr>
        ${K}
      `}).join("")||'<tr><td class="muted" colspan="10">Keine Produkte gefunden.</td></tr>'}
      </tbody>
    </table>
  `}function Lt(t,e=";"){const n=String(t??"");return n?n.includes('"')||n.includes(`
`)||n.includes(e)?`"${n.replace(/"/g,'""')}"`:n:""}function nt(t){return t==null||!Number.isFinite(Number(t))?"":Math.round(Number(t)).toLocaleString("de-DE",{maximumFractionDigits:0})}function St(t){return t==null||!Number.isFinite(Number(t))?"":Number(t).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function Ue({state:t,view:e,snapshot:n,products:c,categories:m,asOfDate:i}){const s=jt(c,e.search),l=Wt(s,m),y=In(t,i),p=new Map;((n==null?void 0:n.items)||[]).forEach(H=>{const M=String(H.sku||"").trim();M&&p.set(M,H)});const g=[],$=[];let D=0,w=0,O=0,K=0;return l.forEach(H=>{H.items.forEach(M=>{const N=String(M.sku||"").trim();if(!N)return;const R=M.alias||"",k=p.get(N)||{amazonUnits:0,threePLUnits:0},T=Number((k==null?void 0:k.amazonUnits)||0),j=Number((k==null?void 0:k.threePLUnits)||0),X=y.get(N),A=X?X.total:0,P=ln(M,t.settings||{}),_=T+j+A,et=Number.isFinite(P)?_*P:null;Number.isFinite(P)||$.push(R?`${N} (${R})`:N),Number.isFinite(T)&&(D+=T),Number.isFinite(j)&&(w+=j),Number.isFinite(A)&&(O+=A),Number.isFinite(et)&&(K+=et),g.push({sku:N,alias:R,amazonUnits:T,threePlUnits:j,inTransitUnits:A,ekEur:P,rowValue:et})})}),{rows:g,totals:{amazonUnits:D,majamoUnits:w,inTransitUnits:O,totalUnits:D+w+O,totalValue:K},missingEk:$}}function Me({title:t,rows:e,totals:n,missingEk:c}){const m=";",i=[];t&&(i.push(Lt(t,m)),i.push(""));const s=["SKU","Alias","Bestand Amazon (Stk)","Bestand majamo (Stk)","In Transit (Stk)","EK-Preis (EUR / Stk)","Warenwert (EUR)"];i.push(s.map(y=>Lt(y,m)).join(m)),e.forEach(y=>{const p=[y.sku,y.alias,nt(y.amazonUnits),nt(y.threePlUnits),nt(y.inTransitUnits),St(y.ekEur),St(y.rowValue)];i.push(p.map(g=>Lt(g,m)).join(m))});const l=["Gesamtsumme Warenwert (EUR)","",nt(n.amazonUnits),nt(n.majamoUnits),nt(n.inTransitUnits),"",St(n.totalValue)];return i.push(l.map(y=>Lt(y,m)).join(m)),c.length&&(i.push(""),i.push(Lt(`Fehlender EK-Preis für: ${c.join(", ")}`,m))),i.join(`
`)}function Ne({title:t,fileName:e,rows:n,totals:c,missingEk:m,generatedAt:i}){const s=n.map(p=>`
      <tr>
        <td>${h(p.sku)}</td>
        <td>${h(p.alias||"")}</td>
        <td class="num">${nt(p.amazonUnits)}</td>
        <td class="num">${nt(p.threePlUnits)}</td>
        <td class="num">${nt(p.inTransitUnits)}</td>
        <td class="num">${St(p.ekEur)}</td>
        <td class="num">${St(p.rowValue)}</td>
      </tr>
  `).join(""),l=`
      <tr class="totals">
        <td>Gesamtsumme Warenwert (EUR)</td>
        <td></td>
        <td class="num">${nt(c.amazonUnits)}</td>
        <td class="num">${nt(c.majamoUnits)}</td>
        <td class="num">${nt(c.inTransitUnits)}</td>
        <td class="num"></td>
        <td class="num">${St(c.totalValue)}</td>
      </tr>
  `,y=m.length?`<div class="warning">Fehlender EK-Preis für: ${h(m.join(", "))}</div>`:"";return`
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
            ${l}
          </tbody>
        </table>
        ${y}
        <script>
          window.addEventListener("load", () => {
            setTimeout(() => window.print(), 250);
          });
        <\/script>
      </body>
    </html>
  `}function De({state:t,view:e,snapshot:n,products:c,categories:m,months:i,projectionData:s=null,inboundData:l=null}){const y=jt(c,e.search),p=Wt(y,m),g=new Map,$=s||Dn({state:t,months:i,products:y,snapshot:n,projectionMode:e.projectionMode}),D=$.months;y.forEach(k=>{const T=String((k==null?void 0:k.sku)||"").trim();if(!T)return;const j=new Map;D.forEach(X=>{var P;const A=(P=$.perSkuMonth.get(T))==null?void 0:P.get(X);Number.isFinite(A==null?void 0:A.forecastUnits)&&j.set(X,A.forecastUnits)}),g.set(T,j)});const w=e.projectionMode==="plan"?ge(p,g,i):new Map,O=new Map;((n==null?void 0:n.items)||[]).forEach(k=>{const T=String(k.sku||"").trim();T&&O.set(T,k)});const{inboundMap:K,missingEtaSkus:H}=l||zn(t),M=oe(t).bySku,N=p.map(k=>{const T=e.collapsed[k.id],j=k.items.map(A=>{var C;const P=String(A.sku||"").trim(),_=A.alias||"—",et=((C=M==null?void 0:M.get(P.toLowerCase()))==null?void 0:C.abcClass)||"—",W=re(A,t),dt=ae(A,t),yt=Number.isFinite(W)?V(W):"—",pt=Number.isFinite(dt)?V(dt):"—",at=`
        <button class="inventory-drilldown-trigger" type="button" data-action="open-drilldown" data-sku="${h(P)}" data-alias="${h(_)}" title="SKU Verlauf öffnen" aria-label="SKU Verlauf öffnen">
          <span aria-hidden="true">&#128200;</span>
        </button>
      `;let mt=0;const Ct=i.map(Q=>{var ht;const B=K.get(P),E=B?B.get(Q):null;E&&E.poUnits+E.foUnits;const F=(ht=$.perSkuMonth.get(P))==null?void 0:ht.get(Q),Y=(F==null?void 0:F.forecastUnits)??null,z=(F==null?void 0:F.endAvailable)??null,xt=(F==null?void 0:F.forecastMissing)??!0,_t=Number.isFinite(F==null?void 0:F.safetyUnits)?F.safetyUnits:null,Ot=Number.isFinite(F==null?void 0:F.safetyDays)?F.safetyDays:null,lt=E!=null&&E.hasPo&&(E!=null&&E.hasFo)?"inventory-cell inbound-both":E!=null&&E.hasPo?"inventory-cell inbound-po":E!=null&&E.hasFo?"inventory-cell inbound-fo":"inventory-cell",ft=(F==null?void 0:F.doh)??null,zt=e.projectionMode==="doh",ct=e.projectionMode==="plan",Yt=zt?Number.isFinite(ft)&&ft<=0:Number.isFinite(z)&&z<=0,Gt=ct?Number.isFinite(Y)?V(Y):"—":xt?"—":Yt?'0 <span class="inventory-warning-icon">⚠︎</span>':zt?ft==null?"—":V(ft):V(z),Xt=ct?"":En({endAvailable:z,safetyUnits:_t,doh:ft,safetyDays:Ot,projectionMode:e.projectionMode}),Ut=ct?"":xt?"incomplete":"",It=E?`
            ${E.hasPo?'<span class="inventory-inbound-marker po"></span>':""}
            ${E.hasFo?'<span class="inventory-inbound-marker fo"></span>':""}
          `:"",vt=E?Se({alias:_,month:Q,events:E.events}):"",Vt=vt?vt.replace(/\s+/g," ").trim():"",Mt=vt?`inventory-inbound-${P}-${Q}-${mt++}`:"";return`
          <td class="num ${lt} ${Xt} ${Ut} inventory-projection-cell" data-month="${h(Q)}" ${vt?`data-tooltip-html="${Vn(Vt)}"`:""} ${Mt?`data-tooltip-id="${Mt}"`:""}>
            <span class="inventory-cell-value">${Gt}</span>
            ${It}
          </td>
        `}).join(""),kt=H.has(P)?'<span class="cell-warning" title="PO ohne ETA wird nicht gezählt">⚠︎</span>':"";return`
        <tr class="inventory-row ${T?"is-collapsed":""}" data-sku="${h(P)}" data-category="${h(k.id)}">
          <td class="inventory-col-sku sticky-cell">${kt}${h(P)}</td>
          <td class="inventory-col-alias sticky-cell">
            <div class="inventory-alias-cell">
              <span class="inventory-alias-text">${h(_)}</span>
              ${at}
            </div>
          </td>
          <td class="inventory-col-abc sticky-cell">${h(et)}</td>
          <td class="inventory-col-safety-days sticky-cell num">${h(yt)}</td>
          <td class="inventory-col-coverage-days sticky-cell num">${h(pt)}</td>
          ${Ct}
        </tr>
      `}).join(""),X=e.projectionMode==="plan"?i.map(A=>{var W;const P=rn(A),_=(W=w.get(k.id))==null?void 0:W.get(P);return`<td class="num inventory-projection-group-cell">${Number.isFinite(_)?V(_):"—"}</td>`}).join(""):`<th colspan="${i.length}"></th>`;return`
      <tr class="inventory-category-row" data-category-row="${h(k.id)}">
        <th class="inventory-col-sku sticky-cell" colspan="5">
          <button type="button" class="tree-toggle" data-category="${h(k.id)}">${T?"▸":"▾"}</button>
          <span class="tree-label">${h(k.name)}</span>
          <span class="muted">(${k.items.length})</span>
        </th>
        ${X}
      </tr>
      ${j}
    `}).join("");return`
    <table class="table-compact ui-table-standard inventory-table inventory-projection-table" data-ui-table="true" data-sticky-cols="5" data-sticky-owner="manual">
      <thead>
        <tr>
          <th class="inventory-col-sku sticky-header">SKU</th>
          <th class="inventory-col-alias sticky-header">Alias</th>
          <th class="inventory-col-abc sticky-header">ABC</th>
          <th class="inventory-col-safety-days sticky-header" data-ui-tooltip="Sicherheitsbestand in Days on Hand">Safety DOH</th>
          <th class="inventory-col-coverage-days sticky-header" data-ui-tooltip="Bestellreichweite in Days on Hand">Coverage DOH</th>
          ${i.map(k=>`<th class="num">${At(k)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${N||`<tr><td class="muted" colspan="${i.length+5}">Keine Produkte gefunden.</td></tr>`}
      </tbody>
    </table>
  `}function Ee(t,e,n,c,m){var R;if(!t||!e||!c)return;const i=String(c.sku||"").trim(),s=an(e,i),l=(R=n==null?void 0:n.items)==null?void 0:R.find(k=>String(k.sku||"").trim()===i),y=Number(s.amazonUnits||0)+Number(s.threePLUnits||0),p=((l==null?void 0:l.amazonUnits)||0)+((l==null?void 0:l.threePLUnits)||0),g=y-p,$=t.querySelector(".inventory-in-transit"),D=rt(($==null?void 0:$.textContent)||0),w=y+(Number.isFinite(D)?D:0),O=ln(c,m.settings||{}),K=Number.isFinite(O)?w*O:null,H=t.querySelector('[data-field="totalUnits"]'),M=t.querySelector('[data-field="delta"]'),N=t.querySelector('[data-field="totalValue"]');H&&(H.textContent=V(y)),M&&(M.textContent=V(g)),N&&(N.textContent=Number.isFinite(K)?on(K):"—")}function tt(t){var mn,fn,hn;const e=ee(),n=pe(),c=window.__routeQuery||{},m=String(c.sku||"").trim(),i=String(c.month||"").trim();m&&(n.search="",n.projectionMode="doh"),/^\d{4}-\d{2}$/.test(i)&&(n.selectedMonth=An(i,-1));const s=ve(e,n);n.selectedMonth=s,it(n),t._inventoryCleanup&&(t._inventoryCleanup(),t._inventoryCleanup=null);const l=Pn(e,s)||{month:s,items:[]},y=Nn(e,s),p=Array.isArray(e.productCategories)?e.productCategories:[],g=(e.products||[]).filter(ye),$=de(n.snapshotAsOfDate),D=$?sn($):null;let w=$&&D===s?$:ue(s);w||(w=new Date),(!$||D!==s)&&(n.snapshotAsOfDate=Rt(w),it(n));const O=Tn(w);if(m){const o=g.find(d=>String((d==null?void 0:d.sku)||"").trim()===m);(o==null?void 0:o.categoryId)!=null&&(n.collapsed[String(o.categoryId)]=!1,it(n))}const K=Number(((fn=(mn=e.inventory)==null?void 0:mn.settings)==null?void 0:fn.projectionMonths)||12),H=[6,12,18],M=le(s,H.includes(K)?K:12),N=jt(g,n.search),R=Dn({state:e,months:M,products:N,snapshot:l,projectionMode:n.projectionMode}),k=zn(e),T=n.projectionMode==="plan",j=Ue({state:e,view:n,snapshot:l,products:g,categories:p,asOfDate:O}),X=j.missingEk.length;t.innerHTML=`
    <section class="card inventory-card">
      <div class="inventory-header ui-page-head">
        <div>
          <h2>Inventory</h2>
          <p class="muted">Month-end Snapshots und Bestandsplanung. Lokal gespeichert.</p>
        </div>
        <div class="inventory-search">
          <input type="search" placeholder="SKU oder Alias suchen" value="${h(n.search)}" />
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
        <span class="muted small">${y?`Vorheriger Snapshot: ${At(y.month)}`:"Kein vorheriger Snapshot vorhanden."}</span>
      </div>
      <div class="inventory-export">
        <div class="inventory-export-controls">
          <label class="inventory-field">
            <span class="muted">Bestandsaufnahme zum</span>
            <input type="date" id="inventory-export-date" value="${h(Rt(w))}" />
          </label>
          <button class="btn secondary" id="inventory-export-csv">Export CSV</button>
          <button class="btn secondary" id="inventory-export-pdf">Export PDF</button>
        </div>
        <div class="inventory-export-meta">
          <span class="muted small">Export für Buchführung: SKU, Bestände, In-Transit, EK-Preis, Warenwert</span>
          ${X?`<span class="inventory-export-warning">⚠︎ EK fehlt (${X})</span>`:""}
        </div>
      </div>
      <div class="inventory-table-wrap ui-table-shell">
        <div class="inventory-table-scroll ui-scroll-host">
          ${xe({state:e,view:n,snapshot:l,previousSnapshot:y,products:g,categories:p,asOfDate:O,snapshotMonth:s})}
        </div>
      </div>
    </section>

    <section class="card inventory-card">
      <div class="inventory-header ui-page-head">
        <div>
          <h3>Projection (next ${H.includes(K)?K:12} months)</h3>
          <p class="muted">End-of-Month verfügbares Lager in DE (Amazon + 3PL).</p>
        </div>
        <div class="inventory-controls">
          <label class="inventory-field">
            <span class="muted">Horizon</span>
            <select id="inventory-horizon">
              ${H.map(o=>`<option value="${o}" ${o===K?"selected":""}>${o} Monate</option>`).join("")}
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
      <div class="inventory-table-wrap ui-table-shell">
        <div class="inventory-table-scroll ui-scroll-host">
          ${De({state:e,view:n,snapshot:l,products:g,categories:p,months:M,projectionData:R,inboundData:k})}
        </div>
      </div>
      <div class="inventory-legend">
        ${T?"":`
          <span class="inventory-legend-item"><span class="legend-swatch safety-negative"></span> Stockout / unter Safety</span>
          <span class="inventory-legend-item"><span class="legend-swatch safety-low"></span> Unter Safety (Units)</span>
        `}
        <span class="inventory-legend-item"><span class="legend-swatch inbound-po"></span> Inbound PO</span>
        <span class="inventory-legend-item"><span class="legend-swatch inbound-fo"></span> Inbound FO</span>
      </div>
    </section>
    <div id="inventory-tooltip-layer" class="inventory-tooltip-layer" hidden></div>
  `;const A=t.querySelector("#inventory-month");if(A){const o=(((hn=e.inventory)==null?void 0:hn.snapshots)||[]).map(r=>r==null?void 0:r.month).filter(r=>/^\d{4}-\d{2}$/.test(r)),d=new Set([...o,Ln(),s]),u=Array.from(d).sort();A.innerHTML=u.map(r=>`<option value="${r}" ${r===s?"selected":""}>${At(r)}</option>`).join(""),A.addEventListener("change",r=>{n.selectedMonth=r.target.value,it(n),tt(t)})}const P=t.querySelector("#inventory-export-date");P&&P.addEventListener("change",o=>{n.snapshotAsOfDate=o.target.value,it(n),tt(t)});const _=t.querySelector("#inventory-export-csv");_&&_.addEventListener("click",()=>{if(!j.rows.length){window.alert("Keine Daten für den Export vorhanden.");return}const o=xn(w),d=Me({title:o,rows:j.rows,totals:j.totals,missingEk:j.missingEk}),u=`bestandsaufnahme_${Rt(w)}.csv`,r=new Blob([d],{type:"text/csv"}),a=URL.createObjectURL(r),v=document.createElement("a");v.href=a,v.download=u,document.body.append(v),v.click(),v.remove(),URL.revokeObjectURL(a)});const et=t.querySelector("#inventory-export-pdf");et&&et.addEventListener("click",()=>{if(!j.rows.length){window.alert("Keine Daten für den Export vorhanden.");return}const o=xn(w),d=me(new Date),u=`bestandsaufnahme_${Rt(w)}.pdf`,r=Ne({title:o,fileName:u,rows:j.rows,totals:j.totals,missingEk:j.missingEk,generatedAt:d}),a=window.open("","_blank","noopener,noreferrer");a&&(a.document.open(),a.document.write(r),a.document.close())});const W=t.querySelector(".inventory-search input");W&&W.addEventListener("input",o=>{n.search=o.target.value||"",it(n),tt(t)});const dt=t.querySelector("#inventory-copy");dt&&dt.addEventListener("click",()=>{const o=Mn(e,s),d=Nn(e,s);o.items=(g||[]).map(u=>{var v;const r=String(u.sku||"").trim(),a=(v=d==null?void 0:d.items)==null?void 0:v.find(S=>String(S.sku||"").trim()===r);return{sku:r,amazonUnits:(a==null?void 0:a.amazonUnits)??0,threePLUnits:(a==null?void 0:a.threePLUnits)??0,note:(a==null?void 0:a.note)??""}}),nn(e),tt(t)});const yt=t.querySelector("#inventory-expand-all");yt&&yt.addEventListener("click",()=>{Un({products:g,categories:p,view:n,collapsed:!1}),tt(t)});const pt=t.querySelector("#inventory-collapse-all");pt&&pt.addEventListener("click",()=>{Un({products:g,categories:p,view:n,collapsed:!0}),tt(t)});const at=t.querySelector(".inventory-snapshot-table");let mt=null;const Ct=()=>{mt&&clearTimeout(mt),mt=setTimeout(()=>{const o=Mn(e,s);o!==l&&(o.items=l.items),nn(e)},250)};if(at){const o=u=>{const r=u.closest("tr[data-sku]");if(!r)return null;const a=r.getAttribute("data-sku"),v=g.find(U=>String(U.sku||"").trim()===a);if(!v)return null;const S=an(l,a),x=u.dataset.field;return{row:r,sku:a,product:v,item:S,field:x}},d=u=>{var J;const r=o(u);if(!r)return;const{row:a,sku:v,product:S,item:x,field:U}=r;if(U!=="amazonUnits"&&U!=="threePLUnits")return;const G=Bt(s,v,U),I=Pt.get(G)??u.value,{value:Z,isRounded:ot}=fe(I);Pt.delete(G),u.value=String(Z),(J=u.closest("td"))==null||J.classList.toggle("inventory-input-warn",ot),U==="amazonUnits"&&(x.amazonUnits=Z),U==="threePLUnits"&&(x.threePLUnits=Z),Ee(a,l,y,S,e),Ct()};at.addEventListener("click",u=>{const r=u.target.closest("button.tree-toggle[data-category]");if(!r)return;const a=r.getAttribute("data-category");n.collapsed[a]=!n.collapsed[a],it(n),tt(t)}),at.addEventListener("input",u=>{var U;const r=u.target.closest("input.inventory-input");if(!r)return;const a=o(r);if(!a)return;const{sku:v,item:S,field:x}=a;if(x==="note"){S.note=r.value,Ct();return}if(x==="amazonUnits"||x==="threePLUnits"){const G=Bt(s,v,x);Pt.set(G,r.value),(U=r.closest("td"))==null||U.classList.remove("inventory-input-warn")}}),at.addEventListener("blur",u=>{const r=u.target.closest("input.inventory-input");if(!r)return;const a=o(r);a&&a.field!=="note"&&d(r)},!0),at.addEventListener("keydown",u=>{if(u.key!=="Enter")return;const r=u.target.closest("input.inventory-input");if(!r)return;const a=o(r);!a||a.field==="note"||(u.preventDefault(),d(r))})}const kt=t.querySelector(".inventory-projection-table");kt&&(kt.addEventListener("click",o=>{const d=o.target.closest("button.tree-toggle[data-category]");if(!d)return;const u=d.getAttribute("data-category");n.collapsed[u]=!n.collapsed[u],it(n),tt(t)}),kt.addEventListener("click",o=>{const d=o.target.closest("button.inventory-drilldown-trigger[data-action='open-drilldown']");if(d){const x=String(d.getAttribute("data-sku")||"").trim(),U=String(d.getAttribute("data-alias")||x).trim();if(!x)return;o.preventDefault(),o.stopPropagation(),vt({sku:x,alias:U});return}if(o.target.closest("button.tree-toggle[data-category]"))return;const r=o.target.closest("td.inventory-projection-cell");if(!r)return;const a=r.closest("tr[data-sku]");if(!a)return;const v=a.getAttribute("data-sku"),S=r.getAttribute("data-month");!v||!S||(o.stopPropagation(),zt(r,{sku:v,month:S}))}));const C=t.querySelector("#inventory-tooltip-layer");let Q=null,B=null,E=null,F=null,Y="units",z=null;function xt(o){if(!C||C.hidden)return;const d=12,u=window.innerWidth-C.offsetWidth-8,r=window.innerHeight-C.offsetHeight-8,a=Math.min(o.clientX+d,u),v=Math.min(o.clientY+d,r);C.style.left=`${Math.max(8,a)}px`,C.style.top=`${Math.max(8,v)}px`}function _t(o,d,u){if(!C||!d)return;let r=d;try{r=decodeURIComponent(d)}catch{r=d}C.innerHTML=r,C.hidden=!1,C.classList.add("is-visible"),Q=o,xt(u)}function Ot(){C&&(C.hidden=!0,C.classList.remove("is-visible"),C.innerHTML="",Q=null)}function lt(){B&&B.remove(),B=null,E=null}function ft(o){if(!B||!o)return;const d=o.getBoundingClientRect(),u=8,r=window.innerWidth-B.offsetWidth-u,a=window.innerHeight-B.offsetHeight-u,v=Math.min(d.left,r),S=Math.min(d.bottom+6,a);B.style.left=`${Math.max(u,v)}px`,B.style.top=`${Math.max(u,S)}px`}function zt(o,{sku:d,month:u}){var Z;if(!o||!d||!u)return;if(E===o&&B){lt();return}lt();const r=((Z=e.settings)==null?void 0:Z.monthAnchorDay)||"START",a=be(u,r),v=$e(a),S=Tt(a),x=ce(u),U=he(e,d,u),G=Number.isFinite(U)?`<div class="inventory-cell-popover-meta">Plan-Absatz in diesem Monat: ${V(U)}</div>`:"",I=document.createElement("div");I.className="inventory-cell-popover",I.innerHTML=`
      <div class="inventory-cell-popover-title">Aktion für ${h(d)}</div>
      ${G}
      <button class="inventory-cell-popover-action" type="button" data-action="fo">
        FO erstellen – Ankunft in ${h(x)} <span class="muted">(Anker: ${h(S)})</span>
      </button>
      <button class="inventory-cell-popover-action" type="button" data-action="po">
        PO erstellen – Bestellung in ${h(x)} <span class="muted">(Anker: ${h(S)})</span>
      </button>
      <button class="inventory-cell-popover-action" type="button" data-action="po-arrival">
        PO rückwärts – Ankunft in ${h(x)} <span class="muted">(Anker: ${h(S)})</span>
      </button>
    `,I.addEventListener("click",ot=>{const J=ot.target.closest("button[data-action]");if(!J)return;const ut=J.dataset.action,q=new URLSearchParams;q.set("create","1"),q.set("sku",d),q.set("anchorMonth",u),q.set("anchorDate",v),ut==="fo"?(q.set("target",v),location.hash=`#fo?${q.toString()}`):ut==="po"?(q.set("orderDate",v),q.set("anchorMode","order"),location.hash=`#po?${q.toString()}`):ut==="po-arrival"&&(q.set("anchorMode","arrival"),location.hash=`#po?${q.toString()}`),lt()}),document.body.appendChild(I),B=I,E=o,ft(o)}function ct(){z&&(clearTimeout(z),z=null),F&&(F.remove(),F=null,Y="units")}function Yt(o){const d=R.perSkuMonth.get(o)||new Map,u=k.inboundMap.get(o)||new Map;return M.map(r=>{const a=d.get(r)||null,v=u.get(r)||null;return{month:r,endAvailable:Number.isFinite(a==null?void 0:a.endAvailable)?Number(a.endAvailable):null,doh:Number.isFinite(a==null?void 0:a.doh)?Number(a.doh):null,safetyUnits:Number.isFinite(a==null?void 0:a.safetyUnits)?Number(a.safetyUnits):null,safetyDays:Number.isFinite(a==null?void 0:a.safetyDays)?Number(a.safetyDays):null,forecastUnits:Number.isFinite(a==null?void 0:a.forecastUnits)?Number(a.forecastUnits):null,events:Array.isArray(v==null?void 0:v.events)?v.events:[]}})}function Gt({alias:o,monthData:d}){const u=Y==="doh"?"Bestand Monatsende (DOH)":"Bestand Monatsende (DE verfügbar)",r=Y==="doh"?Number.isFinite(d.doh)?`${V(d.doh)} DOH`:"—":Number.isFinite(d.endAvailable)?`${V(d.endAvailable)} Units`:"—",a=Number.isFinite(d.forecastUnits)?`${V(d.forecastUnits)} Units`:"—",v=d.events.length?d.events.map(S=>{const x=S.open?`<button class="btn sm secondary inventory-link" type="button" data-route="${h(S.route||"")}" data-open="${h(S.open||"")}">Open ${h(S.type||"")}</button>`:"";return`
          <div class="inventory-drilldown-arrival">
            <div class="inventory-drilldown-arrival-main">
              <div><strong>${h(S.type||"—")} ${h(S.label||S.id||"—")}</strong></div>
              <div class="muted">${h(S.date||"—")}</div>
            </div>
            <div class="inventory-drilldown-arrival-meta">
              <div>+${V(S.qty)} Units</div>
              ${x}
            </div>
          </div>
        `}).join(""):'<div class="inventory-drilldown-tooltip-empty">Keine Ankünfte.</div>';return`
      <div class="inventory-drilldown-tooltip-header">
        <div class="inventory-drilldown-tooltip-title">${h(d.month)}</div>
        <div class="muted">${h(o||"—")}</div>
      </div>
      <div class="inventory-drilldown-tooltip-kpis">
        <div>${u}: <strong>${r}</strong></div>
        <div>Plan-Absatz: <strong>${a}</strong></div>
      </div>
      <div class="inventory-drilldown-tooltip-arrivals">${v}</div>
    `}function Xt(o,d){if(!o||!d)return;const u=14,r=window.innerWidth-o.offsetWidth-12,a=window.innerHeight-o.offsetHeight-12,v=en(d.clientX+u,8,Math.max(8,r)),S=en(d.clientY+u,8,Math.max(8,a));o.style.left=`${v}px`,o.style.top=`${S}px`}function Ut(o){o&&(o.hidden=!0,o.innerHTML="")}function It(o,{sku:d,alias:u}){var bn;const r=o==null?void 0:o.querySelector("[data-drilldown-chart]"),a=o==null?void 0:o.querySelector(".inventory-drilldown-tooltip");if(!r||!a)return;z&&(clearTimeout(z),z=null),Ut(a);const v=Yt(d).map(f=>{const b=n.showSafety?En({endAvailable:f.endAvailable,safetyUnits:f.safetyUnits,doh:f.doh,safetyDays:f.safetyDays,projectionMode:Y==="doh"?"doh":"units"}):"";return{...f,riskClass:b}});if(!v.length){r.innerHTML='<div class="muted">Keine Projektion vorhanden.</div>';return}const S=v.length,x=72,U=56,G=20,I=18,Z=210,ot=I+Z+36,J=86,ut=ot+J,q=U+G+S*x,qn=ut+34,Qt=v.map(f=>Y==="doh"?f.doh:f.endAvailable),Rn=v.map(f=>Y==="doh"?f.safetyDays:f.safetyUnits),Nt=Qt.filter(f=>Number.isFinite(f));n.showSafety&&Rn.forEach(f=>{Number.isFinite(f)&&Nt.push(f)});let gt=Nt.length?Math.min(...Nt):0,bt=Nt.length?Math.max(...Nt):1;gt=Math.min(gt,0),bt<=gt&&(bt=gt+1);const Kn=Math.max(1,...v.map(f=>Number.isFinite(f.forecastUnits)?f.forecastUnits:0)),Dt=f=>U+f*x+x/2,Et=f=>I+(bt-f)/(bt-gt)*Z,Bn=f=>{const b=Number.isFinite(f)?Math.max(0,f):0;return ot+J-b/Kn*J},yn=4,Wn=Array.from({length:yn+1},(f,b)=>{const L=b/yn,st=bt-(bt-gt)*L;return{value:st,y:Et(st)}}),Ht=[];let $t=[];Qt.forEach((f,b)=>{if(!Number.isFinite(f)){$t.length&&Ht.push($t),$t=[];return}$t.push({x:Dt(b),y:Et(f),index:b})}),$t.length&&Ht.push($t);const pn=Math.max(12,Math.round(x*.42)),_n=v.map((f,b)=>{if(!n.showSafety||!f.riskClass)return"";const L=f.riskClass==="safety-negative"?"inventory-drilldown-band-negative":"inventory-drilldown-band-low",st=U+b*x;return`<rect class="${L}" x="${st}" y="${I}" width="${x}" height="${ut-I+1}"></rect>`}).join(""),Yn=Wn.map(f=>`
      <line class="inventory-drilldown-grid" x1="${U}" y1="${f.y.toFixed(2)}" x2="${q-G}" y2="${f.y.toFixed(2)}"></line>
      <text class="inventory-drilldown-axis-label" x="${U-8}" y="${(f.y+3).toFixed(2)}" text-anchor="end">${h(V(f.value))}</text>
    `).join(""),Gn=Ht.map(f=>`<polyline class="inventory-drilldown-stock-line" points="${f.map(L=>`${L.x.toFixed(2)},${L.y.toFixed(2)}`).join(" ")}"></polyline>`).join(""),Xn=Ht.reduce((f,b)=>f.concat(b),[]).map(f=>`<circle class="inventory-drilldown-stock-dot" cx="${f.x.toFixed(2)}" cy="${f.y.toFixed(2)}" r="3.4"></circle>`).join(""),Qn=v.map((f,b)=>{if(!Number.isFinite(f.forecastUnits)||f.forecastUnits<=0)return"";const L=Dt(b)-pn/2,st=Bn(f.forecastUnits),qt=Math.max(1,ot+J-st);return`<rect class="inventory-drilldown-plan-bar" x="${L.toFixed(2)}" y="${st.toFixed(2)}" width="${pn}" height="${qt.toFixed(2)}" rx="3"></rect>`}).join(""),Zn=v.map((f,b)=>{if(!f.events.length)return"";const L=f.events.some(tn=>tn.type==="PO"),st=f.events.some(tn=>tn.type==="FO"),qt=L&&st?"PO+FO":L?"PO":"FO",$n=Qt[b],ne=Number.isFinite($n)?Et($n):I+14,wn=en(ne-22,I+2,I+Z-18),Jt=qt.length>2?36:24,Sn=Dt(b)-Jt/2;return`
        <rect class="inventory-drilldown-arrival-pill" x="${Sn.toFixed(2)}" y="${wn.toFixed(2)}" width="${Jt}" height="14" rx="7"></rect>
        <text class="inventory-drilldown-arrival-pill-text" x="${(Sn+Jt/2).toFixed(2)}" y="${(wn+10.2).toFixed(2)}" text-anchor="middle">${qt}</text>
      `}).join(""),Jn=v.map((f,b)=>`
      <text class="inventory-drilldown-axis-label" x="${Dt(b).toFixed(2)}" y="${(ut+16).toFixed(2)}" text-anchor="middle">${h(At(f.month))}</text>
    `).join(""),te=v.map((f,b)=>{const L=U+b*x;return`<rect class="inventory-drilldown-hit" data-index="${b}" x="${L}" y="${I}" width="${x}" height="${ut-I+18}"></rect>`}).join("");let Zt="";if(n.showSafety&&Y==="doh"){const f=(bn=v.find(b=>Number.isFinite(b.safetyDays)))==null?void 0:bn.safetyDays;if(Number.isFinite(f)){const b=Et(f);Zt=`
          <line class="inventory-drilldown-safety-line" x1="${U}" y1="${b.toFixed(2)}" x2="${q-G}" y2="${b.toFixed(2)}"></line>
          <text class="inventory-drilldown-axis-label" x="${q-G}" y="${(b-6).toFixed(2)}" text-anchor="end">Safety ${h(V(f))}</text>
        `}}else if(n.showSafety){const f=[];let b=[];v.forEach((L,st)=>{if(!Number.isFinite(L.safetyUnits)){b.length&&f.push(b),b=[];return}b.push(`${Dt(st).toFixed(2)},${Et(L.safetyUnits).toFixed(2)}`)}),b.length&&f.push(b),Zt=f.map(L=>`<polyline class="inventory-drilldown-safety-line" points="${L.join(" ")}"></polyline>`).join("")}r.innerHTML=`
      <svg class="inventory-drilldown-svg" viewBox="0 0 ${q} ${qn}" role="img" aria-label="SKU Verlauf ${h(u||d)} (${h(d)})">
        ${_n}
        ${Yn}
        <line class="inventory-drilldown-axis" x1="${U}" y1="${(I+Z).toFixed(2)}" x2="${q-G}" y2="${(I+Z).toFixed(2)}"></line>
        <line class="inventory-drilldown-axis" x1="${U}" y1="${(ot+J).toFixed(2)}" x2="${q-G}" y2="${(ot+J).toFixed(2)}"></line>
        <text class="inventory-drilldown-axis-label" x="${U}" y="${(I-6).toFixed(2)}">${Y==="doh"?"DOH":"Units"}</text>
        <text class="inventory-drilldown-axis-label" x="${U}" y="${(ot-8).toFixed(2)}">Plan-Absatz (Units)</text>
        ${Zt}
        ${Qn}
        ${Gn}
        ${Xn}
        ${Zn}
        ${Jn}
        ${te}
      </svg>
    `;const vn=()=>{z&&clearTimeout(z),z=setTimeout(()=>{a.matches(":hover")||Ut(a)},120)},gn=(f,b)=>{z&&(clearTimeout(z),z=null);const L=v[b];L&&(a.innerHTML=Gt({alias:u,monthData:L}),a.hidden=!1,Xt(a,f))};r.querySelectorAll(".inventory-drilldown-hit").forEach(f=>{const b=Number(f.getAttribute("data-index"));f.onmouseenter=L=>gn(L,b),f.onmousemove=L=>gn(L,b),f.onmouseleave=()=>vn()}),r.onmouseleave=()=>vn(),a.onmouseenter=()=>{z&&(clearTimeout(z),z=null)},a.onmouseleave=()=>Ut(a)}function vt({sku:o,alias:d}){if(!o)return;ct(),Y="units";const u=d||o,r=document.createElement("div");r.className="po-modal-backdrop inventory-drilldown-backdrop",r.setAttribute("role","dialog"),r.setAttribute("aria-modal","true"),r.innerHTML=`
      <div class="po-modal inventory-drilldown-modal">
        <header class="po-modal-header">
          <div>
            <strong>SKU Verlauf – ${h(u)} (${h(o)})</strong>
            <div class="muted small">Zeitraum: ${h(M[0]||"—")} bis ${h(M[M.length-1]||"—")}</div>
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
    `,r.addEventListener("click",a=>{if(a.target===r||a.target.closest("[data-drilldown-close]")){ct();return}const v=a.target.closest(".inventory-link");if(!v)return;const S=v.getAttribute("data-route"),x=v.getAttribute("data-open");if(!S||!x)return;const U=new URLSearchParams;U.set("open",x),location.hash=`${S}?${U.toString()}`,ct()}),r.addEventListener("change",a=>{const v=a.target.closest("input[name='inventory-drilldown-mode']");v&&(Y=v.value==="doh"?"doh":"units",It(r,{sku:o,alias:u}))}),document.body.appendChild(r),F=r,It(r,{sku:o,alias:u})}t.addEventListener("mouseover",o=>{const d=o.target.closest("[data-tooltip-html]");if(!d||d===Q)return;const u=d.getAttribute("data-tooltip-html");u&&_t(d,u,o)}),t.addEventListener("mousemove",o=>{Q&&xt(o)}),t.addEventListener("mouseout",o=>{if(!Q||o.relatedTarget&&C&&C.contains(o.relatedTarget))return;const d=o.target.closest("[data-tooltip-html]");d&&d===Q&&Ot()}),C&&C.addEventListener("mouseleave",()=>{Ot()});const Vt=o=>{if(!B||B.contains(o.target))return;const d=o.target.closest("td.inventory-projection-cell");d&&E===d||lt()},Mt=o=>{o.key==="Escape"&&(lt(),ct())};document.addEventListener("click",Vt),document.addEventListener("keydown",Mt);const ht=t.querySelector(".inventory-table-scroll"),cn=()=>lt();ht&&ht.addEventListener("scroll",cn),t.addEventListener("click",o=>{const d=o.target.closest(".inventory-link");if(!d)return;const u=d.getAttribute("data-route"),r=d.getAttribute("data-open");if(!u||!r)return;const a=new URLSearchParams;a.set("open",r),location.hash=`${u}?${a.toString()}`});const dn=t.querySelector("#inventory-horizon");dn&&dn.addEventListener("change",o=>{const d=Number(o.target.value||12);e.inventory||(e.inventory={snapshots:[],settings:{}}),e.inventory.settings||(e.inventory.settings={}),e.inventory.settings.projectionMonths=d,nn(e),tt(t)});const un=t.querySelector("#inventory-safety");un&&un.addEventListener("change",o=>{n.showSafety=o.target.checked,it(n),tt(t)}),t.querySelectorAll("input[name='inventory-mode']").forEach(o=>{o.addEventListener("change",d=>{const u=d.target.value;n.projectionMode=u==="doh"||u==="plan"?u:"units",it(n),tt(t)})});function Hn(){if(!m)return;const o=kn(m),d=/^\d{4}-\d{2}$/.test(i)?`[data-month="${kn(i)}"]`:"[data-month]",u=t.querySelector(`.inventory-projection-table tr[data-sku="${o}"] td${d}`),r=u?u.closest("tr[data-sku]"):t.querySelector(`.inventory-projection-table tr[data-sku="${o}"]`);r&&r.classList.add("row-focus"),u?(u.classList.add("cell-focus"),u.scrollIntoView({behavior:"smooth",block:"center",inline:"center"})):r&&r.scrollIntoView({behavior:"smooth",block:"center"}),window.__routeQuery={}}Hn(),t._inventoryCleanup=()=>{document.removeEventListener("click",Vt),document.removeEventListener("keydown",Mt),ht&&ht.removeEventListener("scroll",cn),lt(),ct()}}const je={render:tt};export{je as default,tt as render};
