"use client";

import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  lazy,
  Suspense,
  useRef,
  type ChangeEvent,
} from "react";
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
  TrendingUp,
  ChevronDown,
  Download,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Papa from "papaparse";
import Holidays from "date-holidays";
import { uploadDataToR2, fetchDataFromR2 } from "@/lib/dataShare";
import {
  aggregateKarteMonthly,
  classifyKarteRecords,
  type KarteMonthlyStat,
  type KarteRecord,
  type KarteRecordWithCategory,
} from "@/lib/karteAnalytics";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  type Reservation,
  parseReservationCsv,
  mergeReservations,
  loadReservationsFromStorage,
  saveReservationsToStorage,
  loadReservationTimestamp,
  loadReservationDiff,
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
import {
  setCompressedItem,
  getCompressedItem,
  clearCompressedItem,
} from "@/lib/storageCompression";
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
  type SalesMonthlyData,
  parseSalesCsv,
  loadSalesDataFromStorage,
  saveSalesDataToStorage,
  upsertSalesMonth,
  clearSalesDataStorage,
  SALES_TIMESTAMP_KEY,
} from "@/lib/salesData";
import {
  type ExpenseRecord,
  parseExpenseCsv,
  loadExpenseData,
  saveExpenseData,
  clearExpenseData,
} from "@/lib/expenseData";
import { isHoliday } from "@/lib/dateUtils";
import { AnalysisFilterPortal } from "@/components/AnalysisFilterPortal";
import { useAnalysisPeriodRange } from "@/hooks/useAnalysisPeriodRange";
import { setAnalysisPeriodLabel } from "@/lib/analysisPeriod";
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
import { KARTE_STORAGE_KEY, KARTE_TIMESTAMP_KEY } from "@/lib/storageKeys";
import type { SharedDataBundle } from "@/lib/sharedBundle";
import { normalizeNameForMatching } from "@/lib/patientIdentity";
import { LifestyleViewContext } from "./LifestyleViewContext";


