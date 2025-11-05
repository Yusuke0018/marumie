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
              <stop offset="5%" stopColor="#34d399" stopOpacity={0.7} />
              <stop offset="95%" stopColor="#6ee7b7" stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" stroke="#d1fae5" vertical={false} />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#64748b", fontSize: 13, fontWeight: 500 }}
            tickFormatter={(value) => `${value}日`}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#64748b", fontSize: 13, fontWeight: 500 }}
            tickFormatter={(value) => `${Math.round(value / 1000)}千円`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "white",
              border: "1px solid #d1fae5",
              borderRadius: "12px",
              boxShadow: "0 10px 15px -3px rgba(16,185,129,0.1)",
            }}
            formatter={(value: number) => [formatCurrency(value), "売上"]}
            labelFormatter={(day: number) => `${day}日`}
          />
          <Area
            type="monotone"
            dataKey="totalRevenue"
            stroke="#10b981"
            strokeWidth={3}
            fillOpacity={1}
            fill="url(#daily-sales)"
            activeDot={{ r: 7, fill: "#10b981", stroke: "#047857", strokeWidth: 2 }}
          />
          {highlightDay && highestPoint && highlightDay === highestPoint.day && (
            <ReferenceDot
              x={highestPoint.day}
              y={highestPoint.totalRevenue}
              r={9}
              fill="#f59e0b"
              stroke="#fbbf24"
              strokeWidth={3}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
