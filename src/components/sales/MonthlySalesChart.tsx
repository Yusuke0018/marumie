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

export type MonthlySalesPoint = {
  id: string;
  label: string;
  totalRevenue: number;
};

type MonthlySalesChartProps = {
  data: MonthlySalesPoint[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
};

export function MonthlySalesChart({
  data,
  selectedId,
  onSelect,
}: MonthlySalesChartProps) {
  return (
    <div className="h-80 w-full">
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
            tickFormatter={(value) => `${Math.round(value / 1_000_000)}M`}
          />
          <Tooltip
            cursor={{ fill: "rgba(16,185,129,0.08)" }}
            contentStyle={{
              backgroundColor: "white",
              border: "1px solid #d1fae5",
              borderRadius: "12px",
              boxShadow: "0 10px 15px -3px rgba(16,185,129,0.1)",
            }}
            formatter={(value: number) => [formatCurrency(value), "売上"]}
            labelFormatter={(label) => `${label}`}
          />
          <Bar
            dataKey="totalRevenue"
            radius={[12, 12, 0, 0]}
            onClick={(entry) => {
              if (!onSelect) return;
              const payload = (entry?.payload ?? {}) as MonthlySalesPoint;
              if (payload.id) {
                onSelect(payload.id);
              }
            }}
          >
            {data.map((entry) => (
              <Cell
                key={entry.id}
                cursor="pointer"
                fill={
                  selectedId === entry.id
                    ? "url(#sales-bar-selected)"
                    : "url(#sales-bar)"
                }
                stroke={
                  selectedId === entry.id ? "rgba(16,185,129,0.6)" : "transparent"
                }
                strokeWidth={selectedId === entry.id ? 3 : 1}
              />
            ))}
          </Bar>
          <defs>
            <linearGradient
              id="sales-bar"
              x1="0%"
              y1="0%"
              x2="0%"
              y2="100%"
            >
              <stop offset="0%" stopColor="#6ee7b7" stopOpacity={0.9} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0.75} />
            </linearGradient>
            <linearGradient
              id="sales-bar-selected"
              x1="0%"
              y1="0%"
              x2="0%"
              y2="100%"
            >
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#059669" stopOpacity={0.9} />
            </linearGradient>
          </defs>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
