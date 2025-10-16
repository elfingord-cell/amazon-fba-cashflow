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
    { month: "2024-10", revenueEur: "98.000,00", payoutPct: "78" },
    { month: "2024-11", revenueEur: "82.500,00", payoutPct: "72" },
    { month: "2024-12", revenueEur: "135.000,00", payoutPct: "79" },
    { month: "2025-01", revenueEur: "92.000,00", payoutPct: "73" },
    { month: "2025-02", revenueEur: "108.000,00", payoutPct: "74" },
    { month: "2025-03", revenueEur: "94.500,00", payoutPct: "71" },
    { month: "2025-04", revenueEur: "102.000,00", payoutPct: "70" },
    { month: "2025-05", revenueEur: "87.500,00", payoutPct: "69" },
    { month: "2025-06", revenueEur: "118.000,00", payoutPct: "76" },
    { month: "2025-07", revenueEur: "126.500,00", payoutPct: "78" },
    { month: "2025-08", revenueEur: "79.500,00", payoutPct: "68" },
    { month: "2025-09", revenueEur: "115.500,00", payoutPct: "74" },
    { month: "2025-10", revenueEur: "73.000,00", payoutPct: "67" },
  ];

  demo.extras = [
    { date: "2024-12-20", label: "Weihnachtsbonus", amountEur: "5.200,00" },
    { date: "2025-03-15", label: "Steuererstattung", amountEur: "7.500,00" },
    { date: "2025-05-10", label: "Marketing-Offensive", amountEur: "-6.800,00" },
  ];

  demo.outgoings = [
    { month: "2024-10", label: "Fixkosten", amountEur: "-8.500,00" },
    { month: "2024-11", label: "Fixkosten", amountEur: "-8.500,00" },
    { month: "2024-12", label: "Fixkosten", amountEur: "-8.600,00" },
    { month: "2025-01", label: "Fixkosten", amountEur: "-8.700,00" },
    { month: "2025-02", label: "Fixkosten", amountEur: "-8.800,00" },
    { month: "2025-03", label: "Fixkosten", amountEur: "-8.900,00" },
    { month: "2025-04", label: "Fixkosten", amountEur: "-9.000,00" },
    { month: "2025-05", label: "Fixkosten", amountEur: "-9.100,00" },
    { month: "2025-06", label: "Fixkosten", amountEur: "-9.200,00" },
    { month: "2025-07", label: "Fixkosten", amountEur: "-9.200,00" },
    { month: "2025-08", label: "Fixkosten", amountEur: "-9.300,00" },
    { month: "2025-09", label: "Fixkosten", amountEur: "-9.300,00" },
    { month: "2025-10", label: "Fixkosten", amountEur: "-9.400,00" },
  ];

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
      orderDate: "2024-10-08",
      goodsEur: "24.500,00",
      freightEur: "3.400,00",
      prodDays: 50,
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
        { id: "po-demo-2024-10-ms1", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2024-10-ms2", label: "Production", percent: 40, anchor: "PROD_DONE", lagDays: 0 },
        { id: "po-demo-2024-10-ms3", label: "Balance", percent: 30, anchor: "ETA", lagDays: 7 },
      ],
    },
    {
      id: "po-demo-2025-01",
      poNo: "25001",
      orderDate: "2025-01-12",
      goodsEur: "28.000,00",
      freightEur: "4.100,00",
      prodDays: 45,
      transport: "rail",
      transitDays: 32,
      ddp: false,
      dutyRatePct: "6,5",
      dutyIncludeFreight: true,
      eustRatePct: "19",
      vatRefundLagMonths: 2,
      vatRefundEnabled: true,
      fxFeePct: "0,5",
      milestones: [
        { id: "po-demo-2025-01-ms1", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2025-01-ms2", label: "Balance", percent: 70, anchor: "ETD", lagDays: 0 },
      ],
    },
    {
      id: "po-demo-2025-04",
      poNo: "25005",
      orderDate: "2025-04-05",
      goodsEur: "31.500,00",
      freightEur: "3.800,00",
      prodDays: 35,
      transport: "sea",
      transitDays: 58,
      ddp: false,
      dutyRatePct: "6,5",
      dutyIncludeFreight: true,
      eustRatePct: "19",
      vatRefundLagMonths: 2,
      vatRefundEnabled: true,
      fxFeePct: "0,5",
      milestones: [
        { id: "po-demo-2025-04-ms1", label: "Deposit", percent: 25, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2025-04-ms2", label: "Production", percent: 35, anchor: "PROD_DONE", lagDays: 5 },
        { id: "po-demo-2025-04-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 3 },
      ],
    },
    {
      id: "po-demo-2025-07",
      poNo: "25009",
      orderDate: "2025-07-18",
      goodsEur: "27.800,00",
      freightEur: "2.900,00",
      prodDays: 30,
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
        { id: "po-demo-2025-07-ms1", label: "Deposit", percent: 40, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2025-07-ms2", label: "Inspection", percent: 30, anchor: "PROD_DONE", lagDays: 2 },
        { id: "po-demo-2025-07-ms3", label: "Balance", percent: 30, anchor: "ETA", lagDays: 0 },
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
