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
          <CartesianGrid strokeDasharray="4 4" stroke="#E2E8F0" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#475569", fontSize: 12 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#475569", fontSize: 12 }}
            tickFormatter={(value) => `${Math.round(value / 1000)}千円`}
          />
          <Tooltip
            cursor={{ fill: "rgba(56,189,248,0.1)" }}
            formatter={(value: number) => formatCurrency(value)}
            labelFormatter={(label) => `${label}平均`}
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
                <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.95} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.75} />
              </linearGradient>
            </defs>
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
