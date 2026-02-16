import test from "node:test";
import assert from "node:assert/strict";
import {
  appendForecastVersion,
  deleteForecastVersion,
  ensureForecastVersioningContainers,
  setActiveVersion,
} from "./forecastVersioning.ts";

test("forecast versioning migrates legacy forecastImport into first version", () => {
  const forecast = {
    forecastImport: {
      "SKU-1": {
        "2026-02": { units: 120 },
      },
    },
    versions: [],
    activeVersionId: null,
    importSource: "ventoryone",
    lastImportAt: "2026-01-29T13:32:00.000Z",
  };

  ensureForecastVersioningContainers(forecast);

  assert.equal(Array.isArray(forecast.versions), true);
  assert.equal((forecast.versions as unknown[]).length, 1);
  assert.equal(typeof forecast.activeVersionId, "string");
  assert.deepEqual(
    (forecast.forecastImport as Record<string, unknown>)["SKU-1"],
    ((forecast.versions as Array<Record<string, unknown>>)[0].forecastImport as Record<string, unknown>)["SKU-1"],
  );
});

test("setActiveVersion updates activeVersionId and forecastImport mirror", () => {
  const forecast = {
    forecastImport: {},
    versions: [],
    activeVersionId: null,
  };

  const v1 = appendForecastVersion(forecast, {
    name: "V1",
    createdAt: "2026-01-01T00:00:00.000Z",
    forecastImport: {
      "SKU-1": { "2026-02": { units: 100 } },
    },
  });
  const v2 = appendForecastVersion(forecast, {
    name: "V2",
    createdAt: "2026-02-01T00:00:00.000Z",
    forecastImport: {
      "SKU-1": { "2026-02": { units: 180 } },
    },
  });

  const switched = setActiveVersion(forecast, v1.id);
  assert.equal(switched.ok, true);
  assert.equal(forecast.activeVersionId, v1.id);
  assert.equal(
    ((((forecast.forecastImport as Record<string, unknown>)["SKU-1"] as Record<string, unknown>)["2026-02"] as Record<string, unknown>).units),
    100,
  );

  const switchedAgain = setActiveVersion(forecast, v2.id);
  assert.equal(switchedAgain.ok, true);
  assert.equal(forecast.activeVersionId, v2.id);
  assert.equal(
    ((((forecast.forecastImport as Record<string, unknown>)["SKU-1"] as Record<string, unknown>)["2026-02"] as Record<string, unknown>).units),
    180,
  );
});

test("deleteForecastVersion blocks active baseline and deletes non-active versions", () => {
  const forecast = {
    forecastImport: {},
    versions: [],
    activeVersionId: null,
  };
  const v1 = appendForecastVersion(forecast, {
    name: "V1",
    createdAt: "2026-01-01T00:00:00.000Z",
    forecastImport: { "SKU-1": { "2026-02": { units: 90 } } },
  });
  const v2 = appendForecastVersion(forecast, {
    name: "V2",
    createdAt: "2026-02-01T00:00:00.000Z",
    forecastImport: { "SKU-1": { "2026-02": { units: 140 } } },
  });
  setActiveVersion(forecast, v2.id);

  const blocked = deleteForecastVersion(forecast, v2.id);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "ACTIVE_VERSION");

  const deleted = deleteForecastVersion(forecast, v1.id);
  assert.equal(deleted.ok, true);
  assert.equal((forecast.versions as unknown[]).length, 1);
  assert.equal(((forecast.versions as Array<Record<string, unknown>>)[0].id), v2.id);
});
