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

type UnitPriceWeekdayChartProps = {
  rows: Array<
    {
      label: string;
      stats: Record<
        string,
        {
          averageAmount: number | null;
        }
      >;
    }
  >;
  groups: Array<{ id: string; label: string }>;
};

const DATASET_COLORS = [
  { border: "#2563EB", background: "rgba(37, 99, 235, 0.65)" }, // blue
  { border: "#DC2626", background: "rgba(220, 38, 38, 0.65)" }, // red
  { border: "#10B981", background: "rgba(16, 185, 129, 0.65)" }, // green
  { border: "#F59E0B", background: "rgba(245, 158, 11, 0.65)" }, // amber
  { border: "#8B5CF6", background: "rgba(139, 92, 246, 0.65)" }, // purple (fallback)
];

export const UnitPriceWeekdayChart = ({ rows, groups }: UnitPriceWeekdayChartProps) => {
  const chartData = useMemo(() => {
    const labels = rows.map((row) => row.label);

    const datasets = groups.map((group, index) => {
      const { border, background } = DATASET_COLORS[index] ?? DATASET_COLORS[DATASET_COLORS.length - 1];
      return {
        label: group.label,
        data: rows.map((row) => row.stats[group.id]?.averageAmount ?? 0),
        backgroundColor: background,
        borderColor: border,
        borderWidth: 1.5,
        borderRadius: 6,
        maxBarThickness: 48,
      };
    });

    return { labels, datasets };
  }, [rows, groups]);

  return (
    <div className="h-[360px]">
      <Chart
        type="bar"
        data={chartData}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                usePointStyle: true,
              },
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const value = context.parsed.y ?? 0;
                  const formatted = `¥${Number(value).toLocaleString("ja-JP")}`;
                  return `${context.dataset.label}: ${formatted}`;
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
                  size: 12,
                },
              },
            },
            y: {
              beginAtZero: true,
              grid: {
                color: "rgba(148, 163, 184, 0.2)",
              },
              ticks: {
                callback: (value) => `¥${Number(value).toLocaleString("ja-JP")}`,
                font: {
                  size: 12,
                },
              },
            },
          },
        }}
      />
    </div>
  );
};

export default UnitPriceWeekdayChart;
