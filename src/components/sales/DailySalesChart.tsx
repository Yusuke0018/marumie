"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
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

export type DailySalesPoint = {
  day: number;
  date: string;
  totalRevenue: number;
  note?: string;
};

type DailySalesChartProps = {
  data: DailySalesPoint[];
  highlightDay?: number | null;
};

export function DailySalesChart({
  data,
  highlightDay,
}: DailySalesChartProps) {
  const highestPoint = data.reduce<DailySalesPoint | null>((acc, item) => {
    if (!acc || item.totalRevenue > acc.totalRevenue) {
      return item;
    }
    return acc;
  }, null);

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <AreaChart
          data={data}
          margin={{ top: 20, right: 30, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient
              id="daily-sales"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" stroke="#E2E8F0" />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#475569", fontSize: 12 }}
            tickFormatter={(value) => `${value}日`}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#475569", fontSize: 12 }}
            tickFormatter={(value) => `${Math.round(value / 1000)}千円`}
          />
          <Tooltip
            formatter={(value: number) => formatCurrency(value)}
            labelFormatter={(day: number) => `${day}日の売上`}
          />
          <Area
            type="monotone"
            dataKey="totalRevenue"
            stroke="#0ea5e9"
            strokeWidth={3}
            fillOpacity={1}
            fill="url(#daily-sales)"
            activeDot={{ r: 7, fill: "#0ea5e9", stroke: "#0369a1", strokeWidth: 2 }}
          />
          {highlightDay && highestPoint && highlightDay === highestPoint.day && (
            <ReferenceDot
              x={highestPoint.day}
              y={highestPoint.totalRevenue}
              r={8}
              fill="#f97316"
              stroke="#fb923c"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
