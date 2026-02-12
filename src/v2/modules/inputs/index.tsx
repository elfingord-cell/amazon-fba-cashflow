import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";
import { currentMonthKey } from "../../domain/months";
import { randomId } from "../../domain/orderUtils";

const { Paragraph, Text, Title } = Typography;

interface IncomingDraft {
  id: string;
  month: string;
  revenueEur: number | null;
  payoutPct: number | null;
  source: "manual" | "forecast";
}

interface ExtraDraft {
  id: string;
  date: string;
  label: string;
  amountEur: number | null;
}

interface DividendDraft {
  id: string;
  month: string;
  label: string;
  amountEur: number | null;
}

interface MonthlyActualDraft {
  month: string;
  realRevenueEUR: number | null;
  realPayoutRatePct: number | null;
  realClosingBalanceEUR: number | null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeMonth(value: unknown, fallback = currentMonthKey()): string {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  return fallback;
}

function formatNumber(value: unknown, digits = 2): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export default function InputsModule(): JSX.Element {
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();

  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [startMonth, setStartMonth] = useState<string>(currentMonthKey());
  const [horizonMonths, setHorizonMonths] = useState<number>(18);
  const [incomings, setIncomings] = useState<IncomingDraft[]>([]);
  const [extras, setExtras] = useState<ExtraDraft[]>([]);
  const [dividends, setDividends] = useState<DividendDraft[]>([]);
  const [monthlyActuals, setMonthlyActuals] = useState<MonthlyActualDraft[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const settings = (state.settings || {}) as Record<string, unknown>;
    setOpeningBalance(Number(settings.openingBalance || 0) || 0);
    setStartMonth(normalizeMonth(settings.startMonth, currentMonthKey()));
    setHorizonMonths(Math.max(1, Number(settings.horizonMonths || 18) || 18));

    const nextIncomings = (Array.isArray(state.incomings) ? state.incomings : [])
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        return {
          id: String(row.id || randomId("inc")),
          month: normalizeMonth(row.month, currentMonthKey()),
          revenueEur: toNumber(row.revenueEur),
          payoutPct: toNumber(row.payoutPct),
          source: String(row.source || "manual") === "forecast" ? "forecast" : "manual",
        } satisfies IncomingDraft;
      });
    setIncomings(nextIncomings);

