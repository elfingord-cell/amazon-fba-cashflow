import{a as Ve}from"./index-DiG4I6j0.js";import{l as Fe,s as ze,g as Ke,a as Ue}from"./store-BTTMP6mO.js";import{e as Ae,p as V}from"./cashflow-DzcMzPib.js";import{g as je,b as He}from"./orderEditorFactory-Djr1FJ1g.js";import{c as Ge}from"./vatPreview-0DiIRvvK.js";import{g as Te,c as Ce,a as ke,D as qe,b as _e}from"./abcClassification-BPGw2KgL.js";import{c as We}from"./inventoryProjection-BUh0Vreb.js";import"./prefill-aSmcuWn6.js";import"./productCompleteness-CNGcv3R4.js";import"./dateUtils-D7NmXfd-.js";import"./useDraftForm-BJ58DtfH.js";const Le="dashboard_month_range",ge="NEXT_6",Re=qe,Ze="inventory_view_v1";function ye(e){return Re.some(n=>n.value===e)}function Ye(){const e=Ue(Le,ge);return ye(e)?e:ge}const M={expanded:new Set(["inflows","outflows","po-payments","fo-payments"]),coverageCollapsed:new Set,range:Ye(),hideEmptyMonths:!0,limitBalanceToGreen:!1},q={full:.95,wide:.8,partial:.5},se={green:{label:"Vollständig",detail:"Mindestens 95% der aktiven SKUs sind abgedeckt."},light:{label:"Weitgehend",detail:"80–94% der aktiven SKUs sind abgedeckt."},orange:{label:"Teilweise",detail:"50–79% der aktiven SKUs sind abgedeckt."},red:{label:"Unzureichend",detail:"Unter 50% Abdeckung oder kritische Grundlagen fehlen."},gray:{label:"Keine Daten",detail:"Keine aktiven Produkte vorhanden."}},Je={entityLabel:"PO",numberField:"poNo"},he=50;function E(e){return String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function $e(e,n){return e??n}function be(e){if(e==null)return"—";const n=Number(e);if(!Number.isFinite(n))return"—";const a=Math.round(n);return`${new Intl.NumberFormat("de-DE",{maximumFractionDigits:0}).format(a)} €`}function xe(e){if(e==null)return{text:"—",isEmpty:!0};const n=Number(e);if(!Number.isFinite(n))return{text:"—",isEmpty:!0};const a=Math.round(n);return a===0?{text:"—",isEmpty:!0}:{text:be(a),isEmpty:!1}}function ae(e){return xe(e).text}function W(e){return Number.isFinite(e)?`${Math.round(e*100)}%`:"—"}function X(e){return Number.isFinite(e)?Math.round(e).toLocaleString("de-DE",{maximumFractionDigits:0}):"—"}function we(e,n){const[a,o]=e.split("-").map(Number),s=new Date(a,o-1+n,1);return`${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,"0")}`}function de(e,n){return n>0&&e>n?"Ist+Plan gemischt":n>0?"Ist (bezahlt)":"Plan"}function te(e){if(!e)return null;const n=new Date(e);return Number.isNaN(n.getTime())?null:`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`}function ie(e){if(!/^\d{4}-\d{2}$/.test(e||""))return String(e||"");const[n,a]=e.split("-").map(Number);return new Date(Date.UTC(n,a-1,1)).toLocaleDateString("de-DE",{month:"2-digit",year:"numeric"})}function Ee(e){return`month-col ${e%2===1?"month-col-alt":""}`.trim()}function Xe(e){const n=String(e).trim().toLowerCase();return`col-health ${{green:"health-full",light:"health-mostly",orange:"health-partial",red:"health-poor"}[n]||"health-none"}`.trim()}function Qe(e){return e?Array.isArray(e.items)&&e.items.length?e.items.reduce((n,a)=>n+(Number(a.units)||0),0):Number(e.units)||0:0}function et(e,n,a){const o=Number(e||0);if(!Number.isFinite(o))return 0;if(!n||n==="EUR")return o;const s=Number(a||0);return!Number.isFinite(s)||s<=0?o:o/s}function Ne(e){if(!e)return!1;if(typeof e.active=="boolean")return e.active;const n=String(e.status||"").trim().toLowerCase();return n?n==="active"||n==="aktiv":!0}function tt(e){const n=e&&Array.isArray(e.products)?e.products:[],a=e&&Array.isArray(e.productCategories)?e.productCategories:[],o=new Map(a.map(s=>[String(s.id),s]));return n.filter(Ne).map(s=>{const r=s.categoryId?String(s.categoryId):"",u=o.get(r);return{sku:String(s.sku||"").trim(),alias:String(s.alias||s.sku||"").trim(),categoryId:r,categoryName:u&&u.name?u.name:"Ohne Kategorie",categorySort:u&&Number.isFinite(u.sortOrder)?u.sortOrder:0}}).filter(s=>s.sku)}function ce(e){return String(e||"").trim()}function nt(e){const n=e&&Array.isArray(e.products)?e.products:[],a=new Map;return n.forEach(o=>{const s=ce(o&&o.sku).toLowerCase();if(!s)return;const r=ce(o&&o.alias);r&&a.set(s,r)}),a}function at(e,n){const a=new Set;if(Array.isArray(e&&e.items)&&e.items.forEach(r=>{const u=ce(r&&r.sku);u&&a.add(u)}),!a.size){const r=ce(e&&e.sku);r&&a.add(r)}const o=Array.from(a).map(r=>n.get(r.toLowerCase())).filter(Boolean);return{aliases:Array.from(new Set(o)),hasSku:a.size>0}}function st(e){if(!e)return null;const{aliases:n,hasSku:a}=e;if(!n.length)return a?"Alias: —":null;const o=n.slice(0,3),s=n.length>o.length?" …":"";return`${n.length>1?"Aliases":"Alias"}: ${o.join(", ")}${s}`}function ot(e,n=[]){const o=n.slice().sort((r,u)=>{const f=Number.isFinite(r.sortOrder)?r.sortOrder:0,p=Number.isFinite(u.sortOrder)?u.sortOrder:0;return f-p||String(r.name||"").localeCompare(String(u.name||""))}).map(r=>({id:String(r.id),name:r.name||"Ohne Kategorie",items:e.filter(u=>u.categoryId===String(r.id))})),s=e.filter(r=>!r.categoryId);return s.length&&o.push({id:"uncategorized",name:"Ohne Kategorie",items:s}),o.filter(r=>r.items.length)}function le(e){return e!=null&&String(e).trim()!==""}function lt(e,n){const a=((e==null?void 0:e.incomings)||[]).find(s=>(s==null?void 0:s.month)===n);if(a&&(le(a.revenueEur)||le(a.payoutPct)))return!0;const o=e!=null&&e.monthlyActuals&&typeof e.monthlyActuals=="object"?e.monthlyActuals[n]:null;return!!(o&&(le(o.realRevenueEUR)||le(o.realPayoutRatePct)))}const Se={gray:-1,red:0,orange:1,light:2,green:3};function re(e,n){return Se[e]<=Se[n]?e:n}function rt(e,n){return n===0?"gray":e>=q.full?"green":e>=q.wide?"light":e>=q.partial?"orange":"red"}function it(){const e=Ke(Ze,{});return{projectionMode:(e==null?void 0:e.projectionMode)==="doh"?"doh":"units",selectedMonth:(e==null?void 0:e.selectedMonth)||null,showSafety:(e==null?void 0:e.showSafety)!==!1}}function ct(e,n){var o;const a=(((o=e==null?void 0:e.inventory)==null?void 0:o.snapshots)||[]).filter(s=>/^\d{4}-\d{2}$/.test((s==null?void 0:s.month)||"")).slice().sort((s,r)=>String(s.month).localeCompare(String(r.month)));if(n){const s=a.find(r=>r.month===n);if(s)return s}return a.length?a[a.length-1]:null}function me(e,n){var x;const a=tt(e),o=e&&Array.isArray(e.productCategories)?e.productCategories:[],s=new Map,r=new Map,u=a.length,f=it(),p=ct(e,f.selectedMonth),b=((e==null?void 0:e.products)||[]).filter(Ne),l=We({state:e,months:n,products:b,snapshot:p,projectionMode:f.projectionMode}),c=_e(e).bySku,m=Array.isArray(e==null?void 0:e.fixcosts)?e.fixcosts:[],i=Ae(e,{months:n}),g=new Map;i.forEach(v=>{v!=null&&v.month&&(g.has(v.month)||g.set(v.month,[]),g.get(v.month).push(v))});const y=((x=e==null?void 0:e.settings)==null?void 0:x.vatPreview)||{},A=[y.deShareDefault,y.feeRateDefault,y.fixInputDefault].some(v=>v!=null&&String(v).trim()!==""),N=(e==null?void 0:e.vatPreviewMonths)||{};return n.forEach(v=>{var j;let B=0;const w=[];let F=0,C=0,Y=0;a.forEach(H=>{var ne,oe;const t=H.sku,d=(ne=l.perSkuMonth.get(t))==null?void 0:ne.get(v),$=!!(d!=null&&d.hasForecast),L=!!(d!=null&&d.isCovered);if($&&L){B+=1;return}const T=((oe=c==null?void 0:c.get(t.toLowerCase()))==null?void 0:oe.abcClass)||"—",k=f.projectionMode==="doh",_=k?d==null?void 0:d.doh:d==null?void 0:d.endAvailable,K=k?d==null?void 0:d.safetyDays:d==null?void 0:d.safetyUnits;let S="Forecast fehlt";$&&(S=k?`DOH ${X(d==null?void 0:d.doh)} < ${X(d==null?void 0:d.safetyDays)}`:`Units ${X(d==null?void 0:d.endAvailable)} < ${X(d==null?void 0:d.safetyUnits)}`),w.push({sku:t,alias:H.alias,categoryName:H.categoryName,abcClass:T,value:_,safetyValue:K,problem:S}),$||(F+=1),$&&!L&&(C+=1),$&&!L&&((d==null?void 0:d.inboundUnits)||0)===0&&(Y+=1)});const J=u?B/u:0,Q=rt(J,u),h=lt(e,v),U=m.length>0||(g.get(v)||[]).length>0,D=N[v]||{},I=A?[y.deShareDefault,y.feeRateDefault,y.fixInputDefault,D.deShare,D.feeRateOfGross,D.fixInputVat].some(H=>H!=null&&String(H).trim()!==""):!0,R={amazonPayout:!h,fixedCosts:!U,taxes:A&&!I};let z="green";R.taxes&&(z=re(z,"light")),R.fixedCosts&&(z=re(z,"orange")),R.amazonPayout&&(z=re(z,"orange"));const G=u===0?"gray":re(Q,z),O=[];F&&O.push({label:"Absatzprognose ergänzen",href:`#forecast?month=${v}`}),C&&(O.push({label:"Inventory prüfen",href:`#inventory?month=${v}`}),Y&&(O.push({label:"Forecast Orders (FO) planen",href:`#fo?month=${v}`}),O.push({label:"Bestellungen (PO) prüfen",href:`#po?month=${v}`}))),R.amazonPayout&&O.push({label:"Amazon Auszahlung erfassen",href:`#eingaben?month=${v}`}),R.fixedCosts&&O.push({label:"Fixkosten ergänzen",href:`#fixkosten?month=${v}`}),R.taxes&&O.push({label:"USt-Vorschau konfigurieren",href:`#ust?month=${v}`}),s.set(v,G),r.set(v,{monthKey:v,statusKey:G,status:((j=se[G])==null?void 0:j.label)||"—",coverageRatio:J,activeSkus:u,coveredSkus:B,projectionMode:f.projectionMode,missingCritical:R,taxesActive:A,problemSkus:w,todoLinks:O,coverageStatusKey:Q})}),{coverage:s,details:r,activeSkus:a,groups:ot(a,o)}}function ut(e,n){var u,f,p,b;const a=!!((f=(u=e==null?void 0:e.forecast)==null?void 0:u.settings)!=null&&f.useForecast),o=new Map;((e==null?void 0:e.incomings)||[]).forEach(l=>{l!=null&&l.month&&o.set(l.month,l.payoutPct)});const s=new Map;a&&Array.isArray((p=e==null?void 0:e.forecast)==null?void 0:p.items)?(b=e==null?void 0:e.forecast)!=null&&b.forecastImport&&typeof e.forecast.forecastImport=="object"?Object.values(e.forecast.forecastImport).forEach(l=>{Object.entries(l||{}).forEach(([c,m])=>{if(!c||!n.includes(c))return;const i=V((m==null?void 0:m.revenueEur)??(m==null?void 0:m.revenue)??null);Number.isFinite(i)&&s.set(c,(s.get(c)||0)+i)})}):e.forecast.items.forEach(l=>{if(!l||!l.month)return;const c=V(l.revenueEur!=null?l.revenueEur:l.revenue);if(Number.isFinite(c)&&c!==0){s.set(l.month,(s.get(l.month)||0)+c);return}const m=Number(l.qty!=null?l.qty:l.units!=null?l.units:l.quantity!=null?l.quantity:0)||0,i=V(l.priceEur!=null?l.priceEur:l.price!=null?l.price:0);s.set(l.month,(s.get(l.month)||0)+m*i)}):((e==null?void 0:e.incomings)||[]).forEach(l=>{l!=null&&l.month&&s.set(l.month,V(l.revenueEur))});const r=new Map;return n.forEach(l=>{const c=s.get(l)||0;let m=Number(o.get(l)||0)||0;m>1&&(m=m/100);const i=c*m;r.set(l,i)}),r}function dt(e){const n=je();return(e&&Array.isArray(e.pos)?e.pos:[]).map(o=>{const r=He(o,Je,n,(e==null?void 0:e.payments)||[]).map(p=>{const b=te(p.dueDate);if(!b)return null;const l=Number(p.paidEurActual),c=Number.isFinite(l)?l:0;return{id:p.id,month:b,label:p.typeLabel||p.label||"Zahlung",typeLabel:p.typeLabel||p.label||"Zahlung",dueDate:p.dueDate,plannedEur:Number(p.plannedEur||0),actualEur:c,paid:p.status==="paid",paidDate:p.paidDate||null,paymentId:p.paymentId||null,paidBy:p.paidBy||null,currency:"EUR"}}).filter(Boolean),u=o&&o.supplier||o&&o.supplierName||"",f=Qe(o);return{record:o,supplier:u,units:f,events:r,transactions:[]}})}function pt(e){return(e&&Array.isArray(e.fos)?e.fos:[]).filter(a=>String(a&&a.status?a.status:"").toUpperCase()!=="CONVERTED").map(a=>{const o=a&&a.fxRate||e&&e.settings&&e.settings.fxRate||0,s=(a.payments||[]).map(r=>{if(!r||!r.dueDate)return null;const u=te(r.dueDate);if(!u)return null;const f=r.currency||"EUR",p=et(r.amount,f,o);return{id:r.id,month:u,label:r.label||"Payment",typeLabel:r.label||r.category||"Payment",dueDate:r.dueDate,plannedEur:p,actualEur:0,paid:!1,paidBy:null,currency:f}}).filter(Boolean);return{record:a,events:s}})}function ht(e,n,a){let o=0,s=0,r=0,u=0,f=!1;return e.forEach(p=>{if(p.month!==n)return;const b=Number(p.plannedEur||0),l=Number(p.actualEur||0),m=p.paid===!0&&l>0;s+=b,m?(r+=l,o+=l,f=!0,p.paidDate&&te(p.paidDate)===a&&(u+=1)):o+=b}),{value:o,plannedTotal:s,actualTotal:r,displayLabel:de(s,r),warnings:[],paidThisMonthCount:u,hasPaidValue:f}}function ft(e,n,a){let o=0,s=0,r=0,u=0,f=!1;return e.forEach(p=>{if(p.month!==n)return;const b=Number(p.plannedEur||0),l=Number(p.actualEur||0),c=p.paid===!0;s+=b,c&&l>0?(r+=l,o+=l,f=!0,p.paidDate&&te(p.paidDate)===a&&(u+=1)):o+=b}),{value:o,plannedTotal:s,actualTotal:r,displayLabel:de(s,r),warnings:[],paidThisMonthCount:u,hasPaidValue:f}}function P({id:e,label:n,level:a,children:o=[],events:s=[],tooltip:r="",emptyHint:u="",isSummary:f=!1,alwaysVisible:p=!1,sumMode:b="payments",rowType:l="detail",section:c=null,sourceLabel:m=null,nav:i=null}){return{id:e,label:n,level:a,children:o,events:s,tooltip:r,emptyHint:u,isSummary:f,alwaysVisible:p,sumMode:b,rowType:l,section:c,sourceLabel:m,nav:i,values:{}}}function Pe(e,n){return e?e.events&&e.events.some(a=>a.month===n&&(Number(a.plannedEur||0)!==0||Number(a.actualEur||0)!==0))?!0:e.children.some(a=>Pe(a,n)):!1}function Be(e,n){return e.some(a=>{const o=a.values&&a.values[n]&&a.values[n].value||0;return Math.abs(o)>1e-4?!0:Pe(a,n)})}function ve(e,n,a){e.events.length?n.forEach(o=>{const s=e.sumMode==="generic"?ft(e.events,o,a):ht(e.events,o,a);e.values[o]=s}):e.children.length&&(e.children.forEach(o=>ve(o,n,a)),n.forEach(o=>{const s=e.children.reduce((l,c)=>l+(c.values[o]&&c.values[o].value||0),0),r=e.children.reduce((l,c)=>l+(c.values[o]&&c.values[o].plannedTotal||0),0),u=e.children.reduce((l,c)=>l+(c.values[o]&&c.values[o].actualTotal||0),0),f=e.children.flatMap(l=>l.values[o]?l.values[o].warnings||[]:[]),p=e.children.reduce((l,c)=>l+(c.values[o]&&c.values[o].paidThisMonthCount||0),0),b=e.children.some(l=>l.values[o]&&l.values[o].hasPaidValue);e.values[o]={value:s,plannedTotal:r,actualTotal:u,displayLabel:de(r,u),warnings:f,paidThisMonthCount:p,hasPaidValue:b}}))}function gt(e,n){return n.some(a=>Math.abs(e.values[a]&&e.values[a].value||0)>1e-4)}function Z(e,n){const a=e.children.map(r=>Z(r,n)).filter(Boolean);e.children=a;const o=a.length>0,s=gt(e,n);return e.alwaysVisible||e.isSummary||o||s?e:null}function bt(e,n){const a=[];function o(s){if(a.push(s),!!s.children.length&&n.has(s.id)){if(s.children.length>he&&s.level>=2){s.children.slice(0,he).forEach(u=>o(u));const r=s.children.length-he;a.push(P({id:`${s.id}-more`,label:`+ ${r} weitere …`,level:s.level+1,rowType:"detail",section:s.section,sourceLabel:s.sourceLabel}));return}s.children.forEach(r=>o(r))}}return e.forEach(o),a}function ue(e,n,a={}){const o=ut(e,n),s=new Map,r=e&&e.monthlyActuals&&typeof e.monthlyActuals=="object"?e.monthlyActuals:{};Object.entries(r).forEach(([t,d])=>{if(!n.includes(t))return;const $=Number(d&&d.realRevenueEUR),L=Number(d&&d.realPayoutRatePct);!Number.isFinite($)||!Number.isFinite(L)||s.set(t,$*(L/100))});const u=a.coverage instanceof Map?a.coverage:new Map,f=n.map(t=>({id:`amazon-${t}`,month:t,plannedEur:o.get(t)||0,actualEur:s.get(t)||0,paid:s.has(t)})),p=e&&Array.isArray(e.extras)?e.extras:[],b=p.filter(t=>V(t&&t.amountEur)>=0).map(t=>({id:t.id||t.label||t.month,month:t.month||te(t.date),plannedEur:V(t.amountEur),actualEur:V(t.amountEur),paid:!0})).filter(t=>t.month),l=p.filter(t=>V(t&&t.amountEur)<0).map(t=>({id:t.id||t.label||t.month,month:t.month||te(t.date),plannedEur:Math.abs(V(t.amountEur)),actualEur:Math.abs(V(t.amountEur)),paid:!0})).filter(t=>t.month),c=(e&&Array.isArray(e.dividends)?e.dividends:[]).map(t=>({id:t.id||t.label||t.month,month:t.month||te(t.date),plannedEur:Math.abs(V(t.amountEur)),actualEur:Math.abs(V(t.amountEur)),paid:!0})).filter(t=>t.month),i=Ae(e,{months:n}).map(t=>({id:t.id,month:t.month,plannedEur:t.amount,actualEur:t.amount,paid:t.paid===!0,fixedCostId:t.fixedCostId,paidDate:t.paid?t.dueDateIso:null})),y=Ge(e||{}).rows.map(t=>({id:`tax-${t.month}`,month:t.month,plannedEur:Math.max(0,Number(t.payable||0)),actualEur:0,paid:!1})),A=nt(e),N=dt(e),x=pt(e),v=P({id:"amazon-payout",label:"Amazon Auszahlungen",level:1,events:f,sumMode:"generic",rowType:"subtotal",section:"inflows",sourceLabel:"Eingaben",nav:{route:"#eingaben"}}),B=P({id:"other-in",label:"Weitere Einzahlungen",level:1,events:b,sumMode:"generic",rowType:"detail",section:"inflows",sourceLabel:"Eingaben"}),w=P({id:"inflows",label:"Einzahlungen",level:0,children:[v,B],rowType:"section",section:"inflows",sourceLabel:"Einzahlungen"}),F=N.map(t=>{const d=t.record&&t.record.poNo?t.record.poNo:"",$=d?`PO ${d}`:"PO",L=t.events.some(S=>/deposit/i.test(S.typeLabel||"")&&S.paid),T=t.events.some(S=>/balance/i.test(S.typeLabel||"")&&S.paid),k=st(at(t.record,A)),_=[`PO: ${d||"—"}`,`Supplier: ${t.supplier||"—"}`,`Units: ${t.units||0}`,k,`Deposit: ${L?"bezahlt":"offen"}`,`Balance: ${T?"bezahlt":"offen"}`],K=t.events.map(S=>{const ne=[`Typ: ${S.typeLabel||"Zahlung"}`,`Datum: ${S.dueDate||"—"}`,`Ist EUR: ${be(S.actualEur||0)}`,k,S.currency?`Währung: ${S.currency}`:null,S.paidBy?`Paid by: ${S.paidBy}`:null].filter(Boolean).join(" · ");return P({id:`po-${t.record&&t.record.id||$}-${S.id}`,label:S.typeLabel||S.label||"Zahlung",level:3,events:[S],tooltip:ne,rowType:"detail",section:"outflows",sourceLabel:"PO Zahlung",nav:{route:"#po",open:t.record&&(t.record.id||t.record.poNo)||"",focus:S.typeLabel?`payment:${S.typeLabel}`:null}})});return P({id:`po-${t.record&&t.record.id||$}`,label:$,level:2,children:K,events:[],tooltip:_.join(" · "),rowType:"detail",section:"outflows",sourceLabel:"PO",nav:{route:"#po",open:t.record&&(t.record.id||t.record.poNo)||""}})}),C=P({id:"po-payments",label:"PO Zahlungen",level:1,children:F,alwaysVisible:!0,rowType:"subtotal",section:"outflows",sourceLabel:"PO Zahlungen"}),Y=x.map(t=>{const d=t.record&&t.record.foNo?t.record.foNo:"",$=d?`FO ${d}`:"FO",L=[`FO: ${d||t.record&&t.record.id||"—"}`,`SKU: ${t.record&&t.record.sku||"—"}`,`Units: ${t.record&&t.record.units||0}`,`ETA: ${t.record&&(t.record.etaDate||t.record.targetDeliveryDate)||"—"}`,`Status: ${t.record&&t.record.status||"—"}`].join(" · "),T=t.events.map(k=>{const _=[`Typ: ${k.typeLabel||"Payment"}`,`Datum: ${k.dueDate||"—"}`,`Ist EUR: ${be(k.actualEur||0)}`,k.currency?`Währung: ${k.currency}`:null].filter(Boolean).join(" · ");return P({id:`fo-${t.record&&t.record.id||$}-${k.id}`,label:k.typeLabel||k.label||"Payment",level:3,events:[k],tooltip:_,rowType:"detail",section:"outflows",sourceLabel:"FO Zahlung",nav:{route:"#fo",open:t.record&&(t.record.id||t.record.foNo)||""}})});return P({id:`fo-${t.record&&t.record.id||$}`,label:$,level:2,children:T,events:[],tooltip:L,rowType:"detail",section:"outflows",sourceLabel:"FO",nav:{route:"#fo",open:t.record&&(t.record.id||t.record.foNo)||""}})}),J=P({id:"fo-payments",label:"FO Zahlungen",level:1,children:Y,alwaysVisible:!0,rowType:"subtotal",section:"outflows",sourceLabel:"FO Zahlungen"}),Q=P({id:"fixcosts",label:"Fixkosten",level:1,events:i,sumMode:"generic",alwaysVisible:!0,emptyHint:"Keine Fixkosten vorhanden.",rowType:"detail",section:"outflows",sourceLabel:"Fixkosten",nav:{route:"#fixkosten"}}),h=P({id:"taxes",label:"Steuern",level:1,events:y,sumMode:"generic",alwaysVisible:!0,emptyHint:"Keine Steuerdaten hinterlegt.",rowType:"detail",section:"outflows",sourceLabel:"Steuern"}),U=P({id:"dividends",label:"Dividende",level:1,events:c,sumMode:"generic",alwaysVisible:!0,emptyHint:"Keine Dividenden erfasst.",rowType:"detail",section:"outflows",sourceLabel:"Dividende"}),D=P({id:"other-out",label:"Weitere Auszahlungen",level:1,events:l,sumMode:"generic",alwaysVisible:!0,emptyHint:"Keine weiteren Auszahlungen vorhanden.",rowType:"detail",section:"outflows",sourceLabel:"Auszahlungen"}),I=P({id:"outflows",label:"Auszahlungen",level:0,children:[C,J,Q,h,U,D],rowType:"section",section:"outflows",sourceLabel:"Auszahlungen"});ve(w,n,a.currentMonth),ve(I,n,a.currentMonth);const R=P({id:"net-cashflow",label:"Netto Cashflow",level:0,isSummary:!0,alwaysVisible:!0,rowType:"summary",section:"summary",sourceLabel:"Netto Cashflow"});n.forEach(t=>{const d=w.values[t]&&w.values[t].value||0,$=I.values[t]&&I.values[t].value||0,L=(w.values[t]&&w.values[t].plannedTotal||0)-(I.values[t]&&I.values[t].plannedTotal||0),T=(w.values[t]&&w.values[t].actualTotal||0)-(I.values[t]&&I.values[t].actualTotal||0);R.values[t]={value:d-$,plannedTotal:L,actualTotal:T,displayLabel:de(Math.abs(L),Math.abs(T)),warnings:[],paidThisMonthCount:0}});const z=$e(e&&e.openingEur,$e(e&&e.settings&&e.settings.openingBalance,null)),G=V(z||0),O=e&&e.monthlyActuals&&typeof e.monthlyActuals=="object"?e.monthlyActuals:{},j=P({id:"balance",label:"Kontostand Monatsende",level:0,isSummary:!0,alwaysVisible:!0,rowType:"summary",section:"summary",sourceLabel:"Kontostand"});if(n.length){let t=G;const d=a.limitBalanceToGreen?Math.max(-1,...n.map(($,L)=>u.get($)==="green"?L:-1)):n.length-1;n.forEach(($,L)=>{const T=Number(O[$]&&O[$].realClosingBalanceEUR),k=Number.isFinite(T),_=R.values[$]&&R.values[$].value||0,K=(Number.isFinite(t)?t:0)+_;if(a.limitBalanceToGreen&&L>d){j.values[$]={value:null,plannedTotal:0,actualTotal:0,displayLabel:"Plan",warnings:[],paidThisMonthCount:0};return}const S=k?T:K;j.values[$]={value:S,plannedTotal:K,actualTotal:k?T:K,displayLabel:k?"Ist":"Plan",warnings:[],paidThisMonthCount:0,isActual:k},t=k?T:K})}return{inflowRow:w,outflowRow:I,summaryRows:[R,j]}}function mt(e){const n=e&&e.settings&&e.settings.startMonth||"2025-01",a=Number(e&&e.settings&&e.settings.horizonMonths||12)||12,o=we(n,a-1),s=Te(n,o),r=Ce();ye(M.range)||(M.range=ge);const u=ke(s,M.range,r),f=me(e,u),p=f.details,b=ue(e,u,{limitBalanceToGreen:M.limitBalanceToGreen,currentMonth:r,coverage:f.coverage}),l=Z(b.inflowRow,u),c=Z(b.outflowRow,u),m=[l,c,...b.summaryRows].filter(Boolean),i=M.hideEmptyMonths?u.filter(h=>Be(m,h)):u.slice(),{inflowRow:g,outflowRow:y,summaryRows:A}=ue(e,i,{limitBalanceToGreen:M.limitBalanceToGreen,currentMonth:r,coverage:f.coverage}),N=Z(g,i),x=Z(y,i),v=[N,x,...A].filter(Boolean),B=bt(v,M.expanded);f.activeSkus.length>0&&i.some(h=>f.coverage.get(h)!=="green");const w=`
      <label class="dashboard-range">
        <span>Zeitraum</span>
        <select id="dashboard-range">
          ${Re.map(h=>`<option value="${h.value}" ${h.value===M.range?"selected":""}>${h.label}</option>`).join("")}
        </select>
      </label>
    `,F=i.map(h=>{var D;const U=((D=p.get(h))==null?void 0:D.statusKey)||"gray";return Xe(U)}),C=i.map((h,U)=>{var t;const D=Ee(U),I=F[U]||"col-health health-none",R=f.details.get(h)||{},G=(p.get(h)||{}).statusKey||R.statusKey||"gray",O=Number.isFinite(R.activeSkus)?R.activeSkus:0,j=((t=se[G])==null?void 0:t.label)||"—",H=[`Status: ${j}`,`Abdeckung: ${R.coveredSkus||0}/${O} (${W(R.coverageRatio||0)})`].filter(Boolean).join(`
`);return`
        <th scope="col" class="${D} ${I}" data-col-index="${U}">
          <button type="button" class="coverage-indicator coverage-${G} coverage-button" data-coverage-month="${E(h)}" data-health-month="${E(h)}" title="${E(H)}" aria-label="Reifegrad ${E(ie(h))}: ${E(j)}"></button>
          <span class="month-header-label">
            <button type="button" class="month-header-trigger" data-health-month="${E(h)}">
              ${E(ie(h))}
            </button>
          </span>
        </th>
      `}).join(""),Y='<th scope="col" class="dashboard-compare-header">Kontostand Plan/Ist</th>',J=B.map(h=>{const U=h.children.length>0,D=M.expanded.has(h.id),I=`tree-level-${h.level}`,R=U?`<button type="button" class="tree-toggle" data-row-id="${E(h.id)}" aria-expanded="${D}">${D?"▼":"▶"}</button>`:'<span class="tree-spacer" aria-hidden="true"></span>',z=h.tooltip||h.emptyHint||"",G=[h.rowType==="section"?"row-section":"",h.rowType==="subtotal"?"row-subtotal":"",h.rowType==="summary"?"row-summary":"",h.rowType==="detail"?"row-detail":"",h.section?`section-${h.section}`:""].filter(Boolean).join(" "),O=`
        <td class="tree-cell ${I} ${h.isSummary?"tree-summary":""}" title="${E(z)}">
          ${R}
          <span class="tree-label">${E(h.label)}</span>
        </td>
      `,j=i.map((t,d)=>{const $=Ee(d),L=F[d]||"col-health health-none",T=h.values[t]||{value:0},_=h.id==="balance"&&f.coverage.get(t)!=="green"?'<span class="cell-balance-warning" title="Kontostand kann unvollständig sein, da Planung fehlt.">⚠︎</span>':"",K=xe(T.value),S=t===r&&(T.paidThisMonthCount||0)>0;S&&`${T.paidThisMonthCount}`;const ne=T.hasPaidValue&&String(h.sourceLabel||"").toLowerCase().includes("po"),oe=T.isActual?'<span class="cell-actual-tag" title="Realer Wert">Ist</span>':"",Oe=[`Plan/Ist: ${ae(T.plannedTotal)} / ${ae(T.actualTotal)}`,`Status: ${T.displayLabel||"Plan"}`].filter(Boolean).join(`
`),Ie=h.id==="balance"&&T.isActual?`<div class="balance-detail"><span>Plan: ${ae(T.plannedTotal)}</span><span>Ist: ${ae(T.actualTotal)}</span></div>`:"",pe=h.nav&&!K.isEmpty,De=h.nav?encodeURIComponent(JSON.stringify({...h.nav,month:t})):"";return`
            <td class="num ${h.isSummary?"tree-summary":""} ${S?"cell-paid-current":""} ${pe?"cell-link":""} ${$} ${L}" ${pe?`data-nav="${De}"`:""} data-col-index="${d}" title="${E(Oe)}">
              ${_}
              <span class="${K.isEmpty?"cell-empty":""} ${ne?"cell-paid-value":""}">${K.text}</span>
              ${Ie}
              ${oe}
              ${pe?'<span class="cell-link-icon" aria-hidden="true">↗</span>':""}
            </td>
          `}).join(""),H=(()=>{if(h.id!=="balance")return'<td class="num dashboard-compare-cell muted">—</td>';const t=i.slice().reverse().find($=>{var L;return(L=h.values[$])==null?void 0:L.isActual});if(!t)return'<td class="num dashboard-compare-cell muted">—</td>';const d=h.values[t]||{};return`
          <td class="num dashboard-compare-cell">
            <div class="balance-compare">
              <span>Plan: ${ae(d.plannedTotal)}</span>
              <span>Ist: ${ae(d.actualTotal)}</span>
              <span class="muted">${E(ie(t))}</span>
            </div>
          </td>
        `})();return`<tr data-row-id="${E(h.id)}" class="${G}">${O}${j}${H}</tr>`}).join("");return`
    <section class="dashboard">
      <div class="dashboard-header">
        <div class="dashboard-topline">
          <div class="dashboard-title-block">
            <h2>Dashboard</h2>
            <p class="muted">Planwerte werden durch Ist ersetzt, sobald Zahlungen verbucht sind. Drilldowns zeigen PO/FO-Events.</p>
          </div>
          <div class="dashboard-range-slot">
            ${w}
          </div>
        </div>
        <div class="dashboard-toolbar">
          <div class="dashboard-toggle" role="group" aria-label="Expand">
            <button type="button" class="btn secondary" data-expand="collapse">Alles zu</button>
            <button type="button" class="btn secondary" data-expand="expand">Alles auf</button>
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
      
      <div class="dashboard-table-wrap">
        <div class="dashboard-table-scroll">
          <table class="table-compact dashboard-tree-table" role="table" data-ui-table="true" data-sticky-cols="1">
            <thead>
              <tr>
                <th scope="col" class="tree-header">Kategorie / Zeile</th>
                ${C}
                ${Y}
              </tr>
            </thead>
            <tbody>
              ${J||`
                <tr>
                  <td colspan="${i.length+2}" class="muted">Keine Daten vorhanden.</td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `}function vt(){const e=`Schwellen: Vollständig ${W(q.full)}, Weitgehend ≥${W(q.wide)}, Teilweise ≥${W(q.partial)}.`,n=["green","light","orange","red"].map(a=>`
      <li class="dashboard-detail-item">
        <span class="coverage-indicator coverage-${a}"></span>
        <div>
          <strong>${E(se[a].label)}</strong>
          <div class="muted small">${E(se[a].detail)}</div>
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
  `}function yt(e){var w,F;if(!e)return"";const n=e.statusKey||"gray",a=e.status||((w=se[n])==null?void 0:w.label)||"—",o=ie(e.monthKey),s=Number(e.activeSkus||0),r=Number(e.coveredSkus||0),u=Number(e.coverageRatio||0),f=e.missingCritical||{},p=!!e.taxesActive,b=e.projectionMode==="doh"?"doh":"units",l=b==="doh"?"DOH":"Units",c=b==="doh"?"Safety DOH":"Safety Units",m=s>0&&u>=q.full,i=[{label:"Inventory Coverage ok?",description:`${r}/${s} aktive SKUs abgedeckt (${W(u)}).`,passed:m},{label:"Amazon payouts vorhanden?",description:"Amazon-Auszahlungen für den Monat sind erfasst.",passed:!f.amazonPayout},{label:"Fixkosten vorhanden?",description:"Fixkosten für den Monat sind gepflegt.",passed:!f.fixedCosts},{label:"Steuer-Config ok?",description:p?"USt-Vorschau ist konfiguriert.":"USt-Vorschau ist nicht aktiv.",passed:p?!f.taxes:!0}],g=`Schwellen: Vollständig ≥${W(q.full)}, Weitgehend ≥${W(q.wide)}, Teilweise ≥${W(q.partial)}.`,y=Array.isArray(e.todoLinks)?e.todoLinks:[],N=n!=="green"&&y.length>0?y.map(C=>`
      <li>
        <a href="${E(C.href)}" class="btn ghost btn-small" data-panel-link>${E(C.label)}</a>
      </li>
    `).join(""):'<li class="muted small">Keine To-Dos.</li>',x=(e.problemSkus||[]).map(C=>`
      <tr>
        <td>${E(C.sku)}</td>
        <td>${E(C.alias||"—")}</td>
        <td class="muted">${E(C.abcClass||"—")}</td>
        <td class="num">${X(C.value)}</td>
        <td class="num">${X(C.safetyValue)}</td>
        <td>${E(C.problem||"—")}</td>
      </tr>
    `).join(""),v=x?`
      <table class="dashboard-detail-table" data-ui-table="true">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Alias</th>
            <th>ABC</th>
            <th class="num">${E(l)}</th>
            <th class="num">${E(c)}</th>
            <th>Problem</th>
          </tr>
        </thead>
        <tbody>
          ${x}
        </tbody>
      </table>
    `:'<div class="muted">Keine problematischen SKUs.</div>',B=i.map(C=>`
      <li class="dashboard-detail-item ${C.passed?"detail-pass":"detail-fail"}">
        <span class="detail-check">${C.passed?"✓":"✕"}</span>
        <div>
          <strong>${E(C.label)}</strong>
          <div class="muted small">${E(C.description)}</div>
        </div>
      </li>
    `).join("");return`
    <div class="dashboard-side-panel" role="dialog" aria-modal="true" aria-label="Monats-Details">
      <header class="dashboard-side-panel-header">
        <div>
          <h3>Monat ${E(o)} – Status: ${E(a)}</h3>
          <div class="dashboard-side-panel-subtitle">
            <span class="coverage-indicator coverage-${n}"></span>
            <span>${E(((F=se[n])==null?void 0:F.detail)||"")}</span>
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
              <strong>${X(s)}</strong>
            </div>
            <div>
              <span class="muted">Abgedeckte SKUs</span>
              <strong>${X(r)}</strong>
            </div>
            <div>
              <span class="muted">Coverage Ratio</span>
              <strong>${W(u)}</strong>
            </div>
          </div>
          <div class="muted small">${E(g)}</div>
        </section>
        <section class="dashboard-side-panel-section">
          <h4>Checklist</h4>
          <ul class="dashboard-detail-list">
            ${B}
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
  `}function $t(){let e=document.getElementById("global-chart-tip");return e||(e=document.createElement("div"),e.id="global-chart-tip",e.className="chart-tip",e.hidden=!0,document.body.appendChild(e)),e}$t();function Et(e,n){const a=b=>{const l=document.querySelector(".dashboard-modal-backdrop");l&&l.remove();const c=document.createElement("div");c.className="po-modal-backdrop dashboard-modal-backdrop",c.innerHTML=b,document.body.appendChild(c);const m=()=>{document.removeEventListener("keydown",i),c.remove()},i=g=>{g.key==="Escape"&&m()};c.addEventListener("click",g=>{if(g.target.closest("[data-close]")){m();return}if(g.target===c){m();return}const A=g.target.closest("[data-fix-route]");if(!A)return;const N=A.getAttribute("data-fix-route");if(!N)return;const x=new URLSearchParams,v=A.getAttribute("data-fix-sku"),B=A.getAttribute("data-fix-month");v&&x.set("sku",v),B&&x.set("month",B),location.hash=x.toString()?`${N}?${x.toString()}`:N,m()}),document.addEventListener("keydown",i)},o=b=>{const l=document.querySelector(".dashboard-side-panel-backdrop");l&&l.remove();const c=document.createElement("div");c.className="dashboard-side-panel-backdrop",c.innerHTML=b,document.body.appendChild(c);const m=()=>{document.removeEventListener("keydown",i),c.remove()},i=g=>{g.key==="Escape"&&m()};c.addEventListener("click",g=>{if(g.target.closest("[data-close]")){m();return}if(g.target===c){m();return}g.target.closest("[data-panel-link]")&&m()}),document.addEventListener("keydown",i)};e.querySelectorAll("[data-expand]").forEach(b=>{b.addEventListener("click",()=>{const l=b.getAttribute("data-expand"),c=n&&n.settings&&n.settings.startMonth||"2025-01",m=Number(n&&n.settings&&n.settings.horizonMonths||12)||12,i=we(c,m-1),g=Ce(),y=Te(c,i),A=ke(y,M.range,g),N=me(n,A),x=ue(n,A,{limitBalanceToGreen:M.limitBalanceToGreen,currentMonth:g,coverage:N.coverage}),v=[Z(x.inflowRow,A),Z(x.outflowRow,A),...x.summaryRows].filter(Boolean),B=M.hideEmptyMonths?A.filter(h=>Be(v,h)):A,{inflowRow:w,outflowRow:F,summaryRows:C}=ue(n,B,{limitBalanceToGreen:M.limitBalanceToGreen,currentMonth:g,coverage:N.coverage}),Y=[Z(w,B),Z(F,B),...C].filter(Boolean),J=collectExpandableIds(Y),Q=N.groups||[];l==="collapse"?(M.expanded=new Set,M.coverageCollapsed=new Set(Q.map(h=>h.id))):(M.expanded=new Set(J),M.coverageCollapsed=new Set),ee(e)})});const s=e.querySelector("#dashboard-hide-empty");s&&s.addEventListener("change",()=>{M.hideEmptyMonths=s.checked,ee(e)});const r=e.querySelector("#dashboard-limit-balance");r&&r.addEventListener("change",()=>{M.limitBalanceToGreen=r.checked,ee(e)});const u=e.querySelector("#dashboard-legend-info");u&&u.addEventListener("click",()=>{a(vt())}),e.querySelectorAll("[data-health-month]").forEach(b=>{b.addEventListener("click",()=>{const l=b.getAttribute("data-health-month");if(!l)return;const c=Array.from(e.querySelectorAll("[data-coverage-month]")).map(g=>g.getAttribute("data-coverage-month")).filter(Boolean),i=me(n,c).details.get(l);i&&o(yt(i))})});const f=e.querySelector(".dashboard-tree-table");if(f){let b=null;const l=()=>{b!=null&&(f.querySelectorAll(`[data-col-index="${b}"]`).forEach(i=>{i.classList.remove("is-col-hover")}),b=null)},c=i=>{i==null||i===b||(l(),f.querySelectorAll(`[data-col-index="${i}"]`).forEach(g=>{g.classList.add("is-col-hover")}),b=i)};f.addEventListener("mouseover",i=>{const g=i.target.closest("[data-col-index]");!g||!f.contains(g)||c(g.getAttribute("data-col-index"))}),f.addEventListener("mouseleave",()=>{l()}),f.addEventListener("click",i=>{const g=i.target.closest("button.tree-toggle[data-row-id]");if(!g)return;const y=g.getAttribute("data-row-id");y&&(M.expanded.has(y)?M.expanded.delete(y):M.expanded.add(y),ee(e))});const m=i=>{if(!i||!i.route)return;const g=new URLSearchParams;i.open&&g.set("open",i.open),i.focus&&g.set("focus",i.focus),i.month&&g.set("month",i.month);const y=g.toString();location.hash=y?`${i.route}?${y}`:i.route};f.addEventListener("dblclick",i=>{const g=i.target.closest("td[data-nav]");if(!g)return;const y=g.getAttribute("data-nav");if(y)try{const A=JSON.parse(decodeURIComponent(y));m(A)}catch{}}),f.addEventListener("click",i=>{const g=i.target.closest(".cell-link-icon");if(!g)return;const y=g.closest("td[data-nav]");if(!y)return;const A=y.getAttribute("data-nav");if(A)try{const N=JSON.parse(decodeURIComponent(A));m(N)}catch{}})}const p=e.querySelector("#dashboard-range");p&&p.addEventListener("change",()=>{M.range=p.value;try{ye(M.range)&&ze(Le,M.range)}catch{}ee(e)})}let fe=null,Me=null;function ee(e){fe=e;const n=Fe();e.innerHTML=mt(n),Et(e,n),Me||(Me=Ve(()=>{location.hash.replace("#","")==="dashboard"&&fe&&ee(fe)}))}const Pt={render:ee};export{Pt as default,ee as render};
