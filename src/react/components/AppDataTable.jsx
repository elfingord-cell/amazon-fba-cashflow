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
