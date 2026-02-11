import{l as _,c as ee}from"./store-kRkpVkNt.js";import{p as y,br as se,v as te,bx as ne,u as ie,by as le}from"./index-LScGhqvu.js";import{p as ae}from"./dateUtils-D7NmXfd-.js";import{u as de}from"./useDraftForm-opmY9Ns9.js";const oe=["EUR","USD","CNY"];function r(e,a=document){return a.querySelector(e)}function g(e){const a=Number(e);return!Number.isFinite(a)||a<0?null:a}function S(e){const a=y(e);return a==null?"":se(a,2,{minimumFractionDigits:2,maximumFractionDigits:4,emptyValue:"",useGrouping:!1})}function ue(e,a){if(e.settings=e.settings||{},e.settings.transportLeadTimesDays=e.settings.transportLeadTimesDays||{air:10,rail:25,sea:45},Object.assign(e.settings.transportLeadTimesDays,a.transportLeadTimesDays||{}),typeof a.defaultBufferDays<"u"&&(e.settings.defaultBufferDays=a.defaultBufferDays),typeof a.defaultCurrency<"u"&&(e.settings.defaultCurrency=a.defaultCurrency),typeof a.fxRate<"u"&&(e.settings.fxRate=a.fxRate),typeof a.eurUsdRate<"u"&&(e.settings.eurUsdRate=a.eurUsdRate),typeof a.defaultProductionLeadTimeDays<"u"&&(e.settings.defaultProductionLeadTimeDays=a.defaultProductionLeadTimeDays),typeof a.defaultDdp<"u"&&(e.settings.defaultDdp=a.defaultDdp===!0),typeof a.safetyStockDohDefault<"u"&&(e.settings.safetyStockDohDefault=a.safetyStockDohDefault),typeof a.foCoverageDohDefault<"u"&&(e.settings.foCoverageDohDefault=a.foCoverageDohDefault),typeof a.moqDefaultUnits<"u"&&(e.settings.moqDefaultUnits=a.moqDefaultUnits),typeof a.monthAnchorDay<"u"){const u=String(a.monthAnchorDay||"START").toUpperCase();e.settings.monthAnchorDay=["START","MID","END"].includes(u)?u:"START"}a.cny&&typeof a.cny=="object"&&(e.settings.cny={start:a.cny.start||"",end:a.cny.end||""}),a.cnyBlackoutByYear&&typeof a.cnyBlackoutByYear=="object"&&(e.settings.cnyBlackoutByYear=e.settings.cnyBlackoutByYear||{},Object.entries(a.cnyBlackoutByYear).forEach(([u,o])=>{o&&o.start&&o.end?e.settings.cnyBlackoutByYear[String(u)]={start:o.start,end:o.end}:delete e.settings.cnyBlackoutByYear[String(u)]})),e.settings.lastUpdatedAt=new Date().toISOString()}function ce(e){var j,W,z,G;const a=_(),u=a.settings||{},o=de(u,{key:"settings",enableDraftCache:!1}),E=u.transportLeadTimesDays||{air:10,rail:25,sea:45},s={air:"",rail:"",sea:"",buffer:"",fxRate:"",eurUsdRate:"",defaultProductionLeadTime:"",cny:"",safetyStockDohDefault:"",foCoverageDohDefault:"",moqDefaultUnits:""};e.innerHTML=`
    <section class="card">
      <h2>Settings</h2>
      <div class="table-card-header">
        <span class="muted">Eigenschaften</span>
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
      <div class="table-wrap">
        <table class="table" id="category-table">
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
  `,r("#default-currency",e).value=o.draft.defaultCurrency||"EUR";const C=r("#default-month-anchor",e);C&&(C.value=o.draft.monthAnchorDay||"START");const h=r("#cny-start",e),D=r("#cny-end",e);h&&(h.value=((W=(j=o.draft)==null?void 0:j.cny)==null?void 0:W.start)||""),D&&(D.value=((G=(z=o.draft)==null?void 0:z.cny)==null?void 0:G.end)||"");const x=ie(()=>o.isDirty,"Ungespeicherte Änderungen verwerfen?");x.register(),x.attachBeforeUnload();function B(){const t=r("#settings-save",e);t&&(t.disabled=!o.isDirty)}function A(){const t=v();if(!t)return;const l=r("#default-production-lead",e),n=r("#default-ddp",e);o.setDraft({transportLeadTimesDays:{air:t.air,rail:t.rail,sea:t.sea},defaultBufferDays:t.buffer,defaultCurrency:(r("#default-currency",e).value||"EUR").trim()||"EUR",fxRate:S(t.fxRate),eurUsdRate:S(t.eurUsdRate),safetyStockDohDefault:t.safetyStockDohDefault,foCoverageDohDefault:t.foCoverageDohDefault,moqDefaultUnits:t.moqDefaultUnits,monthAnchorDay:C?C.value:o.draft.monthAnchorDay,defaultProductionLeadTimeDays:l?t.defaultProductionLead:o.draft.defaultProductionLeadTimeDays,defaultDdp:n?n.checked:o.draft.defaultDdp,cny:{start:h?h.value:"",end:D?D.value:""}}),B()}function O(){const t=le(a.settings||{}),l=new Map;t.forEach(i=>l.set(i.field,i)),[{field:"transportLeadTimesDays.air",id:"#lead-air-health"},{field:"transportLeadTimesDays.rail",id:"#lead-rail-health"},{field:"transportLeadTimesDays.sea",id:"#lead-sea-health"},{field:"defaultCurrency",id:"#default-currency-health"},{field:"fxRate",id:"#fx-rate-health"},{field:"eurUsdRate",id:"#eur-usd-rate-health"}].forEach(({field:i,id:d})=>{var b;const m=r(d,e);m&&(m.textContent=((b=l.get(i))==null?void 0:b.message)||"")})}function P(){const t=r("#health-list",e),{issues:l}=te({settings:a.settings,products:a.products,suppliers:a.suppliers});if(!l.length){t.innerHTML='<p class="muted">Keine Issues gefunden.</p>';return}t.innerHTML=l.map(n=>`
        <div class="health-item">
          <span>${n.message}</span>
          <button class="btn secondary" data-action="fix" data-issue="${n.id}">Go to</button>
        </div>
      `).join("")}function v(){var Z;s.air="",s.rail="",s.sea="",s.buffer="",s.fxRate="",s.eurUsdRate="",s.defaultProductionLeadTime="",s.safetyStockDohDefault="",s.foCoverageDohDefault="",s.moqDefaultUnits="";const t=g(r("#lead-air",e).value),l=g(r("#lead-rail",e).value),n=g(r("#lead-sea",e).value),i=g(r("#default-buffer",e).value),d=y(r("#default-fx-rate",e).value),m=y(r("#default-eur-usd-rate",e).value),b=g(r("#default-safety-stock",e).value),w=g(r("#default-fo-coverage",e).value),I=g(r("#default-moq-units",e).value),N=((Z=r("#default-month-anchor",e))==null?void 0:Z.value)||"START",q=["START","MID","END"].includes(N)?N:"START",p=r("#default-production-lead",e),c=p?y(p.value):null,$=c==null?null:Math.max(0,Math.round(c)),f=h?h.value:"",M=D?D.value:"",V=ae(f),X=ae(M);t==null&&(s.air="Wert muss ≥ 0 sein."),l==null&&(s.rail="Wert muss ≥ 0 sein."),n==null&&(s.sea="Wert muss ≥ 0 sein."),i==null&&(s.buffer="Wert muss ≥ 0 sein."),(d==null||d<=0)&&(s.fxRate="Wert muss > 0 sein."),(m==null||m<=0)&&(s.eurUsdRate="Wert muss > 0 sein."),b==null&&(s.safetyStockDohDefault="Wert muss ≥ 0 sein."),w==null&&(s.foCoverageDohDefault="Wert muss ≥ 0 sein."),I==null&&(s.moqDefaultUnits="Wert muss ≥ 0 sein."),f&&!M||!f&&M?s.cny="Bitte Start und Ende setzen.":V&&X&&V>X?s.cny="Start darf nicht nach Ende liegen.":s.cny="",r("#lead-air-error",e).textContent=s.air,r("#lead-rail-error",e).textContent=s.rail,r("#lead-sea-error",e).textContent=s.sea,r("#buffer-error",e).textContent=s.buffer,r("#fx-rate-error",e).textContent=s.fxRate,r("#eur-usd-rate-error",e).textContent=s.eurUsdRate,r("#safety-stock-error",e).textContent=s.safetyStockDohDefault,r("#fo-coverage-error",e).textContent=s.foCoverageDohDefault,r("#moq-default-error",e).textContent=s.moqDefaultUnits;const J=r("#cny-error",e);J&&(J.textContent=s.cny);const Q=r("#default-production-lead-error",e);return Q&&(Q.textContent=s.defaultProductionLeadTime),{air:t,rail:l,sea:n,buffer:i,fxRate:d,eurUsdRate:m,safetyStockDohDefault:b,foCoverageDohDefault:w,moqDefaultUnits:I,monthAnchorDay:q,defaultProductionLead:$,ok:!s.air&&!s.rail&&!s.sea&&!s.buffer&&!s.fxRate&&!s.eurUsdRate&&!s.defaultProductionLeadTime&&!s.cny&&!s.safetyStockDohDefault&&!s.foCoverageDohDefault&&!s.moqDefaultUnits}}r("#settings-save",e).addEventListener("click",async()=>{const{air:t,rail:l,sea:n,buffer:i,fxRate:d,eurUsdRate:m,safetyStockDohDefault:b,foCoverageDohDefault:w,moqDefaultUnits:I,defaultProductionLead:N,ok:q}=v();if(!q)return;A();const p=r("#settings-save",e);p&&(p.disabled=!0,p.textContent="Speichern…"),await o.commit($=>{const f=_();ue(f,$),ee(f,{source:"settings:save",entityKey:"settings",action:"update"}),a.settings=f.settings,a.products=f.products,a.suppliers=f.suppliers,a.productCategories=f.productCategories}),p&&(p.textContent="Speichern");let c=document.getElementById("settings-toast");c||(c=document.createElement("div"),c.id="settings-toast",c.className="po-toast",document.body.appendChild(c)),c.textContent="Gespeichert",c.hidden=!1,setTimeout(()=>{c.hidden=!0},2e3),O(),P(),B()}),e.querySelectorAll("input[type=number]").forEach(t=>{t.addEventListener("blur",v)});const T=r("#default-fx-rate",e);T&&T.addEventListener("blur",()=>{const t=y(T.value);T.value=t?S(t):"",v()});const R=r("#default-eur-usd-rate",e);R&&R.addEventListener("blur",()=>{const t=y(R.value);R.value=t?S(t):"",v()});const L=r("#default-production-lead",e);L&&L.addEventListener("blur",()=>{const t=y(L.value);L.value=t==null?"":se(t,0,{emptyValue:""}),v()}),e.addEventListener("input",t=>{t.target.closest("#settings-save")||A()}),e.addEventListener("change",t=>{t.target.closest("#settings-save")||A()}),e.addEventListener("click",t=>{const l=t.target.closest("button[data-action='fix']");if(!l)return;const n=l.dataset.issue,{issues:i}=te({settings:a.settings,products:a.products,suppliers:a.suppliers}),d=i.find(m=>m.id===n);d&&ne(d)}),O(),P();const F=sessionStorage.getItem("healthFocus");if(F){try{const t=JSON.parse(F);if((t==null?void 0:t.tab)==="settings"&&t.field){const n=r({fxRate:"#default-fx-rate",eurUsdRate:"#default-eur-usd-rate",defaultCurrency:"#default-currency","transportLeadTimesDays.air":"#lead-air","transportLeadTimesDays.rail":"#lead-rail","transportLeadTimesDays.sea":"#lead-sea"}[t.field],e);n&&(n.focus(),n.scrollIntoView({block:"center"}))}}catch{}sessionStorage.removeItem("healthFocus")}const k=r("#category-table",e),H=r("#category-name",e),K=r("#category-add",e);function re(t,l){const n=Number(t.sortOrder??0),i=Number(l.sortOrder??0);return n!==i?n-i:String(t.name||"").localeCompare(String(l.name||""))}function Y(){const t=k.querySelector("tbody"),l=Array.isArray(a.productCategories)?a.productCategories:[],n=new Map;if((a.products||[]).forEach(i=>{const d=i.categoryId||"";n.set(d,(n.get(d)||0)+1)}),!l.length){t.innerHTML='<tr><td colspan="4" class="muted">Keine Kategorien vorhanden.</td></tr>';return}t.innerHTML=l.slice().sort(re).map(i=>`
        <tr data-id="${i.id}">
          <td><input type="text" data-action="name" value="${i.name||""}" /></td>
          <td class="num"><input type="number" data-action="order" value="${i.sortOrder??0}" /></td>
          <td class="num">${n.get(i.id)||0}</td>
          <td><button class="btn danger" type="button" data-action="delete">Löschen</button></td>
        </tr>
      `).join("")}function U(){ee(a,{source:"settings:categories",entityKey:"settings",action:"update"}),Y()}return K&&K.addEventListener("click",()=>{const t=H.value.trim();if(!t){window.alert("Name ist erforderlich.");return}if((a.productCategories||[]).some(i=>String(i.name||"").trim().toLowerCase()===t.toLowerCase())){window.alert("Kategorie existiert bereits.");return}const n=new Date().toISOString();a.productCategories=a.productCategories||[],a.productCategories.push({id:`cat-${Math.random().toString(36).slice(2,9)}`,name:t,sortOrder:a.productCategories.length,createdAt:n,updatedAt:n}),H.value="",U()}),k&&(k.addEventListener("change",t=>{const l=t.target.closest("tr[data-id]");if(!l)return;const n=(a.productCategories||[]).find(i=>i.id===l.dataset.id);if(n){if(t.target.dataset.action==="name"){const i=t.target.value.trim();if(!i){t.target.value=n.name||"";return}n.name=i,n.updatedAt=new Date().toISOString(),U()}if(t.target.dataset.action==="order"){const i=Number(t.target.value||0);n.sortOrder=Number.isFinite(i)?i:0,n.updatedAt=new Date().toISOString(),U()}}}),k.addEventListener("click",t=>{const l=t.target.closest("tr[data-id]");if(!l||t.target.dataset.action!=="delete")return;const n=l.dataset.id;window.confirm("Kategorie wirklich löschen?")&&(a.productCategories=(a.productCategories||[]).filter(d=>d.id!==n),a.products=(a.products||[]).map(d=>d.categoryId!==n?d:{...d,categoryId:null}),U())})),Y(),B(),{cleanup:()=>{x.unregister(),x.detachBeforeUnload()}}}const ye={render:ce};export{ye as default,ce as render};
