import { useMemo } from "react";
import dynamic from "next/dynamic";

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

type MonthlyBucket = {
  month: string;
  total: number;
  初診: number;
  再診: number;
  当日予約: number;
};

type MonthlyTrendChartProps = {
  monthlyData: MonthlyBucket[];
};

const formatMonthLabel = (month: string): string => {
  const [year, monthNum] = month.split("-");
  return `${year}年${monthNum}月`;
};

export const MonthlyTrendChart = ({ monthlyData }: MonthlyTrendChartProps) => {
  const chartData = useMemo(() => {
    const sortedData = [...monthlyData].sort((a, b) => a.month.localeCompare(b.month));
    
    return {
      labels: sortedData.map((data) => formatMonthLabel(data.month)),
      datasets: [
        {
          label: "総予約数",
          data: sortedData.map((data) => data.total),
          borderColor: "#3b82f6",
          backgroundColor: "#3b82f6",
          tension: 0.3,
        },
        {
          label: "初診",
          data: sortedData.map((data) => data.初診),
          borderColor: "#10b981",
          backgroundColor: "#10b981",
          tension: 0.3,
        },
        {
          label: "再診",
          data: sortedData.map((data) => data.再診),
          borderColor: "#8b5cf6",
          backgroundColor: "#8b5cf6",
          tension: 0.3,
        },
        {
          label: "当日予約",
          data: sortedData.map((data) => data.当日予約),
          borderColor: "#f59e0b",
          backgroundColor: "#f59e0b",
          tension: 0.3,
        },
      ],
    };
  }, [monthlyData]);

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
                  return `${context.dataset.label}: ${context.parsed.y.toLocaleString("ja-JP")}件`;
                },
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
