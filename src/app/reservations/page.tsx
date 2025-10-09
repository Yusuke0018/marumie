"use client";

import { useCallback, useEffect, useMemo, useState, memo, lazy, Suspense } from "react";
import { RefreshCw, Share2, Link as LinkIcon } from "lucide-react";
import { uploadDataToR2, fetchDataFromR2 } from "@/lib/dataShare";
import { getDayType, getWeekdayName, type PeriodType, filterByPeriod } from "@/lib/dateUtils";
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

// グラフコンポーネントをReact.lazyで遅延ロード（初期バンドルサイズを削減）
const WeekdayChartSection = lazy(() =>
  import('@/components/reservations/WeekdayChartSection').then(m => ({ default: m.WeekdayChartSection }))
);
const HourlyChartSection = lazy(() =>
  import('@/components/reservations/HourlyChartSection').then(m => ({ default: m.HourlyChartSection }))
);
const DailyChartSection = lazy(() =>
  import('@/components/reservations/DailyChartSection').then(m => ({ default: m.DailyChartSection }))
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
      (normalized.includes(keywordNormalized) || keywordNormalized.includes(normalized))
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

const aggregateHourly = (reservations: Reservation[]): HourlyBucket[] => {
  const buckets = createEmptyHourlyBuckets();
  for (const reservation of reservations) {
    if (
      Number.isNaN(reservation.reservationHour) ||
      reservation.reservationHour < 0 ||
      reservation.reservationHour > 23
    ) {
      continue;
    }
    const bucket = buckets[reservation.reservationHour];
    if (!bucket) {
      continue;
    }
    bucket.total += 1;
    if (reservation.visitType === "初診" || reservation.visitType === "再診") {
      bucket[reservation.visitType] += 1;
    }
  }
  return buckets;
};

const aggregateDaily = (reservations: Reservation[]): DailyBucket[] => {
  const counts = new Map<string, number>();
  for (const reservation of reservations) {
    counts.set(
      reservation.reservationDate,
      (counts.get(reservation.reservationDate) ?? 0) + 1,
    );
  }

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total }));
};

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

  return Array.from(counts.values()).sort((a, b) => a.month.localeCompare(b.month));
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
};

type DayTypeBucket = {
  dayType: string;
  total: number;
  初診: number;
  再診: number;
  avgPerDay: number;
};

const aggregateByWeekday = (reservations: Reservation[]): WeekdayBucket[] => {
  const weekdays = ["日曜", "月曜", "火曜", "水曜", "木曜", "金曜", "土曜", "祝日"];
  const buckets = weekdays.map(weekday => ({
    weekday,
    total: 0,
    初診: 0,
    再診: 0,
    当日予約: 0,
  }));

  for (const reservation of reservations) {
    const dayType = getDayType(reservation.reservationDate);
    const weekdayName = dayType === "祝日" ? "祝日" : getWeekdayName(reservation.reservationDate);
    const bucket = buckets.find(b => b.weekday === weekdayName);
    if (!bucket) continue;

    bucket.total += 1;
    if (reservation.visitType === "初診" || reservation.visitType === "再診") {
      bucket[reservation.visitType] += 1;
    }
    if (reservation.isSameDay) {
      bucket["当日予約"] += 1;
    }
  }

  return buckets;
};

const aggregateByDayType = (reservations: Reservation[]): DayTypeBucket[] => {
  const dayTypeCounts = new Map<string, { total: number; 初診: number; 再診: number; days: Set<string> }>();

  for (const reservation of reservations) {
    const dayType = getDayType(reservation.reservationDate);
    
    if (!dayTypeCounts.has(dayType)) {
      dayTypeCounts.set(dayType, { total: 0, 初診: 0, 再診: 0, days: new Set() });
    }
    
    const bucket = dayTypeCounts.get(dayType)!;
    bucket.total += 1;
    bucket.days.add(reservation.reservationDate);
    
    if (reservation.visitType === "初診" || reservation.visitType === "再診") {
      bucket[reservation.visitType] += 1;
    }
  }

  return Array.from(dayTypeCounts.entries()).map(([dayType, data]) => ({
    dayType,
    total: data.total,
    初診: data["初診"],
    再診: data["再診"],
    avgPerDay: data.total / data.days.size,
  })).sort((a, b) => b.total - a.total);
};

