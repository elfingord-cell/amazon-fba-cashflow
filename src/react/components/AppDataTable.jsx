import { Table } from "antd";
import { AppTooltip } from "./AppTooltip.jsx";

function renderTextWithTooltip(value) {
  if (value == null || value === "") return "—";
  const text = typeof value === "string" || typeof value === "number" ? String(value) : value;
  if (typeof text !== "string") return text;
  return (
    <AppTooltip title={text}>
      <span className="app-table-ellipsis">{text}</span>
    </AppTooltip>
  );
}

function readByDataIndex(record, dataIndex) {
  if (Array.isArray(dataIndex)) {
    return dataIndex.reduce((current, key) => (current == null ? current : current[key]), record);
  }
  if (typeof dataIndex === "string" || typeof dataIndex === "number") {
    return record?.[dataIndex];
  }
  return undefined;
}

function compareSortValues(left, right) {
  const leftNull = left == null || left === "";
  const rightNull = right == null || right === "";
  if (leftNull && rightNull) return 0;
  if (leftNull) return 1;
  if (rightNull) return -1;

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }

  return String(left).localeCompare(String(right), "de-DE", { numeric: true, sensitivity: "base" });
}

export function AppDataTable({
  columns,
  dataSource,
  rowKey = "id",
  stickyFirstColumn = false,
  scrollY,
  className,
  ...rest
}) {
  const mergedColumns = (columns || []).map((col, index) => {
    const next = { ...col };

    if (col.tooltip) {
      const titleNode = col.title ?? col.label ?? "";
      next.title = (
        <AppTooltip title={col.tooltip}>
          <span>{titleNode}</span>
        </AppTooltip>
      );
    }

    if (col.numeric && !next.align) {
      next.align = "right";
    }

    if (stickyFirstColumn && index === 0 && !next.fixed) {
      next.fixed = "left";
    }

    if (next.sorter == null && col.sortable !== false && next.dataIndex != null) {
      next.sorter = (left, right) => compareSortValues(
        readByDataIndex(left, next.dataIndex),
        readByDataIndex(right, next.dataIndex),
      );
    }

    const useEllipsis = col.ellipsis !== false;
    if (useEllipsis) {
      const originalRender = col.render;
      next.ellipsis = { showTitle: false };
      next.render = (value, record, rowIndex) => {
        const rendered = originalRender ? originalRender(value, record, rowIndex) : value;
        return renderTextWithTooltip(rendered);
      };
    }

    return next;
  });

  const scroll = {
    x: "max-content",
    ...(scrollY ? { y: scrollY } : {}),
  };

  return (
    <Table
      className={className}
      size="middle"
      pagination={false}
      sticky
      rowKey={rowKey}
      columns={mergedColumns}
      dataSource={dataSource || []}
      scroll={scroll}
      {...rest}
    />
  );
}
