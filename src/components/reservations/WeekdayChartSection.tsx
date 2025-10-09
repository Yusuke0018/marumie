import dynamic from "next/dynamic";

const Bar = dynamic(() => import("react-chartjs-2").then(mod => mod.Bar), { ssr: false });

type WeekdayBucket = {
  weekday: string;
  total: number;
  初診: number;
  再診: number;
  当日予約: number;
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
                label: '初診',
                data: weekdayData.map(d => d['初診']),
                backgroundColor: '#5DD4C3',
                borderRadius: 4,
              },
              {
                label: '再診',
                data: weekdayData.map(d => d['再診']),
                backgroundColor: '#FFB8C8',
                borderRadius: 4,
              },
              {
                label: '当日予約',
                data: weekdayData.map(d => d['当日予約']),
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
                    return `${context.dataset.label}: ${context.parsed.y.toLocaleString('ja-JP')}`;
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
                ticks: { font: { size: 12 }, color: '#64748B' },
              },
            },
            animation: false,
          }}
        />
      </div>
    </div>
  );
};
