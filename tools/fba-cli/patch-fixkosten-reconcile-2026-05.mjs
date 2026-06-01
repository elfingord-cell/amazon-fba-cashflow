// Fixkosten-Reconciliation (Stand 2026-05) — Realwerte + costType + fehlende Abos.
// Quellen: Holvi-Auszüge Jan–Apr 2026, verifizierte Belege (Easybill/Apple/OpenAI/n8n/Majamo),
// Meta Marketing-API (Live-Spend), ChatGPT-Business (Chrome-verifiziert), Pierre-Bestätigungen.
// FX: 1,19 USD/EUR (CFP-Settings). Dry-Run zeigt Details; echtes Schreiben erst mit --commit.
//
// costType-Logik (treibt die künftige monatliche Routine):
//   fixed  -> Vertragswert, Holvi-Drift-Alert bei Abweichung
//   tier   -> Abo mit Stufen; bei Up/Downgrade letzten Monatswert nehmen (nicht mitteln)
//   api    -> Verbrauch; recency-gewichtet 3-2-1 über letzte 3 Monate, monatlich nachgezogen
//   volume -> Treiber-basiert (Majamo: Fixsockel + variabel, monatlich nachgezogen)
export default async function (state) {
  const fc = state.fixcosts || (state.fixcosts = []);
  const log = (m) => console.log("  " + m);
  const find = (name) => fc.find((x) => x.name === name);

  const upd = (name, { amount, frequency, category, costType, note } = {}) => {
    const p = find(name);
    if (!p) { log(`!! NICHT GEFUNDEN: ${name}`); return; }
    const before = p.amount;
    if (amount !== undefined) p.amount = amount;
    if (frequency !== undefined) p.frequency = frequency;
    if (category !== undefined) p.category = category;
    if (costType !== undefined) p.costType = costType;
    if (note !== undefined) p.notes = note;
    const chg = amount !== undefined ? `${String(before).padStart(9)} -> ${String(p.amount).padStart(9)}` : "(nur costType)";
    log(`UPD  ${name.padEnd(22)} ${chg.padEnd(24)} [${costType || p.costType || "-"}]`);
  };

  const add = (name, amount, { frequency = "monthly", category = "Lizenz", anchor = "LAST", startMonth = "2026-05", costType = "fixed", note = "" } = {}) => {
    if (find(name)) { log(`~~ existiert schon: ${name}`); return; }
    fc.push({
      id: "fix-rec-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 14),
      name, notes: note || "Holvi/Beleg-verifiziert 2026-05 (Reconciliation)",
      amount, anchor, autoPaid: true, category, endMonth: "",
      frequency, proration: { method: "none", enabled: false }, startMonth, intervalMonths: 1,
      costType,
    });
    log(`NEU  ${name.padEnd(22)} ${String(amount).padStart(9)}  [${costType}] ${frequency}/${category}`);
  };

  console.log("\n=== A) KORREKTUREN bestehender Positionen ===");
  upd("Easybill", { amount: "1.842,12", frequency: "annual", costType: "fixed", note: "PREMIUM-5000 Jahreslizenz brutto (Beleg 21.01., war 1.300)" });
  upd("ChatGpt x 2", { amount: "52,00", costType: "tier", note: "ChatGPT Business: 2 Seats x 26 € (Chrome-verifiziert 2026-05-31). Pro-Abo $200 durch Business abgelöst. OpenAI-API separat." });
  upd("Claude x 2", { amount: "270,00", costType: "tier", note: "Pierre 180 € + Kollege 90 € = 270 € netto (Reverse-Charge, Pierre-bestätigt 2026-05-31). Holvi-Monatswerte schwanken durch Billing-Timing (Mär 306/Apr 218)." });
  upd("Majamo", { amount: "1.600,00", costType: "volume", note: "Fixsockel ~209 + variabel (Paletten/WE/Versand); monatlich nachgezogen. Ø Jan–Apr 1.522, steigend" });
  upd("Meta Ads", { amount: "450,00", category: "Sonstiges", costType: "api", note: "Budget-Entscheid; monatlich aus Meta-Marketing-API nachgezogen. Mai-Niveau ~15€/Tag (vorher ~45)" });
  upd("Firecrawl", { amount: "20,00", costType: "api", note: "Verbrauch; 3-2-1 (war 15)" });
  upd("Puffer Fixkosten", { amount: "200,00", costType: "fixed", note: "gekürzt — echte Abos jetzt einzeln (war 500)" });

  console.log("\n=== B) costType auf restliche Bestandspositionen (keine Wertänderung) ===");
  upd("Laura PPC", { costType: "fixed" });
  upd("MBD Fixkosten", { costType: "fixed" });
  upd("ZMART Fixkosten", { costType: "fixed" });
  upd("Baloise", { costType: "fixed" });
  upd("Sellerboard", { costType: "fixed" });
  upd("GS1 Fixkosten", { costType: "fixed" });
  upd("Helium10 Fixkosten", { costType: "fixed" });
  upd("Exali Fixkosten", { costType: "fixed" });
  upd("Leko Fixkosten", { costType: "fixed" });
  upd("Shopify", { costType: "tier" });

  console.log("\n=== C) NEUE EINZELPOSITIONEN (vorher in Lizenzen/Puffer versteckt) ===");
  add("OpenAI API", "43,00", { costType: "api", note: "platform.openai.com API ($50/Apr); recency-gewichtet, monatlich nachgezogen. Getrennt vom ChatGPT-Business-Abo." });
  add("Anthropic API", "3,00", { costType: "api", note: "API-Verbrauch neben den Seats; klein" });
  add("VentoryOne", "75,00", { costType: "tier", note: "skaliert mit aktiven SKUs/Sales" });
  add("Strato", "45,00", { costType: "fixed", note: "Hosting, ~2 Rechnungen/Monat" });
  add("Google Workspace", "45,00", { costType: "tier" });
  add("IT-Recht Kanzlei", "12,00", { costType: "fixed" });
  add("Holvi Bankgebühr", "21,00", { category: "Sonstiges", costType: "fixed" });
  add("Wispr Flow", "15,00", { costType: "fixed" });
  add("NordVPN", "15,00", { costType: "fixed" });
  add("n8n Cloud", "24,00", { costType: "fixed", note: "Cloud Starter, via Paddle (Beleg #79258107)" });
  add("Easybill Archivierung", "18,00", { costType: "fixed", note: "monatliches Archiv-Add-on neben der Jahreslizenz" });

  console.log("\n=== D) Sammelposition auflösen ===");
  const before = fc.length;
  state.fixcosts = fc.filter((x) => x.name !== "Lizenzen");
  log(`Entfernt 'Lizenzen' (50€ Sammelposten): ${before} -> ${state.fixcosts.length}`);

  console.log(`\n=== Fixkosten gesamt jetzt: ${state.fixcosts.length} Positionen ===`);
}
