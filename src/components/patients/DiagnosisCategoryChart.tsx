import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { DiagnosisCategory, DiagnosisCategoryMonthlySummary } from "@/lib/diagnosisData";
import { DIAGNOSIS_CATEGORIES } from "@/lib/diagnosisData";

const Chart = dynamic(() => import("react-chartjs-2").then((mod) => mod.Chart), {
  ssr: false,
});

if (typeof window !== "undefined") {
  import("chart.js").then((ChartJS) => {
    ChartJS.Chart.register(
      ChartJS.CategoryScale,
      ChartJS.LinearScale,
      ChartJS.PointElement,
      ChartJS.LineElement,
      ChartJS.Legend,
      ChartJS.Tooltip,
      ChartJS.Title,
    );
  });
}

const CATEGORY_COLORS: Record<DiagnosisCategory, string> = {
  生活習慣病: "#059669",
  外科: "#ea580c",
  皮膚科: "#e11d48",
  その他: "#64748b",
};

const formatMonthLabel = (month: string): string => {
  const [year, monthStr] = month.split("-");
  const monthNum = Number(monthStr);
  if (!year || Number.isNaN(monthNum)) {
    return month;
  }
  return `${year}年${monthNum}月`;
};

type DiagnosisCategoryChartProps = {
  summaries: DiagnosisCategoryMonthlySummary[];
};

export const DiagnosisCategoryChart = ({ summaries }: DiagnosisCategoryChartProps) => {
  const chartData = useMemo(() => {
    const sorted = [...summaries].sort((a, b) => a.month.localeCompare(b.month));

    return {
      labels: sorted.map((item) => formatMonthLabel(item.month)),
      datasets: DIAGNOSIS_CATEGORIES.map((category) => ({
        label: category,
        data: sorted.map((item) => item.totals[category] ?? 0),
        borderColor: CATEGORY_COLORS[category],
        backgroundColor: CATEGORY_COLORS[category],
        tension: 0.3,
        fill: false,
      })),
    };
  }, [summaries]);

  return (
    <div className="h-[360px]">
      <Chart
        type="line"
        data={chartData}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "top",
            },
            tooltip: {
              callbacks: {
                label: (context) =>
                  `${context.dataset.label}: ${context.parsed.y.toLocaleString("ja-JP")}件`,
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                callback: (value) => `${value}件`,
              },
            },
          },
        }}
      />
    </div>
  );
};
