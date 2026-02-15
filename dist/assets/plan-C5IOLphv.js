import{l as $}from"./index-CAzQztwo.js";const M=24*60*60*1e3;function b(e,n){if(!e)return n?new Date(n):null;const t=new Date(e);return Number.isNaN(t.getTime())?n?new Date(n):null:t}function D(e,n){const t=new Date(e.getTime());return t.setDate(t.getDate()+Number(n||0)),t}function P(e,n){if(!e||!n)return[];const[t,a]=String(e).split("-").map(Number);if(!t||!a)return[];const s=new Date(t,a-1,1);return Array.from({length:n},(d,c)=>{const i=new Date(s.getTime());return i.setMonth(i.getMonth()+c),{label:i.toLocaleString("de-DE",{month:"short",year:"numeric"}),start:i}})}function y(e,n){var a;if((a=e==null?void 0:e.settings)!=null&&a.startMonth)return e.settings.startMonth;const t=n.map(s=>s==null?void 0:s.orderDate).filter(Boolean).sort();return t.length?t[0].slice(0,7):new Date().toISOString().slice(0,7)}function _(e){var t;const n=Number((t=e==null?void 0:e.settings)==null?void 0:t.horizonMonths);return Number.isFinite(n)&&n>0?n:12}function S(e){if(typeof e=="number")return e;if(!e)return 0;const n=String(e).trim().replace(/\./g,"").replace(",","."),t=Number(n);return Number.isFinite(t)?t:0}function N(e){if(typeof e=="number")return e;if(e==null||e==="")return 0;const n=Number(String(e).trim().replace(",","."));return Number.isFinite(n)?n:0}function E(e){return!(e instanceof Date)||Number.isNaN(e.getTime())?"—":e.toLocaleDateString("de-DE",{year:"numeric",month:"2-digit",day:"2-digit"})}function T(e){return Number(e||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"})}function F(e){const n=b(e.orderDate,new Date),t=Number(e.prodDays||0),a=Number(e.transitDays||0),s=D(n,t),d=D(s,Number(e.etdLagDays||0)),c=D(s,a);return{ORDER_DATE:n,PROD_DONE:s,ETD:d,ETA:c}}function L(e,n){if(!n)return e.ORDER_DATE;const t=e[n.anchor||"ORDER_DATE"]||e.ORDER_DATE;return D(t,Number(n.lagDays||0))}function x(e){const n=[];return e.ORDER_DATE&&e.PROD_DONE&&e.PROD_DONE>e.ORDER_DATE&&n.push({cls:"production",label:"Produktion",start:e.ORDER_DATE,end:e.PROD_DONE}),e.PROD_DONE&&e.ETA&&e.ETA>e.PROD_DONE&&n.push({cls:"transit",label:"Transit",start:e.PROD_DONE,end:e.ETA}),n}function H(e){return e.slice().sort((n,t)=>{const a=b(n.orderDate,new Date(864e13)),s=b(t.orderDate,new Date(864e13));return a-s})}function k(e){return!Number.isFinite(e)||e<0?0:e>100?100:Math.round(e*10)/10}function j(e,n){const t=F(e),a=x(t),s=S(e.goodsEur||e.goodsValueEur||e.goodsValueUsd),d=Array.isArray(e.milestones)?e.milestones:[],c=d.reduce((r,u)=>r+N(u.percent||0),0),i=Math.round(c*10)/10,m=Math.abs(i-100)>.1;function l(r){if(!(r instanceof Date)||Number.isNaN(r.getTime()))return 0;const p=(Math.min(Math.max(r.getTime(),n.startMs),n.endMs)-n.startMs)/M;return Math.max(0,Math.min(100,p/n.totalDays*100))}const f=a.map(r=>{const u=l(r.start),p=Math.max(.75,l(r.end)-u);return`<div class="plan-phase ${r.cls}" style="left:${u}%;width:${p}%" title="${r.label}"></div>`}).join(""),g=d.map(r=>{const u=L(t,r),p=l(u),v=k(N(r.percent||0)),w=s*(v/100),A=`${r.label||"Milestone"} – ${E(u)} – ${T(w)}`;return`<div class="plan-marker" style="left:${p}%" title="${A}"><span></span></div>`}).join(""),h=e.type==="FO"?e.foNo||"FO":e.poNo||"PO",o=[`Order ${E(t.ORDER_DATE)}`,`ETA ${E(t.ETA)}`];s>0&&o.push(T(s));const O=m?" warn":"",R=m?`<span class="plan-alert" title="Meilensteine summieren sich auf ${i}%">⚠︎</span>`:"";return`
    <div class="plan-row${O}">
      <div class="plan-label">
        <div class="plan-title">${e.type} · ${h} ${R}</div>
        <div class="plan-meta">${o.join(" · ")}</div>
      </div>
      <div class="plan-track">
        ${f}
        ${g}
      </div>
    </div>
  `}async function B(e){const n=$(),t=Array.isArray(n==null?void 0:n.pos)?n.pos.map(o=>({...o,type:"PO"})):[],a=Array.isArray(n==null?void 0:n.fos)?n.fos.map(o=>({...o,type:"FO"})):[],s=H([...t,...a]);if(!s.length){e.innerHTML=`
      <section class="card">
        <h2>Plan</h2>
        <p class="muted">Noch keine POs oder FOs erfasst. Lege zuerst Bestellungen in den entsprechenden Tabs an.</p>
      </section>
    `;return}const d=y(n,s),c=_(n),i=P(d,c);if(!i.length){e.innerHTML=`
      <section class="card">
        <h2>Plan</h2>
        <p class="muted">Zeitraum konnte nicht berechnet werden. Bitte Startmonat in den Settings prüfen.</p>
      </section>
    `;return}const m=i[0].start,l=new Date(m.getTime());l.setMonth(l.getMonth()+c);const f={startMs:m.getTime(),endMs:l.getTime(),totalDays:Math.max(1,(l.getTime()-m.getTime())/M)},g=i.map(o=>`<div class="plan-month">${o.label}</div>`).join(""),h=s.map(o=>j(o,f)).join("");e.innerHTML=`
    <section class="card plan-card">
      <h2>Plan</h2>
      <p class="muted">Zeitplan der aktiven Purchase & Forecast Orders. Phasen und Zahlungs-Meilensteine werden relativ zum ausgewählten Startmonat visualisiert.</p>
      <div class="plan-grid" style="--plan-cols:${i.length}">
        <div class="plan-months">
          <div class="plan-month head"></div>
          ${g}
        </div>
        <div class="plan-rows">
          ${h}
        </div>
      </div>
      <div class="plan-legend">
        <span><span class="legend-box production"></span> Produktion</span>
        <span><span class="legend-box transit"></span> Transit</span>
        <span><span class="legend-dot"></span> Zahlung (Milestone)</span>
      </div>
      <p class="muted small">Hinweis: Reihen mit ⚠︎ markieren Meilenstein-Summen ≠ 100%.</p>
    </section>
  `}export{B as render};
