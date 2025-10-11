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
import { LifestyleViewContext } from "./LifestyleViewContext";

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
const DiagnosisCategoryChart = lazy(() =>
  import("@/components/patients/DiagnosisCategoryChart").then((m) => ({
    default: m.DiagnosisCategoryChart,
  })),
);

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

    records.push({
      dateIso,
      monthKey,
      visitType,
      patientNumber,
      birthDateIso,
      department,
      points,
      patientNameNormalized,
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
  value.replace(/\s+/g, "").replace(/[()（）]/g, "");

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

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

const formatHourLabel = (hour: number) => `${hour.toString().padStart(2, "0")}:00`;

const normalizeDepartmentLabel = (value: string) =>
  value.replace(/\s+/g, "").replace(/[()（）]/g, "");

const formatTimestampLabel = (value: string | null) =>
  value ? new Date(value).toLocaleString("ja-JP") : "未登録";

function PatientAnalysisPageContent() {
  const lifestyleOnly = useContext(LifestyleViewContext);
  const [records, setRecords] = useState<KarteRecord[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isLoadingShared, setIsLoadingShared] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [showSummaryChart, setShowSummaryChart] = useState(false);
  const [showTrendChart, setShowTrendChart] = useState(false);
  const [showDepartmentChart, setShowDepartmentChart] = useState(false);
  const [showWeekdayChart, setShowWeekdayChart] = useState(false);
  const [showUnitPriceChart, setShowUnitPriceChart] = useState(false);
  const [insightTab, setInsightTab] = useState<"channel" | "department" | "time">("department");
  const [isManagementOpen, setIsManagementOpen] = useState(false);
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
                setRecords(parsed as KarteRecord[]);
                setLastUpdated(timestamp);
                if (typeof window !== "undefined") {
                  try {
                    setCompressedItem(KARTE_STORAGE_KEY, JSON.stringify(parsed));
                    window.localStorage.setItem(KARTE_TIMESTAMP_KEY, timestamp);
                  } catch (error) {
                    console.error(error);
                    setUploadError("データの保存に失敗しました。データ量が多すぎる可能性があります。");
                  }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const latestAvailableMonth = useMemo(
    () => (allAvailableMonths.length > 0 ? allAvailableMonths[allAvailableMonths.length - 1] : null),
    [allAvailableMonths],
  );

  const {
    startMonth,
    endMonth,
    setStartMonth,
    setEndMonth,
    resetPeriod,
  } = useAnalysisPeriodRange(allAvailableMonths, {
    autoSelectLatest: !lifestyleOnly,
  });

  useEffect(() => {
    if (!lifestyleOnly) {
      return;
    }
    if (!latestAvailableMonth || allAvailableMonths.length === 0) {
      return;
    }

    const effectiveEnd = endMonth || latestAvailableMonth;
    if (!endMonth) {
      setEndMonth(effectiveEnd);
    }

    const endIndex = allAvailableMonths.indexOf(effectiveEnd);
    if (endIndex === -1) {
      return;
    }

    const desiredStartIndex = Math.max(0, endIndex - 5);
    const desiredStart = allAvailableMonths[desiredStartIndex];

    if (!startMonth) {
      setStartMonth(desiredStart);
      return;
    }

    const startIndex = allAvailableMonths.indexOf(startMonth);
    if (startIndex === -1) {
      setStartMonth(desiredStart);
      return;
    }

    if (endIndex - startIndex < 5 && startMonth !== desiredStart) {
      setStartMonth(desiredStart);
    }
  }, [
    lifestyleOnly,
    endMonth,
    startMonth,
    latestAvailableMonth,
    allAvailableMonths,
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
    if (!lifestyleEffectiveEndMonth || allAvailableMonths.length === 0) {
      return startMonth;
    }
    const endIndex = allAvailableMonths.indexOf(lifestyleEffectiveEndMonth);
    if (endIndex === -1) {
      return startMonth;
    }
    if (startMonth) {
      const startIndex = allAvailableMonths.indexOf(startMonth);
      if (startIndex !== -1 && endIndex - startIndex >= 5) {
        return startMonth;
      }
    }
    return allAvailableMonths[Math.max(0, endIndex - 5)] ?? startMonth;
  }, [
    lifestyleOnly,
    startMonth,
    lifestyleEffectiveEndMonth,
    allAvailableMonths,
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
        pointsSum: number;
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
          pointsSum: 0,
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

      const points = record.points ?? 0;
      if (Number.isFinite(points)) {
        bucket.pointsSum += points;
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
        pointsSum: number;
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
          pointsSum: 0,
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

      const points = record.points ?? 0;
      if (Number.isFinite(points)) {
        bucket.pointsSum += points;
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
      const normalizedName = normalizePatientName(
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
      const patientName = normalizePatientName(record.patientNameNormalized);
      const points = record.points ?? null;
      const departmentRaw = record.department?.trim() ?? "";
      if (!patientName || points === null) {
        return;
      }

      const dateKey = record.dateIso;
      const reservationKey = `${patientName}|${dateKey}`;
      const candidates = reservationMap.get(reservationKey);
      if (!candidates || candidates.length === 0) {
        return;
      }

      const normalizedDept = normalizeDepartmentLabel(departmentRaw);
      const matchIndex = candidates.findIndex((candidate) => {
        const candidateDept = normalizeDepartmentLabel(candidate.department ?? "");
        return candidateDept === normalizedDept;
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
      const department = departmentRaw.length > 0 ? departmentRaw : "診療科未分類";

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
      setReservationsRecords(merged);
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

      const shareUrlObject = new URL(
        `${window.location.origin}${window.location.pathname}`,
      );
      shareUrlObject.searchParams.set("data", response.id);
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
  };

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
                CSVのアップロードや共有はページ下部の「データ管理」セクションから操作できます。
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
          months={allAvailableMonths}
          startMonth={startMonth}
          endMonth={endMonth}
          onChangeStart={setStartMonth}
          onChangeEnd={setEndMonth}
          onReset={resetPeriod}
          label={diagnosisRangeLabel}
          renderMonthLabel={formatMonthLabel}
          rightContent={
            <button
              type="button"
              onClick={() => setIsManagementOpen(true)}
              disabled={isManagementOpen}
              className="inline-flex items-center justify-center rounded-full border border-brand-200 px-3 py-2 text-xs font-semibold text-brand-600 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              データ管理を{isManagementOpen ? "表示中" : "開く"}
            </button>
          }
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
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
                    <button
                      onClick={() => setShowSummaryChart(!showSummaryChart)}
                      className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      {showSummaryChart ? "グラフを非表示" : "グラフを表示"}
                    </button>
                    {showSummaryChart && (
                      <div className="mt-4 space-y-2">
                        <p className="text-[11px] text-slate-500">
                          ※ 凡例をクリックすると系列を切り替え、ホバーで月次値の詳細を確認できます。
                        </p>
                        <MonthlySummaryChart stats={stats} />
                      </div>
                    )}
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
                    <h3 className="text-sm font-semibold text-slate-800">最終来院からの経過日数</h3>
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
                    <h3 className="text-sm font-semibold text-slate-800">来院回数の分布</h3>
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
                  <h3 className="text-sm font-semibold text-slate-800">疾患別の継続状況</h3>
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
                    <h3 className="text-sm font-semibold text-slate-800">年齢別の離脱率</h3>
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
          description="チャネル・診療科・時間帯を切り替えて主要指標とグラフを比較します。"
        >
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: "department", label: "診療科" },
                { id: "time", label: "曜日別" },
                { id: "channel", label: "チャネル" },
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
                                <td className="px-4 py-3 text-slate-700">{WEEKDAY_LABELS[row.weekday]}</td>
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
            {insightTab === "channel" && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-dashed border-brand-200 bg-brand-50/70 px-4 py-3 text-xs text-brand-700">
                  多変量解析ダッシュボードは準備中です。現在はデータ取込状況のみを表示しています。
                </div>
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
          {isManagementOpen && (
          <aside
            id="data-management-panel"
            className="space-y-6 lg:sticky lg:top-8"
          >
            <SectionCard
              title="データ管理"
              description="カルテ集計の差し替えや共有URL発行に加え、他指標のCSV取り込みもまとめて管理します。"
            >
              <div className="space-y-3">
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
                <p className="text-xs text-slate-500">
                  {isReadOnly
                    ? "共有URLから閲覧中です。操作内容は公開データに即時反映されるため取り扱いにご注意ください。"
                    : "カルテ集計に加えて、予約ログ・アンケート・広告のCSVもこのページでまとめて更新できます。共有URLはコピーして関係者へ連携してください。"}
                </p>
                <div className="space-y-2">
                  {records.length > 0 && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                      📊 カルテ集計データ:{" "}
                      <span className="font-semibold">{records.length.toLocaleString("ja-JP")}件</span>
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
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                  <p className="text-xs font-semibold text-slate-700">
                    {lifestyleOnly ? "生活習慣病関連データ" : "その他のデータ管理"}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {lifestyleOnly
                      ? "主病CSVを更新すると生活習慣病ビューに即時反映されます。"
                      : "以下でアップロードすると予約ログ・アンケート・広告の各ページへ即時反映されます。"}
                  </p>
                  <div className="mt-3 grid gap-3">
                    {!lifestyleOnly && (
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
                          <p>登録件数: {reservationStatus.total.toLocaleString("ja-JP")}件</p>
                        </div>
                      </div>
                      <label
                        className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
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
                    )}
                    {!lifestyleOnly && (
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
                          <p>登録件数: {surveyStatus.total.toLocaleString("ja-JP")}件</p>
                          <p>
                            内訳: 外来 {surveyStatus.byType["外来"].toLocaleString("ja-JP")}件 / 内視鏡{" "}
                            {surveyStatus.byType["内視鏡"].toLocaleString("ja-JP")}件
                          </p>
                        </div>
                      </div>
                      <label
                        className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
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
                    )}
                    <div className="rounded-2xl border border-amber-200 bg-white/90 p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-amber-700">傷病名CSV（主病）</p>
                          <p className="text-xs text-slate-500">新規主病トレンド分析セクションで利用します。</p>
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
                                {department} {diagnosisStatus.byDepartment[department].toLocaleString("ja-JP")}件
                              </span>
                            ))}
                          </p>
                          <p>
                            カテゴリ内訳:{" "}
                            {DIAGNOSIS_CATEGORIES.map((category, index) => (
                              <span key={category}>
                                {index > 0 ? " / " : ""}
                                {category} {diagnosisStatus.byCategory[category].toLocaleString("ja-JP")}件
                              </span>
                            ))}
                          </p>
                        </div>
                      </div>
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
                      {diagnosisUploadError && (
                        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                          {diagnosisUploadError}
                        </p>
                      )}
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
          </aside>
          )}
        </div>
      </div>
    </main>
  );
}

export default function PatientAnalysisPage() {
  return <PatientAnalysisPageContent />;
}
