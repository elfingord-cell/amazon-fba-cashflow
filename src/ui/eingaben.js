// FBA-CF-0002 — Eingaben-View: de-DE Zahleneingabe + Persistenz (localStorage)
import { attachNumberField } from "./controls/number.js";
import { loadState, saveState } from "../data/storageLocal.js";

export async function render(root) {
  const state = loadState(); // { openingEur, monthlyAmazonEur, payoutPct }
  const opening = state.openingEur ?? 50000;
  const monthly = state.monthlyAmazonEur ?? 20000;
  const payout = state.payoutPct ?? 0.85; // 85%

  root.innerHTML = `
    <section class="card">
      <h2>Eingaben</h2>
      <p class="muted">Diese Felder nutzen deutsches Zahlenformat. Beim Tippen bleibt der Cursor stabil; beim Verlassen wird formatiert.</p>
      <div class="grid two" style="align-items:flex-start; gap:16px;">
        <div>
          <label for="in-opening" class="lbl">Opening (EUR)</label>
          <input id="in-opening" class="inpt" inputmode="decimal" autocomplete="off" value="${formatDE(opening,2)}" />
          <div class="hint">Beispiel: <code>50.000,00</code></div>
        </div>
        <div>
          <label for="in-monthly" class="lbl">Monatl. Amazon-Auszahlung (EUR)</label>
          <input id="in-monthly" class="inpt" inputmode="decimal" autocomplete="off" value="${formatDE(monthly,2)}" />
          <div class="hint">Beispiel: <code>22.500,00</code></div>
        </div>
        <div>
          <label for="in-payout" class="lbl">Payout-Quote (%)</label>
          <input id="in-payout" class="inpt" inputmode="decimal" autocomplete="off" value="${formatPct(payout)}" />
          <div class="hint">Beispiel: <code>85</code> oder <code>0,85</code></div>
        </div>
      </div>
    </section>
  `;

  // Controls anschließen
  attachNumberField(root.querySelector("#in-opening"), {
    decimals: 2,
    onNumber: (n) => {
      patch({ openingEur: n ?? null });
    },
  });

  attachNumberField(root.querySelector("#in-monthly"), {
    decimals: 2,
    onNumber: (n) => {
      patch({ monthlyAmazonEur: n ?? null });
    },
  });

  // Payout: erlaubt Prozent (85) oder Faktor (0,85)
  attachNumberField(root.querySelector("#in-payout"), {
    decimals: 2,
    onNumber: (n) => {
      if (n == null) return patch({ payoutPct: null });
      const val = n > 1 ? n / 100 : n; // 85 → 0,85
      patch({ payoutPct: clamp(val, 0, 1) });
    },
  });

  function patch(p) {
    const s = loadState();
    saveState({ ...s, ...p });
  }
}

// kleine lokale Helfer (keine globale Abhängigkeit)
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function formatDE(n, d=2) { try { return Number(n).toLocaleString("de-DE",{minimumFractionDigits:d, maximumFractionDigits:d}); } catch { return ""; } }
function formatPct(p) {
  if (p == null || !isFinite(p)) return "";
  // zeige in Prozent ohne %-Zeichen
  const v = p > 1 ? p : (p * 100);
  return v.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}
