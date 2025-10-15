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

// 診療科名を正規化（空白・記号を除去）
const normalizeDepartment = (value: string): string => {
  const normalized = value.trim().replace(/[\s・●()（）【】\[\]\-]/g, "");

  // 表記ゆれを統一
  if (normalized.includes("内科外来") || normalized.includes("外科外来") || normalized.includes("総合診療")) {
    return "総合診療";
  }
  if (normalized.includes("内視鏡") || normalized.includes("人間ドック")) {
    return "内視鏡";
  }
  if (normalized.includes("発熱") || normalized.includes("風邪")) {
    return "発熱外来";
  }

  // その他はそのまま返す
  return value.trim();
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

    // 曜日×診療科の集計マップ
    const weekdayMap = new Map<number, Map<string, { count: number; days: Set<string> }>>();

    // 初期化（0=月曜日, 1=火曜日, ..., 6=日曜日, 7=祝日）
    for (let i = 0; i <= 7; i++) {
      weekdayMap.set(i, new Map());
    }

    // レコードを集計
    for (const record of records) {
      const departmentRaw = record.department?.trim() || "";
      const dateStr = record.dateIso;

      // 月フィルタ
      const month = dateStr.substring(0, 7);
      if (startMonth && month < startMonth) continue;
      if (endMonth && month > endMonth) continue;

      // 診療科名を正規化
      const department = normalizeDepartment(departmentRaw);
      if (!department) continue;

      const baseWeekday = getIsoWeekday(dateStr);
      if (Number.isNaN(baseWeekday)) continue;

      const isHoliday = isJapaneseHolidayIso(holidays, dateStr) || isNewYearPeriodIso(dateStr);
      const weekdayIndex = isHoliday ? 7 : toNormalizedWeekdayIndex(baseWeekday);

      const dayMap = weekdayMap.get(weekdayIndex)!;
      if (!dayMap.has(department)) {
        dayMap.set(department, { count: 0, days: new Set() });
      }

      const deptData = dayMap.get(department)!;
      deptData.count++;
      deptData.days.add(dateStr);
    }

    // 全診療科を収集してソート
    const allDepartments = new Set<string>();
    for (const dayMap of weekdayMap.values()) {
      for (const dept of dayMap.keys()) {
        allDepartments.add(dept);
      }
    }
    const departmentOrder = Array.from(allDepartments).sort((a, b) => a.localeCompare(b, "ja"));

    // 平均を計算
    const result = [];
    for (let i = 0; i <= 7; i++) {
      const weekdayLabel = WEEKDAY_LABELS[i];
      const dayMap = weekdayMap.get(i)!;

      const entry: Record<string, string | number> = { weekday: weekdayLabel };

      for (const dept of departmentOrder) {
        const deptData = dayMap.get(dept);
        if (deptData) {
          const daysCount = deptData.days.size;
          const average = daysCount > 0 ? Math.round((deptData.count / daysCount) * 10) / 10 : 0;
          entry[dept] = average;
        } else {
          entry[dept] = 0;
        }
      }

      result.push(entry);
    }

    return { data: result, departments: departmentOrder };
  }, [records, startMonth, endMonth]);

  // 診療科ごとの色を動的に割り当て
  const COLOR_PALETTE = [
    "#0f766e", // 総合診療（teal-700）
    "#4338ca", // 内視鏡（indigo-700）
    "#b91c1c", // 発熱外来（red-700）
    "#ea580c", // オレンジ
    "#7c3aed", // パープル
    "#0891b2", // シアン
    "#059669", // グリーン
    "#dc2626", // レッド
    "#9333ea", // バイオレット
  ];

  const departmentColors = useMemo(() => {
    const colors: Record<string, string> = {};
    data.departments.forEach((dept, index) => {
      colors[dept] = COLOR_PALETTE[index % COLOR_PALETTE.length];
    });
    return colors;
  }, [data.departments]);

  const renderLegend: LegendProps["content"] = () => (
    <div className="mt-3 flex flex-wrap justify-center gap-5 text-sm font-semibold text-slate-700">
      {data.departments.map((dept) => (
        <span key={dept} className="inline-flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: departmentColors[dept] }}
          />
          {dept}
        </span>
      ))}
    </div>
  );

  return (
    <div className="h-96">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.data} barCategoryGap={18}>
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
          {data.departments.map((dept) => (
            <Bar
              key={dept}
              dataKey={dept}
              fill={departmentColors[dept]}
              name={dept}
              radius={[10, 10, 6, 6]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
