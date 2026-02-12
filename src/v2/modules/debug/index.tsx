import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Select, Space, Tag, Typography, message } from "antd";
import { computeAbcClassification } from "../../../domain/abcClassification.js";
import { countDrafts, getLastCommitSummary } from "../../../storage/store.js";
import { createEmptyAppStateV2, ensureAppStateV2 } from "../../state/appState";
import type { AppStateV2 } from "../../state/types";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

interface AbcDebugEntry {
  sku: string;
  active: boolean;
  vkPriceGross: number | null;
  units6m: number | null;
  revenue6m: number | null;
  abcClass: string | null;
}

interface AbcDebugSnapshot {
  months: string[];
  bySku: Map<string, AbcDebugEntry>;
}

function normalizeSku(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function hasExistingData(state: Record<string, unknown>): boolean {
  const keys = ["pos", "fos", "incomings", "extras", "fixcosts", "dividends", "products"];
  return keys.some((key) => Array.isArray(state[key]) && (state[key] as unknown[]).length > 0);
}

function formatNumber(value: unknown, digits = 2): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export default function DebugModule(): JSX.Element {
  const { state, loading, saving, error, saveWith } = useWorkspaceState();
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedSku, setSelectedSku] = useState("");
  const [lastSnapshot, setLastSnapshot] = useState<AppStateV2 | null>(null);

  const stateObject = state as unknown as Record<string, unknown>;
  const commitSummary = getLastCommitSummary();
  const draftCount = countDrafts();

  const skuOptions = useMemo(() => {
    return (Array.isArray(state.products) ? state.products : [])
      .map((entry) => {
        const row = (entry || {}) as Record<string, unknown>;
        return String(row.sku || "").trim();
      })
      .filter(Boolean);
  }, [state.products]);

  useEffect(() => {
    if (!skuOptions.length) {
      setSelectedSku("");
      return;
    }
    if (!selectedSku || !skuOptions.includes(selectedSku)) {
      setSelectedSku(skuOptions[0]);
    }
  }, [selectedSku, skuOptions]);

  const abcSnapshot = useMemo(
    () => computeAbcClassification(stateObject) as AbcDebugSnapshot,
    [state],
  );

  const abcInfo = useMemo(() => {
    if (!selectedSku) return null;
    return abcSnapshot.bySku.get(normalizeSku(selectedSku)) || null;
  }, [abcSnapshot.bySku, selectedSku]);

  async function runSeed(): Promise<void> {
    const currentSnapshot = ensureAppStateV2(structuredClone(stateObject));
    if (hasExistingData(stateObject)) {
      const confirmed = window.confirm("Daten vorhanden - ueberschreiben?");
      if (!confirmed) return;
      setLastSnapshot(currentSnapshot);
    } else {
      setLastSnapshot(null);
    }
    const debugUi = await import("../../../ui/debug.js");
    await saveWith(() => ensureAppStateV2(debugUi.buildDemoState()), "v2:debug:seed");
    messageApi.success("Testdaten wurden geladen.");
  }

  async function runWipe(): Promise<void> {
    const confirmed = window.confirm("Wirklich alle Daten loeschen?");
    if (!confirmed) return;
    await saveWith(() => createEmptyAppStateV2(), "v2:debug:wipe");
    messageApi.success("Alle Daten wurden zurueckgesetzt.");
  }

  async function runUndo(): Promise<void> {
    if (!lastSnapshot) return;
    await saveWith(() => ensureAppStateV2(lastSnapshot), "v2:debug:undo");
    setLastSnapshot(null);
    messageApi.success("Letzter Seed wurde rueckgaengig gemacht.");
  }

  return (
    <div className="v2-page">
      {contextHolder}
      <Card className="v2-intro-card">
        <Title level={3}>Debug / Werkzeuge (V2 Native)</Title>
        <Paragraph>
          Hilfsfunktionen zum schnellen Befuellen, Zuruecksetzen und Pruefen der ABC-Klassifizierung.
        </Paragraph>
        <Space wrap>
          <Button onClick={() => { void runSeed(); }} loading={saving}>
            Testdaten &amp; POs laden
          </Button>
          <Button danger onClick={() => { void runWipe(); }} loading={saving}>
            Alle Daten loeschen
          </Button>
          <Button onClick={() => { void runUndo(); }} disabled={!lastSnapshot} loading={saving}>
            Letzten Seed rueckgaengig
          </Button>
          <Tag color="blue">Drafts (lokal): {draftCount}</Tag>
        </Space>
        <Space direction="vertical" size={2} style={{ marginTop: 12 }}>
          <Text>Storage-Key: <strong>{commitSummary.storageKey || "-"}</strong></Text>
          <Text>Last Commit: <strong>{commitSummary.lastCommitAt || "-"}</strong></Text>
          <Text style={{ maxWidth: 960 }}>
            Last Commit Meta:{" "}
            <strong>{commitSummary.lastCommitMeta ? JSON.stringify(commitSummary.lastCommitMeta) : "-"}</strong>
          </Text>
        </Space>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <Title level={4}>ABC Debug</Title>
        <Paragraph type="secondary">
          Kontrolle der ABC-Berechnung auf Basis Forecast der naechsten 6 Monate.
        </Paragraph>
        <Space wrap align="start">
          <div>
            <Text>SKU</Text>
            <Select
              value={selectedSku || undefined}
              onChange={(value) => setSelectedSku(value)}
              placeholder="SKU waehlen"
              style={{ width: 280 }}
              options={skuOptions.map((sku) => ({ label: sku, value: sku }))}
            />
          </div>
          <div>
            <Text>Forecast-Monate</Text>
            <div>{abcSnapshot.months.length ? abcSnapshot.months.join(", ") : "-"}</div>
          </div>
        </Space>

        <Space direction="vertical" style={{ marginTop: 14 }}>
          <Text>VK-Preis (Brutto): <strong>{formatNumber(abcInfo?.vkPriceGross, 2)}</strong></Text>
          <Text>Forecast Units (6M): <strong>{formatNumber(abcInfo?.units6m, 0)}</strong></Text>
          <Text>Umsatz 6M: <strong>{formatNumber(abcInfo?.revenue6m, 2)}</strong></Text>
          <Text>ABC: <strong>{abcInfo?.abcClass || "-"}</strong></Text>
          <Text>Aktiv: <strong>{abcInfo?.active ? "ja" : "nein"}</strong></Text>
        </Space>
      </Card>
    </div>
  );
}
