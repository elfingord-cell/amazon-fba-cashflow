import{a as Ve,e as Te,p as B,c as Fe}from"./index-CSdF_GtT.js";import{l as ze,s as Ke,g as Ue,a as je}from"./store-WpAAMSGl.js";import{g as Ge,b as He}from"./orderEditorFactory-CNETt9wW.js";import{g as Ce,c as ke,a as Re,D as qe,b as _e}from"./abcClassification-B2msjJH5.js";import{c as We}from"./inventoryProjection-CDxZa4co.js";import"./prefill-DuaqvOWK.js";import"./productCompleteness-CNODPsSo.js";import"./costing-CmZrILJ2.js";import"./dateUtils-D7NmXfd-.js";import"./shipping-9Dzo5wwm.js";import"./deepEqual-CGWqzo0t.js";import"./useDraftForm-CPyOfExP.js";const Le="dashboard_month_range",be="NEXT_6",we=qe,Ze="inventory_view_v1";function $e(e){return we.some(n=>n.value===e)}function Ye(){const e=Ue(Le,be);return $e(e)?e:be}const M={expanded:new Set(["inflows","outflows","po-payments","fo-payments"]),coverageCollapsed:new Set,range:Ye(),hideEmptyMonths:!0,limitBalanceToGreen:!1},_={full:.95,wide:.8,partial:.5},oe={green:{label:"Vollständig",detail:"Mindestens 95% der aktiven SKUs sind abgedeckt."},light:{label:"Weitgehend",detail:"80–94% der aktiven SKUs sind abgedeckt."},orange:{label:"Teilweise",detail:"50–79% der aktiven SKUs sind abgedeckt."},red:{label:"Unzureichend",detail:"Unter 50% Abdeckung oder kritische Grundlagen fehlen."},gray:{label:"Keine Daten",detail:"Keine aktiven Produkte vorhanden."}},Je={},fe=50;function S(e){return String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function Ee(e,n){return e??n}function me(e){if(e==null)return"—";const n=Number(e);if(!Number.isFinite(n))return"—";const a=Math.round(n);return`${new Intl.NumberFormat("de-DE",{maximumFractionDigits:0}).format(a)} €`}function xe(e){if(e==null)return{text:"—",isEmpty:!0};const n=Number(e);if(!Number.isFinite(n))return{text:"—",isEmpty:!0};const a=Math.round(n);return a===0?{text:"—",isEmpty:!0}:{text:me(a),isEmpty:!1}}function ae(e){return xe(e).text}function Z(e){return Number.isFinite(e)?`${Math.round(e*100)}%`:"—"}function se(e){return Number.isFinite(e)?Math.round(e).toLocaleString("de-DE",{maximumFractionDigits:0}):"—"}function Ne(e,n){const[a,o]=e.split("-").map(Number),s=new Date(a,o-1+n,1);return`${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,"0")}`}function pe(e,n){return n>0&&e>n?"Ist+Plan gemischt":n>0?"Ist (bezahlt)":"Plan"}function ne(e){if(!e)return null;const n=new Date(e);return Number.isNaN(n.getTime())?null:`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`}function ce(e){if(!/^\d{4}-\d{2}$/.test(e||""))return String(e||"");const[n,a]=e.split("-").map(Number);return new Date(Date.UTC(n,a-1,1)).toLocaleDateString("de-DE",{month:"2-digit",year:"numeric"})}function Se(e){return`month-col ${e%2===1?"month-col-alt":""}`.trim()}function Xe(e){const n=String(e).trim().toLowerCase();return`col-health ${{green:"health-full",light:"health-mostly",orange:"health-partial",red:"health-poor"}[n]||"health-none"}`.trim()}function Qe(e){return e?Array.isArray(e.items)&&e.items.length?e.items.reduce((n,a)=>n+(Number(a.units)||0),0):Number(e.units)||0:0}function et(e,n,a){const o=Number(e||0);if(!Number.isFinite(o))return 0;if(!n||n==="EUR")return o;const s=Number(a||0);return!Number.isFinite(s)||s<=0?o:o/s}function Pe(e){if(!e)return!1;if(typeof e.active=="boolean")return e.active;const n=String(e.status||"").trim().toLowerCase();return n?n==="active"||n==="aktiv":!0}function tt(e){const n=e&&Array.isArray(e.products)?e.products:[],a=e&&Array.isArray(e.productCategories)?e.productCategories:[],o=new Map(a.map(s=>[String(s.id),s]));return n.filter(Pe).map(s=>{const r=s.categoryId?String(s.categoryId):"",u=o.get(r);return{sku:String(s.sku||"").trim(),alias:String(s.alias||s.sku||"").trim(),categoryId:r,categoryName:u&&u.name?u.name:"Ohne Kategorie",categorySort:u&&Number.isFinite(u.sortOrder)?u.sortOrder:0}}).filter(s=>s.sku)}function ue(e){return String(e||"").trim()}function nt(e){const n=e&&Array.isArray(e.products)?e.products:[],a=new Map;return n.forEach(o=>{const s=ue(o&&o.sku).toLowerCase();if(!s)return;const r=ue(o&&o.alias);r&&a.set(s,r)}),a}function at(e,n){const a=new Set;if(Array.isArray(e&&e.items)&&e.items.forEach(r=>{const u=ue(r&&r.sku);u&&a.add(u)}),!a.size){const r=ue(e&&e.sku);r&&a.add(r)}const o=Array.from(a).map(r=>n.get(r.toLowerCase())).filter(Boolean);return{aliases:Array.from(new Set(o)),hasSku:a.size>0}}function st(e){if(!e)return null;const{aliases:n,hasSku:a}=e;if(!n.length)return a?"Alias: —":null;const o=n.slice(0,3),s=n.length>o.length?" …":"";return`${n.length>1?"Aliases":"Alias"}: ${o.join(", ")}${s}`}function ot(e,n=[]){const o=n.slice().sort((r,u)=>{const f=Number.isFinite(r.sortOrder)?r.sortOrder:0,p=Number.isFinite(u.sortOrder)?u.sortOrder:0;return f-p||String(r.name||"").localeCompare(String(u.name||""))}).map(r=>({id:String(r.id),name:r.name||"Ohne Kategorie",items:e.filter(u=>u.categoryId===String(r.id))})),s=e.filter(r=>!r.categoryId);return s.length&&o.push({id:"uncategorized",name:"Ohne Kategorie",items:s}),o.filter(r=>r.items.length)}function te(e){return e!=null&&String(e).trim()!==""}function lt(e,n){const a=((e==null?void 0:e.incomings)||[]).find(s=>(s==null?void 0:s.month)===n);if(a&&(te(a.revenueEur)||te(a.payoutPct)))return!0;const o=e!=null&&e.monthlyActuals&&typeof e.monthlyActuals=="object"?e.monthlyActuals[n]:null;return!!(o&&(te(o.realRevenueEUR)||te(o.realPayoutRatePct)))}const Me={gray:-1,red:0,orange:1,light:2,green:3};function ie(e,n){return Me[e]<=Me[n]?e:n}function rt(e,n){return n===0?"gray":e>=_.full?"green":e>=_.wide?"light":e>=_.partial?"orange":"red"}function it(){const e=je(Ze,{});return{projectionMode:(e==null?void 0:e.projectionMode)==="doh"?"doh":"units",selectedMonth:(e==null?void 0:e.selectedMonth)||null,showSafety:(e==null?void 0:e.showSafety)!==!1}}function ct(e,n){var o;const a=(((o=e==null?void 0:e.inventory)==null?void 0:o.snapshots)||[]).filter(s=>/^\d{4}-\d{2}$/.test((s==null?void 0:s.month)||"")).slice().sort((s,r)=>String(s.month).localeCompare(String(r.month)));if(n){const s=a.find(r=>r.month===n);if(s)return s}return a.length?a[a.length-1]:null}function ve(e,n){var w;const a=tt(e),o=e&&Array.isArray(e.productCategories)?e.productCategories:[],s=new Map,r=new Map,u=a.length,f=it(),p=ct(e,f.selectedMonth),m=((e==null?void 0:e.products)||[]).filter(Pe),l=We({state:e,months:n,products:m,snapshot:p,projectionMode:f.projectionMode}),i=_e(e).bySku,b=Array.isArray(e==null?void 0:e.fixcosts)?e.fixcosts:[],c=Te(e,{months:n}),g=new Map;c.forEach(v=>{v!=null&&v.month&&(g.has(v.month)||g.set(v.month,[]),g.get(v.month).push(v))});const y=((w=e==null?void 0:e.settings)==null?void 0:w.vatPreview)||{},A=[y.deShareDefault,y.feeRateDefault,y.fixInputDefault].some(v=>v!=null&&String(v).trim()!==""),N=(e==null?void 0:e.vatPreviewMonths)||{};return n.forEach(v=>{var U;let O=0;const x=[];let F=0,k=0,J=0;a.forEach(j=>{var le,re;const t=j.sku,d=(le=l.perSkuMonth.get(t))==null?void 0:le.get(v),$=!!(d!=null&&d.hasForecast),R=!!(d!=null&&d.isCovered);if($&&R){O+=1;return}const T=((re=i==null?void 0:i.get(t.toLowerCase()))==null?void 0:re.abcClass)||"—",G=f.projectionMode==="doh"?d==null?void 0:d.doh:d==null?void 0:d.endAvailable,W=d==null?void 0:d.safetyDays,E=Number.isFinite(d==null?void 0:d.daysToOos)?Number(d.daysToOos):null;let q="Forecast fehlt";$&&(Number.isFinite(d==null?void 0:d.endAvailable)&&Number(d.endAvailable)<=0?q="OOS erreicht":Number.isFinite(E)&&Number.isFinite(d==null?void 0:d.safetyDays)?q=`OOS in ${se(E)} Tagen < ${se(d==null?void 0:d.safetyDays)} Safety-Tage`:q="Unter Safety (OOS innerhalb Safety-Tage)"),x.push({sku:t,alias:j.alias,categoryName:j.categoryName,abcClass:T,value:G,safetyValue:W,problem:q}),$||(F+=1),$&&!R&&(k+=1),$&&!R&&((d==null?void 0:d.inboundUnits)||0)===0&&(J+=1)});const X=u?O/u:0,Q=rt(X,u),h=lt(e,v),K=b.length>0||(g.get(v)||[]).length>0,V=N[v]||{},D=A?[y.deShareDefault,y.feeRateDefault,y.fixInputDefault,V.deShare,V.feeRateOfGross,V.fixInputVat].some(j=>j!=null&&String(j).trim()!==""):!0,L={amazonPayout:!h,fixedCosts:!K,taxes:A&&!D};let z="green";L.taxes&&(z=ie(z,"light")),L.fixedCosts&&(z=ie(z,"orange")),L.amazonPayout&&(z=ie(z,"orange"));const H=u===0?"gray":ie(Q,z),I=[];F&&I.push({label:"Absatzprognose ergänzen",href:`#forecast?month=${v}`}),k&&(I.push({label:"Inventory prüfen",href:`#inventory?month=${v}`}),J&&(I.push({label:"Forecast Orders (FO) planen",href:`#fo?month=${v}`}),I.push({label:"Bestellungen (PO) prüfen",href:`#po?month=${v}`}))),L.amazonPayout&&I.push({label:"Amazon Auszahlung erfassen",href:`#eingaben?month=${v}`}),L.fixedCosts&&I.push({label:"Fixkosten ergänzen",href:`#fixkosten?month=${v}`}),L.taxes&&I.push({label:"USt-Vorschau konfigurieren",href:`#ust?month=${v}`}),s.set(v,H),r.set(v,{monthKey:v,statusKey:H,status:((U=oe[H])==null?void 0:U.label)||"—",coverageRatio:X,activeSkus:u,coveredSkus:O,projectionMode:f.projectionMode,missingCritical:L,taxesActive:A,problemSkus:x,todoLinks:I,coverageStatusKey:Q})}),{coverage:s,details:r,activeSkus:a,groups:ot(a,o)}}function ut(e,n){var u,f,p,m;const a=!!((f=(u=e==null?void 0:e.forecast)==null?void 0:u.settings)!=null&&f.useForecast),o=new Map;((e==null?void 0:e.incomings)||[]).forEach(l=>{l!=null&&l.month&&o.set(l.month,l.payoutPct)});const s=new Map;a&&Array.isArray((p=e==null?void 0:e.forecast)==null?void 0:p.items)?(m=e==null?void 0:e.forecast)!=null&&m.forecastImport&&typeof e.forecast.forecastImport=="object"?Object.values(e.forecast.forecastImport).forEach(l=>{Object.entries(l||{}).forEach(([i,b])=>{if(!i||!n.includes(i))return;const c=B((b==null?void 0:b.revenueEur)??(b==null?void 0:b.revenue)??null);Number.isFinite(c)&&s.set(i,(s.get(i)||0)+c)})}):e.forecast.items.forEach(l=>{if(!l||!l.month)return;const i=B(l.revenueEur!=null?l.revenueEur:l.revenue);if(Number.isFinite(i)&&i!==0){s.set(l.month,(s.get(l.month)||0)+i);return}const b=Number(l.qty!=null?l.qty:l.units!=null?l.units:l.quantity!=null?l.quantity:0)||0,c=B(l.priceEur!=null?l.priceEur:l.price!=null?l.price:0);s.set(l.month,(s.get(l.month)||0)+b*c)}):((e==null?void 0:e.incomings)||[]).forEach(l=>{l!=null&&l.month&&s.set(l.month,B(l.revenueEur))});const r=new Map;return n.forEach(l=>{const i=s.get(l)||0;let b=Number(o.get(l)||0)||0;b>1&&(b=b/100);const c=i*b;r.set(l,c)}),r}function dt(e){const n=Ge();return(e&&Array.isArray(e.pos)?e.pos:[]).map(o=>{const r=He(o,Je,n,(e==null?void 0:e.payments)||[]).map(p=>{const m=ne(p.dueDate);if(!m)return null;const l=Number(p.paidEurActual),i=Number.isFinite(l)?l:0;return{id:p.id,month:m,label:p.typeLabel||p.label||"Zahlung",typeLabel:p.typeLabel||p.label||"Zahlung",dueDate:p.dueDate,plannedEur:Number(p.plannedEur||0),actualEur:i,paid:p.status==="paid",paidDate:p.paidDate||null,paymentId:p.paymentId||null,paidBy:p.paidBy||null,currency:"EUR"}}).filter(Boolean),u=o&&o.supplier||o&&o.supplierName||"",f=Qe(o);return{record:o,supplier:u,units:f,events:r,transactions:[]}})}function pt(e){return(e&&Array.isArray(e.fos)?e.fos:[]).filter(a=>String(a&&a.status?a.status:"").toUpperCase()!=="CONVERTED").map(a=>{const o=a&&a.fxRate||e&&e.settings&&e.settings.fxRate||0,s=(a.payments||[]).map(r=>{if(!r||!r.dueDate)return null;const u=ne(r.dueDate);if(!u)return null;const f=r.currency||"EUR",p=et(r.amount,f,o);return{id:r.id,month:u,label:r.label||"Payment",typeLabel:r.label||r.category||"Payment",dueDate:r.dueDate,plannedEur:p,actualEur:0,paid:!1,paidBy:null,currency:f}}).filter(Boolean);return{record:a,events:s}})}function ht(e,n,a){let o=0,s=0,r=0,u=0,f=!1;return e.forEach(p=>{if(p.month!==n)return;const m=Number(p.plannedEur||0),l=Number(p.actualEur||0),i=p.paid===!0,b=i&&l>0?l:m;s+=b,i&&b>0?(r+=b,o+=b,f=!0,p.paidDate&&ne(p.paidDate)===a&&(u+=1)):o+=m}),{value:o,plannedTotal:s,actualTotal:r,displayLabel:pe(s,r),warnings:[],paidThisMonthCount:u,hasPaidValue:f}}function ft(e,n,a){let o=0,s=0,r=0,u=0,f=!1;return e.forEach(p=>{if(p.month!==n)return;const m=Number(p.plannedEur||0),l=Number(p.actualEur||0),i=p.paid===!0;s+=m,i&&l>0?(r+=l,o+=l,f=!0,p.paidDate&&ne(p.paidDate)===a&&(u+=1)):o+=m}),{value:o,plannedTotal:s,actualTotal:r,displayLabel:pe(s,r),warnings:[],paidThisMonthCount:u,hasPaidValue:f}}function P({id:e,label:n,level:a,children:o=[],events:s=[],tooltip:r="",emptyHint:u="",isSummary:f=!1,alwaysVisible:p=!1,sumMode:m="payments",rowType:l="detail",section:i=null,sourceLabel:b=null,nav:c=null}){return{id:e,label:n,level:a,children:o,events:s,tooltip:r,emptyHint:u,isSummary:f,alwaysVisible:p,sumMode:m,rowType:l,section:i,sourceLabel:b,nav:c,values:{}}}function Oe(e,n){return e?e.events&&e.events.some(a=>a.month===n&&(Number(a.plannedEur||0)!==0||Number(a.actualEur||0)!==0))?!0:e.children.some(a=>Oe(a,n)):!1}function Be(e,n){return e.some(a=>{const o=a.values&&a.values[n]&&a.values[n].value||0;return Math.abs(o)>1e-4?!0:Oe(a,n)})}function ye(e,n,a){e.events.length?n.forEach(o=>{const s=e.sumMode==="generic"?ft(e.events,o,a):ht(e.events,o,a);e.values[o]=s}):e.children.length&&(e.children.forEach(o=>ye(o,n,a)),n.forEach(o=>{const s=e.children.reduce((l,i)=>l+(i.values[o]&&i.values[o].value||0),0),r=e.children.reduce((l,i)=>l+(i.values[o]&&i.values[o].plannedTotal||0),0),u=e.children.reduce((l,i)=>l+(i.values[o]&&i.values[o].actualTotal||0),0),f=e.children.flatMap(l=>l.values[o]?l.values[o].warnings||[]:[]),p=e.children.reduce((l,i)=>l+(i.values[o]&&i.values[o].paidThisMonthCount||0),0),m=e.children.some(l=>l.values[o]&&l.values[o].hasPaidValue);e.values[o]={value:s,plannedTotal:r,actualTotal:u,displayLabel:pe(r,u),warnings:f,paidThisMonthCount:p,hasPaidValue:m}}))}function gt(e,n){return n.some(a=>Math.abs(e.values[a]&&e.values[a].value||0)>1e-4)}function Y(e,n){const a=e.children.map(r=>Y(r,n)).filter(Boolean);e.children=a;const o=a.length>0,s=gt(e,n);return e.alwaysVisible||e.isSummary||o||s?e:null}function bt(e,n){const a=[];function o(s){if(a.push(s),!!s.children.length&&n.has(s.id)){if(s.children.length>fe&&s.level>=2){s.children.slice(0,fe).forEach(u=>o(u));const r=s.children.length-fe;a.push(P({id:`${s.id}-more`,label:`+ ${r} weitere …`,level:s.level+1,rowType:"detail",section:s.section,sourceLabel:s.sourceLabel}));return}s.children.forEach(r=>o(r))}}return e.forEach(o),a}function de(e,n,a={}){const o=ut(e,n),s=new Map,r=e&&e.monthlyActuals&&typeof e.monthlyActuals=="object"?e.monthlyActuals:{};Object.entries(r).forEach(([t,d])=>{if(!n.includes(t))return;const $=d&&d.realRevenueEUR,R=d&&d.realPayoutRatePct;if(!te($)||!te(R))return;const T=B($),C=B(R);!Number.isFinite(T)||!Number.isFinite(C)||s.set(t,T*(C/100))});const u=a.coverage instanceof Map?a.coverage:new Map,f=n.map(t=>({id:`amazon-${t}`,month:t,plannedEur:o.get(t)||0,actualEur:s.get(t)||0,paid:s.has(t)})),p=e&&Array.isArray(e.extras)?e.extras:[],m=p.filter(t=>B(t&&t.amountEur)>=0).map(t=>({id:t.id||t.label||t.month,month:t.month||ne(t.date),plannedEur:B(t.amountEur),actualEur:B(t.amountEur),paid:!0})).filter(t=>t.month),l=p.filter(t=>B(t&&t.amountEur)<0).map(t=>({id:t.id||t.label||t.month,month:t.month||ne(t.date),plannedEur:Math.abs(B(t.amountEur)),actualEur:Math.abs(B(t.amountEur)),paid:!0})).filter(t=>t.month),i=(e&&Array.isArray(e.dividends)?e.dividends:[]).map(t=>({id:t.id||t.label||t.month,month:t.month||ne(t.date),plannedEur:Math.abs(B(t.amountEur)),actualEur:Math.abs(B(t.amountEur)),paid:!0})).filter(t=>t.month),c=Te(e,{months:n}).map(t=>({id:t.id,month:t.month,plannedEur:t.amount,actualEur:t.amount,paid:t.paid===!0,fixedCostId:t.fixedCostId,paidDate:t.paid?t.dueDateIso:null})),y=Fe(e||{}).rows.map(t=>({id:`tax-${t.month}`,month:t.month,plannedEur:Math.max(0,Number(t.payable||0)),actualEur:0,paid:!1})),A=nt(e),N=dt(e),w=pt(e),v=P({id:"amazon-payout",label:"Amazon Auszahlungen",level:1,events:f,sumMode:"generic",rowType:"subtotal",section:"inflows",sourceLabel:"Eingaben",nav:{route:"#eingaben"}}),O=P({id:"other-in",label:"Weitere Einzahlungen",level:1,events:m,sumMode:"generic",rowType:"detail",section:"inflows",sourceLabel:"Eingaben"}),x=P({id:"inflows",label:"Einzahlungen",level:0,children:[v,O],rowType:"section",section:"inflows",sourceLabel:"Einzahlungen"}),F=N.map(t=>{const d=t.record&&t.record.poNo?t.record.poNo:"",$=d?`PO ${d}`:"PO",R=t.events.some(E=>/deposit/i.test(E.typeLabel||"")&&E.paid),T=t.events.some(E=>/balance/i.test(E.typeLabel||"")&&E.paid),C=st(at(t.record,A)),G=[`PO: ${d||"—"}`,`Supplier: ${t.supplier||"—"}`,`Units: ${t.units||0}`,C,`Deposit: ${R?"bezahlt":"offen"}`,`Balance: ${T?"bezahlt":"offen"}`],W=t.events.map(E=>{const q=[`Typ: ${E.typeLabel||"Zahlung"}`,`Datum: ${E.dueDate||"—"}`,`Ist EUR: ${me(E.actualEur||0)}`,C,E.currency?`Währung: ${E.currency}`:null,E.paidBy?`Paid by: ${E.paidBy}`:null].filter(Boolean).join(" · ");return P({id:`po-${t.record&&t.record.id||$}-${E.id}`,label:E.typeLabel||E.label||"Zahlung",level:3,events:[E],tooltip:q,rowType:"detail",section:"outflows",sourceLabel:"PO Zahlung",nav:{route:"#po",open:t.record&&(t.record.id||t.record.poNo)||"",focus:E.typeLabel?`payment:${E.typeLabel}`:null}})});return P({id:`po-${t.record&&t.record.id||$}`,label:$,level:2,children:W,events:[],tooltip:G.join(" · "),rowType:"detail",section:"outflows",sourceLabel:"PO",nav:{route:"#po",open:t.record&&(t.record.id||t.record.poNo)||""}})}),k=P({id:"po-payments",label:"PO Zahlungen",level:1,children:F,alwaysVisible:!0,rowType:"subtotal",section:"outflows",sourceLabel:"PO Zahlungen"}),J=w.map(t=>{const d=t.record&&t.record.foNo?t.record.foNo:"",$=d?`FO ${d}`:"FO",R=[`FO: ${d||t.record&&t.record.id||"—"}`,`SKU: ${t.record&&t.record.sku||"—"}`,`Units: ${t.record&&t.record.units||0}`,`ETA: ${t.record&&(t.record.etaDate||t.record.targetDeliveryDate)||"—"}`,`Status: ${t.record&&t.record.status||"—"}`].join(" · "),T=t.events.map(C=>{const G=[`Typ: ${C.typeLabel||"Payment"}`,`Datum: ${C.dueDate||"—"}`,`Ist EUR: ${me(C.actualEur||0)}`,C.currency?`Währung: ${C.currency}`:null].filter(Boolean).join(" · ");return P({id:`fo-${t.record&&t.record.id||$}-${C.id}`,label:C.typeLabel||C.label||"Payment",level:3,events:[C],tooltip:G,rowType:"detail",section:"outflows",sourceLabel:"FO Zahlung",nav:{route:"#fo",open:t.record&&(t.record.id||t.record.foNo)||""}})});return P({id:`fo-${t.record&&t.record.id||$}`,label:$,level:2,children:T,events:[],tooltip:R,rowType:"detail",section:"outflows",sourceLabel:"FO",nav:{route:"#fo",open:t.record&&(t.record.id||t.record.foNo)||""}})}),X=P({id:"fo-payments",label:"FO Zahlungen",level:1,children:J,alwaysVisible:!0,rowType:"subtotal",section:"outflows",sourceLabel:"FO Zahlungen"}),Q=P({id:"fixcosts",label:"Fixkosten",level:1,events:c,sumMode:"generic",alwaysVisible:!0,emptyHint:"Keine Fixkosten vorhanden.",rowType:"detail",section:"outflows",sourceLabel:"Fixkosten",nav:{route:"#fixkosten"}}),h=P({id:"taxes",label:"Steuern",level:1,events:y,sumMode:"generic",alwaysVisible:!0,emptyHint:"Keine Steuerdaten hinterlegt.",rowType:"detail",section:"outflows",sourceLabel:"Steuern"}),K=P({id:"dividends",label:"Dividende",level:1,events:i,sumMode:"generic",alwaysVisible:!0,emptyHint:"Keine Dividenden erfasst.",rowType:"detail",section:"outflows",sourceLabel:"Dividende"}),V=P({id:"other-out",label:"Weitere Auszahlungen",level:1,events:l,sumMode:"generic",alwaysVisible:!0,emptyHint:"Keine weiteren Auszahlungen vorhanden.",rowType:"detail",section:"outflows",sourceLabel:"Auszahlungen"}),D=P({id:"outflows",label:"Auszahlungen",level:0,children:[k,X,Q,h,K,V],rowType:"section",section:"outflows",sourceLabel:"Auszahlungen"});ye(x,n,a.currentMonth),ye(D,n,a.currentMonth);const L=P({id:"net-cashflow",label:"Netto Cashflow",level:0,isSummary:!0,alwaysVisible:!0,rowType:"summary",section:"summary",sourceLabel:"Netto Cashflow"});n.forEach(t=>{const d=x.values[t]&&x.values[t].value||0,$=D.values[t]&&D.values[t].value||0,R=(x.values[t]&&x.values[t].plannedTotal||0)-(D.values[t]&&D.values[t].plannedTotal||0),T=(x.values[t]&&x.values[t].actualTotal||0)-(D.values[t]&&D.values[t].actualTotal||0);L.values[t]={value:d-$,plannedTotal:R,actualTotal:T,displayLabel:pe(Math.abs(R),Math.abs(T)),warnings:[],paidThisMonthCount:0}});const z=Ee(e&&e.openingEur,Ee(e&&e.settings&&e.settings.openingBalance,null)),H=B(z||0),I=e&&e.monthlyActuals&&typeof e.monthlyActuals=="object"?e.monthlyActuals:{},U=P({id:"balance",label:"Kontostand Monatsende",level:0,isSummary:!0,alwaysVisible:!0,rowType:"summary",section:"summary",sourceLabel:"Kontostand"});if(n.length){let t=H;const d=a.limitBalanceToGreen?Math.max(-1,...n.map(($,R)=>u.get($)==="green"?R:-1)):n.length-1;n.forEach(($,R)=>{const T=I[$]&&I[$].realClosingBalanceEUR,C=te(T),G=C?B(T):null,W=L.values[$]&&L.values[$].value||0,E=(Number.isFinite(t)?t:0)+W;if(a.limitBalanceToGreen&&R>d){U.values[$]={value:null,plannedTotal:0,actualTotal:0,displayLabel:"Plan",warnings:[],paidThisMonthCount:0};return}const q=C?G:E;U.values[$]={value:q,plannedTotal:E,actualTotal:C?G:E,displayLabel:C?"Ist":"Plan",warnings:[],paidThisMonthCount:0,isActual:C},t=C?G:E})}return{inflowRow:x,outflowRow:D,summaryRows:[L,U]}}function mt(e){const n=e&&e.settings&&e.settings.startMonth||"2025-01",a=Number(e&&e.settings&&e.settings.horizonMonths||12)||12,o=Ne(n,a-1),s=Ce(n,o),r=ke();$e(M.range)||(M.range=be);const u=Re(s,M.range,r),f=ve(e,u),p=f.details,m=de(e,u,{limitBalanceToGreen:M.limitBalanceToGreen,currentMonth:r,coverage:f.coverage}),l=Y(m.inflowRow,u),i=Y(m.outflowRow,u),b=[l,i,...m.summaryRows].filter(Boolean),c=M.hideEmptyMonths?u.filter(h=>Be(b,h)):u.slice(),{inflowRow:g,outflowRow:y,summaryRows:A}=de(e,c,{limitBalanceToGreen:M.limitBalanceToGreen,currentMonth:r,coverage:f.coverage}),N=Y(g,c),w=Y(y,c),v=[N,w,...A].filter(Boolean),O=bt(v,M.expanded);f.activeSkus.length>0&&c.some(h=>f.coverage.get(h)!=="green");const x=`
      <label class="dashboard-range">
        <span>Zeitraum</span>
        <select id="dashboard-range">
          ${we.map(h=>`<option value="${h.value}" ${h.value===M.range?"selected":""}>${h.label}</option>`).join("")}
        </select>
      </label>
    `,F=c.map(h=>{var V;const K=((V=p.get(h))==null?void 0:V.statusKey)||"gray";return Xe(K)}),k=c.map((h,K)=>{var t;const V=Se(K),D=F[K]||"col-health health-none",L=f.details.get(h)||{},H=(p.get(h)||{}).statusKey||L.statusKey||"gray",I=Number.isFinite(L.activeSkus)?L.activeSkus:0,U=((t=oe[H])==null?void 0:t.label)||"—",j=[`Status: ${U}`,`Abdeckung: ${L.coveredSkus||0}/${I} (${Z(L.coverageRatio||0)})`].filter(Boolean).join(`
`);return`
        <th scope="col" class="${V} ${D}" data-col-index="${K}">
          <button type="button" class="coverage-indicator coverage-${H} coverage-button" data-coverage-month="${S(h)}" data-health-month="${S(h)}" title="${S(j)}" aria-label="Reifegrad ${S(ce(h))}: ${S(U)}"></button>
          <span class="month-header-label">
            <button type="button" class="month-header-trigger" data-health-month="${S(h)}">
              ${S(ce(h))}
            </button>
          </span>
        </th>
      `}).join(""),J='<th scope="col" class="dashboard-compare-header">Kontostand Plan/Ist</th>',X=O.map(h=>{const K=h.children.length>0,V=M.expanded.has(h.id),D=`tree-level-${h.level}`,L=K?`<button type="button" class="tree-toggle" data-row-id="${S(h.id)}" aria-expanded="${V}">${V?"▼":"▶"}</button>`:'<span class="tree-spacer" aria-hidden="true"></span>',z=h.tooltip||h.emptyHint||"",H=[h.rowType==="section"?"row-section":"",h.rowType==="subtotal"?"row-subtotal":"",h.rowType==="summary"?"row-summary":"",h.rowType==="detail"?"row-detail":"",h.section?`section-${h.section}`:""].filter(Boolean).join(" "),I=`
        <td class="tree-cell ${D} ${h.isSummary?"tree-summary":""}" title="${S(z)}">
          ${L}
          <span class="tree-label">${S(h.label)}</span>
        </td>
      `,U=c.map((t,d)=>{const $=Se(d),R=F[d]||"col-health health-none",T=h.values[t]||{value:0},G=h.id==="balance"&&f.coverage.get(t)!=="green"?'<span class="cell-balance-warning" title="Kontostand kann unvollständig sein, da Planung fehlt.">⚠︎</span>':"",W=xe(T.value),E=t===r&&(T.paidThisMonthCount||0)>0;E&&`${T.paidThisMonthCount}`;const q=T.hasPaidValue&&String(h.sourceLabel||"").toLowerCase().includes("po"),le=T.isActual?'<span class="cell-actual-tag" title="Realer Wert">Ist</span>':"",re=[`Plan/Ist: ${ae(T.plannedTotal)} / ${ae(T.actualTotal)}`,`Status: ${T.displayLabel||"Plan"}`].filter(Boolean).join(`
`),Ie=h.id==="balance"&&T.isActual?`<div class="balance-detail"><span>Plan: ${ae(T.plannedTotal)}</span><span>Ist: ${ae(T.actualTotal)}</span></div>`:"",he=h.nav&&!W.isEmpty,De=h.nav?encodeURIComponent(JSON.stringify({...h.nav,month:t})):"";return`
            <td class="num ${h.isSummary?"tree-summary":""} ${E?"cell-paid-current":""} ${he?"cell-link":""} ${$} ${R}" ${he?`data-nav="${De}"`:""} data-col-index="${d}" title="${S(re)}">
              ${G}
              <span class="${W.isEmpty?"cell-empty":""} ${q?"cell-paid-value":""}">${W.text}</span>
              ${Ie}
              ${le}
              ${he?'<span class="cell-link-icon" aria-hidden="true">↗</span>':""}
            </td>
          `}).join(""),j=(()=>{if(h.id!=="balance")return'<td class="num dashboard-compare-cell muted">—</td>';const t=c.slice().reverse().find($=>{var R;return(R=h.values[$])==null?void 0:R.isActual});if(!t)return'<td class="num dashboard-compare-cell muted">—</td>';const d=h.values[t]||{};return`
          <td class="num dashboard-compare-cell">
            <div class="balance-compare">
              <span>Plan: ${ae(d.plannedTotal)}</span>
              <span>Ist: ${ae(d.actualTotal)}</span>
              <span class="muted">${S(ce(t))}</span>
            </div>
          </td>
        `})();return`<tr data-row-id="${S(h.id)}" class="${H}">${I}${U}${j}</tr>`}).join("");return`
    <section class="dashboard ui-page-shell">
      <div class="dashboard-header">
        <div class="dashboard-topline ui-page-head">
          <div class="dashboard-title-block">
            <h2>Dashboard</h2>
            <p class="muted">Planwerte werden durch Ist ersetzt, sobald Zahlungen verbucht sind. Drilldowns zeigen PO/FO-Events.</p>
          </div>
          <div class="dashboard-range-slot">
            ${x}
          </div>
        </div>
        <div class="dashboard-toolbar ui-toolbar">
          <div class="dashboard-toggle ui-actions-inline" role="group" aria-label="Expand">
            <button type="button" class="btn secondary" data-expand="expand">Alles auf</button>
            <button type="button" class="btn secondary" data-expand="collapse">Alles zu</button>
          </div>
          <div class="dashboard-toolbar-filters">
            <label class="dashboard-toggle dashboard-checkbox">
              <input type="checkbox" id="dashboard-hide-empty" ${M.hideEmptyMonths?"checked":""} />
              <span>Leere Monate ausblenden</span>
            </label>
            <label class="dashboard-toggle dashboard-checkbox">
              <input type="checkbox" id="dashboard-limit-balance" ${M.limitBalanceToGreen?"checked":""} />
              <span>Kontostand nur bis letztem grünen Monat</span>
            </label>
          </div>
          <div class="dashboard-toolbar-legend muted">
            <button type="button" class="legend-trigger" id="dashboard-legend-info">
              <span class="coverage-indicator coverage-green"></span> Vollständig
              <span class="coverage-indicator coverage-light"></span> Weitgehend
              <span class="coverage-indicator coverage-orange"></span> Teilweise
              <span class="coverage-indicator coverage-red"></span> Unzureichend
              <span class="legend-more">Details</span>
            </button>
            <span class="legend-item"><span class="legend-paid"></span> Zahlung im aktuellen Monat bezahlt</span>
          </div>
        </div>
      </div>
      
      <div class="dashboard-table-wrap ui-table-shell">
        <div class="dashboard-table-scroll ui-scroll-host">
          <table class="table-compact ui-table-standard dashboard-tree-table" role="table" data-ui-table="true" data-sticky-cols="1" data-sticky-owner="manual">
            <thead>
              <tr>
                <th scope="col" class="tree-header">Kategorie / Zeile</th>
                ${k}
                ${J}
              </tr>
            </thead>
            <tbody>
              ${X||`
                <tr>
                  <td colspan="${c.length+2}" class="muted">Keine Daten vorhanden.</td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `}function vt(){const e=`Schwellen: Vollständig ${Z(_.full)}, Weitgehend ≥${Z(_.wide)}, Teilweise ≥${Z(_.partial)}.`,n=["green","light","orange","red"].map(a=>`
      <li class="dashboard-detail-item">
        <span class="coverage-indicator coverage-${a}"></span>
        <div>
          <strong>${S(oe[a].label)}</strong>
          <div class="muted small">${S(oe[a].detail)}</div>
        </div>
      </li>
    `).join("");return`
    <div class="po-modal dashboard-detail-modal">
      <header class="po-modal-header">
        <h3>Reifegrad-Legende</h3>
        <button type="button" class="btn ghost" data-close aria-label="Schließen">✕</button>
      </header>
      <div class="po-modal-body">
        <p class="muted">${e}</p>
        <ul class="dashboard-detail-list">
          ${n}
        </ul>
      </div>
      <footer class="po-modal-actions">
        <button type="button" class="btn secondary" data-close>Schließen</button>
      </footer>
    </div>
  `}function yt(e){var x,F;if(!e)return"";const n=e.statusKey||"gray",a=e.status||((x=oe[n])==null?void 0:x.label)||"—",o=ce(e.monthKey),s=Number(e.activeSkus||0),r=Number(e.coveredSkus||0),u=Number(e.coverageRatio||0),f=e.missingCritical||{},p=!!e.taxesActive,l=(e.projectionMode==="doh"?"doh":"units")==="doh"?"DOH":"Units",i="Safety-Tage",b=s>0&&u>=_.full,c=[{label:"Inventory Coverage ok?",description:`${r}/${s} aktive SKUs abgedeckt (${Z(u)}).`,passed:b},{label:"Amazon payouts vorhanden?",description:"Amazon-Auszahlungen für den Monat sind erfasst.",passed:!f.amazonPayout},{label:"Fixkosten vorhanden?",description:"Fixkosten für den Monat sind gepflegt.",passed:!f.fixedCosts},{label:"Steuer-Config ok?",description:p?"USt-Vorschau ist konfiguriert.":"USt-Vorschau ist nicht aktiv.",passed:p?!f.taxes:!0}],g=`Schwellen: Vollständig ≥${Z(_.full)}, Weitgehend ≥${Z(_.wide)}, Teilweise ≥${Z(_.partial)}.`,y=Array.isArray(e.todoLinks)?e.todoLinks:[],N=n!=="green"&&y.length>0?y.map(k=>`
      <li>
        <a href="${S(k.href)}" class="btn ghost btn-small" data-panel-link>${S(k.label)}</a>
      </li>
    `).join(""):'<li class="muted small">Keine To-Dos.</li>',w=(e.problemSkus||[]).map(k=>`
      <tr>
        <td>${S(k.sku)}</td>
        <td>${S(k.alias||"—")}</td>
        <td class="muted">${S(k.abcClass||"—")}</td>
        <td class="num">${se(k.value)}</td>
        <td class="num">${se(k.safetyValue)}</td>
        <td>${S(k.problem||"—")}</td>
      </tr>
    `).join(""),v=w?`
      <table class="dashboard-detail-table" data-ui-table="true">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Alias</th>
            <th>ABC</th>
            <th class="num">${S(l)}</th>
            <th class="num">${S(i)}</th>
            <th>Problem</th>
          </tr>
        </thead>
        <tbody>
          ${w}
        </tbody>
      </table>
    `:'<div class="muted">Keine problematischen SKUs.</div>',O=c.map(k=>`
      <li class="dashboard-detail-item ${k.passed?"detail-pass":"detail-fail"}">
        <span class="detail-check">${k.passed?"✓":"✕"}</span>
        <div>
          <strong>${S(k.label)}</strong>
          <div class="muted small">${S(k.description)}</div>
        </div>
      </li>
    `).join("");return`
    <div class="dashboard-side-panel" role="dialog" aria-modal="true" aria-label="Monats-Details">
      <header class="dashboard-side-panel-header">
        <div>
          <h3>Monat ${S(o)} – Status: ${S(a)}</h3>
          <div class="dashboard-side-panel-subtitle">
            <span class="coverage-indicator coverage-${n}"></span>
            <span>${S(((F=oe[n])==null?void 0:F.detail)||"")}</span>
          </div>
        </div>
        <button type="button" class="btn ghost" data-close aria-label="Schließen">✕</button>
      </header>
      <div class="dashboard-side-panel-body">
        <section class="dashboard-side-panel-section">
          <h4>Status & Berechnung</h4>
          <div class="dashboard-detail-metrics">
            <div>
              <span class="muted">Aktive SKUs</span>
              <strong>${se(s)}</strong>
            </div>
            <div>
              <span class="muted">Abgedeckte SKUs</span>
              <strong>${se(r)}</strong>
            </div>
            <div>
              <span class="muted">Coverage Ratio</span>
              <strong>${Z(u)}</strong>
            </div>
          </div>
          <div class="muted small">${S(g)}</div>
        </section>
        <section class="dashboard-side-panel-section">
          <h4>Checklist</h4>
          <ul class="dashboard-detail-list">
            ${O}
          </ul>
        </section>
        <section class="dashboard-side-panel-section">
          <h4>Problematische SKUs</h4>
          ${v}
        </section>
        <section class="dashboard-side-panel-section">
          <h4>Was zu tun ist</h4>
          <ul class="health-check-list">
            ${N}
          </ul>
        </section>
      </div>
    </div>
  `}function $t(){let e=document.getElementById("global-chart-tip");return e||(e=document.createElement("div"),e.id="global-chart-tip",e.className="chart-tip",e.hidden=!0,document.body.appendChild(e)),e}$t();function Et(e,n){const a=m=>{const l=document.querySelector(".dashboard-modal-backdrop");l&&l.remove();const i=document.createElement("div");i.className="po-modal-backdrop dashboard-modal-backdrop",i.innerHTML=m,document.body.appendChild(i);const b=()=>{document.removeEventListener("keydown",c),i.remove()},c=g=>{g.key==="Escape"&&b()};i.addEventListener("click",g=>{if(g.target.closest("[data-close]")){b();return}if(g.target===i){b();return}const A=g.target.closest("[data-fix-route]");if(!A)return;const N=A.getAttribute("data-fix-route");if(!N)return;const w=new URLSearchParams,v=A.getAttribute("data-fix-sku"),O=A.getAttribute("data-fix-month");v&&w.set("sku",v),O&&w.set("month",O),location.hash=w.toString()?`${N}?${w.toString()}`:N,b()}),document.addEventListener("keydown",c)},o=m=>{const l=document.querySelector(".dashboard-side-panel-backdrop");l&&l.remove();const i=document.createElement("div");i.className="dashboard-side-panel-backdrop",i.innerHTML=m,document.body.appendChild(i);const b=()=>{document.removeEventListener("keydown",c),i.remove()},c=g=>{g.key==="Escape"&&b()};i.addEventListener("click",g=>{if(g.target.closest("[data-close]")){b();return}if(g.target===i){b();return}g.target.closest("[data-panel-link]")&&b()}),document.addEventListener("keydown",c)};e.querySelectorAll("[data-expand]").forEach(m=>{m.addEventListener("click",()=>{const l=m.getAttribute("data-expand"),i=n&&n.settings&&n.settings.startMonth||"2025-01",b=Number(n&&n.settings&&n.settings.horizonMonths||12)||12,c=Ne(i,b-1),g=ke(),y=Ce(i,c),A=Re(y,M.range,g),N=ve(n,A),w=de(n,A,{limitBalanceToGreen:M.limitBalanceToGreen,currentMonth:g,coverage:N.coverage}),v=[Y(w.inflowRow,A),Y(w.outflowRow,A),...w.summaryRows].filter(Boolean),O=M.hideEmptyMonths?A.filter(h=>Be(v,h)):A,{inflowRow:x,outflowRow:F,summaryRows:k}=de(n,O,{limitBalanceToGreen:M.limitBalanceToGreen,currentMonth:g,coverage:N.coverage}),J=[Y(x,O),Y(F,O),...k].filter(Boolean),X=collectExpandableIds(J),Q=N.groups||[];l==="collapse"?(M.expanded=new Set,M.coverageCollapsed=new Set(Q.map(h=>h.id))):(M.expanded=new Set(X),M.coverageCollapsed=new Set),ee(e)})});const s=e.querySelector("#dashboard-hide-empty");s&&s.addEventListener("change",()=>{M.hideEmptyMonths=s.checked,ee(e)});const r=e.querySelector("#dashboard-limit-balance");r&&r.addEventListener("change",()=>{M.limitBalanceToGreen=r.checked,ee(e)});const u=e.querySelector("#dashboard-legend-info");u&&u.addEventListener("click",()=>{a(vt())}),e.querySelectorAll("[data-health-month]").forEach(m=>{m.addEventListener("click",()=>{const l=m.getAttribute("data-health-month");if(!l)return;const i=Array.from(e.querySelectorAll("[data-coverage-month]")).map(g=>g.getAttribute("data-coverage-month")).filter(Boolean),c=ve(n,i).details.get(l);c&&o(yt(c))})});const f=e.querySelector(".dashboard-tree-table");if(f){let m=null;const l=()=>{m!=null&&(f.querySelectorAll(`[data-col-index="${m}"]`).forEach(c=>{c.classList.remove("is-col-hover")}),m=null)},i=c=>{c==null||c===m||(l(),f.querySelectorAll(`[data-col-index="${c}"]`).forEach(g=>{g.classList.add("is-col-hover")}),m=c)};f.addEventListener("mouseover",c=>{const g=c.target.closest("[data-col-index]");!g||!f.contains(g)||i(g.getAttribute("data-col-index"))}),f.addEventListener("mouseleave",()=>{l()}),f.addEventListener("click",c=>{const g=c.target.closest("button.tree-toggle[data-row-id]");if(!g)return;const y=g.getAttribute("data-row-id");y&&(M.expanded.has(y)?M.expanded.delete(y):M.expanded.add(y),ee(e))});const b=c=>{if(!c||!c.route)return;const g=new URLSearchParams;c.open&&g.set("open",c.open),c.focus&&g.set("focus",c.focus),c.month&&g.set("month",c.month);const y=g.toString();location.hash=y?`${c.route}?${y}`:c.route};f.addEventListener("dblclick",c=>{const g=c.target.closest("td[data-nav]");if(!g)return;const y=g.getAttribute("data-nav");if(y)try{const A=JSON.parse(decodeURIComponent(y));b(A)}catch{}}),f.addEventListener("click",c=>{const g=c.target.closest(".cell-link-icon");if(!g)return;const y=g.closest("td[data-nav]");if(!y)return;const A=y.getAttribute("data-nav");if(A)try{const N=JSON.parse(decodeURIComponent(A));b(N)}catch{}})}const p=e.querySelector("#dashboard-range");p&&p.addEventListener("change",()=>{M.range=p.value;try{$e(M.range)&&Ke(Le,M.range)}catch{}ee(e)})}let ge=null,Ae=null;function ee(e){ge=e;const n=ze();e.innerHTML=mt(n),Et(e,n),Ae||(Ae=Ve(()=>{location.hash.replace("#","")==="dashboard"&&ge&&ee(ge)}))}const Ot={render:ee};export{Ot as default,ee as render,ht as sumPaymentEvents};
