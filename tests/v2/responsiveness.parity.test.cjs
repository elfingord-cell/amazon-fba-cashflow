const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../..");

function readText(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

test("responsiveness parity: shell supports dedicated mobile navigation flow", () => {
  const shellSource = readText("src/v2/app/V2Shell.tsx");

  assert.match(shellSource, /Grid\.useBreakpoint\(\)/);
  assert.match(shellSource, /const isMobile = !isDesktop;/);
  assert.match(shellSource, /<Drawer/);
  assert.match(shellSource, /MenuOutlined/);
  assert.match(shellSource, /setMobileMenuOpen\(true\)/);
  assert.match(shellSource, /setMobileMenuOpen\(false\)/);
});

test("responsiveness parity: shell stylesheet provides breakpoint-specific layout rules", () => {
  const cssSource = readText("src/v2/app/v2-shell.css");

  assert.match(cssSource, /@media \(max-width: 1024px\)/);
  assert.match(cssSource, /@media \(max-width: 992px\)/);
  assert.match(cssSource, /\.v2-header-meta/);
  assert.match(cssSource, /\.v2-form-row/);
  assert.match(cssSource, /\.v2-toolbar-field/);
});

test("responsiveness parity: central module toolbars guard against mobile overflow", () => {
  const productsSource = readText("src/v2/modules/products/index.tsx");
  const forecastSource = readText("src/v2/modules/forecast/index.tsx");
  const inventorySource = readText("src/v2/modules/inventory/index.tsx");
  const paymentsSource = readText("src/v2/modules/payments-export/index.tsx");
  const dashboardSource = readText("src/v2/modules/dashboard/index.tsx");

  assert.match(productsSource, /<Space wrap>/);
  assert.match(productsSource, /className=\"v2-form-row\"/);
  assert.match(productsSource, /maxWidth: \"100%\"/);
  assert.match(forecastSource, /maxWidth: \"100%\"/);
  assert.match(inventorySource, /maxWidth: \"100%\"/);
  assert.match(paymentsSource, /className=\"v2-toolbar-field\"/);
  assert.match(dashboardSource, /<Col xs=\{24\} md=\{12\} xl=\{6\}>/);
});

test("responsiveness parity: tabular content remains horizontally scrollable", () => {
  const gridSource = readText("src/v2/components/TanStackGrid.tsx");
  const cssSource = readText("src/v2/app/v2-shell.css");

  assert.match(gridSource, /className \|\| \"v2-stats-table-wrap\"/);
  assert.match(cssSource, /\.v2-stats-table-wrap\s*\{[^}]*overflow:\s*auto;/s);
  assert.match(cssSource, /\.v2-stats-table\s*\{[^}]*min-width:\s*640px;/s);
});
