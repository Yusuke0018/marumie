import Papa from "papaparse";

import {
  ParseError,
  ParseResult,
  ParseWarning,
  ReservationDepartmentGroup,
  ReservationDepartmentStats,
  ReservationRecord,
} from "@/lib/types";
import { parseJstDate, isOnOrAfterStart, toDateKey, toMonthKey } from "@/lib/date";
import { parseNumber } from "@/lib/number";

interface ReservationHeaderIndices {
  dateTime: number;
  department: number;
  departmentCode?: number;
  type: number;
  countIndices: number[];
  sameDay?: number;
}

const COUNT_CANDIDATES = ["件数", "予約数", "当日数値", "集計数"];

const departmentGroups: Array<{
  group: ReservationDepartmentGroup;
  keywords: string[];
}> = [
  { group: "内科外科外来", keywords: ["内科外科外来", "内科・外科外来"] },
  { group: "内科外来", keywords: ["内科外来"] },
  { group: "発熱外来", keywords: ["発熱外来", "発熱", "風邪症状"] },
  { group: "胃カメラ", keywords: ["胃カメラ", "胃内視鏡"] },
  { group: "大腸カメラ", keywords: ["大腸カメラ", "大腸内視鏡"] },
  { group: "内視鏡ドック", keywords: ["内視鏡ドック"] },
  { group: "人間ドックA", keywords: ["人間ドックA", "人間ドック（A"] },
  { group: "人間ドックB", keywords: ["人間ドックB", "人間ドック（B"] },
  { group: "オンライン診療", keywords: ["オンライン診療"] },
];

function resolveHeaders(headers: string[]): ReservationHeaderIndices | null {
  const normalize = (value: string) => value.trim();

  const dateTime = headers.findIndex((header) => normalize(header) === "予約日時");
  const department = headers.findIndex((header) =>
    ["診療科", "診療科コード"].includes(normalize(header))
  );
  const type = headers.findIndex((header) =>
    ["初診/再診", "初再診", "初再診区分"].includes(normalize(header))
  );

  if (dateTime === -1 || department === -1 || type === -1) {
    return null;
  }

  const departmentCode = headers.findIndex(
    (header) => normalize(header) === "診療科コード"
  );
  const sameDay = headers.findIndex((header) =>
    ["当日予約", "当日"].includes(normalize(header))
  );

  const countIndices = COUNT_CANDIDATES.map((candidate) =>
    headers.findIndex((header) => normalize(header) === candidate)
  ).filter((idx) => idx !== -1);

  return {
    dateTime,
    department,
    departmentCode: departmentCode !== -1 ? departmentCode : undefined,
    type,
    countIndices,
    sameDay: sameDay !== -1 ? sameDay : undefined,
  };
}

function pickCount(row: string[], indices: number[]): number {
  for (const idx of indices) {
    const parsed = parseNumber(row[idx]);
    if (parsed !== null && !Number.isNaN(parsed)) {
      return Math.max(1, Math.round(parsed));
    }
  }
  return 1;
}

function resolveDepartmentGroup(raw: string): ReservationDepartmentGroup {
  if (!raw) {
    return "その他";
  }
  const normalized = raw.replace(/\s+/g, "").toLowerCase();

  for (const candidate of departmentGroups) {
    for (const keyword of candidate.keywords) {
      if (normalized.includes(keyword.replace(/\s+/g, "").toLowerCase())) {
        return candidate.group;
      }
    }
  }
  return "その他";
}

function resolveType(value: string | undefined): "初診" | "再診" {
  if (!value) return "初診";
  const normalized = value.trim();
  if (normalized.includes("再")) {
    return "再診";
  }
  return "初診";
}

