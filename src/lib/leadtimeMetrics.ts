import type { Reservation } from "@/lib/reservationData";

export const LEADTIME_METRICS_STORAGE_KEY =
  "clinic-analytics/reservations-leadtime/v1";

export type LeadtimeCategory =
  | "当日以内"
  | "翌日"
  | "3日以内"
  | "1週間以内"
  | "2週間以内"
  | "それ以降";

export const LEADTIME_CATEGORIES: LeadtimeCategory[] = [
  "当日以内",
  "翌日",
  "3日以内",
  "1週間以内",
  "2週間以内",
  "それ以降",
];

export type LeadtimeCategoryCounts = Record<LeadtimeCategory, number>;

export type LeadtimeSummary = {
  total: number;
  averageHours: number | null;
  medianHours: number | null;
  p90Hours: number | null;
  sameDayCount: number;
  sameDayRate: number;
  categoryCounts: LeadtimeCategoryCounts;
};

export type LeadtimeHourStat = {
  hour: number;
  summary: LeadtimeSummary;
  topCategory: LeadtimeCategory | null;
};

export type LeadtimeDepartmentStat = {
  department: string;
  summary: LeadtimeSummary;
};

export type LeadtimeMetrics = {
  summary: LeadtimeSummary;
  hourStats: LeadtimeHourStat[];
  departmentStats: LeadtimeDepartmentStat[];
  departmentHourStats: Record<string, LeadtimeHourStat[]>;
};

type MutableLeadtimeAccumulator = {
  hours: number[];
  sum: number;
  sameDayCount: number;
  total: number;
  categoryCounts: LeadtimeCategoryCounts;
};

const createCategoryCounter = (): LeadtimeCategoryCounts => {
  return LEADTIME_CATEGORIES.reduce((acc, category) => {
    acc[category] = 0;
    return acc;
  }, {} as LeadtimeCategoryCounts);
};

const createAccumulator = (): MutableLeadtimeAccumulator => ({
  hours: [],
  sum: 0,
  sameDayCount: 0,
  total: 0,
  categoryCounts: createCategoryCounter(),
});

const toSummary = (
  accumulator: MutableLeadtimeAccumulator,
): LeadtimeSummary => {
  const { hours, sum, sameDayCount, total, categoryCounts } = accumulator;
  if (total === 0) {
    return {
      total: 0,
      averageHours: null,
      medianHours: null,
      p90Hours: null,
      sameDayCount: 0,
      sameDayRate: 0,
      categoryCounts: createCategoryCounter(),
    };
  }

  const sorted = [...hours].sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
  const p90 =
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];

  return {
    total,
    averageHours: sum / total,
    medianHours: median,
    p90Hours: p90,
    sameDayCount,
    sameDayRate: sameDayCount / total,
    categoryCounts: { ...categoryCounts },
  };
};

export const getTopCategory = (
  categoryCounts: LeadtimeCategoryCounts,
): LeadtimeCategory | null => {
  let topCategory: LeadtimeCategory | null = null;
  let topCount = -1;
  for (const category of LEADTIME_CATEGORIES) {
    const count = categoryCounts[category] ?? 0;
    if (count > topCount) {
      topCategory = category;
      topCount = count;
    }
  }
  return topCategory;
};

export const getLeadtimeCategory = (
  diffHours: number,
  receivedDate: Date,
  appointmentDate: Date,
): LeadtimeCategory => {
  // 当日以内：同じ日付（24時間以内ではなく日付で判定）
  const isSameDay =
    receivedDate.getFullYear() === appointmentDate.getFullYear() &&
    receivedDate.getMonth() === appointmentDate.getMonth() &&
    receivedDate.getDate() === appointmentDate.getDate();
  
  if (isSameDay) {
    return "当日以内";
  }
  if (diffHours < 48) {
    return "翌日";
  }
  if (diffHours < 72) {
    return "3日以内";
  }
  if (diffHours < 168) {
    return "1週間以内";
  }
  if (diffHours < 336) {
    return "2週間以内";
  }
  return "それ以降";
};

