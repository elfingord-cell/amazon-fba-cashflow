// FBA-CF-0002(+label fix) — Eingaben-View: de-DE Zahleneingabe + Persistenz
import { attachNumberField } from "./controls/number.js";
import { loadState, saveState } from "../data/storageLocal.js";

export async function render(root) {
  const state = loadState();
  const opening = state.openingEur ?? 50000;
  const monthly = state.monthlyAmazonEur ?? 20000; // Umsatz (brutto Cash-In Basis)
  const payout = state.payoutPct ?? 0.85;          // Faktor

  root.innerHTML = `
    <section class="card">
      <h2>Eingaben</h2>
      <p class="muted">deutsches Zahlenformat; beim Tippen kein Cursor-Sprung; beim Verlassen formatiert.</p>
      <div class="grid two" style="align-items:flex-start; gap:16px;">
        <div>
          <label for="in-opening" class="lbl">Opening (EUR)</label>
          <input id="in-opening" class="inpt" inputmode="decimal" autocomplete="off" value="${formatDE(opening,2)}" />
          <div class="hint">Beispiel: <code>50.000,00</code></div>
        </div>
        <div>
          <label for="in-monthly" class="lbl">Monatlicher Umsatz (EUR)</label>
          <input id="in-monthly" class="inpt" inputmode="decimal" autocomplete="off" value="${formatDE(monthly,2)}" />
          <div class="hint">Wird mit der Payout-Quote multipliziert</div>
        </div>
        <div>
          <label for="in-payout" class="lbl">Payout-Quote (%)</label>
          <input id="in-payout" class="inpt" inputmode="decimal" autocomplete="off" value="${formatPct(payout)}" />
          <div class="hint">z.B. <code>85</code> oder <code>0,85</code></div>
        </div>
      </div>
    </section>
  `;

  attachNumberField(root.querySelector("#in-opening"), {
    decimals: 2,
    onNumber: (n) => patch({ openingEur: n ?? null }),
  });
  attachNumberField(root.querySelector("#in-monthly"), {
    decimals: 2,
    onNumber: (n) => patch({ monthlyAmazonEur: n ?? null }),
  });
  attachNumberField(root.querySelector("#in-payout"), {
    decimals: 2,
    onNumber: (n) => {
      if (n == null) return patch({ payoutPct: null });
      const val = n > 1 ? n / 100 : n;
      patch({ payoutPct: clamp(val, 0, 1) });
    },
  });

  function patch(p) { const s = loadState(); saveState({ ...s, ...p }); }
}

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function formatDE(n, d=2) { try { return Number(n).toLocaleString("de-DE",{minimumFractionDigits:d, maximumFractionDigits:d}); } catch { return ""; } }
function formatPct(p) { if (p==null||!isFinite(p)) return ""; const v = p>1? p : (p*100); return v.toLocaleString("de-DE",{maximumFractionDigits:2}); }
