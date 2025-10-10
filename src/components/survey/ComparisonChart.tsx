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

type SurveyData = {
  month: string;
  googleSearch: number;
  yahooSearch: number;
  googleMap: number;
  signboard: number;
  medicalReferral: number;
  friendReferral: number;
  flyer: number;
  youtube: number;
  libertyCity: number;
  aiSearch: number;
};

type ComparisonChartProps = {
  data: SurveyData[];
  title: string;
  comparisonType: "count" | "percentage";
};

const CHANNEL_LABELS: Record<string, string> = {
  googleSearch: "Google検索",
  yahooSearch: "Yahoo検索",
  googleMap: "Googleマップ",
  signboard: "看板・外観",
  medicalReferral: "医療機関紹介",
  friendReferral: "家族・友人紹介",
  flyer: "チラシ",
  youtube: "YouTube",
  libertyCity: "リベシティ",
  aiSearch: "AI検索",
};

const COLORS: Record<string, string> = {
  googleSearch: "#2A9D8F",
  yahooSearch: "#FF7B7B",
  googleMap: "#5DD4C3",
  signboard: "#E65C5C",
  medicalReferral: "#75DBC3",
  friendReferral: "#FFB8C8",
  flyer: "#3FBFAA",
  youtube: "#FF9999",
  libertyCity: "#A3E7D7",
  aiSearch: "#FFC3CF",
};

const formatMonthLabel = (month: string): string => {
  const [year, monthNum] = month.split("-");
  return `${year}年${monthNum}月`;
};

export const ComparisonChart = ({ data, title, comparisonType }: ComparisonChartProps) => {
  const chartData = useMemo(() => {
    // 月ごとに各チャネルの回答数を集計
    const monthlyMap = new Map<string, Record<string, number>>();

    for (const item of data) {
      if (!monthlyMap.has(item.month)) {
        monthlyMap.set(item.month, {
          googleSearch: 0,
          yahooSearch: 0,
          googleMap: 0,
          signboard: 0,
          medicalReferral: 0,
          friendReferral: 0,
          flyer: 0,
          youtube: 0,
          libertyCity: 0,
          aiSearch: 0,
        });
      }

      const monthData = monthlyMap.get(item.month)!;
      Object.keys(CHANNEL_LABELS).forEach(key => {
        monthData[key] += item[key as keyof SurveyData] as number;
      });
    }

    const sortedMonths = Array.from(monthlyMap.keys()).sort();

    // 前月比の計算
    const comparisonData = sortedMonths.slice(1).map((month, index) => {
      const currentMonth = monthlyMap.get(month)!;
      const previousMonth = monthlyMap.get(sortedMonths[index])!;

      const comparison: Record<string, number> = {};
      Object.keys(CHANNEL_LABELS).forEach(key => {
        if (comparisonType === "count") {
          // 数の変化
          comparison[key] = currentMonth[key] - previousMonth[key];
        } else {
          // %の変化
          if (previousMonth[key] === 0) {
            comparison[key] = currentMonth[key] > 0 ? 100 : 0;
          } else {
            comparison[key] = ((currentMonth[key] - previousMonth[key]) / previousMonth[key]) * 100;
          }
        }
      });

      return comparison;
    });

    // 値が0でないチャネルのみをデータセットに含める
    const activeChannels = Object.keys(CHANNEL_LABELS).filter(key => {
      return comparisonData.some(data => Math.abs(data[key]) > 0.01);
    });

    return {
      labels: sortedMonths.slice(1).map(formatMonthLabel),
      datasets: activeChannels.map(key => ({
        label: CHANNEL_LABELS[key],
        data: comparisonData.map(data => data[key]),
        borderColor: COLORS[key],
        backgroundColor: COLORS[key],
        tension: 0.3,
      })),
    };
  }, [data, comparisonType]);

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
            title: {
              display: true,
              text: title,
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const value = context.parsed.y;
                  if (comparisonType === "count") {
                    return `${context.dataset.label}: ${value > 0 ? '+' : ''}${value.toLocaleString("ja-JP")}件`;
                  } else {
                    return `${context.dataset.label}: ${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
                  }
                },
              },
            },
          },
          scales: {
            y: {
              beginAtZero: false,
              ticks: {
                callback: (value) => {
                  if (comparisonType === "count") {
                    return `${value > 0 ? '+' : ''}${value}件`;
                  } else {
                    return `${value > 0 ? '+' : ''}${value}%`;
                  }
                },
              },
            },
          },
        }}
      />
    </div>
  );
};
