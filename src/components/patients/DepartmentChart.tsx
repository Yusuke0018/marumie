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
      ChartJS.BarElement,
      ChartJS.Tooltip,
      ChartJS.Legend,
      ChartJS.Title,
    );
  });
}

type DepartmentStat = {
  department: string;
  totalPatients: number;
  pureFirstVisits: number;
  returningFirstVisits: number;
  revisitCount: number;
};

type DepartmentChartProps = {
  stats: DepartmentStat[];
};

export const DepartmentChart = ({ stats }: DepartmentChartProps) => {
  const chartData = useMemo(() => {
    const sortedStats = [...stats].sort((a, b) => b.totalPatients - a.totalPatients).slice(0, 15);
    
    return {
      labels: sortedStats.map((stat) => stat.department),
      datasets: [
        {
          label: "純初診",
          data: sortedStats.map((stat) => stat.pureFirstVisits),
          backgroundColor: "#10b981",
          stack: "stack",
        },
        {
          label: "再初診",
          data: sortedStats.map((stat) => stat.returningFirstVisits),
          backgroundColor: "#f59e0b",
          stack: "stack",
        },
        {
          label: "再診",
          data: sortedStats.map((stat) => stat.revisitCount),
          backgroundColor: "#8b5cf6",
          stack: "stack",
        },
      ],
    };
  }, [stats]);

  return (
    <div className="h-[500px]">
      <Chart
        type="bar"
        data={chartData}
        options={{
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "top",
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  return `${context.dataset.label}: ${context.parsed.x.toLocaleString("ja-JP")}人`;
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              beginAtZero: true,
              ticks: {
                callback: (value) => `${value}人`,
              },
            },
            y: {
              stacked: true,
            },
          },
        }}
      />
    </div>
  );
};
