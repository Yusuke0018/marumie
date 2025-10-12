"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  memo,
  lazy,
  Suspense,
  useRef,
} from "react";
import { inflate } from "pako";
import { RefreshCw, Share2, Link as LinkIcon } from "lucide-react";
import Link from "next/link";
import { uploadDataToR2, fetchDataFromR2 } from "@/lib/dataShare";
import { getDayType, getWeekdayName } from "@/lib/dateUtils";
import type { DayType } from "@/lib/dateUtils";
import {
  Reservation,
  loadReservationsFromStorage,
  loadReservationTimestamp,
  saveReservationsToStorage,
  clearReservationsStorage,
  loadReservationDiff,
  clearReservationDiff,
  RESERVATION_STORAGE_KEY,
  RESERVATION_DIFF_STORAGE_KEY,
} from "@/lib/reservationData";
import { saveSurveyDataToStorage } from "@/lib/surveyData";
import { saveListingDataToStorage } from "@/lib/listingData";
import type { SharedDataBundle } from "@/lib/sharedBundle";
import { setCompressedItem } from "@/lib/storageCompression";
import { AnalysisFilterPortal } from "@/components/AnalysisFilterPortal";
import { useAnalysisPeriodRange } from "@/hooks/useAnalysisPeriodRange";
import { setAnalysisPeriodLabel } from "@/lib/analysisPeriod";
// グラフコンポーネントをReact.lazyで遅延ロード（初期バンドルサイズを削減）
const WeekdayChartSection = lazy(() =>
  import("@/components/reservations/WeekdayChartSection").then((m) => ({
    default: m.WeekdayChartSection,
  })),
);
const HourlyChartSection = lazy(() =>
  import("@/components/reservations/HourlyChartSection").then((m) => ({
    default: m.HourlyChartSection,
  })),
);
const DailyChartSection = lazy(() =>
  import("@/components/reservations/DailyChartSection").then((m) => ({
    default: m.DailyChartSection,
  })),
);
const MonthlyTrendChart = lazy(() =>
  import("@/components/reservations/MonthlyTrendChart").then((m) => ({
    default: m.MonthlyTrendChart,
  })),
);

type HourlyBucket = {
  hour: string;
  total: number;
  初診: number;
  再診: number;
};

type DailyBucket = {
  date: string;
  total: number;
};

type BasicDayType = "平日" | "土曜" | "日曜" | "祝日";

type MonthlyBucket = {
  month: string;
  total: number;
  初診: number;
  再診: number;
  当日予約: number;
};

const HOURS = Array.from({ length: 24 }, (_, index) => index);
const KARTE_STORAGE_KEY = "clinic-analytics/karte-records/v1";
const KARTE_TIMESTAMP_KEY = "clinic-analytics/karte-last-updated/v1";

const encodeForShare = (payload: string): string => {
  if (typeof window === "undefined") {
    return "";
  }
  const bytes = new TextEncoder().encode(payload);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
};

const decodeFromShare = (payload: string): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const binary = window.atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  } catch (error) {
    console.error(error);
    return null;
  }
};

const buildShareUrl = (workerUrl: string, id: string, fallbackPayload?: string) => {
  if (typeof window === "undefined") {
    const url = new URL(workerUrl);
    url.searchParams.set("data", id);
    if (fallbackPayload) {
      url.searchParams.set("fallback", fallbackPayload);
    }
    return url.toString();
  }

  const { origin, pathname } = window.location;
  const isLocalHost = /localhost|127\.0\.0\.1|0\.0\.0\.0|::1/.test(origin);
  const baseUrl = isLocalHost
    ? new URL(workerUrl)
    : new URL(`${origin}${pathname}`);

  baseUrl.searchParams.set("data", id);
  if (fallbackPayload) {
    baseUrl.searchParams.set("fallback", fallbackPayload);
  }
  return baseUrl.toString();
};

const RAW_DEPARTMENT_PRIORITIES = [
  "●内科・外科外来（大岩医師）",
  "●内科外来（担当医師）",
  "●発熱・風邪症状外来",
  "●予防接種",
  "●ワクチン予約（インフルエンザ・新型コロナウイルス）",
  "●フルミスト（経鼻インフルエンザワクチン）",
  "●胃カメラ",
  "●大腸カメラ（胃カメラ併用もこちら）",
  "●大腸カメラ（４日以内の直前枠）",
  "●内視鏡ドック",
  "●人間ドックA",
  "●人間ドックB",
  "●健康診断（A,B,特定健診）",
  "●健康診断C",
  "●睡眠ドック",
  "★胃カメラ",
  "企業健診（健診）",
  "企業健診（人間ドック）",
  "●オンライン診療（保険診療その他）",
  "●オンライン診療（AGA/ED）",
];

const normalizeDepartment = (name: string) =>
  name
    .replace(/[（）()●]/g, "")
    .replace(/\s+/g, "")
    .trim();

const DEPARTMENT_PRIORITIES = RAW_DEPARTMENT_PRIORITIES.map((label) =>
  label.replace(/^●\s*/, "").trim(),
);

const DEPARTMENT_PRIORITY_LOOKUP = new Map<string, number>();
DEPARTMENT_PRIORITIES.forEach((label, index) => {
  const normalized = normalizeDepartment(label);
  if (!DEPARTMENT_PRIORITY_LOOKUP.has(normalized)) {
    DEPARTMENT_PRIORITY_LOOKUP.set(normalized, index);
  }
});

const getPriority = (name: string) => {
  const normalized = normalizeDepartment(name);
  const directMatch = DEPARTMENT_PRIORITY_LOOKUP.get(normalized);
  if (directMatch !== undefined) {
    return directMatch;
  }

  for (let index = 0; index < DEPARTMENT_PRIORITIES.length; index++) {
    const keywordNormalized = normalizeDepartment(DEPARTMENT_PRIORITIES[index]);
    if (
      keywordNormalized.length > 0 &&
      (normalized.includes(keywordNormalized) ||
        keywordNormalized.includes(normalized))
    ) {
      return index;
    }
  }

  return DEPARTMENT_PRIORITIES.length;
};

