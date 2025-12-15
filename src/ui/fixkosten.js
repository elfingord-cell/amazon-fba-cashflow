import {
  loadState,
  saveState,
  setEventManualPaid,
  clearEventManualPaid,
  setEventsManualPaid,
} from "../data/storageLocal.js";
import { expandFixcostInstances } from "../domain/cashflow.js";

const CATEGORY_OPTIONS = [
  "Lizenz",
  "Steuerberatung",
  "Versicherung",
  "Miete",
  "Tools",
  "Sonstiges",
];

const FREQUENCY_OPTIONS = [
  { value: "monthly", label: "monatlich" },
  { value: "quarterly", label: "vierteljährlich" },
  { value: "semiannual", label: "halbjährlich" },
  { value: "annual", label: "jährlich" },
  { value: "custom", label: "benutzerdefiniert" },
];

const ANCHOR_OPTIONS = [
  { value: "1", label: "1." },
  { value: "15", label: "15." },
  { value: "LAST", label: "Letzter Tag" },
];

const PRORATION_OPTIONS = [
  { value: "daily", label: "tagesgenau" },
  { value: "none", label: "keine Proration" },
];

const collapsedMonths = new Set();
let editingInstanceId = null;
let selectedFixRows = new Set();

function generateId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return `fix-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseCurrency(value) {
  if (value == null) return 0;
  const cleaned = String(value)
    .trim()
    .replace(/€/g, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(value) {
  const num = parseCurrency(value);
  return Number(num).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatRate(value) {
  const num = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(num)) return "0,19";
  return String(num).replace(".", ",");
}

function formatDateDisplay(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function toIsoDate(input) {
  if (!input) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const match = input.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return "";
  const day = String(Number(match[1])).padStart(2, "0");
  const month = String(Number(match[2])).padStart(2, "0");
  return `${match[3]}-${month}-${day}`;
}

function monthLabel(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || "")) return ym;
  const [y, m] = ym.split("-").map(Number);
  const date = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(date);
}

function ensureStructures(state) {
  if (!Array.isArray(state.fixcosts)) state.fixcosts = [];
  if (!state.fixcostOverrides || typeof state.fixcostOverrides !== "object") state.fixcostOverrides = {};
  if (!state.status || typeof state.status !== "object") state.status = { autoManualCheck: false, events: {} };
  if (!state.status.events || typeof state.status.events !== "object") state.status.events = {};
}

function createDefaultFixcost(state) {
  return {
    id: generateId(),
    name: "Neue Fixkosten",
    category: "Sonstiges",
    amount: "1.000,00",
    isGross: true,
    vatRate: "19",
    frequency: "monthly",
    intervalMonths: 1,
    anchor: "LAST",
    startMonth: state.settings?.startMonth || new Date().toISOString().slice(0, 7),
    endMonth: "",
    proration: { enabled: false, method: "none" },
    autoPaid: false,
    notes: "",
  };
}

function validateFixcost(row) {
  const errors = [];
  if (!row.name || !row.name.trim()) {
    errors.push("Bitte einen Namen vergeben.");
  }
  if (!(parseCurrency(row.amount) > 0)) {
    errors.push("Bitte Betrag > 0 eingeben.");
  }
  if (row.startMonth && row.endMonth) {
    if (row.startMonth > row.endMonth) {
      errors.push("Startmonat darf nicht nach Endmonat liegen.");
    }
  }
  if (row.anchor && row.anchor !== "LAST" && !/^\d+$/.test(String(row.anchor))) {
    errors.push("Ungültiger Tag: Bitte 1–28/29/30/31 oder ‘Letzter Tag’. ");
  }
  return errors;
}

function render(root) {
  const state = loadState();
  ensureStructures(state);
  const expandedRows = new Set(
    Object.entries(state.fixcostUi?.expanded || {})
      .filter(([, val]) => Boolean(val))
      .map(([key]) => key)
  );
  const viewMode = state.fixcostUi?.viewMode === "expanded" ? "expanded" : "compact";

  root.innerHTML = `
    <section class="card fix-master">
      <div class="card-header">
        <h2>Fixkosten (Stammdaten)</h2>
        <p class="muted">Definiere wiederkehrende Fixkosten, Frequenz und automatische Zahlungen.</p>
        <div class="fix-master-toolbar">
          <div class="toggle-group" role="group" aria-label="Darstellung">
            <button class="btn ${viewMode === "compact" ? "primary" : "secondary"}" data-view="compact">Kompakt</button>
            <button class="btn ${viewMode === "expanded" ? "primary" : "secondary"}" data-view="expanded">Erweitert</button>
          </div>
          <div class="batch-actions ${selectedFixRows.size ? "visible" : ""}" aria-live="polite">
            <span class="muted">${selectedFixRows.size} ausgewählt</span>
            <button class="btn" data-batch="vat-19">USt 19 % setzen</button>
            <button class="btn" data-batch="toggle-gross">Netto/Brutto umschalten</button>
            <button class="btn" data-batch="duplicate">Duplizieren</button>
            <button class="btn danger" data-batch="delete">Löschen</button>
          </div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="table fix-master-table ${viewMode === "expanded" ? "expanded" : "compact"}">
          <thead>
            <tr>
              <th class="sticky name-col" aria-label="Auswahl"></th>
              <th>Name</th>
              <th>Kategorie</th>
              <th>Betrag (€)</th>
              <th>Netto/Brutto</th>
              <th>USt-Satz</th>
              <th>Frequenz</th>
              <th>Fälligkeitstag</th>
              <th>Start / Ende</th>
              <th>Proration</th>
              <th>Automatisch bezahlt</th>
              <th>Notizen</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="fix-master-rows"></tbody>
        </table>
      </div>
      <div class="actions">
        <button class="btn primary" id="fix-add">+ Position hinzufügen</button>
      </div>
    </section>

    <section class="card fix-months">
      <div class="card-header">
        <h3>Fixkosten je Monat</h3>
        <p class="muted">Bearbeite monatliche Instanzen, Overrides und Zahlungsstatus.</p>
      </div>
      <div id="fix-month-list" class="fix-month-list"></div>
    </section>
  `;

  const masterBody = root.querySelector("#fix-master-rows");
  const addBtn = root.querySelector("#fix-add");
  const monthContainer = root.querySelector("#fix-month-list");

  function renderMasters() {
    selectedFixRows = new Set(
      Array.from(selectedFixRows).filter((id) => state.fixcosts.some((row) => row.id === id))
    );
    if (!state.fixcosts.length) {
      masterBody.innerHTML = `<tr><td colspan="13" class="muted">Keine Fixkosten hinterlegt.</td></tr>`;
      return;
    }
    masterBody.innerHTML = state.fixcosts
      .map((row) => {
        const errors = validateFixcost(row);
        const prorationEnabled = row.proration?.enabled === true;
        const prorationMethod = row.proration?.method || "none";
        const freq = row.frequency || "monthly";
        const customVisible = freq === "custom";
        const expanded = expandedRows.has(row.id) || viewMode === "expanded";
        const startLabel = row.startMonth ? monthLabel(row.startMonth) : "–";
        const endLabel = row.endMonth ? monthLabel(row.endMonth) : "offen";
        const rangeLabel = `${startLabel} – ${endLabel}`;
        const nameTooltip = row.name || "Fixkosten";
        return `
          <tr class="fix-master-row ${expanded ? "is-open" : ""}" data-id="${row.id}">
            <td class="sticky name-col">
              <div class="name-cell" title="${nameTooltip}">
                <label class="checkbox" aria-label="Zeile auswählen">
                  <input type="checkbox" data-action="select-row" ${selectedFixRows.has(row.id) ? "checked" : ""} />
                  <span class="sr-only">Auswahl</span>
                </label>
                <button class="chevron" data-action="toggle-row" aria-expanded="${expanded}">
                  <span class="chevron-icon">${expanded ? "▾" : "▸"}</span>
                </button>
                <div class="name-input-wrapper">
                  <label class="sr-only" for="name-${row.id}">Name</label>
                  <input id="name-${row.id}" type="text" data-field="name" value="${row.name || ""}" placeholder="z. B. Steuerberatung" />
                  ${viewMode === "expanded" ? `<div class="secondary muted">${rangeLabel}</div>` : ""}
                </div>
              </div>
              ${errors.includes("Bitte einen Namen vergeben.") ? `<small class="error">Bitte einen Namen vergeben.</small>` : ""}
            </td>
            <td class="min-col cat-col">
              <select data-field="category" value="${row.category || "Sonstiges"}">
                ${CATEGORY_OPTIONS.map(opt => `<option value="${opt}" ${opt === (row.category || "Sonstiges") ? "selected" : ""}>${opt}</option>`).join("")}
              </select>
            </td>
            <td class="min-col amount-col">
              <input type="text" data-field="amount" value="${formatCurrency(row.amount)}" inputmode="decimal" />
              ${errors.includes("Bitte Betrag > 0 eingeben.") ? `<small class="error">Bitte Betrag > 0 eingeben.</small>` : ""}
            </td>
            <td class="min-col gross-col">
              <label class="checkbox inline">
                <input type="checkbox" data-field="isGross" ${row.isGross !== false ? "checked" : ""} />
                <span>Betrag ist brutto</span>
              </label>
            </td>
            <td class="min-col vat-col">
              <input type="text" data-field="vatRate" value="${formatRate(row.vatRate)}" inputmode="decimal" aria-label="USt-Satz" />
            </td>
            <td class="min-col freq-col">
              <select data-field="frequency" value="${freq}">
                ${FREQUENCY_OPTIONS.map(opt => `<option value="${opt.value}" ${opt.value === freq ? "selected" : ""}>${opt.label}</option>`).join("")}
              </select>
              <input type="number" min="1" class="interval-input ${customVisible ? "" : "hidden"}" data-field="intervalMonths" value="${row.intervalMonths || 1}" aria-label="Intervall in Monaten" />
            </td>
            <td class="min-col anchor-col">
              <select data-field="anchor" value="${row.anchor || "LAST"}">
                ${ANCHOR_OPTIONS.map(opt => `<option value="${opt.value}" ${opt.value === (row.anchor || "LAST") ? "selected" : ""}>${opt.label}</option>`).join("")}
              </select>
            </td>
            <td class="min-col range-col">${rangeLabel}</td>
            <td class="min-col proration-col">
              <label class="checkbox">
                <input type="checkbox" data-field="prorationEnabled" ${prorationEnabled ? "checked" : ""} />
                <span>anteilig</span>
              </label>
              <select data-field="prorationMethod" class="${prorationEnabled ? "" : "hidden"}">
                ${PRORATION_OPTIONS.map(opt => `<option value="${opt.value}" ${opt.value === prorationMethod ? "selected" : ""}>${opt.label}</option>`).join("")}
              </select>
            </td>
            <td class="min-col autopaid-col">
              <label class="checkbox">
                <input type="checkbox" data-field="autoPaid" ${row.autoPaid ? "checked" : ""} />
                <span class="sr-only">Automatisch bezahlt</span>
              </label>
            </td>
            <td class="min-col notes-col">
              <button class="btn tertiary note-btn" data-action="note" title="Notiz anzeigen">🛈</button>
              ${row.notes ? `<span class="badge note" title="${row.notes}">Notiz</span>` : ""}
            </td>
            <td class="actions min-col">
              <button class="btn" data-action="duplicate">Duplizieren</button>
              <button class="btn danger" data-action="delete">Löschen</button>
            </td>
          </tr>
          ${expanded ? `
            <tr class="fix-master-detail" data-for="${row.id}" data-id="${row.id}">
              <td colspan="13">
                <div class="detail-grid">
                  <label>Start / Ende
                    <div class="range-inputs">
                      <input type="month" data-field="startMonth" value="${row.startMonth || ""}" aria-label="Startmonat" />
                      <input type="month" data-field="endMonth" value="${row.endMonth || ""}" aria-label="Endmonat" />
                    </div>
                    ${errors.includes("Startmonat darf nicht nach Endmonat liegen.") ? `<small class="error" role="alert">Startmonat darf nicht nach Endmonat liegen.</small>` : ""}
                  </label>
                  <label>Notiz
                    <textarea data-field="notes" rows="2" placeholder="Notiz">${row.notes || ""}</textarea>
                  </label>
                  <div class="detail-inline">
                    <strong>Proration</strong>
                    <div class="muted">${prorationEnabled ? "anteilig" : "keine Proration"}</div>
                  </div>
                  <div class="detail-inline">
                    <strong>Frequenz</strong>
                    <div class="muted">${freq === "custom" ? `${row.intervalMonths || 1} Monate` : FREQUENCY_OPTIONS.find((f) => f.value === freq)?.label || ""}</div>
                  </div>
                </div>
              </td>
            </tr>` : ""}
        `;
      })
      .join("");
  }

  function renderMonthInstances() {
    const statusEvents = state.status?.events || {};
    const autoManualCheck = state.status?.autoManualCheck === true;
    const months = expandFixcostInstances(state, {
      statusEvents,
      autoManualCheck,
      today: new Date(),
    });

    const grouped = new Map();
    months.forEach((inst) => {
      if (!grouped.has(inst.month)) grouped.set(inst.month, []);
      grouped.get(inst.month).push(inst);
    });

    if (!grouped.size) {
      monthContainer.innerHTML = `<p class="muted">Keine Fixkosten im aktuellen Zeithorizont.</p>`;
      return;
    }

    const sections = [];
    Array.from(grouped.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .forEach(([month, list]) => {
        const total = list.reduce((sum, inst) => sum + (inst.amount || 0), 0);
        const paid = list.reduce((sum, inst) => sum + (inst.paid ? inst.amount || 0 : 0), 0);
        const open = Math.max(0, total - paid);
        const collapsed = collapsedMonths.has(month);
        sections.push(`
          <section class="fix-month-card" data-month="${month}">
            <header>
              <button class="month-toggle" data-action="toggle" aria-expanded="${collapsed ? "false" : "true"}">
                <span class="month-label">${monthLabel(month)}</span>
                <span class="badge info">Bezahlt: ${formatCurrency(paid)} €</span>
                <span class="badge warn">Offen: ${formatCurrency(open)} €</span>
              </button>
              <div class="month-actions">
                <button class="btn" data-action="confirm-all" data-month="${month}">Alle offenen Fixkosten dieses Monats bestätigen</button>
                <button class="btn secondary" data-action="suppress-auto" data-month="${month}">Auto-Markierung ignorieren</button>
              </div>
            </header>
            <div class="month-body" ${collapsed ? "hidden" : ""}>
              ${renderInstanceTable(list, month, autoManualCheck)}
            </div>
          </section>
        `);
      });

    monthContainer.innerHTML = sections.join("\n");
  }

  function renderInstanceTable(instances, month, autoManualCheck) {
    if (!instances.length) {
      return `<p class="muted">Keine Instanzen.</p>`;
    }
    return `
      <table class="table fix-instance-table">
        <thead>
          <tr>
            <th>Position</th>
            <th>Kategorie</th>
            <th>Betrag (€)</th>
            <th>Netto/Brutto</th>
            <th>USt-Satz</th>
            <th>Fälligkeit</th>
            <th>Bezahlt</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${instances
            .map((inst) => renderInstanceRow(inst, month, autoManualCheck))
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderInstanceRow(inst, month, autoManualCheck) {
    const isEditing = editingInstanceId === inst.id;
    const autoBadge = inst.autoPaid
      ? `<span class="badge auto" title="${inst.autoTooltip || "Wird am Fälligkeitstag automatisch als bezahlt markiert. Manuell änderbar."}">Auto</span>`
      : "";
    const overrideBadge = inst.overrideActive ? `<span class="badge override" title="Override aktiv">Override</span>` : "";
    const note = [inst.notes, inst.override?.note].filter(Boolean).join(" · ");
    const dueDisplay = inst.dueDateIso ? formatDateDisplay(inst.dueDateIso) : "–";
    return `
      <tr class="fix-instance" data-id="${inst.id}" data-month="${month}">
        <td>
          <div class="instance-name">${inst.label} ${autoBadge} ${overrideBadge}</div>
          ${note ? `<div class="instance-note muted">${note}</div>` : ""}
        </td>
        <td>${inst.category || "Sonstiges"}</td>
        <td>${formatCurrency(inst.amount)} €</td>
        <td>${inst.isGross ? "Brutto" : "Netto"}</td>
        <td>${formatRate(inst.vatRate || 0)}</td>
        <td>${dueDisplay}</td>
        <td>
          <label class="checkbox">
            <input type="checkbox" data-action="toggle-paid" ${inst.paid ? "checked" : ""} aria-label="bezahlt" />
            <span class="sr-only">Bezahlt</span>
          </label>
        </td>
        <td class="actions">
          <button class="btn tertiary" data-action="edit" aria-expanded="${isEditing ? "true" : "false"}">Bearbeiten</button>
          ${inst.overrideActive ? `<button class="btn" data-action="reset">Zurücksetzen</button>` : ""}
        </td>
      </tr>
      ${isEditing ? renderInstanceEditor(inst) : ""}
    `;
  }

  function renderInstanceEditor(inst) {
    const currentAmount = inst.override?.amount && inst.override.amount.trim() !== ""
      ? inst.override.amount
      : formatCurrency(inst.amount);
    const currentDue = inst.override?.dueDate ? formatDateDisplay(inst.override.dueDate) : (inst.dueDateIso ? formatDateDisplay(inst.dueDateIso) : "");
    const currentNote = inst.override?.note || "";
    const currentGross = typeof inst.override?.isGross !== "undefined" ? inst.override.isGross : inst.isGross !== false;
    const currentVatRate = typeof inst.override?.vatRate !== "undefined" ? inst.override.vatRate : inst.vatRate;
    return `
      <tr class="fix-instance-edit" data-edit-for="${inst.id}">
        <td colspan="6">
          <div class="fix-edit-grid">
            <label>
              Override Betrag (€)
              <input type="text" data-field="overrideAmount" value="${currentAmount}" inputmode="decimal" />
            </label>
            <label>
              Override Fälligkeit (TT.MM.JJJJ)
              <input type="text" data-field="overrideDue" value="${currentDue}" placeholder="TT.MM.JJJJ" />
            </label>
            <label class="checkbox inline">
              <input type="checkbox" data-field="overrideGross" ${currentGross ? "checked" : ""} />
              <span>Betrag ist brutto</span>
            </label>
            <label>
              Override USt-Satz
              <input type="text" data-field="overrideVatRate" value="${formatRate(currentVatRate)}" inputmode="decimal" />
            </label>
            <label>
              Override Notiz
              <input type="text" data-field="overrideNote" value="${currentNote}" />
            </label>
            <div class="edit-actions">
              <button class="btn primary" data-action="save-override">Speichern</button>
              <button class="btn" data-action="cancel-override">Abbrechen</button>
            </div>
            <div class="edit-error" aria-live="polite"></div>
          </div>
        </td>
      </tr>
    `;
  }

  renderMasters();
  renderMonthInstances();

  const toolbar = root.querySelector(".fix-master-toolbar");

  toolbar?.addEventListener("click", (event) => {
    const viewBtn = event.target.closest("button[data-view]");
    const batchBtn = event.target.closest("button[data-batch]");
    if (viewBtn) {
      const mode = viewBtn.dataset.view;
      state.fixcostUi.viewMode = mode === "expanded" ? "expanded" : "compact";
      saveState(state);
      renderMasters();
      return;
    }
    if (batchBtn) {
      const ids = Array.from(selectedFixRows);
      if (!ids.length) return;
      if (batchBtn.dataset.batch === "delete") {
        if (confirm(`Wirklich ${ids.length} Positionen löschen?`)) {
          state.fixcosts = state.fixcosts.filter((row) => !ids.includes(row.id));
          selectedFixRows = new Set();
          saveState(state);
          renderMasters();
          renderMonthInstances();
        }
      } else if (batchBtn.dataset.batch === "duplicate") {
        ids.forEach((id) => {
          const src = state.fixcosts.find((r) => r.id === id);
          if (src) {
            const copy = { ...src, id: generateId(), name: `${src.name || "Kopie"} (Kopie)` };
            state.fixcosts.push(copy);
          }
        });
        saveState(state);
        renderMasters();
      } else if (batchBtn.dataset.batch === "vat-19") {
        ids.forEach((id) => {
          const row = state.fixcosts.find((r) => r.id === id);
          if (row) row.vatRate = "19";
        });
        saveState(state);
        renderMasters();
      } else if (batchBtn.dataset.batch === "toggle-gross") {
        ids.forEach((id) => {
          const row = state.fixcosts.find((r) => r.id === id);
          if (row) row.isGross = !(row.isGross !== false);
        });
        saveState(state);
        renderMasters();
      }
    }
  });

  addBtn?.addEventListener("click", () => {
    state.fixcosts.push(createDefaultFixcost(state));
    saveState(state);
    renderMasters();
    renderMonthInstances();
    window.dispatchEvent(new Event("state:changed"));
  });

  masterBody?.addEventListener("change", (event) => {
    const tr = event.target.closest("tr[data-id]");
    if (event.target.dataset.action === "select-row") {
      const id = tr?.dataset.id;
      if (!id) return;
      if (event.target.checked) selectedFixRows.add(id);
      else selectedFixRows.delete(id);
      renderMasters();
      return;
    }
    if (!tr) return;
    const id = tr.dataset.id;
    const row = state.fixcosts.find((item) => item.id === id);
    if (!row) return;
    const field = event.target.dataset.field;
    if (!field) return;
    if (field === "category" || field === "frequency" || field === "anchor") {
      row[field] = event.target.value;
    } else if (field === "startMonth" || field === "endMonth") {
      row[field] = event.target.value;
    } else if (field === "prorationMethod") {
      if (!row.proration) row.proration = { enabled: true, method: event.target.value };
      row.proration.method = event.target.value;
    } else if (field === "intervalMonths") {
      row.intervalMonths = Math.max(1, Number(event.target.value || 1));
    } else if (field === "isGross") {
      row.isGross = event.target.checked;
    } else if (field === "vatRate") {
      row.vatRate = event.target.value;
    }
    saveState(state);
    renderMasters();
    renderMonthInstances();
    window.dispatchEvent(new Event("state:changed"));
  });

  masterBody?.addEventListener("input", (event) => {
    const tr = event.target.closest("tr.fix-master-row");
    if (!tr) return;
    const id = tr.dataset.id;
    const row = state.fixcosts.find((item) => item.id === id);
    if (!row) return;
    const field = event.target.dataset.field;
    if (!field) return;
    if (field === "name" || field === "notes") {
      row[field] = event.target.value;
    } else if (field === "amount") {
      row.amount = event.target.value;
    } else if (field === "prorationEnabled") {
      const checked = event.target.checked;
      if (!row.proration) row.proration = { enabled: checked, method: checked ? "daily" : "none" };
      row.proration.enabled = checked;
      if (!checked) row.proration.method = "none";
      renderMasters();
    } else if (field === "autoPaid") {
      row.autoPaid = event.target.checked;
    } else if (field === "frequency") {
      row.frequency = event.target.value;
    }
  });

  masterBody?.addEventListener("blur", (event) => {
    const tr = event.target.closest("tr[data-id]");
    if (!tr) return;
    const id = tr.dataset.id;
    const row = state.fixcosts.find((item) => item.id === id);
    if (!row) return;
    const field = event.target.dataset.field;
    if (field === "amount") {
      const formatted = formatCurrency(event.target.value);
      row.amount = formatted;
      event.target.value = formatted;
    } else if (field === "vatRate") {
      const formatted = formatRate(event.target.value || row.vatRate || "0,19");
      row.vatRate = formatted;
      event.target.value = formatted;
    }
    saveState(state);
    renderMasters();
    renderMonthInstances();
    window.dispatchEvent(new Event("state:changed"));
  }, true);

  masterBody?.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    const tr = btn.closest("tr.fix-master-row");
    const id = tr?.dataset.id;
    const rowIndex = state.fixcosts.findIndex((item) => item.id === id);
    const action = btn.dataset.action;

    if (action === "toggle-row") {
      if (!id) return;
      if (expandedRows.has(id)) expandedRows.delete(id);
      else expandedRows.add(id);
      state.fixcostUi.expanded = {};
      expandedRows.forEach((key) => (state.fixcostUi.expanded[key] = true));
      saveState(state);
      renderMasters();
      return;
    }

    if (action === "note") {
      if (!expandedRows.has(id)) {
        expandedRows.add(id);
        state.fixcostUi.expanded[id] = true;
        saveState(state);
        renderMasters();
      }
      return;
    }

    if (rowIndex < 0) return;
    if (action === "delete") {
      if (confirm("Diese Fixkosten-Position wirklich löschen?")) {
        const removed = state.fixcosts.splice(rowIndex, 1)[0];
        if (removed && removed.id && state.fixcostOverrides[removed.id]) {
          delete state.fixcostOverrides[removed.id];
        }
        saveState(state);
        renderMasters();
        renderMonthInstances();
        window.dispatchEvent(new Event("state:changed"));
      }
    } else if (action === "duplicate") {
      const clone = structuredClone(state.fixcosts[rowIndex]);
      clone.id = generateId();
      clone.name = `${clone.name || "Fixkosten"} (Kopie)`;
      state.fixcosts.splice(rowIndex + 1, 0, clone);
      saveState(state);
      renderMasters();
      renderMonthInstances();
      window.dispatchEvent(new Event("state:changed"));
    }
  });

  monthContainer?.addEventListener("click", (event) => {
    const toggle = event.target.closest('button[data-action="toggle"]');
    if (toggle) {
      const section = toggle.closest("section.fix-month-card");
      const month = section?.dataset.month;
      if (!month) return;
      if (collapsedMonths.has(month)) collapsedMonths.delete(month);
      else collapsedMonths.add(month);
      renderMonthInstances();
      return;
    }

    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const section = btn.closest("section.fix-month-card");
    const month = section?.dataset.month;
    if (!month) return;

    if (action === "confirm-all" || action === "suppress-auto") {
      const instances = expandFixcostInstances(state, { today: new Date() }).filter((inst) => inst.month === month);
      if (action === "confirm-all") {
        const targets = instances.filter((inst) => !inst.paid);
        if (!targets.length) return;
        if (confirm(`Möchten Sie wirklich alle ${targets.length} offenen Fixkosten als bezahlt markieren?`)) {
          setEventsManualPaid(targets.map((inst) => inst.id), true);
          window.dispatchEvent(new Event("state:changed"));
          renderMonthInstances();
        }
      } else if (action === "suppress-auto") {
        const targets = instances.filter((inst) => inst.autoPaid);
        if (!targets.length) return;
        if (confirm(`Automatische Markierung für ${targets.length} Fixkosten deaktivieren?`)) {
          setEventsManualPaid(targets.map((inst) => inst.id), false);
          window.dispatchEvent(new Event("state:changed"));
          renderMonthInstances();
        }
      }
      return;
    }

    const row = btn.closest("tr.fix-instance");
    if (!row) return;
    const id = row.dataset.id;
    const instances = expandFixcostInstances(state, { today: new Date() });
    const inst = instances.find((item) => item.id === id);
    if (!inst) return;

    if (action === "edit") {
      editingInstanceId = editingInstanceId === id ? null : id;
      renderMonthInstances();
    } else if (action === "reset") {
      if (state.fixcostOverrides?.[inst.fixedCostId]?.[inst.month]) {
        delete state.fixcostOverrides[inst.fixedCostId][inst.month];
        if (!Object.keys(state.fixcostOverrides[inst.fixedCostId]).length) {
          delete state.fixcostOverrides[inst.fixedCostId];
        }
        saveState(state);
        editingInstanceId = null;
        renderMonthInstances();
        window.dispatchEvent(new Event("state:changed"));
      }
    } else if (action === "toggle-paid") {
      const checkbox = btn.closest("label")?.querySelector("input[type=checkbox]");
      const checked = checkbox?.checked;
      const duePast = inst.dueDateIso ? new Date(inst.dueDateIso) <= new Date() : false;
      const autoCheck = state.status?.autoManualCheck === true;
      const autoEligible = inst.autoPaid === true && !autoCheck;
      const autoDefault = autoEligible && duePast;
      if (autoEligible && checked === autoDefault) {
        clearEventManualPaid(inst.id);
      } else {
        setEventManualPaid(inst.id, checked);
      }
      window.dispatchEvent(new Event("state:changed"));
      renderMonthInstances();
    }
  });

  monthContainer?.addEventListener("change", (event) => {
    if (event.target.matches("input[data-action='toggle-paid']")) {
      // handled via click listener
    }
  });

  monthContainer?.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "save-override" || btn.dataset.action === "cancel-override") {
      event.preventDefault();
      const editRow = btn.closest("tr.fix-instance-edit");
      const instRow = editRow?.previousElementSibling;
      const id = instRow?.dataset.id;
      const instances = expandFixcostInstances(state, { today: new Date() });
      const inst = instances.find((item) => item.id === id);
      if (!inst) return;

      if (btn.dataset.action === "cancel-override") {
        editingInstanceId = null;
        renderMonthInstances();
        return;
      }

      const amountInput = editRow.querySelector("input[data-field='overrideAmount']");
      const dueInput = editRow.querySelector("input[data-field='overrideDue']");
      const noteInput = editRow.querySelector("input[data-field='overrideNote']");
      const grossInput = editRow.querySelector("input[data-field='overrideGross']");
      const vatInput = editRow.querySelector("input[data-field='overrideVatRate']");
      const errorBox = editRow.querySelector(".edit-error");
      const amountValue = amountInput?.value || "";
      const parsedAmount = parseCurrency(amountValue);
      if (!(parsedAmount > 0)) {
        errorBox.textContent = "Bitte Betrag > 0 eingeben.";
        return;
      }
      const isoDue = dueInput?.value ? toIsoDate(dueInput.value) : inst.dueDateIso || "";
      if (dueInput?.value && !isoDue) {
        errorBox.textContent = "Bitte TT.MM.JJJJ eingeben.";
        return;
      }

      if (!state.fixcostOverrides[inst.fixedCostId]) state.fixcostOverrides[inst.fixedCostId] = {};
      state.fixcostOverrides[inst.fixedCostId][inst.month] = {
        amount: formatCurrency(parsedAmount),
        dueDate: isoDue,
        note: noteInput?.value?.trim() || "",
        isGross: grossInput?.checked ?? inst.isGross,
        vatRate: vatInput?.value || inst.vatRate,
      };
      saveState(state);
      editingInstanceId = null;
      renderMonthInstances();
      window.dispatchEvent(new Event("state:changed"));
    }
  });
}

export { render };
export default { render };
