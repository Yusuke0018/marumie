"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { LeadtimeDepartmentStat } from "@/lib/leadtimeMetrics";
import { getTopCategory } from "@/lib/leadtimeMetrics";

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

type DepartmentLeadtimeChartProps = {
  departmentStats: LeadtimeDepartmentStat[];
  limit?: number;
};

export const DepartmentLeadtimeChart = ({
  departmentStats,
  limit = 12,
}: DepartmentLeadtimeChartProps) => {
  const prepared = useMemo(() => {
    if (departmentStats.length === 0) {
      return null;
    }

    const ranked = [...departmentStats]
      .filter((item) => item.summary.total > 0)
      .sort(
        (a, b) => (b.summary.averageHours ?? 0) - (a.summary.averageHours ?? 0),
      )
      .slice(0, limit);

    if (ranked.length === 0) {
      return null;
    }

    const labels = ranked.map((item) => item.department);
    const averages = ranked.map((item) => item.summary.averageHours ?? 0);
    const sameDayRates = ranked.map((item) => item.summary.sameDayRate * 100);
    const topCategories = ranked.map((item) =>
      getTopCategory(item.summary.categoryCounts),
    );

    return {
      labels,
      averages,
      sameDayRates,
      topCategories,
      totals: ranked.map((item) => item.summary.total),
    };
  }, [departmentStats, limit]);

  if (!prepared) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-500">
        集計対象のデータがありません。
      </div>
    );
  }

  return (
    <div className="h-[480px] sm:h-[540px]">
      <Bar
        data={{
          labels: prepared.labels,
          datasets: [
            {
              label: "平均リードタイム（時間）",
              data: prepared.averages,
              backgroundColor: "#38bdf8",
              borderRadius: 6,
              barThickness: 20,
              order: 1,
            },
            {
              type: "line" as const,
              label: "当日完了率（%）",
              data: prepared.sameDayRates,
              yAxisID: "x1",
              borderColor: "#10b981",
              backgroundColor: "#10b981",
              tension: 0.3,
              pointRadius: 4,
              pointHoverRadius: 6,
              order: 0,
            },
          ],
        }}
        options={{
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              grid: { display: false },
              ticks: {
                callback: (value, index) => {
                  const department = prepared.labels[index];
                  const category = prepared.topCategories[index] ?? "ー";
                  return `${department}（最多: ${category}）`;
                },
              },
            },
            x: {
              title: {
                display: true,
                text: "平均リードタイム（時間）",
              },
              grid: { drawBorder: false },
            },
            x1: {
              position: "top",
              grid: { drawBorder: false, drawOnChartArea: false },
              ticks: {
                callback: (value) => `${value}%`,
              },
              title: {
                display: true,
                text: "当日完了率（%）",
              },
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
                    const raw = context.raw as number;
                    return `当日完了率: ${raw.toFixed(1)}%`;
                  }
                  const avg = context.raw as number;
                  const total = prepared.totals[context.dataIndex];
                  return `平均リードタイム: ${avg.toFixed(1)}時間（件数: ${total.toLocaleString(
                    "ja-JP",
                  )}）`;
                },
              },
            },
          },
        }}
      />
    </div>
  );
};