const hourLabel = (hour: number) => `${hour.toString().padStart(2, "0")}:00`;

const createEmptyHourlyBuckets = (): HourlyBucket[] =>
  HOURS.map((hour) => ({
    hour: hourLabel(hour),
    total: 0,
    初診: 0,
    再診: 0,
  }));

const aggregateMonthly = (reservations: Reservation[]): MonthlyBucket[] => {
  const counts = new Map<string, MonthlyBucket>();
  for (const reservation of reservations) {
    const key = reservation.reservationMonth;
    const bucket =
      counts.get(key) ??
      ({
        month: key,
        total: 0,
        初診: 0,
        再診: 0,
        当日予約: 0,
      } satisfies MonthlyBucket);

    bucket.total += 1;
    if (reservation.visitType === "初診" || reservation.visitType === "再診") {
      bucket[reservation.visitType] += 1;
    }
    if (reservation.isSameDay) {
      bucket["当日予約"] += 1;
    }
    counts.set(key, bucket);
  }

  return Array.from(counts.values()).sort((a, b) =>
    a.month.localeCompare(b.month),
  );
};

type DepartmentHourly = {
  department: string;
  data: HourlyBucket[];
  total: number;
};

type WeekdayBucket = {
  weekday: string;
  total: number;
  初診: number;
  再診: number;
  当日予約: number;
  avgPerDay: number;
  dayCount: number;
};

type DayTypeBucket = {
  dayType: BasicDayType;
  total: number;
  初診: number;
  再診: number;
  avgPerDay: number;
};

type AggregatedReservationInsights = {
  totals: {
    totalReservations: number;
    initialCount: number;
    followupCount: number;
    departmentCount: number;
  };
  weekdayData: WeekdayBucket[];
  dayTypeData: DayTypeBucket[];
  departmentHourlyList: DepartmentHourly[];
  departmentHourlyMap: Map<string, DepartmentHourly>;
  overallHourly: HourlyBucket[];
  overallDaily: DailyBucket[];
};

const DAY_TYPE_ORDER: BasicDayType[] = ["平日", "土曜", "日曜", "祝日"];

const simplifyDayType = (dayType: DayType): BasicDayType => {
  switch (dayType) {
    case "祝日":
    case "連休初日":
    case "連休中日":
    case "連休最終日":
    case "大型連休":
      return "祝日";
    case "日曜":
      return "日曜";
    case "土曜":
      return "土曜";
    default:
      return "平日";
  }
};

const aggregateReservationInsights = (
  reservations: Reservation[],
): AggregatedReservationInsights => {
  const weekdayOrder = [
    "日曜",
    "月曜",
    "火曜",
    "水曜",
    "木曜",
    "金曜",
    "土曜",
    "祝日",
  ];
  const weekdayMap = new Map<string, WeekdayBucket>();
  const weekdayDays = new Map<string, Set<string>>();
  weekdayOrder.forEach((weekday) => {
    weekdayMap.set(weekday, {
      weekday,
      total: 0,
      初診: 0,
      再診: 0,
      当日予約: 0,
      avgPerDay: 0,
      dayCount: 0,
    });
    weekdayDays.set(weekday, new Set<string>());
  });

  const dayTypeMap = new Map<
    BasicDayType,
    { total: number; 初診: number; 再診: number; days: Set<string> }
  >();
  DAY_TYPE_ORDER.forEach((dayType) => {
    dayTypeMap.set(dayType, {
      total: 0,
      初診: 0,
      再診: 0,
      days: new Set<string>(),
    });
  });
  const overallDailyMap = new Map<string, number>();
  const overallHourly = createEmptyHourlyBuckets();
  const departmentHourlyMap = new Map<string, DepartmentHourly>();
  const dayInfoCache = new Map<
    string,
    { weekday: string; dayType: BasicDayType }
  >();
  let initialCount = 0;
  let followupCount = 0;
  const departmentSet = new Set<string>();

  for (const reservation of reservations) {
    departmentSet.add(reservation.department);
    if (reservation.visitType === "初診") {
      initialCount += 1;
    } else if (reservation.visitType === "再診") {
      followupCount += 1;
    }

    overallDailyMap.set(
      reservation.reservationDate,
      (overallDailyMap.get(reservation.reservationDate) ?? 0) + 1,
    );

    const hour = reservation.reservationHour;
    if (!Number.isNaN(hour) && hour >= 0 && hour <= 23) {
      const overallHourBucket = overallHourly[hour];
      overallHourBucket.total += 1;
      if (
        reservation.visitType === "初診" ||
        reservation.visitType === "再診"
      ) {
        overallHourBucket[reservation.visitType] += 1;
      }

      let departmentEntry = departmentHourlyMap.get(reservation.department);
      if (!departmentEntry) {
        departmentEntry = {
          department: reservation.department,
          data: createEmptyHourlyBuckets(),
          total: 0,
        };
        departmentHourlyMap.set(reservation.department, departmentEntry);
      }

      const departmentBucket = departmentEntry.data[hour];
      departmentBucket.total += 1;
      if (
        reservation.visitType === "初診" ||
        reservation.visitType === "再診"
      ) {
        departmentBucket[reservation.visitType] += 1;
      }
      departmentEntry.total += 1;
    }

    let dayInfo = dayInfoCache.get(reservation.reservationDate);
    if (!dayInfo) {
      const dayTypeValue = getDayType(reservation.reservationDate);
      const simplifiedDayType = simplifyDayType(dayTypeValue);
      const weekdayValue =
        simplifiedDayType === "祝日"
          ? "祝日"
          : getWeekdayName(reservation.reservationDate);
      dayInfo = { weekday: weekdayValue, dayType: simplifiedDayType };
      dayInfoCache.set(reservation.reservationDate, dayInfo);
    }

    const weekdayBucket = weekdayMap.get(dayInfo.weekday);
    if (weekdayBucket) {
      weekdayBucket.total += 1;
      if (
        reservation.visitType === "初診" ||
        reservation.visitType === "再診"
      ) {
        weekdayBucket[reservation.visitType] += 1;
      }
      if (reservation.isSameDay) {
        weekdayBucket["当日予約"] += 1;
      }
      // 曜日ごとの日数を追跡
      weekdayDays.get(dayInfo.weekday)?.add(reservation.reservationDate);
    }

    let dayTypeBucket = dayTypeMap.get(dayInfo.dayType);
    if (!dayTypeBucket) {
      dayTypeBucket = { total: 0, 初診: 0, 再診: 0, days: new Set<string>() };
      dayTypeMap.set(dayInfo.dayType, dayTypeBucket);
    }
    dayTypeBucket.total += 1;
    dayTypeBucket.days.add(reservation.reservationDate);
    if (reservation.visitType === "初診" || reservation.visitType === "再診") {
      dayTypeBucket[reservation.visitType] += 1;
    }
  }

  const weekdayData = weekdayOrder.map((weekday) => {
    const bucket = weekdayMap.get(weekday)!;
    const dayCount = weekdayDays.get(weekday)?.size ?? 0;
    bucket.dayCount = dayCount;
    bucket.avgPerDay = dayCount > 0 ? bucket.total / dayCount : 0;
    return bucket;
  });

  const dayTypeData: DayTypeBucket[] = Array.from(dayTypeMap.entries())
    .filter(([, data]) => data.total > 0)
    .map(([dayType, data]) => ({
      dayType,
      total: data.total,
      初診: data["初診"],
      再診: data["再診"],
      avgPerDay: data.days.size === 0 ? 0 : data.total / data.days.size,
    }))
    .sort((a, b) => b.total - a.total);

  const departmentHourlyList = Array.from(departmentHourlyMap.values());

  const overallDaily: DailyBucket[] = Array.from(overallDailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total }));

  return {
    totals: {
      totalReservations: reservations.length,
      initialCount,
      followupCount,
      departmentCount: departmentSet.size,
    },
    weekdayData,
    dayTypeData,
    departmentHourlyList,
    departmentHourlyMap,
    overallHourly,
    overallDaily,
  };
};

