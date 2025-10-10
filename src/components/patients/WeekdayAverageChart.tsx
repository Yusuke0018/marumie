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
} from "recharts";
import type { KarteRecordWithCategory } from "@/lib/karteAnalytics";

type WeekdayAverageChartProps = {
  records: KarteRecordWithCategory[];
  startMonth: string;
  endMonth: string;
};

const DEPARTMENT_GROUPS = {
  総合診療: ["総合診療", "総合診療科"],
  内視鏡: ["内視鏡", "内視鏡（保険）", "内視鏡（自費）", "人間ドックA", "人間ドックB"],
  オンライン診療: ["オンライン診療", "オンライン診療（保険）", "オンライン診療（自費）"],
} as const;

type DepartmentGroup = keyof typeof DEPARTMENT_GROUPS;

const DEPARTMENT_ORDER: DepartmentGroup[] = ["総合診療", "内視鏡", "オンライン診療"];

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日", "祝日"];

const isNewYearPeriod = (date: Date): boolean => {
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // 12月27日〜31日
  if (month === 12 && day >= 27) {
    return true;
  }

  // 1月1日〜3日
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
      const department = departmentRaw.replace(/\s+/g, "");
      let matchedGroup: DepartmentGroup | null = null;
      for (const [groupName, departments] of Object.entries(DEPARTMENT_GROUPS)) {
        if (departments.some((candidate) => department.includes(candidate.replace(/\s+/g, "")))) {
          matchedGroup = groupName as DepartmentGroup;
          break;
        }
      }

      if (!matchedGroup) continue;

      // 日付を解析
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) continue;

      // 祝日判定
      const isHoliday = holidays.isHoliday(date) || isNewYearPeriod(date);

      // 曜日インデックス（0=月, 1=火, ..., 6=日, 7=祝日）
      let weekdayIndex: number;
      if (isHoliday) {
        weekdayIndex = 7; // 祝日
      } else {
        const jsDay = date.getDay(); // 0=日, 1=月, ..., 6=土
        weekdayIndex = jsDay === 0 ? 6 : jsDay - 1; // 0=月, 1=火, ..., 6=日
      }

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
    総合診療: "#2563eb",
    内視鏡: "#ec4899",
    オンライン診療: "#14b8a6",
  };

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
          <Tooltip formatter={(value: number, name: string) => [`${value}人`, name]} />
          <Legend
            verticalAlign="bottom"
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value: DepartmentGroup) => value}
          />
          {DEPARTMENT_ORDER.map((group) => (
            <Bar key={group} dataKey={group} fill={COLORS[group]} name={group} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
