"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

const WEEKDAY_PASTEL_COLORS: Record<string, string> = {
  月曜: "#BFDBFE",
  火曜: "#BBF7D0",
  水曜: "#FDE68A",
  木曜: "#FBCFE8",
  金曜: "#C4B5FD",
  土曜: "#A5F3FC",
  日曜: "#FCA5A5",
  祝日: "#F5D0FE",
};

const FALLBACK_COLORS = [
  "#BFDBFE",
  "#BBF7D0",
  "#FDE68A",
  "#FBCFE8",
  "#C4B5FD",
  "#A5F3FC",
  "#FCA5A5",
  "#F5D0FE",
];

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
          <Bar dataKey="value" radius={[10, 10, 0, 0]}>
            {data.map((entry, index) => {
              const color =
                WEEKDAY_PASTEL_COLORS[entry.label] ??
                FALLBACK_COLORS[index % FALLBACK_COLORS.length];
              return <Cell key={`${entry.label}-${index}`} fill={color} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
