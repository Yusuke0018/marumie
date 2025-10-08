"use client";

import { useMemo } from "react";

import { ReservationDepartmentGroup, ReservationDepartmentStats } from "@/lib/types";

interface ReservationHeatmapProps {
  stats: ReservationDepartmentStats[];
  focusDepartments: ReservationDepartmentGroup[];
}

function buildHeatmapData(
  stats: ReservationDepartmentStats[],
  focusDepartments: ReservationDepartmentGroup[],
) {
  return stats
    .filter((stat) => focusDepartments.includes(stat.department))
    .map((stat) => ({
      key: `${stat.department}-${stat.type}`,
      label: `${stat.department} / ${stat.type}`,
      hourly: stat.hourly,
      total: stat.total,
      type: stat.type,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, focusDepartments.length * 2);
}

function buildCellColor(value: number, maxValue: number) {
  if (value === 0 || maxValue === 0) {
    return "rgba(37, 99, 235, 0.04)";
  }
  const ratio = Math.min(1, value / maxValue);
  const alpha = 0.1 + ratio * 0.7;
  return `rgba(37, 99, 235, ${alpha.toFixed(2)})`;
}

export function ReservationHeatmap({
  stats,
  focusDepartments,
}: ReservationHeatmapProps) {
  const rows = useMemo(
    () => buildHeatmapData(stats, focusDepartments),
    [stats, focusDepartments],
  );

  const maxValue = useMemo(() => {
    return rows.reduce((max, row) => {
      const rowMax = Math.max(...row.hourly);
      return Math.max(max, rowMax);
    }, 0);
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted/70">
        解析できる予約データがありません。CSVの読み込み状況をご確認ください。
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] table-fixed border-separate border-spacing-y-2">
        <thead>
          <tr className="text-xs uppercase tracking-widest text-muted/60">
            <th className="w-56 rounded-l-xl bg-surface px-3 py-2 text-left">診療科 / 区分</th>
            {Array.from({ length: 24 }, (_, hour) => (
              <th key={hour} className="bg-surface px-1 py-2 text-center">
                {hour}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="text-sm">
              <td className="rounded-l-2xl bg-panel px-3 py-3 font-medium text-muted">
                <div className="flex flex-col">
                  <span>{row.label}</span>
                  <span className="text-xs font-normal text-muted/60">
                    合計 {row.total.toLocaleString()} 件
                  </span>
                </div>
              </td>
              {row.hourly.map((value, hour) => (
                <td
                  key={`${row.key}-${hour}`}
                  className="bg-panel px-1 py-1 text-center text-xs text-muted/80 transition"
                  style={{
                    background: buildCellColor(value, maxValue),
                  }}
                >
                  {value > 0 ? value : ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center gap-3 text-xs text-muted/70">
        <div className="flex items-center gap-1">
          <div className="h-3 w-12 rounded-full bg-[rgba(37,99,235,0.15)]" />
          <span>予約件数が少ない</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-3 w-12 rounded-full bg-[rgba(37,99,235,0.75)]" />
          <span>予約件数が多い</span>
        </div>
      </div>
    </div>
  );
}
