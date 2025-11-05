"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

export type WeekdayAveragePoint = {
  label: string;
  value: number;
};

type WeekdaySalesAverageChartProps = {
  data: WeekdayAveragePoint[];
};

export function WeekdaySalesAverageChart({
  data,
}: WeekdaySalesAverageChartProps) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="#d1fae5" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#64748b", fontSize: 13, fontWeight: 500 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#64748b", fontSize: 13, fontWeight: 500 }}
            tickFormatter={(value) => `${Math.round(value / 1000)}千円`}
          />
          <Tooltip
            cursor={{ fill: "rgba(20,184,166,0.1)" }}
            contentStyle={{
              backgroundColor: "white",
              border: "1px solid #d1fae5",
              borderRadius: "12px",
              boxShadow: "0 10px 15px -3px rgba(16,185,129,0.1)",
            }}
            formatter={(value: number) => [formatCurrency(value), "平均売上"]}
            labelFormatter={(label) => `${label}`}
          />
          <Bar dataKey="value" radius={[10, 10, 0, 0]} fill="url(#weekday-sales)">
            <defs>
              <linearGradient
                id="weekday-sales"
                x1="0%"
                y1="0%"
                x2="0%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#5eead4" stopOpacity={0.95} />
                <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.8} />
              </linearGradient>
            </defs>
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
