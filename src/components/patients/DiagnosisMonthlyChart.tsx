import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { DiagnosisDepartment, DiagnosisMonthlySummary } from "@/lib/diagnosisData";
import { DIAGNOSIS_TARGET_DEPARTMENTS } from "@/lib/diagnosisData";

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

const COLORS: Record<DiagnosisDepartment, string> = {
  総合診療: "#2563eb",
  発熱外来: "#f97316",
  "オンライン診療（保険）": "#10b981",
  "オンライン診療（自費）": "#0ea5e9",
  "外国人自費": "#f43f5e",
};

const formatMonthLabel = (month: string): string => {
  const [year, monthStr] = month.split("-");
  const monthNum = Number(monthStr);
  if (!year || Number.isNaN(monthNum)) {
    return month;
  }
  return `${year}年${monthNum}月`;
};

type DiagnosisMonthlyChartProps = {
  summaries: DiagnosisMonthlySummary[];
};

export const DiagnosisMonthlyChart = ({ summaries }: DiagnosisMonthlyChartProps) => {
  const chartData = useMemo(() => {
    const sorted = [...summaries].sort((a, b) => a.month.localeCompare(b.month));

    return {
      labels: sorted.map((item) => formatMonthLabel(item.month)),
      datasets: DIAGNOSIS_TARGET_DEPARTMENTS.map((department) => ({
        label: department,
        data: sorted.map((item) => item.totals[department] ?? 0),
        borderColor: COLORS[department],
        backgroundColor: COLORS[department],
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
