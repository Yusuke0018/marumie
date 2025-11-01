import type { Reservation } from "@/lib/reservationData";
import type { KarteRecord } from "@/lib/karteAnalytics";
import type { ListingCategory, ListingCategoryData } from "@/lib/listingData";
import type { SurveyData } from "@/lib/surveyData";
import {
  buildFirstSeenIndex,
  createPatientIdentityKey,
} from "@/lib/patientIdentity";

export type SegmentKey = "all" | "general" | "fever" | "endoscopy";

export type HourlyPoint = {
  isoHour: string;
  date: string;
  hour: number;
  reservations: number;
  trueFirst: number;
  listingCv: number;
};

export type DailyPoint = {
  date: string;
  reservations: number;
  trueFirst: number;
  listingCv: number;
  surveyGoogle: number;
};

export type SegmentDataset = {
  hourly: HourlyPoint[];
  daily: DailyPoint[];
  totals: {
    reservations: number;
    trueFirst: number;
    listingCv: number;
    surveyGoogle: number;
  };
};

export type IncrementalityDataset = {
  segments: Record<SegmentKey, SegmentDataset>;
};

export type LagCorrelationPoint = {
  lag: number;
  correlation: number;
  pairedSamples: number;
};

export type DistributedLagResult = {
  maxLag: number;
  coefficients: number[]; // [intercept, lag0, lag1, ...]
  totalEffect: number;
  rSquared: number;
  sampleSize: number;
};

type HourlyAccumulator = {
  reservations: number;
  trueFirst: number;
  listingCv: number;
};

type SegmentHourlyMap = Record<SegmentKey, Map<string, HourlyAccumulator>>;

type SurveyDailyMap = {
  general: Map<string, number>;
  fever: Map<string, number>;
  endoscopy: Map<string, number>;
};

const FEVER_PATTERNS = [/発熱/, /風邪/];
const GENERAL_PATTERNS = [/総合診療/, /内科/];
const ENDOSCOPY_PATTERNS = [/内視鏡/, /胃/, /大腸/];

const LISTING_SEGMENT_MAP: Record<ListingCategory, SegmentKey> = {
  発熱外来: "fever",
  内科: "general",
  胃カメラ: "endoscopy",
  大腸カメラ: "endoscopy",
};

const ensureHourlyAccumulator = (
  maps: SegmentHourlyMap,
  segment: SegmentKey,
  hourKey: string,
): HourlyAccumulator => {
  const map = maps[segment];
  if (!map.has(hourKey)) {
    map.set(hourKey, { reservations: 0, trueFirst: 0, listingCv: 0 });
  }
  return map.get(hourKey)!;
};

const toHourKey = (iso: string | null | undefined): string | null => {
  if (!iso) {
    return null;
  }
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})/);
  if (!match) {
    return null;
  }
  const [, datePart, hourPart] = match;
  return `${datePart}T${hourPart}:00:00+09:00`;
};

const toDateKey = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(value)) {
    const [y, m, d] = value.split("/");
    const month = `${Number(m)}`.padStart(2, "0");
    const day = `${Number(d)}`.padStart(2, "0");
    return `${y}-${month}-${day}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getDate()}`.padStart(2, "0");
  return `${parsed.getFullYear()}-${month}-${day}`;
};

const buildIsoHourFromDate = (dateKey: string, hour: number): string => {
  const hh = `${hour}`.padStart(2, "0");
  return `${dateKey}T${hh}:00:00+09:00`;
};

const determineReservationSegment = (department: string | null | undefined): SegmentKey | null => {
  if (!department) {
    return null;
  }
  if (FEVER_PATTERNS.some((pattern) => pattern.test(department))) {
    return "fever";
  }
  if (GENERAL_PATTERNS.some((pattern) => pattern.test(department))) {
    return "general";
  }
  if (ENDOSCOPY_PATTERNS.some((pattern) => pattern.test(department))) {
    return "endoscopy";
  }
  return null;
};

const isSameDate = (isoA: string | null | undefined, isoB: string | null | undefined): boolean => {
  if (!isoA || !isoB) {
    return false;
  }
  return isoA.slice(0, 10) === isoB.slice(0, 10);
};

