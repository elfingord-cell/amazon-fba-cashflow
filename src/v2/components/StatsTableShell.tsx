import type { CSSProperties, ReactNode } from "react";

interface StatsTableShellProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  shellVariant?: "single-frame" | "plain";
  density?: "compact" | "cozy";
}

export function StatsTableShell({
  children,
  className,
  style,
  shellVariant = "single-frame",
  density = "compact",
}: StatsTableShellProps): JSX.Element {
  const baseClassName = className || "v2-stats-table-wrap";
  const wrapperClassName = [
    baseClassName,
    shellVariant === "single-frame" ? "v2-table-shell v2-scroll-host" : "v2-scroll-host",
    density === "cozy" ? "v2-density-cozy" : "v2-density-compact",
  ].filter(Boolean).join(" ");

  return (
    <div className={wrapperClassName} style={style}>
      {children}
    </div>
  );
}
