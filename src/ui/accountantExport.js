import { loadState } from "../data/storageLocal.js";
import {
  buildAccountantReportData,
  buildAccountantReportBundleFromState,
  createDefaultAccountantRequest,
} from "../domain/accountantReport.js";
import { triggerBlobDownload } from "../domain/accountantBundle.js";
import { getWorkspaceId } from "../storage/authSession.js";

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value != null) node.setAttribute(key, value);
  });
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child == null) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return "-";
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatNumber(value, fractionDigits = 2) {
  if (!Number.isFinite(Number(value))) return "-";
  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function renderSimpleTable(container, columns, rows) {
  container.innerHTML = "";
  const table = el("table", {
    class: "table-compact ui-table-standard ui-data-table",
    "data-ui-table": "true",
  });
  const thead = el("thead");
  const headRow = el("tr");
  columns.forEach((column) => {
    headRow.append(el("th", { class: column.align === "right" ? "num" : null }, [column.label]));
  });
  thead.append(headRow);
  const tbody = el("tbody");

  if (!rows.length) {
    tbody.append(el("tr", {}, [el("td", { colspan: String(columns.length), class: "muted" }, ["Keine Daten im gewaehlten Monat."])]));
  } else {
    rows.forEach((row) => {
      const tr = el("tr");
      columns.forEach((column) => {
        const raw = typeof column.render === "function" ? column.render(row) : row[column.key];
        tr.append(el("td", { class: column.align === "right" ? "num" : null }, [raw == null || raw === "" ? "-" : raw]));
      });
      tbody.append(tr);
    });
  }

  table.append(thead, tbody);
  container.append(table);
}

async function copyToClipboard(text) {
  const payload = String(text || "");
  if (!payload) return false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(payload);
    return true;
  }
  const textarea = el("textarea", { style: "position:fixed;left:-9999px;top:-9999px;" }, [payload]);
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  return ok;
}

