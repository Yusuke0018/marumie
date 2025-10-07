/**
 * マルミエ - 日付ユーティリティ
 * すべての日付はAsia/Tokyo (JST)で統一処理
 */

import { parse, parseISO, isValid, format } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';

const TOKYO_TZ = 'Asia/Tokyo';

/**
 * 様々な形式の日付文字列をJSTのDateオブジェクトに変換
 * @param dateStr - 日付文字列 (例: "2025-10-02", "2025/10/2", "2025-10-02T10:00:00+09:00")
 * @returns JSTのDateオブジェクト、解析失敗時はnull
 */
export function parseJSTDate(dateStr: string): Date | null {
  if (!dateStr || dateStr.trim() === '') return null;

  const trimmed = dateStr.trim();

  try {
    // YYYY-MM-DD HH:mm 形式
    if (/^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      const formatString = trimmed.includes(':') && trimmed.split(':').length === 3
        ? 'yyyy-MM-dd H:mm:ss'
        : 'yyyy-MM-dd H:mm';
      const date = parse(trimmed, formatString, new Date());
      if (isValid(date)) {
        return utcToZonedTime(date, TOKYO_TZ);
      }
    }

    // YYYY/MM/DD HH:mm 形式
    if (/^\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      const formatString = trimmed.includes(':') && trimmed.split(':').length === 3
        ? 'yyyy/M/d H:mm:ss'
        : 'yyyy/M/d H:mm';
      const date = parse(trimmed, formatString, new Date());
      if (isValid(date)) {
        return utcToZonedTime(date, TOKYO_TZ);
      }
    }

    // ISO 8601形式 (YYYY-MM-DD または YYYY-MM-DDTHH:mm:ss+09:00)
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      const date = parseISO(trimmed);
      if (isValid(date)) {
        return utcToZonedTime(date, TOKYO_TZ);
      }
    }

    // スラッシュ区切り (YYYY/M/D または YYYY/MM/DD)
    if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(trimmed)) {
      const date = parse(trimmed, 'yyyy/M/d', new Date());
      if (isValid(date)) {
        return utcToZonedTime(date, TOKYO_TZ);
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * DateオブジェクトをYYYY-MM-DD形式の文字列に変換
 */
export function formatDateJST(date: Date): string {
  const zonedDate = utcToZonedTime(date, TOKYO_TZ);
  return format(zonedDate, 'yyyy-MM-dd');
}

/**
 * DateオブジェクトからYYYY-MM形式の月文字列を取得
 */
export function getMonthKeyJST(date: Date): string {
  const zonedDate = utcToZonedTime(date, TOKYO_TZ);
  return format(zonedDate, 'yyyy-MM');
}

/**
 * 日付が2025-10-02 (JST)以降かを判定
 */
export function isAfterStartDate(date: Date): boolean {
  const startDate = parseISO('2025-10-02');
  return date >= startDate;
}

/**
 * データから利用可能な月のリストを抽出
 */
export function extractAvailableMonths(dates: Date[]): string[] {
  const monthSet = new Set<string>();
  dates.forEach(date => {
    if (isAfterStartDate(date)) {
      monthSet.add(getMonthKeyJST(date));
    }
  });
  return Array.from(monthSet).sort();
}
