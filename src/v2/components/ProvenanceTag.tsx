import { Tooltip, Typography } from "antd";

type Entry = { source?: string; asOf?: string | null; by?: string; method?: string } | undefined;
const LABEL: Record<string, string> = {
  vo: "VentoryOne", sellerboard: "Sellerboard", holvi: "Holvi", bwa: "BWA",
  claude: "Claude", human: "manuell", computed: "berechnet",
};

// Kleines Herkunfts-Badge: woher kommt dieser Wert, Stand wann. Rein darstellend (liest state.provenance).
export function ProvenanceTag({ entry }: { entry: Entry }) {
  if (!entry || !entry.source) {
    return <Typography.Text type="secondary" style={{ fontSize: 11 }}>Herkunft unbekannt</Typography.Text>;
  }
  const when = entry.asOf ? new Date(entry.asOf).toLocaleDateString("de-DE") : "—";
  const src = LABEL[entry.source] || entry.source;
  return (
    <Tooltip title={`Quelle: ${src} · Stand ${when} · von ${entry.by || "—"}${entry.method ? ` · ${entry.method}` : ""}`}>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>Herkunft: {src} · {when}</Typography.Text>
    </Tooltip>
  );
}
