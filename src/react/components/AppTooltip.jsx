import { Tooltip } from "antd";

export function AppTooltip({ title, children, placement = "topLeft" }) {
  if (!title) return children;
  return (
    <Tooltip title={title} placement={placement} mouseEnterDelay={0.15}>
      {children}
    </Tooltip>
  );
}
