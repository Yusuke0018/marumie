import { useMemo } from "react";
import Holidays from "date-holidays";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  type LegendProps,
} from "recharts";
import type { KarteRecordWithCategory } from "@/lib/karteAnalytics";

type WeekdayAverageChartProps = {
  records: KarteRecordWithCategory[];
  startMonth: string;
  endMonth: string;
};

const sanitizeDepartment = (value: string) =>
  value.replace(/[\s・●()（）【】\[\]\-]/g, "");

const DEPARTMENT_GROUPS = {
  総合診療: ["内科・外科外来（大岩医師）", "内科・外科外来"],
  内視鏡: ["内視鏡", "内視鏡（保険）", "内視鏡（自費）", "人間ドックA", "人間ドックB"],
  発熱外来: ["発熱外来", "発熱・風邪症状外来", "風邪症状外来"],
} as const;

type DepartmentGroup = keyof typeof DEPARTMENT_GROUPS;

const DEPARTMENT_ORDER: DepartmentGroup[] = ["総合診療", "内視鏡", "発熱外来"];

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日", "祝日"];

const getIsoWeekday = (isoDate: string): number => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

const toNormalizedWeekdayIndex = (weekday: number): number => ((weekday + 6) % 7);

const isNewYearPeriodIso = (isoDate: string): boolean => {
  const [, monthStr, dayStr] = isoDate.split("-");
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (Number.isNaN(month) || Number.isNaN(day)) {
    return false;
  }
  if (month === 12 && day >= 27) {
    return true;
  }
  if (month === 1 && day <= 3) {
    return true;
  }
  return false;
};

export const WeekdayAverageChart = ({ records, startMonth, endMonth }: WeekdayAverageChartProps) => {
  const data = useMemo(() => {
    const holidays = new Holidays("JP");

    // 曜日×診療科グループの集計マップ
    const weekdayMap = new Map<number, Map<DepartmentGroup, { count: number; days: Set<string> }>>();

    // 初期化（0=月曜日, 1=火曜日, ..., 6=日曜日, 7=祝日）
    for (let i = 0; i <= 7; i++) {
      const groupMap = new Map<DepartmentGroup, { count: number; days: Set<string> }>();
      for (const group of DEPARTMENT_ORDER) {
        groupMap.set(group, { count: 0, days: new Set() });
      }
      weekdayMap.set(i, groupMap);
    }

    // レコードを集計
    for (const record of records) {
      const departmentRaw = record.department?.trim() || "";
      const dateStr = record.dateIso;

      // 月フィルタ
      const month = dateStr.substring(0, 7);
      if (startMonth && month < startMonth) continue;
      if (endMonth && month > endMonth) continue;

      // 診療科グループを特定
      const normalizedDepartment = sanitizeDepartment(departmentRaw);
      let matchedGroup: DepartmentGroup | null = null;
      for (const [groupName, departments] of Object.entries(DEPARTMENT_GROUPS)) {
        if (departments.some((candidate) => normalizedDepartment.includes(sanitizeDepartment(candidate)))) {
          matchedGroup = groupName as DepartmentGroup;
          break;
        }
      }

      if (!matchedGroup) continue;

      const baseWeekday = getIsoWeekday(dateStr);
      if (Number.isNaN(baseWeekday)) continue;

      const isHoliday = Boolean(holidays.isHoliday(dateStr)) || isNewYearPeriodIso(dateStr);

      const weekdayIndex = isHoliday ? 7 : toNormalizedWeekdayIndex(baseWeekday);

      const groupData = weekdayMap.get(weekdayIndex)!.get(matchedGroup)!;
      groupData.count++;
      groupData.days.add(dateStr);
    }

    // 平均を計算
    const result = [];
    for (let i = 0; i <= 7; i++) {
      const weekdayLabel = WEEKDAY_LABELS[i];
      const groupMap = weekdayMap.get(i)!;

      const entry: Record<string, string | number> = { weekday: weekdayLabel };

      for (const group of DEPARTMENT_ORDER) {
        const groupData = groupMap.get(group)!;
        const daysCount = groupData.days.size;
        const average = daysCount > 0 ? Math.round((groupData.count / daysCount) * 10) / 10 : 0;
        entry[group] = average;
      }

      result.push(entry);
    }

    return result;
  }, [records, startMonth, endMonth]);

  const COLORS: Record<DepartmentGroup, string> = {
    総合診療: "#047857",
    内視鏡: "#6366f1",
    発熱外来: "#e11d48",
  };

  const seriesOrder = DEPARTMENT_ORDER;

  const renderLegend: LegendProps["content"] = () => (
    <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs font-medium text-slate-600">
      {seriesOrder.map((group) => (
        <span key={group} className="inline-flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: COLORS[group] }}
          />
          {group}
        </span>
      ))}
    </div>
  );

  return (
    <div className="h-96">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
          <XAxis dataKey="weekday" tick={{ fontSize: 12 }} />
          <YAxis
            label={{
              value: "平均患者数（人）",
              angle: -90,
              position: "insideLeft",
              style: { fontSize: 12 },
            }}
            tick={{ fontSize: 12 }}
          />
          <Tooltip
            formatter={(value: number, name: string) => [`${value}人`, name]}
            itemSorter={(item) =>
              seriesOrder.indexOf((item?.name as DepartmentGroup) ?? seriesOrder[0])}
          />
          <Legend verticalAlign="bottom" content={renderLegend} />
          {DEPARTMENT_ORDER.map((group) => (
            <Bar key={group} dataKey={group} fill={COLORS[group]} name={group} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
