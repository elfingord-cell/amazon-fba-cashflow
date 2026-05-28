import { useMemo, useState } from "react";
import { Alert, Button, Card, Modal, Select, Space, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "../../components/DataTable";
import { SkuAliasCell } from "../../components/SkuAliasCell";
import { findGhostFoCandidates, type GhostFoCandidate } from "../../domain/ghostFo";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

type ConfidenceFilter = "all" | "high" | "medium" | "low";

interface GhostFoRow extends GhostFoCandidate {
  rowKey: string;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "—";
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
}

function confidenceTag(confidence: GhostFoCandidate["confidence"]): JSX.Element {
  if (confidence === "high") return <Tag color="red">Hoch</Tag>;
  if (confidence === "medium") return <Tag color="orange">Mittel</Tag>;
  return <Tag color="default">Niedrig</Tag>;
}

export default function GhostFoListView(): JSX.Element {
  const { state, saveWith } = useWorkspaceState();
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all");
  const [busyFoId, setBusyFoId] = useState<string>("");

  const candidates = useMemo(() => findGhostFoCandidates(state), [state]);

  const filtered = useMemo<GhostFoRow[]>(() => {
    const list = confidenceFilter === "all"
      ? candidates
      : candidates.filter((c) => c.confidence === confidenceFilter);
    return list.map((c) => ({ ...c, rowKey: `${c.foId}::${c.sku}` }));
  }, [candidates, confidenceFilter]);

  const counts = useMemo(() => ({
    total: candidates.length,
    high: candidates.filter((c) => c.confidence === "high").length,
    medium: candidates.filter((c) => c.confidence === "medium").length,
    low: candidates.filter((c) => c.confidence === "low").length,
  }), [candidates]);

  async function markFoAsConverted(foId: string, foNumber: string): Promise<void> {
    setBusyFoId(foId);
    try {
      await saveWith((current) => {
        const next = ensureAppStateV2(current);
        const nextState = next as unknown as Record<string, unknown>;
        const fos = (Array.isArray(nextState.fos) ? nextState.fos : []) as Array<Record<string, unknown>>;
        const idx = fos.findIndex((f) => String(f?.id || f?.foNo || "") === foId);
        if (idx < 0) throw new Error(`FO ${foNumber} nicht gefunden.`);
        const record = { ...(fos[idx] as Record<string, unknown>) };
        record.status = "CONVERTED";
        record.convertedAt = new Date().toISOString();
        record.convertedReason = "ghost-fo-cleanup";
        const list = [...fos];
        list[idx] = record;
        nextState.fos = list;
        return next;
      }, "v2:ghost-fo:convert");
      message.success(`FO ${foNumber} als CONVERTED markiert.`);
    } catch (err) {
      message.error(`FO ${foNumber}: ${err instanceof Error ? err.message : "Fehler"}`);
    } finally {
      setBusyFoId("");
    }
  }

  function confirmConvert(row: GhostFoRow): void {
    Modal.confirm({
      title: `FO ${row.foNumber} als erledigt markieren?`,
      content: (
        <div>
          <Paragraph>
            <Text strong>{row.alias}</Text> ({row.sku})
            <br />
            <Text type="secondary">Target: {formatDate(row.foTargetDate)} · {row.foUnits} Stk</Text>
          </Paragraph>
          <Paragraph>
            Vermutete Abdeckung durch:
            <ul style={{ marginTop: 4 }}>
              {row.matchedPos.map((m) => (
                <li key={m.poId}>
                  <Text code>{m.poNumber || m.poId}</Text>: {m.unitsForSku} Stk
                  {m.arrivalDate ? ` (angekommen ${formatDate(m.arrivalDate)})` : (m.etaIso ? ` (ETA ${formatDate(m.etaIso)})` : "")}
                </li>
              ))}
            </ul>
          </Paragraph>
          <Paragraph type="secondary">
            Der FO-Status wird auf <Text code>CONVERTED</Text> gesetzt. Damit verschwindet sie aus
            den Forecast-Planungen, bleibt aber zur Historie im State erhalten.
          </Paragraph>
        </div>
      ),
      okText: "Als CONVERTED markieren",
      cancelText: "Abbrechen",
      width: 560,
      onOk: () => markFoAsConverted(row.foId, row.foNumber),
    });
  }

  const columns = useMemo<ColumnDef<GhostFoRow>[]>(() => [
    {
      header: "Alias",
      accessorKey: "alias",
      meta: { width: 220, minWidth: 200 },
      cell: ({ row }) => <SkuAliasCell alias={row.original.alias} sku={row.original.sku} />,
    },
    {
      header: "FO",
      accessorKey: "foNumber",
      meta: { width: 90 },
      cell: ({ row }) => <Text code>{row.original.foNumber || "—"}</Text>,
    },
    {
      header: "FO Mengen",
      accessorKey: "foUnits",
      meta: { width: 100, align: "right" },
      cell: ({ row }) => row.original.foUnits.toLocaleString("de-DE"),
    },
    {
      header: "FO Target",
      accessorKey: "foTargetDate",
      meta: { width: 110, align: "right" },
      cell: ({ row }) => formatDate(row.original.foTargetDate),
    },
    {
      header: "Coverage",
      accessorKey: "coverageRatio",
      meta: { width: 90, align: "right" },
      cell: ({ row }) => {
        const pct = Math.round(row.original.coverageRatio * 100);
        return (
          <Tooltip title={`${row.original.matchedUnitsTotal} / ${row.original.foUnits} Stk`}>
            <span>{pct}%</span>
          </Tooltip>
        );
      },
    },
    {
      header: "Matched POs",
      meta: { width: 280, minWidth: 240 },
      cell: ({ row }) => (
        <Space direction="vertical" size={0}>
          {row.original.matchedPos.map((m) => (
            <div key={m.poId}>
              <Text code>{m.poNumber || m.poId}</Text>{" "}
              <Text type="secondary">
                {m.unitsForSku} Stk ·{" "}
                {m.arrivalDate ? `angek. ${formatDate(m.arrivalDate)}` : m.etaIso ? `ETA ${formatDate(m.etaIso)}` : "kein ETA"}
              </Text>
            </div>
          ))}
        </Space>
      ),
    },
    {
      header: "Lieferant FO",
      accessorKey: "foSupplierName",
      meta: { width: 130 },
      cell: ({ row }) => <Text>{row.original.foSupplierName || "—"}</Text>,
    },
    {
      header: "Konfidenz",
      accessorKey: "confidence",
      meta: { width: 100, align: "center" },
      cell: ({ row }) => (
        <Tooltip title={row.original.reason}>
          <span>{confidenceTag(row.original.confidence)}</span>
        </Tooltip>
      ),
    },
    {
      header: "Aktion",
      meta: { width: 200 },
      cell: ({ row }) => (
        <Space>
          <Button
            size="small"
            type="primary"
            danger
            loading={busyFoId === row.original.foId}
            onClick={() => confirmConvert(row.original)}
          >
            Als CONVERTED markieren
          </Button>
        </Space>
      ),
    },
  ], [busyFoId]);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={4}>Möglicherweise verwaiste FOs</Title>
            <Paragraph>
              FOs, deren Bedarf vermutlich schon durch eine bereits angelegte PO gedeckt ist —
              typischerweise weil die PO manuell angelegt wurde (ohne FO-Konversion) und die FO
              danach offen blieb. Defensiv erkannt: SKU-Match + ähnliches Zeitfenster + Mengen-Deckung.
              Nur Vorschlag, kein Auto-Cleanup.
            </Paragraph>
          </div>
        </div>
      </Card>

      <Card>
        <div className="v2-toolbar-row">
          <Space size="middle" wrap>
            <Text type="secondary">{counts.total} Vorschläge</Text>
            <Tag color="red">Hoch: {counts.high}</Tag>
            <Tag color="orange">Mittel: {counts.medium}</Tag>
            <Tag>Niedrig: {counts.low}</Tag>
          </Space>
          <Space>
            <Text type="secondary">Konfidenz:</Text>
            <Select
              size="small"
              value={confidenceFilter}
              onChange={(value) => setConfidenceFilter(value as ConfidenceFilter)}
              style={{ width: 160 }}
              options={[
                { value: "all", label: "Alle" },
                { value: "high", label: "Nur Hoch" },
                { value: "medium", label: "Hoch + Mittel" },
                { value: "low", label: "Nur Niedrig" },
              ]}
            />
          </Space>
        </div>

        {!filtered.length ? (
          <Alert
            type="success"
            showIcon
            style={{ marginTop: 16 }}
            message="Keine verwaisten FOs gefunden"
            description="Alle aktiven FOs haben aktuell keinen Match zu einer bestehenden PO im Zeitfenster."
          />
        ) : (
          <div style={{ marginTop: 12 }}>
            <DataTable
              data={filtered}
              columns={columns}
              minTableWidth={1200}
              tableLayout="fixed"
            />
          </div>
        )}
      </Card>
    </div>
  );
}
