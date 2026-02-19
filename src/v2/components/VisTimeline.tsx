import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Typography } from "antd";
import type { DataGroup, DataItem, TimelineOptions } from "vis-timeline";
import "vis-timeline/styles/vis-timeline-graph2d.min.css";

const { Text } = Typography;

interface VisTimelineLibrary {
  Timeline: new (
    container: HTMLElement,
    items: DataItem[] | DataItem,
    groupsOrOptions?: DataGroup[] | TimelineOptions,
    options?: TimelineOptions,
  ) => { destroy: () => void };
}

export interface VisTimelineItem {
  id: string;
  type?: "box" | "point" | "range" | "background";
  content?: string;
  startMs: number;
  endMs?: number;
  className?: string;
  title?: string;
}

export interface VisTimelineGroup {
  id: string | number;
  content: string;
  className?: string;
}

export interface VisTimelineProps {
  className?: string;
  groups?: VisTimelineGroup[];
  items: VisTimelineItem[];
  visibleStartMs: number;
  visibleEndMs: number;
  height?: number;
  emptyMessage?: string;
}

export function VisTimeline({
  className,
  groups = [],
  items,
  visibleStartMs,
  visibleEndMs,
  height = 180,
  emptyMessage = "Keine Timeline-Daten vorhanden.",
}: VisTimelineProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [timelineLibrary, setTimelineLibrary] = useState<VisTimelineLibrary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    import("vis-timeline")
      .then((module) => {
        if (!active) return;
        setTimelineLibrary(module as unknown as VisTimelineLibrary);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Timeline konnte nicht geladen werden.");
      });
    return () => {
      active = false;
    };
  }, []);

  const normalizedItems = useMemo<DataItem[]>(() => {
    return items.map((item) => ({
      id: item.id,
      type: item.type || (item.endMs != null ? "range" : "box"),
      content: item.content || "",
      start: item.startMs,
      end: item.endMs,
      className: item.className,
      title: item.title,
      selectable: false,
      editable: false,
    }));
  }, [items]);

  const normalizedGroups = useMemo<DataGroup[]>(() => {
    return groups.map((group) => ({
      id: group.id,
      content: group.content,
      className: group.className,
    }));
  }, [groups]);

  const options = useMemo<TimelineOptions>(() => {
    const safeStart = Number.isFinite(visibleStartMs) ? visibleStartMs : Date.now();
    const rawEnd = Number.isFinite(visibleEndMs) ? visibleEndMs : safeStart + (30 * 24 * 60 * 60 * 1000);
    const safeEnd = rawEnd > safeStart ? rawEnd : safeStart + (30 * 24 * 60 * 60 * 1000);
    return {
      stack: true,
      zoomable: false,
      moveable: false,
      selectable: false,
      showCurrentTime: true,
      orientation: { axis: "top", item: "top" },
      margin: { axis: 10, item: 8 },
      start: safeStart,
      end: safeEnd,
      tooltip: {
        followMouse: true,
        overflowMethod: "cap",
      },
    };
  }, [visibleEndMs, visibleStartMs]);

  useEffect(() => {
    if (!timelineLibrary || !containerRef.current || !normalizedItems.length) return;
    const host = containerRef.current;
    host.innerHTML = "";
    const timeline = normalizedGroups.length
      ? new timelineLibrary.Timeline(host, normalizedItems, normalizedGroups, options)
      : new timelineLibrary.Timeline(host, normalizedItems, options);
    return () => {
      timeline.destroy();
    };
  }, [normalizedGroups, normalizedItems, options, timelineLibrary]);

  if (!items.length) {
    return <Alert type="info" showIcon message={emptyMessage} />;
  }

  if (loadError) {
    return <Alert type="warning" showIcon message={`Timeline konnte nicht geladen werden: ${loadError}`} />;
  }

  if (!timelineLibrary) {
    return (
      <div className="v2-vis-timeline-loading">
        <Text type="secondary">Timeline wird geladen...</Text>
      </div>
    );
  }

  return (
    <div className={["v2-vis-timeline", className || ""].filter(Boolean).join(" ")}>
      <div ref={containerRef} style={{ height }} />
    </div>
  );
}

export default VisTimeline;