const sumArray = (values: number[]): number => values.reduce((total, value) => total + value, 0);

export const buildIncrementalityDataset = (
  reservations: Reservation[],
  karteRecords: KarteRecord[],
  listingData: ListingCategoryData[],
  surveyData: SurveyData[],
): IncrementalityDataset => {
  const hourlyMaps: SegmentHourlyMap = {
    all: new Map<string, HourlyAccumulator>(),
    general: new Map<string, HourlyAccumulator>(),
    fever: new Map<string, HourlyAccumulator>(),
    endoscopy: new Map<string, HourlyAccumulator>(),
  };

  const surveyDaily: SurveyDailyMap = {
    general: new Map<string, number>(),
    fever: new Map<string, number>(),
    endoscopy: new Map<string, number>(),
  };

  const identityEvents: Array<{ identityKey: string | null; occurredAt: string | null }> = [];

  reservations.forEach((reservation) => {
    identityEvents.push({
      identityKey: createPatientIdentityKey({
        patientNameNormalized: reservation.patientNameNormalized ?? undefined,
        patientName: reservation.patientName ?? undefined,
      }),
      occurredAt: reservation.receivedAtIso ?? reservation.bookingIso ?? reservation.appointmentIso ?? null,
    });
  });

  karteRecords.forEach((record) => {
    identityEvents.push({
      identityKey: createPatientIdentityKey({
        patientNumber: record.patientNumber,
        patientNameNormalized: record.patientNameNormalized ?? undefined,
        birthDateIso: record.birthDateIso ?? undefined,
      }),
      occurredAt: record.dateIso ? `${record.dateIso}T00:00:00+09:00` : null,
    });
  });

  const firstSeenIndex = buildFirstSeenIndex(
    identityEvents
      .filter((event) => event.identityKey)
      .map((event) => ({
        identityKey: event.identityKey!,
        occurredAt: event.occurredAt,
      })),
  );

  reservations.forEach((reservation) => {
    const timestamp = reservation.receivedAtIso ?? reservation.bookingIso ?? reservation.appointmentIso ?? null;
    const hourKey = toHourKey(timestamp);
    if (!hourKey) {
      return;
    }

    const segment = determineReservationSegment(reservation.department);
    const identityKey = createPatientIdentityKey({
      patientNameNormalized: reservation.patientNameNormalized ?? undefined,
      patientName: reservation.patientName ?? undefined,
    });

    const firstSeen = identityKey ? firstSeenIndex.get(identityKey) ?? null : null;
    const isTrueFirst = identityKey ? isSameDate(firstSeen, timestamp) : false;

    const allAccumulator = ensureHourlyAccumulator(hourlyMaps, "all", hourKey);
    allAccumulator.reservations += 1;
    if (isTrueFirst) {
      allAccumulator.trueFirst += 1;
    }

    if (segment) {
      const segmentAccumulator = ensureHourlyAccumulator(hourlyMaps, segment, hourKey);
      segmentAccumulator.reservations += 1;
      if (isTrueFirst) {
        segmentAccumulator.trueFirst += 1;
      }
    }
  });

  listingData.forEach((categoryData) => {
    const segment = LISTING_SEGMENT_MAP[categoryData.category];
    if (!segment) {
      return;
    }

    categoryData.data.forEach((entry) => {
      const dateKey = toDateKey(entry.date);
      if (!dateKey) {
        return;
      }
      for (let hour = 0; hour < entry.hourlyCV.length; hour += 1) {
        const value = entry.hourlyCV[hour] ?? 0;
        if (value === 0) {
          continue;
        }
        const hourKey = buildIsoHourFromDate(dateKey, hour);
        const segmentAccumulator = ensureHourlyAccumulator(hourlyMaps, segment, hourKey);
        segmentAccumulator.listingCv += value;
        const allAccumulator = ensureHourlyAccumulator(hourlyMaps, "all", hourKey);
        allAccumulator.listingCv += value;
      }
    });
  });

  surveyData.forEach((survey) => {
    const dateKey = survey.date;
    if (!dateKey) {
      return;
    }

    if (survey.fileType === "外来") {
      const general = (survey.googleSearch ?? 0) + (survey.googleMap ?? 0);
      const fever = survey.feverGoogleSearch ?? 0;
      if (general > 0) {
        surveyDaily.general.set(dateKey, (surveyDaily.general.get(dateKey) ?? 0) + general);
      }
      if (fever > 0) {
        surveyDaily.fever.set(dateKey, (surveyDaily.fever.get(dateKey) ?? 0) + fever);
      }
      if (general + fever > 0) {
        surveyDaily.endoscopy.set(dateKey, (surveyDaily.endoscopy.get(dateKey) ?? 0));
      }
    } else if (survey.fileType === "内視鏡") {
      const value = (survey.googleSearch ?? 0) + (survey.googleMap ?? 0);
      if (value > 0) {
        surveyDaily.endoscopy.set(dateKey, (surveyDaily.endoscopy.get(dateKey) ?? 0) + value);
      }
    }
  });

  const buildSegmentDataset = (segment: SegmentKey): SegmentDataset => {
    const hourlyMap = hourlyMaps[segment];
    const hourlyPoints: HourlyPoint[] = Array.from(hourlyMap.entries())
      .map(([hourKey, acc]) => ({
        isoHour: hourKey,
        date: hourKey.slice(0, 10),
        hour: Number.parseInt(hourKey.slice(11, 13), 10),
        reservations: acc.reservations,
        trueFirst: acc.trueFirst,
        listingCv: acc.listingCv,
      }))
      .sort((a, b) => a.isoHour.localeCompare(b.isoHour));

    const dailyMap = new Map<string, DailyPoint>();

    hourlyPoints.forEach((point) => {
      if (!dailyMap.has(point.date)) {
        dailyMap.set(point.date, {
          date: point.date,
          reservations: 0,
          trueFirst: 0,
          listingCv: 0,
          surveyGoogle: 0,
        });
      }
      const daily = dailyMap.get(point.date)!;
      daily.reservations += point.reservations;
      daily.trueFirst += point.trueFirst;
      daily.listingCv += point.listingCv;
    });

    const surveyMap =
      segment === "fever"
        ? surveyDaily.fever
        : segment === "general"
          ? surveyDaily.general
          : segment === "endoscopy"
            ? surveyDaily.endoscopy
            : null;

    if (surveyMap) {
      surveyMap.forEach((value, dateKey) => {
        if (!dailyMap.has(dateKey)) {
          dailyMap.set(dateKey, {
            date: dateKey,
            reservations: 0,
            trueFirst: 0,
            listingCv: 0,
            surveyGoogle: 0,
          });
        }
        const daily = dailyMap.get(dateKey)!;
        daily.surveyGoogle += value;
      });
    }

    const dailyPoints = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    const totals = dailyPoints.reduce(
      (acc, item) => {
        acc.reservations += item.reservations;
        acc.trueFirst += item.trueFirst;
        acc.listingCv += item.listingCv;
        acc.surveyGoogle += item.surveyGoogle;
        return acc;
      },
      { reservations: 0, trueFirst: 0, listingCv: 0, surveyGoogle: 0 },
    );

    return {
      hourly: hourlyPoints,
      daily: dailyPoints,
      totals,
    };
  };

  const segments: Record<SegmentKey, SegmentDataset> = {
    all: buildSegmentDataset("all"),
    general: buildSegmentDataset("general"),
    fever: buildSegmentDataset("fever"),
    endoscopy: buildSegmentDataset("endoscopy"),
  };

  return { segments };
};

