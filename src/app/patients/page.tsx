"use client";

import { useCallback, useEffect, useMemo, useState, lazy, Suspense, type ChangeEvent } from "react";
import {
  RefreshCw,
  Share2,
  Upload,
  Link as LinkIcon,
  Users,
  UserPlus,
  RotateCcw,
  Undo2,
  Clock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Papa from "papaparse";
import { uploadDataToR2, fetchDataFromR2 } from "@/lib/dataShare";
import {
  aggregateKarteMonthly,
  classifyKarteRecords,
  type KarteMonthlyStat,
  type KarteRecord,
  type KarteRecordWithCategory,
} from "@/lib/karteAnalytics";

import {
  type Reservation,
  parseReservationCsv,
  mergeReservations,
  loadReservationsFromStorage,
  saveReservationsToStorage,
  loadReservationTimestamp,
  saveReservationDiff,
  clearReservationDiff,
  RESERVATION_STORAGE_KEY,
  RESERVATION_TIMESTAMP_KEY,
  RESERVATION_DIFF_STORAGE_KEY,
} from "@/lib/reservationData";
import {
  type SurveyData,
  parseSurveyCsv,
  determineSurveyFileType,
  mergeSurveyData,
  loadSurveyDataFromStorage,
  saveSurveyDataToStorage,
  loadSurveyTimestamp,
  type SurveyFileType,
  SURVEY_STORAGE_KEY,
  SURVEY_TIMESTAMP_KEY,
} from "@/lib/surveyData";
import { setCompressedItem, getCompressedItem } from "@/lib/storageCompression";
import {
  type ListingCategory,
  type ListingData,
  type ListingCategoryData,
  parseListingCsv,
  mergeListingData,
  loadListingDataFromStorage,
  saveListingDataToStorage,
  loadListingTimestamp,
  LISTING_STORAGE_KEY,
  LISTING_TIMESTAMP_KEY,
} from "@/lib/listingData";
import {
  type DiagnosisRecord,
  type DiagnosisDepartment,
  type DiagnosisCategory,
  parseDiagnosisCsv,
  mergeDiagnosisRecords,
  loadDiagnosisFromStorage,
  saveDiagnosisToStorage,
  loadDiagnosisTimestamp,
  aggregateDiagnosisMonthly,
  aggregateDiagnosisCategoryMonthly,
  filterDiagnosisByMonthRange,
  summarizeDiagnosisByDisease,
  extractDiagnosisMonths,
  calculatePreviousRange,
  DIAGNOSIS_TARGET_DEPARTMENTS,
  DIAGNOSIS_CATEGORIES,
  DIAGNOSIS_STORAGE_KEY,
  DIAGNOSIS_TIMESTAMP_KEY,
} from "@/lib/diagnosisData";
import type { SharedDataBundle } from "@/lib/sharedBundle";

const MonthlySummaryChart = lazy(() =>
  import("@/components/patients/MonthlySummaryChart").then((m) => ({
    default: m.MonthlySummaryChart,
  })),
);
const MonthlyTrendChart = lazy(() =>
  import("@/components/patients/MonthlyTrendChart").then((m) => ({
    default: m.MonthlyTrendChart,
  })),
);
const DepartmentChart = lazy(() =>
  import("@/components/patients/DepartmentChart").then((m) => ({
    default: m.DepartmentChart,
  })),
);
const WeekdayAverageChart = lazy(() =>
  import("@/components/patients/WeekdayAverageChart").then((m) => ({
    default: m.WeekdayAverageChart,
  })),
);
const DiagnosisMonthlyChart = lazy(() =>
  import("@/components/patients/DiagnosisMonthlyChart").then((m) => ({
    default: m.DiagnosisMonthlyChart,
  })),
);
const DiagnosisCategoryChart = lazy(() =>
  import("@/components/patients/DiagnosisCategoryChart").then((m) => ({
    default: m.DiagnosisCategoryChart,
  })),
);

const KARTE_STORAGE_KEY = "clinic-analytics/karte-records/v1";
const KARTE_TIMESTAMP_KEY = "clinic-analytics/karte-last-updated/v1";
const KARTE_MIN_MONTH = "2000-01";

const LISTING_CATEGORIES: ListingCategory[] = ["内科", "胃カメラ", "大腸カメラ"];
const SURVEY_FILE_TYPES: SurveyFileType[] = ["外来", "内視鏡"];

const createEmptyListingTotals = (): Record<ListingCategory, number> =>
  LISTING_CATEGORIES.reduce(
    (acc, category) => {
      acc[category] = 0;
      return acc;
    },
    {} as Record<ListingCategory, number>,
  );

const createEmptySurveyCounts = (): Record<SurveyFileType, number> =>
  SURVEY_FILE_TYPES.reduce(
    (acc, type) => {
      acc[type] = 0;
      return acc;
    },
    {} as Record<SurveyFileType, number>,
  );

const summarizeSurveyByType = (data: SurveyData[]): Record<SurveyFileType, number> => {
  const counts = createEmptySurveyCounts();
  for (const item of data) {
    counts[item.fileType] = (counts[item.fileType] ?? 0) + 1;
  }
  return counts;
};

const createEmptyDiagnosisDepartmentTotals = (): Record<DiagnosisDepartment, number> =>
  DIAGNOSIS_TARGET_DEPARTMENTS.reduce(
    (acc, department) => {
      acc[department] = 0;
      return acc;
    },
    {} as Record<DiagnosisDepartment, number>,
  );

const calculateDiagnosisDepartmentTotals = (
  records: DiagnosisRecord[],
): Record<DiagnosisDepartment, number> => {
  const totals = createEmptyDiagnosisDepartmentTotals();
  for (const record of records) {
    totals[record.department] = (totals[record.department] ?? 0) + 1;
  }
  return totals;
};

const createEmptyDiagnosisCategoryTotals = (): Record<DiagnosisCategory, number> =>
  DIAGNOSIS_CATEGORIES.reduce(
    (acc, category) => {
      acc[category] = 0;
      return acc;
    },
    {} as Record<DiagnosisCategory, number>,
  );

const calculateDiagnosisCategoryTotals = (
  records: DiagnosisRecord[],
): Record<DiagnosisCategory, number> => {
  const totals = createEmptyDiagnosisCategoryTotals();
  for (const record of records) {
    totals[record.category] = (totals[record.category] ?? 0) + 1;
  }
  return totals;
};

const DIAGNOSIS_CATEGORY_BADGE_CLASSES: Record<DiagnosisCategory, string> = {
  生活習慣病: "bg-emerald-50 text-emerald-600",
  外科: "bg-orange-50 text-orange-600",
  皮膚科: "bg-rose-50 text-rose-600",
  その他: "bg-slate-50 text-slate-600",
};

const roundTo1Decimal = (value: number) => Math.round(value * 10) / 10;

const calculateAge = (birthIso: string | null, visitIso: string): number | null => {
  if (!birthIso) {
    return null;
  }
  const birthDate = new Date(birthIso);
  const visitDate = new Date(visitIso);
  if (Number.isNaN(birthDate.getTime()) || Number.isNaN(visitDate.getTime())) {
    return null;
  }
  let age = visitDate.getFullYear() - birthDate.getFullYear();
  const visitMonth = visitDate.getMonth();
  const birthMonth = birthDate.getMonth();
  if (
    visitMonth < birthMonth ||
    (visitMonth === birthMonth && visitDate.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }
  return age >= 0 && age < 130 ? age : null;
};

type DepartmentStat = {
  department: string;
  total: number;
  pureFirst: number;
  returningFirst: number;
  revisit: number;
  averageAge: number | null;
  pureRate: number;
  returningRate: number;
  revisitRate: number;
};

const DepartmentMetric = ({
  icon: Icon,
  label,
  value,
  accent,
  caption,
  monthOverMonth,
  isSingleMonth,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  accent: "brand" | "emerald" | "accent" | "muted";
  caption?: string | null;
  monthOverMonth?: { value: number; percentage: number } | null;
  isSingleMonth: boolean;
}) => {
  const accentClass =
    accent === "brand"
      ? "bg-brand-50 text-brand-600"
      : accent === "emerald"
        ? "bg-emerald-50 text-emerald-600"
        : accent === "accent"
          ? "bg-accent-50 text-accent-600"
          : "bg-slate-100 text-slate-600";

  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white/60 px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-full ${accentClass}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs font-semibold text-slate-500">{label}</span>
      </div>
      <div className="flex flex-col items-end">
        <span className="text-sm font-semibold text-slate-900">{value}</span>
        {caption && <span className="text-[11px] font-medium text-slate-400">{caption}</span>}
        {monthOverMonth && (
          <span className={`text-[11px] font-medium ${monthOverMonth.value >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {isSingleMonth ? '前月比' : '期間比'}: {monthOverMonth.value >= 0 ? '+' : ''}{monthOverMonth.percentage}%
          </span>
        )}
      </div>
    </div>
  );
};

const removeBom = (value: string) => value.replace(/^\uFEFF/, "");

const normalizeCsvRow = (row: Record<string, string | undefined>) => {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = removeBom(key).trim();
    normalized[normalizedKey] =
      typeof value === "string" ? value.trim() || undefined : value;
  }
  return normalized;
};

const parseSlashDate = (raw: string | undefined) => {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parts = trimmed.split("/");
  if (parts.length < 3) {
    return null;
  }
  const [yearStr, monthStr, dayStr] = parts;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  return new Date(year, month - 1, day);
};

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parsePatientNumber = (raw: string | undefined) => {
  if (!raw) {
    return null;
  }
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 0) {
    return null;
  }
  const value = Number.parseInt(digits, 10);
  if (!Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
};

const parseKarteCsv = (text: string): KarteRecord[] => {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message ?? "CSV parsing error");
  }

  const records: KarteRecord[] = [];

  for (const rawRow of parsed.data) {
    const row = normalizeCsvRow(rawRow);
    const visitDate = parseSlashDate(row["日付"]);
    if (!visitDate) {
      continue;
    }

    const dateIso = formatDateKey(visitDate);
    const monthKey = dateIso.slice(0, 7);

    const visitTypeRaw = row["初診・再診"] ?? "";
    const visitType =
      visitTypeRaw === "初診" ? "初診" : visitTypeRaw === "再診" ? "再診" : "不明";

    const patientNumber = parsePatientNumber(row["患者番号"]);
    const birthDate = parseSlashDate(row["患者生年月日"]);
    const birthDateIso = birthDate ? formatDateKey(birthDate) : null;
    const department = row["診療科"]?.trim() ?? "";

    records.push({
      dateIso,
      monthKey,
      visitType,
      patientNumber,
      birthDateIso,
      department,
    });
  }

  if (records.length === 0) {
    throw new Error("有効なカルテ集計データが見つかりませんでした。");
  }

  records.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  return records;
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

const SectionCard = ({ title, description, action, children }: SectionCardProps) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft sm:rounded-3xl sm:p-6">
    <header className="mb-3 flex flex-col gap-2 sm:mb-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">{title}</h2>
        {description && (
          <p className="text-xs leading-relaxed text-slate-500 sm:text-sm">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
    <div className="sm:pt-1">{children}</div>
  </section>
);

const StatCard = ({
  label,
  value,
  tone,
  monthOverMonth,
  isSingleMonth,
}: {
  label: string;
  value: string;
  tone: "brand" | "accent" | "muted" | "emerald";
  monthOverMonth?: { value: number; percentage: number } | null;
  isSingleMonth: boolean;
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
      {monthOverMonth && (
        <p className={`mt-1 text-xs font-medium ${monthOverMonth.value >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {isSingleMonth ? '前月比' : '期間比'}: {monthOverMonth.value >= 0 ? '+' : ''}{monthOverMonth.value} ({monthOverMonth.percentage >= 0 ? '+' : ''}{monthOverMonth.percentage.toFixed(1)}%)
        </p>
      )}
    </div>
  );
};

export default function PatientAnalysisPage() {
  const [records, setRecords] = useState<KarteRecord[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isLoadingShared, setIsLoadingShared] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [startMonth, setStartMonth] = useState<string>("");
  const [endMonth, setEndMonth] = useState<string>("");
  const [showSummaryChart, setShowSummaryChart] = useState(false);
  const [showTrendChart, setShowTrendChart] = useState(false);
  const [showDepartmentChart, setShowDepartmentChart] = useState(false);
  const [showWeekdayChart, setShowWeekdayChart] = useState(false);
  const [reservationStatus, setReservationStatus] = useState<{
    lastUpdated: string | null;
    total: number;
  }>({
    lastUpdated: null,
    total: 0,
  });
  const [isUploadingReservation, setIsUploadingReservation] = useState(false);
  const [reservationUploadError, setReservationUploadError] = useState<string | null>(null);
  const [surveyStatus, setSurveyStatus] = useState<{
    lastUpdated: string | null;
    total: number;
    byType: Record<SurveyFileType, number>;
  }>({
    lastUpdated: null,
    total: 0,
    byType: createEmptySurveyCounts(),
  });
  const [isUploadingSurvey, setIsUploadingSurvey] = useState(false);
  const [surveyUploadError, setSurveyUploadError] = useState<string | null>(null);
  const [listingStatus, setListingStatus] = useState<{
    lastUpdated: string | null;
    totals: Record<ListingCategory, number>;
  }>({
    lastUpdated: null,
    totals: createEmptyListingTotals(),
  });
  const [isUploadingListing, setIsUploadingListing] = useState<Record<ListingCategory, boolean>>({
    内科: false,
    胃カメラ: false,
    大腸カメラ: false,
  });
  const [listingUploadError, setListingUploadError] = useState<string | null>(null);
  const [diagnosisRecords, setDiagnosisRecords] = useState<DiagnosisRecord[]>([]);
  const [diagnosisStatus, setDiagnosisStatus] = useState<{
    lastUpdated: string | null;
    total: number;
    byDepartment: Record<DiagnosisDepartment, number>;
    byCategory: Record<DiagnosisCategory, number>;
  }>({
    lastUpdated: null,
    total: 0,
    byDepartment: createEmptyDiagnosisDepartmentTotals(),
    byCategory: createEmptyDiagnosisCategoryTotals(),
  });
  const [isUploadingDiagnosis, setIsUploadingDiagnosis] = useState(false);
  const [diagnosisUploadError, setDiagnosisUploadError] = useState<string | null>(null);
  const [showDiagnosisChart, setShowDiagnosisChart] = useState(false);
  const [showDiagnosisCategoryChart, setShowDiagnosisCategoryChart] = useState(false);

  const applySharedBundle = useCallback(
    (bundle: SharedDataBundle, fallbackTimestamp?: string) => {
      const generatedAt = bundle.generatedAt ?? fallbackTimestamp ?? new Date().toISOString();
      const karteRecords = Array.isArray(bundle.karteRecords) ? bundle.karteRecords : [];
      const karteTimestamp = bundle.karteTimestamp ?? fallbackTimestamp ?? generatedAt;

      setUploadError(null);
    setShareUrl(null);
    setRecords(karteRecords);
    setLastUpdated(karteTimestamp);

    if (typeof window !== "undefined") {
      try {
        setCompressedItem(KARTE_STORAGE_KEY, JSON.stringify(karteRecords));
        window.localStorage.setItem(KARTE_TIMESTAMP_KEY, karteTimestamp);
      } catch (error) {
        console.error(error);
        setUploadError("データの保存に失敗しました。データ量が多すぎる可能性があります。");
      }
    }

      if (Array.isArray(bundle.reservations)) {
        const reservationsData = bundle.reservations as Reservation[];
        const reservationsTimestamp = saveReservationsToStorage(
          reservationsData,
          bundle.reservationsTimestamp ?? fallbackTimestamp ?? generatedAt,
        );
        clearReservationDiff();
        setReservationStatus({
          lastUpdated: reservationsTimestamp,
          total: reservationsData.length,
        });
      }

      if (Array.isArray(bundle.surveyData)) {
        const surveyDataset = bundle.surveyData as SurveyData[];
        const surveyTimestamp = saveSurveyDataToStorage(
          surveyDataset,
          bundle.surveyTimestamp ?? fallbackTimestamp ?? generatedAt,
        );
        setSurveyStatus({
          lastUpdated: surveyTimestamp,
          total: surveyDataset.length,
          byType: summarizeSurveyByType(surveyDataset),
        });
      }

      if (Array.isArray(bundle.listingData)) {
        const listingDataset = bundle.listingData as ListingCategoryData[];
        const listingTimestamp = saveListingDataToStorage(
          listingDataset,
          bundle.listingTimestamp ?? fallbackTimestamp ?? generatedAt,
        );
        const totals = createEmptyListingTotals();
        listingDataset.forEach((item) => {
          totals[item.category] = item.data.length;
        });
        setListingStatus({
          lastUpdated: listingTimestamp,
          totals,
        });
      }

      if (Array.isArray(bundle.diagnosisData)) {
        const diagnosisDataset = bundle.diagnosisData as DiagnosisRecord[];
        const diagnosisTimestamp = saveDiagnosisToStorage(
          diagnosisDataset,
          bundle.diagnosisTimestamp ?? fallbackTimestamp ?? generatedAt,
        );
        setDiagnosisRecords(diagnosisDataset);
        setDiagnosisStatus({
          lastUpdated: diagnosisTimestamp,
          total: diagnosisDataset.length,
          byDepartment: calculateDiagnosisDepartmentTotals(diagnosisDataset),
          byCategory: calculateDiagnosisCategoryTotals(diagnosisDataset),
        });
      }
    },
    [],
  );

  const applySharedPayload = useCallback(
    (payload: unknown, uploadedAt?: string): boolean => {
      if (Array.isArray(payload)) {
        const timestamp = uploadedAt ?? new Date().toISOString();
        setUploadError(null);
        setShareUrl(null);
        setRecords(payload as KarteRecord[]);
        setLastUpdated(timestamp);
        if (typeof window !== "undefined") {
          try {
            setCompressedItem(KARTE_STORAGE_KEY, JSON.stringify(payload));
            window.localStorage.setItem(KARTE_TIMESTAMP_KEY, timestamp);
          } catch (error) {
            console.error(error);
            setUploadError("データの保存に失敗しました。データ量が多すぎる可能性があります。");
          }
        }
        return true;
      }

      if (
        payload &&
        typeof payload === "object" &&
        Array.isArray((payload as SharedDataBundle).karteRecords)
      ) {
        applySharedBundle(payload as SharedDataBundle, uploadedAt);
        return true;
      }

      return false;
    },
    [applySharedBundle],
  );

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
          if (response.type === "karte") {
            try {
              const parsed = JSON.parse(response.data);
              if (!applySharedPayload(parsed, response.uploadedAt)) {
                setUploadError("共有データの形式が不正です。");
              }
            } catch (error) {
              console.error(error);
              setUploadError("共有データの読み込みに失敗しました。");
            }
          } else {
            setUploadError("カルテ集計データではない共有リンクです。");
          }
        })
        .catch((error) => {
          console.error(error);
          setUploadError(`共有データの読み込みに失敗しました: ${(error as Error).message}`);
        })
        .finally(() => {
          setIsLoadingShared(false);
        });
    } else {
      try {
        const stored = getCompressedItem(KARTE_STORAGE_KEY);
        if (stored) {
          const parsed: KarteRecord[] = JSON.parse(stored);
          setRecords(parsed);
        }
        const storedTimestamp = window.localStorage.getItem(KARTE_TIMESTAMP_KEY);
        if (storedTimestamp) {
          setLastUpdated(storedTimestamp);
        }
      } catch (error) {
        console.error(error);
        setUploadError("保存済みデータの読み込みに失敗しました。");
      }
    }
  }, [applySharedPayload]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const existingReservations = loadReservationsFromStorage();
      const reservationTimestamp = loadReservationTimestamp();
      setReservationStatus({
        lastUpdated: reservationTimestamp,
        total: existingReservations.length,
      });

      const existingSurvey = loadSurveyDataFromStorage();
      const surveyTimestamp = loadSurveyTimestamp();
      setSurveyStatus({
        lastUpdated: surveyTimestamp,
        total: existingSurvey.length,
        byType: summarizeSurveyByType(existingSurvey),
      });

      const existingDiagnosis = loadDiagnosisFromStorage();
      const diagnosisTimestamp = loadDiagnosisTimestamp();
      setDiagnosisRecords(existingDiagnosis);
      setDiagnosisStatus({
        lastUpdated: diagnosisTimestamp,
        total: existingDiagnosis.length,
        byDepartment: calculateDiagnosisDepartmentTotals(existingDiagnosis),
        byCategory: calculateDiagnosisCategoryTotals(existingDiagnosis),
      });

      const existingListing = loadListingDataFromStorage();
      const listingTimestamp = loadListingTimestamp();
      const totals = createEmptyListingTotals();
      existingListing.forEach((item) => {
        totals[item.category] = item.data.length;
      });
      setListingStatus({
        lastUpdated: listingTimestamp,
        totals,
      });
    } catch (error) {
      console.error(error);
    }
  }, []);

  const classifiedRecords = useMemo<KarteRecordWithCategory[]>(() => {
    if (records.length === 0) {
      return [];
    }
    return classifyKarteRecords(records);
  }, [records]);
  const periodFilteredRecords = useMemo(() => {
    if (classifiedRecords.length === 0) {
      return [];
    }
    let filtered = classifiedRecords.filter((record) => record.monthKey >= KARTE_MIN_MONTH);
    
    if (startMonth && endMonth) {
      filtered = filtered.filter(
        (record) => record.monthKey >= startMonth && record.monthKey <= endMonth
      );
    } else if (startMonth) {
      filtered = filtered.filter((record) => record.monthKey >= startMonth);
    } else if (endMonth) {
      filtered = filtered.filter((record) => record.monthKey <= endMonth);
    }
    
    return filtered;
  }, [classifiedRecords, startMonth, endMonth]);

  const diagnosisMonths = useMemo(
    () => extractDiagnosisMonths(diagnosisRecords),
    [diagnosisRecords],
  );

  const allAvailableMonths = useMemo(() => {
    const months = new Set<string>();
    for (const record of classifiedRecords) {
      if (record.monthKey >= KARTE_MIN_MONTH) {
        months.add(record.monthKey);
      }
    }
    for (const month of diagnosisMonths) {
      months.add(month);
    }
    return Array.from(months).sort();
  }, [classifiedRecords, diagnosisMonths]);



  useEffect(() => {
    if (allAvailableMonths.length === 0) {
      return;
    }

    const latestMonth = allAvailableMonths[allAvailableMonths.length - 1];
    
    // 開始月・終了月が未設定の場合、最新月を設定
    if (!startMonth && !endMonth) {
      setStartMonth(latestMonth);
      setEndMonth(latestMonth);
    }
  }, [allAvailableMonths, startMonth, endMonth]);

  const filteredClassified = useMemo(() => {
    return periodFilteredRecords;
  }, [periodFilteredRecords]);

  const statsAll = useMemo(() => {
    if (records.length === 0) {
      return [];
    }
    return aggregateKarteMonthly(records).filter((item) => item.month >= KARTE_MIN_MONTH);
  }, [records]);

  const stats = useMemo(() => {
    if (periodFilteredRecords.length === 0) {
      return [];
    }
    const targetMonths = new Set(periodFilteredRecords.map((record) => record.monthKey));
    return statsAll.filter((stat) => targetMonths.has(stat.month));
  }, [statsAll, periodFilteredRecords]);

  const latestStat: KarteMonthlyStat | null =
    stats.length > 0 ? stats[stats.length - 1] : null;

  const firstStat: KarteMonthlyStat | null =
    stats.length > 0 ? stats[0] : null;

  const isSingleMonthPeriod = startMonth === endMonth;

  // 単月表示時の前月データを取得
  const previousMonthStat = useMemo<KarteMonthlyStat | null>(() => {
    if (!isSingleMonthPeriod || !startMonth) {
      return null;
    }

    const startDate = new Date(startMonth + '-01');
    const prevDate = new Date(startDate);
    prevDate.setMonth(prevDate.getMonth() - 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    return statsAll.find(stat => stat.month === prevMonth) || null;
  }, [isSingleMonthPeriod, startMonth, statsAll]);

  const calculateMonthOverMonth = (current: number, previous: number | null) => {
    if (previous === null || previous === 0) return null;
    const diff = current - previous;
    const percentage = roundTo1Decimal((diff / previous) * 100);
    return { value: diff, percentage };
  };

  const previousPeriodRecords = useMemo(() => {
    if (classifiedRecords.length === 0 || !startMonth || !endMonth) {
      return [];
    }

    if (isSingleMonthPeriod) {
      // 単月の場合：前月のデータ
      const startDate = new Date(startMonth + '-01');
      const prevDate = new Date(startDate);
      prevDate.setMonth(prevDate.getMonth() - 1);
      const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

      return classifiedRecords.filter(
        (record) => record.monthKey === prevMonth && record.monthKey >= KARTE_MIN_MONTH
      );
    } else {
      // 複数月の場合：期間の最初の月のデータ
      return classifiedRecords.filter(
        (record) => record.monthKey === startMonth && record.monthKey >= KARTE_MIN_MONTH
      );
    }
  }, [classifiedRecords, startMonth, endMonth, isSingleMonthPeriod]);

  const departmentStats = useMemo<DepartmentStat[]>(() => {
    if (filteredClassified.length === 0) {
      return [];
    }

    const map = new Map<
      string,
      {
        department: string;
        total: number;
        pureFirst: number;
        returningFirst: number;
        revisit: number;
        ageSum: number;
        ageCount: number;
      }
    >();

    for (const record of filteredClassified) {
      const departmentRaw = record.department?.trim() ?? "";
      if (departmentRaw.includes("自費")) {
        continue;
      }
      const department = departmentRaw.length > 0 ? departmentRaw : "診療科未分類";
      if (!map.has(department)) {
        map.set(department, {
          department,
          total: 0,
          pureFirst: 0,
          returningFirst: 0,
          revisit: 0,
          ageSum: 0,
          ageCount: 0,
        });
      }

      const bucket = map.get(department)!;
      bucket.total += 1;

      if (record.category === "pureFirst") {
        bucket.pureFirst += 1;
      } else if (record.category === "returningFirst") {
        bucket.returningFirst += 1;
      } else if (record.category === "revisit") {
        bucket.revisit += 1;
      }

      const age = calculateAge(record.birthDateIso ?? null, record.dateIso);
      if (age !== null) {
        bucket.ageSum += age;
        bucket.ageCount += 1;
      }
    }

    return Array.from(map.values())
      .map((bucket) => {
        const pureRate = bucket.total > 0 ? (bucket.pureFirst / bucket.total) * 100 : 0;
        const returningRate = bucket.total > 0 ? (bucket.returningFirst / bucket.total) * 100 : 0;
        const revisitRate = bucket.total > 0 ? (bucket.revisit / bucket.total) * 100 : 0;

        return {
          department: bucket.department,
          total: bucket.total,
          pureFirst: bucket.pureFirst,
          returningFirst: bucket.returningFirst,
          revisit: bucket.revisit,
          averageAge:
            bucket.ageCount > 0 ? roundTo1Decimal(bucket.ageSum / bucket.ageCount) : null,
          pureRate: roundTo1Decimal(pureRate),
          returningRate: roundTo1Decimal(returningRate),
          revisitRate: roundTo1Decimal(revisitRate),
        };
      })
      .sort((a, b) => {
        const diff = b.total - a.total;
        if (diff !== 0) {
          return diff;
        }
        return a.department.localeCompare(b.department, "ja");
      });
  }, [filteredClassified]);

  const previousDepartmentStats = useMemo<Map<string, DepartmentStat>>(() => {
    if (previousPeriodRecords.length === 0) {
      return new Map();
    }

    const map = new Map<
      string,
      {
        department: string;
        total: number;
        pureFirst: number;
        returningFirst: number;
        revisit: number;
        ageSum: number;
        ageCount: number;
      }
    >();

    for (const record of previousPeriodRecords) {
      const departmentRaw = record.department?.trim() ?? "";
      if (departmentRaw.includes("自費")) {
        continue;
      }
      const department = departmentRaw.length > 0 ? departmentRaw : "診療科未分類";
      if (!map.has(department)) {
        map.set(department, {
          department,
          total: 0,
          pureFirst: 0,
          returningFirst: 0,
          revisit: 0,
          ageSum: 0,
          ageCount: 0,
        });
      }

      const bucket = map.get(department)!;
      bucket.total += 1;

      if (record.category === "pureFirst") {
        bucket.pureFirst += 1;
      } else if (record.category === "returningFirst") {
        bucket.returningFirst += 1;
      } else if (record.category === "revisit") {
        bucket.revisit += 1;
      }

      const age = calculateAge(record.birthDateIso ?? null, record.dateIso);
      if (age !== null) {
        bucket.ageSum += age;
        bucket.ageCount += 1;
      }
    }

    const resultMap = new Map<string, DepartmentStat>();
    for (const bucket of map.values()) {
      const pureRate = bucket.total > 0 ? (bucket.pureFirst / bucket.total) * 100 : 0;
      const returningRate = bucket.total > 0 ? (bucket.returningFirst / bucket.total) * 100 : 0;
      const revisitRate = bucket.total > 0 ? (bucket.revisit / bucket.total) * 100 : 0;

      resultMap.set(bucket.department, {
        department: bucket.department,
        total: bucket.total,
        pureFirst: bucket.pureFirst,
        returningFirst: bucket.returningFirst,
        revisit: bucket.revisit,
        averageAge:
          bucket.ageCount > 0 ? roundTo1Decimal(bucket.ageSum / bucket.ageCount) : null,
        pureRate: roundTo1Decimal(pureRate),
        returningRate: roundTo1Decimal(returningRate),
        revisitRate: roundTo1Decimal(revisitRate),
      });
    }

    return resultMap;
  }, [previousPeriodRecords]);

  const filteredDiagnosisRecords = useMemo(() => {
    if (diagnosisRecords.length === 0) {
      return [];
    }
    const start = startMonth || undefined;
    const end = endMonth || undefined;
    return filterDiagnosisByMonthRange(diagnosisRecords, start, end);
  }, [diagnosisRecords, startMonth, endMonth]);

  const diagnosisMonthlyInRange = useMemo(
    () => aggregateDiagnosisMonthly(filteredDiagnosisRecords),
    [filteredDiagnosisRecords],
  );

  const diagnosisCategoryMonthlyInRange = useMemo(
    () => aggregateDiagnosisCategoryMonthly(filteredDiagnosisRecords),
    [filteredDiagnosisRecords],
  );

  const diagnosisDepartmentTotals = useMemo(() => {
    if (filteredDiagnosisRecords.length === 0) {
      return createEmptyDiagnosisDepartmentTotals();
    }
    return calculateDiagnosisDepartmentTotals(filteredDiagnosisRecords);
  }, [filteredDiagnosisRecords]);

  const diagnosisCategoryTotals = useMemo(() => {
    if (filteredDiagnosisRecords.length === 0) {
      return createEmptyDiagnosisCategoryTotals();
    }
    return calculateDiagnosisCategoryTotals(filteredDiagnosisRecords);
  }, [filteredDiagnosisRecords]);

  const previousDiagnosisRange = useMemo(() => {
    if (!startMonth || !endMonth) {
      return null;
    }
    return calculatePreviousRange(startMonth, endMonth);
  }, [startMonth, endMonth]);

  const previousDiagnosisRecords = useMemo(() => {
    if (!previousDiagnosisRange) {
      return [];
    }
    return filterDiagnosisByMonthRange(
      diagnosisRecords,
      previousDiagnosisRange.start,
      previousDiagnosisRange.end,
    );
  }, [diagnosisRecords, previousDiagnosisRange]);

  const previousDiagnosisTotals = useMemo(() => {
    if (previousDiagnosisRecords.length === 0) {
      return createEmptyDiagnosisDepartmentTotals();
    }
    return calculateDiagnosisDepartmentTotals(previousDiagnosisRecords);
  }, [previousDiagnosisRecords]);

  const previousDiagnosisCategoryTotals = useMemo(() => {
    if (previousDiagnosisRecords.length === 0) {
      return createEmptyDiagnosisCategoryTotals();
    }
    return calculateDiagnosisCategoryTotals(previousDiagnosisRecords);
  }, [previousDiagnosisRecords]);

  const hasDiagnosisPrevious = Boolean(
    previousDiagnosisRange && previousDiagnosisRecords.length > 0,
  );

  const diagnosisDiseaseSummaries = useMemo(
    () => summarizeDiagnosisByDisease(filteredDiagnosisRecords),
    [filteredDiagnosisRecords],
  );

  const previousDiagnosisDiseaseMap = useMemo(() => {
    const map = new Map<string, number>();
    if (previousDiagnosisRecords.length === 0) {
      return map;
    }
    const summaries = summarizeDiagnosisByDisease(previousDiagnosisRecords);
    for (const summary of summaries) {
      map.set(`${summary.department}|${summary.diseaseName}`, summary.total);
    }
    return map;
  }, [previousDiagnosisRecords]);

  const previousDiagnosisCategoryDiseaseMap = useMemo(() => {
    const map = new Map<string, number>();
    if (previousDiagnosisRecords.length === 0) {
      return map;
    }
    const summaries = summarizeDiagnosisByDisease(previousDiagnosisRecords);
    for (const summary of summaries) {
      map.set(`${summary.category}|${summary.diseaseName}`, summary.total);
    }
    return map;
  }, [previousDiagnosisRecords]);

  const diagnosisTopDiseasesByDepartment = useMemo(() => {
    const grouped = new Map<
      DiagnosisDepartment,
      Array<{ diseaseName: string; total: number; diff: number; previous: number }>
    >();

    for (const summary of diagnosisDiseaseSummaries) {
      const key = `${summary.department}|${summary.diseaseName}`;
      const previous = previousDiagnosisDiseaseMap.get(key) ?? 0;
      if (!grouped.has(summary.department)) {
        grouped.set(summary.department, []);
      }
      grouped.get(summary.department)!.push({
        diseaseName: summary.diseaseName,
        total: summary.total,
        previous,
        diff: summary.total - previous,
      });
    }

    const result: Array<{
      department: DiagnosisDepartment;
      items: Array<{ diseaseName: string; total: number; previous: number; diff: number }>;
    }> = [];

    for (const department of DIAGNOSIS_TARGET_DEPARTMENTS) {
      const items = (grouped.get(department) ?? []).sort(
        (a, b) => b.total - a.total || a.diseaseName.localeCompare(b.diseaseName, "ja"),
      );
      result.push({
        department,
        items: items.slice(0, 5),
      });
    }

    return result;
  }, [diagnosisDiseaseSummaries, previousDiagnosisDiseaseMap]);

  const diagnosisTopDiseasesByCategory = useMemo(() => {
    const grouped = new Map<
      DiagnosisCategory,
      Array<{ diseaseName: string; total: number; diff: number; previous: number }>
    >();

    for (const summary of diagnosisDiseaseSummaries) {
      const key = `${summary.category}|${summary.diseaseName}`;
      const previous = previousDiagnosisCategoryDiseaseMap.get(key) ?? 0;
      if (!grouped.has(summary.category)) {
        grouped.set(summary.category, []);
      }
      grouped.get(summary.category)!.push({
        diseaseName: summary.diseaseName,
        total: summary.total,
        previous,
        diff: summary.total - previous,
      });
    }

    const result: Array<{
      category: DiagnosisCategory;
      items: Array<{ diseaseName: string; total: number; previous: number; diff: number }>;
    }> = [];

    for (const category of DIAGNOSIS_CATEGORIES) {
      const items = (grouped.get(category) ?? []).sort(
        (a, b) => b.total - a.total || a.diseaseName.localeCompare(b.diseaseName, "ja"),
      );
      result.push({
        category,
        items: items.slice(0, 5),
      });
    }

    return result;
  }, [diagnosisDiseaseSummaries, previousDiagnosisCategoryDiseaseMap]);

  const diagnosisRangeLabel = useMemo(() => {
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
  }, [startMonth, endMonth]);

  const diagnosisPreviousLabel = useMemo(() => {
    if (!previousDiagnosisRange) {
      return null;
    }
    const { start, end } = previousDiagnosisRange;
    if (start === end) {
      return formatMonthLabel(start);
    }
    return `${formatMonthLabel(start)}〜${formatMonthLabel(end)}`;
  }, [previousDiagnosisRange]);

  const hasAnyRecords = records.length > 0;
  const hasPeriodRecords = periodFilteredRecords.length > 0;
  const hasDiagnosisRecords = filteredDiagnosisRecords.length > 0;
  const canShowDiagnosisChart = diagnosisMonthlyInRange.length > 0;
  const canShowDiagnosisCategoryChart = diagnosisCategoryMonthlyInRange.length > 0;

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }

    setUploadError(null);
    try {
      const existingMap = new Map<string, KarteRecord>();

      // 既存データを先に追加
      for (const record of records) {
        const key = `${record.dateIso}|${record.visitType}|${record.patientNumber}|${record.department}`;
        existingMap.set(key, record);
      }

      // 複数ファイルを処理
      for (const file of Array.from(files)) {
        const text = await file.text();
        const parsed = parseKarteCsv(text);

        for (const record of parsed) {
          const key = `${record.dateIso}|${record.visitType}|${record.patientNumber}|${record.department}`;
          existingMap.set(key, record);
        }
      }

      const merged = Array.from(existingMap.values()).sort((a, b) =>
        a.dateIso.localeCompare(b.dateIso),
      );

      setRecords(merged);
      setShareUrl(null);

      const timestamp = new Date().toISOString();
      setLastUpdated(timestamp);

      if (typeof window !== "undefined") {
        try {
          setCompressedItem(KARTE_STORAGE_KEY, JSON.stringify(merged));
          window.localStorage.setItem(KARTE_TIMESTAMP_KEY, timestamp);
        } catch (storageError) {
          console.error("保存エラー:", storageError);
          throw new Error("データの保存に失敗しました。データ量が多すぎる可能性があります。");
        }
      }
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error
          ? `カルテ集計CSVの解析に失敗しました: ${error.message}`
          : "カルテ集計CSVの解析に失敗しました。";
      setUploadError(message);
    } finally {
      event.target.value = "";
    }
  };

  const handleReservationUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const files = input.files ? Array.from(input.files) : [];
    if (files.length === 0) {
      return;
    }

    setReservationUploadError(null);
    setIsUploadingReservation(true);

    try {
      const existing = loadReservationsFromStorage();
      const incoming: Reservation[] = [];

      for (const file of files) {
        const text = await file.text();
        const parsed = parseReservationCsv(text);
        incoming.push(...parsed);
      }

      const { merged, newlyAdded } = mergeReservations(existing, incoming);
      const timestamp = saveReservationsToStorage(merged);

      if (newlyAdded.length > 0) {
        saveReservationDiff(newlyAdded);
      } else {
        clearReservationDiff();
      }

      setReservationStatus({
        lastUpdated: timestamp,
        total: merged.length,
      });
    } catch (error) {
      console.error(error);
      setReservationUploadError("予約ログCSVの解析に失敗しました。フォーマットをご確認ください。");
    } finally {
      input.value = "";
      setIsUploadingReservation(false);
    }
  };

  const handleSurveyUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const files = input.files ? Array.from(input.files) : [];
    if (files.length === 0) {
      return;
    }

    setSurveyUploadError(null);
    setIsUploadingSurvey(true);

    try {
      const existing = loadSurveyDataFromStorage();
      const incoming: SurveyData[] = [];

      for (const file of files) {
        const text = await file.text();
        const fileType = determineSurveyFileType(file.name);
        const parsed = parseSurveyCsv(text, fileType);
        incoming.push(...parsed);
      }

      const merged = mergeSurveyData(existing, incoming);
      const timestamp = saveSurveyDataToStorage(merged);

      setSurveyStatus({
        lastUpdated: timestamp,
        total: merged.length,
        byType: summarizeSurveyByType(merged),
      });
    } catch (error) {
      console.error(error);
      setSurveyUploadError("アンケートCSVの解析に失敗しました。");
    } finally {
      input.value = "";
      setIsUploadingSurvey(false);
    }
  };

  const handleListingUpload =
    (category: ListingCategory) => async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const files = input.files ? Array.from(input.files) : [];
      if (files.length === 0) {
        return;
      }

      setListingUploadError(null);
      setIsUploadingListing((state) => ({
        ...state,
        [category]: true,
      }));

      try {
        const existing = loadListingDataFromStorage();
        const incoming: ListingData[] = [];

        for (const file of files) {
          const text = await file.text();
          const parsed = parseListingCsv(text);
          incoming.push(...parsed);
        }

        const merged = mergeListingData(existing, category, incoming);
        const timestamp = saveListingDataToStorage(merged);

        const totals = createEmptyListingTotals();
        merged.forEach((item) => {
          totals[item.category] = item.data.length;
        });

        setListingStatus({
          lastUpdated: timestamp,
          totals,
        });
      } catch (error) {
        console.error(error);
        setListingUploadError("リスティング広告CSVの解析に失敗しました。");
      } finally {
        input.value = "";
        setIsUploadingListing((state) => ({
          ...state,
          [category]: false,
        }));
      }
    };

  const handleDiagnosisUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const files = input.files ? Array.from(input.files) : [];
    if (files.length === 0) {
      return;
    }

    setDiagnosisUploadError(null);
    setIsUploadingDiagnosis(true);

    try {
      const existing = loadDiagnosisFromStorage();
      const incoming: DiagnosisRecord[] = [];

      for (const file of files) {
        const text = await file.text();
        const parsed = parseDiagnosisCsv(text);
        incoming.push(...parsed);
      }

      const merged = mergeDiagnosisRecords(existing, incoming);
    const timestamp = saveDiagnosisToStorage(merged);

    setDiagnosisRecords(merged);
    setDiagnosisStatus({
      lastUpdated: timestamp,
      total: merged.length,
      byDepartment: calculateDiagnosisDepartmentTotals(merged),
      byCategory: calculateDiagnosisCategoryTotals(merged),
    });
  } catch (error) {
      console.error(error);
      setDiagnosisUploadError("傷病名CSVの解析に失敗しました。フォーマットをご確認ください。");
    } finally {
      input.value = "";
      setIsUploadingDiagnosis(false);
    }
  };

  const handleShare = async () => {
    if (records.length === 0) {
      setUploadError("共有するカルテ集計データがありません。");
      return;
    }

    setIsSharing(true);
    setUploadError(null);

    try {
      const generatedAt = new Date().toISOString();
      const reservationsData = loadReservationsFromStorage();
      const surveyData = loadSurveyDataFromStorage();
      const listingData = loadListingDataFromStorage();
      const diagnosisData = loadDiagnosisFromStorage();

      const bundle: SharedDataBundle = {
        version: 1,
        generatedAt,
        karteRecords: records,
        karteTimestamp: lastUpdated ?? generatedAt,
        reservations: reservationsData,
        reservationsTimestamp: loadReservationTimestamp(),
        surveyData,
        surveyTimestamp: loadSurveyTimestamp(),
        listingData,
        listingTimestamp: loadListingTimestamp(),
        diagnosisData,
        diagnosisTimestamp: loadDiagnosisTimestamp(),
      };

      const response = await uploadDataToR2({
        type: "karte",
        data: JSON.stringify(bundle),
      });

      setShareUrl(response.url);
      await navigator.clipboard.writeText(response.url);
      alert(`共有URLをクリップボードにコピーしました！\n\n${response.url}`);
    } catch (error) {
      console.error(error);
      setUploadError(`共有URLの生成に失敗しました: ${(error as Error).message}`);
    } finally {
      setIsSharing(false);
    }
  };

  const handleReset = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(KARTE_STORAGE_KEY);
    window.localStorage.removeItem(KARTE_TIMESTAMP_KEY);
    window.localStorage.removeItem(RESERVATION_STORAGE_KEY);
    window.localStorage.removeItem(RESERVATION_TIMESTAMP_KEY);
    window.localStorage.removeItem(RESERVATION_DIFF_STORAGE_KEY);
    window.localStorage.removeItem(SURVEY_STORAGE_KEY);
    window.localStorage.removeItem(SURVEY_TIMESTAMP_KEY);
    window.localStorage.removeItem(LISTING_STORAGE_KEY);
    window.localStorage.removeItem(LISTING_TIMESTAMP_KEY);
    window.localStorage.removeItem(DIAGNOSIS_STORAGE_KEY);
    window.localStorage.removeItem(DIAGNOSIS_TIMESTAMP_KEY);
    setRecords([]);
    setShareUrl(null);
    setLastUpdated(null);
    setUploadError(null);
    setReservationStatus({
      lastUpdated: null,
      total: 0,
    });
    setSurveyStatus({
      lastUpdated: null,
      total: 0,
      byType: createEmptySurveyCounts(),
    });
    setListingStatus({
      lastUpdated: null,
      totals: createEmptyListingTotals(),
    });
    setDiagnosisRecords([]);
    setDiagnosisStatus({
      lastUpdated: null,
      total: 0,
      byDepartment: createEmptyDiagnosisDepartmentTotals(),
      byCategory: createEmptyDiagnosisCategoryTotals(),
    });
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
        <section className="relative overflow-hidden rounded-3xl border border-brand-200 bg-gradient-to-r from-white via-brand-50 to-brand-100 p-8 shadow-card">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="space-y-4">
              <p className="text-sm font-semibold text-brand-600">Patient Insights Dashboard</p>
              <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">患者分析（カルテ集計）</h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                カルテ集計CSVをアップロードすると、2025年10月以降の月次指標
                （総患者・純初診・再初診・再診・平均年齢）を自動で可視化します。共有URLを使えば、同じ集計結果を閲覧専用モードで共有できます。
              </p>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-700 sm:px-5">
                <p className="mb-2 text-sm font-semibold text-emerald-900">患者区分の見方</p>
                <ul className="space-y-1">
                  <li>・<strong>純初診</strong> : 当院での受診が今回初めての患者様</li>
                  <li>・<strong>再初診</strong> : 過去に受診歴はあるが、新たな症状で初診扱いの患者様</li>
                  <li>・<strong>再診</strong> : 継続診療を目的とした患者様</li>
                </ul>
              </div>
              {isReadOnly && (
                <p className="rounded-2xl border border-dashed border-brand-300 bg-white/80 px-4 py-3 text-sm font-medium text-brand-700">
                  共有URLから閲覧中です。閲覧者が操作すると共有データにも反映されるため取り扱いにご注意ください。
                </p>
              )}
              {lastUpdated && (
                <p className="text-xs font-medium text-slate-500">
                  最終更新: {new Date(lastUpdated).toLocaleString("ja-JP")}
                </p>
              )}
            </div>
            <p className="text-xs text-slate-500">
              CSVのアップロードや共有はページ下部の「データ管理」セクションから操作できます。
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
        </section>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold text-slate-700">開始月:</label>
            <select
              value={startMonth}
              onChange={(event) => setStartMonth(event.target.value)}
              disabled={allAvailableMonths.length === 0}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">選択してください</option>
              {allAvailableMonths.map((month) => (
                <option key={month} value={month}>
                  {formatMonthLabel(month)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold text-slate-700">終了月:</label>
            <select
              value={endMonth}
              onChange={(event) => setEndMonth(event.target.value)}
              disabled={allAvailableMonths.length === 0}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">選択してください</option>
              {allAvailableMonths.map((month) => (
                <option key={month} value={month}>
                  {formatMonthLabel(month)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {stats.length > 0 ? (
          <>
            {latestStat && (
              <SectionCard 
                title={startMonth && endMonth && startMonth === endMonth 
                  ? `${formatMonthLabel(startMonth)} サマリー`
                  : startMonth && endMonth
                    ? `期間内最新月サマリー（${formatMonthLabel(latestStat.month)}）`
                    : "最新月サマリー"
                }
                description={startMonth && endMonth && startMonth !== endMonth 
                  ? `選択期間：${formatMonthLabel(startMonth)}〜${formatMonthLabel(endMonth)}`
                  : undefined
                }
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <StatCard
                    label={`${formatMonthLabel(latestStat.month)} 総患者`}
                    value={`${latestStat.totalPatients.toLocaleString("ja-JP")}名`}
                    tone="brand"
                    monthOverMonth={
                      isSingleMonthPeriod && previousMonthStat
                        ? calculateMonthOverMonth(latestStat.totalPatients, previousMonthStat.totalPatients)
                        : !isSingleMonthPeriod && firstStat
                          ? calculateMonthOverMonth(latestStat.totalPatients, firstStat.totalPatients)
                          : null
                    }
                    isSingleMonth={isSingleMonthPeriod}
                  />
                  <StatCard
                    label={`${formatMonthLabel(latestStat.month)} 純初診`}
                    value={`${latestStat.pureFirstVisits.toLocaleString("ja-JP")}名`}
                    tone="emerald"
                    monthOverMonth={
                      isSingleMonthPeriod && previousMonthStat
                        ? calculateMonthOverMonth(latestStat.pureFirstVisits, previousMonthStat.pureFirstVisits)
                        : !isSingleMonthPeriod && firstStat
                          ? calculateMonthOverMonth(latestStat.pureFirstVisits, firstStat.pureFirstVisits)
                          : null
                    }
                    isSingleMonth={isSingleMonthPeriod}
                  />
                  <StatCard
                    label={`${formatMonthLabel(latestStat.month)} 再初診`}
                    value={`${latestStat.returningFirstVisits.toLocaleString("ja-JP")}名`}
                    tone="muted"
                    monthOverMonth={
                      isSingleMonthPeriod && previousMonthStat
                        ? calculateMonthOverMonth(latestStat.returningFirstVisits, previousMonthStat.returningFirstVisits)
                        : !isSingleMonthPeriod && firstStat
                          ? calculateMonthOverMonth(latestStat.returningFirstVisits, firstStat.returningFirstVisits)
                          : null
                    }
                    isSingleMonth={isSingleMonthPeriod}
                  />
                  <StatCard
                    label={`${formatMonthLabel(latestStat.month)} 再診`}
                    value={`${latestStat.revisitCount.toLocaleString("ja-JP")}名`}
                    tone="accent"
                    monthOverMonth={
                      isSingleMonthPeriod && previousMonthStat
                        ? calculateMonthOverMonth(latestStat.revisitCount, previousMonthStat.revisitCount)
                        : !isSingleMonthPeriod && firstStat
                          ? calculateMonthOverMonth(latestStat.revisitCount, firstStat.revisitCount)
                          : null
                    }
                    isSingleMonth={isSingleMonthPeriod}
                  />
                  <StatCard
                    label={`${formatMonthLabel(latestStat.month)} 平均年齢`}
                    value={
                      latestStat.averageAge !== null
                        ? `${roundTo1Decimal(latestStat.averageAge)}歳`
                        : "データなし"
                    }
                    tone="muted"
                    monthOverMonth={
                      isSingleMonthPeriod && previousMonthStat && latestStat.averageAge !== null && previousMonthStat.averageAge !== null
                        ? { value: roundTo1Decimal(latestStat.averageAge - previousMonthStat.averageAge), percentage: roundTo1Decimal(((latestStat.averageAge - previousMonthStat.averageAge) / previousMonthStat.averageAge) * 100) }
                        : !isSingleMonthPeriod && firstStat && latestStat.averageAge !== null && firstStat.averageAge !== null
                          ? { value: roundTo1Decimal(latestStat.averageAge - firstStat.averageAge), percentage: roundTo1Decimal(((latestStat.averageAge - firstStat.averageAge) / firstStat.averageAge) * 100) }
                          : null
                    }
                    isSingleMonth={isSingleMonthPeriod}
                  />
                </div>
                <button
                  onClick={() => setShowSummaryChart(!showSummaryChart)}
                  className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  {showSummaryChart ? "グラフを非表示" : "グラフを表示"}
                </button>
                {showSummaryChart && (
                  <div className="mt-4">
                    <MonthlySummaryChart stats={stats} />
                  </div>
                )}
              </SectionCard>
            )}

            {stats.length > 1 && (
            <SectionCard 
              title={startMonth && endMonth && startMonth !== endMonth
                ? `月次推移（${formatMonthLabel(startMonth)}〜${formatMonthLabel(endMonth)}）`
                : "月次推移"
              }
              description="選択期間のカルテ集計を月別に一覧しています。"
            >
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2">月</th>
                      <th className="px-3 py-2">総患者</th>
                      <th className="px-3 py-2">純初診</th>
                      <th className="px-3 py-2">再初診</th>
                      <th className="px-3 py-2">再診</th>
                      <th className="px-3 py-2">平均年齢</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {stats
                      .slice()
                      .reverse()
                      .map((stat, index, arr) => {
                        const prevStat = arr[index + 1];
                        const totalMoM = prevStat ? calculateMonthOverMonth(stat.totalPatients, prevStat.totalPatients) : null;
                        const pureMoM = prevStat ? calculateMonthOverMonth(stat.pureFirstVisits, prevStat.pureFirstVisits) : null;
                        const returningMoM = prevStat ? calculateMonthOverMonth(stat.returningFirstVisits, prevStat.returningFirstVisits) : null;
                        const revisitMoM = prevStat ? calculateMonthOverMonth(stat.revisitCount, prevStat.revisitCount) : null;
                        const ageMoM = prevStat && stat.averageAge !== null && prevStat.averageAge !== null
                          ? { value: roundTo1Decimal(stat.averageAge - prevStat.averageAge), percentage: roundTo1Decimal(((stat.averageAge - prevStat.averageAge) / prevStat.averageAge) * 100) }
                          : null;
                        
                        return (
                        <tr key={stat.month} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-medium text-slate-900">
                            {formatMonthLabel(stat.month)}
                          </td>
                          <td className="px-3 py-2">
                            {stat.totalPatients.toLocaleString("ja-JP")}
                            {totalMoM && (
                              <span className={`ml-2 text-xs ${totalMoM.value >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                ({totalMoM.value >= 0 ? '+' : ''}{totalMoM.percentage}%)
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {stat.pureFirstVisits.toLocaleString("ja-JP")}
                            {pureMoM && (
                              <span className={`ml-2 text-xs ${pureMoM.value >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                ({pureMoM.value >= 0 ? '+' : ''}{pureMoM.percentage}%)
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {stat.returningFirstVisits.toLocaleString("ja-JP")}
                            {returningMoM && (
                              <span className={`ml-2 text-xs ${returningMoM.value >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                ({returningMoM.value >= 0 ? '+' : ''}{returningMoM.percentage}%)
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {stat.revisitCount.toLocaleString("ja-JP")}
                            {revisitMoM && (
                              <span className={`ml-2 text-xs ${revisitMoM.value >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                ({revisitMoM.value >= 0 ? '+' : ''}{revisitMoM.percentage}%)
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {stat.averageAge !== null ? `${roundTo1Decimal(stat.averageAge)}歳` : "—"}
                            {ageMoM && (
                              <span className={`ml-2 text-xs ${ageMoM.value >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                ({ageMoM.value >= 0 ? '+' : ''}{roundTo1Decimal(ageMoM.percentage)}%)
                              </span>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <button
                onClick={() => setShowTrendChart(!showTrendChart)}
                className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                {showTrendChart ? "グラフを非表示" : "グラフを表示"}
              </button>
              {showTrendChart && (
                <div className="mt-4">
                  <MonthlyTrendChart stats={stats} />
                </div>
              )}
            </SectionCard>
            )}
          </>
        ) : (
          <SectionCard title="集計データがありません">
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              {!hasAnyRecords
                ? "カルテ集計CSVをアップロードすると、月次指標が表示されます。"
                : !hasPeriodRecords
                  ? "選択した期間に該当するデータがありません。期間を変更して再度ご確認ください。"
                  : "選択された月に該当するデータがありません。条件を変更して再度ご確認ください。"}
            </p>
          </SectionCard>
        )}

        <SectionCard
          title={startMonth && endMonth && startMonth !== endMonth
            ? `診療科別 集計（${formatMonthLabel(startMonth)}〜${formatMonthLabel(endMonth)}）`
            : startMonth && endMonth && startMonth === endMonth
              ? `診療科別 集計（${formatMonthLabel(startMonth)}）`
              : "診療科別 集計"
          }
          description="診療科ごとの総患者・純初診・再初診・再診の件数です（「外国人自費」を含む診療科は除外しています）。"
        >
          {departmentStats.length > 0 ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {departmentStats.map((row) => {
                const prevRow = previousDepartmentStats.get(row.department);
                const totalMoM = prevRow ? calculateMonthOverMonth(row.total, prevRow.total) : null;
                const pureMoM = prevRow ? calculateMonthOverMonth(row.pureFirst, prevRow.pureFirst) : null;
                const returningMoM = prevRow ? calculateMonthOverMonth(row.returningFirst, prevRow.returningFirst) : null;
                const revisitMoM = prevRow ? calculateMonthOverMonth(row.revisit, prevRow.revisit) : null;
                const ageMoM = prevRow && row.averageAge !== null && prevRow.averageAge !== null
                  ? { value: roundTo1Decimal(row.averageAge - prevRow.averageAge), percentage: roundTo1Decimal(((row.averageAge - prevRow.averageAge) / prevRow.averageAge) * 100) }
                  : null;

                // 健康診断・人間ドック・予防接種は初再診の概念がないため非表示
                const isPreventiveCare =
                  row.department.includes("健康診断") ||
                  row.department.includes("人間ドック") ||
                  row.department.includes("予防接種");

                return (
                  <div
                    key={row.department}
                    className="group rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-soft transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-card"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-semibold text-slate-900 sm:text-base">
                        {row.department}
                      </h3>
                      <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-600">
                        {row.total.toLocaleString("ja-JP")}名
                      </span>
                    </div>
                    <div className="mt-4 grid gap-2">
                      <DepartmentMetric
                        icon={Users}
                        label="総患者"
                        value={`${row.total.toLocaleString("ja-JP")}名`}
                        accent="brand"
                        monthOverMonth={totalMoM}
                        isSingleMonth={isSingleMonthPeriod}
                      />
                      {!isPreventiveCare && (
                        <>
                          <DepartmentMetric
                            icon={UserPlus}
                            label="純初診"
                            value={`${row.pureFirst.toLocaleString("ja-JP")}名`}
                            caption={`${row.pureRate}%`}
                            accent="emerald"
                            monthOverMonth={pureMoM}
                            isSingleMonth={isSingleMonthPeriod}
                          />
                          <DepartmentMetric
                            icon={Undo2}
                            label="再初診"
                            value={`${row.returningFirst.toLocaleString("ja-JP")}名`}
                            caption={`${row.returningRate}%`}
                            accent="accent"
                            monthOverMonth={returningMoM}
                            isSingleMonth={isSingleMonthPeriod}
                          />
                          <DepartmentMetric
                            icon={RotateCcw}
                            label="再診"
                            value={`${row.revisit.toLocaleString("ja-JP")}名`}
                            caption={`${row.revisitRate}%`}
                            accent="muted"
                            monthOverMonth={revisitMoM}
                            isSingleMonth={isSingleMonthPeriod}
                          />
                        </>
                      )}
                      <DepartmentMetric
                        icon={Clock}
                        label="平均年齢"
                        value={row.averageAge !== null ? `${row.averageAge}歳` : "データなし"}
                        accent="muted"
                        monthOverMonth={ageMoM}
                        isSingleMonth={isSingleMonthPeriod}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-6 space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">カテゴリー別件数</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {DIAGNOSIS_CATEGORIES.map((category) => {
                  const current = diagnosisCategoryTotals[category] ?? 0;
                  const previous = previousDiagnosisCategoryTotals[category] ?? 0;
                  const diff = current - previous;
                  const percentage =
                    hasDiagnosisPrevious && previous > 0
                      ? roundTo1Decimal((diff / previous) * 100)
                      : null;
                  const badgeClass = DIAGNOSIS_CATEGORY_BADGE_CLASSES[category];
                  return (
                    <div
                      key={category}
                      className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-soft"
                    >
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${badgeClass}`}
                      >
                        {category}
                      </span>
                      <p className="mt-3 text-2xl font-bold text-slate-900">
                        {current.toLocaleString("ja-JP")}件
                      </p>
                      {hasDiagnosisPrevious && (
                        <p
                          className={`mt-1 text-xs font-medium ${
                            diff >= 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {diff >= 0 ? "+" : ""}
                          {diff.toLocaleString("ja-JP")}件
                          {percentage !== null
                            ? ` (${percentage >= 0 ? "+" : ""}${percentage.toLocaleString("ja-JP", {
                                maximumFractionDigits: 1,
                              })}%)`
                            : previous === 0 && current > 0
                              ? " (新規)"
                              : ""}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            </>
          ) : (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              {!hasAnyRecords
                ? "カルテ集計CSVをアップロードすると、診療科別の内訳が表示されます。"
                : !hasPeriodRecords
                  ? "選択した期間に該当する診療科データがありません。"
                  : "選択された月に該当する診療科データがありません。"}
            </p>
          )}
          {departmentStats.length > 0 && (
            <>
              <button
                onClick={() => setShowDepartmentChart(!showDepartmentChart)}
                className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                {showDepartmentChart ? "グラフを非表示" : "グラフを表示"}
              </button>
              {showDepartmentChart && (
                <div className="mt-4">
                  <DepartmentChart records={filteredClassified} />
                </div>
              )}
            </>
          )}
        </SectionCard>

        <SectionCard
          title={startMonth && endMonth && startMonth !== endMonth
            ? `曜日別平均患者数（${formatMonthLabel(startMonth)}〜${formatMonthLabel(endMonth)}）`
            : startMonth && endMonth && startMonth === endMonth
              ? `曜日別平均患者数（${formatMonthLabel(startMonth)}）`
              : "曜日別平均患者数"
          }
          description="月曜日から日曜日および祝日（12月27日〜1月3日含む）の診療科別平均患者数です。総合診療科と内視鏡の2つの診療科グループで集計しています。"
        >
          {filteredClassified.length > 0 ? (
            <>
              <button
                onClick={() => setShowWeekdayChart(!showWeekdayChart)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                {showWeekdayChart ? "グラフを非表示" : "グラフを表示"}
              </button>
              {showWeekdayChart && (
                <div className="mt-4">
                  <Suspense fallback={<div className="flex items-center justify-center py-8"><RefreshCw className="h-6 w-6 animate-spin text-brand-600" /></div>}>
                    <WeekdayAverageChart
                      records={filteredClassified}
                      startMonth={startMonth}
                      endMonth={endMonth}
                    />
                  </Suspense>
                </div>
              )}
            </>
          ) : (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              {!hasAnyRecords
                ? "カルテ集計CSVをアップロードすると、曜日別の平均患者数が表示されます。"
                : !hasPeriodRecords
                  ? "選択した期間に該当するデータがありません。"
                  : "選択された期間に該当するデータがありません。"}
            </p>
          )}
        </SectionCard>

        <SectionCard
          title="主病トレンド分析"
          description="傷病名一覧CSV（主病フラグ）から総合診療・発熱外来・オンライン診療（保険）の件数推移と増減を確認します。"
        >
          {diagnosisStatus.total === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              傷病名CSVをアップロードすると、主病データの推移が表示されます。
            </p>
          ) : !hasDiagnosisRecords ? (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              選択期間（{diagnosisRangeLabel}）に該当する主病データがありません。期間を変更して再度ご確認ください。
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span>対象期間: {diagnosisRangeLabel}</span>
                {hasDiagnosisPrevious && diagnosisPreviousLabel && (
                  <span>比較期間: {diagnosisPreviousLabel}</span>
                )}
                {diagnosisStatus.lastUpdated && (
                  <span>
                    最終更新: {new Date(diagnosisStatus.lastUpdated).toLocaleString("ja-JP")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                表示件数: {filteredDiagnosisRecords.length.toLocaleString("ja-JP")}件 / 登録総数:{" "}
                {diagnosisStatus.total.toLocaleString("ja-JP")}件
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {DIAGNOSIS_TARGET_DEPARTMENTS.map((department) => {
                  const current = diagnosisDepartmentTotals[department] ?? 0;
                  const previous = previousDiagnosisTotals[department] ?? 0;
                  const diff = current - previous;
                  const percentage =
                    hasDiagnosisPrevious && previous > 0
                      ? roundTo1Decimal((diff / previous) * 100)
                      : null;
                  return (
                    <div
                      key={department}
                      className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-soft"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {department}
                      </p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">
                        {current.toLocaleString("ja-JP")}件
                      </p>
                      {hasDiagnosisPrevious && (
                        <p
                          className={`mt-1 text-xs font-medium ${
                            diff >= 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {diff >= 0 ? "+" : ""}
                          {diff.toLocaleString("ja-JP")}件
                          {percentage !== null
                            ? ` (${percentage >= 0 ? "+" : ""}${percentage.toLocaleString("ja-JP", {
                                maximumFractionDigits: 1,
                              })}%)`
                            : previous === 0 && current > 0
                              ? " (新規)"
                              : ""}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              {canShowDiagnosisChart && (
                <>
                  <button
                    onClick={() => setShowDiagnosisChart((value) => !value)}
                    className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    {showDiagnosisChart ? "グラフを非表示" : "月次トレンドを表示"}
                  </button>
                  {showDiagnosisChart && (
                    <div className="mt-4">
                      <Suspense
                        fallback={
                          <div className="rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-600">
                            グラフを準備中です...
                          </div>
                        }
                      >
                        <DiagnosisMonthlyChart summaries={diagnosisMonthlyInRange} />
                      </Suspense>
                    </div>
                  )}
                </>
              )}
              {canShowDiagnosisCategoryChart && (
                <>
                  <button
                    onClick={() => setShowDiagnosisCategoryChart((value) => !value)}
                    className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    {showDiagnosisCategoryChart ? "カテゴリ別推移を非表示" : "カテゴリ別推移を表示"}
                  </button>
                  {showDiagnosisCategoryChart && (
                    <div className="mt-4">
                      <Suspense
                        fallback={
                          <div className="rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-600">
                            グラフを準備中です...
                          </div>
                        }
                      >
                        <DiagnosisCategoryChart summaries={diagnosisCategoryMonthlyInRange} />
                      </Suspense>
                    </div>
                  )}
                </>
              )}
              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                {diagnosisTopDiseasesByDepartment.map(({ department, items }) => (
                  <div
                    key={department}
                    className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-soft"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900">{department}の上位傷病</h3>
                      <span className="text-xs text-slate-500">
                        {items.length > 0
                          ? `${items.reduce((acc, item) => acc + item.total, 0).toLocaleString("ja-JP")}件`
                          : "0件"}
                      </span>
                    </div>
                    {items.length > 0 ? (
                      <ol className="mt-3 space-y-2 text-sm text-slate-700">
                        {items.map((item, index) => {
                          const diff = item.diff;
                          const percentage =
                            hasDiagnosisPrevious && item.previous > 0
                              ? roundTo1Decimal((diff / item.previous) * 100)
                              : null;
                          const diffLabel =
                            hasDiagnosisPrevious && (diff !== 0 || item.previous > 0)
                              ? `${diff >= 0 ? "+" : ""}${diff.toLocaleString("ja-JP")}件${
                                  percentage !== null
                                    ? ` (${percentage >= 0 ? "+" : ""}${percentage.toLocaleString("ja-JP", {
                                        maximumFractionDigits: 1,
                                      })}%)`
                                    : ""
                                }`
                              : null;
                          return (
                            <li key={item.diseaseName} className="flex items-center justify-between gap-3">
                              <span className="flex items-center gap-2">
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-600">
                                  {index + 1}
                                </span>
                                <span className="font-medium text-slate-800">{item.diseaseName}</span>
                              </span>
                              <span className="text-right text-xs text-slate-500">
                                {item.total.toLocaleString("ja-JP")}件
                                {diffLabel && (
                                  <span
                                    className={`ml-2 font-medium ${
                                      diff >= 0 ? "text-emerald-600" : "text-red-600"
                                    }`}
                                  >
                                    {diffLabel}
                                  </span>
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    ) : (
                      <p className="mt-3 text-xs text-slate-500">
                        この期間に登録された主病データはありません。
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-6 space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">カテゴリー別トップ傷病</h3>
                <div className="grid gap-4 lg:grid-cols-3">
                  {diagnosisTopDiseasesByCategory.map(({ category, items }) => (
                    <div
                      key={category}
                      className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-soft"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-900">{category}</h3>
                        <span className="text-xs text-slate-500">
                          {items.length > 0
                            ? `${items.reduce((acc, item) => acc + item.total, 0).toLocaleString("ja-JP")}件`
                            : "0件"}
                        </span>
                      </div>
                      {items.length > 0 ? (
                        <ol className="mt-3 space-y-2 text-sm text-slate-700">
                          {items.map((item, index) => {
                            const diff = item.diff;
                            const percentage =
                              hasDiagnosisPrevious && item.previous > 0
                                ? roundTo1Decimal((diff / item.previous) * 100)
                                : null;
                            const diffLabel =
                              hasDiagnosisPrevious && (diff !== 0 || item.previous > 0)
                                ? `${diff >= 0 ? "+" : ""}${diff.toLocaleString("ja-JP")}件${
                                    percentage !== null
                                      ? ` (${percentage >= 0 ? "+" : ""}${percentage.toLocaleString("ja-JP", {
                                          maximumFractionDigits: 1,
                                        })}%)`
                                      : ""
                                  }`
                                : null;
                            return (
                              <li
                                key={`${category}-${item.diseaseName}`}
                                className="flex items-center justify-between gap-3"
                              >
                                <span className="flex items-center gap-2">
                                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                                    {index + 1}
                                  </span>
                                  <span className="font-medium text-slate-800">{item.diseaseName}</span>
                                </span>
                                <span className="text-right text-xs text-slate-500">
                                  {item.total.toLocaleString("ja-JP")}件
                                  {diffLabel && (
                                    <span
                                      className={`ml-2 font-medium ${
                                        diff >= 0 ? "text-emerald-600" : "text-red-600"
                                      }`}
                                    >
                                      {diffLabel}
                                    </span>
                                  )}
                                </span>
                              </li>
                            );
                          })}
                        </ol>
                      ) : (
                        <p className="mt-3 text-xs text-slate-500">
                          この期間に登録された該当カテゴリーの主病データはありません。
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </SectionCard>

        <SectionCard
          title="データ管理"
          description="カルテ集計の差し替えや共有URL発行に加え、他指標のCSV取り込みもまとめて管理します。"
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              {isReadOnly
                ? "共有URLから閲覧中です。操作内容は公開データに即時反映されるため取り扱いにご注意ください。"
                : "カルテ集計に加えて、予約ログ・アンケート・広告のCSVもこのページでまとめて更新できます。共有URLはコピーして関係者へ連携してください。"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-emerald-200 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 sm:w-auto">
                <Upload className="h-4 w-4" />
                CSVを選択
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleUpload}
                  multiple
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={handleShare}
                disabled={isSharing || records.length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-full border border-emerald-200 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
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
                disabled={records.length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <RefreshCw className="h-4 w-4" />
                集計データをリセット
              </button>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
              <p className="text-xs font-semibold text-slate-700">その他のデータ管理</p>
              <p className="text-[11px] text-slate-500">
                以下でアップロードすると予約ログ・アンケート・広告の各ページへ即時反映されます。
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-brand-200 bg-white/90 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-brand-700">予約ログCSV</p>
                      <p className="text-xs text-slate-500">受付ログ分析ダッシュボードで利用します。</p>
                    </div>
                    <div className="text-right text-[11px] text-slate-500">
                      <p>
                        最終更新:{" "}
                        {reservationStatus.lastUpdated
                          ? new Date(reservationStatus.lastUpdated).toLocaleString("ja-JP")
                          : "未登録"}
                      </p>
                      <p>
                        登録件数: {reservationStatus.total.toLocaleString("ja-JP")}件
                      </p>
                    </div>
                  </div>
                  <label
                    className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition sm:w-auto ${
                      isUploadingReservation
                        ? "pointer-events-none border-brand-100 bg-brand-50 text-brand-300"
                        : "border-brand-200 text-brand-600 hover:bg-brand-50"
                    }`}
                  >
                    <Upload className="h-4 w-4" />
                    {isUploadingReservation ? "アップロード中..." : "予約ログCSVを選択"}
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleReservationUpload}
                      multiple
                      disabled={isUploadingReservation}
                      className="hidden"
                    />
                  </label>
                  {reservationUploadError && (
                    <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                      {reservationUploadError}
                    </p>
                  )}
                </div>
                <div className="rounded-2xl border border-purple-200 bg-white/90 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-purple-700">アンケートCSV</p>
                      <p className="text-xs text-slate-500">来院経路アンケートの可視化に利用します。</p>
                    </div>
                    <div className="text-right text-[11px] text-slate-500">
                      <p>
                        最終更新:{" "}
                        {surveyStatus.lastUpdated
                          ? new Date(surveyStatus.lastUpdated).toLocaleString("ja-JP")
                          : "未登録"}
                      </p>
                      <p>
                        登録件数: {surveyStatus.total.toLocaleString("ja-JP")}件
                      </p>
                      <p>
                        内訳: 外来 {surveyStatus.byType["外来"].toLocaleString("ja-JP")}件 / 内視鏡 {surveyStatus.byType["内視鏡"].toLocaleString("ja-JP")}件
                      </p>
                    </div>
                  </div>
                  <label
                    className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition sm:w-auto ${
                      isUploadingSurvey
                        ? "pointer-events-none border-purple-100 bg-purple-50 text-purple-300"
                        : "border-purple-200 text-purple-600 hover:bg-purple-50"
                    }`}
                  >
                    <Upload className="h-4 w-4" />
                    {isUploadingSurvey ? "アップロード中..." : "アンケートCSVを選択"}
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleSurveyUpload}
                      multiple
                      disabled={isUploadingSurvey}
                      className="hidden"
                    />
                  </label>
                  {surveyUploadError && (
                    <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                      {surveyUploadError}
                    </p>
                  )}
                </div>
                <div className="rounded-2xl border border-amber-200 bg-white/90 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-amber-700">傷病名CSV（主病）</p>
                      <p className="text-xs text-slate-500">主病トレンド分析セクションで利用します。</p>
                    </div>
                    <div className="text-right text-[11px] text-slate-500">
                      <p>
                        最終更新:{" "}
                        {diagnosisStatus.lastUpdated
                          ? new Date(diagnosisStatus.lastUpdated).toLocaleString("ja-JP")
                          : "未登録"}
                      </p>
                      <p>登録件数: {diagnosisStatus.total.toLocaleString("ja-JP")}件</p>
                      <p>
                        内訳:{" "}
                        {DIAGNOSIS_TARGET_DEPARTMENTS.map((department, index) => (
                          <span key={department}>
                            {index > 0 ? " / " : ""}
                            {department}{" "}
                            {diagnosisStatus.byDepartment[department].toLocaleString("ja-JP")}件
                          </span>
                        ))}
                      </p>
                      <p>
                        カテゴリ内訳:{" "}
                        {DIAGNOSIS_CATEGORIES.map((category, index) => (
                          <span key={category}>
                            {index > 0 ? " / " : ""}
                            {category}{" "}
                            {diagnosisStatus.byCategory[category].toLocaleString("ja-JP")}件
                          </span>
                        ))}
                      </p>
                    </div>
                  </div>
                  <label
                    className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition sm:w-auto ${
                      isUploadingDiagnosis
                        ? "pointer-events-none border-amber-100 bg-amber-50 text-amber-300"
                        : "border-amber-200 text-amber-600 hover:bg-amber-50"
                    }`}
                  >
                    <Upload className="h-4 w-4" />
                    {isUploadingDiagnosis ? "アップロード中..." : "傷病名CSVを選択"}
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleDiagnosisUpload}
                      multiple
                      disabled={isUploadingDiagnosis}
                      className="hidden"
                    />
                  </label>
                  {diagnosisUploadError && (
                    <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                      {diagnosisUploadError}
                    </p>
                  )}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 space-y-3 md:col-span-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-700">リスティング広告CSV</p>
                      <p className="text-xs text-slate-500">カテゴリ別に広告実績を更新します。</p>
                    </div>
                    <div className="text-right text-[11px] text-slate-500">
                      <p>
                        最終更新:{" "}
                        {listingStatus.lastUpdated
                          ? new Date(listingStatus.lastUpdated).toLocaleString("ja-JP")
                          : "未登録"}
                      </p>
                      <p>
                        登録件数:{" "}
                        {LISTING_CATEGORIES.map((category, index) => (
                          <span key={category}>
                            {index > 0 ? " / " : ""}
                            {category} {listingStatus.totals[category].toLocaleString("ja-JP")}件
                          </span>
                        ))}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {LISTING_CATEGORIES.map((category) => {
                      const uploading = isUploadingListing[category];
                      return (
                        <label
                          key={category}
                          className={`flex cursor-pointer items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                            uploading
                              ? "pointer-events-none border-slate-100 bg-slate-50 text-slate-400"
                              : "border-slate-200 text-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          <Upload className="h-4 w-4" />
                          {category}CSV
                          <input
                            type="file"
                            accept=".csv,text/csv"
                            onChange={handleListingUpload(category)}
                            multiple
                            disabled={uploading}
                            className="hidden"
                          />
                        </label>
                      );
                    })}
                  </div>
                  {listingUploadError && (
                    <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                      {listingUploadError}
                    </p>
                  )}
                </div>
              </div>
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