export const aggregateLeadtimeMetrics = (
  reservations: Reservation[],
): LeadtimeMetrics => {
  const overall = createAccumulator();
  const hourAccumulators: MutableLeadtimeAccumulator[] = Array.from(
    { length: 24 },
    () => createAccumulator(),
  );
  const departmentAccumulators = new Map<string, MutableLeadtimeAccumulator>();
  const departmentHourAccumulators = new Map<
    string,
    MutableLeadtimeAccumulator[]
  >();

  for (const reservation of reservations) {
    if (!reservation.appointmentIso) {
      continue;
    }
    const appointmentDate = new Date(reservation.appointmentIso);
    const receivedDate = new Date(reservation.receivedAtIso);
    const diffMs = appointmentDate.getTime() - receivedDate.getTime();
    if (Number.isNaN(diffMs) || diffMs < 0) {
      continue;
    }
    const diffHours = diffMs / (1000 * 60 * 60);

    overall.hours.push(diffHours);
    overall.sum += diffHours;
    overall.total += 1;

    const category = getLeadtimeCategory(diffHours, receivedDate, appointmentDate);
    overall.categoryCounts[category] += 1;
    if (category === "当日以内") {
      overall.sameDayCount += 1;
    }

    if (
      !Number.isNaN(reservation.reservationHour) &&
      reservation.reservationHour >= 0 &&
      reservation.reservationHour <= 23
    ) {
      const hourAccumulator = hourAccumulators[reservation.reservationHour];
      hourAccumulator.hours.push(diffHours);
      hourAccumulator.sum += diffHours;
      hourAccumulator.total += 1;
      hourAccumulator.categoryCounts[category] += 1;
      if (category === "当日以内") {
        hourAccumulator.sameDayCount += 1;
      }
    }

    const departmentName = reservation.department;
    if (!departmentAccumulators.has(departmentName)) {
      departmentAccumulators.set(departmentName, createAccumulator());
      departmentHourAccumulators.set(
        departmentName,
        Array.from({ length: 24 }, () => createAccumulator()),
      );
    }
    const departmentAccumulator = departmentAccumulators.get(departmentName)!;
    departmentAccumulator.hours.push(diffHours);
    departmentAccumulator.sum += diffHours;
    departmentAccumulator.total += 1;
    departmentAccumulator.categoryCounts[category] += 1;
    if (category === "当日以内") {
      departmentAccumulator.sameDayCount += 1;
    }

    if (
      !Number.isNaN(reservation.reservationHour) &&
      reservation.reservationHour >= 0 &&
      reservation.reservationHour <= 23
    ) {
      const departmentHourArray =
        departmentHourAccumulators.get(departmentName)!;
      const departmentHourAccumulator =
        departmentHourArray[reservation.reservationHour];
      departmentHourAccumulator.hours.push(diffHours);
      departmentHourAccumulator.sum += diffHours;
      departmentHourAccumulator.total += 1;
      departmentHourAccumulator.categoryCounts[category] += 1;
      if (category === "当日以内") {
        departmentHourAccumulator.sameDayCount += 1;
      }
    }
  }

  const hourStats: LeadtimeHourStat[] = hourAccumulators.map((acc, hour) => ({
    hour,
    summary: toSummary(acc),
    topCategory: getTopCategory(acc.categoryCounts),
  }));

  const departmentStats: LeadtimeDepartmentStat[] = Array.from(
    departmentAccumulators.entries(),
  )
    .map(([department, acc]) => ({
      department,
      summary: toSummary(acc),
    }))
    .sort((a, b) => b.summary.total - a.summary.total);

  const departmentHourStats: Record<string, LeadtimeHourStat[]> = {};
  for (const [department, hourArray] of departmentHourAccumulators.entries()) {
    departmentHourStats[department] = hourArray.map((acc, hour) => ({
      hour,
      summary: toSummary(acc),
      topCategory: getTopCategory(acc.categoryCounts),
    }));
  }

  return {
    summary: toSummary(overall),
    hourStats,
    departmentStats,
    departmentHourStats,
  };
};

export const saveLeadtimeMetricsToStorage = (
  metrics: LeadtimeMetrics | null,
) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (!metrics) {
      window.localStorage.removeItem(LEADTIME_METRICS_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      LEADTIME_METRICS_STORAGE_KEY,
      JSON.stringify(metrics),
    );
  } catch (error) {
    console.error(error);
  }
};

export const loadLeadtimeMetricsFromStorage = (): LeadtimeMetrics | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(LEADTIME_METRICS_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    return JSON.parse(stored) as LeadtimeMetrics;
  } catch (error) {
    console.error(error);
    return null;
  }
};

export const clearLeadtimeMetricsStorage = () => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(LEADTIME_METRICS_STORAGE_KEY);
  } catch (error) {
    console.error(error);
  }
};
