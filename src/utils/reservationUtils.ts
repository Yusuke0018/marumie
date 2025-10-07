import {
  ReservationDepartmentGroup,
  ReservationRecord,
  ReservationDepartmentStats,
  CorrelationPoint,
  ListingRecord
} from '../types/dataTypes';
import { formatDateJST, getMonthKeyJST } from './dateUtils';

interface DepartmentPattern {
  group: ReservationDepartmentGroup;
  keywords: string[];
}

const patterns: DepartmentPattern[] = [
  { group: '内科外科外来', keywords: ['内科・外科外来', '内科外科外来'] },
  { group: '内科外来', keywords: ['内科外来'] },
  { group: '発熱外来', keywords: ['発熱', '風邪症状'] },
  { group: '胃カメラ', keywords: ['胃カメラ', '胃内視鏡'] },
  { group: '大腸カメラ', keywords: ['大腸カメラ', '大腸内視鏡'] },
  { group: '内視鏡ドック', keywords: ['内視鏡ドック'] },
  { group: '人間ドックA', keywords: ['人間ドックA', '人間ドック（A'] },
  { group: '人間ドックB', keywords: ['人間ドックB', '人間ドック（B'] },
  { group: 'オンライン診療', keywords: ['オンライン診療'] },
];

const normalize = (value: string) => value.replace(/\s+/g, '').toLowerCase();

/**
 * 診療科名からグループを判定
 */
export function mapReservationDepartment(department: string): ReservationDepartmentGroup {
  if (!department) {
    return 'その他';
  }

  const normalized = normalize(department);

  for (const pattern of patterns) {
    for (const keyword of pattern.keywords) {
      if (normalized.includes(normalize(keyword))) {
        return pattern.group;
      }
    }
  }

  return 'その他';
}

/**
 * 月フィルタで予約データを抽出
 */
export function filterReservationsByMonth(
  reservations: ReservationRecord[],
  month: string | null
): ReservationRecord[] {
  if (!month) {
    return reservations;
  }

  return reservations.filter(record => getMonthKeyJST(record.dateTime) === month);
}

/**
 * 診療科×初診/再診ごとの集計を生成
 */
export function computeDepartmentStats(
  reservations: ReservationRecord[]
): ReservationDepartmentStats[] {
  const statsMap = new Map<string, ReservationDepartmentStats>();

  reservations.forEach(record => {
    const key = `${record.departmentGroup}-${record.type}`;
    if (!statsMap.has(key)) {
      statsMap.set(key, {
        department: record.departmentGroup,
        type: record.type,
        total: 0,
        hourly: Array(24).fill(0),
        daily: {}
      });
    }

    const stats = statsMap.get(key)!;
    stats.total += record.count;

    const hour = record.dateTime.getHours();
    stats.hourly[hour] = (stats.hourly[hour] ?? 0) + record.count;

    const dateKey = formatDateJST(record.dateTime);
    stats.daily[dateKey] = (stats.daily[dateKey] ?? 0) + record.count;
  });

  return Array.from(statsMap.values()).sort((a, b) => b.total - a.total);
}

/**
 * 指定タイプの診療科リストを抽出（件数順）
 */
export function getTopDepartmentsByType(
  stats: ReservationDepartmentStats[],
  type: '初診' | '再診',
  limit = 6
): ReservationDepartmentStats[] {
  return stats
    .filter(stat => stat.type === type)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/**
 * 日別推移データを生成（合計＋主要診療科）
 */
export function buildReservationTrendData(
  stats: ReservationDepartmentStats[],
  departments: ReservationDepartmentGroup[],
  type: '初診' | '再診'
): Array<Record<string, number | string>> {
  const dateSet = new Set<string>();

  stats
    .filter(stat => stat.type === type)
    .forEach(stat => {
      Object.keys(stat.daily).forEach(date => dateSet.add(date));
    });

  const dates = Array.from(dateSet).sort();

  return dates.map(date => {
    const row: Record<string, number | string> = { date, total: 0 };

    departments.forEach(department => {
      row[department] = 0;
    });

    stats
      .filter(stat => stat.type === type)
      .forEach(stat => {
        const value = stat.daily[date] ?? 0;
        if (value > 0) {
          row.total = (row.total as number) + value;
          if (departments.includes(stat.department)) {
            row[stat.department] = (row[stat.department] as number) + value;
          }
        }
      });

    return row;
  });
}

/**
 * リスティングと予約データの相関シリーズを生成
 */
export function buildCorrelationSeries(
  listing: ListingRecord[],
  reservations: ReservationRecord[],
  targetGroups: ReservationDepartmentGroup[],
  month: string | null
): CorrelationPoint[] {
  const monthFilteredListing = month
    ? listing.filter(item => getMonthKeyJST(item.date) === month)
    : listing;
  const monthFilteredReservations = filterReservationsByMonth(reservations, month);

  const listingMap = new Map<string, number>();
  monthFilteredListing.forEach(record => {
    const dateKey = formatDateJST(record.date);
    const cv = record.cv ?? 0;
    listingMap.set(dateKey, (listingMap.get(dateKey) ?? 0) + cv);
  });

  const reservationMap = new Map<string, number>();
  monthFilteredReservations.forEach(record => {
    if (record.type !== '初診') return;
    if (!targetGroups.includes(record.departmentGroup)) return;
    const dateKey = formatDateJST(record.dateTime);
    reservationMap.set(dateKey, (reservationMap.get(dateKey) ?? 0) + record.count);
  });

  const dateSet = new Set<string>([
    ...listingMap.keys(),
    ...reservationMap.keys()
  ]);

  return Array.from(dateSet)
    .sort()
    .map(date => {
      const listingCV = listingMap.get(date) ?? 0;
      const reservationCount = reservationMap.get(date) ?? 0;
      return {
        date,
        listingCV,
        reservationCount,
        highlight: listingCV > 0 && reservationCount > 0
      };
    });
}
