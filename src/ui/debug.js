import { createEmptyState, saveState } from "../data/storageLocal.js";

function buildDemoState(){
  const demo = createEmptyState();

  demo.settings = {
    startMonth: "2025-01",
    horizonMonths: 18,
    openingBalance: "75.000,00",
    fxRate: 1.08,
    fxFeePct: "0,6",
    dutyRatePct: "6,5",
    dutyIncludeFreight: true,
    eustRatePct: "19",
    vatRefundEnabled: true,
    vatRefundLagMonths: 2,
    freightLagDays: 14,
  };

  demo.incomings = [
    { month: "2025-01", revenueEur: "38.500,00", payoutPct: "82" },
    { month: "2025-02", revenueEur: "41.200,00", payoutPct: "84" },
    { month: "2025-03", revenueEur: "44.100,00", payoutPct: "83" },
    { month: "2025-04", revenueEur: "46.800,00", payoutPct: "85" },
    { month: "2025-05", revenueEur: "48.200,00", payoutPct: "86" },
    { month: "2025-06", revenueEur: "52.600,00", payoutPct: "86" },
    { month: "2025-07", revenueEur: "55.900,00", payoutPct: "87" },
  ];

  demo.extras = [
    { month: "2025-03", label: "Steuererstattung", amountEur: "5.800,00" },
    { month: "2025-08", label: "Sonderbonus", amountEur: "3.200,00" },
  ];

  demo.outgoings = [
    { month: "2025-01", label: "Fixkosten", amountEur: "-4.500,00" },
    { month: "2025-02", label: "Fixkosten", amountEur: "-4.500,00" },
    { month: "2025-03", label: "Fixkosten", amountEur: "-4.600,00" },
    { month: "2025-04", label: "Fixkosten", amountEur: "-4.600,00" },
    { month: "2025-05", label: "Fixkosten", amountEur: "-4.700,00" },
    { month: "2025-06", label: "Fixkosten", amountEur: "-4.800,00" },
    { month: "2025-07", label: "Fixkosten", amountEur: "-4.800,00" },
  ];

  demo.pos = [
    {
      id: "po-demo-1",
      poNo: "25001",
      orderDate: "2025-01-18",
      goodsEur: "18.000,00",
      prodDays: 45,
      transport: "sea",
      transitDays: 40,
      milestones: [
        { id: "po-demo-1-ms1", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-1-ms2", label: "Balance", percent: 70, anchor: "ETA", lagDays: 5 },
      ],
    },
    {
      id: "po-demo-2",
      poNo: "25005",
      orderDate: "2025-03-02",
      goodsEur: "24.500,00",
      prodDays: 35,
      transport: "rail",
      transitDays: 28,
      milestones: [
        { id: "po-demo-2-ms1", label: "Deposit", percent: 20, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-2-ms2", label: "Production", percent: 40, anchor: "PROD_DONE", lagDays: 2 },
        { id: "po-demo-2-ms3", label: "Final", percent: 40, anchor: "ETA", lagDays: 3 },
      ],
    },
    {
      id: "po-demo-3",
      poNo: "25009",
      orderDate: "2025-05-10",
      goodsEur: "32.750,00",
      prodDays: 50,
      transport: "air",
      transitDays: 9,
      milestones: [
        { id: "po-demo-3-ms1", label: "Deposit", percent: 40, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "po-demo-3-ms2", label: "Inspection", percent: 30, anchor: "PROD_DONE", lagDays: 1 },
        { id: "po-demo-3-ms3", label: "Balance", percent: 30, anchor: "ETA", lagDays: 0 },
      ],
    },
  ];

  demo.fos = [
    {
      id: "fo-demo-1",
      foNo: "26001",
      orderDate: "2025-07-20",
      goodsEur: "21.400,00",
      prodDays: 40,
      transport: "sea",
      transitDays: 45,
      milestones: [
        { id: "fo-demo-1-ms1", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "fo-demo-1-ms2", label: "Balance", percent: 70, anchor: "ETA", lagDays: 7 },
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
