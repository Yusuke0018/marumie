import Holidays from "date-holidays";

const hd = new Holidays("JP");

const holidayCache = new Map<string, boolean>();
const weekdayIndexCache = new Map<string, number>();
const weekdayNameCache = new Map<string, string>();
const dayTypeCache = new Map<string, DayType>();

export type DayType =
  | "平日"
  | "土曜"
  | "日曜"
  | "祝日"
  | "祝日前日";

export type PeriodType = "3months" | "6months" | "1year" | "all";

/**
 * 日付が祝日かどうかを判定
 * 注: 国民の祝日（type: public）のみを判定し、銀行休業日や記念日は除外
 */
export const isHoliday = (dateStr: string): boolean => {
  if (holidayCache.has(dateStr)) {
    return holidayCache.get(dateStr)!;
  }
  const date = new Date(dateStr);
  const holidays = hd.isHoliday(date);
  // 国民の祝日のみを判定（銀行休業日や記念日を除外）
  const isHolidayDate = holidays !== false &&
    Array.isArray(holidays) &&
    holidays.some((h) => h.type === "public");
  holidayCache.set(dateStr, isHolidayDate);
  return isHolidayDate;
};

/**
 * 日付が土曜日かどうかを判定
 */
export const isSaturday = (dateStr: string): boolean => {
  if (!weekdayIndexCache.has(dateStr)) {
    weekdayIndexCache.set(dateStr, new Date(dateStr).getDay());
  }
  return weekdayIndexCache.get(dateStr) === 6;
};

/**
 * 日付が日曜日かどうかを判定
 */
export const isSunday = (dateStr: string): boolean => {
  if (!weekdayIndexCache.has(dateStr)) {
    weekdayIndexCache.set(dateStr, new Date(dateStr).getDay());
  }
  return weekdayIndexCache.get(dateStr) === 0;
};

/**
 * 日付が週末（土日）かどうかを判定
 */
export const isWeekend = (dateStr: string): boolean => {
  return isSaturday(dateStr) || isSunday(dateStr);
};

/**
 * 翌日が祝日かどうかを判定
 */
export const isPreHoliday = (dateStr: string): boolean => {
  const date = new Date(dateStr);
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = nextDay.toISOString().split("T")[0];
  return isHoliday(nextDayStr);
};

/**
 * 日付の種類を判定
 */
export const getDayType = (dateStr: string): DayType => {
  if (dayTypeCache.has(dateStr)) {
    return dayTypeCache.get(dateStr)!;
  }

  // 祝日
  if (isHoliday(dateStr)) {
    dayTypeCache.set(dateStr, "祝日");
    return "祝日";
  }

  // 祝日前日（平日のみ）
  if (!isWeekend(dateStr) && isPreHoliday(dateStr)) {
    dayTypeCache.set(dateStr, "祝日前日");
    return "祝日前日";
  }

  // 日曜
  if (isSunday(dateStr)) {
    dayTypeCache.set(dateStr, "日曜");
    return "日曜";
  }

  // 土曜
  if (isSaturday(dateStr)) {
    dayTypeCache.set(dateStr, "土曜");
    return "土曜";
  }

  // 平日
  dayTypeCache.set(dateStr, "平日");
  return "平日";
};

/**
 * 曜日の日本語名を取得
 */
export const getWeekdayName = (dateStr: string): string => {
  if (weekdayNameCache.has(dateStr)) {
    return weekdayNameCache.get(dateStr)!;
  }
  if (!weekdayIndexCache.has(dateStr)) {
    weekdayIndexCache.set(dateStr, new Date(dateStr).getDay());
  }
  const weekdays = ["日曜", "月曜", "火曜", "水曜", "木曜", "金曜", "土曜"];
  const name = weekdays[weekdayIndexCache.get(dateStr)!];
  weekdayNameCache.set(dateStr, name);
  return name;
};

/**
 * 期間フィルタリング
 */
export const filterByPeriod = <
  T extends { date?: string; reservationDate?: string },
>(
  data: T[],
  period: PeriodType,
): T[] => {
  if (period === "all") return data;

  const now = new Date();
  const monthsMap = { "3months": 3, "6months": 6, "1year": 12 };
  const months = monthsMap[period];

  const cutoffDate = new Date(now);
  cutoffDate.setMonth(cutoffDate.getMonth() - months);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];

  return data.filter((item) => {
    const itemDate = item.date || item.reservationDate;
    if (!itemDate) return false;
    return itemDate >= cutoffStr;
  });
};

const normalizeDateInput = (raw: string): string => {
  let normalized = raw.trim();
  if (normalized.length === 0) {
    return normalized;
  }

  if (normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "-");
  }

  if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(normalized)) {
    normalized = normalized.replace(/\//g, "-");
  } else if (/^\d{4}\/\d{1,2}$/.test(normalized)) {
    normalized = normalized.replace(/\//g, "-") + "-01";
  } else if (/^\d{4}-\d{1,2}$/.test(normalized)) {
    normalized = normalized + "-01";
  } else if (/^\d{4}\d{2}\d{2}$/.test(normalized)) {
    normalized = `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
  }

  if (/^\d{4}-\d{1,2}-\d{1,2} /.test(normalized)) {
    normalized = normalized.replace(" ", "T");
  }

  return normalized;
};

const parseFlexibleDate = (raw?: string): Date | null => {
  if (!raw) {
    return null;
  }

  const normalized = normalizeDateInput(raw);
  if (normalized.length === 0) {
    return null;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
};

export const getMonthKey = (value: string | undefined): string | null => {
  const date = parseFlexibleDate(value);
  if (!date) {
    return null;
  }

  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
};

type DateRangeOptions<T> = {
  startDate?: string;
  endDate?: string;
  getDate?: (item: T) => string | undefined;
};

export const filterByDateRange = <T>(
  data: T[],
  options: DateRangeOptions<T> = {},
): T[] => {
  const { startDate, endDate, getDate } = options;
  let start = parseFlexibleDate(startDate);
  let end = parseFlexibleDate(endDate);

  if (!start && !end) {
    return data;
  }

  if (start && end && start.getTime() > end.getTime()) {
    const swap = start;
    start = end;
    end = swap;
  }

  const resolveDate =
    getDate ??
    ((item: unknown) => {
      const candidate = item as {
        date?: string;
        reservationDate?: string;
        reservationMonth?: string;
      } | null;
      return (
        candidate?.date ??
        candidate?.reservationDate ??
        (candidate?.reservationMonth
          ? `${candidate.reservationMonth.replace("/", "-")}-01`
          : undefined)
      );
    });

  return data.filter((item) => {
    const raw = resolveDate(item);
    const parsed = parseFlexibleDate(raw);
    if (!parsed) {
      return false;
    }
    if (start && parsed.getTime() < start.getTime()) {
      return false;
    }
    if (end && parsed.getTime() > end.getTime()) {
      return false;
    }
    return true;
  });
};