const aggregateDepartmentHourly = (
  reservations: Reservation[],
): DepartmentHourly[] => {
  const byDepartment = new Map<string, HourlyBucket[]>();
  const totals = new Map<string, number>();

  for (const reservation of reservations) {
    if (!byDepartment.has(reservation.department)) {
      byDepartment.set(reservation.department, createEmptyHourlyBuckets());
    }
    const buckets = byDepartment.get(reservation.department);
    if (!buckets) {
      continue;
    }
    if (
      Number.isNaN(reservation.reservationHour) ||
      reservation.reservationHour < 0 ||
      reservation.reservationHour > 23
    ) {
      continue;
    }
    const bucket = buckets[reservation.reservationHour];
    if (!bucket) {
      continue;
    }
    bucket.total += 1;
    if (reservation.visitType === "初診" || reservation.visitType === "再診") {
      bucket[reservation.visitType] += 1;
    }
    totals.set(
      reservation.department,
      (totals.get(reservation.department) ?? 0) + 1,
    );
  }

  return Array.from(byDepartment.entries()).map(([department, data]) => ({
    department,
    data,
    total: totals.get(department) ?? 0,
  }));
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

const SectionCard = memo(({ title, description, action, children }: SectionCardProps) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft sm:rounded-3xl sm:p-6">
    <header className="mb-3 flex flex-col gap-2 sm:mb-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">{title}</h2>
        {description && <p className="text-xs leading-relaxed text-slate-500 sm:text-sm">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
    <div className="sm:pt-1">{children}</div>
  </section>
));

SectionCard.displayName = 'SectionCard';

const StatCard = memo(({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "brand" | "accent" | "muted" | "emerald";
}) => {
  const toneClass =
    tone === "brand"
      ? "text-brand-600"
      : tone === "accent"
        ? "text-accent-600"
        : tone === "emerald"
          ? "text-emerald-600"
          : "text-slate-900";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-card sm:p-4">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
        {label}
      </dt>
      <dd className={`mt-1 text-xl font-bold sm:mt-2 sm:text-2xl ${toneClass}`}>{value}</dd>
    </div>
  );
});

StatCard.displayName = 'StatCard';

