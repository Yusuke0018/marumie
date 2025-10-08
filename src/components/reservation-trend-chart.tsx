"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  TooltipProps,
  XAxis,
  YAxis,
} from "recharts";

import { ReservationDepartmentGroup } from "@/lib/types";

type TrendRow = Record<string, number | string>;

interface ReservationTrendChartProps {
  data: TrendRow[];
  departments: ReservationDepartmentGroup[];
  colorMap: Record<ReservationDepartmentGroup, string>;
}

function renderLabel(key: string) {
  const [department, type] = key.split("-");
  return `${department} / ${type}`;
}

type TooltipEntry = {
  color?: string;
  dataKey?: string | number;
  value?: number;
};

function CustomTooltipContent(props: TooltipProps<number, string>) {
  const active = (props as TooltipProps<number, string> & { active?: boolean }).active;
  const label = (props as TooltipProps<number, string> & { label?: string }).label ?? "";
  const payloadSource = (props as TooltipProps<number, string> & { payload?: TooltipEntry[] })
    .payload;

  if (!active || !payloadSource || payloadSource.length === 0) return null;

  const entries: TooltipEntry[] = Array.isArray(payloadSource)
    ? (payloadSource as TooltipEntry[])
    : [];

  return (
    <div className="rounded-2xl border border-border bg-panel px-4 py-3 text-sm shadow">
      <p className="text-xs font-medium text-muted/60">{label}</p>
      <ul className="mt-2 space-y-1">
        {entries.map((entry) => {
          if (!entry || typeof entry.value !== "number") return null;
          const isDashed = entry.dataKey?.toString().includes("再診");
          return (
            <li key={entry.dataKey} className="flex items-center gap-2 text-muted">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span>
                {renderLabel(entry.dataKey?.toString() ?? "")}:
                <span className={isDashed ? "ml-1 text-xs text-muted/70" : "ml-1 font-medium"}>
                  {entry.value.toLocaleString()} 件
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ReservationTrendChart({
  data,
  departments,
  colorMap,
}: ReservationTrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted/70">
        表示できる日別データが不足しています。
      </div>
    );
  }

  return (
    <div className="h-[380px] w-full">
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="4 4" stroke="rgba(148, 163, 184, 0.2)" />
          <XAxis dataKey="date" style={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} width={70} style={{ fontSize: 12 }} />
          <Tooltip content={<CustomTooltipContent />} />
          <Legend
            formatter={(value: string) => renderLabel(value)}
            wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
          />
          {departments.map((department) => (
            <Line
              key={`${department}-初診`}
              type="monotone"
              dataKey={`${department}-初診`}
              stroke={colorMap[department]}
              strokeWidth={2.5}
              dot={false}
              connectNulls
              name={`${department}-初診`}
            />
          ))}
          {departments.map((department) => (
            <Line
              key={`${department}-再診`}
              type="monotone"
              dataKey={`${department}-再診`}
              stroke={colorMap[department]}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              opacity={0.7}
              connectNulls
              name={`${department}-再診`}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