export function parseReservations(csvText: string): ParseResult<ReservationRecord> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const data: ReservationRecord[] = [];

  const parsed = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    errors.push({
      row: 0,
      message: `予約CSVの解析に失敗しました: ${parsed.errors
        .map((item) => item.message)
        .join(", ")}`,
    });
    return { data: [], errors, warnings };
  }

  const rows = parsed.data;
  if (rows.length === 0) {
    errors.push({ row: 0, message: "予約CSVにデータがありません" });
    return { data: [], errors, warnings };
  }

  const headers = rows[0].map((header) => header.trim());
  const headerIndices = resolveHeaders(headers);

  if (!headerIndices) {
    errors.push({
      row: 0,
      message: "予約CSVの必須列(予約日時, 診療科, 初診/再診)が見つかりません。",
    });
    return { data: [], errors, warnings };
  }

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const rowNumber = i + 1;
    const dateStr = row[headerIndices.dateTime];
    const dateTime = parseJstDate(dateStr);
    if (!dateTime) {
      warnings.push({
        row: rowNumber,
        field: "予約日時",
        message: `予約日時を解釈できませんでした: "${dateStr}"`,
      });
      continue;
    }

    if (!isOnOrAfterStart(dateTime)) {
      continue;
    }

    const departmentRaw = row[headerIndices.department] ?? "";
    const departmentGroup = resolveDepartmentGroup(departmentRaw);
    const type = resolveType(row[headerIndices.type]);
    const count = pickCount(row, headerIndices.countIndices);
    const sameDay =
      headerIndices.sameDay !== undefined
        ? (row[headerIndices.sameDay] ?? "").trim().toLowerCase() === "true"
        : false;

    data.push({
      dateTime,
      department: departmentRaw,
      departmentGroup,
      type,
      count,
      isSameDay: sameDay,
    });
  }

  return { data, errors, warnings };
}

export function filterReservationsByMonth(
  reservations: ReservationRecord[],
  month: string | null
): ReservationRecord[] {
  if (!month) return reservations;
  return reservations.filter((record) => toMonthKey(record.dateTime) === month);
}

export function computeDepartmentStats(
  reservations: ReservationRecord[]
): ReservationDepartmentStats[] {
  const stats = new Map<string, ReservationDepartmentStats>();

  reservations.forEach((record) => {
    const key = `${record.departmentGroup}-${record.type}`;
    if (!stats.has(key)) {
      stats.set(key, {
        department: record.departmentGroup,
        type: record.type,
        total: 0,
        hourly: Array.from({ length: 24 }, () => 0),
        daily: {},
      });
    }

    const target = stats.get(key)!;
    target.total += record.count;
    const hour = record.dateTime.getHours();
    target.hourly[hour] = (target.hourly[hour] ?? 0) + record.count;
    const dateKey = toDateKey(record.dateTime);
    target.daily[dateKey] = (target.daily[dateKey] ?? 0) + record.count;
  });

  return Array.from(stats.values()).sort((a, b) => b.total - a.total);
}

export function extractTopDepartments(
  stats: ReservationDepartmentStats[],
  limit = 6
): ReservationDepartmentGroup[] {
  const totals = new Map<ReservationDepartmentGroup, number>();

  stats.forEach((item) => {
    totals.set(item.department, (totals.get(item.department) ?? 0) + item.total);
  });

  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([department]) => department);
}

export function buildTrendDataset(
  stats: ReservationDepartmentStats[],
  departments: ReservationDepartmentGroup[]
) {
  const dateSet = new Set<string>();

  stats.forEach((stat) => {
    Object.keys(stat.daily).forEach((date) => dateSet.add(date));
  });

  const sortedDates = Array.from(dateSet).sort();

  return sortedDates.map((date) => {
    const row: Record<string, number | string> = { date };

    departments.forEach((department) => {
      row[`${department}-初診`] = 0;
      row[`${department}-再診`] = 0;
    });

    stats.forEach((stat) => {
      const key = `${stat.department}-${stat.type}`;
      const value = stat.daily[date] ?? 0;
      if (departments.includes(stat.department)) {
        row[key] = value;
      }
    });

    row.total = stats
      .filter((stat) => stat.type === "初診")
      .reduce((acc, stat) => acc + (stat.daily[date] ?? 0), 0);

    return row;
  });
}

export function collectDepartmentPalette(
  departments: ReservationDepartmentGroup[]
): Record<ReservationDepartmentGroup, string> {
  const palette = [
    "#2563EB",
    "#10B981",
    "#8B5CF6",
    "#F97316",
    "#F59E0B",
    "#0EA5E9",
    "#F472B6",
  ];

  const result: Record<ReservationDepartmentGroup, string> = {} as Record<
    ReservationDepartmentGroup,
    string
  >;

  departments.forEach((department, index) => {
    result[department] = palette[index % palette.length];
  });

  return result;
}
