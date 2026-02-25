import{g as z,l as _}from"./index-CLY33OwN.js";import{g as j}from"./orderEditorFactory-BWSWIhcr.js";import{f as L}from"./prefill-2pOzlWsL.js";import{b as Z}from"./paymentJournalCore-kSWYmCix.js";import"./store-BWFgPsBK.js";import"./dateUtils-D7NmXfd-.js";import"./shipping-9Dzo5wwm.js";import"./costing-CmZrILJ2.js";import"./deepEqual-CGWqzo0t.js";import"./useDraftForm-DoxDXph2.js";import"./productCompleteness-CNODPsSo.js";function t(n,e={},s=[]){const i=document.createElement(n);return Object.entries(e).forEach(([r,l])=>{r==="class"?i.className=l:r.startsWith("on")&&typeof l=="function"?i.addEventListener(r.slice(2),l):l!=null&&i.setAttribute(r,l)}),(Array.isArray(s)?s:[s]).forEach(r=>{r!=null&&i.append(r.nodeType?r:document.createTextNode(String(r)))}),i}function $(){const n=new Date;return`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`}function C(n){if(!n)return"—";const[e,s,i]=String(n).split("-").map(Number);if(!e||!s||!i)return"—";const r=new Date(Date.UTC(e,s-1,i));return Number.isNaN(r.getTime())?"—":r.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"})}function O(n){if(n==null||n==="")return"—";const e=Number(n);return Number.isFinite(e)?`${L(e,2)} EUR`:"—"}function b(n){if(n==null||n==="")return"";const e=Number(n);return Number.isFinite(e)?L(e,2):""}function B(n,e,s=";"){const i=c=>`"${(c==null?"":String(c)).replace(/"/g,'""')}"`,r=e.map(c=>i(c.label)).join(s),l=n.map(c=>e.map(m=>i(c[m.key])).join(s)).join(`
`);return`${r}
${l}`}function H(n,e){return n&&e?"both":e?"open":"paid"}function V(n,e){if(!Number.isFinite(Number(n)))return!1;const s=Number(n),i=Number.isFinite(Number(e))?Number(e):null;return s>0||s===0&&i!=null&&i===0}const W={DATE_UNCERTAIN:"Datum unsicher (Due-Date verwendet).",AUTO_GENERATED:"Auto generiert (bitte pruefen).",IST_FEHLT:"Ist fehlt (Plan als Fallback).",MISSING_ACTUAL_AMOUNT:"Ist-Zahlung fehlt.",PRO_RATA_ALLOCATION:"Ist wurde anteilig verteilt.",GROUPED_PAYMENT:"Mehrere Positionen in einer Zahlung.",PAID_WITHOUT_DATE:"Bezahlt ohne Datum."};function M(n=[]){const e=Array.from(new Set((Array.isArray(n)?n:[]).map(s=>W[String(s)]||String(s)).filter(Boolean)));return e.length?e.join(" "):"—"}function x(n){return n?n.status==="PAID"?n.paidDate||n.dueDate||"":n.dueDate||"":""}function G(n,{month:e="",scope:s="both"}={},i={}){const r=n&&typeof n=="object"?n:{},l=i.settings||j(),c=i.products||z();return Z({state:r,settings:l,products:c,month:e,scope:s,includeFo:!0})}function R({month:n,scope:e}){const s=_();return G(s,{month:n,scope:e})}function J(n){return n.map(e=>({paymentDate:x(e),status:e.status,entityType:e.entityType,poOrFoNumber:e.entityType==="PO"?e.poNumber||"":e.foNumber||"",supplierName:e.supplierName,item:e.itemSummary||e.skuAliases||"",includedPositions:e.paymentType||"",amountActualEur:e.status==="PAID"?b(e.amountActualEur):"",amountPlannedEur:b(e.amountPlannedEur),payer:e.payer||"",paymentMethod:e.paymentMethod||"",note:e.note||"",issues:Array.isArray(e.issues)?e.issues.join("|"):"",paymentId:e.paymentId||"",internalId:e.internalId||""}))}function F(n,e){return n.reduce((s,i)=>s+(Number(i[e])||0),0)}function K(n,{month:e,scope:s}){const i=window.open("","_blank","noopener,noreferrer");if(!i)return;const r=s==="paid"?"Paid":s==="open"?"Open":"Both",l=`Zahlungsjournal ${e||""}`.trim(),c=F(n.filter(o=>o.status==="PAID"),"amountActualEur"),m=F(n.filter(o=>o.status==="OPEN"),"amountPlannedEur"),N=n.map(o=>`
    <tr>
      <td>${x(o)||""}</td>
      <td>${o.status}</td>
      <td>${o.entityType==="PO"?o.poNumber||"":o.foNumber||""}</td>
      <td>${o.supplierName||""}</td>
      <td>${o.itemSummary||o.skuAliases||""}</td>
      <td>${o.paymentType||""}</td>
      <td>${o.status==="PAID"?b(o.amountActualEur):""}</td>
      <td>${b(o.amountPlannedEur)}</td>
      <td>${o.payer||""}</td>
      <td>${o.paymentMethod||""}</td>
      <td>${o.note||""}</td>
      <td>${M(o.issues)}</td>
    </tr>
  `).join(""),h=`<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <title>${l}</title>
  <style>
    body { font-family: "Inter", "Helvetica Neue", Arial, sans-serif; color: #0f1b2d; margin: 24px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .summary { margin-bottom: 12px; font-size: 12px; color: #6b7280; }
    .actions { margin-bottom: 16px; }
    .btn { background: #3bc2a7; color: #fff; border: none; padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #d7dde5; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f4f7fa; font-weight: 600; }
    .totals { margin-top: 12px; font-size: 12px; }
    @media print {
      body { margin: 12mm; }
      .actions { display: none; }
      @page { size: A4; margin: 12mm; }
    }
  </style>
</head>
<body>
  <h1>${l}</h1>
  <div class="summary">Scope: ${r} · Rows: ${n.length}</div>
  <div class="actions"><button class="btn" onclick="window.print()">Drucken / Als PDF speichern</button></div>
  <table>
    <thead>
      <tr>
        <th>Zahlungsdatum</th>
        <th>Status</th>
        <th>PO/FO Nr</th>
        <th>Supplier</th>
        <th>Item</th>
        <th>Positionen</th>
        <th>Ist EUR</th>
        <th>Plan EUR</th>
        <th>Zahler</th>
        <th>Methode</th>
        <th>Notiz</th>
        <th>Hinweise</th>
      </tr>
    </thead>
    <tbody>
      ${N}
    </tbody>
  </table>
  <div class="totals">
    <div>Sum Actual EUR (PAID): ${b(c)}</div>
    <div>Sum Planned EUR (OPEN): ${b(m)}</div>
  </div>
</body>
</html>`;i.document.open(),i.document.write(h),i.document.close()}function Y(n){const e=t("input",{type:"month",value:$()}),s=t("input",{type:"checkbox",checked:"checked"}),i=t("input",{type:"checkbox"}),r=[{value:"csv",label:"CSV"},{value:"print",label:"PDF (Print)"}];function l(u,d,a){const g=t("div",{class:"segment-control"});return d.forEach(p=>{const y=t("input",{type:"radio",name:u,value:p.value,id:`${u}-${p.value}`});p.value===a&&(y.checked=!0);const A=t("label",{for:`${u}-${p.value}`},[p.label]);g.append(y,A)}),g}const c=l("payment-format",r,"csv"),m=t("table",{class:"table-compact ui-table-standard ui-data-table payments-export-table","data-ui-table":"true","data-sticky-cols":"1"}),N=t("thead",{},[t("tr",{},[t("th",{},["Zahlungsdatum"]),t("th",{},["Status"]),t("th",{},["PO/FO Nr"]),t("th",{},["Lieferant"]),t("th",{},["Item"]),t("th",{},["Enthaltene Positionen"]),t("th",{class:"num"},["Ist EUR"]),t("th",{class:"num"},["Plan EUR"]),t("th",{},["Zahler"]),t("th",{},["Methode"]),t("th",{},["Notiz"]),t("th",{},["Hinweise"])])]),h=t("tbody");m.append(N,h);function o(){const u=c.querySelector("input:checked");return u?u.value:"csv"}function D(){const u=s.checked,d=i.checked;return H(u,d)}function f(){h.innerHTML="";const u=e.value||"",d=R({month:u,scope:D()});return d.length?(d.forEach(a=>{const g=x(a),p=V(a.amountActualEur,a.amountPlannedEur),y=a.status==="PAID"&&p?O(a.amountActualEur):"—",A=a.itemSummary||a.skuAliases||"—",T=M(a.issues),k=(Array.isArray(a.issues)?a.issues:[]).join(`
`),v=a.entityType==="PO"?a.poNumber||"—":a.foNumber||"—",E=a.status==="PAID"&&!p,P=E?"payments-export-row-warning":"";h.append(t("tr",{class:P},[t("td",{},[C(g)]),t("td",{},[a.status==="PAID"?"Bezahlt":"Offen"]),t("td",{},[v]),t("td",{},[a.supplierName||"—"]),t("td",{"data-ui-tooltip":a.itemTooltip||a.skuAliases||"—"},[A]),t("td",{"data-ui-tooltip":(Array.isArray(a.includedPositions)?a.includedPositions.join(", "):a.paymentType)||"—"},[a.paymentType||"—"]),t("td",{class:"num"},[y]),t("td",{class:"num"},[O(a.amountPlannedEur)]),t("td",{},[a.payer||"—"]),t("td",{},[a.paymentMethod||"—"]),t("td",{"data-ui-tooltip":a.note||"—"},[a.note||"—"]),t("td",{"data-ui-tooltip":k||"—"},[T,E?t("span",{class:"cell-warning",title:"Bezahlt, aber Ist-Zahlung fehlt."},["⚠︎"]):null])]))}),d):(h.append(t("tr",{},[t("td",{colspan:"12",class:"muted"},["Keine Zahlungen gefunden."])])),d)}const I=t("button",{class:"btn primary",type:"button"},["Export"]),S=t("button",{class:"btn secondary",type:"button"},["Preview"]),U=t("p",{class:"muted payments-export-info"},["Monatsfilter basiert auf Zahlungsdatum. Falls eine Zahlung als bezahlt markiert ist, aber kein Zahlungsdatum hat, wird die Faelligkeit als Datum verwendet und als unsicher markiert."]);I.addEventListener("click",()=>{const u=e.value||"",d=D(),a=R({month:u,scope:d});if(!a.length){window.alert("Keine passenden Zahlungen fuer den Export gefunden.");return}if(o()==="print"){K(a,{month:u,scope:d});return}const p=[{key:"paymentDate",label:"paymentDate"},{key:"status",label:"status"},{key:"entityType",label:"entityType"},{key:"poOrFoNumber",label:"poOrFoNumber"},{key:"supplierName",label:"supplierName"},{key:"item",label:"item"},{key:"includedPositions",label:"includedPositions"},{key:"amountActualEur",label:"amountActualEur"},{key:"amountPlannedEur",label:"amountPlannedEur"},{key:"payer",label:"payer"},{key:"paymentMethod",label:"paymentMethod"},{key:"note",label:"note"},{key:"issues",label:"issues"},{key:"paymentId",label:"paymentId"},{key:"internalId",label:"internalId"}],y=J(a),A=B(y,p,";"),k=`payment_journal_${u||$()}_${d}.csv`,v=new Blob([A],{type:"text/csv"}),E=URL.createObjectURL(v),P=t("a",{href:E,download:k});document.body.append(P),P.click(),P.remove(),URL.revokeObjectURL(E)}),S.addEventListener("click",()=>{f()}),e.addEventListener("change",f),s.addEventListener("change",f),i.addEventListener("change",f),n.innerHTML="",n.append(t("section",{class:"card"},[t("div",{class:"ui-page-head"},[t("div",{},[t("h2",{},["Payments Export"]),U])]),t("div",{class:"payments-export-toolbar"},[t("div",{class:"payments-export-filters"},[t("label",{class:"payments-export-field"},[t("span",{},["Monat (bezahlt)"]),e]),t("label",{class:"payments-export-field payments-export-check"},[t("span",{},["Filter"]),t("span",{class:"row"},[s,t("span",{},["Nur bezahlt"])])]),t("label",{class:"payments-export-field payments-export-check"},[t("span",{},["Ansicht"]),t("span",{class:"row"},[i,t("span",{},["Offen/geplant anzeigen"])])]),t("div",{class:"payments-export-field"},[t("span",{},["Format"]),c])]),t("div",{class:"payments-export-actions"},[I,S])]),t("div",{class:"table-wrap ui-table-shell ui-scroll-host payments-export-scroll"},[m])])),f()}const rt={render:Y};export{G as buildPaymentJournalRowsFromState,rt as default,Y as render};
