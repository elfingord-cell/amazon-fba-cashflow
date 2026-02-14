import { InputNumber } from "antd";
import type { InputNumberProps } from "antd";

type DeNumberMode = "int" | "decimal" | "percent" | "fx";

interface DeNumberInputProps extends Omit<InputNumberProps<number>, "formatter" | "parser" | "precision" | "step"> {
  mode?: DeNumberMode;
  precision?: number;
  step?: number;
}

function modeDefaults(mode: DeNumberMode): { precision: number; step: number } {
  if (mode === "int") return { precision: 0, step: 1 };
  if (mode === "fx") return { precision: 4, step: 0.0001 };
  if (mode === "percent") return { precision: 2, step: 0.01 };
  return { precision: 2, step: 0.01 };
}

function parseDeInput(input: string | undefined): string {
  if (!input) return "";
  const raw = String(input)
    .replace(/\u00A0/g, "")
    .replace(/\s+/g, "")
    .replace(/€/g, "")
    .replace(/%/g, "");
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");

  let normalized = raw;
  if (hasComma && hasDot) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = raw.replace(",", ".");
  } else if (hasDot) {
    // "40.000" -> 40000, but keep "12.5" as decimal input fallback.
    const dotThousandsPattern = /^-?\d{1,3}(?:\.\d{3})+$/;
    if (dotThousandsPattern.test(raw)) {
      normalized = raw.replace(/\./g, "");
    } else {
      const parts = raw.split(".");
      if (parts.length === 2 && parts[1] && parts[1].length <= 2) {
        normalized = raw;
      } else {
        normalized = raw.replace(/\./g, "");
      }
    }
  }

  const negative = normalized.startsWith("-") ? "-" : "";
  const unsigned = normalized.replace(/-/g, "");
  const firstDot = unsigned.indexOf(".");
  if (firstDot === -1) {
    return `${negative}${unsigned.replace(/[^0-9]/g, "")}`;
  }
  const intPart = unsigned.slice(0, firstDot).replace(/[^0-9]/g, "");
  const fracPart = unsigned.slice(firstDot + 1).replace(/[^0-9]/g, "");
  return `${negative}${intPart}${fracPart ? `.${fracPart}` : ""}`;
}

function formatNumber(value: number, digits: number): string {
  return value.toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function DeNumberInput({
  mode = "decimal",
  precision,
  step,
  style,
  ...rest
}: DeNumberInputProps): JSX.Element {
  const defaults = modeDefaults(mode);
  const effectivePrecision = typeof precision === "number" ? precision : defaults.precision;
  const effectiveStep = typeof step === "number" ? step : defaults.step;

  return (
    <InputNumber
      {...rest}
      style={{ width: "100%", ...(style || {}) }}
      precision={effectivePrecision}
      step={effectiveStep}
      decimalSeparator=","
      parser={(raw) => parseDeInput(raw)}
      formatter={(value, info) => {
        if (value === null || value === undefined || value === "") return "";
        const raw = String(value);
        const parsed = Number(raw.replace(",", "."));
        if (!Number.isFinite(parsed)) return raw;
        if (info?.userTyping) return String(info.input || "").replace(".", ",");
        return formatNumber(parsed, effectivePrecision);
      }}
    />
  );
}

export type { DeNumberMode, DeNumberInputProps };