export function render(root) {
  const defaults = createDefaultAccountantRequest();
  const workspaceName = getWorkspaceId() || "Workspace";
  let preview = null;
  let lastBundle = null;
  let loading = false;

  const monthInput = el("input", { type: "month", value: defaults.month });
  const includeJournalInput = el("input", { type: "checkbox" });
  const inventoryOverrideInput = el("input", { type: "text", placeholder: "optional, z.B. 150000" });
  const previewButton = el("button", { class: "btn secondary", type: "button" }, ["Preview aktualisieren"]);
  const exportButton = el("button", { class: "btn primary", type: "button" }, ["Paket erstellen"]);
  const copyEmailButton = el("button", { class: "btn", type: "button" }, ["E-Mail Text kopieren"]);
  const statusNode = el("div", { class: "muted" }, []);

  const summaryNode = el("div", { class: "grid four accountant-summary-grid" });
  const qualityNode = el("div", { class: "card soft" }, [el("h3", { class: "muted" }, ["Datenqualitaet"])]);
  const qualityList = el("ul", { class: "simple" });
  qualityNode.append(qualityList);

  const inventoryTableWrap = el("div", { class: "table-wrap ui-table-shell ui-scroll-host" });
  const depositsTableWrap = el("div", { class: "table-wrap ui-table-shell ui-scroll-host" });
  const arrivalsTableWrap = el("div", { class: "table-wrap ui-table-shell ui-scroll-host" });

  const inventorySection = el("div", { class: "card soft" }, [
    el("div", { class: "ui-page-head" }, [el("h3", {}, ["Warenbestand (Monatsende)"])]),
    inventoryTableWrap,
  ]);

  const depositSection = el("div", { class: "card soft" }, [
    el("div", { class: "ui-page-head" }, [el("h3", {}, ["Lieferanzahlungen (PO, paidDate im Monat)"])]),
    depositsTableWrap,
  ]);

  const arrivalSection = el("div", { class: "card soft" }, [
    el("div", { class: "ui-page-head" }, [el("h3", {}, ["Wareneingang (PO, Arrival/ETA im Monat)"])]),
    arrivalsTableWrap,
  ]);

  function setStatus(message, isError = false) {
    statusNode.textContent = message || "";
    statusNode.classList.toggle("danger", Boolean(isError));
    statusNode.classList.toggle("ok", !isError && Boolean(message));
  }

  function readRequest() {
    const scope = includeJournalInput.checked ? "core_plus_journal" : "core";
    const rawOverride = String(inventoryOverrideInput.value || "").trim();
    const normalizedOverride = rawOverride.replace(/\./g, "").replace(",", ".");
    const parsedOverride = Number(normalizedOverride);
    const inventoryValueOverrideEur = Number.isFinite(parsedOverride) ? parsedOverride : null;

    return {
      request: {
        month: monthInput.value || defaults.month,
        scope,
      },
      options: {
        workspaceName,
        inventoryValueOverrideEur,
      },
    };
  }

  function renderSummary(report) {
    summaryNode.innerHTML = "";
    const cards = [
      {
        label: "Snapshot As Of",
        value: formatDate(report.inventory.snapshotAsOf),
      },
      {
        label: "Warenwert EUR",
        value: Number.isFinite(Number(report.inventory.totalValueEur)) ? `${formatNumber(report.inventory.totalValueEur, 2)} EUR` : "-",
      },
      {
        label: "Anzahlungen (PO)",
        value: String(report.deposits.length),
      },
      {
        label: "Wareneingaenge (PO)",
        value: String(report.arrivals.length),
      },
      {
        label: "Amazon Units",
        value: formatNumber(report.inventory.totalAmazonUnits, 0),
      },
      {
        label: "3PL Units",
        value: formatNumber(report.inventory.total3plUnits, 0),
      },
      {
        label: "In Transit Units",
        value: formatNumber(report.inventory.totalInTransitUnits, 0),
      },
      {
        label: "Quality Issues",
        value: String((report.quality || []).length),
      },
    ];

    cards.forEach((card) => {
      summaryNode.append(el("div", { class: "stat-card" }, [
        el("div", { class: "label" }, [card.label]),
        el("div", { class: "value" }, [card.value]),
      ]));
    });
  }

  function renderQuality(report) {
    qualityList.innerHTML = "";
    if (!report.quality?.length) {
      qualityList.append(el("li", { class: "ok" }, ["Keine Hinweise."]));
      return;
    }
    report.quality.forEach((issue) => {
      qualityList.append(el("li", {}, [
        `[${issue.severity || "info"}] ${issue.code || "ISSUE"}: ${issue.message || ""}`,
      ]));
    });
  }

  function renderPreviewTables(report) {
    renderSimpleTable(
      inventoryTableWrap,
      [
        { key: "sku", label: "SKU" },
        { key: "alias", label: "Alias" },
        { key: "category", label: "Kategorie" },
        { key: "amazonUnits", label: "Amazon", align: "right", render: (row) => formatNumber(row.amazonUnits, 0) },
        { key: "threePLUnits", label: "3PL", align: "right", render: (row) => formatNumber(row.threePLUnits, 0) },
        { key: "inTransitUnits", label: "In Transit", align: "right", render: (row) => formatNumber(row.inTransitUnits, 0) },
        { key: "rowValueEur", label: "Warenwert EUR", align: "right", render: (row) => Number.isFinite(Number(row.rowValueEur)) ? formatNumber(row.rowValueEur, 2) : "-" },
      ],
      report.inventoryRows || [],
    );

    renderSimpleTable(
      depositsTableWrap,
      [
        { key: "poNumber", label: "PO" },
        { key: "supplier", label: "Supplier" },
        { key: "skuAliases", label: "SKU Alias" },
        { key: "paidDate", label: "Paid Date", render: (row) => formatDate(row.paidDate) },
        { key: "actualEur", label: "Ist EUR", align: "right", render: (row) => Number.isFinite(Number(row.actualEur)) ? formatNumber(row.actualEur, 2) : "-" },
        { key: "amountUsd", label: "USD", align: "right", render: (row) => Number.isFinite(Number(row.amountUsd)) ? formatNumber(row.amountUsd, 2) : "-" },
        { key: "issues", label: "Issues", render: (row) => (row.issues || []).join(" | ") || "-" },
      ],
      report.deposits || [],
    );

    renderSimpleTable(
      arrivalsTableWrap,
      [
        { key: "poNumber", label: "PO" },
        { key: "supplier", label: "Supplier" },
        { key: "skuAliases", label: "SKU Alias" },
        { key: "arrivalDate", label: "Arrival", render: (row) => formatDate(row.arrivalDate) },
        { key: "units", label: "Units", align: "right", render: (row) => formatNumber(row.units, 0) },
        { key: "goodsEur", label: "Goods EUR", align: "right", render: (row) => Number.isFinite(Number(row.goodsEur)) ? formatNumber(row.goodsEur, 2) : "-" },
        { key: "issues", label: "Issues", render: (row) => (row.issues || []).join(" | ") || "-" },
      ],
      report.arrivals || [],
    );
  }

  function refreshPreview() {
    const sourceState = loadState();
    const { request, options } = readRequest();
    preview = buildAccountantReportData(sourceState, request, options);
    renderSummary(preview);
    renderQuality(preview);
    renderPreviewTables(preview);
    setStatus(`Preview aktualisiert fuer ${request.month}.`);
  }

  async function runExport() {
    if (loading) return;
    loading = true;
    exportButton.setAttribute("disabled", "disabled");
    try {
      const sourceState = loadState();
      const { request, options } = readRequest();
      const bundle = await buildAccountantReportBundleFromState(sourceState, request, options);
      lastBundle = bundle;
      preview = bundle;
      renderSummary(bundle);
      renderQuality(bundle);
      renderPreviewTables(bundle);
      await triggerBlobDownload(bundle.zipBlob, bundle.zipFileName);
      setStatus(`Paket erstellt: ${bundle.zipFileName}`);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Export fehlgeschlagen.", true);
    } finally {
      loading = false;
      exportButton.removeAttribute("disabled");
    }
  }

  async function copyEmailDraft() {
    try {
      if (!lastBundle) {
        const sourceState = loadState();
        const { request, options } = readRequest();
        lastBundle = await buildAccountantReportBundleFromState(sourceState, request, options);
      }
      const ok = await copyToClipboard(lastBundle?.emailDraft?.text || "");
      setStatus(ok ? "E-Mail Text in Zwischenablage kopiert." : "Kopieren nicht moeglich.", !ok);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "E-Mail Text konnte nicht kopiert werden.", true);
    }
  }

  previewButton.addEventListener("click", refreshPreview);
  exportButton.addEventListener("click", runExport);
  copyEmailButton.addEventListener("click", copyEmailDraft);

  monthInput.addEventListener("change", refreshPreview);
  includeJournalInput.addEventListener("change", refreshPreview);

  root.innerHTML = "";
  root.append(
    el("section", { class: "card" }, [
      el("div", { class: "ui-page-head" }, [
        el("div", {}, [
          el("h2", {}, ["Buchhalter Export"]),
          el("p", { class: "muted" }, [
            "One-Click Paket fuer Warenbestand, Lieferanzahlungen und Wareneingaenge inkl. E-Mail-Text.",
          ]),
        ]),
      ]),
      el("div", { class: "ui-toolbar" }, [
        el("div", { class: "ui-toolbar-row" }, [
          el("label", { class: "field" }, [el("span", {}, ["Monat"]), monthInput]),
          el("label", { class: "field" }, [
            el("span", {}, ["Scope"]),
            el("span", { class: "row" }, [includeJournalInput, el("span", {}, ["Zahlungsjournal zusaetzlich"])]),
          ]),
          el("label", { class: "field" }, [
            el("span", {}, ["Warenwert Override EUR (optional)"]),
            inventoryOverrideInput,
          ]),
        ]),
        el("div", { class: "ui-actions-inline" }, [previewButton, exportButton, copyEmailButton]),
      ]),
      statusNode,
      summaryNode,
      qualityNode,
      inventorySection,
      depositSection,
      arrivalSection,
    ]),
  );

  refreshPreview();
}

export default { render };