const formatMonthLabel = (month: string) => {
  const [year, monthStr] = month.split("-");
  if (!year || !monthStr) {
    return month;
  }
  const numericMonth = Number(monthStr);
  if (Number.isNaN(numericMonth)) {
    return month;
  }
  return `${year}年${numericMonth}月`;
};

type SectionCardProps = {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
};

const SectionCard = memo(
  ({ title, description, action, children }: SectionCardProps) => (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft sm:rounded-3xl sm:p-6">
      <header className="mb-3 flex flex-col gap-2 sm:mb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
            {title}
          </h2>
          {description && (
            <p className="text-xs leading-relaxed text-slate-500 sm:text-sm">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="sm:pt-1">{children}</div>
    </section>
  ),
);

SectionCard.displayName = "SectionCard";

const RES_STAT_TONE_TEXT: Record<"brand" | "accent" | "muted" | "emerald", string> = {
  brand: "text-brand-600",
  accent: "text-accent-600",
  emerald: "text-emerald-600",
  muted: "text-slate-600",
};

const RES_STAT_TONE_CARD: Record<"brand" | "accent" | "muted" | "emerald", string> = {
  brand:
    "border-brand-200 bg-gradient-to-br from-brand-50/90 via-white to-white shadow-[0_16px_30px_-18px_rgba(59,130,246,0.45)]",
  accent:
    "border-accent-200 bg-gradient-to-br from-accent-50/90 via-white to-white shadow-[0_16px_30px_-18px_rgba(244,114,182,0.45)]",
  emerald:
    "border-emerald-200 bg-gradient-to-br from-emerald-50/90 via-white to-white shadow-[0_16px_30px_-18px_rgba(16,185,129,0.45)]",
  muted:
    "border-slate-200 bg-gradient-to-br from-slate-50/90 via-white to-white shadow-[0_16px_30px_-18px_rgba(100,116,139,0.35)]",
};

const StatCard = memo(
  ({
    label,
    value,
    tone,
  }: {
    label: string;
    value: string;
    tone: "brand" | "accent" | "muted" | "emerald";
  }) => {
    const toneClass = RES_STAT_TONE_TEXT[tone];
    const cardClass = RES_STAT_TONE_CARD[tone];

    return (
      <div
        className={`rounded-3xl border ${cardClass} p-5 text-left transition-transform duration-200 hover:-translate-y-0.5 sm:p-6`}
      >
        <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 sm:text-xs">
          {label}
        </dt>
        <dd
          className={`mt-3 text-3xl font-extrabold leading-tight sm:text-[32px] ${toneClass}`}
        >
          {value}
        </dd>
      </div>
    );
  },
);

StatCard.displayName = "StatCard";

export default function HomePage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isLoadingShared, setIsLoadingShared] = useState(false);
  const [diffMonthly, setDiffMonthly] = useState<MonthlyBucket[] | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [showWeekdayChart, setShowWeekdayChart] = useState(false);
  const [showHourlyChart, setShowHourlyChart] = useState(false);
  const [showDailyChart, setShowDailyChart] = useState(false);
  const [showMonthlyChart, setShowMonthlyChart] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState<string>("全体");
  const [showAllDepartments, setShowAllDepartments] = useState(false);
  const fallbackAppliedRef = useRef(false);

  const applySharedPayload = useCallback(
    (payload: unknown, uploadedAt?: string): boolean => {
      const fallbackTimestamp = uploadedAt ?? new Date().toISOString();

      if (Array.isArray(payload)) {
        const reservationsData = payload as Reservation[];
        const timestamp = saveReservationsToStorage(
          reservationsData,
          fallbackTimestamp,
        );
        clearReservationDiff();
        setReservations(reservationsData);
        setDiffMonthly(null);
        setLastUpdated(timestamp);
        setUploadError(null);
        return true;
      }

      if (
        payload &&
        typeof payload === "object" &&
        Array.isArray((payload as SharedDataBundle).karteRecords)
      ) {
        const bundle = payload as SharedDataBundle;

        if (Array.isArray(bundle.karteRecords)) {
          const karteTimestamp = bundle.karteTimestamp ?? fallbackTimestamp;
          if (typeof window !== "undefined") {
            try {
              setCompressedItem(
                KARTE_STORAGE_KEY,
                JSON.stringify(bundle.karteRecords),
              );
              window.localStorage.setItem(KARTE_TIMESTAMP_KEY, karteTimestamp);
            } catch (error) {
              console.error(error);
            }
          }
        }

        if (Array.isArray(bundle.surveyData)) {
          saveSurveyDataToStorage(
            bundle.surveyData,
            bundle.surveyTimestamp ?? fallbackTimestamp,
          );
        }

        if (Array.isArray(bundle.listingData)) {
          saveListingDataToStorage(
            bundle.listingData,
            bundle.listingTimestamp ?? fallbackTimestamp,
          );
        }

        if (Array.isArray(bundle.reservations)) {
          const reservationsData = bundle.reservations as Reservation[];
          const reservationsTimestamp = saveReservationsToStorage(
            reservationsData,
            bundle.reservationsTimestamp ?? fallbackTimestamp,
          );
          clearReservationDiff();
          setReservations(reservationsData);
          setDiffMonthly(null);
          setLastUpdated(reservationsTimestamp);
          setUploadError(null);
          return true;
        }

        return false;
      }

      return false;
    },
    [],
  );

  const loadFallbackFromParams = useCallback(() => {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      const params = new URLSearchParams(window.location.search);
      const fallback = params.get("fallback");
      if (!fallback) {
        return false;
      }
      const decoded = decodeFromShare(fallback);
      if (!decoded) {
        return false;
      }
      const parsed = JSON.parse(decoded);
      return applySharedPayload(parsed, new Date().toISOString());
    } catch (error) {
      console.error(error);
      return false;
    }
  }, [applySharedPayload]);

  // URLパラメータからデータを読み込む
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const dataId = params.get("data");
    setIsReadOnly(Boolean(dataId));

    if (!fallbackAppliedRef.current) {
      const initialFallback = loadFallbackFromParams();
      if (initialFallback) {
        fallbackAppliedRef.current = true;
      }
    }

    if (dataId) {
      setIsLoadingShared(true);
      const ensureFallback = () => {
        if (fallbackAppliedRef.current) {
          return true;
        }
        const fallbackResult = loadFallbackFromParams();
        if (fallbackResult) {
          fallbackAppliedRef.current = true;
        }
        return fallbackResult;
      };

      const applyRawPayload = (rawData: string, uploadedAt?: string) => {
        const decodeToJson = (text: string): unknown | null => {
          try {
            return JSON.parse(text);
          } catch (error) {
            void error;
            return null;
          }
        };

        const tryDecode = (input: string): unknown | null => {
          let parsed = decodeToJson(input);
          if (parsed) {
            return parsed;
          }

          const base64Decoded = decodeFromShare(input);
          if (base64Decoded) {
            parsed = decodeToJson(base64Decoded);
            if (parsed) {
              return parsed;
            }

            if (typeof window !== "undefined") {
              try {
                const binary = window.atob(input);
                const bytes = new Uint8Array(binary.length);
                for (let index = 0; index < binary.length; index += 1) {
                  bytes[index] = binary.charCodeAt(index);
                }
                const inflated = inflate(bytes, { to: "string" }) as string;
                const jsonFromInflated = decodeToJson(inflated);
                if (jsonFromInflated) {
                  return jsonFromInflated;
                }
              } catch (error) {
                console.warn("共有データの展開に失敗しました", error);
              }
            }
          }

          return null;
        };

        const parsed = tryDecode(rawData);
        if (!parsed) {
          return false;
        }

        if (Array.isArray(parsed)) {
          const timestamp = uploadedAt ?? new Date().toISOString();
          const reservationsArray = parsed as Reservation[];
          saveReservationsToStorage(reservationsArray, timestamp);
          clearReservationDiff();
          setReservations(reservationsArray);
          setDiffMonthly(null);
          setLastUpdated(timestamp);
          setUploadError(null);
          fallbackAppliedRef.current = true;
          return true;
        }

        if (
          parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as SharedDataBundle).reservations)
        ) {
          const applied = applySharedPayload(parsed, uploadedAt);
          if (applied) {
            fallbackAppliedRef.current = true;
          }
          return applied;
        }

        return false;
      };

      fetchDataFromR2(dataId)
        .then((response) => {
          if (response.type === "reservation") {
            const applied =
              applyRawPayload(response.data, response.uploadedAt) ||
              ensureFallback();
            if (!applied) {
              setUploadError("共有データの読み込みに失敗しました。");
            }
          } else if (response.type === "karte") {
            try {
              const parsed = JSON.parse(response.data);
              if (
                !applySharedPayload(parsed, response.uploadedAt) &&
                !ensureFallback()
              ) {
                setUploadError("共有データの読み込みに失敗しました。");
              }
            } catch (error) {
              console.error(error);
              if (!ensureFallback()) {
                setUploadError("共有データの読み込みに失敗しました。");
              }
            }
          } else if (!ensureFallback()) {
            setUploadError("未対応の共有データ形式です。");
          }
        })
        .catch((error) => {
          console.error(error);
          const message = `共有データの読み込みに失敗しました: ${(error as Error).message}`;
          if (!ensureFallback()) {
            setUploadError(message);
          }
        })
        .finally(() => {
          setIsLoadingShared(false);
        });
    } else {
      // ローカルストレージから読み込み
      try {
        const stored = loadReservationsFromStorage();
        if (stored.length > 0) {
          setReservations(stored);
        }
        const storedTimestamp = loadReservationTimestamp();
        if (storedTimestamp) {
          setLastUpdated(storedTimestamp);
        }
        const diffRecords = loadReservationDiff();
        setDiffMonthly(
          diffRecords.length > 0 ? aggregateMonthly(diffRecords) : null,
        );
      } catch (error) {
        console.error(error);
        setUploadError("保存済みデータの読み込みに失敗しました。");
      }
    }
  }, [applySharedPayload, loadFallbackFromParams]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === RESERVATION_STORAGE_KEY ||
        event.key === RESERVATION_DIFF_STORAGE_KEY
      ) {
        const stored = loadReservationsFromStorage();
        if (stored.length > 0) {
          setReservations(stored);
        }
        const timestamp = loadReservationTimestamp();
        if (timestamp) {
          setLastUpdated(timestamp);
        }
        const diffRecords = loadReservationDiff();
        setDiffMonthly(
          diffRecords.length > 0 ? aggregateMonthly(diffRecords) : null,
        );
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const availableMonths = useMemo(() => {
    const months = new Set(reservations.map((r) => r.reservationMonth));
    return Array.from(months).sort();
  }, [reservations]);

  const {
    startMonth,
    endMonth,
    setStartMonth,
    setEndMonth,
    resetPeriod,
  } = useAnalysisPeriodRange(availableMonths);

  const filteredReservations = useMemo(() => {
    let filtered = reservations;

    if (startMonth && endMonth) {
      filtered = filtered.filter(
        (r) => r.reservationMonth >= startMonth && r.reservationMonth <= endMonth
      );
    } else if (startMonth) {
      filtered = filtered.filter((r) => r.reservationMonth >= startMonth);
    } else if (endMonth) {
      filtered = filtered.filter((r) => r.reservationMonth <= endMonth);
    }

    return filtered;
  }, [reservations, startMonth, endMonth]);

  const reservationRangeLabel = useMemo(() => {
    if (startMonth && endMonth) {
      if (startMonth === endMonth) {
        return formatMonthLabel(startMonth);
      }
      return `${formatMonthLabel(startMonth)}〜${formatMonthLabel(endMonth)}`;
    }
    if (startMonth) {
      return `${formatMonthLabel(startMonth)}以降`;
    }
    if (endMonth) {
      return `${formatMonthLabel(endMonth)}まで`;
    }
    return "全期間";
  }, [endMonth, startMonth]);

  useEffect(() => {
    setAnalysisPeriodLabel(reservationRangeLabel);
  }, [reservationRangeLabel]);

  const aggregatedInsights = useMemo(
    () => aggregateReservationInsights(filteredReservations),
    [filteredReservations],
  );

  const {
    totals: { totalReservations, initialCount, followupCount, departmentCount },
    weekdayData,
    dayTypeData,
    departmentHourlyList,
    departmentHourlyMap,
    overallHourly,
    overallDaily,
  } = aggregatedInsights;

  const dayTypeSummary = useMemo(() => {
    if (dayTypeData.length === 0) {
      return { overall: 0, maxAvg: 0 };
    }
    const overall = dayTypeData.reduce((sum, item) => sum + item.total, 0);
    const maxAvg = dayTypeData.reduce(
      (max, item) => (item.avgPerDay > max ? item.avgPerDay : max),
      0,
    );
    return { overall, maxAvg };
  }, [dayTypeData]);

  const sortedDepartmentHourly = useMemo(() => {
    const base = [...departmentHourlyList];
    base.sort((a, b) => {
      const priorityDiff =
        getPriority(a.department) - getPriority(b.department);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      const diff = b.total - a.total;
      if (diff !== 0) {
        return diff;
      }
      return a.department.localeCompare(b.department, "ja");
    });
    return base;
  }, [departmentHourlyList]);

  const emptyHourlyBuckets = useMemo(() => createEmptyHourlyBuckets(), []);

  const departmentSpecificHourly = useMemo(() => {
    if (selectedDepartment === "全体") {
      return overallHourly;
    }
    return (
      departmentHourlyMap.get(selectedDepartment)?.data ?? emptyHourlyBuckets
    );
  }, [
    selectedDepartment,
    overallHourly,
    departmentHourlyMap,
    emptyHourlyBuckets,
  ]);

  const INITIAL_DISPLAY_COUNT = 8;
  const displayedDepartmentButtons = useMemo(() => {
    if (showAllDepartments) {
      return sortedDepartmentHourly;
    }
    return sortedDepartmentHourly.slice(0, INITIAL_DISPLAY_COUNT);
  }, [sortedDepartmentHourly, showAllDepartments]);

  const monthlyOverview = useMemo(
    () => aggregateMonthly(filteredReservations),
    [filteredReservations],
  );

  // データを共有URLとして発行
  const handleShare = useCallback(async () => {
    if (reservations.length === 0) {
      setUploadError("共有するデータがありません。");
      return;
    }

    setIsSharing(true);
    setUploadError(null);

    try {
      const generatedAt = new Date().toISOString();
      const bundle: SharedDataBundle = {
        version: 1,
        generatedAt,
        karteRecords: [],
        reservations,
        reservationsTimestamp: lastUpdated ?? generatedAt,
      };
      const serializedBundle = JSON.stringify(bundle);

      const response = await uploadDataToR2({
        type: "reservation",
        data: serializedBundle,
      });

      const fallbackPayload = encodeForShare(serializedBundle);
      const finalUrl = buildShareUrl(response.url, response.id, fallbackPayload);

      setShareUrl(finalUrl);
      await navigator.clipboard.writeText(finalUrl);
      alert(`共有URLをクリップボードにコピーしました！\n\n${finalUrl}`);
    } catch (error) {
      console.error(error);
      setUploadError(
        `共有URLの生成に失敗しました: ${(error as Error).message}`,
      );
    } finally {
      setIsSharing(false);
    }
  }, [reservations, lastUpdated]);

  const handleReset = useCallback(() => {
    clearReservationsStorage();
    clearReservationDiff();
    setReservations([]);
    setDiffMonthly(null);
    setLastUpdated(null);
    setShareUrl(null);
    setUploadError(null);
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
        <section className="relative overflow-hidden rounded-3xl border border-indigo-200 bg-gradient-to-br from-white via-indigo-50 to-sky-100 p-8 shadow-card">
          <div className="pointer-events-none absolute -right-16 top-0 h-48 w-48 rounded-full bg-gradient-to-br from-indigo-200/50 via-sky-200/40 to-purple-200/40 blur-3xl" />
          <div className="pointer-events-none absolute -left-20 bottom-0 h-52 w-52 rounded-full bg-gradient-to-br from-sky-200/45 via-emerald-200/30 to-white/0 blur-3xl" />
          <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-brand-600">
                Reservation Insights Dashboard
              </p>
              <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">
                予約分析
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                予約ログCSVをアップロードすると、受付時刻を基準に初診・再診や診療科別の傾向を自動集計します。曜日や日付タイプ、期間フィルターを切り替えて複数の視点から比較し、最新アップロードとの差分も追跡できます。
              </p>
              <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 sm:p-5">
                <p className="mb-2 text-sm font-semibold text-blue-900">
                  📊 ダッシュボードのみどころ
                </p>
                <ul className="space-y-1 text-sm leading-relaxed text-blue-800">
                  <li>
                    • <strong>曜日別／日付タイプ別</strong>:
                    平日・土曜・日曜・祝日の傾向を比較。
                  </li>
                  <li>
                    • <strong>時間帯別グラフ</strong>:
                    0時〜23時の受付集中帯と初診・再診の内訳を可視化。
                  </li>
                  <li>
                    • <strong>日別・月次サマリ</strong>:
                    期間全体の推移と最新アップロードとの差分を一覧表示。
                  </li>
                  <li>
                    • <strong>診療科カード</strong>:
                    ドラッグで順番を変えながら各診療科のピーク時間をチェック。
                  </li>
                </ul>
                <p className="mt-3 text-xs text-indigo-700 sm:text-[13px]">
                  スマホでは横スクロールやピンチアウトでグラフを拡大できます。
                </p>
              </div>
              {isReadOnly && (
                <p className="rounded-2xl border border-dashed border-brand-300 bg-white/80 px-4 py-3 text-sm font-medium text-brand-700">
                  共有URLから閲覧中です。閲覧者が操作すると共有データにも反映されるため取り扱いにご注意ください。
                </p>
              )}
            </div>
            <p className="text-xs text-slate-500">
              CSVのアップロードや共有操作はページ下部の「データ管理」セクションから行えます。
            </p>
          </div>
          {isLoadingShared && (
            <div className="mt-6 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3">
              <p className="flex items-center gap-2 text-sm text-brand-700">
                <RefreshCw className="h-4 w-4 animate-spin" />
                共有データを読み込んでいます...
              </p>
            </div>
          )}
          {lastUpdated && (
            <p className="mt-6 text-xs font-medium text-slate-500">
              最終更新: {new Date(lastUpdated).toLocaleString("ja-JP")}
            </p>
          )}
        </section>

        <AnalysisFilterPortal
          months={availableMonths}
          startMonth={startMonth}
          endMonth={endMonth}
          onChangeStart={setStartMonth}
          onChangeEnd={setEndMonth}
          onReset={resetPeriod}
          label={reservationRangeLabel}
          renderMonthLabel={formatMonthLabel}
        />

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={
              startMonth && endMonth
                ? startMonth === endMonth
                  ? `${formatMonthLabel(startMonth)} 総予約数`
                  : `${formatMonthLabel(startMonth)}〜${formatMonthLabel(endMonth)} 総予約数`
                : "総予約数"
            }
            value={`${totalReservations.toLocaleString("ja-JP")}件`}
            tone="brand"
          />
          <StatCard
            label={
              startMonth && endMonth
                ? startMonth === endMonth
                  ? `${formatMonthLabel(startMonth)} 初診`
                  : `${formatMonthLabel(startMonth)}〜${formatMonthLabel(endMonth)} 初診`
                : "初診"
            }
            value={`${initialCount.toLocaleString("ja-JP")}件`}
            tone="emerald"
          />
          <StatCard
            label={
              startMonth && endMonth
                ? startMonth === endMonth
                  ? `${formatMonthLabel(startMonth)} 再診`
                  : `${formatMonthLabel(startMonth)}〜${formatMonthLabel(endMonth)} 再診`
                : "再診"
            }
            value={`${followupCount.toLocaleString("ja-JP")}件`}
            tone="accent"
          />
          <StatCard
            label={
              startMonth && endMonth
                ? startMonth === endMonth
                  ? `${formatMonthLabel(startMonth)} 診療科数`
                  : `${formatMonthLabel(startMonth)}〜${formatMonthLabel(endMonth)} 診療科数`
                : "診療科数"
            }
            value={`${departmentCount.toLocaleString("ja-JP")}科`}
            tone="muted"
          />
        </section>

        <SectionCard
          title={
            startMonth && endMonth
              ? startMonth === endMonth
                ? `曜日別 予約傾向（${formatMonthLabel(startMonth)}）`
                : `曜日別 予約傾向（${formatMonthLabel(startMonth)}〜${formatMonthLabel(endMonth)}）`
              : "曜日別 予約傾向"
          }
          description="曜日ごとの1日あたり平均予約件数を表示しています。"
        >
          {!showWeekdayChart ? (
            <button
              onClick={() => setShowWeekdayChart(true)}
              className="w-full py-8 px-4 rounded-xl border-2 border-dashed border-slate-200 hover:border-brand-400 hover:bg-brand-50/30 transition text-slate-600 hover:text-brand-600 font-medium"
            >
              📊 クリックでグラフを表示
            </button>
          ) : (
            <Suspense
              fallback={
                <div className="h-[280px] sm:h-[340px] md:h-[380px] flex items-center justify-center text-slate-500">
                  読み込み中...
                </div>
              }
            >
              <WeekdayChartSection weekdayData={weekdayData} />
            </Suspense>
          )}
        </SectionCard>

        <SectionCard
          title={
            startMonth && endMonth
              ? startMonth === endMonth
                ? `日付タイプ別 予約傾向（${formatMonthLabel(startMonth)}）`
                : `日付タイプ別 予約傾向（${formatMonthLabel(startMonth)}〜${formatMonthLabel(endMonth)}）`
              : "日付タイプ別 予約傾向"
          }
          description="平日・土曜・日曜・祝日の4分類で予約パターンを表示しています。"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2">日付タイプ</th>
                  <th className="px-4 py-2">総数</th>
                  <th className="px-4 py-2">初診</th>
                  <th className="px-4 py-2">再診</th>
                  <th className="px-4 py-2">1日平均</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dayTypeData.map((row) => {
                  const share =
                    dayTypeSummary.overall > 0
                      ? Math.round((row.total / dayTypeSummary.overall) * 1000) / 10
                      : 0;
                  const initialRate =
                    row.total > 0
                      ? Math.round((row["初診"] / row.total) * 1000) / 10
                      : 0;
                  const revisitRate =
                    row.total > 0
                      ? Math.round((row["再診"] / row.total) * 1000) / 10
                      : 0;
                  const isTop =
                    dayTypeSummary.maxAvg > 0 && row.avgPerDay === dayTypeSummary.maxAvg;
                  return (
                    <tr
                      key={row.dayType}
                      className={`transition-colors duration-150 hover:bg-indigo-50/40 ${
                        isTop ? "bg-indigo-50/60" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-semibold text-slate-900">
                          {isTop && (
                            <span className="inline-flex items-center rounded-full bg-indigo-500 px-2 py-[2px] text-[10px] font-semibold text-white">
                              TOP
                            </span>
                          )}
                          <span>{row.dayType}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">全体比 {share.toFixed(1)}%</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-indigo-500/10 px-3 py-1 text-sm font-semibold text-indigo-700">
                          {row.total.toLocaleString("ja-JP")}件
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-end gap-1">
                          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 text-sm font-semibold text-emerald-700">
                            {row["初診"].toLocaleString("ja-JP")}件
                          </span>
                          <span className="text-[11px] text-emerald-600">{initialRate.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-end gap-1">
                          <span className="inline-flex items-center rounded-full bg-rose-500/10 px-3 py-1 text-sm font-semibold text-rose-700">
                            {row["再診"].toLocaleString("ja-JP")}件
                          </span>
                          <span className="text-[11px] text-rose-600">{revisitRate.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${
                            isTop
                              ? "bg-indigo-500 text-white"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {row.avgPerDay.toFixed(1)}件/日
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {dayTypeData.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      集計対象のデータがありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard
          title={
            startMonth && endMonth
              ? startMonth === endMonth
                ? `時間帯別 予約数（${formatMonthLabel(startMonth)}）`
                : `時間帯別 予約数（${formatMonthLabel(startMonth)}〜${formatMonthLabel(endMonth)}）`
              : "時間帯別 予約数（受付基準）"
          }
          description="1時間単位で予約受付が集中する時間帯を診療科別に表示しています。"
        >
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold text-slate-700">
              診療科:
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedDepartment("全体")}
                className={`rounded-xl px-5 py-2.5 text-sm font-bold transition-all shadow-md ${
                  selectedDepartment === "全体"
                    ? "bg-gradient-to-r from-brand-500 to-brand-600 text-white scale-105 shadow-lg ring-2 ring-brand-300"
                    : "bg-white text-slate-700 hover:bg-brand-50 hover:shadow-lg hover:scale-105"
                } border-2 border-slate-200`}
              >
                全体
              </button>
              {displayedDepartmentButtons.map(({ department }) => (
                <button
                  key={department}
                  onClick={() => setSelectedDepartment(department)}
                  className={`rounded-xl px-5 py-2.5 text-sm font-bold transition-all shadow-md ${
                    selectedDepartment === department
                      ? "bg-gradient-to-r from-brand-500 to-brand-600 text-white scale-105 shadow-lg ring-2 ring-brand-300"
                      : "bg-white text-slate-700 hover:bg-brand-50 hover:shadow-lg hover:scale-105"
                  } border-2 border-slate-200`}
                >
                  {department}
                </button>
              ))}
              {sortedDepartmentHourly.length > INITIAL_DISPLAY_COUNT && (
                <button
                  onClick={() => setShowAllDepartments(!showAllDepartments)}
                  className="rounded-xl px-4 py-2.5 text-sm font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 transition-colors border-2 border-brand-200"
                >
                  {showAllDepartments
                    ? "▲ 閉じる"
                    : `▼ 他${sortedDepartmentHourly.length - INITIAL_DISPLAY_COUNT}件を表示`}
                </button>
              )}
            </div>
          </div>
          {!showHourlyChart ? (
            <button
              onClick={() => setShowHourlyChart(true)}
              className="w-full py-8 px-4 rounded-xl border-2 border-dashed border-slate-200 hover:border-brand-400 hover:bg-brand-50/30 transition text-slate-600 hover:text-brand-600 font-medium"
            >
              📊 クリックでグラフを表示
            </button>
          ) : (
            <Suspense
              fallback={
                <div className="h-[280px] sm:h-[340px] md:h-[380px] flex items-center justify-center text-slate-500">
                  読み込み中...
                </div>
              }
            >
              <HourlyChartSection hourlyData={departmentSpecificHourly} />
            </Suspense>
          )}
        </SectionCard>

        <SectionCard
          title={
            startMonth && endMonth
              ? startMonth === endMonth
                ? `日別 予約推移（${formatMonthLabel(startMonth)}）`
                : `日別 予約推移（${formatMonthLabel(startMonth)}〜${formatMonthLabel(endMonth)}）`
              : "日別 予約推移（受付基準）"
          }
          description="日ごとの予約受付件数の推移を確認できます。"
        >
          {!showDailyChart ? (
            <button
              onClick={() => setShowDailyChart(true)}
              className="w-full py-8 px-4 rounded-xl border-2 border-dashed border-slate-200 hover:border-brand-400 hover:bg-brand-50/30 transition text-slate-600 hover:text-brand-600 font-medium"
            >
              📊 クリックでグラフを表示
            </button>
          ) : (
            <Suspense
              fallback={
                <div className="h-[240px] sm:h-72 flex items-center justify-center text-slate-500">
                  読み込み中...
                </div>
              }
            >
              <DailyChartSection dailyData={overallDaily} />
            </Suspense>
          )}
        </SectionCard>

        <SectionCard
          title={startMonth && endMonth && startMonth !== endMonth
            ? `月次サマリ（${formatMonthLabel(startMonth)}〜${formatMonthLabel(endMonth)}）`
            : "月次サマリ（受付基準）"
          }
          description="CSVに含まれる予約受付データを月単位で集計しています。"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">月</th>
                  <th className="px-3 py-2">総数</th>
                  <th className="px-3 py-2">初診</th>
                  <th className="px-3 py-2">再診</th>
                  <th className="px-3 py-2">当日予約</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {monthlyOverview.map((row) => (
                  <tr key={row.month} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {formatMonthLabel(row.month)}
                    </td>
                    <td className="px-3 py-2">
                      {row.total.toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      {row["初診"].toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      {row["再診"].toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      {row["当日予約"].toLocaleString("ja-JP")}
                    </td>
                  </tr>
                ))}
                {monthlyOverview.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      集計対象のデータがありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {monthlyOverview.length > 0 && (
            <>
              <button
                onClick={() => setShowMonthlyChart(!showMonthlyChart)}
                className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                {showMonthlyChart ? "グラフを非表示" : "グラフを表示"}
              </button>
              {showMonthlyChart && (
                <Suspense
                  fallback={
                    <div className="h-[400px] flex items-center justify-center text-slate-500">
                      読み込み中...
                    </div>
                  }
                >
                  <div className="mt-4">
                    <MonthlyTrendChart monthlyData={monthlyOverview} />
                  </div>
                </Suspense>
              )}
            </>
          )}
        </SectionCard>

        <SectionCard
          title="マップ分析"
          description="地図上で来院エリアを確認するには、専用ページを開いてください。"
        >
          <div className="flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-6 text-sm text-slate-700">
            <p>
              最新のフィルター条件（期間: {reservationRangeLabel}）に基づくデータをもとに、
              診療科・年代別の来院傾向を地図上に表示できます。
            </p>
            <div>
              <Link
                href="/map-analysis"
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
              >
                マップ分析を開く
                <LinkIcon className="h-4 w-4" />
              </Link>
            </div>
            <p className="text-xs text-indigo-700">
              マップ分析ページはクライアント側で処理されます。通信環境によっては表示まで時間がかかる場合があります。
            </p>
          </div>
        </SectionCard>

        {diffMonthly && diffMonthly.length > 0 && (
          <SectionCard
            title="最新アップロードの差分"
            description="直近で追加された予約受付のみを月単位でハイライト表示します。"
          >
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">月</th>
                    <th className="px-3 py-2">総数</th>
                    <th className="px-3 py-2">初診</th>
                    <th className="px-3 py-2">再診</th>
                    <th className="px-3 py-2">当日予約</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {diffMonthly.map((row) => (
                    <tr key={row.month} className="hover:bg-emerald-50/60">
                      <td className="px-3 py-2 font-medium text-emerald-700">
                        {formatMonthLabel(row.month)}
                      </td>
                      <td className="px-3 py-2">
                        {row.total.toLocaleString("ja-JP")}
                      </td>
                      <td className="px-3 py-2">
                        {row["初診"].toLocaleString("ja-JP")}
                      </td>
                      <td className="px-3 py-2">
                        {row["再診"].toLocaleString("ja-JP")}
                      </td>
                      <td className="px-3 py-2">
                        {row["当日予約"].toLocaleString("ja-JP")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        <SectionCard
          title="データ管理"
          description="予約CSVの共有URL発行と保存データの管理を行います。取り込みは患者分析ページに集約されています。"
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              {isReadOnly
                ? "共有URLから閲覧中です。操作内容は公開データに即時反映されるため取り扱いにご注意ください。"
                : "必要時のみCSVを差し替え、共有URLは安全な場所に保管してください。"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex w-full flex-col gap-1 rounded-2xl border border-dashed border-brand-200 bg-white/80 px-4 py-3 text-xs text-brand-700 sm:w-[260px]">
                <span className="font-semibold text-brand-600">
                  CSVアップロード窓口
                </span>
                <p className="leading-relaxed">
                  予約ログCSVは「患者分析（カルテ集計）」ページ下部のデータ管理から登録してください。
                  保存後にこのページを開くと自動で反映されます。
                </p>
              </div>
              <button
                type="button"
                onClick={handleShare}
                disabled={isSharing || reservations.length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-full border border-brand-200 px-4 py-2 text-xs font-semibold text-brand-600 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {isSharing ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Share2 className="h-4 w-4" />
                    共有URLを発行
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={reservations.length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <RefreshCw className="h-4 w-4" />
                保存内容をリセット
              </button>
            </div>
            {shareUrl && (
              <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
                <p className="flex items-center gap-2 text-xs text-green-700">
                  <LinkIcon className="h-4 w-4" />
                  共有URL:{" "}
                  <code className="rounded bg-white px-2 py-1">{shareUrl}</code>
                </p>
              </div>
            )}
            {uploadError && (
              <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                {uploadError}
              </p>
            )}
          </div>
        </SectionCard>
      </div>
    </main>
  );
}
