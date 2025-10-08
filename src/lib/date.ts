import { format, parse, parseISO, isValid } from "date-fns";
import { toZonedTime } from "date-fns-tz";

const TOKYO_TZ = "Asia/Tokyo";
const START_DATE_ISO = "2025-10-02T00:00:00+09:00";

export const startDate = parseISO(START_DATE_ISO);

export function parseJstDate(value: string): Date | null {
  if (!value) return null;
  const trimmed = value.trim();

  try {
    if (/^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      const formatString = trimmed.includes(":")
        ? trimmed.split(":").length === 3
          ? "yyyy-MM-dd H:mm:ss"
          : "yyyy-MM-dd H:mm"
        : "yyyy-MM-dd H:mm";
      const parsed = parse(trimmed, formatString, new Date());
      if (isValid(parsed)) {
        return toZonedTime(parsed, TOKYO_TZ);
      }
    }

    if (/^\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      const formatString = trimmed.includes(":")
        ? trimmed.split(":").length === 3
          ? "yyyy/M/d H:mm:ss"
          : "yyyy/M/d H:mm"
        : "yyyy/M/d H:mm";
      const parsed = parse(trimmed, formatString, new Date());
      if (isValid(parsed)) {
        return toZonedTime(parsed, TOKYO_TZ);
      }
    }

    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      const parsed = parseISO(trimmed);
      if (isValid(parsed)) {
        return toZonedTime(parsed, TOKYO_TZ);
      }
    }

    if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(trimmed)) {
      const parsed = parse(trimmed, "yyyy/M/d", new Date());
      if (isValid(parsed)) {
        return toZonedTime(parsed, TOKYO_TZ);
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function isOnOrAfterStart(date: Date): boolean {
  return date >= startDate;
}

export function toDateKey(date: Date): string {
  const zoned = toZonedTime(date, TOKYO_TZ);
  return format(zoned, "yyyy-MM-dd");
}

export function toMonthKey(date: Date): string {
  const zoned = toZonedTime(date, TOKYO_TZ);
  return format(zoned, "yyyy-MM");
}

export function extractMonthOptions(dates: Date[]): string[] {
  const set = new Set<string>();
  dates.forEach((date) => {
    if (isOnOrAfterStart(date)) {
      set.add(toMonthKey(date));
    }
  });
  return Array.from(set).sort();
}
