import{l as _,c as ee}from"./store-4yGKN6XZ.js";import{p as y,w as se,v as te,C as re,u as ie,D as le}from"./index-CafJOI4c.js";import{p as ae}from"./dateUtils-D7NmXfd-.js";import{u as de}from"./useDraftForm-COq0PQjK.js";import"./deepEqual-CGWqzo0t.js";const oe=["EUR","USD","CNY"];function n(e,a=document){return a.querySelector(e)}function g(e){const a=Number(e);return!Number.isFinite(a)||a<0?null:a}function S(e){const a=y(e);return a==null?"":se(a,2,{minimumFractionDigits:2,maximumFractionDigits:4,emptyValue:"",useGrouping:!1})}function ue(e,a){if(e.settings=e.settings||{},e.settings.transportLeadTimesDays=e.settings.transportLeadTimesDays||{air:10,rail:25,sea:45},Object.assign(e.settings.transportLeadTimesDays,a.transportLeadTimesDays||{}),typeof a.defaultBufferDays<"u"&&(e.settings.defaultBufferDays=a.defaultBufferDays),typeof a.defaultCurrency<"u"&&(e.settings.defaultCurrency=a.defaultCurrency),typeof a.fxRate<"u"&&(e.settings.fxRate=a.fxRate),typeof a.eurUsdRate<"u"&&(e.settings.eurUsdRate=a.eurUsdRate),typeof a.defaultProductionLeadTimeDays<"u"&&(e.settings.defaultProductionLeadTimeDays=a.defaultProductionLeadTimeDays),typeof a.defaultDdp<"u"&&(e.settings.defaultDdp=a.defaultDdp===!0),typeof a.safetyStockDohDefault<"u"&&(e.settings.safetyStockDohDefault=a.safetyStockDohDefault),typeof a.foCoverageDohDefault<"u"&&(e.settings.foCoverageDohDefault=a.foCoverageDohDefault),typeof a.moqDefaultUnits<"u"&&(e.settings.moqDefaultUnits=a.moqDefaultUnits),typeof a.monthAnchorDay<"u"){const u=String(a.monthAnchorDay||"START").toUpperCase();e.settings.monthAnchorDay=["START","MID","END"].includes(u)?u:"START"}a.cny&&typeof a.cny=="object"&&(e.settings.cny={start:a.cny.start||"",end:a.cny.end||""}),a.cnyBlackoutByYear&&typeof a.cnyBlackoutByYear=="object"&&(e.settings.cnyBlackoutByYear=e.settings.cnyBlackoutByYear||{},Object.entries(a.cnyBlackoutByYear).forEach(([u,o])=>{o&&o.start&&o.end?e.settings.cnyBlackoutByYear[String(u)]={start:o.start,end:o.end}:delete e.settings.cnyBlackoutByYear[String(u)]})),e.settings.lastUpdatedAt=new Date().toISOString()}function ce(e){var j,W,z,G;const a=_(),u=a.settings||{},o=de(u,{key:"settings",enableDraftCache:!1}),E=u.transportLeadTimesDays||{air:10,rail:25,sea:45},s={air:"",rail:"",sea:"",buffer:"",fxRate:"",eurUsdRate:"",defaultProductionLeadTime:"",cny:"",safetyStockDohDefault:"",foCoverageDohDefault:"",moqDefaultUnits:""};e.innerHTML=`
    <section class="card">
      <div class="ui-page-head">
        <div>
          <h2>Settings</h2>
          <span class="muted">Eigenschaften</span>
        </div>
        <button class="btn primary" id="settings-save" disabled>Speichern</button>
      </div>
    </section>

    <section class="card">
      <h3>Transport Lead Times (days)</h3>
      <div class="grid three">
        <label>
          Air (days)
          <input id="lead-air" type="number" min="0" step="1" value="${E.air??10}">
          <small class="form-error" id="lead-air-error"></small>
          <small class="health-hint" id="lead-air-health"></small>
        </label>
        <label>
          Rail (days)
          <input id="lead-rail" type="number" min="0" step="1" value="${E.rail??25}">
          <small class="form-error" id="lead-rail-error"></small>
          <small class="health-hint" id="lead-rail-health"></small>
        </label>
        <label>
          Sea (days)
          <input id="lead-sea" type="number" min="0" step="1" value="${E.sea??45}">
          <small class="form-error" id="lead-sea-error"></small>
          <small class="health-hint" id="lead-sea-health"></small>
        </label>
      </div>
    </section>

    <section class="card">
      <h3>Defaults</h3>
      <div class="grid two">
        <label>
          Buffer days
          <input id="default-buffer" type="number" min="0" step="1" value="${u.defaultBufferDays??0}">
          <small class="form-error" id="buffer-error"></small>
        </label>
        <label>
          Currency
          <select id="default-currency">
            ${oe.map(t=>`<option value="${t}">${t}</option>`).join("")}
          </select>
          <small class="health-hint" id="default-currency-health"></small>
        </label>
      </div>
      <div class="grid two" style="margin-top: 12px;">
        <label>
          FX-Kurs (USD je EUR)
          <input id="default-fx-rate" type="text" inputmode="decimal" placeholder="z. B. 1,08" value="${S(u.fxRate)}">
          <small class="form-error" id="fx-rate-error"></small>
          <small class="health-hint" id="fx-rate-health"></small>
        </label>
        <label>
          FX-Kurs (EUR je USD)
          <input id="default-eur-usd-rate" type="text" inputmode="decimal" placeholder="z. B. 0,92" value="${S(u.eurUsdRate)}">
          <small class="form-error" id="eur-usd-rate-error"></small>
          <small class="health-hint" id="eur-usd-rate-health"></small>
        </label>
      </div>
    </section>

    <section class="card">
      <h3>Inventory Planning Defaults</h3>
      <div class="grid three">
        <label>
          Safety Stock DOH (Tage)
          <input id="default-safety-stock" type="number" min="0" step="1" value="${u.safetyStockDohDefault??60}">
          <small class="form-error" id="safety-stock-error"></small>
        </label>
        <label>
          FO Coverage DOH (Tage)
          <input id="default-fo-coverage" type="number" min="0" step="1" value="${u.foCoverageDohDefault??90}">
          <small class="form-error" id="fo-coverage-error"></small>
        </label>
        <label>
          MOQ Default (Einheiten)
          <input id="default-moq-units" type="number" min="0" step="1" value="${u.moqDefaultUnits??500}">
          <small class="form-error" id="moq-default-error"></small>
        </label>
      </div>
      <div class="grid two" style="margin-top: 12px;">
        <label>
          Monats-Anker (Default)
          <select id="default-month-anchor">
            <option value="START">Start (1. Tag)</option>
            <option value="MID">Mitte (15. Tag)</option>
            <option value="END">Ende (letzter Tag)</option>
          </select>
        </label>
      </div>
    </section>

    <section class="card">
      <h3>CNY Blackout</h3>
      <p class="muted">Produktionspause rund um das chinesische Neujahr. Gilt für die Terminberechnung.</p>
      <div class="grid two">
        <label>
          CNY Start
          <input id="cny-start" type="date" />
          <small class="form-error" id="cny-error"></small>
        </label>
        <label>
          CNY Ende
          <input id="cny-end" type="date" />
        </label>
      </div>
    </section>

    <section class="card" id="settings-categories">
      <h3>Produktkategorien</h3>
      <div class="table-card-header">
        <span class="muted">Kategorien verwalten</span>
        <div class="category-controls">
          <input id="category-name" type="text" placeholder="Neue Kategorie" />
          <button class="btn secondary" id="category-add">Hinzufügen</button>
        </div>
      </div>
      <div class="table-wrap ui-table-shell ui-scroll-host">
        <table class="table ui-table-standard" id="category-table">
          <thead>
            <tr>
              <th>Name</th>
              <th class="num">Sortierung</th>
              <th class="num">Produkte</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </section>

    <section class="card" id="settings-health">
      <h3>Data Health</h3>
      <p class="muted">Schnell-Checks für fehlende Stammdaten und Defaults.</p>
      <div class="health-list" id="health-list"></div>
    </section>
  `,n("#default-currency",e).value=o.draft.defaultCurrency||"EUR";const C=n("#default-month-anchor",e);C&&(C.value=o.draft.monthAnchorDay||"START");const h=n("#cny-start",e),D=n("#cny-end",e);h&&(h.value=((W=(j=o.draft)==null?void 0:j.cny)==null?void 0:W.start)||""),D&&(D.value=((G=(z=o.draft)==null?void 0:z.cny)==null?void 0:G.end)||"");const x=ie(()=>o.isDirty,"Ungespeicherte Änderungen verwerfen?");x.register(),x.attachBeforeUnload();function B(){const t=n("#settings-save",e);t&&(t.disabled=!o.isDirty)}function w(){const t=v();if(!t)return;const l=n("#default-production-lead",e),r=n("#default-ddp",e);o.setDraft({transportLeadTimesDays:{air:t.air,rail:t.rail,sea:t.sea},defaultBufferDays:t.buffer,defaultCurrency:(n("#default-currency",e).value||"EUR").trim()||"EUR",fxRate:S(t.fxRate),eurUsdRate:S(t.eurUsdRate),safetyStockDohDefault:t.safetyStockDohDefault,foCoverageDohDefault:t.foCoverageDohDefault,moqDefaultUnits:t.moqDefaultUnits,monthAnchorDay:C?C.value:o.draft.monthAnchorDay,defaultProductionLeadTimeDays:l?t.defaultProductionLead:o.draft.defaultProductionLeadTimeDays,defaultDdp:r?r.checked:o.draft.defaultDdp,cny:{start:h?h.value:"",end:D?D.value:""}}),B()}function O(){const t=le(a.settings||{}),l=new Map;t.forEach(i=>l.set(i.field,i)),[{field:"transportLeadTimesDays.air",id:"#lead-air-health"},{field:"transportLeadTimesDays.rail",id:"#lead-rail-health"},{field:"transportLeadTimesDays.sea",id:"#lead-sea-health"},{field:"defaultCurrency",id:"#default-currency-health"},{field:"fxRate",id:"#fx-rate-health"},{field:"eurUsdRate",id:"#eur-usd-rate-health"}].forEach(({field:i,id:d})=>{var b;const m=n(d,e);m&&(m.textContent=((b=l.get(i))==null?void 0:b.message)||"")})}function P(){const t=n("#health-list",e),{issues:l}=te({settings:a.settings,products:a.products,suppliers:a.suppliers});if(!l.length){t.innerHTML='<p class="muted">Keine Issues gefunden.</p>';return}t.innerHTML=l.map(r=>`
        <div class="health-item">
          <span>${r.message}</span>
          <button class="btn secondary" data-action="fix" data-issue="${r.id}">Go to</button>
        </div>
      `).join("")}function v(){var Z;s.air="",s.rail="",s.sea="",s.buffer="",s.fxRate="",s.eurUsdRate="",s.defaultProductionLeadTime="",s.safetyStockDohDefault="",s.foCoverageDohDefault="",s.moqDefaultUnits="";const t=g(n("#lead-air",e).value),l=g(n("#lead-rail",e).value),r=g(n("#lead-sea",e).value),i=g(n("#default-buffer",e).value),d=y(n("#default-fx-rate",e).value),m=y(n("#default-eur-usd-rate",e).value),b=g(n("#default-safety-stock",e).value),A=g(n("#default-fo-coverage",e).value),I=g(n("#default-moq-units",e).value),N=((Z=n("#default-month-anchor",e))==null?void 0:Z.value)||"START",q=["START","MID","END"].includes(N)?N:"START",p=n("#default-production-lead",e),c=p?y(p.value):null,$=c==null?null:Math.max(0,Math.round(c)),f=h?h.value:"",M=D?D.value:"",V=ae(f),X=ae(M);t==null&&(s.air="Wert muss ≥ 0 sein."),l==null&&(s.rail="Wert muss ≥ 0 sein."),r==null&&(s.sea="Wert muss ≥ 0 sein."),i==null&&(s.buffer="Wert muss ≥ 0 sein."),(d==null||d<=0)&&(s.fxRate="Wert muss > 0 sein."),(m==null||m<=0)&&(s.eurUsdRate="Wert muss > 0 sein."),b==null&&(s.safetyStockDohDefault="Wert muss ≥ 0 sein."),A==null&&(s.foCoverageDohDefault="Wert muss ≥ 0 sein."),I==null&&(s.moqDefaultUnits="Wert muss ≥ 0 sein."),f&&!M||!f&&M?s.cny="Bitte Start und Ende setzen.":V&&X&&V>X?s.cny="Start darf nicht nach Ende liegen.":s.cny="",n("#lead-air-error",e).textContent=s.air,n("#lead-rail-error",e).textContent=s.rail,n("#lead-sea-error",e).textContent=s.sea,n("#buffer-error",e).textContent=s.buffer,n("#fx-rate-error",e).textContent=s.fxRate,n("#eur-usd-rate-error",e).textContent=s.eurUsdRate,n("#safety-stock-error",e).textContent=s.safetyStockDohDefault,n("#fo-coverage-error",e).textContent=s.foCoverageDohDefault,n("#moq-default-error",e).textContent=s.moqDefaultUnits;const J=n("#cny-error",e);J&&(J.textContent=s.cny);const Q=n("#default-production-lead-error",e);return Q&&(Q.textContent=s.defaultProductionLeadTime),{air:t,rail:l,sea:r,buffer:i,fxRate:d,eurUsdRate:m,safetyStockDohDefault:b,foCoverageDohDefault:A,moqDefaultUnits:I,monthAnchorDay:q,defaultProductionLead:$,ok:!s.air&&!s.rail&&!s.sea&&!s.buffer&&!s.fxRate&&!s.eurUsdRate&&!s.defaultProductionLeadTime&&!s.cny&&!s.safetyStockDohDefault&&!s.foCoverageDohDefault&&!s.moqDefaultUnits}}n("#settings-save",e).addEventListener("click",async()=>{const{air:t,rail:l,sea:r,buffer:i,fxRate:d,eurUsdRate:m,safetyStockDohDefault:b,foCoverageDohDefault:A,moqDefaultUnits:I,defaultProductionLead:N,ok:q}=v();if(!q)return;w();const p=n("#settings-save",e);p&&(p.disabled=!0,p.textContent="Speichern…"),await o.commit($=>{const f=_();ue(f,$),ee(f,{source:"settings:save",entityKey:"settings",action:"update"}),a.settings=f.settings,a.products=f.products,a.suppliers=f.suppliers,a.productCategories=f.productCategories}),p&&(p.textContent="Speichern");let c=document.getElementById("settings-toast");c||(c=document.createElement("div"),c.id="settings-toast",c.className="po-toast",document.body.appendChild(c)),c.textContent="Gespeichert",c.hidden=!1,setTimeout(()=>{c.hidden=!0},2e3),O(),P(),B()}),e.querySelectorAll("input[type=number]").forEach(t=>{t.addEventListener("blur",v)});const T=n("#default-fx-rate",e);T&&T.addEventListener("blur",()=>{const t=y(T.value);T.value=t?S(t):"",v()});const R=n("#default-eur-usd-rate",e);R&&R.addEventListener("blur",()=>{const t=y(R.value);R.value=t?S(t):"",v()});const L=n("#default-production-lead",e);L&&L.addEventListener("blur",()=>{const t=y(L.value);L.value=t==null?"":se(t,0,{emptyValue:""}),v()}),e.addEventListener("input",t=>{t.target.closest("#settings-save")||w()}),e.addEventListener("change",t=>{t.target.closest("#settings-save")||w()}),e.addEventListener("click",t=>{const l=t.target.closest("button[data-action='fix']");if(!l)return;const r=l.dataset.issue,{issues:i}=te({settings:a.settings,products:a.products,suppliers:a.suppliers}),d=i.find(m=>m.id===r);d&&re(d)}),O(),P();const F=sessionStorage.getItem("healthFocus");if(F){try{const t=JSON.parse(F);if((t==null?void 0:t.tab)==="settings"&&t.field){const r=n({fxRate:"#default-fx-rate",eurUsdRate:"#default-eur-usd-rate",defaultCurrency:"#default-currency","transportLeadTimesDays.air":"#lead-air","transportLeadTimesDays.rail":"#lead-rail","transportLeadTimesDays.sea":"#lead-sea"}[t.field],e);r&&(r.focus(),r.scrollIntoView({block:"center"}))}}catch{}sessionStorage.removeItem("healthFocus")}const k=n("#category-table",e),H=n("#category-name",e),K=n("#category-add",e);function ne(t,l){const r=Number(t.sortOrder??0),i=Number(l.sortOrder??0);return r!==i?r-i:String(t.name||"").localeCompare(String(l.name||""))}function Y(){const t=k.querySelector("tbody"),l=Array.isArray(a.productCategories)?a.productCategories:[],r=new Map;if((a.products||[]).forEach(i=>{const d=i.categoryId||"";r.set(d,(r.get(d)||0)+1)}),!l.length){t.innerHTML='<tr><td colspan="4" class="muted">Keine Kategorien vorhanden.</td></tr>';return}t.innerHTML=l.slice().sort(ne).map(i=>`
        <tr data-id="${i.id}">
          <td><input type="text" data-action="name" value="${i.name||""}" /></td>
          <td class="num"><input type="number" data-action="order" value="${i.sortOrder??0}" /></td>
          <td class="num">${r.get(i.id)||0}</td>
          <td><button class="btn danger" type="button" data-action="delete">Löschen</button></td>
        </tr>
      `).join("")}function U(){ee(a,{source:"settings:categories",entityKey:"settings",action:"update"}),Y()}return K&&K.addEventListener("click",()=>{const t=H.value.trim();if(!t){window.alert("Name ist erforderlich.");return}if((a.productCategories||[]).some(i=>String(i.name||"").trim().toLowerCase()===t.toLowerCase())){window.alert("Kategorie existiert bereits.");return}const r=new Date().toISOString();a.productCategories=a.productCategories||[],a.productCategories.push({id:`cat-${Math.random().toString(36).slice(2,9)}`,name:t,sortOrder:a.productCategories.length,createdAt:r,updatedAt:r}),H.value="",U()}),k&&(k.addEventListener("change",t=>{const l=t.target.closest("tr[data-id]");if(!l)return;const r=(a.productCategories||[]).find(i=>i.id===l.dataset.id);if(r){if(t.target.dataset.action==="name"){const i=t.target.value.trim();if(!i){t.target.value=r.name||"";return}r.name=i,r.updatedAt=new Date().toISOString(),U()}if(t.target.dataset.action==="order"){const i=Number(t.target.value||0);r.sortOrder=Number.isFinite(i)?i:0,r.updatedAt=new Date().toISOString(),U()}}}),k.addEventListener("click",t=>{const l=t.target.closest("tr[data-id]");if(!l||t.target.dataset.action!=="delete")return;const r=l.dataset.id;window.confirm("Kategorie wirklich löschen?")&&(a.productCategories=(a.productCategories||[]).filter(d=>d.id!==r),a.products=(a.products||[]).map(d=>d.categoryId!==r?d:{...d,categoryId:null}),U())})),Y(),B(),{cleanup:()=>{x.unregister(),x.detachBeforeUnload()}}}const he={render:ce};export{he as default,ce as render};
