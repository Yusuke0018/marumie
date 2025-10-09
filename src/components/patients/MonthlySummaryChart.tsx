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
      ChartJS.BarElement,
      ChartJS.LineElement,
      ChartJS.PointElement,
      ChartJS.Tooltip,
      ChartJS.Legend,
      ChartJS.Title,
    );
  });
}

type MonthlySummaryChartProps = {
  stat: KarteMonthlyStat;
};

export const MonthlySummaryChart = ({ stat }: MonthlySummaryChartProps) => {
  const chartData = useMemo(() => {
    return {
      labels: ["総患者", "純初診", "再初診", "再診"],
      datasets: [
        {
          label: "患者数",
          data: [
            stat.totalPatients,
            stat.pureFirstVisits,
            stat.returningFirstVisits,
            stat.revisitCount,
          ],
          backgroundColor: ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6"],
          borderRadius: 6,
        },
      ],
    };
  }, [stat]);

  return (
    <div className="h-[300px]">
      <Chart
        type="bar"
        data={chartData}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false,
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  return `${context.label}: ${context.parsed.y.toLocaleString("ja-JP")}人`;
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
