function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMonthLabel(month) {
  const raw = String(month || "");
  if (!/^\d{4}-\d{2}$/.test(raw)) return raw;
  const [year, monthNumber] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1, 1));
  return date.toLocaleDateString("de-DE", { month: "short", year: "numeric" });
}

function resolveSupplierMonthAxisLabel(model) {
  return String(model?.supplierMonthAxisLabel || "").trim() || "Bestell-/Signalmonat";
}

export function buildSupplierOutlookPrintHtml(model) {
  const months = Array.isArray(model?.months) ? model.months : [];
  const supplierRows = Array.isArray(model?.supplierRows) ? model.supplierRows : [];
  const supplierMonthAxisLabel = resolveSupplierMonthAxisLabel(model);
  const headerCells = months
    .map((month) => `<th><div style="font-size:11px;color:#516075;font-weight:500;">${escapeHtml(supplierMonthAxisLabel)}</div><div>${escapeHtml(formatMonthLabel(month))}</div></th>`)
    .join("");
  const bodyRows = supplierRows
    .map((row) => {
      const cells = months
        .map((month) => {
          const cell = row?.cells?.[month];
          return `<td>${escapeHtml(cell?.text || "")}</td>`;
        })
        .join("");
      return `<tr><th scope="row">${escapeHtml(row?.label || "")}</th>${cells}</tr>`;
    })
    .join("");
  const title = `Lieferantenausblick ${escapeHtml(model?.supplierName || model?.supplierId || "Lieferant")}`;
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: "Segoe UI", Arial, sans-serif; color: #172033; margin: 24px; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    .meta { color: #516075; font-size: 12px; margin-bottom: 16px; }
    .actions { margin-bottom: 16px; }
    .btn { background: #2e7d6c; color: #fff; border: none; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #d8e0e8; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f3f7f9; font-weight: 600; }
    tbody th { background: #fafcfd; min-width: 220px; }
    @media print {
      body { margin: 12mm; }
      .actions { display: none; }
      @page { size: A4 landscape; margin: 12mm; }
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta">
    Monatsachse: ${escapeHtml(supplierMonthAxisLabel)}
    ·
    Start: ${escapeHtml(model?.startMonth || "")}
    · Horizont: ${escapeHtml(String(model?.horizonMonths || ""))}
    · Stand: ${escapeHtml(model?.frozenAt || model?.generatedAt || "")}
  </div>
  <div class="actions"><button class="btn" onclick="window.print()">Drucken / Als PDF speichern</button></div>
  <table>
    <thead>
      <tr>
        <th>Produkt</th>
        ${headerCells}
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>
</body>
</html>`;
}

export function openSupplierOutlookPrintView(model) {
  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) return false;
  popup.document.open();
  popup.document.write(buildSupplierOutlookPrintHtml(model));
  popup.document.close();
  return true;
}
