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

// 表示する診療科の定義（この順で表示）
const DEPARTMENT_ORDER = ["総合診療", "発熱外来", "内視鏡"] as const;
type TargetDepartment = (typeof DEPARTMENT_ORDER)[number];

// 診療科名を正規化し、3つの対象診療科のいずれかに分類
const normalizeDepartment = (value: string): TargetDepartment | null => {
  const normalized = value.trim().replace(/[\s・●()（）【】\[\]\-]/g, "");

  // 表記ゆれを統一して3診療科に分類
  if (normalized.includes("内科外来") || normalized.includes("外科外来") || normalized.includes("総合診療")) {
    return "総合診療";
  }
  if (normalized.includes("発熱") || normalized.includes("風邪")) {
    return "発熱外来";
  }
  if (normalized.includes("内視鏡") || normalized.includes("人間ドック")) {
    return "内視鏡";
  }

  // 対象外の診療科はnullを返す
  return null;
};

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日", "祝日"];

const getIsoWeekday = (isoDate: string): number => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

const toNormalizedWeekdayIndex = (weekday: number): number => ((weekday + 6) % 7);

const isJapaneseHolidayIso = (holidays: Holidays, isoDate: string): boolean => {
  const result = holidays.isHoliday(isoDate);
  if (Array.isArray(result)) {
    return result.length > 0;
  }
  return Boolean(result);
};

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

    // 曜日×診療科の集計マップ（3診療科のみ）
    const weekdayMap = new Map<number, Map<TargetDepartment, { count: number; days: Set<string> }>>();

    // 初期化（0=月曜日, 1=火曜日, ..., 6=日曜日, 7=祝日）
    for (let i = 0; i <= 7; i++) {
      const deptMap = new Map<TargetDepartment, { count: number; days: Set<string> }>();
      for (const dept of DEPARTMENT_ORDER) {
        deptMap.set(dept, { count: 0, days: new Set() });
      }
      weekdayMap.set(i, deptMap);
    }

    // レコードを集計
    for (const record of records) {
      const departmentRaw = record.department?.trim() || "";
      const dateStr = record.dateIso;

      // 月フィルタ
      const month = dateStr.substring(0, 7);
      if (startMonth && month < startMonth) continue;
      if (endMonth && month > endMonth) continue;

      // 診療科名を正規化（3診療科のみ）
      const department = normalizeDepartment(departmentRaw);
      if (!department) continue; // 対象外の診療科はスキップ

      const baseWeekday = getIsoWeekday(dateStr);
      if (Number.isNaN(baseWeekday)) continue;

      const isHoliday = isJapaneseHolidayIso(holidays, dateStr) || isNewYearPeriodIso(dateStr);
      const weekdayIndex = isHoliday ? 7 : toNormalizedWeekdayIndex(baseWeekday);

      const deptData = weekdayMap.get(weekdayIndex)!.get(department)!;
      deptData.count++;
      deptData.days.add(dateStr);
    }

    // 平均を計算（固定順: 総合診療→発熱外来→内視鏡）
    const result = [];
    for (let i = 0; i <= 7; i++) {
      const weekdayLabel = WEEKDAY_LABELS[i];
      const deptMap = weekdayMap.get(i)!;

      const entry: Record<string, string | number> = { weekday: weekdayLabel };

      for (const dept of DEPARTMENT_ORDER) {
        const deptData = deptMap.get(dept)!;
        const daysCount = deptData.days.size;
        const average = daysCount > 0 ? Math.round((deptData.count / daysCount) * 10) / 10 : 0;
        entry[dept] = average;
      }

      result.push(entry);
    }

    return result;
  }, [records, startMonth, endMonth]);

  // 診療科ごとの色設定（固定順）
  const DEPARTMENT_COLORS: Record<TargetDepartment, string> = {
    総合診療: "#0f766e", // teal-700
    発熱外来: "#b91c1c", // red-700
    内視鏡: "#4338ca",   // indigo-700
  };

  const renderLegend: LegendProps["content"] = () => (
    <div className="mt-3 flex flex-wrap justify-center gap-5 text-sm font-semibold text-slate-700">
      {DEPARTMENT_ORDER.map((dept) => (
        <span key={dept} className="inline-flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: DEPARTMENT_COLORS[dept] }}
          />
          {dept}
        </span>
      ))}
    </div>
  );

  return (
    <div className="h-96">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barCategoryGap={18}>
          <CartesianGrid strokeDasharray="3 3" stroke="#CBD5F5" />
          <XAxis dataKey="weekday" tick={{ fontSize: 13, fill: "#1f2937", fontWeight: 600 }} />
          <YAxis
            label={{
              value: "平均患者数（人）",
              angle: -90,
              position: "insideLeft",
              style: { fontSize: 13, fill: "#1f2937", fontWeight: 600 },
            }}
            tick={{ fontSize: 13, fill: "#1f2937", fontWeight: 600 }}
          />
          <Tooltip
            formatter={(value: number, name: string) => [`${value}人`, name]}
            contentStyle={{
              borderRadius: 12,
              borderColor: "#cbd5e1",
              backgroundColor: "#ffffff",
              boxShadow: "0 18px 32px rgba(15,23,42,0.12)",
            }}
          />
          <Legend verticalAlign="bottom" content={renderLegend} />
          {DEPARTMENT_ORDER.map((dept) => (
            <Bar
              key={dept}
              dataKey={dept}
              fill={DEPARTMENT_COLORS[dept]}
              name={dept}
              radius={[10, 10, 6, 6]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
