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

type WeekdaySalesAverageChartProps = {
  data: WeekdayAveragePoint[];
};

const WEEKDAY_COLORS: Record<string, { gradient: string; stop1: string; stop2: string }> = {
  "月曜": { gradient: "url(#monday)", stop1: "#f472b6", stop2: "#ec4899" },
  "火曜": { gradient: "url(#tuesday)", stop1: "#fb923c", stop2: "#f97316" },
  "水曜": { gradient: "url(#wednesday)", stop1: "#fbbf24", stop2: "#f59e0b" },
  "木曜": { gradient: "url(#thursday)", stop1: "#34d399", stop2: "#10b981" },
  "金曜": { gradient: "url(#friday)", stop1: "#60a5fa", stop2: "#3b82f6" },
  "土曜": { gradient: "url(#saturday)", stop1: "#818cf8", stop2: "#6366f1" },
  "日曜": { gradient: "url(#sunday)", stop1: "#f87171", stop2: "#ef4444" },
  "祝日": { gradient: "url(#holiday)", stop1: "#a78bfa", stop2: "#8b5cf6" },
};

export function WeekdaySalesAverageChart({
  data,
}: WeekdaySalesAverageChartProps) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="monday" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#f472b6" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#ec4899" stopOpacity={0.8} />
            </linearGradient>
            <linearGradient id="tuesday" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fb923c" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#f97316" stopOpacity={0.8} />
            </linearGradient>
            <linearGradient id="wednesday" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.8} />
            </linearGradient>
            <linearGradient id="thursday" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0.8} />
            </linearGradient>
            <linearGradient id="friday" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.8} />
            </linearGradient>
            <linearGradient id="saturday" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#818cf8" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0.8} />
            </linearGradient>
            <linearGradient id="sunday" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#f87171" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.8} />
            </linearGradient>
            <linearGradient id="holiday" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.8} />
            </linearGradient>
          </defs>
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
          <Bar dataKey="value" radius={[10, 10, 0, 0]}>
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={WEEKDAY_COLORS[entry.label]?.gradient || "url(#thursday)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
