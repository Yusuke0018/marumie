"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";

const Line = dynamic(() => import("react-chartjs-2").then(mod => mod.Line), { ssr: false });

// Chart.js登録
if (typeof window !== "undefined") {
  import("chart.js").then((ChartJS) => {
    ChartJS.Chart.register(
      ChartJS.CategoryScale,
      ChartJS.LinearScale,
      ChartJS.LineElement,
      ChartJS.PointElement,
      ChartJS.Title,
      ChartJS.Tooltip,
      ChartJS.Filler
    );
  });
}

type DailyBucket = {
  date: string;
  total: number;
};

type DailyChartSectionProps = {
  dailyData: DailyBucket[];
};

export const DailyChartSection = ({ dailyData }: DailyChartSectionProps) => {
  return (
    <div className="-mx-2 h-[240px] sm:mx-0 sm:h-72">
      <Line
        data={{
          labels: dailyData.map(d => d.date),
          datasets: [
            {
              label: '総数',
              data: dailyData.map(d => d.total),
              borderColor: '#5DD4C3',
              backgroundColor: 'rgba(93, 212, 195, 0.1)',
              borderWidth: 2,
              fill: true,
              pointRadius: 0,
              tension: 0.4,
            },
          ],
        }}
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
                  return `${context.dataset.label}: ${context.parsed.y.toLocaleString('ja-JP')}`;
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { size: 11 }, color: '#64748B' },
            },
            y: {
              grid: { color: 'rgba(148, 163, 184, 0.2)' },
              ticks: { font: { size: 11 }, color: '#64748B' },
            },
          },
          animation: false,
        }}
      />
    </div>
  );
};
