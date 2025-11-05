import Papa from "papaparse";
import {
  getCompressedItem,
  setCompressedItem,
  clearCompressedItem,
} from "@/lib/storageCompression";

export type SalesDayRecord = {
  day: number;
  date: string;
  medicalRevenue: number;
  selfPayRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
  peopleCount: number | null;
  note?: string | null;
};

export type SalesMonthlyData = {
  id: string;
  year: number;
  month: number;
  label: string;
  totalRevenue: number;
  totalMedicalRevenue: number;
  totalSelfPayRevenue: number;
  totalOtherRevenue: number;
  totalPeopleCount: number | null;
  averageDailyRevenue: number;
  days: SalesDayRecord[];
  uploadedAt: string;
  sourceFileName?: string;
};

export const SALES_STORAGE_KEY = "clinic-analytics/sales-records/v1";
export const SALES_TIMESTAMP_KEY =
  "clinic-analytics/sales-records-last-updated/v1";

const parseCurrency = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value !== "string") {
    return 0;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  const normalized = trimmed
    .replace(/[¥￥,]/g, "")
    .replace(/[^\d.-]/g, "");
  if (normalized.length === 0) {
    return 0;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseInteger = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const normalized = trimmed.replace(/[^\d-]/g, "");
  if (normalized.length === 0) {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const deriveYearMonthFromName = (
  name: string | null | undefined,
): { year: number; month: number } | null => {
  if (!name) {
    return null;
  }
  const normalized = name
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");

  const match = normalized.match(/(20\d{2})[-/](\d{1,2})(?!\d)/);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }
  return { year, month };
};

const toIsoDate = (year: number, month: number, day: number): string => {
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
};

const parseDayNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed === "合計") {
    return null;
  }
  const normalized = trimmed.replace(/[^\d]/g, "");
  if (normalized.length === 0) {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
};

export const parseSalesCsv = (
  csvText: string,
  options?: { fileName?: string },
): SalesMonthlyData => {
  const parsed = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
  });

  const rows = parsed.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("CSVが空です");
  }

  const header = rows[0] ?? [];
  const dataRows = rows.slice(1);

  const medicalIndex = header.findIndex((value) => value.includes("医療収益"));
  const selfPayIndex = header.findIndex((value) => value.includes("自費金額"));
  const otherIndex = header.findIndex((value) => value.includes("その他"));
  const totalIndex = header.findIndex((value) => value.includes("日々の合計"));
  const peopleIndex = header.findIndex((value) => value.includes("人数"));
  const noteIndex = header.findIndex(
    (value, index) => index > 0 && value.trim().length === 0,
  );
  const monthTotalIndex = header.findIndex((value) =>
    value.includes("総収益"),
  );

  const { year, month } =
    deriveYearMonthFromName(options?.fileName ?? null) ?? {
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
    };
  const id = `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}`;
  const label = `${year}年${month}月`;

  const days: SalesDayRecord[] = [];
  let totalRevenue = 0;
  let totalMedicalRevenue = 0;
  let totalSelfPayRevenue = 0;
  let totalOtherRevenue = 0;
  let totalPeople = 0;
  let hasPeople = false;
  let monthlyTotalFromColumn: number | null = null;

  for (const row of dataRows) {
    if (!Array.isArray(row)) {
      continue;
    }
    const dayNumber = parseDayNumber(row[0]);
    if (dayNumber === null) {
      if (typeof row[0] === "string" && row[0].trim() === "合計") {
        if (monthTotalIndex >= 0) {
          const parsedTotal = parseCurrency(row[monthTotalIndex]);
          if (parsedTotal > 0) {
            monthlyTotalFromColumn = parsedTotal;
          }
        }
      }
      continue;
    }
    if (dayNumber < 1 || dayNumber > 31) {
      continue;
    }

    const medicalRevenue =
      medicalIndex >= 0 ? parseCurrency(row[medicalIndex]) : 0;
    const selfPayRevenue =
      selfPayIndex >= 0 ? parseCurrency(row[selfPayIndex]) : 0;
    const otherRevenue =
      otherIndex >= 0 ? parseCurrency(row[otherIndex]) : 0;
    const dailyTotal =
      totalIndex >= 0
        ? parseCurrency(row[totalIndex])
        : medicalRevenue + selfPayRevenue + otherRevenue;
    const peopleCount =
      peopleIndex >= 0 ? parseInteger(row[peopleIndex]) : null;
    if (
      medicalRevenue === 0 &&
      selfPayRevenue === 0 &&
      otherRevenue === 0 &&
      dailyTotal === 0 &&
      peopleCount === null
    ) {
      continue;
    }

    if (peopleCount !== null) {
      totalPeople += peopleCount;
      hasPeople = true;
    }
    const note =
      noteIndex >= 0 && typeof row[noteIndex] === "string"
        ? row[noteIndex]?.trim() ?? ""
        : "";

    totalRevenue += dailyTotal;
    totalMedicalRevenue += medicalRevenue;
    totalSelfPayRevenue += selfPayRevenue;
    totalOtherRevenue += otherRevenue;

    days.push({
      day: dayNumber,
      date: toIsoDate(year, month, dayNumber),
      medicalRevenue,
      selfPayRevenue,
      otherRevenue,
      totalRevenue: dailyTotal,
      peopleCount,
      note: note.length > 0 ? note : undefined,
    });
  }

  days.sort((a, b) => a.day - b.day);

  if (monthlyTotalFromColumn !== null) {
    totalRevenue = monthlyTotalFromColumn;
  }

  const uniqueDayCount = days.length;
  const averageDailyRevenue =
    uniqueDayCount > 0 ? totalRevenue / uniqueDayCount : 0;

  return {
    id,
    year,
    month,
    label,
    totalRevenue,
    totalMedicalRevenue,
    totalSelfPayRevenue,
    totalOtherRevenue,
    totalPeopleCount: hasPeople ? totalPeople : null,
    averageDailyRevenue,
    days,
    uploadedAt: new Date().toISOString(),
    sourceFileName: options?.fileName,
  };
};

export const loadSalesDataFromStorage = (): SalesMonthlyData[] => {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = getCompressedItem(SALES_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as SalesMonthlyData[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => ({
      ...item,
      days: Array.isArray(item.days) ? item.days : [],
    }));
  } catch {
    return [];
  }
};

export const saveSalesDataToStorage = (
  data: SalesMonthlyData[],
): void => {
  if (typeof window === "undefined") {
    return;
  }
  const sorted = [...data].sort((a, b) => a.id.localeCompare(b.id));
  setCompressedItem(SALES_STORAGE_KEY, JSON.stringify(sorted));
  window.localStorage.setItem(
    SALES_TIMESTAMP_KEY,
    new Date().toISOString(),
  );
};

export const clearSalesDataStorage = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  clearCompressedItem(SALES_STORAGE_KEY);
  window.localStorage.removeItem(SALES_TIMESTAMP_KEY);
};

export const upsertSalesMonth = (
  dataset: SalesMonthlyData[],
  nextMonth: SalesMonthlyData,
): SalesMonthlyData[] => {
  const map = new Map(dataset.map((month) => [month.id, month]));
  map.set(nextMonth.id, nextMonth);
  return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
};