    const nextExtras = (Array.isArray(state.extras) ? state.extras : [])
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        return {
          id: String(row.id || randomId("extra")),
          date: String(row.date || ""),
          label: String(row.label || "Extra"),
          amountEur: toNumber(row.amountEur),
        } satisfies ExtraDraft;
      });
    setExtras(nextExtras);

    const nextDividends = (Array.isArray(state.dividends) ? state.dividends : [])
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        return {
          id: String(row.id || randomId("div")),
          month: normalizeMonth(row.month, currentMonthKey()),
          label: String(row.label || "Dividende"),
          amountEur: toNumber(row.amountEur),
        } satisfies DividendDraft;
      });
    setDividends(nextDividends);

    const monthlyRaw = (state.monthlyActuals && typeof state.monthlyActuals === "object")
      ? state.monthlyActuals as Record<string, Record<string, unknown>>
      : {};
    const nextMonthlyActuals = Object.entries(monthlyRaw)
      .map(([month, row]) => ({
        month: normalizeMonth(month, currentMonthKey()),
        realRevenueEUR: toNumber(row.realRevenueEUR),
        realPayoutRatePct: toNumber(row.realPayoutRatePct),
        realClosingBalanceEUR: toNumber(row.realClosingBalanceEUR),
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
    setMonthlyActuals(nextMonthlyActuals);

    setDirty(false);
  }, [state.dividends, state.extras, state.incomings, state.monthlyActuals, state.settings]);

  const payoutByMonth = useMemo(() => {
    const map = new Map<string, number>();
    incomings.forEach((row) => {
      const revenue = Number(row.revenueEur || 0);
      const payoutPct = Number(row.payoutPct || 0);
      map.set(row.month, revenue * (payoutPct / 100));
    });
    return map;
  }, [incomings]);

  async function saveAll(): Promise<void> {
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const settings = (next.settings || {}) as Record<string, unknown>;
      next.settings = {
        ...settings,
        openingBalance,
        startMonth,
        horizonMonths: Math.max(1, Math.round(horizonMonths || 1)),
        lastUpdatedAt: new Date().toISOString(),
      };
      next.incomings = incomings.map((row) => ({
        id: row.id,
        month: row.month,
        revenueEur: row.revenueEur ?? 0,
        payoutPct: row.payoutPct ?? 0,
        source: row.source,
      }));
      next.extras = extras.map((row) => ({
        id: row.id,
        date: row.date || null,
        month: row.date ? row.date.slice(0, 7) : null,
        label: row.label,
        amountEur: row.amountEur ?? 0,
      }));
      next.dividends = dividends.map((row) => ({
        id: row.id,
        month: row.month,
        date: `${row.month}-28`,
        label: row.label,
        amountEur: row.amountEur ?? 0,
      }));
      const monthlyObject: Record<string, Record<string, number>> = {};
      monthlyActuals.forEach((row) => {
        if (!row.month) return;
        monthlyObject[row.month] = {
          realRevenueEUR: row.realRevenueEUR ?? 0,
          realPayoutRatePct: row.realPayoutRatePct ?? 0,
          realClosingBalanceEUR: row.realClosingBalanceEUR ?? 0,
        };
      });
      next.monthlyActuals = monthlyObject;
      return next;
    }, "v2:inputs:save");
    setDirty(false);
  }

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <Title level={3}>Eingaben (V2 Native)</Title>
        <Paragraph>
          Opening Balance, Monats-Horizont, Umsaetze, Extras, Dividenden und Monats-Istwerte.
        </Paragraph>
        <Space>
          <Button type="primary" onClick={() => { void saveAll(); }} disabled={!dirty} loading={saving}>
            Alle Eingaben speichern
          </Button>
          {dirty ? <Tag color="gold">Ungespeicherte Aenderungen</Tag> : <Tag color="green">Synchron</Tag>}
          {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
        </Space>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <Title level={5}>Basis-Parameter</Title>
        <Space wrap align="start">
          <div>
            <Text>Opening Balance (EUR)</Text>
            <InputNumber
              value={openingBalance}
              onChange={(value) => {
                setOpeningBalance(Number(value || 0));
                setDirty(true);
              }}
              style={{ width: 190 }}
              min={0}
              step={100}
            />
          </div>
          <div>
            <Text>Startmonat</Text>
            <Input
              type="month"
              value={startMonth}
              onChange={(event) => {
                setStartMonth(normalizeMonth(event.target.value, startMonth));
                setDirty(true);
              }}
              style={{ width: 170 }}
            />
          </div>
          <div>
            <Text>Horizont (Monate)</Text>
            <InputNumber
              value={horizonMonths}
              onChange={(value) => {
                setHorizonMonths(Math.max(1, Number(value || 1)));
                setDirty(true);
              }}
              min={1}
              max={48}
              style={{ width: 160 }}
            />
          </div>
        </Space>
      </Card>

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Title level={5} style={{ margin: 0 }}>Umsaetze x Payout</Title>
          <Button
            onClick={() => {
              setIncomings((prev) => [
                ...prev,
                {
                  id: randomId("inc"),
                  month: startMonth || currentMonthKey(),
                  revenueEur: 0,
                  payoutPct: 100,
                  source: "manual",
                },
              ]);
              setDirty(true);
            }}
          >
            Monat
          </Button>
        </Space>
        <div className="v2-stats-table-wrap ui-table-shell ui-scroll-host">
          <table className="v2-stats-table ui-table-standard">
            <thead>
              <tr>
                <th>Monat</th>
                <th>Umsatz EUR</th>
                <th>Payout %</th>
                <th>Payout EUR</th>
                <th>Quelle</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {incomings.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Input
                      type="month"
                      value={row.month}
                      onChange={(event) => {
                        const value = normalizeMonth(event.target.value, row.month);
                        setIncomings((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, month: value } : entry));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td>
                    <InputNumber
                      value={row.revenueEur ?? undefined}
                      min={0}
                      step={100}
                      style={{ width: "100%" }}
                      onChange={(value) => {
                        setIncomings((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, revenueEur: toNumber(value) } : entry));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td>
                    <InputNumber
                      value={row.payoutPct ?? undefined}
                      min={0}
                      max={100}
                      step={0.1}
                      style={{ width: "100%" }}
                      onChange={(value) => {
                        setIncomings((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, payoutPct: toNumber(value) } : entry));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td>{formatNumber(payoutByMonth.get(row.month) || 0, 2)}</td>
                  <td>
                    <Select
                      value={row.source}
                      options={[
                        { value: "manual", label: "Manuell" },
                        { value: "forecast", label: "Forecast" },
                      ]}
                      onChange={(value) => {
                        setIncomings((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, source: value } : entry));
                        setDirty(true);
                      }}
                      style={{ width: 120 }}
                    />
                  </td>
                  <td>
                    <Button
                      danger
                      onClick={() => {
                        setIncomings((prev) => prev.filter((entry) => entry.id !== row.id));
                        setDirty(true);
                      }}
                    >
                      X
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Title level={5} style={{ margin: 0 }}>Extras</Title>
          <Button
            onClick={() => {
              setExtras((prev) => [...prev, {
                id: randomId("extra"),
                date: `${currentMonthKey()}-15`,
                label: "Extra",
                amountEur: 0,
              }]);
              setDirty(true);
            }}
          >
            Extra
          </Button>
        </Space>
        <div className="v2-stats-table-wrap ui-table-shell ui-scroll-host">
          <table className="v2-stats-table ui-table-standard">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Label</th>
                <th>Betrag EUR</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {extras.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Input
                      type="date"
                      value={row.date}
                      onChange={(event) => {
                        setExtras((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, date: event.target.value } : entry));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td>
                    <Input
                      value={row.label}
                      onChange={(event) => {
                        setExtras((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, label: event.target.value } : entry));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td>
                    <InputNumber
                      value={row.amountEur ?? undefined}
                      style={{ width: "100%" }}
                      step={10}
                      onChange={(value) => {
                        setExtras((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, amountEur: toNumber(value) } : entry));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td>
                    <Button
                      danger
                      onClick={() => {
                        setExtras((prev) => prev.filter((entry) => entry.id !== row.id));
                        setDirty(true);
                      }}
                    >
                      X
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Title level={5} style={{ margin: 0 }}>Dividenden</Title>
          <Button
            onClick={() => {
              setDividends((prev) => [...prev, {
                id: randomId("div"),
                month: currentMonthKey(),
                label: "Dividende",
                amountEur: 0,
              }]);
              setDirty(true);
            }}
          >
            Dividende
          </Button>
        </Space>
        <div className="v2-stats-table-wrap ui-table-shell ui-scroll-host">
          <table className="v2-stats-table ui-table-standard">
            <thead>
              <tr>
                <th>Monat</th>
                <th>Label</th>
                <th>Betrag EUR</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dividends.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Input
                      type="month"
                      value={row.month}
                      onChange={(event) => {
                        setDividends((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, month: normalizeMonth(event.target.value, row.month) } : entry));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td>
                    <Input
                      value={row.label}
                      onChange={(event) => {
                        setDividends((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, label: event.target.value } : entry));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td>
                    <InputNumber
                      value={row.amountEur ?? undefined}
                      style={{ width: "100%" }}
                      step={10}
                      onChange={(value) => {
                        setDividends((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, amountEur: toNumber(value) } : entry));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td>
                    <Button
                      danger
                      onClick={() => {
                        setDividends((prev) => prev.filter((entry) => entry.id !== row.id));
                        setDirty(true);
                      }}
                    >
                      X
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Title level={5} style={{ margin: 0 }}>Monats-Istwerte</Title>
          <Button
            onClick={() => {
              setMonthlyActuals((prev) => [
                ...prev,
                {
                  month: currentMonthKey(),
                  realRevenueEUR: 0,
                  realPayoutRatePct: 0,
                  realClosingBalanceEUR: 0,
                },
              ]);
              setDirty(true);
            }}
          >
            Ist-Monat
          </Button>
        </Space>
        <div className="v2-stats-table-wrap ui-table-shell ui-scroll-host">
          <table className="v2-stats-table ui-table-standard">
            <thead>
              <tr>
                <th>Monat</th>
                <th>Realer Umsatz EUR</th>
                <th>Reale Auszahlungsquote %</th>
                <th>Realer Kontostand EUR</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {monthlyActuals.map((row, index) => (
                <tr key={`${row.month}-${index}`}>
                  <td>
                    <Input
                      type="month"
                      value={row.month}
                      onChange={(event) => {
                        const value = normalizeMonth(event.target.value, row.month);
                        setMonthlyActuals((prev) => prev.map((entry, idx) => idx === index ? { ...entry, month: value } : entry));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td>
                    <InputNumber
                      value={row.realRevenueEUR ?? undefined}
                      style={{ width: "100%" }}
                      onChange={(value) => {
                        setMonthlyActuals((prev) => prev.map((entry, idx) => idx === index ? { ...entry, realRevenueEUR: toNumber(value) } : entry));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td>
                    <InputNumber
                      value={row.realPayoutRatePct ?? undefined}
                      style={{ width: "100%" }}
                      onChange={(value) => {
                        setMonthlyActuals((prev) => prev.map((entry, idx) => idx === index ? { ...entry, realPayoutRatePct: toNumber(value) } : entry));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td>
                    <InputNumber
                      value={row.realClosingBalanceEUR ?? undefined}
                      style={{ width: "100%" }}
                      onChange={(value) => {
                        setMonthlyActuals((prev) => prev.map((entry, idx) => idx === index ? { ...entry, realClosingBalanceEUR: toNumber(value) } : entry));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td>
                    <Button
                      danger
                      onClick={() => {
                        setMonthlyActuals((prev) => prev.filter((_, idx) => idx !== index));
                        setDirty(true);
                      }}
                    >
                      X
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