// --- 大容量カルテ保存のフォールバックユーティリティ ---
function extractSortedMonths(records: KarteRecord[]): string[] {
  const set = new Set<string>();
  for (const r of records) {
    if (r.monthKey) set.add(r.monthKey);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function filterRecordsByLastMonths(records: KarteRecord[], keepMonths: number): KarteRecord[] {
  const months = extractSortedMonths(records);
  if (months.length <= keepMonths) return records;
  const startIndex = Math.max(0, months.length - keepMonths);
  const threshold = months[startIndex];
  return records.filter((r) => r.monthKey >= threshold);
}

function saveKarteWithQuotaFallback(records: KarteRecord[], timestamp: string): {
  saved: boolean;
  prunedCount: number | null;
  usedRecords: KarteRecord[];
} {
  try {
    setCompressedItem(KARTE_STORAGE_KEY, JSON.stringify(records));
    if (typeof window !== "undefined") {
      window.localStorage.setItem(KARTE_TIMESTAMP_KEY, timestamp);
    }
    return { saved: true, prunedCount: null, usedRecords: records };
  } catch {
    const candidates = [18, 12, 9, 6, 3];
    for (const keep of candidates) {
      const pruned = filterRecordsByLastMonths(records, keep);
      try {
        setCompressedItem(KARTE_STORAGE_KEY, JSON.stringify(pruned));
        if (typeof window !== "undefined") {
          window.localStorage.setItem(KARTE_TIMESTAMP_KEY, timestamp);
        }
        return { saved: true, prunedCount: keep, usedRecords: pruned };
      } catch {
        // try next keep size
      }
    }
    return { saved: false, prunedCount: null, usedRecords: records };
  }
}

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
const UnitPriceWeekdayChart = lazy(() =>
  import("@/components/patients/UnitPriceWeekdayChart").then((m) => ({
    default: m.UnitPriceWeekdayChart,
  })),
);
const DiagnosisMonthlyChart = lazy(() =>
  import("@/components/patients/DiagnosisMonthlyChart").then((m) => ({
    default: m.DiagnosisMonthlyChart,
  })),
);
const AgeGroupAnalysisSection = lazy(() =>
  import("@/components/patients/AgeGroupAnalysisSection").then((m) => ({
    default: m.AgeGroupAnalysisSection,
  })),
);
const DiagnosisCategoryChart = lazy(() =>
  import("@/components/patients/DiagnosisCategoryChart").then((m) => ({
    default: m.DiagnosisCategoryChart,
  })),
);

const KARTE_MIN_MONTH = "2000-01";

const LISTING_CATEGORIES: ListingCategory[] = ["内科", "発熱外来", "胃カメラ", "大腸カメラ"];
const SURVEY_FILE_TYPES: SurveyFileType[] = ["外来", "内視鏡"];

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);

type MultivariateSegmentKey = "overall" | "general" | "fever";

const MULTIVARIATE_SEGMENT_ENTRIES: Array<{
  id: MultivariateSegmentKey;
  label: string;
  gradientClass: string;
  ringClass: string;
  chipClass: string;
  barColor: string;
  lineColor: string;
}> = [
  {
    id: "overall",
    label: "全体",
    gradientClass: "from-slate-800 via-slate-700 to-slate-900",
    ringClass: "ring-slate-300",
    chipClass: "bg-slate-800/40 text-slate-100",
    barColor: "#334155",
    lineColor: "#94a3b8",
  },
  {
    id: "general",
    label: "総合診療",
    gradientClass: "from-emerald-700 via-emerald-600 to-teal-700",
    ringClass: "ring-emerald-200",
    chipClass: "bg-emerald-600/35 text-emerald-50",
    barColor: "#047857",
    lineColor: "#6ee7b7",
  },
  {
    id: "fever",
    label: "発熱外来",
    gradientClass: "from-rose-600 via-amber-500 to-rose-700",
    ringClass: "ring-rose-200",
    chipClass: "bg-rose-500/35 text-rose-50",
    barColor: "#e11d48",
    lineColor: "#fbbf24",
  },
];

const MULTIVARIATE_SEGMENT_ORDER = MULTIVARIATE_SEGMENT_ENTRIES.map((entry) => entry.id);
const MULTIVARIATE_SEGMENT_CONFIG = MULTIVARIATE_SEGMENT_ENTRIES.reduce<
  Record<MultivariateSegmentKey, (typeof MULTIVARIATE_SEGMENT_ENTRIES)[number]>
>((acc, entry) => {
  acc[entry.id] = entry;
  return acc;
}, {
  overall: MULTIVARIATE_SEGMENT_ENTRIES[0]!,
  general: MULTIVARIATE_SEGMENT_ENTRIES[1]!,
  fever: MULTIVARIATE_SEGMENT_ENTRIES[2]!,
});

const MULTIVARIATE_AGE_BANDS = [
  { id: "0-19", label: "0-19歳", min: 0, max: 19 },
  { id: "20-39", label: "20-39歳", min: 20, max: 39 },
  { id: "40-59", label: "40-59歳", min: 40, max: 59 },
  { id: "60-79", label: "60-79歳", min: 60, max: 79 },
  { id: "80+", label: "80歳以上", min: 80, max: null },
  { id: "unknown", label: "年齢不明", min: null, max: null },
] as const;

type MultivariateAgeBand = (typeof MULTIVARIATE_AGE_BANDS)[number];

type MultivariateAgeBreakdown = {
  ageBandId: string;
  label: string;
  total: number;
  share: number;
  avgPoints: number | null;
};

type MultivariateSlotStat = {
  weekday: number;
  hour: number;
  totalPatients: number;
  avgPoints: number | null;
  ageBreakdown: MultivariateAgeBreakdown[];
};

type MultivariateWeekdayGroup = {
  weekday: number;
  label: string;
  slots: MultivariateSlotStat[];
};

type MultivariateLeadingAgeBand =
  | { id: string; label: string; total: number; avgPoints: number | null }
  | null;

type MultivariateSegmentInsight = {
  key: MultivariateSegmentKey;
  label: string;
  hasData: boolean;
  totalMatches: number;
  unmatchedRecords: number;
  unmatchedReservations: number;
  weekdayGroups: MultivariateWeekdayGroup[];
  topSlot: MultivariateSlotStat | null;
  highestAvgSlot: MultivariateSlotStat | null;
  leadingAgeBand: MultivariateLeadingAgeBand;
  highlights: string[];
};

type MultivariateInsights = {
  hasData: boolean;
  segments: Record<MultivariateSegmentKey, MultivariateSegmentInsight>;
};

const createEmptyListingTotals = (): Record<ListingCategory, number> =>
  LISTING_CATEGORIES.reduce(
    (acc, category) => {
      acc[category] = 0;
      return acc;
    },
    {} as Record<ListingCategory, number>,
  );

const createListingUploadState = (initial: boolean): Record<ListingCategory, boolean> =>
  LISTING_CATEGORIES.reduce(
    (acc, category) => {
      acc[category] = initial;
      return acc;
    },
    {} as Record<ListingCategory, boolean>,
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

const buildShareUrl = (workerUrl: string, id: string) => {
  if (typeof window === "undefined") {
    const url = new URL(workerUrl);
    url.searchParams.set("data", id);
    return url.toString();
  }
  const { origin, pathname } = window.location;
  const isLocalHost = /localhost|127\.0\.0\.1|0\.0\.0\.0|::1/.test(origin);
  const baseUrl = isLocalHost
    ? new URL(workerUrl)
    : new URL(`${origin}${pathname}`);
  baseUrl.searchParams.set("data", id);
  return baseUrl.toString();
};

const DIAGNOSIS_CATEGORY_BADGE_CLASSES: Record<DiagnosisCategory, string> = {
  生活習慣病: "bg-emerald-50 text-emerald-600",
  外科: "bg-orange-50 text-orange-600",
  皮膚科: "bg-rose-50 text-rose-600",
  その他: "bg-slate-50 text-slate-600",
};

const INSIGHT_PRIORITY_DEPARTMENTS = [
  "総合診療＋内科",
  "総合診療",
  "内科",
  "発熱外来",
  "オンライン診療（保険）",
  "オンライン診療（自費）",
  "外国人自費",
] as const;

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
  points: number;
  averagePoints: number | null;
  averageAmount: number | null;
  averageAge: number | null;
  pureRate: number;
  returningRate: number;
  revisitRate: number;
};

type ShiftInsightRow = {
  key: string;
  department: string;
  weekday: number;
  hour: number;
  patientCount: number;
  totalPoints: number;
  averagePoints: number | null;
  averageAmount: number | null;
  averageAge: number | null;
  pureRate: number | null;
  returningRate: number | null;
  revisitRate: number | null;
};

type ShiftAnalysisResult = {
  departments: string[];
  byDepartment: Map<string, ShiftInsightRow[]>;
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

const formatIsoToSlash = (value: string | null | undefined) => {
  if (!value) {
    return "";
  }
  return value.replace(/-/g, "/");
};

const formatHourLabel = (value: number | null | undefined) => {
  if (value === null || value === undefined) {
    return "";
  }
  if (!Number.isFinite(value)) {
    return "";
  }
  return `${String(value).padStart(2, "0")}:00`;
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

const parsePointValue = (raw: string | undefined): number | null => {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim().replace(/,/g, "");
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
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
    const points = parsePointValue(row["点数"]);
    const patientNameNormalized = normalizePatientName(
      row["患者氏名"] ?? row["患者名"] ?? row["氏名"],
    );
    const patientAddressRaw =
      row["患者住所"] ?? row["住所"] ?? row["住所1"] ?? row["患者住所1"];
    const patientAddress =
      typeof patientAddressRaw === "string" && patientAddressRaw.trim().length > 0
        ? patientAddressRaw.trim()
        : null;

    records.push({
      dateIso,
      monthKey,
      visitType,
      patientNumber,
      birthDateIso,
      department,
      points,
      patientNameNormalized,
      patientAddress,
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

const STAT_TONE_TEXT: Record<"brand" | "accent" | "muted" | "emerald", string> = {
  brand: "text-brand-600",
  accent: "text-accent-600",
  emerald: "text-emerald-600",
  muted: "text-slate-600",
};

const STAT_TONE_BADGE: Record<"brand" | "accent" | "muted" | "emerald", string> = {
  brand: "bg-brand-500/10 text-brand-600",
  accent: "bg-accent-500/10 text-accent-600",
  emerald: "bg-emerald-500/10 text-emerald-600",
  muted: "bg-slate-500/10 text-slate-600",
};

const STAT_TONE_CARD: Record<"brand" | "accent" | "muted" | "emerald", string> = {
  brand:
    "border-brand-200 bg-gradient-to-br from-brand-50/90 via-white to-white shadow-[0_18px_32px_-16px_rgba(59,130,246,0.45)]",
  accent:
    "border-accent-200 bg-gradient-to-br from-accent-50/90 via-white to-white shadow-[0_18px_32px_-16px_rgba(244,114,182,0.45)]",
  emerald:
    "border-emerald-200 bg-gradient-to-br from-emerald-50/90 via-white to-white shadow-[0_18px_32px_-16px_rgba(16,185,129,0.45)]",
  muted:
    "border-slate-200 bg-gradient-to-br from-slate-50/90 via-white to-white shadow-[0_18px_32px_-16px_rgba(100,116,139,0.35)]",
};

const StatCard = ({
  label,
  value,
  tone,
  monthOverMonth,
  isSingleMonth,
  secondaryLabel,
  secondaryValue,
}: {
  label: string;
  value: string;
  tone: "brand" | "accent" | "muted" | "emerald";
  monthOverMonth?: { value: number; percentage: number } | null;
  isSingleMonth: boolean;
  secondaryLabel?: string;
  secondaryValue?: string | null;
}) => {
  const toneText = STAT_TONE_TEXT[tone];
  const badgeClass = STAT_TONE_BADGE[tone];
  const cardClass = STAT_TONE_CARD[tone];

  return (
    <div
      className={`group relative overflow-hidden rounded-3xl border ${cardClass} p-5 transition-transform duration-200 hover:-translate-y-0.5`}
    >
      <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 sm:text-xs">
        {label}
      </dt>
      <dd className={`mt-3 text-3xl font-extrabold leading-tight sm:text-[32px] ${toneText}`}>
        {value}
      </dd>
      {secondaryLabel && secondaryValue && (
        <p className="mt-3 inline-flex items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-1 font-semibold ${badgeClass}`}>
            {secondaryLabel}
          </span>
          <span className="font-semibold text-slate-600">{secondaryValue}</span>
        </p>
      )}
      {monthOverMonth && (
        <p
          className={`mt-3 text-xs font-semibold ${
            monthOverMonth.value >= 0 ? "text-emerald-600" : "text-rose-600"
          }`}
        >
          {isSingleMonth ? "前月比" : "期間比"}: {monthOverMonth.value >= 0 ? "+" : ""}
          {monthOverMonth.value} ({monthOverMonth.percentage >= 0 ? "+" : ""}
          {monthOverMonth.percentage.toFixed(1)}%)
        </p>
      )}
    </div>
  );
};

type UnitPriceGroupId = "general" | "internal" | "endoscopy" | "fever";

const normalizeUnitPriceDepartment = (value: string) =>
  value.replace(/[\s・●()（）【】\[\]\-]/g, "").toLowerCase();

const UNIT_PRICE_GROUPS: Array<{
  id: UnitPriceGroupId;
  label: string;
  matcher: (normalized: string) => boolean;
}> = [
  {
    id: "general",
    label: "総合診療",
    matcher: (name) => name.includes("総合診療"),
  },
  {
    id: "fever",
    label: "発熱外来",
    matcher: (name) => name.includes("発熱外来") || name.includes("発熱"),
  },
  {
    id: "endoscopy",
    label: "内視鏡（保険）",
    matcher: (name) => name.includes("内視鏡") && !name.includes("自費"),
  },
  {
    id: "internal",
    label: "内科",
    matcher: (name) =>
      name.includes("内科") && !name.includes("内視鏡") && !name.includes("総合診療"),
  },
];

type LifestyleDiseaseType = "hypertension" | "diabetes" | "lipid" | "multiple";

const LIFESTYLE_DISEASE_TYPES: Array<{ id: LifestyleDiseaseType; label: string }> = [
  { id: "hypertension", label: "高血圧" },
  { id: "diabetes", label: "糖尿病" },
  { id: "lipid", label: "脂質異常症" },
  { id: "multiple", label: "複数疾患/その他" },
];

const LIFESTYLE_DISEASE_LABEL_MAP = new Map(
  LIFESTYLE_DISEASE_TYPES.map((item) => [item.id, item.label]),
);

type LifestyleStatus = "regular" | "delayed" | "atRisk";

const LIFESTYLE_STATUS_ORDER: LifestyleStatus[] = ["regular", "delayed", "atRisk"];

const LIFESTYLE_STATUS_CONFIG: Record<
  LifestyleStatus,
  {
    label: string;
    description: string;
    badge: string;
    card: string;
    percentText: string;
    percentChip: string;
  }
> = {
  regular: {
    label: "定期受診中",
    description: "最終来院から90日以内",
    badge: "bg-emerald-50 text-emerald-600",
    card: "border-emerald-200 bg-gradient-to-br from-emerald-50/80 via-white to-white",
    percentText: "text-emerald-700",
    percentChip: "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-200/70",
  },
  delayed: {
    label: "受診遅延",
    description: "最終来院から91〜150日",
    badge: "bg-amber-50 text-amber-600",
    card: "border-amber-200 bg-gradient-to-br from-amber-50/80 via-white to-white",
    percentText: "text-amber-700",
    percentChip: "bg-amber-500/10 text-amber-700 ring-1 ring-amber-200/70",
  },
  atRisk: {
    label: "離脱リスク",
    description: "最終来院から151日以上",
    badge: "bg-rose-50 text-rose-600",
    card: "border-rose-200 bg-gradient-to-br from-rose-50/80 via-white to-white",
    percentText: "text-rose-700",
    percentChip: "bg-rose-500/10 text-rose-700 ring-1 ring-rose-200/70",
  },
};

type RangeBucket = { id: string; label: string; min: number; max: number };

const LIFESTYLE_DAYS_BUCKETS: RangeBucket[] = [
  { id: "0-30", label: "0-30日", min: 0, max: 30 },
  { id: "31-60", label: "31-60日", min: 31, max: 60 },
  { id: "61-90", label: "61-90日", min: 61, max: 90 },
  { id: "91-120", label: "91-120日", min: 91, max: 120 },
  { id: "121-150", label: "121-150日", min: 121, max: 150 },
  { id: "151-180", label: "151-180日", min: 151, max: 180 },
  { id: "181-240", label: "181-240日", min: 181, max: 240 },
  { id: "241+", label: "241日以上", min: 241, max: Number.POSITIVE_INFINITY },
];

const LIFESTYLE_VISIT_BUCKETS: RangeBucket[] = [
  { id: "1-3", label: "1-3回", min: 1, max: 3 },
  { id: "4-6", label: "4-6回", min: 4, max: 6 },
  { id: "7-9", label: "7-9回", min: 7, max: 9 },
  { id: "10-12", label: "10-12回", min: 10, max: 12 },
  { id: "13+", label: "13回以上", min: 13, max: Number.POSITIVE_INFINITY },
];

type AgeGroupId = "20-39" | "40-49" | "50-59" | "60-69" | "70-79" | "80+";

const LIFESTYLE_AGE_GROUPS: Array<{ id: AgeGroupId; label: string; min: number; max: number }> = [
  { id: "20-39", label: "20-39歳", min: 20, max: 39 },
  { id: "40-49", label: "40-49歳", min: 40, max: 49 },
  { id: "50-59", label: "50-59歳", min: 50, max: 59 },
  { id: "60-69", label: "60-69歳", min: 60, max: 69 },
  { id: "70-79", label: "70-79歳", min: 70, max: 79 },
  { id: "80+", label: "80歳以上", min: 80, max: 150 },
];

const UNIT_PRICE_WEEKDAY_DEFINITIONS = [
  { key: "mon", label: "月曜", weekdayIndex: 1 },
  { key: "tue", label: "火曜", weekdayIndex: 2 },
  { key: "wed", label: "水曜", weekdayIndex: 3 },
  { key: "thu", label: "木曜", weekdayIndex: 4 },
  { key: "fri", label: "金曜", weekdayIndex: 5 },
  { key: "sat", label: "土曜", weekdayIndex: 6 },
  { key: "sun", label: "日曜", weekdayIndex: 0 },
  { key: "holiday", label: "祝日" },
] as const;

type UnitPriceWeekdayKey = (typeof UNIT_PRICE_WEEKDAY_DEFINITIONS)[number]["key"];

const getWeekdayKeyFromDate = (dateIso: string): UnitPriceWeekdayKey => {
  if (isHoliday(dateIso)) {
    return "holiday";
  }
  const weekday = new Date(`${dateIso}T00:00:00`);
  switch (weekday.getDay()) {
    case 0:
      return "sun";
    case 1:
      return "mon";
    case 2:
      return "tue";
    case 3:
      return "wed";
    case 4:
      return "thu";
    case 5:
      return "fri";
    case 6:
    default:
      return "sat";
  }
};

const normalizeLifestyleName = (value: string) =>
  value.replace(/\s+/g, "").toLowerCase();

const includesAnyKeyword = (normalized: string, keywords: string[]) =>
  keywords.some((keyword) => normalized.includes(keyword));

const determineLifestyleDiseaseTypes = (diseaseNames: Set<string>) => {
  const types = new Set<Exclude<LifestyleDiseaseType, "multiple">>();
  for (const name of diseaseNames) {
    const normalized = normalizeLifestyleName(name);
    if (includesAnyKeyword(normalized, ["高血圧"])) {
      types.add("hypertension");
    }
    if (includesAnyKeyword(normalized, ["糖尿病"])) {
      types.add("diabetes");
    }
    if (
      includesAnyKeyword(normalized, [
        "脂質異常",
        "ｺﾚｽﾃﾛｰﾙ",
        "コレステロール",
        "高脂血症",
      ])
    ) {
      types.add("lipid");
    }
  }
  return types;
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const differenceInDays = (baseIso: string, targetIso: string) => {
  const base = new Date(`${baseIso}T00:00:00`);
  const target = new Date(`${targetIso}T00:00:00`);
  if (Number.isNaN(base.getTime()) || Number.isNaN(target.getTime())) {
    return null;
  }
  const diff = Math.floor((base.getTime() - target.getTime()) / MS_PER_DAY);
  return diff < 0 ? 0 : diff;
};

const selectLifestyleStatus = (daysSinceLast: number | null): LifestyleStatus | null => {
  if (daysSinceLast === null) {
    return null;
  }
  if (daysSinceLast <= 90) {
    return "regular";
  }
  if (daysSinceLast <= 150) {
    return "delayed";
  }
  return "atRisk";
};

const normalizePatientNumberKey = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length === 0) {
    return null;
  }
  const parsed = Number.parseInt(digits, 10);
  if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
    return String(parsed);
  }
  return digits;
};

const createLifestylePatientKey = (
  patientNumber: string | null | undefined,
  patientName: string | null | undefined,
  birthDateIso: string | null | undefined,
) => {
  const normalizedNumber = normalizePatientNumberKey(patientNumber);
  if (normalizedNumber) {
    return `pn:${normalizedNumber}`;
  }
  const normalizedName = normalizePatientName(patientName);
  if (normalizedName && birthDateIso) {
    return `nb:${normalizedName}|${birthDateIso}`;
  }
  return null;
};

const formatDateLabel = (iso: string) => {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) {
    return iso;
  }
  return `${year}/${month}/${day}`;
};

const formatPercentage = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toLocaleString("ja-JP", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
};

type LifestylePatientSummary = {
  key: string;
  patientNumber: string | null;
  patientName: string | null;
  anonymizedId: string;
  diseaseType: LifestyleDiseaseType;
  diseaseLabels: string[];
  diseaseNames: string[];
  firstVisitDate: string;
  lastVisitDate: string;
  firstVisitMonth: string;
  firstVisitType: string | null;
  visitCount: number;
  status: LifestyleStatus;
  daysSinceLast: number;
  age: number | null;
};

type LifestyleDistributionItem = {
  id: string;
  label: string;
  count: number;
  percentage: number;
};

type LifestyleAnalysisResult = {
  totalPatients: number;
  rangeStartIso: string;
  baselineDateIso: string;
  patients: LifestylePatientSummary[];
  statusCounts: Record<LifestyleStatus, number>;
  continuationRate: number;
  daysDistribution: LifestyleDistributionItem[];
  visitDistribution: LifestyleDistributionItem[];
  diseaseStats: Array<{
    id: LifestyleDiseaseType;
    label: string;
    total: number;
    statusCounts: Record<LifestyleStatus, number>;
    rates: Record<LifestyleStatus, number>;
    averageVisits: number | null;
  }>;
  ageStats: {
    groups: Array<{
      id: AgeGroupId;
      label: string;
      count: number;
      statusCounts: Record<LifestyleStatus, number>;
      rates: Record<LifestyleStatus, number>;
      averageVisits: number | null;
    }>;
    ranking: Array<{ label: string; continuationRate: number; count: number }>;
  };
  delayedPatients: { total: number; list: LifestylePatientSummary[] };
  atRiskPatients: { total: number; list: LifestylePatientSummary[]; highEngagement: number };
};

const normalizePatientName = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const normalized = value
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizePatientNameForKey = (value: string | null | undefined): string | null => {
  const matching = normalizeNameForMatching(value);
  if (matching) {
    return matching;
  }
  return normalizePatientName(value);
};

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日", "祝日"] as const;
const WEEKDAY_PRESENTATION = [
  { weekday: 6, label: "日" },
  { weekday: 0, label: "月" },
  { weekday: 1, label: "火" },
  { weekday: 2, label: "水" },
  { weekday: 3, label: "木" },
  { weekday: 4, label: "金" },
  { weekday: 5, label: "土" },
  { weekday: 7, label: "祝日" },
] as const;

const getWeekdayLabel = (weekday: number): string =>
  WEEKDAY_LABELS[weekday] ?? "—";

const formatWeekdayWithSuffix = (weekday: number): string => {
  const label = getWeekdayLabel(weekday);
  return label === "祝日" ? label : `${label}曜`;
};

const formatHourLabel = (hour: number) => `${hour.toString().padStart(2, "0")}:00`;

const normalizeDepartmentLabel = (value: string) =>
  value.replace(/[\s・●()（）【】\[\]\-]/g, "").toLowerCase();

// 総合診療のキーワード配列
const GENERAL_DEPARTMENT_KEYWORDS = ["内科・外科外来（大岩医師）", "内科・外科外来"].map(normalizeDepartmentLabel);

// 発熱外来のキーワード配列
const FEVER_DEPARTMENT_KEYWORDS = ["発熱外来", "発熱・風邪症状外来", "風邪症状外来"].map(normalizeDepartmentLabel);

// 総合診療の判定
const isGeneralDepartment = (normalized: string): boolean => {
  return GENERAL_DEPARTMENT_KEYWORDS.some((kw) => normalized === kw);
};

// 発熱外来の判定
const isFeverDepartment = (normalized: string): boolean => {
  return FEVER_DEPARTMENT_KEYWORDS.some((kw) => normalized === kw);
};

const classifyDepartmentDisplayName = (value: string): string => {
  const trimmed = value.trim();
  const normalized = normalizeDepartmentLabel(trimmed);
  if (!normalized) {
    return "診療科未分類";
  }
  if (isGeneralDepartment(normalized)) {
    return "総合診療";
  }
  if (isFeverDepartment(normalized)) {
    return "発熱外来";
  }
  if (normalized.includes("オンライン診療")) {
    if (normalized.includes("保険")) {
      return "オンライン診療（保険）";
    }
    if (
      normalized.includes("自費") ||
      normalized.includes("自由診療") ||
      normalized.includes("aga") ||
      normalized.includes("ed")
    ) {
      return "オンライン診療（自費）";
    }
  }
  if (
    normalized.includes("外国人") ||
    normalized.includes("外国") ||
    normalized.includes("海外") ||
    normalized.includes("foreign") ||
    normalized.includes("inbound")
  ) {
    return "外国人自費";
  }
  if (normalized.includes("内科")) {
    return "内科";
  }
  if (normalized.includes("外科")) {
    return "外科";
  }
  return trimmed.length > 0 ? trimmed : "診療科未分類";
};

const HOLIDAYS_JP = new Holidays("JP");

const getIsoWeekday = (isoDate: string): number => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

const toNormalizedWeekdayIndex = (weekday: number): number => ((weekday + 6) % 7);

const isNewYearPeriodIso = (isoDate: string): boolean => {
  const [, monthStr, dayStr] = isoDate.split("-");
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (Number.isNaN(month) || Number.isNaN(day)) {
    return false;
  }
  if (month === 12 && day >= 27) {
    return true;
  }
  if (month === 1 && day <= 3) {
    return true;
  }
  return false;
};

const isJapaneseHolidayIso = (isoDate: string): boolean => {
  const result = HOLIDAYS_JP.isHoliday(isoDate);
  if (Array.isArray(result)) {
    return result.length > 0;
  }
  return Boolean(result);
};

const formatTimestampLabel = (value: string | null) =>
  value ? new Date(value).toLocaleString("ja-JP") : "未登録";

type PatientAnalysisPageContentProps = {
  mode?: "full" | "data-management";
};

export function PatientAnalysisPageContent({
  mode = "full",
}: PatientAnalysisPageContentProps = {}) {
  // 一時的に多変量解析の表示を無効化
  const ENABLE_MULTIVARIATE = false;
  const lifestyleOnly = useContext(LifestyleViewContext);
  const isDataManagementOnly = mode === "data-management";
  const [records, setRecords] = useState<KarteRecord[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isLoadingShared, setIsLoadingShared] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [showTrendChart, setShowTrendChart] = useState(false);
  const [showDepartmentChart, setShowDepartmentChart] = useState(false);
  const [showWeekdayChart, setShowWeekdayChart] = useState(false);
const [showUnitPriceChart, setShowUnitPriceChart] = useState(false);
const [insightTab, setInsightTab] = useState<"channel" | "department" | "time">("department");
const [selectedInsightSegment, setSelectedInsightSegment] =
  useState<MultivariateSegmentKey>("overall");
const [expandedWeekdayBySegment, setExpandedWeekdayBySegment] = useState<
  Record<MultivariateSegmentKey, number | null>
>({
  overall: null,
  general: null,
  fever: null,
});
  const [isManagementOpen, setIsManagementOpen] = useState(isDataManagementOnly);
  const [reservationsRecords, setReservationsRecords] = useState<Reservation[]>([]);
  const [selectedShiftDepartment, setSelectedShiftDepartment] = useState<string>("");
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
  const [isUploadingListing, setIsUploadingListing] = useState<Record<ListingCategory, boolean>>(
    createListingUploadState(false),
  );
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
  const [salesStatus, setSalesStatus] = useState<{
    lastUpdated: string | null;
    totalMonths: number;
    totalRevenue: number;
  }>({
    lastUpdated: null,
    totalMonths: 0,
    totalRevenue: 0,
  });
  const [isUploadingSales, setIsUploadingSales] = useState(false);
  const [salesUploadError, setSalesUploadError] = useState<string | null>(null);

  // 経費データ管理用state
  const [expenseStatus, setExpenseStatus] = useState<{
    lastUpdated: string | null;
    totalRecords: number;
    totalAmount: number;
  }>({
    lastUpdated: null,
    totalRecords: 0,
    totalAmount: 0,
  });
  const [isUploadingExpense, setIsUploadingExpense] = useState(false);
  const [expenseUploadError, setExpenseUploadError] = useState<string | null>(null);

  const updateExpenseSnapshot = useCallback(
    (data: ExpenseRecord[], explicitTimestamp?: string | null) => {
      const timestamp =
        explicitTimestamp ??
        (typeof window !== "undefined"
          ? window.localStorage.getItem("expense_timestamp")
          : null);
      setExpenseStatus({
        lastUpdated: timestamp,
        totalRecords: data.length,
        totalAmount: data.reduce((sum, r) => sum + r.amount, 0),
      });
    },
    [],
  );

  const updateSalesSnapshot = useCallback(
    (data: SalesMonthlyData[], explicitTimestamp?: string | null) => {
      const timestamp =
        explicitTimestamp ??
        (typeof window !== "undefined"
          ? window.localStorage.getItem(SALES_TIMESTAMP_KEY)
          : null);
      setSalesStatus({
        lastUpdated: timestamp,
        totalMonths: data.length,
        totalRevenue: data.reduce((sum, month) => sum + month.totalRevenue, 0),
      });
    },
    [],
  );

  const bulkUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [bulkQueue, setBulkQueue] = useState<File[]>([]);
  const [isBulkUploading, setIsBulkUploading] = useState(false);
  const [bulkUploadMessage, setBulkUploadMessage] = useState<string | null>(null);
  const [bulkUploadError, setBulkUploadError] = useState<string | null>(null);

  const applySharedBundle = useCallback(
    (bundle: SharedDataBundle, fallbackTimestamp?: string) => {
      const generatedAt = bundle.generatedAt ?? fallbackTimestamp ?? new Date().toISOString();
      const karteRecords = Array.isArray(bundle.karteRecords) ? bundle.karteRecords : [];
      const karteTimestamp = bundle.karteTimestamp ?? fallbackTimestamp ?? generatedAt;

      setUploadError(null);
      setShareUrl(null);
      // 容量に応じてフォールバック保存（必要に応じて期間を絞る）
      const result = saveKarteWithQuotaFallback(karteRecords, karteTimestamp);
      setRecords(result.usedRecords);
      setLastUpdated(karteTimestamp);
      if (!result.saved) {
        setUploadError("ローカル保存容量を超えました。共有URLでの保存をご検討ください。");
      } else if (result.prunedCount) {
        setUploadError(`保存容量超過のため直近${result.prunedCount}ヶ月分のみローカル保存しました。全件の保管は共有URLをご利用ください。`);
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
        setReservationsRecords(reservationsData);
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
        const saveResult = saveDiagnosisToStorage(
          diagnosisDataset,
          bundle.diagnosisTimestamp ?? fallbackTimestamp ?? generatedAt,
        );
        if (saveResult.warning) {
          console.warn(saveResult.warning);
        }
        setDiagnosisRecords(diagnosisDataset);
        setDiagnosisStatus({
          lastUpdated: saveResult.timestamp,
          total: diagnosisDataset.length,
          byDepartment: calculateDiagnosisDepartmentTotals(diagnosisDataset),
          byCategory: calculateDiagnosisCategoryTotals(diagnosisDataset),
        });
      }

      if (Array.isArray(bundle.salesData)) {
        const salesDataset = bundle.salesData as SalesMonthlyData[];
        const salesTimestamp = saveSalesDataToStorage(
          salesDataset,
          bundle.salesTimestamp ?? fallbackTimestamp ?? generatedAt,
        );
        updateSalesSnapshot(salesDataset, salesTimestamp);
      }
    },
    [updateSalesSnapshot],
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
              if (Array.isArray(parsed)) {
                const timestamp = response.uploadedAt ?? new Date().toISOString();
                setUploadError(null);
                setShareUrl(null);
                const result = saveKarteWithQuotaFallback(parsed as KarteRecord[], timestamp);
                setRecords(result.usedRecords);
                setLastUpdated(timestamp);
                if (!result.saved) {
                  setUploadError("ローカル保存容量を超えました。共有URLでの保存をご検討ください。");
                } else if (result.prunedCount) {
                  setUploadError(`保存容量超過のため直近${result.prunedCount}ヶ月分のみローカル保存しました。全件の保管は共有URLをご利用ください。`);
                }
              } else if (
                parsed &&
                typeof parsed === "object" &&
                Array.isArray((parsed as SharedDataBundle).karteRecords)
              ) {
                applySharedBundle(parsed as SharedDataBundle, response.uploadedAt);
              } else {
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
  }, [applySharedBundle, updateSalesSnapshot]);

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
      setReservationsRecords(existingReservations);

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

      const existingSales = loadSalesDataFromStorage();
      updateSalesSnapshot(existingSales);

      const existingExpense = loadExpenseData();
      updateExpenseSnapshot(existingExpense);
    } catch (error) {
      console.error(error);
    }
  }, [updateSalesSnapshot, updateExpenseSnapshot]);

  const classifiedRecords = useMemo<KarteRecordWithCategory[]>(() => {
    if (records.length === 0) {
      return [];
    }
    return classifyKarteRecords(records);
  }, [records]);
  const diagnosisMonths = useMemo(
    () => extractDiagnosisMonths(diagnosisRecords),
    [diagnosisRecords],
  );

  const karteMonths = useMemo(() => {
    const months = new Set<string>();
    for (const record of classifiedRecords) {
      if (record.monthKey >= KARTE_MIN_MONTH) {
        months.add(record.monthKey);
      }
    }
    return Array.from(months).sort();
  }, [classifiedRecords]);

  const allAvailableMonths = useMemo(() => {
    const months = new Set<string>(karteMonths);
    for (const month of diagnosisMonths) {
      months.add(month);
    }
    return Array.from(months).sort();
  }, [karteMonths, diagnosisMonths]);

  const filterMonths = lifestyleOnly ? karteMonths : allAvailableMonths;

  const latestAvailableMonth = useMemo(
    () => (filterMonths.length > 0 ? filterMonths[filterMonths.length - 1] : null),
    [filterMonths],
  );

  const {
    startMonth,
    endMonth,
    setStartMonth,
    setEndMonth,
    resetPeriod,
  } = useAnalysisPeriodRange(filterMonths, {
    autoSelectLatest: !lifestyleOnly,
    persistStart: !lifestyleOnly,
    singleMonth: !lifestyleOnly,
  });

  useEffect(() => {
    if (!lifestyleOnly) {
      return;
    }
    if (!latestAvailableMonth || filterMonths.length === 0) {
      return;
    }

    const effectiveEnd = endMonth || latestAvailableMonth;
    if (!endMonth) {
      setEndMonth(effectiveEnd);
    }

    const endIndex = filterMonths.indexOf(effectiveEnd);
    if (endIndex === -1) {
      return;
    }

    const desiredStartIndex = Math.max(0, endIndex - 5);
    const desiredStart = filterMonths[desiredStartIndex];
    if (startMonth !== desiredStart) {
      setStartMonth(desiredStart);
    }
  }, [
    lifestyleOnly,
    endMonth,
    startMonth,
    latestAvailableMonth,
    filterMonths,
    setEndMonth,
    setStartMonth,
  ]);

  const lifestyleEffectiveEndMonth = lifestyleOnly
    ? endMonth || latestAvailableMonth
    : endMonth;

  const lifestyleEffectiveStartMonth = useMemo(() => {
    if (!lifestyleOnly) {
      return startMonth;
    }
    if (!lifestyleEffectiveEndMonth || filterMonths.length === 0) {
      return startMonth;
    }
    const endIndex = filterMonths.indexOf(lifestyleEffectiveEndMonth);
    if (endIndex === -1) {
      return startMonth;
    }
    return filterMonths[Math.max(0, endIndex - 5)] ?? startMonth;
  }, [
    lifestyleOnly,
    startMonth,
    lifestyleEffectiveEndMonth,
    filterMonths,
  ]);

  const periodFilteredRecords = useMemo(() => {
    if (classifiedRecords.length === 0) {
      return [];
    }
    let filtered = classifiedRecords.filter((record) => record.monthKey >= KARTE_MIN_MONTH);

    const activeStartMonth = lifestyleOnly ? lifestyleEffectiveStartMonth : startMonth;
    const activeEndMonth = lifestyleOnly ? lifestyleEffectiveEndMonth : endMonth;

    if (activeStartMonth && activeEndMonth) {
      filtered = filtered.filter(
        (record) => record.monthKey >= activeStartMonth && record.monthKey <= activeEndMonth,
      );
    } else if (activeStartMonth) {
      filtered = filtered.filter((record) => record.monthKey >= activeStartMonth);
    } else if (activeEndMonth) {
      filtered = filtered.filter((record) => record.monthKey <= activeEndMonth);
    }

    return filtered;
  }, [
    classifiedRecords,
    lifestyleOnly,
    lifestyleEffectiveEndMonth,
    lifestyleEffectiveStartMonth,
    endMonth,
    startMonth,
  ]);

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

  const currentInsightRecords = useMemo(() => {
    if (periodFilteredRecords.length === 0) {
      return [] as KarteRecordWithCategory[];
    }

    if (isSingleMonthPeriod || !endMonth) {
      return periodFilteredRecords;
    }

    const lastMonthRecords = periodFilteredRecords.filter(
      (record) => record.monthKey === endMonth,
    );

    return lastMonthRecords.length > 0 ? lastMonthRecords : periodFilteredRecords;
  }, [periodFilteredRecords, isSingleMonthPeriod, endMonth]);

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

  const latestPureRate =
    latestStat && latestStat.totalPatients > 0
      ? roundTo1Decimal((latestStat.pureFirstVisits / latestStat.totalPatients) * 100)
      : null;
  const latestReturningRate =
    latestStat && latestStat.totalPatients > 0
      ? roundTo1Decimal((latestStat.returningFirstVisits / latestStat.totalPatients) * 100)
      : null;
  const latestContinuationRate =
    latestStat && latestStat.totalPatients > 0
      ? roundTo1Decimal((latestStat.revisitCount / latestStat.totalPatients) * 100)
      : null;

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
    if (currentInsightRecords.length === 0) {
      return [];
    }

    type Bucket = {
      department: string;
      total: number;
      pureFirst: number;
      returningFirst: number;
      revisit: number;
      pointsSum: number;
      ageSum: number;
      ageCount: number;
    };

    const ensureBucket = (map: Map<string, Bucket>, key: string) => {
      if (!map.has(key)) {
        map.set(key, {
          department: key,
          total: 0,
          pureFirst: 0,
          returningFirst: 0,
          revisit: 0,
          pointsSum: 0,
          ageSum: 0,
          ageCount: 0,
        });
      }
      return map.get(key)!;
    };

    const addRecordToBucket = (bucket: Bucket, record: KarteRecordWithCategory) => {
      bucket.total += 1;
      if (record.category === "pureFirst") {
        bucket.pureFirst += 1;
      } else if (record.category === "returningFirst") {
        bucket.returningFirst += 1;
      } else if (record.category === "revisit") {
        bucket.revisit += 1;
      }

      const points = record.points ?? 0;
      if (Number.isFinite(points)) {
        bucket.pointsSum += points;
      }

      const age = calculateAge(record.birthDateIso ?? null, record.dateIso);
      if (age !== null) {
        bucket.ageSum += age;
        bucket.ageCount += 1;
      }
    };

    const map = new Map<string, Bucket>();

    for (const record of currentInsightRecords) {
      const departmentRaw = record.department?.trim() ?? "";
      const displayDepartment = departmentRaw.length > 0 ? departmentRaw : "診療科未分類";
      const isPriorityDepartment = INSIGHT_PRIORITY_DEPARTMENTS.includes(
        displayDepartment as (typeof INSIGHT_PRIORITY_DEPARTMENTS)[number],
      );
      if (departmentRaw.includes("自費") && !isPriorityDepartment) {
        continue;
      }

      const primaryBucket = ensureBucket(map, displayDepartment);
      addRecordToBucket(primaryBucket, record);

      if (displayDepartment === "総合診療" || displayDepartment === "内科") {
        const combinedBucket = ensureBucket(map, "総合診療＋内科");
        addRecordToBucket(combinedBucket, record);
      }
    }

    INSIGHT_PRIORITY_DEPARTMENTS.forEach((department) => {
      ensureBucket(map, department);
    });

    const priorityOrder = new Map<string, number>(
      INSIGHT_PRIORITY_DEPARTMENTS.map((department, index) => [department, index]),
    );

    return Array.from(map.values())
      .map((bucket) => {
        const pureRate = bucket.total > 0 ? (bucket.pureFirst / bucket.total) * 100 : 0;
        const returningRate = bucket.total > 0 ? (bucket.returningFirst / bucket.total) * 100 : 0;
        const revisitRate = bucket.total > 0 ? (bucket.revisit / bucket.total) * 100 : 0;
        const averagePoints =
          bucket.total > 0 && bucket.pointsSum > 0
            ? roundTo1Decimal(bucket.pointsSum / bucket.total)
            : null;
        const averageAmount =
          averagePoints !== null ? Math.round(averagePoints * 10) : null;

        return {
          department: bucket.department,
          total: bucket.total,
          pureFirst: bucket.pureFirst,
          returningFirst: bucket.returningFirst,
          revisit: bucket.revisit,
          points: bucket.pointsSum,
          averagePoints,
          averageAmount,
          averageAge:
            bucket.ageCount > 0 ? roundTo1Decimal(bucket.ageSum / bucket.ageCount) : null,
          pureRate: roundTo1Decimal(pureRate),
          returningRate: roundTo1Decimal(returningRate),
          revisitRate: roundTo1Decimal(revisitRate),
        };
      })
      .sort((a, b) => {
        const orderA = priorityOrder.get(a.department);
        const orderB = priorityOrder.get(b.department);
        if (orderA !== undefined && orderB !== undefined) {
          return orderA - orderB;
        }
        if (orderA !== undefined) {
          return -1;
        }
        if (orderB !== undefined) {
          return 1;
        }
        const diff = b.total - a.total;
        if (diff !== 0) {
          return diff;
        }
        return a.department.localeCompare(b.department, "ja");
      });
  }, [currentInsightRecords]);


  const previousDepartmentStats = useMemo<Map<string, DepartmentStat>>(() => {
    if (previousPeriodRecords.length === 0) {
      return new Map();
    }

    type Bucket = {
      department: string;
      total: number;
      pureFirst: number;
      returningFirst: number;
      revisit: number;
      pointsSum: number;
      ageSum: number;
      ageCount: number;
    };

    const ensureBucket = (map: Map<string, Bucket>, key: string) => {
      if (!map.has(key)) {
        map.set(key, {
          department: key,
          total: 0,
          pureFirst: 0,
          returningFirst: 0,
          revisit: 0,
          pointsSum: 0,
          ageSum: 0,
          ageCount: 0,
        });
      }
      return map.get(key)!;
    };

    const addRecordToBucket = (bucket: Bucket, record: KarteRecordWithCategory) => {
      bucket.total += 1;
      if (record.category === "pureFirst") {
        bucket.pureFirst += 1;
      } else if (record.category === "returningFirst") {
        bucket.returningFirst += 1;
      } else if (record.category === "revisit") {
        bucket.revisit += 1;
      }

      const points = record.points ?? 0;
      if (Number.isFinite(points)) {
        bucket.pointsSum += points;
      }

      const age = calculateAge(record.birthDateIso ?? null, record.dateIso);
      if (age !== null) {
        bucket.ageSum += age;
        bucket.ageCount += 1;
      }
    };

    const map = new Map<string, Bucket>();

    for (const record of previousPeriodRecords) {
      const departmentRaw = record.department?.trim() ?? "";
      const displayDepartment = departmentRaw.length > 0 ? departmentRaw : "診療科未分類";
      const isPriorityDepartment = INSIGHT_PRIORITY_DEPARTMENTS.includes(
        displayDepartment as (typeof INSIGHT_PRIORITY_DEPARTMENTS)[number],
      );
      if (departmentRaw.includes("自費") && !isPriorityDepartment) {
        continue;
      }

      const primaryBucket = ensureBucket(map, displayDepartment);
      addRecordToBucket(primaryBucket, record);

      if (displayDepartment === "総合診療" || displayDepartment === "内科") {
        const combinedBucket = ensureBucket(map, "総合診療＋内科");
        addRecordToBucket(combinedBucket, record);
      }
    }

    INSIGHT_PRIORITY_DEPARTMENTS.forEach((department) => {
      ensureBucket(map, department);
    });

    const resultMap = new Map<string, DepartmentStat>();
    for (const bucket of map.values()) {
      const pureRate = bucket.total > 0 ? (bucket.pureFirst / bucket.total) * 100 : 0;
      const returningRate = bucket.total > 0 ? (bucket.returningFirst / bucket.total) * 100 : 0;
      const revisitRate = bucket.total > 0 ? (bucket.revisit / bucket.total) * 100 : 0;
      const averagePoints =
        bucket.total > 0 && bucket.pointsSum > 0
          ? roundTo1Decimal(bucket.pointsSum / bucket.total)
          : null;
      const averageAmount =
        averagePoints !== null ? Math.round(averagePoints * 10) : null;

      resultMap.set(bucket.department, {
        department: bucket.department,
        total: bucket.total,
        pureFirst: bucket.pureFirst,
        returningFirst: bucket.returningFirst,
        revisit: bucket.revisit,
        points: bucket.pointsSum,
        averagePoints,
        averageAmount,
        averageAge:
          bucket.ageCount > 0 ? roundTo1Decimal(bucket.ageSum / bucket.ageCount) : null,
        pureRate: roundTo1Decimal(pureRate),
        returningRate: roundTo1Decimal(returningRate),
        revisitRate: roundTo1Decimal(revisitRate),
      });
    }

    return resultMap;
  }, [previousPeriodRecords]);

  const unitPriceWeekdaySummaries = useMemo(() => {
    const groupMap = new Map<
      UnitPriceGroupId,
      {
        label: string;
        totals: { patientCount: number; totalPoints: number };
        byDay: Record<UnitPriceWeekdayKey, { patientCount: number; totalPoints: number }>;
      }
    >();

    UNIT_PRICE_GROUPS.forEach((group) => {
      const byDay = {} as Record<UnitPriceWeekdayKey, { patientCount: number; totalPoints: number }>;
      UNIT_PRICE_WEEKDAY_DEFINITIONS.forEach(({ key }) => {
        byDay[key] = { patientCount: 0, totalPoints: 0 };
      });
      groupMap.set(group.id, {
        label: group.label,
        totals: { patientCount: 0, totalPoints: 0 },
        byDay,
      });
    });

    filteredClassified.forEach((record) => {
      const departmentRaw = record.department?.trim() ?? "";
      if (!departmentRaw || departmentRaw.includes("自費")) {
        return;
      }
      const normalized = normalizeUnitPriceDepartment(departmentRaw);
      const matched = UNIT_PRICE_GROUPS.find((group) => group.matcher(normalized));
      if (!matched) {
        return;
      }
      const summary = groupMap.get(matched.id);
      if (!summary) {
        return;
      }

      summary.totals.patientCount += 1;
      const points = record.points;
      if (typeof points === "number" && Number.isFinite(points)) {
        summary.totals.totalPoints += points;
      }

      const dayKey = getWeekdayKeyFromDate(record.dateIso);
      const dayBucket = summary.byDay[dayKey];
      dayBucket.patientCount += 1;
      if (typeof points === "number" && Number.isFinite(points)) {
        dayBucket.totalPoints += points;
      }
    });

    return UNIT_PRICE_GROUPS.map((group) => {
      const summary = groupMap.get(group.id)!;
      return {
        id: group.id,
        label: summary.label,
        totals: summary.totals,
        byDay: summary.byDay,
      };
    });
  }, [filteredClassified]);

  const unitPriceWeekdayRows = useMemo(() => {
    const summaryMap = new Map(unitPriceWeekdaySummaries.map((summary) => [summary.id, summary]));
    return UNIT_PRICE_WEEKDAY_DEFINITIONS.map(({ key, label }) => {
      const stats = {} as Record<
        UnitPriceGroupId,
        {
          patientCount: number;
          totalPoints: number;
          averagePoints: number | null;
          averageAmount: number | null;
        }
      >;

      UNIT_PRICE_GROUPS.forEach((group) => {
        const summary = summaryMap.get(group.id);
        const dayStats = summary?.byDay[key];
        const patientCount = dayStats?.patientCount ?? 0;
        const totalPoints = dayStats?.totalPoints ?? 0;
        const averagePoints =
          patientCount > 0 && totalPoints > 0 ? roundTo1Decimal(totalPoints / patientCount) : null;
        const averageAmount = averagePoints !== null ? Math.round(averagePoints * 10) : null;

        stats[group.id] = {
          patientCount,
          totalPoints: Math.round(totalPoints),
          averagePoints,
          averageAmount,
        };
      });

      return {
        key,
        label,
        stats,
      };
    });
  }, [unitPriceWeekdaySummaries]);

  const unitPriceRankingByGroup = useMemo(() => {
    const ranking = new Map<UnitPriceGroupId, Map<string, number>>();
    UNIT_PRICE_GROUPS.forEach((group) => {
      const entries = unitPriceWeekdayRows
        .reduce<Array<{ key: string; amount: number }>>((accumulator, row) => {
          const amount = row.stats[group.id]?.averageAmount;
          if (typeof amount === "number" && Number.isFinite(amount)) {
            accumulator.push({ key: row.key, amount });
          }
          return accumulator;
        }, [])
        .sort((a, b) => b.amount - a.amount);

      const groupRanking = new Map<string, number>();
      let previousAmount: number | null = null;
      let currentRank = 0;
      entries.forEach((entry, index) => {
        if (previousAmount === null || entry.amount < previousAmount) {
          currentRank = index + 1;
        }
        previousAmount = entry.amount;
        groupRanking.set(entry.key, currentRank);
      });
      ranking.set(group.id, groupRanking);
    });
    return ranking;
  }, [unitPriceWeekdayRows]);

  const hasUnitPriceData = useMemo(
    () =>
      unitPriceWeekdayRows.some((row) =>
        UNIT_PRICE_GROUPS.some((group) => row.stats[group.id]?.patientCount > 0),
      ),
    [unitPriceWeekdayRows],
  );

  const shiftAnalysis = useMemo<ShiftAnalysisResult>(() => {
    if (filteredClassified.length === 0 || reservationsRecords.length === 0) {
      return { departments: [], byDepartment: new Map() };
    }

    const reservationMap = new Map<string, Reservation[]>();
    reservationsRecords.forEach((reservation) => {
      const normalizedName = normalizePatientNameForKey(
        reservation.patientNameNormalized ?? reservation.patientName,
      );
      const appointmentSource = reservation.appointmentIso ?? reservation.receivedAtIso;
      if (!normalizedName || !appointmentSource) {
        return;
      }
      const dateKey = appointmentSource.split("T")[0];
      if (!dateKey) {
        return;
      }
      const key = `${normalizedName}|${dateKey}`;
      if (!reservationMap.has(key)) {
        reservationMap.set(key, []);
      }
      reservationMap.get(key)!.push(reservation);
    });

    type ShiftStat = {
      department: string;
      weekday: number;
      hour: number;
      patientCount: number;
      totalPoints: number;
      ageSum: number;
      ageCount: number;
      pureCount: number;
      returningCount: number;
      revisitCount: number;
    };

    const departmentMap = new Map<string, Map<string, ShiftStat>>();

    filteredClassified.forEach((record) => {
      const patientName = normalizePatientNameForKey(record.patientNameNormalized);
      const points = record.points ?? null;
      const departmentRaw = record.department?.trim() ?? "";
      const displayDepartment = classifyDepartmentDisplayName(departmentRaw);
      if (!patientName || points === null) {
        return;
      }

      const dateKey = record.dateIso;
      const reservationKey = `${patientName}|${dateKey}`;
      const candidates = reservationMap.get(reservationKey);
      if (!candidates || candidates.length === 0) {
        return;
      }

      const normalizedDept = normalizeDepartmentLabel(displayDepartment);
      const matchIndex = candidates.findIndex((candidate) => {
        const candidateDept = normalizeDepartmentLabel(
          classifyDepartmentDisplayName(candidate.department ?? ""),
        );
        return (
          candidateDept === normalizedDept ||
          candidateDept.includes(normalizedDept) ||
          normalizedDept.includes(candidateDept)
        );
      });
      const match = matchIndex >= 0 ? candidates.splice(matchIndex, 1)[0] : candidates.shift();
      if (!match) {
        return;
      }

      const appointmentIso = match.appointmentIso ?? match.receivedAtIso;
      if (!appointmentIso) {
        return;
      }
      const visitDate = new Date(appointmentIso);
      if (Number.isNaN(visitDate.getTime())) {
        return;
      }

      const weekday = visitDate.getDay();
      const hour = visitDate.getHours();
      const department = displayDepartment;

      if (!departmentMap.has(department)) {
        departmentMap.set(department, new Map<string, ShiftStat>());
      }
      const slotKey = `${weekday}|${hour}`;
      const slotMap = departmentMap.get(department)!;
      if (!slotMap.has(slotKey)) {
        slotMap.set(slotKey, {
          department,
          weekday,
          hour,
          patientCount: 0,
          totalPoints: 0,
          ageSum: 0,
          ageCount: 0,
          pureCount: 0,
          returningCount: 0,
          revisitCount: 0,
        });
      }
      const stat = slotMap.get(slotKey)!;
      stat.patientCount += 1;
      stat.totalPoints += points;

      const age = calculateAge(record.birthDateIso ?? null, record.dateIso);
      if (age !== null) {
        stat.ageSum += age;
        stat.ageCount += 1;
      }

      if (record.category === "pureFirst") {
        stat.pureCount += 1;
      } else if (record.category === "returningFirst") {
        stat.returningCount += 1;
      } else if (record.category === "revisit") {
        stat.revisitCount += 1;
      }
    });

    const byDepartment = new Map<string, ShiftInsightRow[]>();
    departmentMap.forEach((slotMap, department) => {
      const rows: ShiftInsightRow[] = Array.from(slotMap.values()).map((stat) => {
        const averagePoints =
          stat.patientCount > 0 ? roundTo1Decimal(stat.totalPoints / stat.patientCount) : null;
        const averageAmount =
          averagePoints !== null ? Math.round(averagePoints * 10) : null;
        const averageAge =
          stat.ageCount > 0 ? roundTo1Decimal(stat.ageSum / stat.ageCount) : null;
        const pureRate =
          stat.patientCount > 0
            ? roundTo1Decimal((stat.pureCount / stat.patientCount) * 100)
            : null;
        const returningRate =
          stat.patientCount > 0
            ? roundTo1Decimal((stat.returningCount / stat.patientCount) * 100)
            : null;
        const revisitRate =
          stat.patientCount > 0
            ? roundTo1Decimal((stat.revisitCount / stat.patientCount) * 100)
            : null;

        return {
          key: `${department}|${stat.weekday}|${stat.hour}`,
          department,
          weekday: stat.weekday,
          hour: stat.hour,
          patientCount: stat.patientCount,
          totalPoints: Math.round(stat.totalPoints),
          averagePoints,
          averageAmount,
          averageAge,
          pureRate,
          returningRate,
          revisitRate,
        };
      });

      rows.sort((a, b) => {
        if (a.weekday !== b.weekday) {
          return a.weekday - b.weekday;
        }
        return a.hour - b.hour;
      });

      byDepartment.set(department, rows);
    });

    const departments = Array.from(byDepartment.keys()).sort((a, b) =>
      a.localeCompare(b, "ja"),
    );

    return { departments, byDepartment };
  }, [filteredClassified, reservationsRecords]);

  const shiftDepartmentOptions = shiftAnalysis.departments;

  useEffect(() => {
    if (shiftDepartmentOptions.length === 0) {
      if (selectedShiftDepartment !== "") {
        setSelectedShiftDepartment("");
      }
      return;
    }
    if (!shiftDepartmentOptions.includes(selectedShiftDepartment)) {
      setSelectedShiftDepartment(shiftDepartmentOptions[0]);
    }
  }, [shiftDepartmentOptions, selectedShiftDepartment]);

  const shiftRows =
    selectedShiftDepartment && shiftAnalysis.byDepartment.has(selectedShiftDepartment)
      ? shiftAnalysis.byDepartment.get(selectedShiftDepartment)!
      : [];

  const lifestyleAnalysis = useMemo<LifestyleAnalysisResult | null>(() => {
    if (!lifestyleOnly) {
      return null;
    }
    if (diagnosisRecords.length === 0 || classifiedRecords.length === 0) {
      return null;
    }

    const patientDiseaseMap = new Map<
      string,
      {
        diseaseNames: Set<string>;
      }
    >();

    for (const record of diagnosisRecords) {
      if (record.category !== "生活習慣病") {
        continue;
      }
      const key = createLifestylePatientKey(
        record.patientNumber,
        record.patientNameNormalized,
        record.birthDateIso,
      );
      if (!key) {
        continue;
      }
      if (!patientDiseaseMap.has(key)) {
        patientDiseaseMap.set(key, {
          diseaseNames: new Set<string>(),
        });
      }
      patientDiseaseMap.get(key)!.diseaseNames.add(record.diseaseName);
    }

    if (patientDiseaseMap.size === 0) {
      return null;
    }

    const rangeStartMonth = lifestyleEffectiveStartMonth ?? KARTE_MIN_MONTH;
    const rangeEndMonth = lifestyleEffectiveEndMonth ?? "9999-12";
    const sourceRecords = classifiedRecords.filter(
      (record) =>
        record.monthKey >= rangeStartMonth &&
        record.monthKey <= rangeEndMonth,
    );
    if (sourceRecords.length === 0) {
      return null;
    }

    let baselineDateIso = sourceRecords[0].dateIso;
    let rangeStartIso = sourceRecords[0].dateIso;

    const patientVisitMap = new Map<
      string,
      {
        entries: KarteRecordWithCategory[];
        visitDates: Set<string>;
        birthDateIso: string | null;
        patientName: string | null;
      }
    >();

    for (const record of sourceRecords) {
      if (record.dateIso > baselineDateIso) {
        baselineDateIso = record.dateIso;
      }
      if (record.dateIso < rangeStartIso) {
        rangeStartIso = record.dateIso;
      }
      const patientKey = createLifestylePatientKey(
        record.patientNumber !== null ? String(record.patientNumber) : null,
        record.patientNameNormalized ?? null,
        record.birthDateIso ?? null,
      );
      if (!patientKey) {
        continue;
      }
      if (!patientDiseaseMap.has(patientKey)) {
        continue;
      }
      if (!patientVisitMap.has(patientKey)) {
        patientVisitMap.set(patientKey, {
          entries: [],
          visitDates: new Set<string>(),
          birthDateIso: null,
          patientName: null,
        });
      }
      const slot = patientVisitMap.get(patientKey)!;
      slot.entries.push(record);
      slot.visitDates.add(record.dateIso);
      if (!slot.birthDateIso && record.birthDateIso) {
        slot.birthDateIso = record.birthDateIso;
      }
      if (!slot.patientName && record.patientNameNormalized) {
        slot.patientName = record.patientNameNormalized;
      }
    }

    const patients: LifestylePatientSummary[] = [];

    patientVisitMap.forEach((slot, patientKey) => {
      const diseaseMeta = patientDiseaseMap.get(patientKey);
      if (!diseaseMeta) {
        return;
      }
      if (slot.visitDates.size === 0) {
        return;
      }

      const diseaseNames = diseaseMeta.diseaseNames;
      const baseTypes = determineLifestyleDiseaseTypes(diseaseNames);
      let diseaseType: LifestyleDiseaseType;
      if (baseTypes.size === 0) {
        diseaseType = "multiple";
      } else if (baseTypes.size >= 2) {
        diseaseType = "multiple";
      } else {
        const [onlyType] = Array.from(baseTypes);
        diseaseType = onlyType;
      }

      const labelCandidates =
        diseaseType === "multiple"
          ? Array.from(baseTypes).map(
              (type) => LIFESTYLE_DISEASE_LABEL_MAP.get(type) ?? "",
            )
          : [LIFESTYLE_DISEASE_LABEL_MAP.get(diseaseType) ?? ""];

      const diseaseLabels =
        diseaseType === "multiple" && baseTypes.size === 0
          ? ["その他"]
          : labelCandidates.filter((label) => label.length > 0);

      const visitDates = Array.from(slot.visitDates).sort((a, b) => a.localeCompare(b));
      const firstVisitDate = visitDates[0];
      const lastVisitDate = visitDates[visitDates.length - 1];
      const daysSinceLast = differenceInDays(baselineDateIso, lastVisitDate);
      const status = selectLifestyleStatus(daysSinceLast);
      if (!status) {
        return;
      }

      const sortedEntries = [...slot.entries].sort((a, b) => {
        const diff = a.dateIso.localeCompare(b.dateIso);
        if (diff !== 0) {
          return diff;
        }
        return (a.department ?? "").localeCompare(b.department ?? "", "ja");
      });
      const firstVisitEntries = sortedEntries.filter((entry) => entry.dateIso === firstVisitDate);
      const firstEntry =
        firstVisitEntries.find((entry) => entry.visitType === "初診") ?? firstVisitEntries[0] ?? null;
      const firstVisitType = firstEntry?.visitType ?? null;

      const age = calculateAge(slot.birthDateIso ?? null, baselineDateIso);
      const patientNumberEntry = sortedEntries.find((entry) => entry.patientNumber !== null);
      const patientNumberValue =
        patientNumberEntry && patientNumberEntry.patientNumber !== null
          ? String(patientNumberEntry.patientNumber)
          : null;

      patients.push({
        key: patientKey,
        patientNumber: patientNumberValue,
        patientName: slot.patientName,
        anonymizedId: "",
        diseaseType,
        diseaseLabels,
        diseaseNames: Array.from(diseaseNames),
        firstVisitDate,
        lastVisitDate,
        firstVisitMonth: firstVisitDate.slice(0, 7),
        firstVisitType,
        visitCount: visitDates.length,
        status,
        daysSinceLast: daysSinceLast ?? 0,
        age,
      });
    });

    if (patients.length === 0) {
      return null;
    }

    patients
      .sort((a, b) => a.key.localeCompare(b.key, "en"))
      .forEach((patient, index) => {
        patient.anonymizedId = `LS-${String(index + 1).padStart(3, "0")}`;
      });

    const totalPatients = patients.length;
    const statusCounts: Record<LifestyleStatus, number> = {
      regular: 0,
      delayed: 0,
      atRisk: 0,
    };
    patients.forEach((patient) => {
      statusCounts[patient.status] += 1;
    });

    const continuationRate =
      totalPatients > 0 ? roundTo1Decimal((statusCounts.regular / totalPatients) * 100) : 0;

    const daysDistribution: LifestyleDistributionItem[] = LIFESTYLE_DAYS_BUCKETS.map((bucket) => {
      const count = patients.filter((patient) => {
        if (bucket.max === Number.POSITIVE_INFINITY) {
          return patient.daysSinceLast >= bucket.min;
        }
        return patient.daysSinceLast >= bucket.min && patient.daysSinceLast <= bucket.max;
      }).length;
      return {
        id: bucket.id,
        label: bucket.label,
        count,
        percentage:
          totalPatients > 0 ? roundTo1Decimal((count / totalPatients) * 100) : 0,
      };
    });

    const visitDistribution: LifestyleDistributionItem[] = LIFESTYLE_VISIT_BUCKETS.map(
      (bucket) => {
        const count = patients.filter((patient) => {
          if (bucket.max === Number.POSITIVE_INFINITY) {
            return patient.visitCount >= bucket.min;
          }
          return patient.visitCount >= bucket.min && patient.visitCount <= bucket.max;
        }).length;
        return {
          id: bucket.id,
          label: bucket.label,
          count,
          percentage:
            totalPatients > 0 ? roundTo1Decimal((count / totalPatients) * 100) : 0,
        };
      },
    );

    const diseaseStats = LIFESTYLE_DISEASE_TYPES.map(({ id, label }) => {
      const groupPatients = patients.filter((patient) =>
        id === "multiple" ? patient.diseaseType === "multiple" : patient.diseaseType === id,
      );
      const groupTotal = groupPatients.length;
      const groupStatus: Record<LifestyleStatus, number> = {
        regular: 0,
        delayed: 0,
        atRisk: 0,
      };
      let visitSum = 0;
      groupPatients.forEach((patient) => {
        groupStatus[patient.status] += 1;
        visitSum += patient.visitCount;
      });
      const rates: Record<LifestyleStatus, number> = {
        regular:
          groupTotal > 0 ? roundTo1Decimal((groupStatus.regular / groupTotal) * 100) : 0,
        delayed:
          groupTotal > 0 ? roundTo1Decimal((groupStatus.delayed / groupTotal) * 100) : 0,
        atRisk:
          groupTotal > 0 ? roundTo1Decimal((groupStatus.atRisk / groupTotal) * 100) : 0,
      };
      const averageVisits =
        groupTotal > 0 ? roundTo1Decimal(visitSum / groupTotal) : null;
      return {
        id,
        label,
        total: groupTotal,
        statusCounts: groupStatus,
        rates,
        averageVisits,
      };
    });

    const ageGroupSummaries = LIFESTYLE_AGE_GROUPS.map((group) => {
      const groupPatients = patients.filter((patient) => {
        if (patient.age === null) {
          return false;
        }
        return patient.age >= group.min && patient.age <= group.max;
      });
      const groupCount = groupPatients.length;
      const groupStatus: Record<LifestyleStatus, number> = {
        regular: 0,
        delayed: 0,
        atRisk: 0,
      };
      let visits = 0;
      groupPatients.forEach((patient) => {
        groupStatus[patient.status] += 1;
        visits += patient.visitCount;
      });
      const rates: Record<LifestyleStatus, number> = {
        regular:
          groupCount > 0 ? roundTo1Decimal((groupStatus.regular / groupCount) * 100) : 0,
        delayed:
          groupCount > 0 ? roundTo1Decimal((groupStatus.delayed / groupCount) * 100) : 0,
        atRisk:
          groupCount > 0 ? roundTo1Decimal((groupStatus.atRisk / groupCount) * 100) : 0,
      };
      return {
        id: group.id,
        label: group.label,
        count: groupCount,
        statusCounts: groupStatus,
        rates,
        averageVisits: groupCount > 0 ? roundTo1Decimal(visits / groupCount) : null,
      };
    });

    const ageRanking = ageGroupSummaries
      .filter((group) => group.count > 0)
      .map((group) => ({
        label: group.label,
        continuationRate: group.rates.regular,
        count: group.count,
      }))
      .sort(
        (a, b) =>
          b.continuationRate - a.continuationRate ||
          b.count - a.count,
      );

    const delayedPatientsAll = patients
      .filter((patient) => patient.status === "delayed")
      .sort((a, b) => b.lastVisitDate.localeCompare(a.lastVisitDate));
    const delayedPatients = {
      total: delayedPatientsAll.length,
      list: delayedPatientsAll.slice(0, 30),
    };

    const atRiskPatientsAll = patients
      .filter((patient) => patient.status === "atRisk")
      .sort((a, b) => b.lastVisitDate.localeCompare(a.lastVisitDate));
    const atRiskPatients = {
      total: atRiskPatientsAll.length,
      list: atRiskPatientsAll.slice(0, 30),
      highEngagement: atRiskPatientsAll.filter((patient) => patient.visitCount >= 4).length,
    };

    return {
      totalPatients,
      rangeStartIso,
      baselineDateIso,
      patients,
      statusCounts,
      continuationRate,
      daysDistribution,
      visitDistribution,
      diseaseStats,
      ageStats: {
        groups: ageGroupSummaries,
        ranking: ageRanking,
      },
      delayedPatients,
      atRiskPatients,
    };
  }, [
    lifestyleOnly,
    diagnosisRecords,
    classifiedRecords,
    lifestyleEffectiveStartMonth,
    lifestyleEffectiveEndMonth,
  ]);

  const filteredDiagnosisRecords = useMemo(() => {
    if (diagnosisRecords.length === 0) {
      return [];
    }
    const start = lifestyleOnly
      ? lifestyleEffectiveStartMonth || undefined
      : startMonth || undefined;
    const end = lifestyleOnly
      ? lifestyleEffectiveEndMonth || undefined
      : endMonth || undefined;
    return filterDiagnosisByMonthRange(diagnosisRecords, start, end);
  }, [
    diagnosisRecords,
    lifestyleOnly,
    lifestyleEffectiveStartMonth,
    lifestyleEffectiveEndMonth,
    startMonth,
    endMonth,
  ]);

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

  const lifestyleStatusEntries = useMemo(() => {
    if (!lifestyleAnalysis) {
      return [];
    }
    const total = lifestyleAnalysis.totalPatients || 0;
    return LIFESTYLE_STATUS_ORDER.map((status) => {
      const config = LIFESTYLE_STATUS_CONFIG[status];
      const count = lifestyleAnalysis.statusCounts[status] ?? 0;
      const percentage =
        total > 0 ? roundTo1Decimal((count / total) * 100) : 0;
      return {
        status,
        label: config.label,
        description: config.description,
        count,
        percentage,
        formattedPercentage: formatPercentage(percentage),
        config,
      };
    }).sort((a, b) => {
      if (b.percentage !== a.percentage) {
        return b.percentage - a.percentage;
      }
      return (
        LIFESTYLE_STATUS_ORDER.indexOf(a.status) -
        LIFESTYLE_STATUS_ORDER.indexOf(b.status)
      );
    });
  }, [lifestyleAnalysis]);

  const lifestyleDiseaseStatsSorted = useMemo(() => {
    if (!lifestyleAnalysis) {
      return [];
    }
    return [...lifestyleAnalysis.diseaseStats].sort(
      (a, b) => (b.rates.regular ?? 0) - (a.rates.regular ?? 0),
    );
  }, [lifestyleAnalysis]);

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

  useEffect(() => {
    setAnalysisPeriodLabel(diagnosisRangeLabel);
  }, [diagnosisRangeLabel]);

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

  const channelSummaryCards = useMemo(() => {
    const listingTotal = Object.values(listingStatus.totals).reduce(
      (accumulator, value) => accumulator + value,
      0,
    );
    return [
      {
        id: "reservation",
        title: "予約ログ",
        rawTotal: reservationStatus.total,
        total: reservationStatus.total.toLocaleString("ja-JP"),
        updated: formatTimestampLabel(reservationStatus.lastUpdated),
        detail: `${reservationStatus.total.toLocaleString("ja-JP")}件の受付データを取り込み済みです。`,
        helper: "受付時刻から初診・再診を自動判定し、予約ダッシュボードへ連携します。",
      },
      {
        id: "survey",
        title: "来院経路アンケート",
        rawTotal: surveyStatus.total,
        total: surveyStatus.total.toLocaleString("ja-JP"),
        updated: formatTimestampLabel(surveyStatus.lastUpdated),
        detail: `外来 ${surveyStatus.byType["外来"].toLocaleString("ja-JP")}件 / 内視鏡 ${surveyStatus.byType["内視鏡"].toLocaleString("ja-JP")}件`,
        helper: "媒体別の認知・集患効果を可視化する基礎データです。",
      },
      {
        id: "listing",
        title: "リスティング広告",
        rawTotal: listingTotal,
        total: listingTotal.toLocaleString("ja-JP"),
        updated: formatTimestampLabel(listingStatus.lastUpdated),
        detail: LISTING_CATEGORIES.map(
          (category) => `${category} ${listingStatus.totals[category].toLocaleString("ja-JP")}件`,
        ).join(" / "),
        helper: "広告クリックから来院成果までのCPAや時間帯別反応を分析できます。",
      },
    ];
  }, [listingStatus, reservationStatus, surveyStatus]);

  const multivariateInsights = useMemo<MultivariateInsights>(() => {
    const createEmptySegmentInsight = (
      segment: MultivariateSegmentKey,
    ): MultivariateSegmentInsight => ({
      key: segment,
      label: MULTIVARIATE_SEGMENT_CONFIG[segment].label,
      hasData: false,
      totalMatches: 0,
      unmatchedRecords: 0,
      unmatchedReservations: 0,
      weekdayGroups: [],
      topSlot: null,
      highestAvgSlot: null,
      leadingAgeBand: null,
      highlights: [],
    });

    const base: MultivariateInsights = {
      hasData: false,
      segments: {
        overall: createEmptySegmentInsight("overall"),
        general: createEmptySegmentInsight("general"),
        fever: createEmptySegmentInsight("fever"),
      },
    };

    if (filteredClassified.length === 0 || reservationsRecords.length === 0) {
      return base;
    }

    const normalizeDepartment = (value: string | null | undefined) =>
      value ? normalizeDepartmentLabel(value) : "";

const resolveSegments = (value: string | null | undefined): MultivariateSegmentKey[] => {
      const displayName = classifyDepartmentDisplayName(value ?? "");
      const normalized = normalizeDepartment(displayName);
      if (!normalized) {
        return [];
      }
      const segments: MultivariateSegmentKey[] = [];
      const general = isGeneralDepartment(normalized);
      const fever = isFeverDepartment(normalized);
      if (!general && !fever) {
        return segments;
      }
      segments.push("overall");
      if (general) {
        segments.push("general");
      }
      if (fever) {
        segments.push("fever");
      }
      return segments;
    };

    type SlotAggregate = {
      weekday: number;
      hour: number;
      total: number;
      pointsSum: number;
      pointsCount: number;
      ageMap: Map<
        string,
        { label: string; total: number; pointsSum: number; pointsCount: number }
      >;
    };

    type SegmentAggregate = {
      slotMap: Map<string, SlotAggregate>;
      ageTotals: Map<
        string,
        { label: string; total: number; pointsSum: number; pointsCount: number }
      >;
      matchedCount: number;
      unmatchedRecords: number;
      unmatchedReservations: number;
    };

    const createSegmentAggregate = (): SegmentAggregate => ({
      slotMap: new Map(),
      ageTotals: new Map(),
      matchedCount: 0,
      unmatchedRecords: 0,
      unmatchedReservations: 0,
    });

    const segmentAggregates: Record<MultivariateSegmentKey, SegmentAggregate> = {
      overall: createSegmentAggregate(),
      general: createSegmentAggregate(),
      fever: createSegmentAggregate(),
    };

    const reservationBuckets = new Map<
      string,
      Array<
        Reservation & {
          weekday: number;
          hour: number;
          segments: MultivariateSegmentKey[];
        }
      >
    >();

    for (const reservation of reservationsRecords) {
      const segments = resolveSegments(reservation.department);
      if (segments.length === 0) {
        continue;
      }
      const nameKey = normalizeNameForMatching(
        reservation.patientNameNormalized ?? reservation.patientName ?? null,
      );
      if (!nameKey) {
        continue;
      }
      const dateKey = reservation.appointmentIso
        ? reservation.appointmentIso.slice(0, 10)
        : reservation.reservationDate;
      if (!dateKey) {
        continue;
      }
      const baseWeekday = getIsoWeekday(dateKey);
      if (Number.isNaN(baseWeekday)) {
        continue;
      }
      const isHolidayDate = isJapaneseHolidayIso(dateKey) || isNewYearPeriodIso(dateKey);
      const normalizedWeekday = isHolidayDate ? 7 : toNormalizedWeekdayIndex(baseWeekday);
      const bucketKey = `${nameKey}|${dateKey}`;
      const bucket = reservationBuckets.get(bucketKey) ?? [];
      bucket.push({
        ...reservation,
        weekday: normalizedWeekday,
        hour: reservation.reservationHour,
        segments,
      });
      reservationBuckets.set(bucketKey, bucket);
    }

    if (reservationBuckets.size === 0) {
      return base;
    }

    reservationBuckets.forEach((list) => {
      list.sort((a, b) => a.hour - b.hour);
    });

    const resolveAgeBand = (age: number | null): MultivariateAgeBand => {
      if (age === null) {
        return MULTIVARIATE_AGE_BANDS[MULTIVARIATE_AGE_BANDS.length - 1];
      }
      for (const band of MULTIVARIATE_AGE_BANDS) {
        if (band.min !== null && band.max !== null && age >= band.min && age <= band.max) {
          return band;
        }
      }
      return (
        MULTIVARIATE_AGE_BANDS.find((band) => band.min !== null && band.max === null) ??
        MULTIVARIATE_AGE_BANDS[MULTIVARIATE_AGE_BANDS.length - 1]
      );
    };

    for (const record of filteredClassified) {
      const recordSegments = resolveSegments(record.department ?? null);
      if (recordSegments.length === 0) {
        continue;
      }
      const nameKey = normalizeNameForMatching(record.patientNameNormalized ?? null);
      if (!nameKey) {
        recordSegments.forEach((segment) => {
          segmentAggregates[segment].unmatchedRecords += 1;
        });
        continue;
      }

      const dateKey = record.dateIso;
      const bucketKey = `${nameKey}|${dateKey}`;
      const candidates = reservationBuckets.get(bucketKey);
      if (!candidates || candidates.length === 0) {
        recordSegments.forEach((segment) => {
          segmentAggregates[segment].unmatchedRecords += 1;
        });
        continue;
      }

      const reservation = candidates.shift()!;
      if (candidates.length === 0) {
        reservationBuckets.delete(bucketKey);
      }

      const matchedSegments = reservation.segments.filter((segment) =>
        recordSegments.includes(segment),
      );
      const segmentsToApply =
        matchedSegments.length > 0
          ? Array.from(new Set<MultivariateSegmentKey>(["overall", ...matchedSegments]))
          : (["overall"] as MultivariateSegmentKey[]);

      const age = calculateAge(record.birthDateIso ?? null, record.dateIso);
      const ageBand = resolveAgeBand(age);
      const points =
        typeof record.points === "number" && Number.isFinite(record.points)
          ? record.points
          : null;

      segmentsToApply.forEach((segment) => {
        const aggregate = segmentAggregates[segment];
        aggregate.matchedCount += 1;

        const slotKey = `${reservation.weekday}|${reservation.hour}`;
        let slot = aggregate.slotMap.get(slotKey);
        if (!slot) {
          slot = {
            weekday: reservation.weekday,
            hour: reservation.hour,
            total: 0,
            pointsSum: 0,
            pointsCount: 0,
            ageMap: new Map(),
          };
          aggregate.slotMap.set(slotKey, slot);
        }
        slot.total += 1;
        if (points !== null) {
          slot.pointsSum += points;
          slot.pointsCount += 1;
        }
        const ageEntry = slot.ageMap.get(ageBand.id) ?? {
          label: ageBand.label,
          total: 0,
          pointsSum: 0,
          pointsCount: 0,
        };
        ageEntry.total += 1;
        if (points !== null) {
          ageEntry.pointsSum += points;
          ageEntry.pointsCount += 1;
        }
        slot.ageMap.set(ageBand.id, ageEntry);

        const globalAge = aggregate.ageTotals.get(ageBand.id) ?? {
          label: ageBand.label,
          total: 0,
          pointsSum: 0,
          pointsCount: 0,
        };
        globalAge.total += 1;
        if (points !== null) {
          globalAge.pointsSum += points;
          globalAge.pointsCount += 1;
        }
        aggregate.ageTotals.set(ageBand.id, globalAge);
      });
    }

    reservationBuckets.forEach((list) => {
      list.forEach((reservation) => {
        reservation.segments.forEach((segment) => {
          segmentAggregates[segment].unmatchedReservations += 1;
        });
      });
    });

    const buildAggregate = (aggregate: SegmentAggregate) => {
      const slots = Array.from(aggregate.slotMap.values())
        .map((slot) => {
          const ageBreakdown = Array.from(slot.ageMap.values())
            .map((value) => ({
              ageBandId: value.label,
              label: value.label,
              total: value.total,
              share: slot.total > 0 ? roundTo1Decimal((value.total / slot.total) * 100) : 0,
              avgPoints:
                value.pointsCount > 0
                  ? Math.round((value.pointsSum / value.pointsCount) * 10) / 10
                  : null,
            }))
            .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
          return {
            weekday: slot.weekday,
            hour: slot.hour,
            totalPatients: slot.total,
            avgPoints:
              slot.pointsCount > 0
                ? Math.round((slot.pointsSum / slot.pointsCount) * 10) / 10
                : null,
            ageBreakdown,
          };
        })
        .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);

      const weekdayGroups: MultivariateWeekdayGroup[] = WEEKDAY_PRESENTATION.map(
        ({ weekday, label }) => ({
          weekday,
          label,
          slots: slots.filter((slot) => slot.weekday === weekday),
        }),
      ).filter((group) => group.slots.length > 0);

      const topSlot =
        slots
          .slice()
          .sort(
            (a, b) =>
              b.totalPatients - a.totalPatients || a.weekday - b.weekday || a.hour - b.hour,
          )[0] ?? null;

      const avgCandidates = slots.filter(
        (slot) => slot.avgPoints !== null && slot.totalPatients >= 3,
      );
      const highestAvgSlot =
        avgCandidates
          .slice()
          .sort((a, b) => (b.avgPoints ?? 0) - (a.avgPoints ?? 0))[0] ?? null;

      const leadingAgeBandEntry = Array.from(aggregate.ageTotals.values()).sort(
        (a, b) => b.total - a.total,
      )[0];
      const leadingAgeBand = leadingAgeBandEntry
        ? {
            id: leadingAgeBandEntry.label,
            label: leadingAgeBandEntry.label,
            total: leadingAgeBandEntry.total,
            avgPoints:
              leadingAgeBandEntry.pointsCount > 0
                ? Math.round(
                    (leadingAgeBandEntry.pointsSum / leadingAgeBandEntry.pointsCount) * 10,
                  ) / 10
                : null,
          }
        : null;

      return {
        weekdayGroups,
        topSlot,
        highestAvgSlot,
        leadingAgeBand,
      };
    };

    MULTIVARIATE_SEGMENT_ORDER.forEach((segment) => {
      const aggregate = segmentAggregates[segment];
      const segmentInsight = base.segments[segment];

      segmentInsight.unmatchedRecords = aggregate.unmatchedRecords;
      segmentInsight.unmatchedReservations = aggregate.unmatchedReservations;

      if (aggregate.matchedCount === 0) {
        return;
      }

      const { weekdayGroups, topSlot, highestAvgSlot, leadingAgeBand } = buildAggregate(aggregate);

      segmentInsight.hasData = aggregate.matchedCount > 0;
      segmentInsight.totalMatches = aggregate.matchedCount;
      segmentInsight.weekdayGroups = weekdayGroups;
      segmentInsight.topSlot = topSlot;
      segmentInsight.highestAvgSlot = highestAvgSlot;
      segmentInsight.leadingAgeBand = leadingAgeBand;

      const highlights: string[] = [];
      if (topSlot) {
        highlights.push(
          `最も患者数が多いのは${formatWeekdayWithSuffix(topSlot.weekday)} ${formatHourLabel(topSlot.hour)}帯（${topSlot.totalPatients.toLocaleString(
            "ja-JP",
          )}名）です。`,
        );
        const primaryAge = topSlot.ageBreakdown[0];
        if (primaryAge) {
          highlights.push(
            `${formatWeekdayWithSuffix(topSlot.weekday)} ${formatHourLabel(topSlot.hour)}は${primaryAge.label}が中心（構成比${formatPercentage(
              primaryAge.share,
            )}）です。`,
          );
        }
      }
      if (highestAvgSlot && highestAvgSlot.avgPoints !== null) {
        highlights.push(
          `単価が高いのは${formatWeekdayWithSuffix(highestAvgSlot.weekday)} ${formatHourLabel(highestAvgSlot.hour)}帯（平均${Math.round(
            highestAvgSlot.avgPoints,
          ).toLocaleString("ja-JP")}点）です。`,
        );
      }
      if (leadingAgeBand) {
        highlights.push(
          `最多の年代は${leadingAgeBand.label}で、${leadingAgeBand.total.toLocaleString("ja-JP")}名が来院しています。`,
        );
      }
      if (aggregate.unmatchedRecords > 0 || aggregate.unmatchedReservations > 0) {
        highlights.push(
          `照合できなかったレコードがカルテ側${aggregate.unmatchedRecords.toLocaleString("ja-JP")}件、予約側${aggregate.unmatchedReservations.toLocaleString("ja-JP")}件あります。`,
        );
      }

      segmentInsight.highlights = highlights;
    });

    base.hasData = MULTIVARIATE_SEGMENT_ORDER.some(
      (segment) => base.segments[segment].hasData,
    );

    return base;
  }, [filteredClassified, reservationsRecords]);

  useEffect(() => {
    if (!multivariateInsights.hasData) {
      setSelectedInsightSegment("overall");
      return;
    }
    const selected = multivariateInsights.segments[selectedInsightSegment];
    if (!selected?.hasData) {
      const fallback = MULTIVARIATE_SEGMENT_ORDER.find(
        (segment) => multivariateInsights.segments[segment]?.hasData,
      );
      if (fallback) {
        setSelectedInsightSegment(fallback);
      }
    }
  }, [multivariateInsights, selectedInsightSegment]);

  useEffect(() => {
    const currentSegment = multivariateInsights.segments[selectedInsightSegment];
    setExpandedWeekdayBySegment((prev) => {
      const currentValue = prev[selectedInsightSegment];
      if (!currentSegment?.hasData) {
        if (currentValue !== null) {
          return { ...prev, [selectedInsightSegment]: null };
        }
        return prev;
      }
      if (
        currentValue !== null &&
        !currentSegment.weekdayGroups.some((group) => group.weekday === currentValue)
      ) {
        return { ...prev, [selectedInsightSegment]: null };
      }
      return prev;
    });
  }, [multivariateInsights, selectedInsightSegment]);

  const selectedSegmentInsight =
    multivariateInsights.segments[selectedInsightSegment];
  const selectedSegmentStyles = MULTIVARIATE_SEGMENT_CONFIG[selectedInsightSegment];

  const hasAnyRecords = records.length > 0;
  const hasPeriodRecords = periodFilteredRecords.length > 0;
  const hasDiagnosisRecords = filteredDiagnosisRecords.length > 0;
  const canShowDiagnosisChart = diagnosisMonthlyInRange.length > 0;
  const canShowDiagnosisCategoryChart = diagnosisCategoryMonthlyInRange.length > 0;

  const importKarteFiles = useCallback(
    async (files: File[], { silent }: { silent?: boolean } = {}) => {
      if (files.length === 0) {
        return;
      }

      if (!silent) {
        setUploadError(null);
      }

      try {
        const existingMap = new Map<string, KarteRecord>();

        for (const record of records) {
          const key = `${record.dateIso}|${record.visitType}|${record.patientNumber}|${record.department}`;
          existingMap.set(key, record);
        }

        for (const file of files) {
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

        setShareUrl(null);

        const timestamp = new Date().toISOString();
        const result = saveKarteWithQuotaFallback(merged, timestamp);
        setRecords(result.usedRecords);
        setLastUpdated(timestamp);
        if (!result.saved) {
          throw new Error("ローカル保存容量を超えました。共有URLでの保存をご検討ください。");
        } else if (result.prunedCount) {
          setUploadError(`保存容量超過のため直近${result.prunedCount}ヶ月分のみローカル保存しました。全件の保管は共有URLをご利用ください。`);
        }
      } catch (error) {
        console.error(error);
        const message =
          error instanceof Error
            ? `カルテ集計CSVの解析に失敗しました: ${error.message}`
            : "カルテ集計CSVの解析に失敗しました。";
        if (!silent) {
          setUploadError(message);
        }
        throw error;
      }
    },
    [records],
  );

  const importReservationFiles = useCallback(
    async (files: File[], { silent }: { silent?: boolean } = {}) => {
      if (files.length === 0) {
        return;
      }

      if (!silent) {
        setReservationUploadError(null);
        setIsUploadingReservation(true);
      }

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
        setReservationsRecords(merged);
      } catch (error) {
        console.error(error);
        if (!silent) {
          setReservationUploadError("予約ログCSVの解析に失敗しました。フォーマットをご確認ください。");
        }
        throw error;
      } finally {
        if (!silent) {
          setIsUploadingReservation(false);
        }
      }
    },
    [],
  );

  const importSurveyFiles = useCallback(
    async (files: File[], { silent }: { silent?: boolean } = {}) => {
      if (files.length === 0) {
        return;
      }

      if (!silent) {
        setSurveyUploadError(null);
        setIsUploadingSurvey(true);
      }

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
        if (!silent) {
          setSurveyUploadError("アンケートCSVの解析に失敗しました。");
        }
        throw error;
      } finally {
        if (!silent) {
          setIsUploadingSurvey(false);
        }
      }
    },
    [],
  );

  const importListingFiles = useCallback(
    async (category: ListingCategory, files: File[], { silent }: { silent?: boolean } = {}) => {
      if (files.length === 0) {
        return;
      }

      if (!silent) {
        setListingUploadError(null);
        setIsUploadingListing((state) => ({ ...state, [category]: true }));
      }

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
        if (!silent) {
          setListingUploadError("リスティング広告CSVの解析に失敗しました。");
        }
        throw error;
      } finally {
        if (!silent) {
          setIsUploadingListing((state) => ({ ...state, [category]: false }));
        }
      }
    },
    [],
  );

  const importDiagnosisFiles = useCallback(
    async (files: File[], { silent }: { silent?: boolean } = {}) => {
      if (files.length === 0) {
        return;
      }

      if (!silent) {
        setDiagnosisUploadError(null);
        setIsUploadingDiagnosis(true);
      }

      try {
        const existing = loadDiagnosisFromStorage();
        const incoming: DiagnosisRecord[] = [];

        for (const file of files) {
          const text = await file.text();
          const parsed = parseDiagnosisCsv(text);
          incoming.push(...parsed);
        }

        const merged = mergeDiagnosisRecords(existing, incoming);
        const saveResult = saveDiagnosisToStorage(merged);

        if (saveResult.warning) {
          setDiagnosisUploadError(saveResult.warning);
        }

        setDiagnosisRecords(merged);
        setDiagnosisStatus({
          lastUpdated: saveResult.timestamp,
          total: merged.length,
          byDepartment: calculateDiagnosisDepartmentTotals(merged),
          byCategory: calculateDiagnosisCategoryTotals(merged),
        });
      } catch (error) {
        console.error(error);
        if (!silent) {
          setDiagnosisUploadError("傷病名CSVの解析に失敗しました。フォーマットをご確認ください。");
        }
        throw error;
      } finally {
        if (!silent) {
          setIsUploadingDiagnosis(false);
        }
      }
    },
    [],
  );

  const importSalesFiles = useCallback(
    async (files: File[], { silent }: { silent?: boolean } = {}) => {
      if (files.length === 0) {
        return;
      }

      if (!silent) {
        setSalesUploadError(null);
        setIsUploadingSales(true);
      }

      try {
        let next = loadSalesDataFromStorage();
        for (const file of files) {
          const text = await file.text();
          const parsed = parseSalesCsv(text, { fileName: file.name });
          next = upsertSalesMonth(next, parsed);
        }
        saveSalesDataToStorage(next);
        updateSalesSnapshot(next);
      } catch (error) {
        console.error(error);
        if (!silent) {
          setSalesUploadError("売上CSVの解析に失敗しました。フォーマットをご確認ください。");
        }
        throw error;
      } finally {
        if (!silent) {
          setIsUploadingSales(false);
        }
      }
    },
    [updateSalesSnapshot],
  );

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    try {
      await importKarteFiles(files);
    } finally {
      event.target.value = "";
    }
  };

  const handleReservationDiffExport = () => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const diffRecords = loadReservationDiff();
      if (!diffRecords || diffRecords.length === 0) {
        setReservationUploadError("差分データがありません。");
        return;
      }
      const csv = Papa.unparse(diffRecords);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `reservation_diff_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      setReservationUploadError("差分CSVの出力に失敗しました。");
    }
  };

  const downloadCsv = useCallback((rows: Record<string, string | number | null>[], filename: string) => {
    if (typeof window === "undefined") {
      return;
    }
    const csv = `\uFEFF${Papa.unparse(rows)}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, []);

  const handleKarteExport = useCallback(() => {
    if (records.length === 0) {
      setUploadError("カルテ集計データがありません。");
      return;
    }
    try {
      const rows = records.map((record) => ({
        日付: formatIsoToSlash(record.dateIso),
        "初診・再診": record.visitType,
        患者番号: record.patientNumber ?? "",
        患者生年月日: formatIsoToSlash(record.birthDateIso),
        診療科: record.department ?? "",
        点数: record.points ?? "",
        患者氏名: record.patientNameNormalized ?? "",
        患者住所: record.patientAddress ?? "",
      }));
      downloadCsv(rows, `karte_export_${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (error) {
      console.error(error);
      setUploadError("カルテ集計CSVの出力に失敗しました。");
    }
  }, [downloadCsv, records]);

  const handleReservationExport = useCallback(() => {
    if (reservationsRecords.length === 0) {
      setReservationUploadError("予約ログデータがありません。");
      return;
    }
    try {
      const rows = reservationsRecords.map((record) => ({
        診療科: record.department,
        "初診・再診": record.visitType,
        予約日: formatIsoToSlash(record.reservationDate),
        予約時間: formatHourLabel(record.reservationHour),
        予約月: record.reservationMonth,
        受付日時: record.receivedAtIso,
        来院日時: record.appointmentIso ?? "",
        予約受付日: formatIsoToSlash(record.bookingDate ?? ""),
        予約受付時間: formatHourLabel(record.bookingHour ?? null),
        患者ID: record.patientId,
        患者氏名: record.patientName ?? record.patientNameNormalized ?? "",
        患者年齢: record.patientAge ?? "",
        都道府県: record.patientPrefecture ?? "",
        市区町村: record.patientCity ?? "",
        町名: record.patientTown ?? "",
        住所: record.patientAddress ?? "",
        当日予約: record.isSameDay ? "1" : "0",
      }));
      downloadCsv(rows, `reservation_export_${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (error) {
      console.error(error);
      setReservationUploadError("予約ログCSVの出力に失敗しました。");
    }
  }, [downloadCsv, reservationsRecords]);

  const handleDiagnosisExport = useCallback(() => {
    if (diagnosisRecords.length === 0) {
      setDiagnosisUploadError("傷病名データがありません。");
      return;
    }
    try {
      const rows = diagnosisRecords.map((record) => ({
        主病: "主病",
        診療科: record.department,
        開始日: formatIsoToSlash(record.startDate),
        傷病名: record.diseaseName,
        患者番号: record.patientNumber ?? "",
        患者氏名: record.patientNameNormalized ?? "",
        患者生年月日: formatIsoToSlash(record.birthDateIso),
        カテゴリ: record.category,
      }));
      downloadCsv(rows, `diagnosis_export_${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (error) {
      console.error(error);
      setDiagnosisUploadError("傷病名CSVの出力に失敗しました。");
    }
  }, [diagnosisRecords, downloadCsv]);

  const handleSalesExport = useCallback(() => {
    const salesData = loadSalesDataFromStorage();
    if (salesData.length === 0) {
      setSalesUploadError("売上データがありません。");
      return;
    }
    try {
      const rows = salesData.flatMap((month) =>
        month.days.map((day) => ({
          月: month.label,
          月ID: month.id,
          日: day.day,
          日付: day.date,
          医療収益: day.medicalRevenue,
          自費金額: day.selfPayRevenue,
          その他: day.otherRevenue,
          "日々の合計": day.totalRevenue,
          人数: day.peopleCount ?? "",
          メモ: day.note ?? "",
        })),
      );
      downloadCsv(rows, `sales_export_${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (error) {
      console.error(error);
      setSalesUploadError("売上CSVの出力に失敗しました。");
    }
  }, [downloadCsv]);

  const handleReservationUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const files = input.files ? Array.from(input.files) : [];
    if (files.length === 0) {
      return;
    }

    try {
      await importReservationFiles(files);
    } finally {
      input.value = "";
    }
  };

  const handleSurveyUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const files = input.files ? Array.from(input.files) : [];
    if (files.length === 0) {
      return;
    }

    try {
      await importSurveyFiles(files);
    } finally {
      input.value = "";
    }
  };

  const handleListingUpload =
    (category: ListingCategory) => async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const files = input.files ? Array.from(input.files) : [];
      if (files.length === 0) {
        return;
      }

      try {
        await importListingFiles(category, files);
      } finally {
        input.value = "";
      }
    };

  const handleDiagnosisUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const files = input.files ? Array.from(input.files) : [];
    if (files.length === 0) {
      return;
    }

    try {
      await importDiagnosisFiles(files);
    } finally {
      input.value = "";
    }
  };

  const handleSalesUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const files = input.files ? Array.from(input.files) : [];
    if (files.length === 0) {
      return;
    }

    try {
      await importSalesFiles(files);
    } finally {
      input.value = "";
    }
  };

  const handleExpenseUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const files = input.files ? Array.from(input.files) : [];
    if (files.length === 0) {
      return;
    }

    setIsUploadingExpense(true);
    setExpenseUploadError(null);

    try {
      const allRecords: ExpenseRecord[] = [];

      for (const file of files) {
        const text = await file.text();
        const parsed = parseExpenseCsv(text);
        allRecords.push(...parsed);
      }

      if (allRecords.length === 0) {
        setExpenseUploadError("経費データが見つかりませんでした。freee / MoneyForward形式のCSVを選択してください。");
        return;
      }

      // 既存データとマージ（日付+勘定科目+摘要+金額が同じものは重複とみなす）
      const existing = loadExpenseData();
      const merged = [...existing];
      for (const newRecord of allRecords) {
        const existingIndex = merged.findIndex(
          (r) =>
            r.date === newRecord.date &&
            r.accountCategory === newRecord.accountCategory &&
            r.description === newRecord.description &&
            r.amount === newRecord.amount
        );
        if (existingIndex === -1) {
          merged.push(newRecord);
        }
      }

      // 日付順にソート
      merged.sort((a, b) => a.date.localeCompare(b.date));

      const timestamp = new Date().toISOString();
      saveExpenseData(merged, timestamp);
      updateExpenseSnapshot(merged, timestamp);
    } catch (error) {
      console.error("経費CSVアップロードエラー:", error);
      setExpenseUploadError(
        error instanceof Error ? error.message : "経費CSVの読み込みに失敗しました。"
      );
    } finally {
      setIsUploadingExpense(false);
      input.value = "";
    }
  };

  const handleBulkFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length === 0) {
      return;
    }

    setBulkUploadError(null);

    const makeKey = (file: File) => `${file.name}__${file.size}__${file.lastModified}`;
    const map = new Map<string, File>();
    for (const file of bulkQueue) {
      map.set(makeKey(file), file);
    }
    for (const file of files) {
      map.set(makeKey(file), file);
    }

    const nextQueue = Array.from(map.values());
    setBulkQueue(nextQueue);
    setBulkUploadMessage(`選択中のCSV: ${nextQueue.length}件`);

    if (event.target) {
      event.target.value = "";
    }
  };

  const processBulkFiles = async (files: File[]) => {
    if (files.length === 0) {
      setBulkUploadError("取り込むCSVファイルを追加してください。");
      return;
    }

    setBulkUploadMessage(null);
    setBulkUploadError(null);
    setIsBulkUploading(true);

    try {
      const listingBuckets: Record<ListingCategory, File[]> = {
        内科: [],
        発熱外来: [],
        胃カメラ: [],
        大腸カメラ: [],
      };

      const karteFiles: File[] = [];
      const reservationFiles: File[] = [];
      const surveyFiles: File[] = [];
      const diagnosisFiles: File[] = [];
      const salesFiles: File[] = [];
      const unknownFiles: string[] = [];

      const determineListingCategory = (normalizedName: string): ListingCategory | null => {
        if (normalizedName.includes("発熱") || normalizedName.includes("fever")) {
          return "発熱外来";
        }
        if (
          normalizedName.includes("内科") ||
          normalizedName.includes("生活習慣") ||
          normalizedName.includes("general")
        ) {
          return "内科";
        }
        if (normalizedName.includes("胃") || normalizedName.includes("stomach")) {
          return "胃カメラ";
        }
        if (normalizedName.includes("大腸") || normalizedName.includes("colon")) {
          return "大腸カメラ";
        }
        return null;
      };

      for (const file of files) {
        const normalizedName = file.name.normalize("NFKC");
        const lowerName = normalizedName.toLowerCase();

        if (/(カルテ|karte)/.test(lowerName)) {
          karteFiles.push(file);
          continue;
        }
        if (lowerName.includes("予約")) {
          reservationFiles.push(file);
          continue;
        }
        if (lowerName.includes("アンケート") || lowerName.includes("survey")) {
          surveyFiles.push(file);
          continue;
        }
        if (
          lowerName.includes("傷病") ||
          lowerName.includes("主病") ||
          lowerName.includes("diagnosis")
        ) {
          diagnosisFiles.push(file);
          continue;
        }
        if (
          lowerName.includes("リスティング") ||
          lowerName.includes("listing") ||
          lowerName.includes("広告")
        ) {
          const category = determineListingCategory(lowerName);
          if (category) {
            listingBuckets[category].push(file);
          } else {
            unknownFiles.push(file.name);
          }
          continue;
        }
        if (
          lowerName.includes("売上") ||
          lowerName.includes("売り上げ") ||
          lowerName.includes("sales")
        ) {
          salesFiles.push(file);
          continue;
        }

        unknownFiles.push(file.name);
      }

      const successes: string[] = [];
      const failures: string[] = [];

      const runTask = async (label: string, task: () => Promise<void>) => {
        try {
          await task();
          successes.push(label);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "不明なエラーが発生しました";
          failures.push(`${label}: ${message}`);
        }
      };

      if (karteFiles.length > 0) {
        await runTask("カルテ", () => importKarteFiles(karteFiles, { silent: true }));
      }
      if (reservationFiles.length > 0) {
        await runTask("予約", () => importReservationFiles(reservationFiles, { silent: true }));
      }
      if (surveyFiles.length > 0) {
        await runTask("アンケート", () => importSurveyFiles(surveyFiles, { silent: true }));
      }
      if (diagnosisFiles.length > 0) {
        await runTask("傷病名", () => importDiagnosisFiles(diagnosisFiles, { silent: true }));
      }
      if (salesFiles.length > 0) {
        await runTask("売上", () => importSalesFiles(salesFiles, { silent: true }));
      }

      for (const category of Object.keys(listingBuckets) as ListingCategory[]) {
        const bucket = listingBuckets[category];
        if (bucket.length === 0) {
          continue;
        }
        await runTask(`リスティング(${category})`, () =>
          importListingFiles(category, bucket, { silent: true }),
        );
      }

      if (successes.length > 0) {
        setBulkUploadMessage(`取り込み完了: ${successes.join(" / ")}`);
      } else {
        setBulkUploadMessage("取り込めるCSVが見つかりませんでした。");
      }

      const issues: string[] = [];
      if (failures.length > 0) {
        issues.push(...failures);
      }
      if (unknownFiles.length > 0) {
        issues.push(`判別できなかったファイル: ${unknownFiles.join(", ")}`);
      }
      if (issues.length > 0) {
        setBulkUploadError(issues.join(" / "));
      }
    } finally {
      setIsBulkUploading(false);
    }
  };

  const executeBulkUpload = async () => {
    if (bulkQueue.length === 0) {
      setBulkUploadError("取り込むCSVファイルを追加してください。");
      return;
    }

    await processBulkFiles(bulkQueue);
    if (bulkQueue.length > 0) {
      setBulkQueue([]);
    }
  };

  const clearBulkQueue = () => {
    setBulkQueue([]);
    setBulkUploadMessage("選択中のCSVをクリアしました。");
    setBulkUploadError(null);
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
      const salesData = loadSalesDataFromStorage();
      const salesTimestamp =
        typeof window !== "undefined"
          ? window.localStorage.getItem(SALES_TIMESTAMP_KEY)
          : null;

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
        salesData,
        salesTimestamp,
      };

      const response = await uploadDataToR2({
        type: "karte",
        data: JSON.stringify(bundle),
      });

      const finalUrl = buildShareUrl(response.url, response.id);

      setShareUrl(finalUrl);
      await navigator.clipboard.writeText(finalUrl);
      alert(`共有URLをクリップボードにコピーしました！\n\n${finalUrl}`);
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
    clearCompressedItem(KARTE_STORAGE_KEY);
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
    clearSalesDataStorage();
    setRecords([]);
    setShareUrl(null);
    setLastUpdated(null);
    setUploadError(null);
    setReservationsRecords([]);
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
    updateSalesSnapshot([], null);
  };

  const renderDataManagementPanel = (allowClose: boolean) => (
    <aside id="data-management-panel" className="space-y-6 lg:sticky lg:top-8">
      <SectionCard
        title="データ管理"
        description="カルテ集計の差し替えや共有URL発行に加え、他指標のCSV取り込みもまとめて管理します。"
      >
        <div className="space-y-3">
          {allowClose && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setIsManagementOpen(false)}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold text-slate-500 transition hover:border-brand-200 hover:text-brand-600"
                aria-label="データ管理を閉じる"
              >
                閉じる
              </button>
            </div>
          )}
          <p className="text-xs text-slate-500">
            {isReadOnly
              ? "共有URLから閲覧中です。操作内容は公開データに即時反映されるため取り扱いにご注意ください。"
              : "カルテ集計に加えて、予約ログ・アンケート・広告のCSVもこのページでまとめて更新できます。共有URLはコピーして関係者へ連携してください。"}
          </p>
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-700">まとめてCSV取り込み</p>
                <p className="text-xs text-slate-500">
                  ファイル名に「カルテ」「予約」「アンケート」「リスティング」「傷病」「売上」などのキーワードを含めると自動で振り分けます。
                </p>
              </div>
              <button
                type="button"
                onClick={() => bulkUploadInputRef.current?.click()}
                disabled={isBulkUploading}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  isBulkUploading
                    ? "cursor-wait border-slate-100 bg-slate-100 text-slate-400"
                    : "border-slate-300 text-slate-600 hover:border-brand-200 hover:text-brand-600"
                }`}
              >
                <Upload className="h-4 w-4" />
                {isBulkUploading ? "取り込み中..." : "CSVをまとめて選択"}
              </button>
            </div>
            {bulkUploadMessage && (
              <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
                {bulkUploadMessage}
              </p>
            )}
            {bulkUploadError && (
              <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                {bulkUploadError}
              </p>
            )}
            {bulkQueue.length > 0 && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <p className="text-[11px] font-semibold text-slate-600">
                  選択中のCSV ({bulkQueue.length}件)
                </p>
                <ul className="mt-1 space-y-1 text-[11px] text-slate-500">
                  {bulkQueue.slice(0, 5).map((file) => (
                    <li key={`${file.name}_${file.size}_${file.lastModified}`}>・{file.name}</li>
                  ))}
                  {bulkQueue.length > 5 && (
                    <li className="text-slate-400">…ほか{bulkQueue.length - 5}件</li>
                  )}
                </ul>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={executeBulkUpload}
                disabled={isBulkUploading || bulkQueue.length === 0}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                  bulkQueue.length === 0 || isBulkUploading
                    ? "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-400"
                    : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                }`}
              >
                <RefreshCw className={`h-4 w-4 ${isBulkUploading ? "animate-spin" : ""}`} />
                取り込みを実行
              </button>
              <button
                type="button"
                onClick={clearBulkQueue}
                disabled={isBulkUploading || bulkQueue.length === 0}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                追加リストをクリア
              </button>
            </div>
            <input
              ref={bulkUploadInputRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              className="hidden"
              onChange={handleBulkFileSelect}
            />
          </div>
          <div className="space-y-2">
            {records.length > 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                📊 カルテ集計データ:{" "}
                <span className="font-semibold">
                  {records.length.toLocaleString("ja-JP")}件
                </span>
              </div>
            )}
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
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                  records.length === 0
                    ? "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-400"
                    : "border-slate-300 text-slate-600 hover:border-brand-200 hover:text-brand-600"
                }`}
              >
                <Share2 className={`h-4 w-4 ${isSharing ? "animate-pulse" : ""}`} />
                {isSharing ? "共有リンクを作成中..." : "共有URLを発行"}
              </button>
              <button
                type="button"
                onClick={handleKarteExport}
                disabled={records.length === 0}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                  records.length === 0
                    ? "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-400"
                    : "border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Download className="h-4 w-4" />
                CSVをダウンロード
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100"
              >
                <RotateCcw className="h-4 w-4" />
                すべてのデータをリセット
              </button>
            </div>
            {lastUpdated && (
              <p className="text-[11px] text-slate-500">最終更新: {formatTimestampLabel(lastUpdated)}</p>
            )}
          </div>
          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">予約ログCSV</p>
                <p className="text-xs text-slate-500">時間帯別／診療科別の予約状況を更新します。</p>
              </div>
              <div className="text-right text-[11px] text-slate-500">
                <p>最終更新: {formatTimestampLabel(reservationStatus.lastUpdated)}</p>
                <p>登録件数: {reservationStatus.total.toLocaleString("ja-JP")}件</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label
                className={`flex cursor-pointer items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                  isUploadingReservation
                    ? "pointer-events-none border-slate-100 bg-slate-50 text-slate-400"
                    : "border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Upload className="h-4 w-4" />
                CSVを選択
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleReservationUpload}
                  multiple
                  disabled={isUploadingReservation}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={handleReservationDiffExport}
                disabled={reservationsRecords.length === 0}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                  reservationsRecords.length === 0
                    ? "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-400"
                    : "border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Undo2 className="h-4 w-4" />
                差分CSVをダウンロード
              </button>
              <button
                type="button"
                onClick={handleReservationExport}
                disabled={reservationsRecords.length === 0}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                  reservationsRecords.length === 0
                    ? "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-400"
                    : "border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Download className="h-4 w-4" />
                予約ログCSVをダウンロード
              </button>
            </div>
            {reservationUploadError && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                {reservationUploadError}
              </p>
            )}
          </div>
          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">アンケートCSV</p>
                <p className="text-xs text-slate-500">媒体別／来院種別のアンケート回答を更新します。</p>
              </div>
              <div className="text-right text-[11px] text-slate-500">
                <p>最終更新: {formatTimestampLabel(surveyStatus.lastUpdated)}</p>
                <p>登録件数: {surveyStatus.total.toLocaleString("ja-JP")}件</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label
                className={`flex cursor-pointer items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                  isUploadingSurvey
                    ? "pointer-events-none border-slate-100 bg-slate-50 text-slate-400"
                    : "border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Upload className="h-4 w-4" />
                CSVを選択
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleSurveyUpload}
                  multiple
                  disabled={isUploadingSurvey}
                  className="hidden"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                {Object.entries(surveyStatus.byType).map(([type, count]) => (
                  <span key={type}>
                    {type}: {count.toLocaleString("ja-JP")}件
                  </span>
                ))}
              </div>
            </div>
            {surveyUploadError && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                {surveyUploadError}
              </p>
            )}
          </div>
          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">傷病名CSV（主病）</p>
                <p className="text-xs text-slate-500">
                  主病コードから生活習慣病カテゴリを判定し、患者の継続状況を可視化します。
                </p>
              </div>
              <div className="text-right text-[11px] text-slate-500">
                <p>最終更新: {formatTimestampLabel(diagnosisStatus.lastUpdated)}</p>
                <p>登録件数: {diagnosisStatus.total.toLocaleString("ja-JP")}件</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label
                className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
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
              <button
                type="button"
                onClick={handleDiagnosisExport}
                disabled={diagnosisRecords.length === 0}
                className={`flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                  diagnosisRecords.length === 0
                    ? "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-400"
                    : "border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Download className="h-4 w-4" />
                傷病名CSVをダウンロード
              </button>
              {diagnosisUploadError && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                  {diagnosisUploadError}
                </p>
              )}
            </div>
          </div>
          {!lifestyleOnly && (
            <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 space-y-3">
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
          )}
          <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-700">売上CSV</p>
                <p className="text-xs text-slate-500">月次売上ダッシュボードに使用するデータです。</p>
              </div>
              <div className="text-right text-[11px] text-slate-500">
                <p>最終更新: {formatTimestampLabel(salesStatus.lastUpdated)}</p>
                <p>
                  登録月数: {salesStatus.totalMonths.toLocaleString("ja-JP")}ヶ月 / 総売上{" "}
                  {formatCurrency(salesStatus.totalRevenue)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label
                className={`flex cursor-pointer items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                  isUploadingSales
                    ? "pointer-events-none border-slate-100 bg-slate-50 text-slate-400"
                    : "border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Upload className="h-4 w-4" />
                {isUploadingSales ? "アップロード中..." : "売上CSVを選択"}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleSalesUpload}
                  multiple
                  disabled={isUploadingSales}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={handleSalesExport}
                disabled={salesStatus.totalMonths === 0}
                className={`flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                  salesStatus.totalMonths === 0
                    ? "cursor-not-allowed border-slate-100 bg-slate-100 text-slate-400"
                    : "border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Download className="h-4 w-4" />
                売上CSVをダウンロード
              </button>
            </div>
            {salesUploadError && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                {salesUploadError}
              </p>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-700">経費CSV</p>
                <p className="text-xs text-slate-500">freee / MoneyForward形式の仕訳帳データ（経費分析に使用）</p>
              </div>
              <div className="text-right text-[11px] text-slate-500">
                <p>最終更新: {formatTimestampLabel(expenseStatus.lastUpdated)}</p>
                <p>
                  登録件数: {expenseStatus.totalRecords.toLocaleString("ja-JP")}件 / 総額{" "}
                  {formatCurrency(expenseStatus.totalAmount)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label
                className={`flex cursor-pointer items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                  isUploadingExpense
                    ? "pointer-events-none border-slate-100 bg-slate-50 text-slate-400"
                    : "border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Upload className="h-4 w-4" />
                {isUploadingExpense ? "アップロード中..." : "経費CSVを選択"}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleExpenseUpload}
                  multiple
                  disabled={isUploadingExpense}
                  className="hidden"
                />
              </label>
              {expenseStatus.totalRecords > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("経費データをすべて削除しますか？")) {
                      clearExpenseData();
                      updateExpenseSnapshot([]);
                    }
                  }}
                  className="flex items-center gap-1 rounded-full border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 transition"
                >
                  <RotateCcw className="h-3 w-3" />
                  リセット
                </button>
              )}
            </div>
            {expenseUploadError && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                {expenseUploadError}
              </p>
            )}
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
    </aside>
  );

  if (isDataManagementOnly) {
    const totalListing = Object.values(listingStatus.totals).reduce(
      (acc, value) => acc + value,
      0,
    );
    const managementCards = [
      {
        key: "karte" as const,
        label: "カルテ集計",
        value:
          records.length > 0 ? `${records.length.toLocaleString("ja-JP")}件` : "未登録",
        updated: formatTimestampLabel(lastUpdated),
        gradient: "from-brand-500 via-emerald-500 to-sky-500",
      },
      {
        key: "reservation" as const,
        label: "予約ログ",
        value:
          reservationStatus.total > 0
            ? `${reservationStatus.total.toLocaleString("ja-JP")}件`
            : "未登録",
        updated: formatTimestampLabel(reservationStatus.lastUpdated),
        gradient: "from-sky-500 via-blue-500 to-indigo-500",
      },
      {
        key: "survey" as const,
        label: "アンケート",
        value:
          surveyStatus.total > 0
            ? `${surveyStatus.total.toLocaleString("ja-JP")}件`
            : "未登録",
        updated: formatTimestampLabel(surveyStatus.lastUpdated),
        gradient: "from-rose-500 via-pink-500 to-amber-500",
      },
      {
        key: "listing" as const,
        label: "リスティング広告",
        value: totalListing > 0 ? `${totalListing.toLocaleString("ja-JP")}件` : "未登録",
        updated: formatTimestampLabel(listingStatus.lastUpdated),
        gradient: "from-purple-500 via-violet-500 to-indigo-500",
      },
      {
        key: "diagnosis" as const,
        label: "傷病名（主病）",
        value:
          diagnosisStatus.total > 0
            ? `${diagnosisStatus.total.toLocaleString("ja-JP")}件`
            : "未登録",
        updated: formatTimestampLabel(diagnosisStatus.lastUpdated),
        gradient: "from-amber-500 via-orange-500 to-rose-500",
      },
      {
        key: "sales" as const,
        label: "売上データ",
        value:
          salesStatus.totalMonths > 0
            ? `${salesStatus.totalMonths.toLocaleString("ja-JP")}ヶ月 / ${salesStatus.totalRevenue.toLocaleString("ja-JP")}円`
            : "未登録",
        updated: formatTimestampLabel(salesStatus.lastUpdated),
        gradient: "from-emerald-500 via-teal-500 to-cyan-500",
      },
      {
        key: "expense" as const,
        label: "経費データ",
        value:
          expenseStatus.totalRecords > 0
            ? `${expenseStatus.totalRecords.toLocaleString("ja-JP")}件 / ${expenseStatus.totalAmount.toLocaleString("ja-JP")}円`
            : "未登録",
        updated: formatTimestampLabel(expenseStatus.lastUpdated),
        gradient: "from-orange-500 via-amber-500 to-yellow-500",
      },
    ].filter((card) => (lifestyleOnly ? card.key !== "listing" : true));

    return (
      <main className="min-h-screen bg-background">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
          <section className="overflow-hidden rounded-3xl border border-brand-100 bg-white/95 shadow-xl">
            <div className="relative isolate px-8 py-12 sm:px-10 lg:px-14">
              <div className="absolute -left-16 top-12 h-48 w-48 rounded-full bg-brand-200/40 blur-3xl" />
              <div className="absolute -right-14 bottom-10 h-56 w-56 rounded-full bg-emerald-200/40 blur-3xl" />
              <div className="relative z-10 flex flex-col gap-6">
                <span className="inline-flex items-center gap-2 self-start rounded-full border border-brand-200 bg-brand-50/80 px-4 py-1.5 text-xs font-semibold text-brand-600 shadow-sm">
                  Data Management
                </span>
                <div className="space-y-3">
                  <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">
                    データ管理センター
                  </h1>
                  <p className="max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
                    カルテ集計をはじめ、予約ログ・アンケート・広告・傷病名・売上など各種CSVをまとめて管理します。
                    共有URLの発行や取り込み履歴の確認もこのページで完結します。
                  </p>
                </div>
                {isReadOnly && (
                  <p className="rounded-2xl border border-dashed border-brand-300 bg-white/80 px-4 py-3 text-sm font-medium text-brand-700">
                    共有URLから閲覧中です。操作内容は公開データに即時反映されるため取り扱いにご注意ください。
                  </p>
                )}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {managementCards.map(({ key, label, value, updated, gradient }) => (
                    <div
                      key={key}
                      className="relative overflow-hidden rounded-2xl border border-slate-100 bg-white/90 p-4 shadow-soft"
                    >
                      <div
                        className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-15`}
                      />
                      <div className="relative flex flex-col gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {label}
                        </span>
                        <span className="text-2xl font-bold text-slate-900">{value}</span>
                        <span className="text-[11px] text-slate-500">
                          最終更新: {updated}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
          {renderDataManagementPanel(false)}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <div
          className={`flex flex-col gap-8 ${
            isManagementOpen ? "lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-12" : ""
          }`}
        >
          <div className="flex flex-col gap-8">
        {lifestyleOnly ? (
          <section className="relative overflow-hidden rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-sky-50 p-8 shadow-card">
            <div className="pointer-events-none absolute -right-16 top-0 h-48 w-48 rounded-full bg-gradient-to-br from-rose-200/40 via-accent-300/30 to-brand-200/40 blur-3xl" />
            <div className="pointer-events-none absolute -left-12 bottom-0 h-40 w-40 rounded-full bg-gradient-to-br from-sky-200/40 via-brand-300/30 to-emerald-200/40 blur-3xl" />
            <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
              <div className="space-y-4">
                <p className="text-sm font-semibold text-rose-600">Lifestyle Care Tracker</p>
                <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">生活習慣病 継続分析</h1>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                  傷病名CSV（主病）とカルテ集計CSVを組み合わせ、生活習慣病患者の継続受診状況をフォローアップ専用に可視化します。
                  生活習慣病以外の集計は表示せず、フォロー対象患者の抽出と優先度判断に集中できるビューです。
                </p>
                {lifestyleAnalysis ? (
                  <div className="rounded-2xl border border-emerald-200 bg-white/80 px-4 py-3 text-sm text-emerald-700 shadow-soft sm:px-5">
                    <p className="text-sm font-semibold text-emerald-900">
                      対象患者 {lifestyleAnalysis.totalPatients.toLocaleString("ja-JP")}名
                    </p>
                    <p className="mt-1 text-xs text-emerald-700">
                      継続受診率 {formatPercentage(lifestyleAnalysis.continuationRate)} ・ 基準日{" "}
                      {formatDateLabel(lifestyleAnalysis.baselineDateIso)}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-rose-200 bg-white/70 px-4 py-3 text-sm text-rose-600">
                    主病CSVとカルテ集計CSVを取り込むと、生活習慣病患者の継続状況が表示されます。
                  </div>
                )}
                {isReadOnly && (
                  <p className="rounded-2xl border border-dashed border-rose-300 bg-white/80 px-4 py-3 text-sm font-medium text-rose-600">
                    共有URLから閲覧中です。閲覧者が操作すると共有データにも反映されるため取り扱いにご注意ください。
                  </p>
                )}
                {lastUpdated && (
                  <p className="text-xs font-medium text-slate-500">
                    カルテ集計 最終更新: {new Date(lastUpdated).toLocaleString("ja-JP")}
                  </p>
                )}
              </div>
              <div className="max-w-xs rounded-2xl border border-sky-200 bg-white/85 p-4 text-xs text-slate-600 shadow-soft">
                <p className="font-semibold text-sky-700">フォローアップのヒント</p>
                <ul className="mt-2 space-y-2">
                  <li>・受診遅延（91〜180日）は電話/SMSでの早期フォローがおすすめです。</li>
                  <li>・離脱リスク（181日以上）は服薬状況の確認や来院提案を重点的に行いましょう。</li>
                  <li>・年齢層別の継続率を比較し、優先的に支援したい層を決めてください。</li>
                </ul>
              </div>
            </div>
            {isLoadingShared && (
              <div className="mt-6 rounded-2xl border border-rose-200 bg-white/80 px-4 py-3">
                <p className="flex items-center gap-2 text-sm text-rose-600">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  共有データを読み込んでいます...
                </p>
              </div>
            )}
          </section>
        ) : (
          <section className="relative overflow-hidden rounded-3xl border border-brand-200 bg-gradient-to-r from-white via-brand-50 to-sky-50 p-8 shadow-card">
            <div className="pointer-events-none absolute -right-12 top-0 h-44 w-44 rounded-full bg-gradient-to-br from-brand-200/60 via-emerald-200/40 to-sky-200/40 blur-3xl" />
            <div className="pointer-events-none absolute -left-16 bottom-0 h-40 w-40 rounded-full bg-gradient-to-br from-accent-200/40 via-rose-200/30 to-white/0 blur-3xl" />
            <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
              <div className="space-y-4">
                <p className="text-sm font-semibold text-brand-600">Patient Insights Dashboard</p>
                <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">患者分析（カルテ集計）</h1>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                  カルテ集計CSVをアップロードすると、月次の総患者・純初診・再初診・再診・平均年齢を自動で可視化します。
                  共有URLを作成すれば、同じ集計結果を閲覧専用モードで院内共有できます。
                </p>
                <div className="rounded-2xl border border-emerald-200 bg-white/80 px-4 py-3 text-sm leading-relaxed text-emerald-700 shadow-soft sm:px-5">
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
                CSV のアップロードや共有は専用のデータ管理ページから操作できます。
              </p>
            </div>
            {isLoadingShared && (
              <div className="mt-6 rounded-2xl border border-brand-200 bg-white/80 px-4 py-3">
                <p className="flex items-center gap-2 text-sm text-brand-700">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  共有データを読み込んでいます...
                </p>
              </div>
            )}
          </section>
        )}
        <AnalysisFilterPortal
          months={filterMonths}
          startMonth={startMonth}
          endMonth={endMonth}
          onChangeStart={setStartMonth}
          onChangeEnd={setEndMonth}
          onReset={resetPeriod}
          label={diagnosisRangeLabel}
          rightContent={
            lifestyleOnly ? (
              <p className="text-[11px] font-semibold text-emerald-600">
                選択月を含む半年分を自動表示
              </p>
            ) : null
          }
          renderMonthLabel={formatMonthLabel}
        />

        {!lifestyleOnly && (
          <>
            {stats.length > 0 ? (
              <>
                {latestStat && (
                  <SectionCard
                    title={
                      startMonth && endMonth && startMonth === endMonth
                        ? `${formatMonthLabel(startMonth)} サマリー`
                        : startMonth && endMonth
                          ? `期間内最新月サマリー（${formatMonthLabel(latestStat.month)}）`
                          : "最新月サマリー"
                    }
                    description={
                      startMonth && endMonth && startMonth !== endMonth
                        ? `選択期間：${formatMonthLabel(startMonth)}〜${formatMonthLabel(endMonth)}`
                        : undefined
                    }
                  >
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                      <StatCard
                        label={`${formatMonthLabel(latestStat.month)} 総患者`}
                        value={`${latestStat.totalPatients.toLocaleString("ja-JP")}名`}
                        tone="brand"
                        monthOverMonth={
                          isSingleMonthPeriod && previousMonthStat
                            ? calculateMonthOverMonth(
                                latestStat.totalPatients,
                                previousMonthStat.totalPatients,
                              )
                            : !isSingleMonthPeriod && firstStat
                              ? calculateMonthOverMonth(
                                  latestStat.totalPatients,
                                  firstStat.totalPatients,
                                )
                              : null
                        }
                        isSingleMonth={isSingleMonthPeriod}
                      />
                      <StatCard
                        label={`${formatMonthLabel(latestStat.month)} 純初診`}
                        value={`${latestStat.pureFirstVisits.toLocaleString("ja-JP")}名`}
                        tone="emerald"
                        secondaryLabel="純初診率"
                        secondaryValue={formatPercentage(latestPureRate)}
                        monthOverMonth={
                          isSingleMonthPeriod && previousMonthStat
                            ? calculateMonthOverMonth(
                                latestStat.pureFirstVisits,
                                previousMonthStat.pureFirstVisits,
                              )
                            : !isSingleMonthPeriod && firstStat
                              ? calculateMonthOverMonth(
                                  latestStat.pureFirstVisits,
                                  firstStat.pureFirstVisits,
                                )
                              : null
                        }
                        isSingleMonth={isSingleMonthPeriod}
                      />
                      <StatCard
                        label={`${formatMonthLabel(latestStat.month)} 再初診`}
                        value={`${latestStat.returningFirstVisits.toLocaleString("ja-JP")}名`}
                        tone="accent"
                        secondaryLabel="再初診率"
                        secondaryValue={formatPercentage(latestReturningRate)}
                        monthOverMonth={
                          isSingleMonthPeriod && previousMonthStat
                            ? calculateMonthOverMonth(
                                latestStat.returningFirstVisits,
                                previousMonthStat.returningFirstVisits,
                              )
                            : !isSingleMonthPeriod && firstStat
                              ? calculateMonthOverMonth(
                                  latestStat.returningFirstVisits,
                                  firstStat.returningFirstVisits,
                                )
                              : null
                        }
                        isSingleMonth={isSingleMonthPeriod}
                      />
                      <StatCard
                        label={`${formatMonthLabel(latestStat.month)} 再診`}
                        value={`${latestStat.revisitCount.toLocaleString("ja-JP")}名`}
                        tone="muted"
                        secondaryLabel="継続率"
                        secondaryValue={formatPercentage(latestContinuationRate)}
                        monthOverMonth={
                          isSingleMonthPeriod && previousMonthStat
                            ? calculateMonthOverMonth(
                                latestStat.revisitCount,
                                previousMonthStat.revisitCount,
                              )
                            : !isSingleMonthPeriod && firstStat
                              ? calculateMonthOverMonth(
                                  latestStat.revisitCount,
                                  firstStat.revisitCount,
                                )
                              : null
                        }
                        isSingleMonth={isSingleMonthPeriod}
                      />
                      <StatCard
                        label={`${formatMonthLabel(latestStat.month)} 内視鏡`}
                        value={`${latestStat.endoscopyCount.toLocaleString("ja-JP")}名`}
                        tone="accent"
                        monthOverMonth={
                          isSingleMonthPeriod && previousMonthStat
                            ? calculateMonthOverMonth(
                                latestStat.endoscopyCount,
                                previousMonthStat.endoscopyCount,
                              )
                            : !isSingleMonthPeriod && firstStat
                              ? calculateMonthOverMonth(
                                  latestStat.endoscopyCount,
                                  firstStat.endoscopyCount,
                                )
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
                          isSingleMonthPeriod &&
                          previousMonthStat &&
                          latestStat.averageAge !== null &&
                          previousMonthStat.averageAge !== null
                            ? {
                                value: roundTo1Decimal(
                                  latestStat.averageAge - previousMonthStat.averageAge,
                                ),
                                percentage: roundTo1Decimal(
                                  ((latestStat.averageAge - previousMonthStat.averageAge) /
                                    previousMonthStat.averageAge) *
                                    100,
                                ),
                              }
                            : !isSingleMonthPeriod &&
                                firstStat &&
                                latestStat.averageAge !== null &&
                                firstStat.averageAge !== null
                              ? {
                                  value: roundTo1Decimal(
                                    latestStat.averageAge - firstStat.averageAge,
                                  ),
                                  percentage: roundTo1Decimal(
                                    ((latestStat.averageAge - firstStat.averageAge) /
                                      firstStat.averageAge) *
                                      100,
                                  ),
                                }
                              : null
                        }
                        isSingleMonth={isSingleMonthPeriod}
                      />
                    </div>
                  </SectionCard>
                )}

                {stats.length > 1 && (
                  <SectionCard
                    title={
                      startMonth && endMonth && startMonth !== endMonth
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
                            <th className="px-3 py-2">内視鏡</th>
                            <th className="px-3 py-2">平均年齢</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-700">
                          {stats
                            .slice()
                            .reverse()
                            .map((stat, index, arr) => {
                              const prevStat = arr[index + 1];
                              const totalMoM = prevStat
                                ? calculateMonthOverMonth(stat.totalPatients, prevStat.totalPatients)
                                : null;
                              const pureMoM = prevStat
                                ? calculateMonthOverMonth(
                                    stat.pureFirstVisits,
                                    prevStat.pureFirstVisits,
                                  )
                                : null;
                              const returningMoM = prevStat
                                ? calculateMonthOverMonth(
                                    stat.returningFirstVisits,
                                    prevStat.returningFirstVisits,
                                  )
                                : null;
                              const revisitMoM = prevStat
                                ? calculateMonthOverMonth(stat.revisitCount, prevStat.revisitCount)
                                : null;
                              const endoscopyMoM = prevStat
                                ? calculateMonthOverMonth(
                                    stat.endoscopyCount,
                                    prevStat.endoscopyCount,
                                  )
                                : null;
                              const ageMoM =
                                prevStat && stat.averageAge !== null && prevStat.averageAge !== null
                                  ? {
                                      value: roundTo1Decimal(stat.averageAge - prevStat.averageAge),
                                      percentage: roundTo1Decimal(
                                        ((stat.averageAge - prevStat.averageAge) /
                                          prevStat.averageAge) *
                                          100,
                                      ),
                                    }
                                  : null;

                              return (
                                <tr key={stat.month} className="hover:bg-slate-50">
                                  <td className="px-3 py-2 font-medium text-slate-900">
                                    {formatMonthLabel(stat.month)}
                                  </td>
                                  <td className="px-3 py-2">
                                    {stat.totalPatients.toLocaleString("ja-JP")}
                                    {totalMoM && (
                                      <span
                                        className={`ml-2 text-xs ${
                                          totalMoM.value >= 0 ? "text-emerald-600" : "text-rose-600"
                                        }`}
                                      >
                                        ({totalMoM.value >= 0 ? "+" : ""}
                                        {totalMoM.percentage}%)
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2">
                                    {stat.pureFirstVisits.toLocaleString("ja-JP")}
                                    {pureMoM && (
                                      <span
                                        className={`ml-2 text-xs ${
                                          pureMoM.value >= 0 ? "text-emerald-600" : "text-rose-600"
                                        }`}
                                      >
                                        ({pureMoM.value >= 0 ? "+" : ""}
                                        {pureMoM.percentage}%)
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2">
                                    {stat.returningFirstVisits.toLocaleString("ja-JP")}
                                    {returningMoM && (
                                      <span
                                        className={`ml-2 text-xs ${
                                          returningMoM.value >= 0
                                            ? "text-emerald-600"
                                            : "text-rose-600"
                                        }`}
                                      >
                                        ({returningMoM.value >= 0 ? "+" : ""}
                                        {returningMoM.percentage}%)
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2">
                                    {stat.revisitCount.toLocaleString("ja-JP")}
                                    {revisitMoM && (
                                      <span
                                        className={`ml-2 text-xs ${
                                          revisitMoM.value >= 0 ? "text-emerald-600" : "text-rose-600"
                                        }`}
                                      >
                                        ({revisitMoM.value >= 0 ? "+" : ""}
                                        {revisitMoM.percentage}%)
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2">
                                    {stat.endoscopyCount.toLocaleString("ja-JP")}
                                    {endoscopyMoM && (
                                      <span
                                        className={`ml-2 text-xs ${
                                          endoscopyMoM.value >= 0
                                            ? "text-emerald-600"
                                            : "text-rose-600"
                                        }`}
                                      >
                                        ({endoscopyMoM.value >= 0 ? "+" : ""}
                                        {endoscopyMoM.percentage}%)
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2">
                                    {stat.averageAge !== null
                                      ? `${roundTo1Decimal(stat.averageAge)}歳`
                                      : "—"}
                                    {ageMoM && (
                                      <span
                                        className={`ml-2 text-xs ${
                                          ageMoM.value >= 0 ? "text-emerald-600" : "text-rose-600"
                                        }`}
                                      >
                                        ({ageMoM.value >= 0 ? "+" : ""}
                                        {roundTo1Decimal(ageMoM.percentage)}%)
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
                      <div className="mt-4 space-y-2">
                        <p className="text-[11px] text-slate-500">
                          ※ 各系列は患者区分別の件数推移です。ポイントにカーソルを合わせると該当月の数値が表示されます。
                        </p>
                        <MonthlyTrendChart stats={stats} />
                      </div>
                    )}
                  </SectionCard>
                )}

                {/* 年代別分析セクション */}
                {records.length > 0 && (
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white/60 py-10">
                        <RefreshCw className="h-6 w-6 animate-spin text-brand-600" />
                      </div>
                    }
                  >
                    <AgeGroupAnalysisSection records={periodFilteredRecords} />
                  </Suspense>
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
              title="診療科別 平均単価（保険点数換算）"
              description="カルテ集計CSVの点数列を基に、指定科目の平均点数と保険点数×10円による概算単価を算出しています。"
            >
              {hasUnitPriceData ? (
                <div className="space-y-4">
                  <button
                    onClick={() => setShowUnitPriceChart((value) => !value)}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    type="button"
                  >
                    {showUnitPriceChart ? "グラフを非表示" : "グラフを表示"}
                  </button>
                  {showUnitPriceChart && (
                    <Suspense
                      fallback={
                        <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white/60 py-10">
                          <RefreshCw className="h-6 w-6 animate-spin text-brand-600" />
                        </div>
                      }
                    >
                      <UnitPriceWeekdayChart
                        rows={unitPriceWeekdayRows.map((row) => {
                          const stats: Record<string, { averageAmount: number | null }> = {};
                          UNIT_PRICE_GROUPS.forEach((group) => {
                            stats[group.id] = {
                              averageAmount: row.stats[group.id]?.averageAmount ?? null,
                            };
                          });
                          return {
                            label: row.label,
                            stats,
                          };
                        })}
                        groups={UNIT_PRICE_GROUPS.map(({ id, label }) => ({ id, label }))}
                      />
                    </Suspense>
                  )}
                  <div className="overflow-x-auto rounded-2xl border border-slate-200">
                    <table className="w-full min-w-[920px] border-collapse text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold" rowSpan={2}>
                            曜日
                          </th>
                          {UNIT_PRICE_GROUPS.map((group) => (
                            <th
                              key={`${group.id}-header`}
                              className="px-4 py-3 text-center font-semibold"
                              colSpan={2}
                            >
                              {group.label}
                            </th>
                          ))}
                        </tr>
                        <tr>
                          {UNIT_PRICE_GROUPS.map((group) => (
                            <Fragment key={`${group.id}-subheader`}>
                              <th className="px-4 py-2 text-center font-semibold">患者数</th>
                              <th className="px-4 py-2 text-center font-semibold">平均単価（円）</th>
                            </Fragment>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {unitPriceWeekdayRows.map((row) => (
                          <tr key={row.key}>
                            <td className="px-4 py-3 text-slate-700">{row.label}</td>
                            {UNIT_PRICE_GROUPS.map((group) => {
                              const stat = row.stats[group.id];
                              return (
                                <Fragment key={`${row.key}-${group.id}`}>
                                  <td className="px-4 py-3 text-center">
                                    {stat.patientCount > 0 ? (
                                      <span className="inline-flex items-center justify-center rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm">
                                        {stat.patientCount.toLocaleString("ja-JP")}名
                                      </span>
                                    ) : (
                                      <span className="text-slate-400">—</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    {stat.averageAmount !== null ? (
                                      (() => {
                                        const rank =
                                          unitPriceRankingByGroup.get(group.id)?.get(row.key);
                                        const highlightClass =
                                          rank === 1
                                            ? "bg-gradient-to-r from-accent-500 via-rose-400 to-accent-600 text-white shadow-md shadow-rose-400/50"
                                            : rank === 2
                                              ? "bg-gradient-to-r from-brand-500/90 to-brand-400/90 text-white shadow-md shadow-brand-400/40"
                                              : rank === 3
                                                ? "bg-gradient-to-r from-amber-400/90 to-amber-300/90 text-amber-900 shadow-md shadow-amber-200/50"
                                                : "bg-blue-50 text-blue-700";
                                        return (
                                          <span
                                            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold ${highlightClass}`}
                                          >
                                            {rank && rank <= 3 && (
                                              <span
                                                className={`rounded-full px-2 py-[1px] text-[10px] font-semibold ${
                                                  rank === 3
                                                    ? "bg-white/70 text-amber-900"
                                                    : "bg-white/20 text-white"
                                                }`}
                                              >
                                                No.{rank}
                                              </span>
                                            )}
                                            <span>¥{stat.averageAmount.toLocaleString("ja-JP")}</span>
                                          </span>
                                        );
                                      })()
                                    ) : (
                                      <span className="text-slate-400">—</span>
                                    )}
                                  </td>
                                </Fragment>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    ※ 各平均単価は保険点数を 10 円換算した概算額です。祝日は国民の祝日および振替休日を含みます。
                  </p>
                </div>
              ) : (
                <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  該当期間に保険点数が登録された診療データがありません。カルテ集計CSVの点数列をご確認ください。
                </p>
              )}
            </SectionCard>
          </>
        )}

        {lifestyleOnly && (
          <SectionCard
            title="生活習慣病 継続性分析"
            description="傷病名CSV（主病）とカルテ集計CSVを突合し、生活習慣病患者の受診継続性を評価しています。"
          >
            {lifestyleAnalysis ? (
              <div className="space-y-6">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/90 via-white to-white p-4 shadow-soft">
                    <p className="text-xs font-semibold text-emerald-700">生活習慣病患者数</p>
                    <p className="mt-2 text-3xl font-bold text-emerald-900">
                      {lifestyleAnalysis.totalPatients.toLocaleString("ja-JP")}名
                    </p>
                    <div className="mt-4 flex items-end justify-between gap-3">
                      <span className="text-xs font-semibold text-emerald-700">継続受診率</span>
                      <span className="inline-flex items-baseline gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-lg font-bold text-emerald-700 ring-1 ring-emerald-200/60">
                        {formatPercentage(lifestyleAnalysis.continuationRate)}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-emerald-600">
                      継続率は患者全体に対するフォロー状況を示す最重要指標です。
                    </p>
                  </div>
                  {lifestyleStatusEntries.map((entry, index) => (
                    <div
                      key={entry.status}
                      className={`rounded-2xl border ${entry.config.card} p-4 shadow-soft`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${entry.config.badge}`}
                        >
                          {entry.label}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-[2px] text-[10px] font-semibold text-slate-500">
                          No.{index + 1}
                        </span>
                      </div>
                      <p className={`mt-4 text-[32px] font-extrabold tracking-tight ${entry.config.percentText}`}>
                        {entry.formattedPercentage}
                      </p>
                      <p className="text-xs text-slate-500">患者全体に占める割合</p>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${entry.config.percentChip}`}
                        >
                          {entry.count.toLocaleString("ja-JP")}名
                        </span>
                        <span className="text-[11px] text-slate-400">{entry.description}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                  データ期間: {formatDateLabel(lifestyleAnalysis.rangeStartIso)}〜
                  {formatDateLabel(lifestyleAnalysis.baselineDateIso)}（基準日:
                  {formatDateLabel(lifestyleAnalysis.baselineDateIso)}）。最終来院からの経過日数は基準日までの差分で計算しています。
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-soft">
                    <h3 className="text-base font-semibold text-slate-900">最終来院からの経過日数</h3>
                    <table className="mt-3 w-full border-collapse text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">区分</th>
                          <th className="px-3 py-2 text-right font-semibold">人数</th>
                          <th className="px-3 py-2 text-right font-semibold">構成比</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {lifestyleAnalysis.daysDistribution.map((item) => (
                          <tr key={item.id} className="bg-white">
                            <td className="px-3 py-2 text-slate-700">{item.label}</td>
                            <td className="px-3 py-2 text-right text-slate-600">
                              {item.count.toLocaleString("ja-JP")}名
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600">
                              {formatPercentage(item.percentage)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-soft">
                    <h3 className="text-base font-semibold text-slate-900">来院回数の分布</h3>
                    <table className="mt-3 w-full border-collapse text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">回数</th>
                          <th className="px-3 py-2 text-right font-semibold">人数</th>
                          <th className="px-3 py-2 text-right font-semibold">構成比</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {lifestyleAnalysis.visitDistribution.map((item) => (
                          <tr key={item.id} className="bg-white">
                            <td className="px-3 py-2 text-slate-700">{item.label}</td>
                            <td className="px-3 py-2 text-right text-slate-600">
                              {item.count.toLocaleString("ja-JP")}名
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600">
                              {formatPercentage(item.percentage)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-soft">
                  <h3 className="text-base font-semibold text-slate-900">疾患別の継続状況</h3>
                  <table className="mt-3 w-full border-collapse text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">疾患カテゴリ</th>
                        <th className="px-3 py-2 text-right font-semibold">患者数</th>
                        <th className="px-3 py-2 text-right font-semibold">定期受診中</th>
                        <th className="px-3 py-2 text-right font-semibold">受診遅延</th>
                        <th className="px-3 py-2 text-right font-semibold">離脱リスク</th>
                        <th className="px-3 py-2 text-right font-semibold">平均来院回数</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {lifestyleDiseaseStatsSorted.map((item) => (
                        <tr key={item.id} className="bg-white">
                          <td className="px-3 py-2 text-slate-700">{item.label}</td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {item.total.toLocaleString("ja-JP")}名
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex flex-col items-end gap-1">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${LIFESTYLE_STATUS_CONFIG.regular.percentChip}`}
                              >
                                {formatPercentage(item.rates.regular)}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {item.statusCounts.regular.toLocaleString("ja-JP")}名
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex flex-col items-end gap-1">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${LIFESTYLE_STATUS_CONFIG.delayed.percentChip}`}
                              >
                                {formatPercentage(item.rates.delayed)}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {item.statusCounts.delayed.toLocaleString("ja-JP")}名
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex flex-col items-end gap-1">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${LIFESTYLE_STATUS_CONFIG.atRisk.percentChip}`}
                              >
                                {formatPercentage(item.rates.atRisk)}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {item.statusCounts.atRisk.toLocaleString("ja-JP")}名
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {item.averageVisits !== null
                              ? `${item.averageVisits.toLocaleString("ja-JP", {
                                  minimumFractionDigits: 1,
                                  maximumFractionDigits: 1,
                                })}回`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[11px] text-slate-500">
                    ※ 「複数疾患/その他」には複合疾患および上記3疾患以外の生活習慣病が含まれます。
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-soft">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="text-base font-semibold text-slate-900">年齢別の離脱率</h3>
                    {lifestyleAnalysis.ageStats.ranking.length >= 2 && (
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-600">
                          ベスト: {lifestyleAnalysis.ageStats.ranking[0].label}
                          （{formatPercentage(lifestyleAnalysis.ageStats.ranking[0].continuationRate)}）
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 font-semibold text-rose-600">
                          ワースト: {
                            lifestyleAnalysis.ageStats.ranking[
                              lifestyleAnalysis.ageStats.ranking.length - 1
                            ].label
                          }
                          （
                          {formatPercentage(
                            lifestyleAnalysis.ageStats.ranking[
                              lifestyleAnalysis.ageStats.ranking.length - 1
                            ].continuationRate,
                          )}
                          ）
                        </span>
                      </div>
                    )}
                  </div>
                  <table className="mt-3 w-full border-collapse text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">年齢層</th>
                        <th className="px-3 py-2 text-right font-semibold">患者数</th>
                        <th className="px-3 py-2 text-right font-semibold">継続受診率</th>
                        <th className="px-3 py-2 text-right font-semibold">受診遅延率</th>
                        <th className="px-3 py-2 text-right font-semibold">離脱リスク率</th>
                        <th className="px-3 py-2 text-right font-semibold">平均来院回数</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {lifestyleAnalysis.ageStats.groups.map((group) => (
                        <tr key={group.id} className="bg-white">
                          <td className="px-3 py-2 text-slate-700">{group.label}</td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {group.count.toLocaleString("ja-JP")}名
                          </td>
                          <td className="px-3 py-2 text-right text-emerald-600">
                            {formatPercentage(group.rates.regular)}
                          </td>
                          <td className="px-3 py-2 text-right text-amber-600">
                            {formatPercentage(group.rates.delayed)}
                          </td>
                          <td className="px-3 py-2 text-right text-rose-600">
                            {formatPercentage(group.rates.atRisk)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {group.averageVisits !== null
                              ? `${group.averageVisits.toLocaleString("ja-JP", {
                                  minimumFractionDigits: 1,
                                  maximumFractionDigits: 1,
                                })}回`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-700">
                    <p className="font-semibold text-amber-800">受診遅延（91〜180日）</p>
                    <p className="mt-1">
                      対象: {lifestyleAnalysis.delayedPatients.total.toLocaleString("ja-JP")}名
                    </p>
                    <p className="mt-1">
                      受診間隔が開き始めているため、電話やSMSで早めの受診を促すと効果的です。
                    </p>
                  </div>
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
                    <p className="font-semibold text-rose-800">離脱リスク（181日以上）</p>
                    <p className="mt-1">
                      対象: {lifestyleAnalysis.atRiskPatients.total.toLocaleString("ja-JP")}名（うち過去4回以上: {lifestyleAnalysis.atRiskPatients.highEngagement.toLocaleString("ja-JP")}名）
                    </p>
                    <p className="mt-1">
                      半年以上受診が無いため、健診・投薬タイミングのリマインドなど重点フォローが必要です。
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                生活習慣病の主病データとカルテ集計を取り込むと、継続状況が表示されます。
              </p>
            )}
          </SectionCard>
        )}

        {!lifestyleOnly && (
        <SectionCard
          title="視点別インサイト"
          description="診療科別・時間帯別の視点から主要指標とグラフを比較します。"
        >
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: "department", label: "診療科" },
                { id: "time", label: "曜日別" },
                ...(ENABLE_MULTIVARIATE
                  ? ([{ id: "channel", label: "多変量解析" }] as Array<{
                      id: typeof insightTab;
                      label: string;
                    }>)
                  : ([] as Array<{ id: typeof insightTab; label: string }>)),
              ] as Array<{ id: typeof insightTab; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setInsightTab(tab.id)}
                className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${
                  insightTab === tab.id
                    ? "border-brand-300 bg-brand-50 text-brand-700"
                    : "border-slate-200 text-slate-600 hover:border-brand-200 hover:text-brand-600"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="mt-6 space-y-6">
            {insightTab === "department" && (
              <div className="space-y-6">
                {departmentStats.length > 0 ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {departmentStats.map((row) => {
                        const prevRow = previousDepartmentStats.get(row.department);
                        const totalMoM = prevRow ? calculateMonthOverMonth(row.total, prevRow.total) : null;
                        const pureMoM = prevRow ? calculateMonthOverMonth(row.pureFirst, prevRow.pureFirst) : null;
                        const returningMoM = prevRow ? calculateMonthOverMonth(row.returningFirst, prevRow.returningFirst) : null;
                        const revisitMoM = prevRow ? calculateMonthOverMonth(row.revisit, prevRow.revisit) : null;
                        const ageMoM =
                          prevRow && row.averageAge !== null && prevRow.averageAge !== null
                            ? {
                                value: roundTo1Decimal(row.averageAge - prevRow.averageAge),
                                percentage: roundTo1Decimal(
                                  ((row.averageAge - prevRow.averageAge) / prevRow.averageAge) * 100,
                                ),
                              }
                            : null;

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
                    <div className="space-y-3">
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
                      onClick={() => setShowDepartmentChart((value) => !value)}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      {showDepartmentChart ? "グラフを非表示" : "診療科別グラフを表示"}
                    </button>
                    {showDepartmentChart && (
                      <div className="mt-4 space-y-2">
                        <p className="text-[11px] text-slate-500">
                          ※ 円グラフは診療科別のシェアを示し、凡例で科を選択して比較できます。
                        </p>
                        <DepartmentChart records={filteredClassified} />
                      </div>
                    )}
                  </>
                )}
                {shiftDepartmentOptions.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-sm font-semibold text-slate-700">時間帯別 平均単価</h3>
                      <select
                        value={selectedShiftDepartment}
                        onChange={(event) => setSelectedShiftDepartment(event.target.value)}
                        className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none"
                      >
                        {shiftDepartmentOptions.map((department) => (
                          <option key={department} value={department}>
                            {department}
                          </option>
                        ))}
                      </select>
                    </div>
                    {shiftRows.length > 0 ? (
                      <div className="overflow-x-auto rounded-2xl border border-slate-200">
                        <table className="w-full min-w-[640px] border-collapse text-sm">
                          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-4 py-3 text-left font-semibold">曜日</th>
                              <th className="px-4 py-3 text-left font-semibold">時間帯</th>
                              <th className="px-4 py-3 text-right font-semibold">患者数</th>
                              <th className="px-4 py-3 text-right font-semibold">平均点数</th>
                              <th className="px-4 py-3 text-right font-semibold">平均単価(円)</th>
                              <th className="px-4 py-3 text-right font-semibold">平均年齢</th>
                              <th className="px-4 py-3 text-right font-semibold">初診率</th>
                              <th className="px-4 py-3 text-right font-semibold">再診率</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {shiftRows.map((row) => (
                              <tr key={row.key}>
                                <td className="px-4 py-3 text-slate-700">{formatWeekdayWithSuffix(row.weekday)}</td>
                                <td className="px-4 py-3 text-slate-700">{formatHourLabel(row.hour)}</td>
                                <td className="px-4 py-3 text-right text-slate-600">
                                  {row.patientCount.toLocaleString("ja-JP")}名
                                </td>
                                <td className="px-4 py-3 text-right text-slate-600">
                                  {row.averagePoints !== null
                                    ? `${row.averagePoints.toLocaleString("ja-JP", {
                                        minimumFractionDigits: 1,
                                        maximumFractionDigits: 1,
                                      })}点`
                                    : "—"}
                                </td>
                                <td className="px-4 py-3 text-right text-slate-600">
                                  {row.averageAmount !== null
                                    ? `¥${row.averageAmount.toLocaleString("ja-JP")}`
                                    : "—"}
                                </td>
                                <td className="px-4 py-3 text-right text-slate-600">
                                  {row.averageAge !== null
                                    ? `${row.averageAge.toLocaleString("ja-JP", {
                                        minimumFractionDigits: 1,
                                        maximumFractionDigits: 1,
                                      })}歳`
                                    : "—"}
                                </td>
                                <td className="px-4 py-3 text-right text-slate-600">
                                  {row.pureRate !== null
                                    ? `${row.pureRate.toLocaleString("ja-JP", {
                                        minimumFractionDigits: 1,
                                        maximumFractionDigits: 1,
                                      })}%`
                                    : "—"}
                                </td>
                                <td className="px-4 py-3 text-right text-slate-600">
                                  {row.revisitRate !== null
                                    ? `${row.revisitRate.toLocaleString("ja-JP", {
                                        minimumFractionDigits: 1,
                                        maximumFractionDigits: 1,
                                      })}%`
                                    : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                        選択した診療科で結合可能な予約データが見つかりませんでした。
                      </p>
                    )}
                    <p className="text-[11px] text-slate-500">
                      ※ 予約CSV（I列: 氏名）とカルテCSVの氏名・日付が一致したデータのみ集計しています。同姓同名の場合は先に一致した予約を使用します。
                    </p>
                  </div>
                )}
              </div>
            )}
            {insightTab === "time" && (
              <div>
                {filteredClassified.length > 0 ? (
                  <>
                    <button
                      onClick={() => setShowWeekdayChart((value) => !value)}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      {showWeekdayChart ? "グラフを非表示" : "曜日別グラフを表示"}
                    </button>
                    {showWeekdayChart && (
                      <div className="mt-4 space-y-2">
                        <p className="text-[11px] text-slate-500">
                          ※ 祝日は独立したカテゴリとして集計し、平均件数は来院日ベースで算出しています。
                        </p>
                        <Suspense
                          fallback={
                            <div className="flex items-center justify-center py-8">
                              <RefreshCw className="h-6 w-6 animate-spin text-brand-600" />
                            </div>
                          }
                        >
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
              </div>
            )}
            {ENABLE_MULTIVARIATE && insightTab === "channel" && (
              <div className="space-y-6">
                {multivariateInsights.hasData && selectedSegmentInsight?.hasData ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      {MULTIVARIATE_SEGMENT_ORDER.map((segment) => {
                        const config = MULTIVARIATE_SEGMENT_CONFIG[segment];
                        const insight = multivariateInsights.segments[segment];
                        const isActive = segment === selectedInsightSegment;
                        const isDisabled = !insight?.hasData;
                        return (
                          <button
                            key={segment}
                            type="button"
                            onClick={() => setSelectedInsightSegment(segment)}
                            disabled={isDisabled}
                            className={[
                              "rounded-full border px-4 py-2 text-sm font-semibold transition",
                              isActive
                                ? `bg-gradient-to-r ${config.gradientClass} text-white shadow-lg ring-2 ${config.ringClass}`
                                : "bg-white text-slate-600 hover:border-brand-200 hover:text-brand-600",
                              isDisabled ? "opacity-50 cursor-not-allowed" : "",
                            ].join(" ")}
                          >
                            {config.label}
                          </button>
                        );
                      })}
                    </div>

                    <div
                      className={`overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-br ${selectedSegmentStyles.gradientClass} p-6 text-white shadow-xl`}
                    >
                      <div className="flex flex-col gap-6">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/80">
                              Channel Overview
                            </p>
                            <h3 className="text-2xl font-bold">
                              {selectedSegmentStyles.label}のインサイト
                            </h3>
                          </div>
                          <span
                            className={`rounded-full px-4 py-1 text-xs font-semibold backdrop-blur ${selectedSegmentStyles.chipClass}`}
                          >
                            {selectedSegmentStyles.label}
                          </span>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl bg-white/25 p-5 shadow-lg shadow-black/10 backdrop-blur">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/70">
                                  照合できた来院データ
                                </p>
                                <p className="mt-1 text-sm font-semibold text-white/90">総件数</p>
                              </div>
                              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white">
                                <Users className="h-5 w-5" />
                              </span>
                            </div>
                            <p className="mt-4 text-3xl font-bold">
                              {selectedSegmentInsight.totalMatches.toLocaleString("ja-JP")}件
                            </p>
                            <p className="mt-3 text-[11px] text-white/80">
                              カルテ未照合 {selectedSegmentInsight.unmatchedRecords.toLocaleString("ja-JP")}件 / 予約未照合 {selectedSegmentInsight.unmatchedReservations.toLocaleString("ja-JP")}件
                            </p>
                          </div>

                          <div className="rounded-2xl bg-white/25 p-5 shadow-lg shadow-black/10 backdrop-blur">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/70">
                                  最多来院枠
                                </p>
                                <p className="mt-1 text-sm font-semibold text-white/90">ピーク帯</p>
                              </div>
                              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white">
                                <Clock className="h-5 w-5" />
                              </span>
                            </div>
                            <p className="mt-4 text-xl font-bold">
                              {selectedSegmentInsight.topSlot
                                ? `${formatWeekdayWithSuffix(selectedSegmentInsight.topSlot.weekday)} ${formatHourLabel(selectedSegmentInsight.topSlot.hour)}`
                                : "データ不足"}
                            </p>
                            <p className="mt-2 text-sm text-white/80">
                              {selectedSegmentInsight.topSlot
                                ? `${selectedSegmentInsight.topSlot.totalPatients.toLocaleString("ja-JP")}名`
                                : "対象データを取り込んでください"}
                            </p>
                          </div>

                          <div className="rounded-2xl bg-white/25 p-5 shadow-lg shadow-black/10 backdrop-blur">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/70">
                                  平均点数が高い枠
                                </p>
                                <p className="mt-1 text-sm font-semibold text-white/90">ハイバリュー</p>
                              </div>
                              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white">
                                <TrendingUp className="h-5 w-5" />
                              </span>
                            </div>
                            <p className="mt-4 text-xl font-bold">
                              {selectedSegmentInsight.highestAvgSlot
                                ? `${formatWeekdayWithSuffix(selectedSegmentInsight.highestAvgSlot.weekday)} ${formatHourLabel(selectedSegmentInsight.highestAvgSlot.hour)}`
                                : "データ不足"}
                            </p>
                            <p className="mt-2 text-sm text-white/80">
                              {selectedSegmentInsight.highestAvgSlot?.avgPoints !== null && selectedSegmentInsight.highestAvgSlot?.avgPoints !== undefined
                                ? `平均${Math.round(selectedSegmentInsight.highestAvgSlot.avgPoints).toLocaleString("ja-JP")}点`
                                : "集計可能な点数がありません"}
                            </p>
                          </div>

                          <div className="rounded-2xl bg-white/25 p-5 shadow-lg shadow-black/10 backdrop-blur">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/70">
                                  主な年代
                                </p>
                                <p className="mt-1 text-sm font-semibold text-white/90">リード層</p>
                              </div>
                              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white">
                                <UserPlus className="h-5 w-5" />
                              </span>
                            </div>
                            <p className="mt-4 text-xl font-bold">
                              {selectedSegmentInsight.leadingAgeBand?.label ?? "データ不足"}
                            </p>
                            <p className="mt-2 text-sm text-white/80">
                              {selectedSegmentInsight.leadingAgeBand
                                ? `${selectedSegmentInsight.leadingAgeBand.total.toLocaleString("ja-JP")}名`
                                : "来院データを取り込んでください"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {selectedSegmentInsight.highlights.length > 0 && (
                      <div className="rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-soft">
                        <h3 className="text-base font-semibold text-slate-900">注目ポイント</h3>
                        <ul className="mt-2 space-y-2 text-sm text-slate-600">
                          {selectedSegmentInsight.highlights.map((item, index) => (
                            <li key={`multivariate-highlight-${index}`}>・{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="grid gap-4 lg:grid-cols-2">
                      {selectedSegmentInsight.weekdayGroups.map((group) => {
                        const isExpanded = expandedWeekdayBySegment[selectedInsightSegment] === group.weekday;
                        const groupTotal = group.slots.reduce((sum, slot) => sum + slot.totalPatients, 0);
                        const peakSlot = group.slots.slice().sort((a, b) => b.totalPatients - a.totalPatients)[0] ?? null;
                        const chartData = group.slots.map((slot) => ({
                          hourLabel: formatHourLabel(slot.hour),
                          patients: slot.totalPatients,
                          avgPoints: slot.avgPoints ?? 0,
                          rawAvg: slot.avgPoints,
                        }));
                        const gradientId = `weekday-${selectedInsightSegment}-${group.weekday}`;
                        return (
                          <div
                            key={`weekday-group-${selectedInsightSegment}-${group.weekday}`}
                            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-lg transition hover:-translate-y-1 hover:shadow-xl"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedWeekdayBySegment((prev) => ({
                                  ...prev,
                                  [selectedInsightSegment]: isExpanded ? null : group.weekday,
                                }))
                              }
                              className="flex w-full items-center justify-between gap-3 text-left"
                            >
                              <div>
                                <p className="text-sm font-semibold tracking-[0.2em] text-slate-700">
                                  {group.label === "祝日" ? "祝日" : `${formatWeekdayWithSuffix(group.weekday)}`}
                                </p>
                                <p className="mt-1 text-xl font-bold text-slate-800">
                                  {groupTotal.toLocaleString("ja-JP")}名
                                  {peakSlot ? (
                                    <span className="ml-2 text-xs font-medium text-slate-500">
                                      ピーク {formatHourLabel(peakSlot.hour)} / {peakSlot.totalPatients.toLocaleString("ja-JP")}名
                                    </span>
                                  ) : null}
                                </p>
                              </div>
                              <span
                                className={`flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition ${
                                  isExpanded ? "rotate-180" : ""
                                }`}
                              >
                                <ChevronDown className="h-4 w-4" />
                              </span>
                            </button>
                            {isExpanded && (
                              <div className="mt-5 space-y-4">
                                <div className="h-56">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={chartData}>
                                      <defs>
                                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                          <stop offset="0%" stopColor={selectedSegmentStyles.barColor} stopOpacity={0.85} />
                                          <stop offset="100%" stopColor={selectedSegmentStyles.barColor} stopOpacity={0.2} />
                                        </linearGradient>
                                      </defs>
                                      <CartesianGrid stroke="rgba(148, 163, 184, 0.3)" strokeDasharray="3 3" />
                                      <XAxis dataKey="hourLabel" tick={{ fontSize: 11, fill: "#475569" }} />
                                      <YAxis
                                        yAxisId="left"
                                        tick={{ fontSize: 11, fill: "#475569" }}
                                        label={{
                                          value: "来院数",
                                          angle: -90,
                                          offset: 10,
                                          position: "insideLeft",
                                          style: { fill: "#475569", fontSize: 11 },
                                        }}
                                      />
                                      <YAxis
                                        yAxisId="right"
                                        orientation="right"
                                        tick={{ fontSize: 11, fill: "#475569" }}
                                        label={{
                                          value: "平均点数",
                                          angle: 90,
                                          offset: 10,
                                          position: "insideRight",
                                          style: { fill: "#475569", fontSize: 11 },
                                        }}
                                      />
                                      <Tooltip
                                        formatter={(value, name, payload) => {
                                          if (name === "avgPoints") {
                                            const raw = payload?.payload?.rawAvg;
                                            return [
                                              raw !== null && raw !== undefined
                                                ? `${Number(raw).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}点`
                                                : "—",
                                              "平均点数",
                                            ];
                                          }
                                          return [`${Number(value).toLocaleString("ja-JP")}名`, "来院数"];
                                        }}
                                      />
                                      <Area
                                        yAxisId="left"
                                        type="monotone"
                                        dataKey="patients"
                                        fill={`url(#${gradientId})`}
                                        stroke={selectedSegmentStyles.barColor}
                                        strokeWidth={2}
                                        dot={{ r: 3, fill: selectedSegmentStyles.barColor }}
                                      />
                                      <Line
                                        yAxisId="right"
                                        type="monotone"
                                        dataKey="avgPoints"
                                        stroke={selectedSegmentStyles.lineColor}
                                        strokeWidth={2}
                                        dot={{
                                          r: 3,
                                          strokeWidth: 2,
                                          stroke: "#ffffff",
                                          fill: selectedSegmentStyles.lineColor,
                                        }}
                                      />
                                    </ComposedChart>
                                  </ResponsiveContainer>
                                </div>
                                {peakSlot && (
                                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                    <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                                      ピーク {formatHourLabel(peakSlot.hour)} / {peakSlot.totalPatients.toLocaleString("ja-JP")}名
                                    </span>
                                    {peakSlot.ageBreakdown.slice(0, 2).map((age) => (
                                      <span
                                        key={age.ageBandId}
                                        className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-600"
                                      >
                                        {age.label} {formatPercentage(age.share)}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {group.slots.map((slot) => (
                                    <div
                                      key={`${group.weekday}-${slot.hour}`}
                                      className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm"
                                    >
                                      <div>
                                        <p className="text-xs font-semibold text-slate-500">{formatHourLabel(slot.hour)}</p>
                                        <p className="text-base font-semibold text-slate-900">
                                          {slot.totalPatients.toLocaleString("ja-JP")}名
                                        </p>
                                      </div>
                                      <div className="text-right text-xs text-slate-500">
                                        <p>
                                          平均点 {slot.avgPoints !== null && slot.avgPoints !== undefined
                                            ? `${slot.avgPoints.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}点`
                                            : "—"}
                                        </p>
                                        {slot.ageBreakdown[0] && (
                                          <p className="mt-1 text-[11px]">主層: {slot.ageBreakdown[0].label}</p>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                    予約CSVとカルテCSVを取り込み、対象の診療科（総合診療・発熱外来）のデータを照合するとインサイトが表示されます。
                  </p>
                )}
                <div className="space-y-3">
                  <h3 className="text-base font-semibold text-slate-900">データ取込状況</h3>
                  <div className="grid gap-4 md:grid-cols-3">
                    {channelSummaryCards.map((card) => (
                      <div
                        key={card.id}
                        className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-soft"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{card.title}</p>
                            <p className="text-[11px] text-slate-500">最終更新: {card.updated}</p>
                          </div>
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                            {card.total}件
                          </span>
                        </div>
                        <p className="mt-3 text-xs text-slate-500">{card.detail}</p>
                        <p className="mt-2 text-[11px] text-slate-400">{card.helper}</p>
                      </div>
                    ))}
                  </div>
                  {channelSummaryCards.every((card) => card.rawTotal === 0) && (
                    <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                      CSVを取り込むとチャネル別の実績サマリーが表示されます。
                    </p>
                  )}
                </div>
              </div>
            )}

          </div>

        </SectionCard>
        )}

        {!lifestyleOnly && (
        <SectionCard
          title="新規主病トレンド分析"
          description="傷病名一覧CSV（主病フラグ）から新規登録された主病件数の推移と増減を確認します。"
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
                    <div className="mt-4 space-y-2">
                      <p className="text-[11px] text-slate-500">
                        ※ 主病件数の推移に加えて前期間との差分を重ねて表示します。凡例で診療科の表示切替が可能です。
                      </p>
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
        )}

          </div>
          {isManagementOpen && renderDataManagementPanel(true)}

        </div>
      </div>
    </main>
  );
}

export default PatientAnalysisPageContent;
