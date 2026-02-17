import { useMemo, useState } from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

interface V2ColumnMeta {
  className?: string;
  headerClassName?: string;
  cellClassName?: string;
  width?: number | string;
  minWidth?: number | string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  sortAccessor?: (row: unknown) => unknown;
}

interface TanStackGridProps<T extends object> {
  data: T[];
  columns: ColumnDef<T>[];
  className?: string;
  shellVariant?: "single-frame" | "plain";
  density?: "compact" | "cozy";
  minTableWidth?: number;
  tableLayout?: "fixed" | "auto";
  crosshair?: "none" | "matrix";
  onCellHover?: (rowIndex: number | null, colIndex: number | null) => void;
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
  crosshair = "none",
  onCellHover,
}: TanStackGridProps<T>): JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [hovered, setHovered] = useState<{ rowIndex: number | null; colIndex: number | null }>({
    rowIndex: null,
    colIndex: null,
  });
  const stableColumns = useMemo(() => {
    return columns.map((column) => {
      const next = { ...column } as ColumnDef<T>;
      const meta = columnMeta(next.meta);
      const hasAccessor = "accessorKey" in next || "accessorFn" in next;
      if (!hasAccessor && typeof meta.sortAccessor === "function") {
        (next as { accessorFn?: (row: T) => unknown }).accessorFn = (row: T) => meta.sortAccessor?.(row);
      }
      if (meta.sortable === false) {
        (next as { enableSorting?: boolean }).enableSorting = false;
      }
      return next;
    });
  }, [columns]);
  const crosshairEnabled = crosshair === "matrix";
  const table = useReactTable({
    data,
    columns: stableColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  const baseClassName = className || "v2-stats-table-wrap";
  const wrapperClassName = [
    baseClassName,
    shellVariant === "single-frame" ? "v2-table-shell v2-scroll-host" : "v2-scroll-host",
    density === "cozy" ? "v2-density-cozy" : "v2-density-compact",
  ].filter(Boolean).join(" ");

  function handleCellHover(rowIndex: number | null, colIndex: number | null): void {
    if (!crosshairEnabled) return;
    setHovered({ rowIndex, colIndex });
    if (onCellHover) onCellHover(rowIndex, colIndex);
  }

  return (
    <div
      className={wrapperClassName}
      onMouseLeave={() => handleCellHover(null, null)}
    >
      <table
        className="v2-stats-table"
        data-layout={tableLayout}
        style={{ minWidth: `${Math.max(0, minTableWidth)}px` }}
      >
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header, colIndex) => {
                const meta = columnMeta(header.column.columnDef.meta);
                const isColActive = crosshairEnabled && hovered.colIndex === colIndex;
                return (
                  <th
                    key={header.id}
                    className={[
                      meta.className,
                      meta.headerClassName,
                      isColActive ? "v2-crosshair-col" : "",
                    ].filter(Boolean).join(" ")}
                    style={{
                      width: styleWidth(meta.width),
                      minWidth: styleWidth(meta.minWidth),
                      textAlign: meta.align,
                    }}
                    data-col-index={colIndex}
                    onMouseEnter={() => handleCellHover(null, colIndex)}
                  >
                    {header.isPlaceholder ? null : (
                      header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="v2-sort-header-btn"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                          <span className="v2-sort-header-indicator" aria-hidden="true">
                            {header.column.getIsSorted() === "asc"
                              ? "▲"
                              : header.column.getIsSorted() === "desc"
                                ? "▼"
                                : "↕"}
                          </span>
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row, rowIndex) => (
            <tr
              key={row.id}
              className={crosshairEnabled && hovered.rowIndex === rowIndex ? "v2-crosshair-row" : ""}
            >
              {row.getVisibleCells().map((cell, colIndex) => {
                const meta = columnMeta(cell.column.columnDef.meta);
                const isColActive = crosshairEnabled && hovered.colIndex === colIndex;
                return (
                  <td
                    key={cell.id}
                    className={[
                      meta.className,
                      meta.cellClassName,
                      isColActive ? "v2-crosshair-col" : "",
                    ].filter(Boolean).join(" ")}
                    style={{
                      width: styleWidth(meta.width),
                      minWidth: styleWidth(meta.minWidth),
                      textAlign: meta.align,
                    }}
                    data-row-index={rowIndex}
                    data-col-index={colIndex}
                    onMouseEnter={() => handleCellHover(rowIndex, colIndex)}
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
