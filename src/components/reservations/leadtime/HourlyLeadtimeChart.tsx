"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { LeadtimeHourStat } from "@/lib/leadtimeMetrics";
import { LEADTIME_CATEGORIES } from "@/lib/leadtimeMetrics";

const Bar = dynamic(() => import("react-chartjs-2").then((mod) => mod.Bar), {
  ssr: false,
});

if (typeof window !== "undefined") {
  import("chart.js").then((ChartJS) => {
    ChartJS.Chart.register(
      ChartJS.CategoryScale,
      ChartJS.LinearScale,
      ChartJS.BarElement,
      ChartJS.LineElement,
      ChartJS.PointElement,
      ChartJS.Tooltip,
      ChartJS.Legend,
      ChartJS.Title,
    );
  });
}

const CATEGORY_COLORS = {
  当日以内: "#16a34a",
  翌日: "#0ea5e9",
  "3日以内": "#6366f1",
  "1週間以内": "#f97316",
  "2週間以内": "#facc15",
  それ以降: "#f43f5e",
} as const;

type HourlyLeadtimeChartProps = {
  hourStats: LeadtimeHourStat[];
};

const toHourLabel = (hour: number) => `${hour.toString().padStart(2, "0")}:00`;

export const HourlyLeadtimeChart = ({
  hourStats,
}: HourlyLeadtimeChartProps) => {
  const prepared = useMemo(() => {
    const filtered = hourStats.filter((item) => item.summary.total > 0);
    if (filtered.length === 0) {
      return null;
    }

    const labels = filtered.map((item) => toHourLabel(item.hour));
    const categoryDatasets = LEADTIME_CATEGORIES.map((category) => ({
      label: category,
      data: filtered.map((item) => {
        const count = item.summary.categoryCounts[category] ?? 0;
        const total = item.summary.total || 1;
        return (count / total) * 100;
      }),
      backgroundColor: CATEGORY_COLORS[category],
      stack: "leadtime",
      borderRadius: 4,
    }));

    const averageDataset = {
      type: "line" as const,
      label: "平均リードタイム（時間）",
      data: filtered.map((item) => item.summary.averageHours ?? 0),
      yAxisID: "y1",
      borderColor: "#1f2937",
      backgroundColor: "#1f2937",
      tension: 0.3,
      fill: false,
      pointRadius: 4,
      pointHoverRadius: 6,
    };

    return {
      labels,
      datasets: [...categoryDatasets, averageDataset],
      raw: filtered,
    };
  }, [hourStats]);

  if (!prepared) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-500">
        集計対象のデータがありません。
      </div>
    );
  }

  return (
    <div className="h-[420px] sm:h-[460px]">
      <Bar
        data={{
          labels: prepared.labels,
          datasets: prepared.datasets,
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: "index",
            intersect: false,
          },
          scales: {
            y: {
              stacked: true,
              min: 0,
              max: 100,
              ticks: {
                stepSize: 20,
                callback: (value) => `${value}%`,
              },
              title: {
                display: true,
                text: "カテゴリ構成比",
              },
              grid: { drawBorder: false },
            },
            y1: {
              position: "right",
              grid: { drawBorder: false, drawOnChartArea: false },
              ticks: {
                callback: (value) => `${value}h`,
              },
              title: {
                display: true,
                text: "平均リードタイム（h）",
              },
            },
            x: {
              stacked: true,
              grid: { display: false },
            },
          },
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                usePointStyle: true,
                padding: 16,
              },
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  if (context.dataset.type === "line") {
                    const value = context.raw as number;
                    return `平均リードタイム: ${value.toFixed(1)}時間`;
                  }
                  const percent = context.parsed.y.toFixed(1);
                  const raw = prepared.raw[context.dataIndex];
                  const category = context.dataset.label ?? "";
                  const count = raw.summary.categoryCounts[category] ?? 0;
                  return `${category}: ${count.toLocaleString(
                    "ja-JP",
                  )}件 (${percent}%)`;
                },
              },
            },
          },
        }}
      />
    </div>
  );
};
