
import { fmtEUR } from "../domain/helpers.js";

export function PlanView(state) {
  const el = document.createElement("section");
  const rows = state._computed.monthly.map(r => `
    <tr>
      <td>${r.month}</td>
      <td>${fmtEUR(r.inflow)}</td>
      <td>${fmtEUR(r.outflow)}</td>
      <td>${fmtEUR(r.net)}</td>
      <td>${fmtEUR(r.closing)}</td>
    </tr>
  `).join("");
  el.innerHTML = `
    <div class="card">
      <h3>Monatsübersicht</h3>
      <table>
        <thead><tr><th>Monat</th><th>Inflow</th><th>Outflow</th><th>Netto</th><th>Closing</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  return el;
}
