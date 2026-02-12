const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SupabaseStorageAdapter,
  SupabaseFirstStorageAdapter,
} = require("../../.test-build/migration/v2/sync/storageAdapters.js");
const { ensureAppStateV2 } = require("../../.test-build/migration/v2/state/appState.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MemoryAdapter {
  constructor(state) {
    this.state = ensureAppStateV2(state);
    this.saved = [];
  }

  async load() {
    return clone(this.state);
  }

  async save(next, meta) {
    this.state = ensureAppStateV2(next);
    this.saved.push({ next: clone(this.state), meta: clone(meta) });
  }
}

test("sync parity: conflict flow refreshes remote revision before overwrite retry", async () => {
  const calls = [];
  let currentRev = "rev-1";
  let fetchCalls = 0;

  const remoteApi = {
    async fetchRemoteState() {
      fetchCalls += 1;
      return {
        exists: true,
        rev: currentRev,
        data: ensureAppStateV2({
          settings: { openingBalance: "10,00" },
          products: [{ sku: "SKU-REMOTE-1", alias: "Remote" }],
        }),
      };
    },
    async pushRemoteState(input) {
      calls.push(clone(input));
      if (calls.length === 1) {
        currentRev = "rev-2";
        const error = new Error("Remote state conflict");
        error.name = "ConflictError";
        throw error;
      }
      currentRev = "rev-3";
      return { ok: true, rev: currentRev };
    },
  };

  const adapter = new SupabaseStorageAdapter({
    remoteApiLoader: async () => remoteApi,
  });

  await adapter.load();

  await assert.rejects(
    adapter.save(ensureAppStateV2({ settings: { openingBalance: "11,00" } }), { source: "sync-test" }),
    (error) => error?.name === "ConflictError",
  );

  await adapter.save(ensureAppStateV2({ settings: { openingBalance: "12,00" } }), { source: "sync-test" });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].ifMatchRev, "rev-1");
  assert.equal(calls[1].ifMatchRev, "rev-2");
  assert.equal(fetchCalls, 2);
  assert.equal(calls[1].updatedBy, "sync-test");
  assert.equal(calls[1].data.settings.openingBalance, "12,00");
});

test("sync parity: offline fallback persists locally and resumes remote sync after reconnect", async () => {
  let remoteShouldFail = true;
  const remoteSaves = [];

  const remote = {
    async load() {
      if (remoteShouldFail) {
        throw new Error("fetch failed: offline");
      }
      return ensureAppStateV2({
        settings: { openingBalance: "77,00" },
      });
    },
    async save(next, meta) {
      if (remoteShouldFail) {
        throw new Error("network timeout while fetching");
      }
      remoteSaves.push({ next: clone(next), meta: clone(meta) });
    },
  };

  const local = new MemoryAdapter({
    settings: { openingBalance: "5,00" },
  });

  const adapter = new SupabaseFirstStorageAdapter({
    local,
    remote,
  });

  const loadedWhileOffline = await adapter.load();
  assert.equal(loadedWhileOffline.settings.openingBalance, "5,00");

  await adapter.save(ensureAppStateV2({ settings: { openingBalance: "9,00" } }), { source: "offline-flow" });
  assert.equal(local.saved.length, 1);
  assert.equal(local.saved[0].meta.source, "offline-flow:fallback");
  assert.equal(remoteSaves.length, 0);

  remoteShouldFail = false;
  await adapter.save(ensureAppStateV2({ settings: { openingBalance: "15,00" } }), { source: "offline-flow" });

  assert.equal(remoteSaves.length, 1);
  assert.equal(remoteSaves[0].meta.source, "offline-flow");
  assert.equal(remoteSaves[0].next.settings.openingBalance, "15,00");

  assert.equal(local.saved.length, 2);
  assert.equal(local.saved[1].meta.source, "offline-flow:cache");
  assert.equal(local.saved[1].next.settings.openingBalance, "15,00");
});
