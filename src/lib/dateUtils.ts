import Holidays from "date-holidays";

const hd = new Holidays("JP");

export type DayType =
  | "平日"
  | "土曜"
  | "日曜"
  | "祝日"
  | "祝日前日"
  | "連休初日"
  | "連休中日"
  | "連休最終日"
  | "大型連休";

export type PeriodType = "3months" | "6months" | "1year" | "all";

/**
 * 日付が祝日かどうかを判定
 */
export const isHoliday = (dateStr: string): boolean => {
  const date = new Date(dateStr);
  const holidays = hd.isHoliday(date);
  return holidays !== false;
};

/**
 * 日付が土曜日かどうかを判定
 */
export const isSaturday = (dateStr: string): boolean => {
  const date = new Date(dateStr);
  return date.getDay() === 6;
};

/**
 * 日付が日曜日かどうかを判定
 */
export const isSunday = (dateStr: string): boolean => {
  const date = new Date(dateStr);
  return date.getDay() === 0;
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
 * 連休の判定（3日以上の休日が続く期間）
 */
export const getLongWeekendInfo = (
  dateStr: string,
): { isLongWeekend: boolean; position?: "first" | "middle" | "last"; length?: number } => {
  const date = new Date(dateStr);
  
  // この日が休日でなければ連休ではない
  if (!isHoliday(dateStr) && !isWeekend(dateStr)) {
    return { isLongWeekend: false };
  }

  // 前後の休日を数える
  let beforeCount = 0;
  let afterCount = 0;

  // 前の休日を数える
  for (let i = 1; i <= 10; i++) {
    const prevDate = new Date(date);
    prevDate.setDate(prevDate.getDate() - i);
    const prevDateStr = prevDate.toISOString().split("T")[0];
    if (isHoliday(prevDateStr) || isWeekend(prevDateStr)) {
      beforeCount++;
    } else {
      break;
    }
  }

  // 後の休日を数える
  for (let i = 1; i <= 10; i++) {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + i);
    const nextDateStr = nextDate.toISOString().split("T")[0];
    if (isHoliday(nextDateStr) || isWeekend(nextDateStr)) {
      afterCount++;
    } else {
      break;
    }
  }

  const totalLength = beforeCount + 1 + afterCount;

  // 3日以上なら連休
  if (totalLength >= 3) {
    let position: "first" | "middle" | "last";
    if (beforeCount === 0) {
      position = "first";
    } else if (afterCount === 0) {
      position = "last";
    } else {
      position = "middle";
    }

    return {
      isLongWeekend: true,
      position,
      length: totalLength,
    };
  }

  return { isLongWeekend: false };
};

/**
 * 日付の種類を判定
 */
export const getDayType = (dateStr: string): DayType => {
  const longWeekendInfo = getLongWeekendInfo(dateStr);

  // 大型連休（5日以上）
  if (longWeekendInfo.isLongWeekend && (longWeekendInfo.length ?? 0) >= 5) {
    return "大型連休";
  }

  // 連休の位置
  if (longWeekendInfo.isLongWeekend) {
    if (longWeekendInfo.position === "first") {
      return "連休初日";
    } else if (longWeekendInfo.position === "last") {
      return "連休最終日";
    } else {
      return "連休中日";
    }
  }

  // 祝日前日（平日のみ）
  if (!isHoliday(dateStr) && !isWeekend(dateStr) && isPreHoliday(dateStr)) {
    return "祝日前日";
  }

  // 祝日
  if (isHoliday(dateStr)) {
    return "祝日";
  }

  // 日曜
  if (isSunday(dateStr)) {
    return "日曜";
  }

  // 土曜
  if (isSaturday(dateStr)) {
    return "土曜";
  }

  // 平日
  return "平日";
};

/**
 * 曜日の日本語名を取得
 */
export const getWeekdayName = (dateStr: string): string => {
  const date = new Date(dateStr);
  const weekdays = ["日曜", "月曜", "火曜", "水曜", "木曜", "金曜", "土曜"];
  return weekdays[date.getDay()];
};

/**
 * 期間フィルタリング
 */
export const filterByPeriod = <T extends { date?: string; reservationDate?: string }>(
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

  return data.filter(item => {
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
