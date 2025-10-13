"use client";

import { useMemo } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js";
import type { AgeGroup, AgeGroupMonthlyStat } from "@/lib/karteAnalytics";
import { AGE_GROUPS } from "@/lib/karteAnalytics";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

type Props = {
  data: AgeGroupMonthlyStat[];
  title?: string;
};

// 年代ごとの色を定義
const AGE_GROUP_COLORS: Record<AgeGroup, string> = {
  "10代以下": "rgba(147, 197, 253, 0.9)", // sky-300
  "20代": "rgba(134, 239, 172, 0.9)",     // green-300
  "30代": "rgba(253, 224, 71, 0.9)",      // yellow-300
  "40代": "rgba(251, 146, 60, 0.9)",      // orange-300
  "50代": "rgba(248, 113, 113, 0.9)",     // red-300
  "60代": "rgba(216, 180, 254, 0.9)",     // purple-300
  "70代": "rgba(244, 114, 182, 0.9)",     // pink-300
  "80代以上": "rgba(156, 163, 175, 0.9)", // gray-400
  "不明": "rgba(203, 213, 225, 0.6)",     // slate-300
};

const AGE_GROUP_REFERENCE_COLORS: Record<AgeGroup, string> = {
  "10代以下": "rgba(147, 197, 253, 0.28)",
  "20代": "rgba(134, 239, 172, 0.28)",
  "30代": "rgba(253, 224, 71, 0.28)",
  "40代": "rgba(251, 146, 60, 0.28)",
  "50代": "rgba(248, 113, 113, 0.28)",
  "60代": "rgba(216, 180, 254, 0.28)",
  "70代": "rgba(244, 114, 182, 0.28)",
  "80代以上": "rgba(156, 163, 175, 0.28)",
  "不明": "rgba(203, 213, 225, 0.18)",
};

const AGE_GROUP_REFERENCE_BORDER_COLORS: Record<AgeGroup, string> = {
  "10代以下": "rgba(59, 130, 246, 0.65)",
  "20代": "rgba(13, 148, 136, 0.65)",
  "30代": "rgba(202, 138, 4, 0.65)",
  "40代": "rgba(234, 88, 12, 0.65)",
  "50代": "rgba(220, 38, 38, 0.65)",
  "60代": "rgba(147, 51, 234, 0.65)",
  "70代": "rgba(190, 24, 93, 0.65)",
  "80代以上": "rgba(71, 85, 105, 0.65)",
  "不明": "rgba(148, 163, 184, 0.45)",
};

const NISHI_KU_POPULATION_TOTAL = 110_374;

const NISHI_KU_POPULATION_COUNTS: Record<AgeGroup, number> = {
  "10代以下": 15_798,
  "20代": 19_710,
  "30代": 20_147,
  "40代": 19_159,
  "50代": 14_545,
  "60代": 8_255,
  "70代": 7_564,
  "80代以上": 5_196,
  "不明": 0,
};

const NISHI_KU_POPULATION_SHARE: Record<AgeGroup, number> = Object.fromEntries(
  (Object.entries(NISHI_KU_POPULATION_COUNTS) as Array<[AgeGroup, number]>).map(
    ([ageGroup, count]) => [
      ageGroup,
      NISHI_KU_POPULATION_TOTAL > 0
        ? Math.round((count / NISHI_KU_POPULATION_TOTAL) * 1000) / 10
        : 0,
    ],
  ),
) as Record<AgeGroup, number>;

export function AgeGroupStackedChart({ data, title = "年代別構成比" }: Props) {
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

    const patientDatasets = visibleAgeGroups.map((ageGroup) => {
      const dataValues = data.map((stat) => {
        const count = stat.ageGroups[ageGroup] || 0;
        const total = stat.total - (stat.ageGroups["不明"] || 0); // 不明を除く合計
        if (total === 0) return 0;
        return Math.round((count / total) * 100 * 10) / 10; // 小数点第1位まで
      });

      return {
        label: `${ageGroup}（患者）`,
        data: dataValues,
        backgroundColor: AGE_GROUP_COLORS[ageGroup],
        borderWidth: 0,
        stack: "patients",
        barPercentage: 0.52,
        categoryPercentage: 0.7,
        borderRadius: 6,
      };
    });

    const populationDatasets = visibleAgeGroups.map((ageGroup) => {
      const populationShare = NISHI_KU_POPULATION_SHARE[ageGroup] ?? 0;
      const populationValues = labels.map(() => populationShare);
      return {
        label: `${ageGroup}（西区人口）`,
        data: populationValues,
        backgroundColor: AGE_GROUP_REFERENCE_COLORS[ageGroup],
        borderColor: AGE_GROUP_REFERENCE_BORDER_COLORS[ageGroup],
        borderWidth: 1.2,
        stack: "population",
        barPercentage: 0.38,
        categoryPercentage: 0.7,
        borderRadius: 6,
      };
    });

    const datasets = [...patientDatasets, ...populationDatasets];

    return {
      labels,
      datasets,
    };
  }, [data]);

  const options: ChartOptions<"bar"> = useMemo(
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
              return `${label}: ${value}%`;
            },
            footer: (tooltipItems) => {
              const total = tooltipItems.reduce((sum, item) => sum + item.parsed.y, 0);
              return `合計: ${Math.round(total * 10) / 10}%`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
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
          stacked: true,
          beginAtZero: true,
          max: 100,
          grid: {
            color: "rgba(0, 0, 0, 0.05)",
          },
          ticks: {
            font: {
              size: 11,
              family: "'Noto Sans JP', sans-serif",
            },
            callback: (value) => `${value}%`,
          },
        },
      },
    }),
    [title]
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
        <Bar data={chartData} options={options} />
      </div>
      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        淡色のバーは大阪市西区（令和6年9月30日現在）の年代別人口構成比を参考値として表示しています。
      </p>
    </div>
  );
}
