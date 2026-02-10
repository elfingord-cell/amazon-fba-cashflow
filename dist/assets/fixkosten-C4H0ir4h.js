import{l as C,s as E,b as z,c as j,d as J}from"./index-BzKrUq3k.js";import{e as w}from"./cashflow-DzcMzPib.js";const _=["Lizenz","Steuerberatung","Versicherung","Miete","Tools","Sonstiges"],H=[{value:"monthly",label:"monatlich"},{value:"quarterly",label:"vierteljährlich"},{value:"semiannual",label:"halbjährlich"},{value:"annual",label:"jährlich"},{value:"custom",label:"benutzerdefiniert"}],K=[{value:"1",label:"1."},{value:"15",label:"15."},{value:"LAST",label:"Letzter Tag"}],U=[{value:"daily",label:"tagesgenau"},{value:"none",label:"keine Proration"}],I=new Set;let D=null;function N(){try{if(typeof crypto<"u"&&typeof crypto.randomUUID=="function")return crypto.randomUUID()}catch{}return`fix-${Date.now()}-${Math.random().toString(16).slice(2)}`}function T(n){if(n==null)return 0;const e=String(n).trim().replace(/€/g,"").replace(/\s+/g,"").replace(/\./g,"").replace(",","."),u=Number(e);return Number.isFinite(u)?u:0}function S(n){const e=T(n);return Number(e).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})}function O(n){if(!n||!/^\d{4}-\d{2}-\d{2}$/.test(n))return"";const[e,u,g]=n.split("-");return`${g}.${u}.${e}`}function R(n){if(!n)return"";if(/^\d{4}-\d{2}-\d{2}$/.test(n))return n;const e=n.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);if(!e)return"";const u=String(Number(e[1])).padStart(2,"0"),g=String(Number(e[2])).padStart(2,"0");return`${e[3]}-${g}-${u}`}function V(n){if(!/^\d{4}-\d{2}$/.test(n||""))return n;const[e,u]=n.split("-").map(Number),g=new Date(e,u-1,1);return new Intl.DateTimeFormat("de-DE",{month:"long",year:"numeric"}).format(g)}function Z(n){Array.isArray(n.fixcosts)||(n.fixcosts=[]),(!n.fixcostOverrides||typeof n.fixcostOverrides!="object")&&(n.fixcostOverrides={}),(!n.status||typeof n.status!="object")&&(n.status={autoManualCheck:!1,events:{}}),(!n.status.events||typeof n.status.events!="object")&&(n.status.events={})}function Q(n){var e;return{id:N(),name:"Neue Fixkosten",category:"Sonstiges",amount:"1.000,00",frequency:"monthly",intervalMonths:1,anchor:"LAST",startMonth:((e=n.settings)==null?void 0:e.startMonth)||new Date().toISOString().slice(0,7),endMonth:"",proration:{enabled:!1,method:"none"},autoPaid:!1,notes:""}}function Y(n){const e=[];return(!n.name||!n.name.trim())&&e.push("Bitte einen Namen vergeben."),T(n.amount)>0||e.push("Bitte Betrag > 0 eingeben."),n.startMonth&&n.endMonth&&n.startMonth>n.endMonth&&e.push("Startmonat darf nicht nach Endmonat liegen."),n.anchor&&n.anchor!=="LAST"&&!/^\d+$/.test(String(n.anchor))&&e.push("Ungültiger Tag: Bitte 1–28/29/30/31 oder ‘Letzter Tag’. "),e}function G(n){const e=C();Z(e),n.innerHTML=`
    <section class="card fix-master">
      <div class="card-header">
        <h2>Fixkosten (Stammdaten)</h2>
        <p class="muted">Definiere wiederkehrende Fixkosten, Frequenz und automatische Zahlungen.</p>
      </div>
      <div class="table-scroll">
        <table class="table fix-master-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kategorie</th>
              <th>Betrag (€)</th>
              <th>Frequenz</th>
              <th>Fälligkeitstag</th>
              <th>Start / Ende</th>
              <th>Proration</th>
              <th>Automatisch bezahlt</th>
              <th>Notizen</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="fix-master-rows"></tbody>
        </table>
      </div>
      <div class="actions">
        <button class="btn primary" id="fix-add">+ Position hinzufügen</button>
      </div>
    </section>

    <section class="card fix-months">
      <div class="card-header">
        <h3>Fixkosten je Monat</h3>
        <p class="muted">Bearbeite monatliche Instanzen, Overrides und Zahlungsstatus.</p>
      </div>
      <div id="fix-month-list" class="fix-month-list"></div>
    </section>
  `;const u=n.querySelector("#fix-master-rows"),g=n.querySelector("#fix-add"),v=n.querySelector("#fix-month-list");function y(){if(!e.fixcosts.length){u.innerHTML='<tr><td colspan="10" class="muted">Keine Fixkosten hinterlegt.</td></tr>';return}u.innerHTML=e.fixcosts.map(t=>{var l,r;const o=Y(t),c=((l=t.proration)==null?void 0:l.enabled)===!0,a=((r=t.proration)==null?void 0:r.method)||"none",i=t.frequency||"monthly",s=i==="custom";return`
          <tr class="fix-master-row" data-id="${t.id}">
            <td>
              <label class="sr-only" for="name-${t.id}">Name</label>
              <input id="name-${t.id}" type="text" data-field="name" value="${t.name||""}" placeholder="z. B. Steuerberatung" />
              ${o.includes("Bitte einen Namen vergeben.")?'<small class="error">Bitte einen Namen vergeben.</small>':""}
            </td>
            <td>
              <select data-field="category" value="${t.category||"Sonstiges"}">
                ${_.map(d=>`<option value="${d}" ${d===(t.category||"Sonstiges")?"selected":""}>${d}</option>`).join("")}
              </select>
            </td>
            <td>
              <input type="text" data-field="amount" value="${S(t.amount)}" inputmode="decimal" />
              ${o.includes("Bitte Betrag > 0 eingeben.")?'<small class="error">Bitte Betrag > 0 eingeben.</small>':""}
            </td>
            <td>
              <select data-field="frequency" value="${i}">
                ${H.map(d=>`<option value="${d.value}" ${d.value===i?"selected":""}>${d.label}</option>`).join("")}
              </select>
              <input type="number" min="1" class="interval-input ${s?"":"hidden"}" data-field="intervalMonths" value="${t.intervalMonths||1}" aria-label="Intervall in Monaten" />
            </td>
            <td>
              <select data-field="anchor" value="${t.anchor||"LAST"}">
                ${K.map(d=>`<option value="${d.value}" ${d.value===(t.anchor||"LAST")?"selected":""}>${d.label}</option>`).join("")}
              </select>
            </td>
            <td class="fix-month-range">
              <input type="month" data-field="startMonth" value="${t.startMonth||""}" aria-label="Startmonat" />
              <input type="month" data-field="endMonth" value="${t.endMonth||""}" aria-label="Endmonat" />
              ${o.includes("Startmonat darf nicht nach Endmonat liegen.")?'<small class="error">Startmonat darf nicht nach Endmonat liegen.</small>':""}
            </td>
            <td class="fix-proration">
              <label class="checkbox">
                <input type="checkbox" data-field="prorationEnabled" ${c?"checked":""} />
                <span>anteilig</span>
              </label>
              <select data-field="prorationMethod" class="${c?"":"hidden"}">
                ${U.map(d=>`<option value="${d.value}" ${d.value===a?"selected":""}>${d.label}</option>`).join("")}
              </select>
            </td>
            <td>
              <label class="checkbox">
                <input type="checkbox" data-field="autoPaid" ${t.autoPaid?"checked":""} />
                <span>Automatisch bezahlen am Fälligkeitstag</span>
              </label>
            </td>
            <td>
              <input type="text" data-field="notes" value="${t.notes||""}" placeholder="Notiz" />
            </td>
            <td class="actions">
              <button class="btn" data-action="duplicate">Duplizieren</button>
              <button class="btn danger" data-action="delete">Löschen</button>
            </td>
          </tr>
        `}).join("")}function p(){var s,l;const t=((s=e.status)==null?void 0:s.events)||{},o=((l=e.status)==null?void 0:l.autoManualCheck)===!0,c=w(e,{statusEvents:t,autoManualCheck:o,today:new Date}),a=new Map;if(c.forEach(r=>{a.has(r.month)||a.set(r.month,[]),a.get(r.month).push(r)}),!a.size){v.innerHTML='<p class="muted">Keine Fixkosten im aktuellen Zeithorizont.</p>';return}const i=[];Array.from(a.entries()).sort((r,d)=>r[0]<d[0]?-1:1).forEach(([r,d])=>{const f=d.reduce((x,h)=>x+(h.amount||0),0),b=d.reduce((x,h)=>x+(h.paid&&h.amount||0),0),k=Math.max(0,f-b),M=I.has(r);i.push(`
          <section class="fix-month-card" data-month="${r}">
            <header>
              <button class="month-toggle" data-action="toggle" aria-expanded="${M?"false":"true"}">
                <span class="month-label">${V(r)}</span>
                <span class="badge info">Bezahlt: ${S(b)} €</span>
                <span class="badge warn">Offen: ${S(k)} €</span>
              </button>
              <div class="month-actions">
                <button class="btn" data-action="confirm-all" data-month="${r}">Alle offenen Fixkosten dieses Monats bestätigen</button>
                <button class="btn secondary" data-action="suppress-auto" data-month="${r}">Auto-Markierung ignorieren</button>
              </div>
            </header>
            <div class="month-body" ${M?"hidden":""}>
              ${L(d,r)}
            </div>
          </section>
        `)}),v.innerHTML=i.join(`
`)}function L(t,o,c){return t.length?`
      <table class="table fix-instance-table">
        <thead>
          <tr>
            <th>Position</th>
            <th>Kategorie</th>
            <th>Betrag (€)</th>
            <th>Fälligkeit</th>
            <th>Bezahlt</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${t.map(a=>A(a,o)).join("")}
        </tbody>
      </table>
    `:'<p class="muted">Keine Instanzen.</p>'}function A(t,o,c){var d;const a=D===t.id,i=t.autoPaid?`<span class="badge auto" title="${t.autoTooltip||"Wird am Fälligkeitstag automatisch als bezahlt markiert. Manuell änderbar."}">Auto</span>`:"",s=t.overrideActive?'<span class="badge override" title="Override aktiv">Override</span>':"",l=[t.notes,(d=t.override)==null?void 0:d.note].filter(Boolean).join(" · "),r=t.dueDateIso?O(t.dueDateIso):"–";return`
      <tr class="fix-instance" data-id="${t.id}" data-month="${o}">
        <td>
          <div class="instance-name">${t.label} ${i} ${s}</div>
          ${l?`<div class="instance-note muted">${l}</div>`:""}
        </td>
        <td>${t.category||"Sonstiges"}</td>
        <td>${S(t.amount)} €</td>
        <td>${r}</td>
        <td>
          <label class="checkbox">
            <input type="checkbox" data-action="toggle-paid" ${t.paid?"checked":""} aria-label="bezahlt" />
            <span class="sr-only">Bezahlt</span>
          </label>
        </td>
        <td class="actions">
          <button class="btn tertiary" data-action="edit" aria-expanded="${a?"true":"false"}">Bearbeiten</button>
          ${t.overrideActive?'<button class="btn" data-action="reset">Zurücksetzen</button>':""}
        </td>
      </tr>
      ${a?P(t):""}
    `}function P(t){var i,s,l;const o=(i=t.override)!=null&&i.amount&&t.override.amount.trim()!==""?t.override.amount:S(t.amount),c=(s=t.override)!=null&&s.dueDate?O(t.override.dueDate):t.dueDateIso?O(t.dueDateIso):"",a=((l=t.override)==null?void 0:l.note)||"";return`
      <tr class="fix-instance-edit" data-edit-for="${t.id}">
        <td colspan="6">
          <div class="fix-edit-grid">
            <label>
              Override Betrag (€)
              <input type="text" data-field="overrideAmount" value="${o}" inputmode="decimal" />
            </label>
            <label>
              Override Fälligkeit (TT.MM.JJJJ)
              <input type="text" data-field="overrideDue" value="${c}" placeholder="TT.MM.JJJJ" />
            </label>
            <label>
              Override Notiz
              <input type="text" data-field="overrideNote" value="${a}" />
            </label>
            <div class="edit-actions">
              <button class="btn primary" data-action="save-override">Speichern</button>
              <button class="btn" data-action="cancel-override">Abbrechen</button>
            </div>
            <div class="edit-error" aria-live="polite"></div>
          </div>
        </td>
      </tr>
    `}y(),p();function q(){const t=window.__routeQuery||{};if(!t.month)return;const o=n.querySelector(`.fix-month-card[data-month="${t.month}"]`);o&&(o.classList.add("row-focus"),o.scrollIntoView({block:"center",behavior:"smooth"}),window.__routeQuery={})}q(),g==null||g.addEventListener("click",()=>{e.fixcosts.push(Q(e)),E(e),y(),p(),window.dispatchEvent(new Event("state:changed"))}),u==null||u.addEventListener("change",t=>{const o=t.target.closest("tr.fix-master-row");if(!o)return;const c=o.dataset.id,a=e.fixcosts.find(s=>s.id===c);if(!a)return;const i=t.target.dataset.field;i&&(i==="category"||i==="frequency"||i==="anchor"||i==="startMonth"||i==="endMonth"?a[i]=t.target.value:i==="prorationMethod"?(a.proration||(a.proration={enabled:!0,method:t.target.value}),a.proration.method=t.target.value):i==="intervalMonths"&&(a.intervalMonths=Math.max(1,Number(t.target.value||1))),E(e),y(),p(),window.dispatchEvent(new Event("state:changed")))}),u==null||u.addEventListener("input",t=>{const o=t.target.closest("tr.fix-master-row");if(!o)return;const c=o.dataset.id,a=e.fixcosts.find(s=>s.id===c);if(!a)return;const i=t.target.dataset.field;if(i)if(i==="name"||i==="notes")a[i]=t.target.value;else if(i==="amount")a.amount=t.target.value;else if(i==="prorationEnabled"){const s=t.target.checked;a.proration||(a.proration={enabled:s,method:s?"daily":"none"}),a.proration.enabled=s,s||(a.proration.method="none"),y()}else i==="autoPaid"?a.autoPaid=t.target.checked:i==="frequency"&&(a.frequency=t.target.value)}),u==null||u.addEventListener("blur",t=>{const o=t.target.closest("tr.fix-master-row");if(!o)return;const c=o.dataset.id,a=e.fixcosts.find(s=>s.id===c);if(!a)return;if(t.target.dataset.field==="amount"){const s=S(t.target.value);a.amount=s,t.target.value=s}E(e),y(),p(),window.dispatchEvent(new Event("state:changed"))},!0),u==null||u.addEventListener("click",t=>{const o=t.target.closest("button[data-action]");if(!o)return;const c=o.closest("tr.fix-master-row"),a=c==null?void 0:c.dataset.id,i=e.fixcosts.findIndex(l=>l.id===a);if(i<0)return;const s=o.dataset.action;if(s==="delete"){if(confirm("Diese Fixkosten-Position wirklich löschen?")){const l=e.fixcosts.splice(i,1)[0];l&&l.id&&e.fixcostOverrides[l.id]&&delete e.fixcostOverrides[l.id],E(e),y(),p(),window.dispatchEvent(new Event("state:changed"))}}else if(s==="duplicate"){const l=structuredClone(e.fixcosts[i]);l.id=N(),l.name=`${l.name||"Fixkosten"} (Kopie)`,e.fixcosts.splice(i+1,0,l),E(e),y(),p(),window.dispatchEvent(new Event("state:changed"))}}),v==null||v.addEventListener("click",t=>{var b,k,M,x;const o=t.target.closest('button[data-action="toggle"]');if(o){const h=o.closest("section.fix-month-card"),m=h==null?void 0:h.dataset.month;if(!m)return;I.has(m)?I.delete(m):I.add(m),p();return}const c=t.target.closest("button[data-action]");if(!c)return;const a=c.dataset.action,i=c.closest("section.fix-month-card"),s=i==null?void 0:i.dataset.month;if(!s)return;if(a==="confirm-all"||a==="suppress-auto"){const h=w(e,{today:new Date}).filter(m=>m.month===s);if(a==="confirm-all"){const m=h.filter($=>!$.paid);if(!m.length)return;confirm(`Möchten Sie wirklich alle ${m.length} offenen Fixkosten als bezahlt markieren?`)&&(z(m.map($=>$.id),!0),window.dispatchEvent(new Event("state:changed")),p())}else if(a==="suppress-auto"){const m=h.filter($=>$.autoPaid);if(!m.length)return;confirm(`Automatische Markierung für ${m.length} Fixkosten deaktivieren?`)&&(z(m.map($=>$.id),!1),window.dispatchEvent(new Event("state:changed")),p())}return}const l=c.closest("tr.fix-instance");if(!l)return;const r=l.dataset.id,f=w(e,{today:new Date}).find(h=>h.id===r);if(f){if(a==="edit")D=D===r?null:r,p();else if(a==="reset")(k=(b=e.fixcostOverrides)==null?void 0:b[f.fixedCostId])!=null&&k[f.month]&&(delete e.fixcostOverrides[f.fixedCostId][f.month],Object.keys(e.fixcostOverrides[f.fixedCostId]).length||delete e.fixcostOverrides[f.fixedCostId],E(e),D=null,p(),window.dispatchEvent(new Event("state:changed")));else if(a==="toggle-paid"){const h=(M=c.closest("label"))==null?void 0:M.querySelector("input[type=checkbox]"),m=h==null?void 0:h.checked,$=f.dueDateIso?new Date(f.dueDateIso)<=new Date:!1,B=((x=e.status)==null?void 0:x.autoManualCheck)===!0,F=f.autoPaid===!0&&!B;F&&m===(F&&$)?j(f.id):J(f.id,m),window.dispatchEvent(new Event("state:changed")),p()}}}),v==null||v.addEventListener("change",t=>{t.target.matches("input[data-action='toggle-paid']")}),v==null||v.addEventListener("click",t=>{var c;const o=t.target.closest("button[data-action]");if(o&&(o.dataset.action==="save-override"||o.dataset.action==="cancel-override")){t.preventDefault();const a=o.closest("tr.fix-instance-edit"),i=a==null?void 0:a.previousElementSibling,s=i==null?void 0:i.dataset.id,r=w(e,{today:new Date}).find(m=>m.id===s);if(!r)return;if(o.dataset.action==="cancel-override"){D=null,p();return}const d=a.querySelector("input[data-field='overrideAmount']"),f=a.querySelector("input[data-field='overrideDue']"),b=a.querySelector("input[data-field='overrideNote']"),k=a.querySelector(".edit-error"),M=(d==null?void 0:d.value)||"",x=T(M);if(!(x>0)){k.textContent="Bitte Betrag > 0 eingeben.";return}const h=f!=null&&f.value?R(f.value):r.dueDateIso||"";if(f!=null&&f.value&&!h){k.textContent="Bitte TT.MM.JJJJ eingeben.";return}e.fixcostOverrides[r.fixedCostId]||(e.fixcostOverrides[r.fixedCostId]={}),e.fixcostOverrides[r.fixedCostId][r.month]={amount:S(x),dueDate:h,note:((c=b==null?void 0:b.value)==null?void 0:c.trim())||""},E(e),D=null,p(),window.dispatchEvent(new Event("state:changed"))}})}const et={render:G};export{et as default,G as render};