const calculateCorrelation = (x: number[], y: number[]): number => {
  if (x.length !== y.length || x.length === 0) {
    return 0;
  }
  const n = x.length;
  const sumX = sumArray(x);
  const sumY = sumArray(y);
  const sumXY = x.reduce((acc, value, index) => acc + value * y[index], 0);
  const sumX2 = x.reduce((acc, value) => acc + value * value, 0);
  const sumY2 = y.reduce((acc, value) => acc + value * value, 0);
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(Math.max((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY), 0));
  if (denominator === 0) {
    return 0;
  }
  return numerator / denominator;
};

export const computeLagCorrelations = (
  hourly: HourlyPoint[],
  maxLag: number,
): LagCorrelationPoint[] => {
  if (hourly.length === 0) {
    return [];
  }
  const sorted = [...hourly].sort((a, b) => a.isoHour.localeCompare(b.isoHour));
  const listingSeries = sorted.map((item) => item.listingCv);
  const targetSeries = sorted.map((item) => item.trueFirst);
  const results: LagCorrelationPoint[] = [];

  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    const alignedSource: number[] = [];
    const alignedTarget: number[] = [];
    for (let index = 0; index < listingSeries.length; index += 1) {
      const shiftedIndex = index + lag;
      if (shiftedIndex < 0 || shiftedIndex >= targetSeries.length) {
        continue;
      }
      alignedSource.push(listingSeries[index]);
      alignedTarget.push(targetSeries[shiftedIndex]);
    }
    if (alignedSource.length > 1) {
      results.push({
        lag,
        correlation: calculateCorrelation(alignedSource, alignedTarget),
        pairedSamples: alignedSource.length,
      });
    }
  }

  return results.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
};

