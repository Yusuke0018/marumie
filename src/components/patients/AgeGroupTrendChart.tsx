"use client";

import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from "chart.js";
import type { AgeGroup, AgeGroupMonthlyStat } from "@/lib/karteAnalytics";
import { AGE_GROUPS } from "@/lib/karteAnalytics";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

type Props = {
  data: AgeGroupMonthlyStat[];
  title?: string;
  showPercentage?: boolean;
};

// 年代ごとの色を定義
const AGE_GROUP_COLORS: Record<AgeGroup, string> = {
  "10代以下": "rgba(147, 197, 253, 0.8)", // sky-300
  "20代": "rgba(134, 239, 172, 0.8)",     // green-300
  "30代": "rgba(253, 224, 71, 0.8)",      // yellow-300
  "40代": "rgba(251, 146, 60, 0.8)",      // orange-300
  "50代": "rgba(248, 113, 113, 0.8)",     // red-300
  "60代": "rgba(216, 180, 254, 0.8)",     // purple-300
  "70代": "rgba(244, 114, 182, 0.8)",     // pink-300
  "80代以上": "rgba(156, 163, 175, 0.8)", // gray-400
  "不明": "rgba(203, 213, 225, 0.5)",     // slate-300
};

const AGE_GROUP_BORDER_COLORS: Record<AgeGroup, string> = {
  "10代以下": "rgba(56, 189, 248, 1)",    // sky-400
  "20代": "rgba(74, 222, 128, 1)",        // green-400
  "30代": "rgba(250, 204, 21, 1)",        // yellow-400
  "40代": "rgba(251, 146, 60, 1)",        // orange-400
  "50代": "rgba(239, 68, 68, 1)",         // red-500
  "60代": "rgba(192, 132, 252, 1)",       // purple-400
  "70代": "rgba(236, 72, 153, 1)",        // pink-400
  "80代以上": "rgba(107, 114, 128, 1)",   // gray-500
  "不明": "rgba(148, 163, 184, 1)",       // slate-400
};

export function AgeGroupTrendChart({ data, title = "年代別推移", showPercentage = false }: Props) {
  const chartData = useMemo(() => {
    if (data.length === 0) {
      return {
        labels: [],
        datasets: [],
      };
    }

    const labels = data.map((stat) => {
      const [year, month] = stat.month.split("-");
      return `${year}/${month}`;
    });

    // 不明を除いた年代グループのみ表示
    const visibleAgeGroups = AGE_GROUPS.filter((group) => group !== "不明");

    const datasets = visibleAgeGroups.map((ageGroup) => {
      const dataValues = data.map((stat) => {
        const count = stat.ageGroups[ageGroup] || 0;
        if (showPercentage && stat.total > 0) {
          return Math.round((count / stat.total) * 100);
        }
        return count;
      });

      return {
        label: ageGroup,
        data: dataValues,
        borderColor: AGE_GROUP_BORDER_COLORS[ageGroup],
        backgroundColor: AGE_GROUP_COLORS[ageGroup],
        borderWidth: 2,
        tension: 0.3,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6,
      };
    });

    return {
      labels,
      datasets,
    };
  }, [data, showPercentage]);

  const options: ChartOptions<"line"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index" as const,
        intersect: false,
      },
      plugins: {
        legend: {
          position: "bottom" as const,
          labels: {
            padding: 15,
            font: {
              size: 12,
              family: "'Noto Sans JP', sans-serif",
            },
            usePointStyle: true,
            pointStyle: "circle",
          },
        },
        title: {
          display: true,
          text: title,
          font: {
            size: 16,
            weight: "bold",
            family: "'Noto Sans JP', sans-serif",
          },
          padding: {
            top: 10,
            bottom: 20,
          },
        },
        tooltip: {
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          padding: 12,
          titleFont: {
            size: 13,
            family: "'Noto Sans JP', sans-serif",
          },
          bodyFont: {
            size: 12,
            family: "'Noto Sans JP', sans-serif",
          },
          callbacks: {
            label: (context) => {
              const label = context.dataset.label || "";
              const value = context.parsed.y;
              if (showPercentage) {
                return `${label}: ${value}%`;
              }
              return `${label}: ${value}人`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            font: {
              size: 11,
              family: "'Noto Sans JP', sans-serif",
            },
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: "rgba(0, 0, 0, 0.05)",
          },
          ticks: {
            font: {
              size: 11,
              family: "'Noto Sans JP', sans-serif",
            },
            callback: (value) => {
              if (showPercentage) {
                return `${value}%`;
              }
              return `${value}人`;
            },
          },
        },
      },
    }),
    [title, showPercentage]
  );

  if (data.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-8">
        <p className="text-sm text-slate-500">データがありません</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div style={{ height: "400px" }}>
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
