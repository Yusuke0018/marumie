"use client";

import dynamic from "next/dynamic";

const Bar = dynamic(() => import("react-chartjs-2").then(mod => mod.Bar), { ssr: false });

// Chart.js登録
if (typeof window !== "undefined") {
  import("chart.js").then((ChartJS) => {
    ChartJS.Chart.register(
      ChartJS.CategoryScale,
      ChartJS.LinearScale,
      ChartJS.BarElement,
      ChartJS.Title,
      ChartJS.Tooltip,
      ChartJS.Legend
    );
  });
}

type WeekdayBucket = {
  weekday: string;
  total: number;
  初診: number;
  再診: number;
  当日予約: number;
  avgPerDay: number;
  dayCount: number;
};

type WeekdayChartSectionProps = {
  weekdayData: WeekdayBucket[];
};

export const WeekdayChartSection = ({ weekdayData }: WeekdayChartSectionProps) => {
  return (
    <div className="-mx-2 sm:mx-0">
      <div className="h-[280px] sm:h-[340px] md:h-[380px]">
        <Bar
          data={{
            labels: weekdayData.map(d => d.weekday),
            datasets: [
              {
                label: '初診（1日平均）',
                data: weekdayData.map(d => d.dayCount > 0 ? d['初診'] / d.dayCount : 0),
                backgroundColor: '#5DD4C3',
                borderRadius: 4,
              },
              {
                label: '再診（1日平均）',
                data: weekdayData.map(d => d.dayCount > 0 ? d['再診'] / d.dayCount : 0),
                backgroundColor: '#FFB8C8',
                borderRadius: 4,
              },
              {
                label: '当日予約（1日平均）',
                data: weekdayData.map(d => d.dayCount > 0 ? d['当日予約'] / d.dayCount : 0),
                backgroundColor: '#FFA500',
                borderRadius: 4,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'top' as const,
                labels: {
                  font: { size: 12 },
                  usePointStyle: true,
                  padding: 10,
                },
              },
              tooltip: {
                callbacks: {
                  label: (context) => {
                    const value = context.parsed.y;
                    return `${context.dataset.label}: ${value.toFixed(1)}`;
                  },
                  afterLabel: (context) => {
                    const index = context.dataIndex;
                    const bucket = weekdayData[index];
                    return `(${bucket.dayCount}日分のデータ)`;
                  },
                },
              },
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: { font: { size: 12 }, color: '#64748B' },
              },
              y: {
                grid: { color: 'rgba(148, 163, 184, 0.2)' },
                ticks: {
                  font: { size: 12 },
                  color: '#64748B',
                  callback: (value) => {
                    if (typeof value === 'number') {
                      return value.toFixed(1);
                    }
                    return value;
                  },
                },
              },
            },
            animation: false,
          }}
        />
      </div>
    </div>
  );
};