const solveLinearSystem = (matrix: number[][], rhs: number[]): number[] | null => {
  const n = matrix.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index]]);

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    let maxAbs = Math.abs(augmented[col][col]);
    for (let row = col + 1; row < n; row += 1) {
      const value = Math.abs(augmented[row][col]);
      if (value > maxAbs) {
        maxAbs = value;
        pivotRow = row;
      }
    }

    if (maxAbs < 1e-8) {
      return null;
    }

    if (pivotRow !== col) {
      const temp = augmented[col];
      augmented[col] = augmented[pivotRow];
      augmented[pivotRow] = temp;
    }

    const pivot = augmented[col][col];
    for (let j = col; j <= n; j += 1) {
      augmented[col][j] /= pivot;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) {
        continue;
      }
      const factor = augmented[row][col];
      for (let j = col; j <= n; j += 1) {
        augmented[row][j] -= factor * augmented[col][j];
      }
    }
  }

  return augmented.map((row) => row[n]);
};

export const computeDistributedLagEffect = (
  hourly: HourlyPoint[],
  maxLag: number,
): DistributedLagResult | null => {
  if (hourly.length === 0 || maxLag < 0) {
    return null;
  }

  const sorted = [...hourly].sort((a, b) => a.isoHour.localeCompare(b.isoHour));
  const listingSeries = sorted.map((item) => item.listingCv);
  const targetSeries = sorted.map((item) => item.trueFirst);

  const rows: number[][] = [];
  const y: number[] = [];

  for (let index = maxLag; index < listingSeries.length; index += 1) {
    const row: number[] = [1];
    for (let lag = 0; lag <= maxLag; lag += 1) {
      row.push(listingSeries[index - lag]);
    }
    rows.push(row);
    y.push(targetSeries[index]);
  }

  if (rows.length < maxLag + 2) {
    return null;
  }

  const columns = rows[0].length;
  const xtx: number[][] = Array.from({ length: columns }, () => Array(columns).fill(0));
  const xty: number[] = Array(columns).fill(0);

  rows.forEach((row, rowIndex) => {
    const target = y[rowIndex];
    for (let i = 0; i < columns; i += 1) {
      xty[i] += row[i] * target;
      for (let j = 0; j < columns; j += 1) {
        xtx[i][j] += row[i] * row[j];
      }
    }
  });

  const coefficients = solveLinearSystem(xtx, xty);
  if (!coefficients) {
    return null;
  }

  const predictions = rows.map((row) => row.reduce((acc, value, index) => acc + value * coefficients[index], 0));
  const meanY = sumArray(y) / y.length;
  const ssTot = y.reduce((acc, value) => acc + (value - meanY) ** 2, 0);
  const ssRes = y.reduce((acc, value, index) => acc + (value - predictions[index]) ** 2, 0);
  const rSquared = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);

  const totalEffect = coefficients.slice(1).reduce((acc, value) => acc + value, 0);

  return {
    maxLag,
    coefficients,
    totalEffect,
    rSquared,
    sampleSize: rows.length,
  };
};
