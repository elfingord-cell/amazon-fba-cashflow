import { createEmptyState, saveState } from "../data/storageLocal.js";

function buildDemoState(){
  const demo = createEmptyState();

  demo.settings = {
    startMonth: "2024-10",
    horizonMonths: 18,
    openingBalance: "120.000,00",
    fxRate: 1.08,
    fxFeePct: "0,5",
    dutyRatePct: "6,5",
    dutyIncludeFreight: true,
    eustRatePct: "19",
    vatRefundEnabled: true,
    vatRefundLagMonths: 2,
    freightLagDays: 14,
  };

  demo.incomings = [
    { month: "2024-10", revenueEur: "98.000,00", payoutPct: "50" },
    { month: "2024-11", revenueEur: "82.500,00", payoutPct: "49" },
    { month: "2024-12", revenueEur: "135.000,00", payoutPct: "51" },
    { month: "2025-01", revenueEur: "92.000,00", payoutPct: "50" },
    { month: "2025-02", revenueEur: "108.000,00", payoutPct: "48" },
    { month: "2025-03", revenueEur: "94.500,00", payoutPct: "49" },
    { month: "2025-04", revenueEur: "102.000,00", payoutPct: "50" },
    { month: "2025-05", revenueEur: "87.500,00", payoutPct: "51" },
    { month: "2025-06", revenueEur: "118.000,00", payoutPct: "48" },
    { month: "2025-07", revenueEur: "126.500,00", payoutPct: "49" },
    { month: "2025-08", revenueEur: "79.500,00", payoutPct: "50" },
    { month: "2025-09", revenueEur: "115.500,00", payoutPct: "48" },
    { month: "2025-10", revenueEur: "73.000,00", payoutPct: "51" },
  ];

  demo.extras = [
    { date: "2024-12-20", label: "Weihnachtsbonus", amountEur: "5.200,00" },
    { date: "2025-03-15", label: "Steuererstattung", amountEur: "7.500,00" },
    { date: "2025-05-10", label: "Marketing-Offensive", amountEur: "-6.800,00" },
  ];

  demo.fixcosts = [
    {
      id: "fix-steuerberatung",
      name: "Steuerberatung",
      category: "Steuerberatung",
      amount: "2.400,00",
      frequency: "monthly",
      intervalMonths: 1,
      anchor: "15",
      startMonth: "2024-10",
      endMonth: "",
      proration: { enabled: false, method: "none" },
      autoPaid: true,
      notes: "Monatliches Honorar",
    },
    {
      id: "fix-ventory",
      name: "Ventory One Lizenz",
      category: "Lizenz",
      amount: "1.350,00",
      frequency: "monthly",
      intervalMonths: 1,
      anchor: "1",
      startMonth: "2024-10",
      endMonth: "",
      proration: { enabled: false, method: "none" },
      autoPaid: false,
      notes: "Softwarelizenz",
    },
    {
      id: "fix-lager",
      name: "Lager & Logistik",
      category: "Miete",
      amount: "5.800,00",
      frequency: "monthly",
      intervalMonths: 1,
      anchor: "LAST",
      startMonth: "2024-10",
      endMonth: "",
      proration: { enabled: false, method: "none" },
      autoPaid: true,
      notes: "Lagerhalle inkl. Nebenkosten",
    },
    {
      id: "fix-versicherung",
      name: "Betriebsversicherung",
      category: "Versicherung",
      amount: "2.400,00",
      frequency: "quarterly",
      intervalMonths: 3,
      anchor: "15",
      startMonth: "2024-10",
      endMonth: "",
      proration: { enabled: false, method: "none" },
      autoPaid: false,
      notes: "Quartalsweise Prämie",
    },
  ];

  demo.fixcostOverrides = {
    "fix-steuerberatung": {
      "2024-12": { amount: "3.800,00", note: "Jahresabschluss" },
    },
    "fix-lager": {
      "2025-07": { amount: "6.300,00", note: "Index-Anpassung", dueDate: "2025-07-25" },
    },
    "fix-versicherung": {
      "2025-04": { amount: "2.800,00", note: "Police erweitert" },
    },
  };

  demo.dividends = [
    { month: "2025-06", label: "Dividende", amountEur: "-12.500,00" },
    { month: "2025-06", label: "KapESt", amountEur: "-3.200,00" },
    { month: "2025-09", label: "Dividende", amountEur: "-15.000,00" },
    { month: "2025-09", label: "KapESt", amountEur: "-3.800,00" },
  ];

  demo.pos = [
    {
      id: "po-demo-2024-10",
      poNo: "24010",
      orderDate: "2024-10-05",
      goodsEur: "24.500,00",
      freightEur: "3.200,00",
      prodDays: 40,
      transport: "sea",
      transitDays: 55,
      ddp: false,
      dutyRatePct: "6,5",
      dutyIncludeFreight: true,
      eustRatePct: "19",
      vatRefundLagMonths: 2,
      vatRefundEnabled: true,
      fxFeePct: "0,5",
      milestones: [
        { id: "po-demo-2024-10-ms1", label: "Deposit", percent: 35, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2024-10-ms2", label: "Production", percent: 25, anchor: "PROD_DONE", lagDays: 0 },
        { id: "po-demo-2024-10-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 5 },
      ],
    },
    {
      id: "po-demo-2024-11",
      poNo: "24011",
      orderDate: "2024-11-07",
      goodsEur: "23.800,00",
      freightEur: "2.800,00",
      prodDays: 32,
      transport: "rail",
      transitDays: 30,
      ddp: false,
      dutyRatePct: "6,5",
      dutyIncludeFreight: true,
      eustRatePct: "19",
      vatRefundLagMonths: 2,
      vatRefundEnabled: true,
      fxFeePct: "0,5",
      milestones: [
        { id: "po-demo-2024-11-ms1", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2024-11-ms2", label: "Production", percent: 30, anchor: "PROD_DONE", lagDays: 2 },
        { id: "po-demo-2024-11-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 4 },
      ],
    },
    {
      id: "po-demo-2024-12",
      poNo: "24012",
      orderDate: "2024-12-03",
      goodsEur: "27.200,00",
      freightEur: "3.000,00",
      prodDays: 28,
      transport: "air",
      transitDays: 12,
      ddp: false,
      dutyRatePct: "6,5",
      dutyIncludeFreight: true,
      eustRatePct: "19",
      vatRefundLagMonths: 2,
      vatRefundEnabled: true,
      fxFeePct: "0,5",
      milestones: [
        { id: "po-demo-2024-12-ms1", label: "Deposit", percent: 40, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2024-12-ms2", label: "Inspection", percent: 25, anchor: "PROD_DONE", lagDays: 1 },
        { id: "po-demo-2024-12-ms3", label: "Balance", percent: 35, anchor: "ETA", lagDays: 2 },
      ],
    },
    {
      id: "po-demo-2025-01",
      poNo: "25001",
      orderDate: "2025-01-10",
      goodsEur: "28.600,00",
      freightEur: "3.600,00",
      prodDays: 36,
      transport: "sea",
      transitDays: 50,
      ddp: false,
      dutyRatePct: "6,5",
      dutyIncludeFreight: true,
      eustRatePct: "19",
      vatRefundLagMonths: 2,
      vatRefundEnabled: true,
      fxFeePct: "0,5",
      milestones: [
        { id: "po-demo-2025-01-ms1", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2025-01-ms2", label: "Production", percent: 30, anchor: "PROD_DONE", lagDays: 0 },
        { id: "po-demo-2025-01-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 6 },
      ],
    },
    {
      id: "po-demo-2025-02",
      poNo: "25002",
      orderDate: "2025-02-06",
      goodsEur: "26.400,00",
      freightEur: "3.100,00",
      prodDays: 34,
      transport: "rail",
      transitDays: 28,
      ddp: false,
      dutyRatePct: "6,5",
      dutyIncludeFreight: true,
      eustRatePct: "19",
      vatRefundLagMonths: 2,
      vatRefundEnabled: true,
      fxFeePct: "0,5",
      milestones: [
        { id: "po-demo-2025-02-ms1", label: "Deposit", percent: 35, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2025-02-ms2", label: "Production", percent: 25, anchor: "PROD_DONE", lagDays: 0 },
        { id: "po-demo-2025-02-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 4 },
      ],
    },
    {
      id: "po-demo-2025-03",
      poNo: "25003",
      orderDate: "2025-03-04",
      goodsEur: "29.100,00",
      freightEur: "3.300,00",
      prodDays: 33,
      transport: "sea",
      transitDays: 54,
      ddp: false,
      dutyRatePct: "6,5",
      dutyIncludeFreight: true,
      eustRatePct: "19",
      vatRefundLagMonths: 2,
      vatRefundEnabled: true,
      fxFeePct: "0,5",
      milestones: [
        { id: "po-demo-2025-03-ms1", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2025-03-ms2", label: "Production", percent: 30, anchor: "PROD_DONE", lagDays: 3 },
        { id: "po-demo-2025-03-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 5 },
      ],
    },
    {
      id: "po-demo-2025-04",
      poNo: "25004",
      orderDate: "2025-04-08",
      goodsEur: "30.500,00",
      freightEur: "3.500,00",
      prodDays: 31,
      transport: "rail",
      transitDays: 29,
      ddp: false,
      dutyRatePct: "6,5",
      dutyIncludeFreight: true,
      eustRatePct: "19",
      vatRefundLagMonths: 2,
      vatRefundEnabled: true,
      fxFeePct: "0,5",
      milestones: [
        { id: "po-demo-2025-04-ms1", label: "Deposit", percent: 32, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2025-04-ms2", label: "Production", percent: 28, anchor: "PROD_DONE", lagDays: 2 },
        { id: "po-demo-2025-04-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 3 },
      ],
    },
    {
      id: "po-demo-2025-05",
      poNo: "25005",
      orderDate: "2025-05-09",
      goodsEur: "27.900,00",
      freightEur: "3.000,00",
      prodDays: 29,
      transport: "air",
      transitDays: 13,
      ddp: false,
      dutyRatePct: "6,5",
      dutyIncludeFreight: true,
      eustRatePct: "19",
      vatRefundLagMonths: 2,
      vatRefundEnabled: true,
      fxFeePct: "0,5",
      milestones: [
        { id: "po-demo-2025-05-ms1", label: "Deposit", percent: 38, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2025-05-ms2", label: "Production", percent: 22, anchor: "PROD_DONE", lagDays: 1 },
        { id: "po-demo-2025-05-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 2 },
      ],
    },
    {
      id: "po-demo-2025-06",
      poNo: "25006",
      orderDate: "2025-06-06",
      goodsEur: "31.200,00",
      freightEur: "3.400,00",
      prodDays: 35,
      transport: "sea",
      transitDays: 56,
      ddp: false,
      dutyRatePct: "6,5",
      dutyIncludeFreight: true,
      eustRatePct: "19",
      vatRefundLagMonths: 2,
      vatRefundEnabled: true,
      fxFeePct: "0,5",
      milestones: [
        { id: "po-demo-2025-06-ms1", label: "Deposit", percent: 34, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2025-06-ms2", label: "Production", percent: 26, anchor: "PROD_DONE", lagDays: 3 },
        { id: "po-demo-2025-06-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 5 },
      ],
    },
    {
      id: "po-demo-2025-07",
      poNo: "25007",
      orderDate: "2025-07-04",
      goodsEur: "28.800,00",
      freightEur: "2.900,00",
      prodDays: 30,
      transport: "rail",
      transitDays: 27,
      ddp: false,
      dutyRatePct: "6,5",
      dutyIncludeFreight: true,
      eustRatePct: "19",
      vatRefundLagMonths: 2,
      vatRefundEnabled: true,
      fxFeePct: "0,5",
      milestones: [
        { id: "po-demo-2025-07-ms1", label: "Deposit", percent: 36, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2025-07-ms2", label: "Inspection", percent: 24, anchor: "PROD_DONE", lagDays: 2 },
        { id: "po-demo-2025-07-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 3 },
      ],
    },
    {
      id: "po-demo-2025-08",
      poNo: "25008",
      orderDate: "2025-08-05",
      goodsEur: "26.700,00",
      freightEur: "2.700,00",
      prodDays: 28,
      transport: "air",
      transitDays: 11,
      ddp: false,
      dutyRatePct: "6,5",
      dutyIncludeFreight: true,
      eustRatePct: "19",
      vatRefundLagMonths: 2,
      vatRefundEnabled: true,
      fxFeePct: "0,5",
      milestones: [
        { id: "po-demo-2025-08-ms1", label: "Deposit", percent: 37, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2025-08-ms2", label: "Production", percent: 23, anchor: "PROD_DONE", lagDays: 1 },
        { id: "po-demo-2025-08-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 1 },
      ],
    },
    {
      id: "po-demo-2025-09",
      poNo: "25009",
      orderDate: "2025-09-09",
      goodsEur: "29.400,00",
      freightEur: "3.100,00",
      prodDays: 32,
      transport: "sea",
      transitDays: 57,
      ddp: false,
      dutyRatePct: "6,5",
      dutyIncludeFreight: true,
      eustRatePct: "19",
      vatRefundLagMonths: 2,
      vatRefundEnabled: true,
      fxFeePct: "0,5",
      milestones: [
        { id: "po-demo-2025-09-ms1", label: "Deposit", percent: 34, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2025-09-ms2", label: "Production", percent: 26, anchor: "PROD_DONE", lagDays: 3 },
        { id: "po-demo-2025-09-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 4 },
      ],
    },
    {
      id: "po-demo-2025-10",
      poNo: "25010",
      orderDate: "2025-10-06",
      goodsEur: "27.500,00",
      freightEur: "2.800,00",
      prodDays: 29,
      transport: "rail",
      transitDays: 28,
      ddp: false,
      dutyRatePct: "6,5",
      dutyIncludeFreight: true,
      eustRatePct: "19",
      vatRefundLagMonths: 2,
      vatRefundEnabled: true,
      fxFeePct: "0,5",
      milestones: [
        { id: "po-demo-2025-10-ms1", label: "Deposit", percent: 33, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2025-10-ms2", label: "Production", percent: 27, anchor: "PROD_DONE", lagDays: 2 },
        { id: "po-demo-2025-10-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 5 },
      ],
    },
  ];

  demo.fos = [
    {
      id: "fo-demo-2025-09",
      foNo: "26002",
      orderDate: "2025-09-01",
      goodsEur: "33.000,00",
      freightEur: "3.200,00",
      prodDays: 42,
      transport: "sea",
      transitDays: 60,
      ddp: false,
      dutyRatePct: "6,5",
      dutyIncludeFreight: true,
      eustRatePct: "19",
      vatRefundLagMonths: 2,
      vatRefundEnabled: true,
      fxFeePct: "0,5",
      milestones: [
        { id: "fo-demo-2025-09-ms1", label: "Deposit", percent: 20, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "fo-demo-2025-09-ms2", label: "Production", percent: 50, anchor: "PROD_DONE", lagDays: 0 },
        { id: "fo-demo-2025-09-ms3", label: "Balance", percent: 30, anchor: "ETD", lagDays: 0 },
      ],
    },
  ];

  return demo;
}

export async function render(root){
  root.innerHTML = `
    <section class="card">
      <h2>Debug / Werkzeuge</h2>
      <p class="muted">Hilfsfunktionen zum schnellen Befüllen oder Zurücksetzen des lokalen Speichers.</p>
      <div class="toolbar" style="display:flex; gap:12px; flex-wrap:wrap; margin-top:16px;">
        <button class="btn" id="seed">Testdaten &amp; POs laden</button>
        <button class="btn danger" id="wipe">Alle Daten löschen</button>
      </div>
      <div id="status" class="muted" style="margin-top:12px"></div>
    </section>`;

  const status = root.querySelector("#status");

  function updateStatus(msg){
    status.textContent = msg;
    if (!msg) return;
    setTimeout(()=>{ if (status.textContent === msg) status.textContent = ""; }, 2500);
  }

  root.querySelector("#seed").addEventListener("click", ()=>{
    const demoState = buildDemoState();
    saveState(demoState);
    window.dispatchEvent(new Event("state:changed"));
    updateStatus("Testdaten wurden geladen.");
  });

  root.querySelector("#wipe").addEventListener("click", ()=>{
    const empty = createEmptyState();
    saveState(empty);
    window.dispatchEvent(new Event("state:changed"));
    updateStatus("Alle Daten wurden zurückgesetzt.");
  });
}