export default function HomePage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isLoadingShared, setIsLoadingShared] = useState(false);
  const [diffMonthly, setDiffMonthly] = useState<MonthlyBucket[] | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>("all");
  const [showWeekdayChart, setShowWeekdayChart] = useState(false);
  const [showHourlyChart, setShowHourlyChart] = useState(false);
  const [showDailyChart, setShowDailyChart] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState<string>("全体");
  const [showAllDepartments, setShowAllDepartments] = useState(false);

  const applySharedPayload = useCallback(
    (payload: unknown, uploadedAt?: string): boolean => {
      const fallbackTimestamp = uploadedAt ?? new Date().toISOString();

      if (Array.isArray(payload)) {
        const reservationsData = payload as Reservation[];
        const timestamp = saveReservationsToStorage(reservationsData, fallbackTimestamp);
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
              window.localStorage.setItem(
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

    if (dataId) {
      setIsLoadingShared(true);
      fetchDataFromR2(dataId)
        .then((response) => {
          if (response.type === "reservation") {
            try {
              const parsed: Reservation[] = JSON.parse(response.data);
              setReservations(parsed);
              setLastUpdated(response.uploadedAt);
              saveReservationsToStorage(parsed, response.uploadedAt);
              clearReservationDiff();
            } catch (error) {
              console.error(error);
              if (!loadFallbackFromParams()) {
                setUploadError("共有データの読み込みに失敗しました。");
              }
            }
          } else if (response.type === "karte") {
            try {
              const parsed = JSON.parse(response.data);
              if (!applySharedPayload(parsed, response.uploadedAt) && !loadFallbackFromParams()) {
                setUploadError("共有データの読み込みに失敗しました。");
              }
            } catch (error) {
              console.error(error);
              if (!loadFallbackFromParams()) {
                setUploadError("共有データの読み込みに失敗しました。");
              }
            }
          } else if (!loadFallbackFromParams()) {
            setUploadError("未対応の共有データ形式です。");
          }
        })
        .catch((error) => {
          console.error(error);
          const message = `共有データの読み込みに失敗しました: ${(error as Error).message}`;
          if (!loadFallbackFromParams()) {
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
    const months = new Set(reservations.map(r => r.reservationMonth));
    return Array.from(months).sort();
  }, [reservations]);

  useEffect(() => {
    if (availableMonths.length === 0) {
      if (selectedMonth !== "" && selectedMonth !== "all") {
        setSelectedMonth("");
      }
      return;
    }

    const latestMonth = availableMonths[availableMonths.length - 1];
    if (!latestMonth) return;

    if (selectedMonth === "") {
      setSelectedMonth(latestMonth);
    } else if (selectedMonth !== "all" && !availableMonths.includes(selectedMonth)) {
      setSelectedMonth(latestMonth);
    }
  }, [availableMonths, selectedMonth]);

  const filteredReservations = useMemo(() => {
    let filtered = reservations;
    
    // 期間フィルター
    if (selectedPeriod !== "all") {
      filtered = filterByPeriod(filtered, selectedPeriod);
    }
    
    // 月フィルター
    if (selectedMonth !== "" && selectedMonth !== "all") {
      filtered = filtered.filter(r => r.reservationMonth === selectedMonth);
    }
    
    return filtered;
  }, [reservations, selectedMonth, selectedPeriod]);

  const departmentFilteredReservations = useMemo(() => {
    if (selectedDepartment === "全体") {
      return filteredReservations;
    }
    return filteredReservations.filter(r => r.department === selectedDepartment);
  }, [filteredReservations, selectedDepartment]);

  const departmentSpecificHourly = useMemo(
    () => aggregateHourly(departmentFilteredReservations),
    [departmentFilteredReservations],
  );

const overallDaily = useMemo(
    () => aggregateDaily(filteredReservations),
    [filteredReservations],
  );

  const sortedDepartmentHourly = useMemo(() => {
    const departmentHourly = aggregateDepartmentHourly(filteredReservations);
    const base = [...departmentHourly];
    base.sort((a, b) => {
      const priorityDiff = getPriority(a.department) - getPriority(b.department);
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
  }, [filteredReservations]);

  const INITIAL_DISPLAY_COUNT = 8;
  const displayedDepartmentButtons = useMemo(() => {
    if (showAllDepartments) {
      return sortedDepartmentHourly;
    }
    return sortedDepartmentHourly.slice(0, INITIAL_DISPLAY_COUNT);
  }, [sortedDepartmentHourly, showAllDepartments]);

const monthlyOverview = useMemo(
    () => aggregateMonthly(reservations),
    [reservations],
  );

  const { totalReservations, initialCount, followupCount, departmentCount } = useMemo(() => {
    let total = 0;
    let initial = 0;
    let followup = 0;
    const departments = new Set<string>();

    for (const item of filteredReservations) {
      total++;
      departments.add(item.department);
      if (item.visitType === "初診") {
        initial++;
      } else if (item.visitType === "再診") {
        followup++;
      }
    }

    return {
      totalReservations: total,
      initialCount: initial,
      followupCount: followup,
      departmentCount: departments.size,
    };
  }, [filteredReservations]);

  const weekdayData = useMemo(
    () => aggregateByWeekday(filteredReservations),
    [filteredReservations],
  );

  const dayTypeData = useMemo(
    () => aggregateByDayType(filteredReservations),
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
      const response = await uploadDataToR2({
        type: 'reservation',
        data: JSON.stringify(reservations),
      });

      const fallbackPayload = encodeForShare(JSON.stringify(reservations));
      const shareUrlObject = new URL(response.url);
      if (fallbackPayload) {
        shareUrlObject.searchParams.set('fallback', fallbackPayload);
      }
      const finalUrl = shareUrlObject.toString();

      setShareUrl(finalUrl);
      await navigator.clipboard.writeText(finalUrl);
      alert(`共有URLをクリップボードにコピーしました！\n\n${finalUrl}`);
    } catch (error) {
      console.error(error);
      setUploadError(`共有URLの生成に失敗しました: ${(error as Error).message}`);
    } finally {
      setIsSharing(false);
    }
  }, [reservations]);

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
        <section className="relative overflow-hidden rounded-3xl border border-brand-200 bg-gradient-to-r from-white via-brand-50 to-brand-100 p-8 shadow-card">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-brand-600">
                Team Mirai Analytics Suite
              </p>
              <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">
                マルミエ
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                予約ログCSVをアップロードすると、受付時刻を基準に初診・再診や診療科別の傾向を自動集計します。曜日や日付タイプ、期間フィルターを切り替えて複数の視点から比較し、最新アップロードとの差分も追跡できます。
              </p>
              <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 sm:p-5">
                <p className="mb-2 text-sm font-semibold text-blue-900">📊 ダッシュボードのみどころ</p>
                <ul className="space-y-1 text-sm leading-relaxed text-blue-800">
                  <li>• <strong>曜日別／日付タイプ別</strong>: 平日・土日・祝日・連休の傾向を比較。</li>
                  <li>• <strong>時間帯別グラフ</strong>: 0時〜23時の受付集中帯と初診・再診の内訳を可視化。</li>
                  <li>• <strong>日別・月次サマリ</strong>: 期間全体の推移と最新アップロードとの差分を一覧表示。</li>
                  <li>• <strong>診療科カード</strong>: ドラッグで順番を変えながら各診療科のピーク時間をチェック。</li>
                </ul>
                <p className="mt-3 text-xs text-blue-700 sm:text-[13px]">
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

        {reservations.length > 0 && (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-semibold text-slate-700">分析期間:</label>
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value as PeriodType)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none"
              >
                <option value="all">全期間</option>
                <option value="3months">直近3ヶ月</option>
                <option value="6months">直近6ヶ月</option>
                <option value="1year">直近1年</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-semibold text-slate-700">月別:</label>
                <select
                  value={selectedMonth === "" ? "all" : selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none"
                >
                <option value="all">全て</option>
                {availableMonths.map(month => (
                  <option key={month} value={month}>{month}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <StatCard
            label="総予約数"
            value={totalReservations.toLocaleString("ja-JP")}
            tone="brand"
          />
          <StatCard
            label="初診"
            value={initialCount.toLocaleString("ja-JP")}
            tone="brand"
          />
          <StatCard
            label="再診"
            value={followupCount.toLocaleString("ja-JP")}
            tone="accent"
          />
          <StatCard
            label="診療科数"
            value={departmentCount.toLocaleString("ja-JP")}
            tone="muted"
          />
        </section>

        <SectionCard
          title="曜日別 予約傾向"
          description="曜日ごとの予約件数の分布を表示しています。"
        >
          {!showWeekdayChart ? (
            <button
              onClick={() => setShowWeekdayChart(true)}
              className="w-full py-8 px-4 rounded-xl border-2 border-dashed border-slate-200 hover:border-brand-400 hover:bg-brand-50/30 transition text-slate-600 hover:text-brand-600 font-medium"
            >
              📊 クリックでグラフを表示
            </button>
          ) : (
            <Suspense fallback={<div className="h-[280px] sm:h-[340px] md:h-[380px] flex items-center justify-center text-slate-500">読み込み中...</div>}>
              <WeekdayChartSection weekdayData={weekdayData} />
            </Suspense>
          )}
        </SectionCard>

        <SectionCard
          title="日付タイプ別 予約傾向"
          description="平日・休日・祝日・連休など、日付のタイプごとの予約パターンを表示しています。"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">日付タイプ</th>
                  <th className="px-3 py-2">総数</th>
                  <th className="px-3 py-2">初診</th>
                  <th className="px-3 py-2">再診</th>
                  <th className="px-3 py-2">1日平均</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {dayTypeData.map((row) => (
                  <tr key={row.dayType} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {row.dayType}
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
                      {row.avgPerDay.toFixed(1)}
                    </td>
                  </tr>
                ))}
                {dayTypeData.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                      集計対象のデータがありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard
          title="時間帯別 予約数（受付基準）"
          description="1時間単位で予約受付が集中する時間帯を診療科別に表示しています。"
        >
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold text-slate-700">診療科:</label>
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
                    ? '▲ 閉じる'
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
            <Suspense fallback={<div className="h-[280px] sm:h-[340px] md:h-[380px] flex items-center justify-center text-slate-500">読み込み中...</div>}>
              <HourlyChartSection hourlyData={departmentSpecificHourly} />
            </Suspense>
          )}
        </SectionCard>

        <SectionCard
          title="日別 予約推移（受付基準）"
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
            <Suspense fallback={<div className="h-[240px] sm:h-72 flex items-center justify-center text-slate-500">読み込み中...</div>}>
              <DailyChartSection dailyData={overallDaily} />
            </Suspense>
          )}
        </SectionCard>

        <SectionCard
          title="月次サマリ（受付基準）"
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
                    <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                      集計対象のデータがありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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
                <span className="font-semibold text-brand-600">CSVアップロード窓口</span>
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
                  共有URL: <code className="rounded bg-white px-2 py-1">{shareUrl}</code>
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
