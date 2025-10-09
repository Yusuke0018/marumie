import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { KarteMonthlyStat } from "@/lib/karteAnalytics";

const Chart = dynamic(() => import("react-chartjs-2").then((mod) => mod.Chart), {
  ssr: false,
});

if (typeof window !== "undefined") {
  import("chart.js").then((ChartJS) => {
    ChartJS.Chart.register(
      ChartJS.CategoryScale,
      ChartJS.LinearScale,
      ChartJS.LineElement,
      ChartJS.PointElement,
      ChartJS.Tooltip,
      ChartJS.Legend,
      ChartJS.Title,
    );
  });
}

type MonthlyTrendChartProps = {
  stats: KarteMonthlyStat[];
};

const formatMonthLabel = (month: string): string => {
  const [year, monthNum] = month.split("-");
  return `${year}年${monthNum}月`;
};

export const MonthlyTrendChart = ({ stats }: MonthlyTrendChartProps) => {
  const chartData = useMemo(() => {
    const sortedStats = [...stats].sort((a, b) => a.month.localeCompare(b.month));
    
    return {
      labels: sortedStats.map((stat) => formatMonthLabel(stat.month)),
      datasets: [
        {
          label: "総患者",
          data: sortedStats.map((stat) => stat.totalPatients),
          borderColor: "#3b82f6",
          backgroundColor: "#3b82f6",
          tension: 0.3,
        },
        {
          label: "純初診",
          data: sortedStats.map((stat) => stat.pureFirstVisits),
          borderColor: "#10b981",
          backgroundColor: "#10b981",
          tension: 0.3,
        },
        {
          label: "再初診",
          data: sortedStats.map((stat) => stat.returningFirstVisits),
          borderColor: "#f59e0b",
          backgroundColor: "#f59e0b",
          tension: 0.3,
        },
        {
          label: "再診",
          data: sortedStats.map((stat) => stat.revisitCount),
          borderColor: "#8b5cf6",
          backgroundColor: "#8b5cf6",
          tension: 0.3,
        },
      ],
    };
  }, [stats]);

  return (
    <div className="h-[400px]">
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
                label: (context) => {
                  return `${context.dataset.label}: ${context.parsed.y.toLocaleString("ja-JP")}人`;
                },
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                callback: (value) => `${value}人`,
              },
            },
          },
        }}
      />
    </div>
  );
};
