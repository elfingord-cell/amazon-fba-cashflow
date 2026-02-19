import type { CSSProperties, ComponentType, HTMLProps, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Alert, Typography } from "antd";
import { MS_PER_DAY, safeTimelineSpanMs } from "./ordersTimelineUtils";

const { Text } = Typography;

interface OrdersTimelineLibrary {
  default: ComponentType<any>;
  TimelineHeaders: ComponentType<any>;
  SidebarHeader: ComponentType<any>;
  DateHeader: ComponentType<any>;
  TimelineMarkers: ComponentType<any>;
  TodayMarker: ComponentType<any>;
}

export interface OrdersGanttGroup {
  id: string;
  title: ReactNode;
  rightTitle?: ReactNode;
  height?: number;
  stackItems?: boolean;
}

export interface OrdersGanttItem {
  id: string;
  group: string;
  title?: ReactNode;
  startMs: number;
  endMs: number;
  minDurationMs?: number;
  className?: string;
  style?: CSSProperties;
  tooltip?: string;
  meta?: Record<string, unknown>;
  itemProps?: HTMLProps<HTMLDivElement>;
  canSelect?: boolean;
}

export interface OrdersGanttTimelineProps {
  className?: string;
  groups: OrdersGanttGroup[];
  items: OrdersGanttItem[];
  visibleStartMs: number;
  visibleEndMs: number;
  sidebarWidth?: number;
  lineHeight?: number;
  itemHeightRatio?: number;
  stackItems?: boolean;
  sidebarHeaderLabel?: ReactNode;
  emptyMessage?: string;
  showTodayMarker?: boolean;
  itemRenderer?: (input: any) => ReactNode;
  onItemSelect?: (itemId: string) => void;
}

function formatMonthHeaderLabel(range: any): string {
  const start = range?.[0];
  if (!start || typeof start.toDate !== "function") return "";
  return start.toDate().toLocaleDateString("de-DE", {
    month: "short",
    year: "numeric",
  });
}

export function OrdersGanttTimeline({
  className,
  groups,
  items,
  visibleStartMs,
  visibleEndMs,
  sidebarWidth = 290,
  lineHeight = 56,
  itemHeightRatio = 0.7,
  stackItems = true,
  sidebarHeaderLabel = "SKU / Orders",
  emptyMessage = "Keine Einträge für den aktuellen Filter.",
  showTodayMarker = true,
  itemRenderer,
  onItemSelect,
}: OrdersGanttTimelineProps): JSX.Element {
  const [timelineLibrary, setTimelineLibrary] = useState<OrdersTimelineLibrary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    import("react-calendar-timeline")
      .then((module) => {
        if (!active) return;
        setTimelineLibrary(module as OrdersTimelineLibrary);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Timeline library konnte nicht geladen werden.");
      });
    return () => {
      active = false;
    };
  }, []);

  const normalizedGroups = useMemo(() => {
    return groups.map((group) => ({
      id: group.id,
      title: group.title,
      rightTitle: group.rightTitle,
      height: group.height,
      stackItems: group.stackItems,
    }));
  }, [groups]);

  const normalizedItems = useMemo(() => {
    const defaultMinimumDurationMs = Math.max(60 * 1000, Math.floor(MS_PER_DAY / 2));
    return items.map((item) => {
      const minimumDurationMs = Math.max(
        60 * 1000,
        Number.isFinite(Number(item.minDurationMs)) ? Number(item.minDurationMs) : defaultMinimumDurationMs,
      );
      const span = safeTimelineSpanMs({
        startMs: Number(item.startMs || 0),
        endMs: Number(item.endMs || 0),
        fallbackMs: minimumDurationMs,
      });
      const itemProps = {
        ...(item.itemProps || {}),
      } as HTMLProps<HTMLDivElement>;
      if (item.tooltip && !itemProps.title) itemProps.title = item.tooltip;
      return {
        id: item.id,
        group: item.group,
        title: item.title,
        start_time: span.startMs,
        end_time: span.endMs,
        className: item.className,
        style: item.style,
        meta: item.meta,
        itemProps,
        canSelect: item.canSelect !== false,
        canMove: false,
        canResize: false,
        canChangeGroup: false,
      };
    });
  }, [items]);

  if (!normalizedGroups.length || !normalizedItems.length) {
    return <Alert type="info" showIcon message={emptyMessage} />;
  }

  if (loadError) {
    return <Alert type="warning" showIcon message={`Timeline konnte nicht geladen werden: ${loadError}`} />;
  }

  if (!timelineLibrary) {
    return (
      <div className="v2-orders-gantt-loading">
        <Text type="secondary">Timeline wird geladen...</Text>
      </div>
    );
  }

  const Timeline = timelineLibrary.default;
  const TimelineHeaders = timelineLibrary.TimelineHeaders;
  const SidebarHeader = timelineLibrary.SidebarHeader;
  const DateHeader = timelineLibrary.DateHeader;
  const TimelineMarkers = timelineLibrary.TimelineMarkers;
  const TodayMarker = timelineLibrary.TodayMarker;

  const visibleSpan = safeTimelineSpanMs({ startMs: visibleStartMs, endMs: visibleEndMs, fallbackMs: 30 * MS_PER_DAY });

  return (
    <div className={["v2-orders-gantt-wrap", className || ""].filter(Boolean).join(" ")}>
      <Timeline
        className="v2-orders-gantt"
        groups={normalizedGroups}
        items={normalizedItems}
        defaultTimeStart={visibleSpan.startMs}
        defaultTimeEnd={visibleSpan.endMs}
        visibleTimeStart={visibleSpan.startMs}
        visibleTimeEnd={visibleSpan.endMs}
        onTimeChange={(_, __, updateScrollCanvas) => {
          updateScrollCanvas(visibleSpan.startMs, visibleSpan.endMs);
        }}
        canMove={false}
        canResize={false}
        canChangeGroup={false}
        canSelect
        stackItems={stackItems}
        lineHeight={lineHeight}
        itemHeightRatio={itemHeightRatio}
        sidebarWidth={sidebarWidth}
        rightSidebarWidth={0}
        minZoom={7 * MS_PER_DAY}
        maxZoom={Math.max(visibleSpan.endMs - visibleSpan.startMs, 7 * MS_PER_DAY)}
        dragSnap={MS_PER_DAY}
        buffer={1}
        itemRenderer={itemRenderer}
        onItemSelect={(itemId) => {
          if (!onItemSelect) return;
          onItemSelect(String(itemId || ""));
        }}
      >
        <TimelineHeaders className="v2-orders-gantt-headers">
          <SidebarHeader>
            {({ getRootProps }: { getRootProps: (propsToOverride?: { style: CSSProperties }) => { style: CSSProperties } }) => {
              const rootProps = getRootProps();
              return (
                <div {...rootProps}>
                  <div className="v2-orders-gantt-sidebar-header">{sidebarHeaderLabel}</div>
                </div>
              );
            }}
          </SidebarHeader>
          <DateHeader unit="primaryHeader" />
          <DateHeader unit="month" labelFormat={formatMonthHeaderLabel} />
        </TimelineHeaders>
        {showTodayMarker ? (
          <TimelineMarkers>
            <TodayMarker>
              {({ styles }: { styles: CSSProperties }) => (
                <div
                  style={{
                    ...styles,
                    width: 2,
                    background: "rgba(220, 38, 38, 0.82)",
                    zIndex: 35,
                  }}
                />
              )}
            </TodayMarker>
          </TimelineMarkers>
        ) : null}
      </Timeline>
    </div>
  );
}

export default OrdersGanttTimeline;
