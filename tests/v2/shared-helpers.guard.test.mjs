// Guard: verhindert, dass round2/addDays/normalizeMonthKey/currentMonthKey
// wieder lokal reimplementiert werden (Audit 2026-06-09, Finding D1/D4).
// Kanonische Implementierungen leben ausschließlich in src/domain/shared/.
// Dünne Wrapper, die an shared delegieren (z. B. `normalizeMonthKey(v) ?? ""`),
// sind erlaubt — verboten ist eigene Rechen-/Parsing-Logik im Funktionskörper.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC = join(ROOT, "src");

// V1 (src/ui) ist eingefroren und wird nicht mehr angefasst; src/domain/shared ist der Kanon.
const EXCLUDED = [/^ui\//, /^domain\/shared\//];

const GUARDED_NAMES = ["round2", "addDays", "addDaysIso", "currentMonthKey", "normalizeMonthKey"];

// Marker für "eigene Implementierung" im Funktionskörper (statt Delegation an shared)
const IMPLEMENTATION_MARKERS = [
  /Math\.round/,
  /setUTCDate|setDate/,
  /getTime\(\)\s*\+/,
  /\\d\{4\}/, // Monats-Regex-Parsing
  /getFullYear/,
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(js|jsx|ts|tsx|mjs)$/.test(entry) && !/\.test\./.test(entry)) files.push(full);
  }
  return files;
}

test("Keine Reimplementierung von round2/addDays/normalizeMonthKey/currentMonthKey außerhalb src/domain/shared", () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).replace(/\\/g, "/");
    if (EXCLUDED.some((rx) => rx.test(rel))) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, idx) => {
      for (const name of GUARDED_NAMES) {
        const defRx = new RegExp(`(function ${name}\\s*\\(|const ${name}\\s*=)`);
        if (!defRx.test(line)) continue;
        const body = lines.slice(idx, idx + 9).join("\n");
        if (IMPLEMENTATION_MARKERS.some((rx) => rx.test(body))) {
          offenders.push(`${rel}:${idx + 1} — lokale ${name}-Implementierung; bitte aus src/domain/shared/ importieren`);
        }
      }
    });
  }
  assert.deepEqual(offenders, []);
});
