import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { KarteRecordWithCategory } from "@/lib/karteAnalytics";

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

type DepartmentChartProps = {
  records: KarteRecordWithCategory[];
};

const formatMonthLabel = (month: string): string => {
  const [year, monthNum] = month.split("-");
  return `${year}年${monthNum}月`;
};

export const DepartmentChart = ({ records }: DepartmentChartProps) => {
  const [selectedDepartment, setSelectedDepartment] = useState<string>("");

  const departmentList = useMemo(() => {
    const deptCounts = new Map<string, number>();
    for (const record of records) {
      const dept = record.department?.trim() || "診療科未分類";
      if (dept.includes("自費")) continue;
      deptCounts.set(dept, (deptCounts.get(dept) || 0) + 1);
    }
    return Array.from(deptCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([dept]) => dept);
  }, [records]);

  const chartData = useMemo(() => {
    if (!selectedDepartment) return null;

    const monthlyData = new Map<string, {
      totalPatients: number;
      pureFirst: number;
      returningFirst: number;
      revisit: number;
    }>();

    for (const record of records) {
      const dept = record.department?.trim() || "診療科未分類";
      if (dept !== selectedDepartment) continue;

      const month = record.monthKey;
      if (!monthlyData.has(month)) {
        monthlyData.set(month, {
          totalPatients: 0,
          pureFirst: 0,
          returningFirst: 0,
          revisit: 0,
        });
      }

      const data = monthlyData.get(month)!;
      data.totalPatients += 1;
      
      if (record.category === "pureFirst") {
        data.pureFirst += 1;
      } else if (record.category === "returningFirst") {
        data.returningFirst += 1;
      } else if (record.category === "revisit") {
        data.revisit += 1;
      }
    }

    const sortedMonths = Array.from(monthlyData.keys()).sort();
    
    return {
      labels: sortedMonths.map(formatMonthLabel),
      datasets: [
        {
          label: "総患者",
          data: sortedMonths.map(month => monthlyData.get(month)!.totalPatients),
          borderColor: "#3b82f6",
          backgroundColor: "#3b82f6",
          tension: 0.3,
        },
        {
          label: "純初診",
          data: sortedMonths.map(month => monthlyData.get(month)!.pureFirst),
          borderColor: "#10b981",
          backgroundColor: "#10b981",
          tension: 0.3,
        },
        {
          label: "再初診",
          data: sortedMonths.map(month => monthlyData.get(month)!.returningFirst),
          borderColor: "#f59e0b",
          backgroundColor: "#f59e0b",
          tension: 0.3,
        },
        {
          label: "再診",
          data: sortedMonths.map(month => monthlyData.get(month)!.revisit),
          borderColor: "#8b5cf6",
          backgroundColor: "#8b5cf6",
          tension: 0.3,
        },
      ],
    };
  }, [records, selectedDepartment]);

  if (departmentList.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-sm font-semibold text-slate-700">診療科を選択:</label>
        <select
          value={selectedDepartment}
          onChange={(e) => setSelectedDepartment(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none"
        >
          <option value="">選択してください</option>
          {departmentList.map((dept) => (
            <option key={dept} value={dept}>
              {dept}
            </option>
          ))}
        </select>
      </div>
      
      {chartData && (
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
      )}
    </div>
  );
};
