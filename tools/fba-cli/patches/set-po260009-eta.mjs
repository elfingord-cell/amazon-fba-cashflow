// Setzt die fehlende ETA an PO 260009 (Dichtungsringe, Coco, po-okj89ff) im Planner.
// ETA = Bestelldatum 2026-05-28 + prodDays 14 + transitDays 21 = 2026-07-02 (konsistent mit PO 260001).
export default async function (state) {
  const po = (state.pos || []).find((p) => p.id === "po-okj89ff" || String(p.poNo) === "260009");
  if (!po) throw new Error("PO 260009 nicht gefunden");
  if (po.archived) throw new Error("PO 260009 ist archiviert — Abbruch");
  po.etaManual = "2026-07-02";
}
