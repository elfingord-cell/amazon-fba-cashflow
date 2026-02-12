import ReactECharts from "echarts-for-react";

export function PlaceholderChart(): JSX.Element {
  return (
    <ReactECharts
      style={{ height: 220 }}
      option={{
        tooltip: { trigger: "axis" },
        grid: { left: 40, right: 16, top: 24, bottom: 24 },
        xAxis: {
          type: "category",
          data: ["M-5", "M-4", "M-3", "M-2", "M-1", "Aktuell"],
        },
        yAxis: {
          type: "value",
        },
        series: [
          {
            name: "V2 Score",
            type: "line",
            smooth: true,
            areaStyle: {},
            data: [62, 68, 70, 74, 78, 82],
          },
        ],
      }}
    />
  );
}
