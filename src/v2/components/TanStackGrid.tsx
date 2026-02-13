import { useMemo } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

interface V2ColumnMeta {
  className?: string;
  headerClassName?: string;
  cellClassName?: string;
  width?: number | string;
  minWidth?: number | string;
  align?: "left" | "right" | "center";
}

interface TanStackGridProps<T extends object> {
  data: T[];
  columns: ColumnDef<T>[];
  className?: string;
  shellVariant?: "single-frame" | "plain";
  density?: "compact" | "cozy";
  minTableWidth?: number;
  tableLayout?: "fixed" | "auto";
}

function styleWidth(value?: number | string): string | undefined {
  if (value == null) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

function columnMeta(meta: unknown): V2ColumnMeta {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return meta as V2ColumnMeta;
}

export function TanStackGrid<T extends object>({
  data,
  columns,
  className,
  shellVariant = "single-frame",
  density = "compact",
  minTableWidth = 640,
  tableLayout = "fixed",
}: TanStackGridProps<T>): JSX.Element {
  const stableColumns = useMemo(() => columns, [columns]);
  const table = useReactTable({
    data,
    columns: stableColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const baseClassName = className || "v2-stats-table-wrap";
  const wrapperClassName = [
    baseClassName,
    shellVariant === "single-frame" ? "v2-table-shell v2-scroll-host" : "v2-scroll-host",
    density === "cozy" ? "v2-density-cozy" : "v2-density-compact",
  ].filter(Boolean).join(" ");

  return (
    <div className={wrapperClassName}>
      <table
        className="v2-stats-table"
        data-layout={tableLayout}
        style={{ minWidth: `${Math.max(0, minTableWidth)}px` }}
      >
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const meta = columnMeta(header.column.columnDef.meta);
                return (
                  <th
                    key={header.id}
                    className={[meta.className, meta.headerClassName].filter(Boolean).join(" ")}
                    style={{
                      width: styleWidth(meta.width),
                      minWidth: styleWidth(meta.minWidth),
                      textAlign: meta.align,
                    }}
                  >
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => {
                const meta = columnMeta(cell.column.columnDef.meta);
                return (
                  <td
                    key={cell.id}
                    className={[meta.className, meta.cellClassName].filter(Boolean).join(" ")}
                    style={{
                      width: styleWidth(meta.width),
                      minWidth: styleWidth(meta.minWidth),
                      textAlign: meta.align,
                    }}
                  >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
