"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { LeadtimeSummary } from "@/lib/leadtimeMetrics";
import { LEADTIME_CATEGORIES } from "@/lib/leadtimeMetrics";

const Doughnut = dynamic(
  () => import("react-chartjs-2").then((mod) => mod.Doughnut),
  { ssr: false },
);

if (typeof window !== "undefined") {
  import("chart.js").then((ChartJS) => {
    ChartJS.Chart.register(
      ChartJS.ArcElement,
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

type CategoryBreakdownChartProps = {
  summary: LeadtimeSummary;
};

export const CategoryBreakdownChart = ({
  summary,
}: CategoryBreakdownChartProps) => {
  const chartData = useMemo(() => {
    const labels: string[] = [];
    const values: number[] = [];
    const colors: string[] = [];
    const total = summary.total || 1;

    for (const category of LEADTIME_CATEGORIES) {
      const count = summary.categoryCounts[category] ?? 0;
      if (count === 0) continue;
      const percentage = (count / total) * 100;
      labels.push(`${category} (${percentage.toFixed(1)}%)`);
      values.push(count);
      colors.push(CATEGORY_COLORS[category]);
    }

    return {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: "#ffffff",
          hoverOffset: 8,
        },
      ],
    };
  }, [summary]);

  return (
    <div className="h-80 sm:h-96">
      <Doughnut
        data={chartData}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "right",
              labels: {
                usePointStyle: true,
                font: { size: 12 },
                padding: 16,
              },
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const value = context.raw as number;
                  const percentage =
                    summary.total === 0
                      ? 0
                      : ((value / summary.total) * 100).toFixed(1);
                  return `${context.label}: ${value.toLocaleString(
                    "ja-JP",
                  )}件 (${percentage}%)`;
                },
              },
            },
          },
        }}
      />
    </div>
  );
};
