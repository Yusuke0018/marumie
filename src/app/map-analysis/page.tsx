"use client";

import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ChangeEvent,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { RefreshCw, ArrowLeft, Target, Plus, X, MapPin } from "lucide-react";
import { type KarteRecord } from "@/lib/karteAnalytics";
import { getCompressedItem } from "@/lib/storageCompression";
import { KARTE_STORAGE_KEY, KARTE_TIMESTAMP_KEY } from "@/lib/storageKeys";
import { AnalysisFilterPortal } from "@/components/AnalysisFilterPortal";
import { useAnalysisPeriodRange } from "@/hooks/useAnalysisPeriodRange";
import { setAnalysisPeriodLabel } from "@/lib/analysisPeriod";
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
  LabelList,
} from "recharts";

const KANJI_DIGITS = [
  "零",
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
] as const;
const DASH_REGEX = /[－―ーｰ‐]/g;
const FULL_WIDTH_DIGITS = /[０-９]/g;

const AGE_BANDS = [
  { id: "0-19" as const, label: "0〜19歳", min: 0, max: 19 },
  { id: "20-39" as const, label: "20〜39歳", min: 20, max: 39 },
  { id: "40-59" as const, label: "40〜59歳", min: 40, max: 59 },
  { id: "60-79" as const, label: "60〜79歳", min: 60, max: 79 },
  { id: "80+" as const, label: "80歳以上", min: 80, max: null },
  { id: "unknown" as const, label: "年齢不明", min: null, max: null },
] as const;

type AgeBandId = (typeof AGE_BANDS)[number]["id"];

const createEmptyAgeBreakdown = () =>
  AGE_BANDS.reduce(
    (acc, band) => {
      acc[band.id] = 0;
      return acc;
    },
    {} as Record<AgeBandId, number>,
  );

const toHalfWidthDigits = (value: string): string =>
  value.replace(FULL_WIDTH_DIGITS, (digit) =>
    String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
  );

const numberToKanji = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  if (value < 10) {
    return KANJI_DIGITS[value] ?? "";
  }
  if (value === 10) {
    return "十";
  }
  if (value < 20) {
    return `十${KANJI_DIGITS[value - 10] ?? ""}`;
  }
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    const tensPart = tens === 1 ? "十" : `${KANJI_DIGITS[tens] ?? ""}十`;
    return ones === 0 ? tensPart : `${tensPart}${KANJI_DIGITS[ones] ?? ""}`;
  }
  return value.toString();
};

const standardizeTownLabel = (
  raw: string | null | undefined,
): string | null => {
  if (!raw) {
    return null;
  }
  let normalized = raw.trim();
  if (normalized.length === 0) {
    return null;
  }
  normalized = normalized.replace(/\s+/g, "");
  normalized = toHalfWidthDigits(normalized);
  normalized = normalized.replace(DASH_REGEX, "-");
  normalized = normalized.replace(/(\d+)丁目/gu, (_, digits) => {
    const parsed = Number.parseInt(digits ?? "", 10);
    return Number.isFinite(parsed)
      ? `${numberToKanji(parsed)}丁目`
      : `${digits}丁目`;
  });
  if (!normalized.includes("丁目")) {
    const hyphenMatch = normalized.match(/^([^\d]+?)(\d+)-/);
    if (hyphenMatch) {
      const [, base, digits] = hyphenMatch;
      const parsed = Number.parseInt(digits ?? "", 10);
      if (Number.isFinite(parsed)) {
        normalized = `${base}${numberToKanji(parsed)}丁目`;
      }
    }
  }
  if (!normalized.includes("丁目")) {
    const suffixMatch = normalized.match(/^([^\d]+?)(\d+)$/);
    if (suffixMatch) {
      const [, base, digits] = suffixMatch;
      const parsed = Number.parseInt(digits ?? "", 10);
      if (Number.isFinite(parsed)) {
        normalized = `${base}${numberToKanji(parsed)}丁目`;
      }
    }
  }
  if (normalized.includes("丁目")) {
    const index = normalized.indexOf("丁目");
    normalized = normalized.slice(0, index + 2);
  }
  return normalized.length > 0 ? normalized : null;
};

const removeChomeSuffix = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, "");
  if (normalized.length === 0) {
    return null;
  }
  const removed = normalized.replace(
    /([〇零一二三四五六七八九十百\d]+丁目)$/u,
    "",
  );
  return removed.length > 0 ? removed : null;
};

const GeoDistributionMap = dynamic(
  () =>
    import("@/components/reservations/GeoDistributionMap").then((m) => ({
      default: m.GeoDistributionMap,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[360px] items-center justify-center rounded-3xl border border-slate-200 bg-white text-slate-500 sm:h-[520px]">
        地図コンポーネントを読み込み中です...
      </div>
    ),
  },
);

const formatMonthLabel = (value: string): string => {
  const [yearStr, monthStr] = value.split("-");
  const year = Number.parseInt(yearStr ?? "", 10);
  const month = Number.parseInt(monthStr ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return value;
  }
  return `${year}年${month}月`;
};

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const buildPeriodLabel = (months: string[]): string => {
  if (months.length === 0) {
    return "データ未取得";
  }
  const sorted = [...months].sort();
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (first === last) {
    return formatMonthLabel(first);
  }
  return `${formatMonthLabel(first)}〜${formatMonthLabel(last)}`;
};

type MapRecord = {
  department: string;
  reservationMonth: string;
  patientAge: number | null;
  patientAddress: string | null;
  patientPrefecture?: string | null;
  patientCity?: string | null;
  patientTown?: string | null;
  patientBaseTown?: string | null;
};

type ComparisonRow = {
  id: string;
  label: string;
  countA: number;
  countB: number;
  shareA: number;
  shareB: number;
  diff: number;
  diffShare: number;
};

type AreaSelectionMeta = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  city: string | null;
  town: string | null;
  prefecture: string | null;
};

const MAX_SELECTED_AREAS = 10;
const SHARE_RATIO_THRESHOLD = 0.001;

const KATAKANA_LABEL_REGEX = /^[\u30A0-\u30FFー･・\s]+$/u;

const isCorporateLabel = (label: string) =>
  KATAKANA_LABEL_REGEX.test(label.trim());

type ComparisonSelectionPreset =
  | "recommended"
  | "increaseTop10"
  | "decreaseTop10"
  | "mixedTop5"
  | "custom";

const arraysEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(mediaQuery.matches);
    update();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }
    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  return isMobile;
};

const HIDDEN_AREA_LABEL = "住所未設定";

type AreaSeriesPoint = {
  month: string;
  count: number;
  diff: number;
};

type AreaSeries = {
  id: string;
  label: string;
  city: string | null;
  town: string | null;
  totals: AreaSeriesPoint[];
  totalCount: number;
};

type AgeSeriesPoint = {
  month: string;
  count: number;
  diff: number;
};

type AgeSeries = {
  id: AgeBandId;
  label: string;
  totals: AgeSeriesPoint[];
  totalCount: number;
};

type SummaryEntry = {
  id: string;
  label: string;
  current: number;
  comparison: number | null;
  diff: number;
  ratio: number | null;
  share: number;
  contribution: number | null;
  city?: string | null;
  town?: string | null;
  type: "area" | "age";
};

type ComparisonRange = { start: string | null; end: string | null };

const buildAreaSeries = (
  records: MapRecord[],
  months: string[],
): AreaSeries[] => {
  const monthIndex = new Map(months.map((month, index) => [month, index]));
  const areaMap = new Map<
    string,
    {
      label: string;
      city: string | null;
      town: string | null;
      counts: number[];
    }
  >();

  records.forEach((record) => {
    const index = monthIndex.get(record.reservationMonth);
    if (index === undefined) {
      return;
    }
    const keyParts = [
      record.patientPrefecture ?? "",
      record.patientCity ?? "",
      record.patientTown ?? record.patientBaseTown ?? "",
    ];
    const key = keyParts.join("|");
    const labelParts = [record.patientCity, record.patientTown].filter(
      (part): part is string => Boolean(part && part.length > 0),
    );
    const label =
      labelParts.length > 0
        ? labelParts.join("")
        : (record.patientCity ?? record.patientPrefecture ?? "住所未設定");

    let entry = areaMap.get(key);
    if (!entry) {
      entry = {
        label,
        city: record.patientCity ?? null,
        town: record.patientTown ?? record.patientBaseTown ?? null,
        counts: Array(months.length).fill(0),
      };
      areaMap.set(key, entry);
    }
    entry.counts[index] += 1;
  });

  const result: AreaSeries[] = [];
  for (const [id, entry] of areaMap.entries()) {
    const totals: AreaSeriesPoint[] = entry.counts.map((count, idx) => {
      const prev = idx > 0 ? entry.counts[idx - 1] : 0;
      return {
        month: months[idx]!,
        count,
        diff: count - prev,
      };
    });
    const totalCount = entry.counts.reduce((acc, value) => acc + value, 0);
    if (totalCount === 0) {
      continue;
    }
    result.push({
      id,
      label: entry.label,
      city: entry.city,
      town: entry.town,
      totals,
      totalCount,
    });
  }

  result.sort((a, b) => b.totalCount - a.totalCount);
  return result;
};

const buildAgeSeries = (
  records: MapRecord[],
  months: string[],
): AgeSeries[] => {
  const monthIndex = new Map(months.map((month, index) => [month, index]));
  const seriesMap = new Map<
    AgeBandId,
    {
      counts: number[];
    }
  >();

  AGE_BANDS.forEach((band) => {
    seriesMap.set(band.id, { counts: Array(months.length).fill(0) });
  });

  records.forEach((record) => {
    const index = monthIndex.get(record.reservationMonth);
    if (index === undefined) {
      return;
    }
    const bandId = classifyAgeBandId(record.patientAge);
    const entry = seriesMap.get(bandId);
    if (!entry) {
      return;
    }
    entry.counts[index] += 1;
  });

  return AGE_BANDS.map((band) => {
    const entry = seriesMap.get(band.id)!;
    const totals: AgeSeriesPoint[] = entry.counts.map((count, idx) => {
      const prev = idx > 0 ? entry.counts[idx - 1] : 0;
      return {
        month: months[idx]!,
        count,
        diff: count - prev,
      };
    });
    const totalCount = entry.counts.reduce((acc, value) => acc + value, 0);
    return {
      id: band.id,
      label: band.label,
      totals,
      totalCount,
    };
  });
};

const buildSummaryEntries = (
  areaSeries: AreaSeries[],
  ageSeries: AgeSeries[],
  months: string[],
): {
  increases: SummaryEntry[];
  decreases: SummaryEntry[];
  ages: SummaryEntry[];
} => {
  if (months.length === 0) {
    return { increases: [], decreases: [], ages: [] };
  }
  const firstIndex = 0;
  const lastIndex = months.length - 1;

  const areaEntries: SummaryEntry[] = areaSeries.map((series) => {
    const start = series.totals[firstIndex]?.count ?? 0;
    const end = series.totals[lastIndex]?.count ?? 0;
    const diff = end - start;
    let ratio: number | null = null;
    if (start > 0) {
      ratio = diff / start;
    } else if (start === 0 && end > 0) {
      ratio = 1;
    }
    return {
      id: series.id,
      label: series.label,
      current: end,
      comparison: start,
      diff,
      ratio,
      share: 0,
      contribution: null,
      city: series.city,
      town: series.town,
      type: "area",
    };
  });

  const ageEntries: SummaryEntry[] = ageSeries.map((series) => {
    const start = series.totals[firstIndex]?.count ?? 0;
    const end = series.totals[lastIndex]?.count ?? 0;
    const diff = end - start;
    let ratio: number | null = null;
    if (start > 0) {
      ratio = diff / start;
    } else if (start === 0 && end > 0) {
      ratio = 1;
    }
    return {
      id: series.id,
      label: series.label,
      current: end,
      comparison: start,
      diff,
      ratio,
      share: 0,
      contribution: null,
      type: "age",
    };
  });

  const totalCurrent = areaEntries.reduce(
    (acc, entry) => acc + entry.current,
    0,
  );
  const totalStart = areaEntries.reduce(
    (acc, entry) => acc + (entry.comparison ?? 0),
    0,
  );
  const totalDiff = totalCurrent - totalStart;

  areaEntries.forEach((entry) => {
    entry.share = totalCurrent > 0 ? entry.current / totalCurrent : 0;
    entry.contribution =
      totalDiff !== 0 && entry.comparison !== null
        ? (entry.diff / totalDiff) * 100
        : null;
  });

  const ageTotalCurrent = ageEntries.reduce(
    (acc, entry) => acc + entry.current,
    0,
  );
  ageEntries.forEach((entry) => {
    entry.share = ageTotalCurrent > 0 ? entry.current / ageTotalCurrent : 0;
    entry.contribution =
      totalDiff !== 0 && entry.comparison !== null
        ? (entry.diff / totalDiff) * 100
        : null;
  });

  const increases = areaEntries
    .filter(
      (entry) =>
        entry.diff > 0 &&
        entry.label !== HIDDEN_AREA_LABEL &&
        !isCorporateLabel(entry.label) &&
        entry.share >= SHARE_RATIO_THRESHOLD,
    )
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 3);

  const decreases = areaEntries
    .filter((entry) => {
      if (entry.diff >= 0) {
        return false;
      }
      if (entry.label === HIDDEN_AREA_LABEL) {
        return false;
      }
      if (isCorporateLabel(entry.label)) {
        return false;
      }
      const startShare =
        totalStart > 0 && entry.comparison ? entry.comparison / totalStart : 0;
      return Math.max(entry.share, startShare) >= SHARE_RATIO_THRESHOLD;
    })
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 3);

  const ages = ageEntries
    .filter((entry) => entry.diff > 0)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 3);

  return { increases, decreases, ages };
};

const AREA_COLOR_PALETTE: Array<{ fill: string; accent: string }> = [
  { fill: "#2563eb", accent: "#1d4ed8" },
  { fill: "#0f766e", accent: "#0b5f59" },
  { fill: "#b45309", accent: "#92400e" },
  { fill: "#be123c", accent: "#9f1239" },
  { fill: "#7c3aed", accent: "#6d28d9" },
  { fill: "#db2777", accent: "#be185d" },
  { fill: "#0ea5e9", accent: "#0284c7" },
  { fill: "#ea580c", accent: "#c2410c" },
];

const toTransparentColor = (hex: string, alpha: number) => {
  const sanitized = hex.replace("#", "");
  const bigint = Number.parseInt(sanitized, 16);
  if (Number.isNaN(bigint)) {
    return hex;
  }
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const translucentFill = (hex: string, alpha = 0.4) =>
  toTransparentColor(hex, alpha);
const solidFill = (hex: string, alpha = 0.85) => toTransparentColor(hex, alpha);

const computeAgeFromBirth = (
  birthIso: string | null,
  visitIso: string,
): number | null => {
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

  return age >= 0 && age <= 120 ? age : null;
};

const classifyAgeBandId = (age: number | null | undefined): AgeBandId => {
  if (
    age === null ||
    age === undefined ||
    Number.isNaN(age) ||
    age < 0 ||
    age > 120
  ) {
    return "unknown";
  }
  for (const band of AGE_BANDS) {
    if (band.id === "unknown") {
      continue;
    }
    if (
      band.min !== null &&
      age >= band.min &&
      (band.max === null || age <= band.max)
    ) {
      return band.id;
    }
  }
  return "unknown";
};

const parseAddressComponents = (
  address: string | null,
): {
  prefecture: string | null;
  city: string | null;
  town: string | null;
  baseTown: string | null;
} => {
  if (!address) {
    return { prefecture: null, city: null, town: null, baseTown: null };
  }
  let normalized = address.trim();
  if (normalized.length === 0) {
    return { prefecture: null, city: null, town: null, baseTown: null };
  }
  normalized = toHalfWidthDigits(normalized.replace(/\s+/g, ""));
  normalized = normalized.replace(DASH_REGEX, "-");

  let prefecture: string | null = null;
  if (normalized.startsWith("大阪府")) {
    prefecture = "大阪府";
    normalized = normalized.slice("大阪府".length);
  } else if (normalized.includes("大阪府")) {
    prefecture = "大阪府";
    normalized = normalized.replace("大阪府", "");
  }

  let city: string | null = null;
  if (normalized.startsWith("大阪市")) {
    const wardMatch = normalized.match(/^大阪市([\p{Script=Han}]{1,3}区)/u);
    if (wardMatch) {
      city = `大阪市${wardMatch[1]}`;
      normalized = normalized.slice(city.length);
    } else {
      city = "大阪市";
      normalized = normalized.slice("大阪市".length);
    }
  } else {
    const wardMatch = normalized.match(/^([\p{Script=Han}]{1,3}区)/u);
    if (wardMatch) {
      city = `大阪市${wardMatch[1]}`;
      normalized = normalized.slice(wardMatch[1].length);
    }
  }

  if (!prefecture && city && city.startsWith("大阪市")) {
    prefecture = "大阪府";
  }

  normalized = normalized.replace(/^大阪市/, "");

  const town = standardizeTownLabel(normalized);
  const baseTown = removeChomeSuffix(town);

  return {
    prefecture,
    city,
    town: town ?? baseTown,
    baseTown,
  };
};

const MapAnalysisPage = () => {
  const [karteRecords, setKarteRecords] = useState<KarteRecord[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const refreshKarteRecords = () => {
      try {
        const stored = getCompressedItem(KARTE_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as KarteRecord[];
          setKarteRecords(parsed);
        } else {
          setKarteRecords([]);
        }
      } catch (error) {
        console.error("カルテデータの読み込みに失敗しました:", error);
        setKarteRecords([]);
      }

      try {
        const timestamp = window.localStorage.getItem(KARTE_TIMESTAMP_KEY);
        setLastUpdated(timestamp);
      } catch (error) {
        console.error("タイムスタンプの読み込みに失敗しました:", error);
        setLastUpdated(null);
      }
    };

    refreshKarteRecords();

    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === KARTE_STORAGE_KEY ||
        event.key === KARTE_TIMESTAMP_KEY
      ) {
        refreshKarteRecords();
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    karteRecords.forEach((record) => {
      if (record.monthKey) {
        months.add(record.monthKey);
      } else if (record.dateIso) {
        months.add(record.dateIso.slice(0, 7));
      }
    });
    return Array.from(months);
  }, [karteRecords]);

  const sortedMonths = useMemo(
    () => [...availableMonths].sort((a, b) => a.localeCompare(b)),
    [availableMonths],
  );

  const {
    startMonth: mapStartMonth,
    endMonth: mapEndMonth,
    setStartMonth: setMapStartMonth,
    setEndMonth: setMapEndMonth,
    resetPeriod: resetMapPeriod,
  } = useAnalysisPeriodRange(sortedMonths, { autoSelectLatest: false });

  const isMobile = useIsMobile();

  const mapRecords = useMemo<MapRecord[]>(() => {
    if (karteRecords.length === 0) {
      return [];
    }
    return karteRecords
      .map((record) => {
        const month = record.monthKey ?? record.dateIso.slice(0, 7);
        const address = record.patientAddress ?? null;
        const { prefecture, city, town, baseTown } =
          parseAddressComponents(address);
        return {
          department:
            record.department && record.department.trim().length > 0
              ? record.department.trim()
              : "診療科未設定",
          reservationMonth: month,
          patientAge: computeAgeFromBirth(record.birthDateIso, record.dateIso),
          patientAddress: address,
          patientPrefecture: prefecture,
          patientCity: city,
          patientTown: town,
          patientBaseTown: baseTown,
        } satisfies MapRecord;
      })
      .filter((record) => record.reservationMonth.length > 0);
  }, [karteRecords]);

  const filteredMapRecords = useMemo(() => {
    const hasStart = mapStartMonth && mapStartMonth.length > 0;
    const hasEnd = mapEndMonth && mapEndMonth.length > 0;
    if (!hasStart && !hasEnd) {
      return mapRecords;
    }
    return mapRecords.filter((record) => {
      if (hasStart && record.reservationMonth < mapStartMonth) {
        return false;
      }
      if (hasEnd && record.reservationMonth > mapEndMonth) {
        return false;
      }
      return true;
    });
  }, [mapRecords, mapStartMonth, mapEndMonth]);

  const filteredMonths = useMemo(() => {
    const months = new Set<string>();
    filteredMapRecords.forEach((record) => {
      months.add(record.reservationMonth);
    });
    return Array.from(months).sort((a, b) => a.localeCompare(b));
  }, [filteredMapRecords]);

  const mapPeriodLabel = useMemo(
    () => buildPeriodLabel(filteredMonths),
    [filteredMonths],
  );

  useEffect(() => {
    if (filteredMonths.length === 0) {
      setAnalysisPeriodLabel(null);
    } else {
      setAnalysisPeriodLabel(mapPeriodLabel);
    }
  }, [filteredMonths.length, mapPeriodLabel]);

  const [highlightedAgeBand, setHighlightedAgeBand] =
    useState<AgeBandId | null>(null);
  const [selectedAreaIds, setSelectedAreaIds] = useState<string[]>([]);
  const [selectionPreset, setSelectionPreset] =
    useState<ComparisonSelectionPreset>("recommended");
  const [comparisonMetric, setComparisonMetric] = useState<"share" | "count">(
    "share",
  );
  const isShareMetric = comparisonMetric === "share";
  const [focusAreaId, setFocusAreaId] = useState<string | null>(null);
  const [pendingAreaId, setPendingAreaId] = useState<string>("");
  const [rangeA, setRangeA] = useState<ComparisonRange>({
    start: null,
    end: null,
  });
  const [rangeB, setRangeB] = useState<ComparisonRange>({
    start: null,
    end: null,
  });
  const [isAreaPickerOpen, setAreaPickerOpen] = useState(false);
  const [areaLabelMap, setAreaLabelMap] = useState<Record<string, string>>({});
  const [selectionFeedback, setSelectionFeedback] = useState<{
    key: number;
    message: string;
    tone: "added" | "removed" | "limit";
  } | null>(null);

  const showSelectionFeedback = useCallback(
    (tone: "added" | "removed" | "limit", message: string) => {
      setSelectionFeedback({ key: Date.now(), tone, message });
    },
    [],
  );

  useEffect(() => {
    setHighlightedAgeBand(null);
  }, [filteredMonths.length]);

  useEffect(() => {
    if (!isAreaPickerOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAreaPickerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAreaPickerOpen]);

  useEffect(() => {
    if (!selectionFeedback) {
      return;
    }
    const timer = window.setTimeout(() => setSelectionFeedback(null), 2200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [selectionFeedback]);

  const areaSeries = useMemo(
    () => buildAreaSeries(filteredMapRecords, filteredMonths),
    [filteredMapRecords, filteredMonths],
  );

  const ageSeries = useMemo(
    () => buildAgeSeries(filteredMapRecords, filteredMonths),
    [filteredMapRecords, filteredMonths],
  );

  const summary = useMemo(
    () => buildSummaryEntries(areaSeries, ageSeries, filteredMonths),
    [areaSeries, ageSeries, filteredMonths],
  );

  useEffect(() => {
    if (sortedMonths.length === 0) {
      return;
    }
    setRangeA((prev) => {
      if (prev.start && prev.end) {
        return prev;
      }
      const mid = Math.max(0, Math.floor(sortedMonths.length / 2) - 1);
      const start = sortedMonths[0] ?? null;
      const end = sortedMonths[Math.max(mid, 0)] ?? null;
      return { start, end };
    });
    setRangeB((prev) => {
      if (prev.start && prev.end) {
        return prev;
      }
      const startIndex = Math.max(sortedMonths.length - 3, 0);
      const start = sortedMonths[startIndex] ?? null;
      const end = sortedMonths[sortedMonths.length - 1] ?? null;
      return { start, end };
    });
  }, [sortedMonths]);

  const startMonthLabel =
    filteredMonths.length > 0 ? formatMonthLabel(filteredMonths[0]!) : null;
  const endMonthLabel =
    filteredMonths.length > 0
      ? formatMonthLabel(filteredMonths[filteredMonths.length - 1]!)
      : null;
  const periodRangeDisplay =
    startMonthLabel && endMonthLabel
      ? `${startMonthLabel}〜\n${endMonthLabel}`
      : (startMonthLabel ?? endMonthLabel ?? "期間未設定");

  const totalRecords = filteredMapRecords.length;
  const latestSelectedAreaId =
    selectedAreaIds.length > 0
      ? (selectedAreaIds[selectedAreaIds.length - 1] ?? null)
      : null;
  const activeAreaId =
    focusAreaId ?? latestSelectedAreaId ?? summary.increases[0]?.id ?? null;

  const filterByRange = useMemo(() => {
    return (records: MapRecord[], range: ComparisonRange): MapRecord[] => {
      const { start, end } = range;
      return records.filter((record) => {
        if (start && record.reservationMonth < start) {
          return false;
        }
        if (end && record.reservationMonth > end) {
          return false;
        }
        return true;
      });
    };
  }, []);

  const aggregateRange = useMemo(() => {
    return (records: MapRecord[]) => {
      const areaMap = new Map<
        string,
        {
          label: string;
          prefecture: string | null;
          city: string | null;
          town: string | null;
          total: number;
          ageBreakdown: Record<AgeBandId, number>;
        }
      >();
      const ageTotals = createEmptyAgeBreakdown();
      let counted = 0;

      records.forEach((record) => {
        const prefecture = record.patientPrefecture ?? null;
        const city = record.patientCity ?? null;
        const town = record.patientTown ?? record.patientBaseTown ?? null;
        const labelParts = [city, town].filter((part): part is string =>
          Boolean(part),
        );
        const label =
          labelParts.length > 0
            ? labelParts.join("")
            : (city ?? prefecture ?? HIDDEN_AREA_LABEL);

        if (label === HIDDEN_AREA_LABEL) {
          return;
        }

        const bandId = classifyAgeBandId(record.patientAge);
        ageTotals[bandId] += 1;

        const key = `${prefecture ?? ""}|${city ?? ""}|${town ?? ""}`;
        let entry = areaMap.get(key);
        if (!entry) {
          entry = {
            label,
            prefecture,
            city,
            town,
            total: 0,
            ageBreakdown: createEmptyAgeBreakdown(),
          };
          areaMap.set(key, entry);
        }
        entry.total += 1;
        entry.ageBreakdown[bandId] += 1;
        counted += 1;
      });

      return {
        total: counted,
        areas: areaMap,
        ageTotals,
      };
    };
  }, []);

  const comparisonData = useMemo(() => {
    if ((!rangeA.start && !rangeA.end) || (!rangeB.start && !rangeB.end)) {
      return null;
    }

    if (
      (rangeA.start && rangeA.end && rangeA.start > rangeA.end) ||
      (rangeB.start && rangeB.end && rangeB.start > rangeB.end)
    ) {
      return { invalid: true } as const;
    }

    const recordsA = filterByRange(mapRecords, rangeA);
    const recordsB = filterByRange(mapRecords, rangeB);
    const aggregatedA = aggregateRange(recordsA);
    const aggregatedB = aggregateRange(recordsB);

    const allKeys = new Set<string>([
      ...aggregatedA.areas.keys(),
      ...aggregatedB.areas.keys(),
    ]);

    const rows: ComparisonRow[] = Array.from(allKeys).map((key) => {
      const areaA = aggregatedA.areas.get(key);
      const areaB = aggregatedB.areas.get(key);
      const countA = areaA?.total ?? 0;
      const countB = areaB?.total ?? 0;
      const shareA = aggregatedA.total > 0 ? countA / aggregatedA.total : 0;
      const shareB = aggregatedB.total > 0 ? countB / aggregatedB.total : 0;
      const diff = countB - countA;
      const diffShare = shareB - shareA;
      const label = areaB?.label ?? areaA?.label ?? "住所未設定";
      return {
        id: key,
        label,
        countA,
        countB,
        shareA,
        shareB,
        diff,
        diffShare,
      };
    });

    rows.sort((a, b) => Math.abs(b.diffShare) - Math.abs(a.diffShare));

    return {
      invalid: false as const,
      rows,
      totalA: aggregatedA.total,
      totalB: aggregatedB.total,
      ageA: aggregatedA.ageTotals,
      ageB: aggregatedB.ageTotals,
    };
  }, [aggregateRange, filterByRange, mapRecords, rangeA, rangeB]);

  const validComparison = useMemo(() => {
    if (!comparisonData || comparisonData.invalid) {
      return null;
    }
    return comparisonData;
  }, [comparisonData]);

  const ageComparisonRows = useMemo(() => {
    if (!validComparison) {
      return [];
    }
    const { ageA, ageB, totalA, totalB } = validComparison;
    return AGE_BANDS.map((band) => {
      const countA = ageA[band.id];
      const countB = ageB[band.id];
      const shareA = totalA > 0 ? countA / totalA : 0;
      const shareB = totalB > 0 ? countB / totalB : 0;
      return {
        id: band.id,
        label: band.label,
        countA,
        countB,
        shareA,
        shareB,
        diff: countB - countA,
        diffShare: shareB - shareA,
      };
    });
  }, [validComparison]);

  const rangeDescription = useMemo(() => {
    const describe = (range: ComparisonRange) => {
      const { start, end } = range;
      if (!start && !end) {
        return "全期間";
      }
      if (start && end && start === end) {
        return formatMonthLabel(start);
      }
      if (start && end) {
        return `${formatMonthLabel(start)}〜${formatMonthLabel(end)}`;
      }
      if (start) {
        return `${formatMonthLabel(start)}以降`;
      }
      if (end) {
        return `${formatMonthLabel(end)}まで`;
      }
      return "全期間";
    };
    return {
      a: describe(rangeA),
      b: describe(rangeB),
    };
  }, [rangeA, rangeB]);

  const periodALabel = rangeDescription.a;
  const periodBLabel = rangeDescription.b;

  const filteredComparisonRows = useMemo<ComparisonRow[]>(() => {
    if (!validComparison) {
      return [];
    }
    const validRows = validComparison.rows.filter((row) => {
      const label = row.label.trim();
      if (label === "住所未設定" || label === "" || label === "未設定") {
        return false;
      }
      if (label.length < 2) {
        return false;
      }
      if (/^[\d\-]+$/.test(label)) {
        return false;
      }
      if (
        /^[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(
          label,
        )
      ) {
        return false;
      }
      if (isCorporateLabel(label)) {
        return false;
      }
      const prominentShare = Math.max(row.shareA, row.shareB);
      if (prominentShare < SHARE_RATIO_THRESHOLD) {
        return false;
      }
      return true;
    });
    return validRows;
  }, [validComparison]);

  const pickIds = useCallback((rows: ComparisonRow[], limit: number) => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const row of rows) {
      if (seen.has(row.id)) {
        continue;
      }
      seen.add(row.id);
      ids.push(row.id);
      if (ids.length >= limit) {
        break;
      }
    }
    return ids;
  }, []);

  const shareRecommendedIds = useMemo(
    () =>
      pickIds(
        [...filteredComparisonRows].sort(
          (a, b) => Math.abs(b.diffShare) - Math.abs(a.diffShare),
        ),
        MAX_SELECTED_AREAS,
      ),
    [filteredComparisonRows, pickIds],
  );

  const shareIncreaseIds = useMemo(
    () =>
      pickIds(
        filteredComparisonRows
          .filter((row) => row.diffShare > 0)
          .sort((a, b) => b.diffShare - a.diffShare),
        MAX_SELECTED_AREAS,
      ),
    [filteredComparisonRows, pickIds],
  );

  const shareDecreaseIds = useMemo(
    () =>
      pickIds(
        filteredComparisonRows
          .filter((row) => row.diffShare < 0)
          .sort((a, b) => a.diffShare - b.diffShare),
        MAX_SELECTED_AREAS,
      ),
    [filteredComparisonRows, pickIds],
  );

  const countRecommendedIds = useMemo(
    () =>
      pickIds(
        [...filteredComparisonRows].sort(
          (a, b) => Math.abs(b.diff) - Math.abs(a.diff),
        ),
        MAX_SELECTED_AREAS,
      ),
    [filteredComparisonRows, pickIds],
  );

  const countIncreaseIds = useMemo(
    () =>
      pickIds(
        filteredComparisonRows
          .filter((row) => row.diff > 0)
          .sort((a, b) => b.diff - a.diff),
        MAX_SELECTED_AREAS,
      ),
    [filteredComparisonRows, pickIds],
  );

  const countDecreaseIds = useMemo(
    () =>
      pickIds(
        filteredComparisonRows
          .filter((row) => row.diff < 0)
          .sort((a, b) => a.diff - b.diff),
        MAX_SELECTED_AREAS,
      ),
    [filteredComparisonRows, pickIds],
  );

  const recommendedIds = useMemo(
    () => (isShareMetric ? shareRecommendedIds : countRecommendedIds),
    [countRecommendedIds, isShareMetric, shareRecommendedIds],
  );

  const increasePresetIds = useMemo(
    () => (isShareMetric ? shareIncreaseIds : countIncreaseIds),
    [countIncreaseIds, isShareMetric, shareIncreaseIds],
  );

  const decreasePresetIds = useMemo(
    () => (isShareMetric ? shareDecreaseIds : countDecreaseIds),
    [countDecreaseIds, isShareMetric, shareDecreaseIds],
  );

  const mixedPresetIds = useMemo(() => {
    const combined = [
      ...increasePresetIds.slice(0, 5),
      ...decreasePresetIds.slice(0, 5),
    ];
    return pickIds(
      combined
        .map((id) => filteredComparisonRows.find((row) => row.id === id))
        .filter((row): row is ComparisonRow => Boolean(row))
        .sort((a, b) => {
          if (isShareMetric) {
            return Math.abs(b.diffShare) - Math.abs(a.diffShare);
          }
          return Math.abs(b.diff) - Math.abs(a.diff);
        }),
      MAX_SELECTED_AREAS,
    );
  }, [
    decreasePresetIds,
    filteredComparisonRows,
    increasePresetIds,
    isShareMetric,
    pickIds,
  ]);

  const selectionPresetMap = useMemo(
    () =>
      ({
        recommended: recommendedIds,
        increaseTop10: increasePresetIds,
        decreaseTop10: decreasePresetIds,
        mixedTop5: mixedPresetIds,
      }) as Record<Exclude<ComparisonSelectionPreset, "custom">, string[]>,
    [decreasePresetIds, increasePresetIds, mixedPresetIds, recommendedIds],
  );

  const comparisonBarData = useMemo<
    Array<{
      id: string;
      label: string;
      shareA: number;
      shareB: number;
      diffShare: number;
      countA: number;
      countB: number;
      diffCount: number;
      fill: string;
      accent: string;
    }>
  >(() => {
    if (filteredComparisonRows.length === 0) {
      return [];
    }
    const palette = AREA_COLOR_PALETTE;
    return filteredComparisonRows.map((row, index) => {
      const { fill, accent } = palette[index % palette.length];
      const shareA = Number((row.shareA * 100).toFixed(1));
      const shareB = Number((row.shareB * 100).toFixed(1));
      const diffShare = Number((row.diffShare * 100).toFixed(1));
      return {
        id: row.id,
        label: row.label,
        shareA,
        shareB,
        diffShare,
        countA: row.countA,
        countB: row.countB,
        diffCount: row.diff,
        fill,
        accent,
      };
    });
  }, [filteredComparisonRows]);

  useEffect(() => {
    if (comparisonBarData.length === 0) {
      setSelectedAreaIds([]);
      return;
    }
    const available = new Set(comparisonBarData.map((row) => row.id));
    setSelectedAreaIds((prev) => {
      const filtered = prev.filter((id) => available.has(id));
      if (filtered.length === prev.length) {
        return prev;
      }
      return filtered;
    });
  }, [comparisonBarData]);

  useEffect(() => {
    if (selectionPreset === "custom") {
      return;
    }
    const targetIds = selectionPresetMap[selectionPreset] ?? [];
    const availableIds = new Set(comparisonBarData.map((row) => row.id));
    const filteredTarget = targetIds.filter((id) => availableIds.has(id));
    const fallback =
      filteredTarget.length > 0
        ? filteredTarget
        : (selectionPresetMap.recommended ?? []);
    const changed = !arraysEqual(selectedAreaIds, fallback);
    if (changed) {
      setSelectedAreaIds(fallback);
    }
    const fallbackFocus = fallback[fallback.length - 1] ?? null;
    if (changed || focusAreaId !== fallbackFocus) {
      setFocusAreaId(fallbackFocus);
    }
  }, [
    comparisonBarData,
    focusAreaId,
    selectedAreaIds,
    selectionPreset,
    selectionPresetMap,
  ]);

  const selectionPresetOptions = useMemo(() => {
    const recommendedLabel = isShareMetric
      ? "推奨（割合差分順）"
      : "推奨（人数差分順）";
    const increaseLabel = isShareMetric
      ? "増加順 TOP10（0.1%以上）"
      : "増加人数 TOP10";
    const decreaseLabel = isShareMetric
      ? "減少順 TOP10（0.1%以上）"
      : "減少人数 TOP10";
    const mixedLabel = isShareMetric
      ? "増加TOP5 + 減少TOP5（0.1%以上）"
      : "増加人数TOP5 + 減少人数TOP5";
    return [
      {
        value: "recommended" as const,
        label: recommendedLabel,
        disabled: selectionPresetMap.recommended.length === 0,
      },
      {
        value: "increaseTop10" as const,
        label: increaseLabel,
        disabled: selectionPresetMap.increaseTop10.length === 0,
      },
      {
        value: "decreaseTop10" as const,
        label: decreaseLabel,
        disabled: selectionPresetMap.decreaseTop10.length === 0,
      },
      {
        value: "mixedTop5" as const,
        label: mixedLabel,
        disabled: selectionPresetMap.mixedTop5.length === 0,
      },
      {
        value: "custom" as const,
        label: "手動選択（保持）",
        disabled: false,
      },
    ];
  }, [isShareMetric, selectionPresetMap]);

  const selectedComparisonData = useMemo(() => {
    if (comparisonBarData.length === 0) {
      return [];
    }
    const dataMap = new Map(comparisonBarData.map((row) => [row.id, row]));
    const fallbackIds = selectionPresetMap.recommended ?? [];
    const sourceIds =
      selectedAreaIds.length > 0 ? selectedAreaIds : fallbackIds;
    const orderedUnique = sourceIds.filter(
      (id, index, array) => array.indexOf(id) === index,
    );
    return orderedUnique
      .map((id, index) => {
        const existing = dataMap.get(id);
        if (existing) {
          return existing;
        }
        const label = areaLabelMap[id];
        if (!label) {
          return null;
        }
        const { fill, accent } =
          AREA_COLOR_PALETTE[index % AREA_COLOR_PALETTE.length];
        return {
          id,
          label,
          shareA: 0,
          shareB: 0,
          diffShare: 0,
          countA: 0,
          countB: 0,
          diffCount: 0,
          fill,
          accent,
        };
      })
      .filter((row): row is (typeof comparisonBarData)[number] => Boolean(row));
  }, [comparisonBarData, selectedAreaIds, areaLabelMap, selectionPresetMap]);

  const displayComparisonData = useMemo(
    () =>
      selectedComparisonData.map((row) => ({
        ...row,
        periodA: comparisonMetric === "share" ? row.shareA : row.countA,
        periodB: comparisonMetric === "share" ? row.shareB : row.countB,
        diffValue: comparisonMetric === "share" ? row.diffShare : row.diffCount,
      })),
    [comparisonMetric, selectedComparisonData],
  );

  const areaOptions = useMemo(() => {
    const options = comparisonBarData.map((row) => ({
      id: row.id,
      label: row.label,
    }));
    const knownIds = new Set(options.map((option) => option.id));
    Object.entries(areaLabelMap).forEach(([id, label]) => {
      if (!knownIds.has(id)) {
        options.push({ id, label });
      }
    });
    return options.sort((a, b) => a.label.localeCompare(b.label, "ja"));
  }, [comparisonBarData, areaLabelMap]);

  const handleAddArea = useCallback(
    (areaId: string) => {
      if (!areaId) {
        return;
      }
      const option = areaOptions.find((candidate) => candidate.id === areaId);
      if (!option) {
        return;
      }
      setAreaLabelMap((prev) => {
        if (prev[areaId]) {
          return prev;
        }
        return { ...prev, [areaId]: option.label };
      });
      let didAdd = false;
      setSelectedAreaIds((prev) => {
        if (prev.includes(areaId)) {
          return prev;
        }
        if (prev.length >= MAX_SELECTED_AREAS) {
          showSelectionFeedback(
            "limit",
            `比較対象は最大${MAX_SELECTED_AREAS}件までです。`,
          );
          return prev;
        }
        didAdd = true;
        showSelectionFeedback("added", `${option.label} を比較に追加しました`);
        return [...prev, areaId];
      });
      if (didAdd) {
        setSelectionPreset("custom");
        setFocusAreaId(areaId);
      }
      setPendingAreaId("");
    },
    [areaOptions, showSelectionFeedback],
  );

  const isExpandedComparison = selectedComparisonData.length >= 8;
  const comparisonChartHeight = Math.max(
    isMobile ? 240 : 320,
    selectedComparisonData.length * (isMobile ? 64 : 72),
  );
  const diffChartHeight = Math.max(
    isMobile ? 220 : 260,
    selectedComparisonData.length * (isMobile ? 56 : 64),
  );
  const shareBarCategoryGap = isExpandedComparison
    ? isMobile
      ? "12%"
      : "18%"
    : isMobile
      ? "20%"
      : "26%";
  const shareBarGap = isExpandedComparison
    ? isMobile
      ? 2
      : 4
    : isMobile
      ? 3
      : 6;
  const diffBarCategoryGap = isExpandedComparison
    ? isMobile
      ? "18%"
      : "24%"
    : isMobile
      ? "22%"
      : "32%";
  const diffBarGap = isExpandedComparison
    ? isMobile
      ? 2
      : 4
    : isMobile
      ? 3
      : 6;
  const geoMapHeight = isMobile ? 360 : 520;
  const metricUnitLabel = isShareMetric ? "%" : "件";
  const primaryComparisonTitle = isShareMetric
    ? "来院割合の比較"
    : "来院人数の比較";
  const primaryComparisonSubtitle = `淡色が${periodALabel}、濃色が${periodBLabel}です（単位: ${metricUnitLabel}）。`;
  const diffChartTitle = isShareMetric
    ? `増減率（${periodBLabel} - ${periodALabel}）`
    : `増減件数（${periodBLabel} - ${periodALabel}）`;
  const diffChartSubtitle = isShareMetric
    ? "正の値は増加、負の値は減少を示します。"
    : "正の値は人数が増加、負の値は人数が減少したことを示します。";

  const comparisonShareDomain = useMemo<[number, number]>(() => {
    if (selectedComparisonData.length === 0) {
      return [0, 100];
    }
    const maxShare = Math.max(
      5,
      ...selectedComparisonData.map((row) => Math.max(row.shareA, row.shareB)),
    );
    return [0, Math.min(100, Math.ceil(maxShare + 1))];
  }, [selectedComparisonData]);

  const comparisonDiffShareDomain = useMemo<[number, number]>(() => {
    if (selectedComparisonData.length === 0) {
      return [-10, 10];
    }
    const maxAbs = Math.max(
      1,
      ...selectedComparisonData.map((row) => Math.abs(row.diffShare)),
    );
    const padding = Math.ceil(maxAbs + 1);
    return [-padding, padding];
  }, [selectedComparisonData]);

  const comparisonCountDomain = useMemo<[number, number]>(() => {
    if (selectedComparisonData.length === 0) {
      return [0, 1];
    }
    const maxCount = Math.max(
      1,
      ...selectedComparisonData.map((row) => Math.max(row.countA, row.countB)),
    );
    const upper = Math.ceil(maxCount * 1.1);
    return [0, upper];
  }, [selectedComparisonData]);

  const comparisonDiffCountDomain = useMemo<[number, number]>(() => {
    if (selectedComparisonData.length === 0) {
      return [-1, 1];
    }
    const maxAbs = Math.max(
      1,
      ...selectedComparisonData.map((row) => Math.abs(row.diffCount)),
    );
    const padding = Math.ceil(maxAbs * 1.1);
    return [-padding, padding];
  }, [selectedComparisonData]);

  const invalidRange = useMemo(
    () => Boolean(comparisonData?.invalid),
    [comparisonData],
  );

  const leadingDiff = useMemo(() => {
    if (!validComparison || validComparison.rows.length === 0) {
      return null;
    }
    return validComparison.rows[0];
  }, [validComparison]);

  const monthOptions = useMemo(
    () =>
      sortedMonths.map((month) => ({
        value: month,
        label: formatMonthLabel(month),
      })),
    [sortedMonths],
  );

  const handleRangeAChange =
    (field: keyof ComparisonRange) =>
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value || null;
      setRangeA((prev) => ({ ...prev, [field]: value }));
    };

  const handleRangeBChange =
    (field: keyof ComparisonRange) =>
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value || null;
      setRangeB((prev) => ({ ...prev, [field]: value }));
    };

  const handleRemoveArea = (areaId: string) => {
    let nextLength = -1;
    setSelectedAreaIds((prev) => {
      if (!prev.includes(areaId)) {
        return prev;
      }
      const next = prev.filter((id) => id !== areaId);
      nextLength = next.length;
      const lastId = next[next.length - 1] ?? null;
      setFocusAreaId(lastId);
      const label = areaLabelMap[areaId];
      if (label) {
        showSelectionFeedback("removed", `${label} を比較対象から外しました`);
      } else {
        showSelectionFeedback(
          "removed",
          "選択した地区を比較対象から外しました",
        );
      }
      return next;
    });
    if (nextLength >= 0) {
      setSelectionPreset(nextLength === 0 ? "recommended" : "custom");
    }
  };

  const handleResetAreas = () => {
    const recommendedIds = selectionPresetMap.recommended ?? [];
    setSelectionPreset("recommended");
    setSelectedAreaIds(recommendedIds);
    setFocusAreaId(recommendedIds[recommendedIds.length - 1] ?? null);
    setPendingAreaId("");
  };

  const handlePendingAreaChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setPendingAreaId(event.target.value);
  };

  const handlePresetChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value as ComparisonSelectionPreset;
    setSelectionPreset(value);
  };

  const formatDiffValue = (value: number) => {
    if (value === 0) {
      return "±0件";
    }
    return `${value > 0 ? "+" : ""}${value.toLocaleString("ja-JP")}件`;
  };

  const formatRatioValue = (value: number | null) => {
    if (value === null) {
      return "—";
    }
    return `${(value * 100).toFixed(1)}%`;
  };

  const formatMetricValue = (value: number) =>
    Number.isInteger(value) ? value.toLocaleString("ja-JP") : value.toFixed(1);

  const handleRegisterAreas = useCallback((areas: AreaSelectionMeta[]) => {
    setAreaLabelMap((prev) => {
      let updated = false;
      const next = { ...prev };
      for (const area of areas) {
        if (!next[area.id]) {
          next[area.id] = area.label;
          updated = true;
        }
      }
      return updated ? next : prev;
    });
  }, []);

  const handleSummaryAreaClick = (areaId: string) => {
    if (!areaId) {
      return;
    }
    const label =
      comparisonBarData.find((row) => row.id === areaId)?.label ??
      areaLabelMap[areaId] ??
      areaOptions.find((option) => option.id === areaId)?.label ??
      "選択した地区";
    let didAdd = false;
    setSelectedAreaIds((prev) => {
      if (prev.includes(areaId)) {
        return prev;
      }
      if (prev.length >= MAX_SELECTED_AREAS) {
        showSelectionFeedback(
          "limit",
          `比較対象は最大${MAX_SELECTED_AREAS}件までです。`,
        );
        return prev;
      }
      didAdd = true;
      showSelectionFeedback("added", `${label} を比較に追加しました`);
      return [...prev, areaId];
    });
    if (didAdd) {
      setSelectionPreset("custom");
      setFocusAreaId(areaId);
    }
  };

  const openAreaPicker = () => {
    setAreaPickerOpen(true);
  };

  const closeAreaPicker = () => {
    setAreaPickerOpen(false);
  };

  const handleSummaryAgeClick = (ageBandId: AgeBandId) => {
    setHighlightedAgeBand(ageBandId);
  };

  const handleToggleAreaFromMap = useCallback(
    (area: AreaSelectionMeta) => {
      setAreaLabelMap((prev) => {
        if (prev[area.id]) {
          return prev;
        }
        return { ...prev, [area.id]: area.label };
      });
      let nextPreset: ComparisonSelectionPreset | null = null;
      setSelectedAreaIds((prev) => {
        const exists = prev.includes(area.id);
        let next: string[];
        let nextFocus: string | null;
        if (exists) {
          next = prev.filter((id) => id !== area.id);
          nextFocus = next[next.length - 1] ?? null;
          showSelectionFeedback(
            "removed",
            `${area.label} を比較対象から外しました`,
          );
          nextPreset = next.length === 0 ? "recommended" : "custom";
        } else {
          if (prev.length >= MAX_SELECTED_AREAS) {
            showSelectionFeedback(
              "limit",
              `比較対象は最大${MAX_SELECTED_AREAS}件までです。`,
            );
            return prev;
          }
          next = [...prev, area.id];
          nextFocus = area.id;
          showSelectionFeedback("added", `${area.label} を比較に追加しました`);
          nextPreset = "custom";
        }
        setFocusAreaId(nextFocus);
        return next;
      });
      if (nextPreset) {
        setSelectionPreset(nextPreset);
      }
    },
    [showSelectionFeedback],
  );

  const ComparisonTooltipContent = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{
      name?: string | number;
      dataKey?: string | number;
      value?: number;
    }>;
    label?: string | number;
  }) => {
    if (!active || !payload || payload.length === 0) {
      return null;
    }
    const safeLabel = typeof label === "string" ? label : "";
    const formatValue = (
      dataKey: string | number | undefined,
      raw: unknown,
    ): string => {
      if (typeof raw !== "number") {
        if (raw === null || raw === undefined) {
          return "—";
        }
        return String(raw);
      }
      const key = dataKey?.toString() ?? "";
      if (key === "diffValue" || key === "periodA" || key === "periodB") {
        return isShareMetric
          ? `${raw.toFixed(1)}%`
          : `${Math.round(raw).toLocaleString("ja-JP")}件`;
      }
      return isShareMetric
        ? `${raw.toFixed(1)}%`
        : `${Math.round(raw).toLocaleString("ja-JP")}件`;
    };
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
        {safeLabel && (
          <p className="mb-1 font-semibold text-slate-700">{safeLabel}</p>
        )}
        {payload.map((entry) => {
          const key =
            entry.dataKey?.toString() ?? entry.name?.toString() ?? "value";
          const seriesLabel =
            entry.dataKey === "periodA"
              ? periodALabel
              : entry.dataKey === "periodB"
                ? periodBLabel
                : (entry.name ?? entry.dataKey);
          return (
            <p key={key} className="text-slate-600">
              {seriesLabel}: {formatValue(entry.dataKey, entry.value)}
            </p>
          );
        })}
      </div>
    );
  };

  type LabelGeometry = {
    x?: number | string;
    y?: number | string;
    width?: number | string;
    height?: number | string;
    value?: number | string;
  };

  const DiffLabelShare = ({ x, y, width, height, value }: LabelGeometry) => {
    const toNumber = (input?: number | string) => {
      if (typeof input === "number") {
        return input;
      }
      if (typeof input === "string") {
        const parsed = Number.parseFloat(input);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      return undefined;
    };
    const xCoord = toNumber(x);
    const yCoord = toNumber(y);
    const barWidth = toNumber(width);
    const barHeight = toNumber(height);
    const numericValue = toNumber(value);
    if (
      typeof xCoord !== "number" ||
      typeof yCoord !== "number" ||
      typeof barWidth !== "number" ||
      typeof barHeight !== "number" ||
      typeof numericValue !== "number"
    ) {
      return <g />;
    }
    const isPositive = numericValue >= 0;
    const anchorX = xCoord + barWidth / 2;
    const anchorY = isPositive ? yCoord - 8 : yCoord + barHeight + 14;
    const textColor = isPositive ? "#047857" : "#b91c1c";
    return (
      <text
        x={anchorX}
        y={anchorY}
        fill={textColor}
        fontSize={11}
        fontWeight={600}
        textAnchor="middle"
      >
        {`${isPositive ? "+" : ""}${numericValue.toFixed(1)}%`}
      </text>
    );
  };

  const DiffLabelCount = ({ x, y, width, height, value }: LabelGeometry) => {
    const toNumber = (input?: number | string) => {
      if (typeof input === "number") {
        return input;
      }
      if (typeof input === "string") {
        const parsed = Number.parseFloat(input);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      return undefined;
    };
    const xCoord = toNumber(x);
    const yCoord = toNumber(y);
    const barWidth = toNumber(width);
    const barHeight = toNumber(height);
    const numericValue = toNumber(value);
    if (
      typeof xCoord !== "number" ||
      typeof yCoord !== "number" ||
      typeof barWidth !== "number" ||
      typeof barHeight !== "number" ||
      typeof numericValue !== "number"
    ) {
      return <g />;
    }
    const isPositive = numericValue >= 0;
    const anchorX = xCoord + barWidth / 2;
    const anchorY = isPositive ? yCoord - 8 : yCoord + barHeight + 14;
    const textColor = isPositive ? "#047857" : "#b91c1c";
    const displayValue = Math.round(numericValue).toLocaleString("ja-JP");
    return (
      <text
        x={anchorX}
        y={anchorY}
        fill={textColor}
        fontSize={11}
        fontWeight={600}
        textAnchor="middle"
      >
        {`${isPositive ? "+" : ""}${displayValue}件`}
      </text>
    );
  };

  const labelColorMap = useMemo(() => {
    const map = new Map<string, string>();
    selectedComparisonData.forEach((row) => {
      map.set(row.label, row.fill);
    });
    return map;
  }, [selectedComparisonData]);

  const tickFontSize = selectedComparisonData.length >= 9 ? 13 : 14;
  const tickLineHeight = tickFontSize + 3;
  const tickYOffset = tickFontSize >= 14 ? 16 : 14;

  const renderCategoryTick = useCallback(
    ({
      x,
      y,
      payload,
    }: {
      x?: number;
      y?: number;
      payload?: { value: string };
    }) => {
      if (typeof x !== "number" || typeof y !== "number" || !payload?.value) {
        return <g />;
      }
      const segments = payload.value.match(/.{1,6}/g) ?? [payload.value];
      const baseColor = labelColorMap.get(payload.value);
      const textColor = baseColor ? solidFill(baseColor, 0.95) : "#1f2937";
      return (
        <g transform={`translate(${x},${y + tickYOffset})`}>
          <text
            x={0}
            y={0}
            fill={textColor}
            fontSize={tickFontSize}
            fontWeight={600}
            textAnchor="middle"
          >
            {segments.map((segment, index) => (
              <tspan
                key={`${payload.value}-${index}`}
                x={0}
                dy={index === 0 ? 0 : tickLineHeight}
              >
                {segment}
              </tspan>
            ))}
          </text>
        </g>
      );
    },
    [labelColorMap, tickFontSize, tickLineHeight, tickYOffset],
  );

  const isEmpty = filteredMapRecords.length === 0;

  return (
    <>
      <main className="min-h-screen bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 py-12">
          <section className="relative overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-white via-emerald-50 to-sky-100 p-8 shadow-card">
            <div className="pointer-events-none absolute -right-16 top-0 h-48 w-48 rounded-full bg-gradient-to-br from-emerald-200/50 via-sky-200/40 to-purple-200/40 blur-3xl" />
            <div className="pointer-events-none absolute -left-20 bottom-0 h-52 w-52 rounded-full bg-gradient-to-br from-sky-200/45 via-emerald-200/30 to-white/0 blur-3xl" />
            <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="space-y-3">
                <p className="text-sm font-semibold text-emerald-600">
                  Map Analytics Dashboard
                </p>
                <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">
                  マップ分析
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                  カルテ集計CSVから取り込んだ患者の年代・診療科・住所データをもとに、来院エリアを町丁目レベルで可視化します。診療科や年代を切り替えながら、来院傾向の偏りや新規獲得余地を探索できます。
                </p>
              </div>
              <div className="flex flex-col items-start gap-3 text-sm text-slate-600">
                <Link
                  href="/patients"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  <ArrowLeft className="h-4 w-4" />
                  患者分析に戻る
                </Link>
                {lastUpdated && (
                  <p className="text-xs font-medium text-slate-500">
                    最終更新: {new Date(lastUpdated).toLocaleString("ja-JP")}
                  </p>
                )}
              </div>
            </div>
          </section>

          <AnalysisFilterPortal
            months={sortedMonths}
            startMonth={mapStartMonth}
            endMonth={mapEndMonth}
            onChangeStart={setMapStartMonth}
            onChangeEnd={setMapEndMonth}
            onReset={resetMapPeriod}
            label={mapPeriodLabel}
            renderMonthLabel={formatMonthLabel}
          />

          {isEmpty ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-700 shadow-sm">
              <div className="flex items-center gap-3 text-indigo-600">
                <RefreshCw className="h-5 w-5 animate-spin" />
                <p className="text-sm font-semibold">
                  地図に表示できるカルテデータがありません。
                </p>
              </div>
              <p className="mt-4 text-sm">
                まずは「患者分析」ページでカルテ集計CSVを取り込み、保存してください。保存後にこのページを開き直すと、最新情報が反映されます。
              </p>
            </section>
          ) : (
            <section className="space-y-8">
              <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
                <div
                  className="rounded-2xl border border-slate-200 bg-slate-50/40"
                  style={{ height: `${geoMapHeight}px` }}
                >
                  <GeoDistributionMap
                    reservations={filteredMapRecords}
                    periodLabel={mapPeriodLabel}
                    selectedAreaIds={selectedAreaIds}
                    focusAreaId={focusAreaId}
                    onToggleArea={handleToggleAreaFromMap}
                    onRegisterAreas={handleRegisterAreas}
                  />
                </div>
              </section>

              <section className="relative z-10 mt-4 mb-24 overflow-visible">
                <div className="rounded-3xl border border-indigo-200 bg-white p-6 pb-8 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        期間サマリー
                      </h2>
                      <p className="text-xs text-slate-500">
                        範囲:{" "}
                        <span className="whitespace-pre-line font-semibold text-slate-700">
                          {periodRangeDisplay}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span>
                        表示期間:{" "}
                        <strong className="font-semibold text-slate-700">
                          {mapPeriodLabel}
                        </strong>
                      </span>
                      <span>
                        データ件数:{" "}
                        <strong className="font-semibold text-slate-700">
                          {totalRecords.toLocaleString("ja-JP")}件
                        </strong>
                      </span>
                      {lastUpdated && (
                        <span>
                          最終更新:{" "}
                          <strong className="font-semibold text-slate-700">
                            {new Date(lastUpdated).toLocaleString("ja-JP")}
                          </strong>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative z-10 mt-6 grid gap-4 lg:grid-cols-3">
                    <div className="relative z-10 space-y-3">
                      <h3 className="text-sm font-semibold text-emerald-600">
                        増加した地区 Top3
                      </h3>
                      {summary.increases.length === 0 ? (
                        <p className="rounded-2xl border border-emerald-100 bg-emerald-50/80 px-4 py-3 text-xs text-emerald-700">
                          増加した地区が見つかりません。
                        </p>
                      ) : (
                        summary.increases.map((entry) => {
                          const location = entry.town ?? entry.city ?? null;
                          const isActive = activeAreaId === entry.id;
                          return (
                            <button
                              key={`increase-${entry.id}`}
                              type="button"
                              onClick={() => handleSummaryAreaClick(entry.id)}
                              className={`w-full rounded-2xl border px-4 py-3 text-left shadow-sm transition ${
                                isActive
                                  ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200"
                                  : "border-emerald-100 bg-white hover:border-emerald-300 hover:shadow-lg"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-800">
                                    {entry.label}
                                  </p>
                                  {location && (
                                    <p className="text-[11px] text-emerald-700">
                                      地点: {location}
                                    </p>
                                  )}
                                </div>
                                <span className="text-xs font-semibold text-emerald-600">
                                  {formatDiffValue(entry.diff)}
                                </span>
                              </div>
                              <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                                <div>
                                  <dt className="font-semibold text-slate-400">
                                    開始
                                  </dt>
                                  <dd className="text-sm font-semibold text-slate-800">
                                    {formatMetricValue(entry.comparison ?? 0)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="font-semibold text-slate-400">
                                    終了
                                  </dt>
                                  <dd className="text-sm font-semibold text-slate-800">
                                    {formatMetricValue(entry.current)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="font-semibold text-slate-400">
                                    変化率
                                  </dt>
                                  <dd className="text-sm font-semibold text-slate-800">
                                    {formatRatioValue(entry.ratio)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="font-semibold text-slate-400">
                                    終了構成比
                                  </dt>
                                  <dd className="text-sm font-semibold text-slate-800">
                                    {formatRatioValue(entry.share)}
                                  </dd>
                                </div>
                              </dl>
                            </button>
                          );
                        })
                      )}
                    </div>
                    <div className="relative z-10 space-y-3">
                      <h3 className="text-sm font-semibold text-rose-600">
                        減少した地区 Top3
                      </h3>
                      {summary.decreases.length === 0 ? (
                        <p className="rounded-2xl border border-rose-100 bg-rose-50/80 px-4 py-3 text-xs text-rose-600">
                          減少した地区が見つかりません。
                        </p>
                      ) : (
                        summary.decreases.map((entry) => {
                          const location = entry.town ?? entry.city ?? null;
                          const isActive = activeAreaId === entry.id;
                          return (
                            <button
                              key={`decrease-${entry.id}`}
                              type="button"
                              onClick={() => handleSummaryAreaClick(entry.id)}
                              className={`w-full rounded-2xl border px-4 py-3 text-left shadow-sm transition ${
                                isActive
                                  ? "border-rose-300 bg-rose-50 ring-2 ring-rose-200"
                                  : "border-rose-100 bg-white hover:border-rose-300 hover:shadow-lg"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-800">
                                    {entry.label}
                                  </p>
                                  {location && (
                                    <p className="text-[11px] text-rose-600">
                                      地点: {location}
                                    </p>
                                  )}
                                </div>
                                <span className="text-xs font-semibold text-rose-600">
                                  {formatDiffValue(entry.diff)}
                                </span>
                              </div>
                              <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                                <div>
                                  <dt className="font-semibold text-slate-400">
                                    開始
                                  </dt>
                                  <dd className="text-sm font-semibold text-slate-800">
                                    {formatMetricValue(entry.comparison ?? 0)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="font-semibold text-slate-400">
                                    終了
                                  </dt>
                                  <dd className="text-sm font-semibold text-slate-800">
                                    {formatMetricValue(entry.current)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="font-semibold text-slate-400">
                                    変化率
                                  </dt>
                                  <dd className="text-sm font-semibold text-slate-800">
                                    {formatRatioValue(entry.ratio)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="font-semibold text-slate-400">
                                    終了構成比
                                  </dt>
                                  <dd className="text-sm font-semibold text-slate-800">
                                    {formatRatioValue(entry.share)}
                                  </dd>
                                </div>
                              </dl>
                            </button>
                          );
                        })
                      )}
                    </div>
                    <div className="relative z-10 space-y-3">
                      <h3 className="text-sm font-semibold text-indigo-600">
                        伸びた年代 Top3
                      </h3>
                      {summary.ages.length === 0 ? (
                        <p className="rounded-2xl border border-indigo-100 bg-indigo-50/80 px-4 py-3 text-xs text-indigo-600">
                          伸びた年代が見つかりません。
                        </p>
                      ) : (
                        summary.ages.map((entry) => {
                          const isActive = highlightedAgeBand === entry.id;
                          return (
                            <button
                              key={`age-${entry.id}`}
                              type="button"
                              onClick={() =>
                                handleSummaryAgeClick(entry.id as AgeBandId)
                              }
                              className={`w-full rounded-2xl border px-4 py-3 text-left shadow-sm transition ${
                                isActive
                                  ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200"
                                  : "border-indigo-100 bg-white hover:border-indigo-300 hover:shadow-lg"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <p className="text-sm font-semibold text-slate-800">
                                  {entry.label}
                                </p>
                                <span className="text-xs font-semibold text-indigo-600">
                                  {formatDiffValue(entry.diff)}
                                </span>
                              </div>
                              <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                                <div>
                                  <dt className="font-semibold text-slate-400">
                                    開始
                                  </dt>
                                  <dd className="text-sm font-semibold text-slate-800">
                                    {formatMetricValue(entry.comparison ?? 0)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="font-semibold text-slate-400">
                                    終了
                                  </dt>
                                  <dd className="text-sm font-semibold text-slate-800">
                                    {formatMetricValue(entry.current)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="font-semibold text-slate-400">
                                    変化率
                                  </dt>
                                  <dd className="text-sm font-semibold text-slate-800">
                                    {formatRatioValue(entry.ratio)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="font-semibold text-slate-400">
                                    終了構成比
                                  </dt>
                                  <dd className="text-sm font-semibold text-slate-800">
                                    {formatRatioValue(entry.share)}
                                  </dd>
                                </div>
                              </dl>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <section className="relative z-0 mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      期間比較モード
                    </h2>
                    <p className="text-xs text-slate-500">
                      期間Aと期間Bを指定して、来院エリアや年代構成の変化を比較できます。
                    </p>
                  </div>
                  <div className="grid w-full gap-4 sm:grid-cols-2 md:w-auto">
                    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
                      <p className="text-xs font-semibold text-indigo-500">
                        期間A
                      </p>
                      <div className="mt-2 flex items-center gap-2 text-sm">
                        <select
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                          value={rangeA.start ?? ""}
                          onChange={handleRangeAChange("start")}
                        >
                          <option value="">指定なし</option>
                          {monthOptions.map((option) => (
                            <option
                              key={`rangeA-start-${option.value}`}
                              value={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span className="text-xs text-slate-500">〜</span>
                        <select
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                          value={rangeA.end ?? ""}
                          onChange={handleRangeAChange("end")}
                        >
                          <option value="">指定なし</option>
                          {monthOptions.map((option) => (
                            <option
                              key={`rangeA-end-${option.value}`}
                              value={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                      <p className="text-xs font-semibold text-emerald-500">
                        期間B
                      </p>
                      <div className="mt-2 flex items-center gap-2 text-sm">
                        <select
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                          value={rangeB.start ?? ""}
                          onChange={handleRangeBChange("start")}
                        >
                          <option value="">指定なし</option>
                          {monthOptions.map((option) => (
                            <option
                              key={`rangeB-start-${option.value}`}
                              value={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span className="text-xs text-slate-500">〜</span>
                        <select
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                          value={rangeB.end ?? ""}
                          onChange={handleRangeBChange("end")}
                        >
                          <option value="">指定なし</option>
                          {monthOptions.map((option) => (
                            <option
                              key={`rangeB-end-${option.value}`}
                              value={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
                  <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 font-semibold text-indigo-600">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-200 text-[10px] font-bold text-indigo-700">
                      A
                    </span>
                    {periodALabel}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-600">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-200 text-[10px] font-bold text-emerald-700">
                      B
                    </span>
                    {periodBLabel}
                  </span>
                </div>

                {invalidRange ? (
                  <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-700">
                    期間Aまたは期間Bの開始月が終了月より後になっています。範囲を修正してください。
                  </div>
                ) : !validComparison ? (
                  <p className="mt-6 text-sm text-slate-500">
                    比較する期間を選択してください。
                  </p>
                ) : (
                  <div className="mt-6 space-y-6">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
                        <p className="text-xs font-semibold text-indigo-500">
                          {periodALabel}
                        </p>
                        <p className="mt-2 text-2xl font-bold text-indigo-700">
                          {validComparison.totalA.toLocaleString("ja-JP")}件
                        </p>
                      </div>
                      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                        <p className="text-xs font-semibold text-emerald-500">
                          {periodBLabel}
                        </p>
                        <p className="mt-2 text-2xl font-bold text-emerald-700">
                          {validComparison.totalB.toLocaleString("ja-JP")}件
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                        <p className="text-xs font-semibold text-slate-500">
                          最大変化エリア
                        </p>
                        {leadingDiff ? (
                          <div className="mt-2 text-sm text-slate-800">
                            <p className="font-semibold">{leadingDiff.label}</p>
                            <p className="text-xs text-slate-500">
                              {periodALabel} {formatPercent(leadingDiff.shareA)}{" "}
                              → {periodBLabel}{" "}
                              {formatPercent(leadingDiff.shareB)}
                            </p>
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">
                            差分のあるエリアがありません。
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-inner">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-800">
                            比較する地区を選択
                          </h3>
                          <p className="text-[11px] text-slate-500">
                            ページ上部の地図、または「地図から選ぶ」を使って地区を追加・削除できます。最大
                            {MAX_SELECTED_AREAS}件まで表示可能です。
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs shadow-sm">
                            <span className="font-semibold text-slate-600">
                              プリセット
                            </span>
                            <select
                              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                              value={selectionPreset}
                              onChange={handlePresetChange}
                            >
                              {selectionPresetOptions.map((option) => (
                                <option
                                  key={option.value}
                                  value={option.value}
                                  disabled={option.disabled}
                                >
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1 py-1 text-xs shadow-sm">
                            <button
                              type="button"
                              onClick={() => setComparisonMetric("share")}
                              className={`rounded-full px-3 py-1 font-semibold transition ${
                                isShareMetric
                                  ? "bg-brand-500 text-white shadow-sm"
                                  : "text-slate-600 hover:bg-brand-50 hover:text-brand-600"
                              }`}
                            >
                              割合
                            </button>
                            <button
                              type="button"
                              onClick={() => setComparisonMetric("count")}
                              className={`rounded-full px-3 py-1 font-semibold transition ${
                                !isShareMetric
                                  ? "bg-brand-500 text-white shadow-sm"
                                  : "text-slate-600 hover:bg-brand-50 hover:text-brand-600"
                              }`}
                            >
                              人数
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={handleResetAreas}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600"
                          >
                            <Target className="h-3.5 w-3.5" />
                            推奨へ戻す
                          </button>
                          <button
                            type="button"
                            onClick={openAreaPicker}
                            className="inline-flex items-center gap-2 rounded-full border border-accent-200 bg-accent-50 px-3 py-1.5 text-xs font-semibold text-accent-600 shadow-sm transition hover:border-accent-300 hover:bg-white"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                            地図から選ぶ
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedComparisonData.length > 0 ? (
                          selectedComparisonData.map((row) => (
                            <span
                              key={`selection-${row.id}`}
                              className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm"
                              style={{
                                borderColor: row.fill,
                                backgroundColor: translucentFill(
                                  row.fill,
                                  0.25,
                                ),
                              }}
                            >
                              <span>{row.label}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveArea(row.id)}
                                className="flex h-5 w-5 items-center justify-center rounded-full bg-white/85 text-slate-500 transition hover:bg-white hover:text-slate-700"
                                aria-label={`${row.label}を削除`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-500">
                            地図または下のセレクタから地区を追加してください。
                          </span>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <select
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                          value={pendingAreaId}
                          onChange={handlePendingAreaChange}
                        >
                          <option value="">地区を選択して追加</option>
                          {areaOptions.map((option) => (
                            <option
                              key={`option-${option.id}`}
                              value={option.id}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleAddArea(pendingAreaId)}
                          disabled={
                            !pendingAreaId ||
                            selectedAreaIds.includes(pendingAreaId)
                          }
                          className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-200 disabled:text-slate-500"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          選択に追加
                        </button>
                        <p className="text-[11px] text-slate-500">
                          選択数: {selectedComparisonData.length}/
                          {MAX_SELECTED_AREAS}
                        </p>
                      </div>
                    </div>

                    {selectedComparisonData.length > 0 ? (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-inner">
                          <h3 className="text-sm font-semibold text-slate-800">
                            {primaryComparisonTitle}
                          </h3>
                          <p className="text-[11px] text-slate-500">
                            {primaryComparisonSubtitle}
                          </p>
                          <div
                            className="mt-4"
                            style={{ height: `${comparisonChartHeight}px` }}
                          >
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart
                                data={displayComparisonData}
                                margin={{
                                  top: 12,
                                  right: 24,
                                  bottom: 36,
                                  left: 32,
                                }}
                                barCategoryGap={shareBarCategoryGap}
                                barGap={shareBarGap}
                              >
                                <CartesianGrid
                                  strokeDasharray="3 3"
                                  stroke="#e2e8f0"
                                />
                                <XAxis
                                  dataKey="label"
                                  interval={0}
                                  height={72}
                                  tick={renderCategoryTick}
                                />
                                <YAxis
                                  domain={
                                    isShareMetric
                                      ? comparisonShareDomain
                                      : comparisonCountDomain
                                  }
                                  tickFormatter={(value: number) =>
                                    isShareMetric
                                      ? `${value}%`
                                      : Math.round(value).toLocaleString(
                                          "ja-JP",
                                        )
                                  }
                                  stroke="#94a3b8"
                                />
                                <RechartsTooltip
                                  content={<ComparisonTooltipContent />}
                                />
                                <Bar
                                  dataKey="periodA"
                                  name={periodALabel}
                                  radius={[6, 6, 0, 0]}
                                >
                                  {displayComparisonData.map((row) => (
                                    <Cell
                                      key={`periodA-${row.id}`}
                                      fill={translucentFill(row.fill, 0.5)}
                                      stroke={row.fill}
                                      strokeWidth={1.2}
                                    />
                                  ))}
                                  <LabelList
                                    dataKey="periodA"
                                    position="top"
                                    formatter={(value) =>
                                      typeof value === "number"
                                        ? isShareMetric
                                          ? `${value.toFixed(1)}%`
                                          : `${Math.round(value).toLocaleString("ja-JP")}件`
                                        : `${value}`
                                    }
                                    fill="#0f172a"
                                    fontSize={12}
                                  />
                                </Bar>
                                <Bar
                                  dataKey="periodB"
                                  name={periodBLabel}
                                  radius={[6, 6, 0, 0]}
                                >
                                  {displayComparisonData.map((row) => (
                                    <Cell
                                      key={`periodB-${row.id}`}
                                      fill={solidFill(row.fill, 0.85)}
                                      stroke={row.accent}
                                      strokeWidth={1.2}
                                    />
                                  ))}
                                  <LabelList
                                    dataKey="periodB"
                                    position="top"
                                    formatter={(value) =>
                                      typeof value === "number"
                                        ? isShareMetric
                                          ? `${value.toFixed(1)}%`
                                          : `${Math.round(value).toLocaleString("ja-JP")}件`
                                        : `${value}`
                                    }
                                    fill="#0f172a"
                                    fontSize={12}
                                  />
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-inner">
                          <h3 className="text-sm font-semibold text-slate-800">
                            {diffChartTitle}
                          </h3>
                          <p className="text-[11px] text-slate-500">
                            {diffChartSubtitle}
                          </p>
                          <div
                            className="mt-4"
                            style={{ height: `${diffChartHeight}px` }}
                          >
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart
                                data={displayComparisonData}
                                margin={{
                                  top: 12,
                                  right: 32,
                                  bottom: 36,
                                  left: 32,
                                }}
                                barCategoryGap={diffBarCategoryGap}
                                barGap={diffBarGap}
                              >
                                <CartesianGrid
                                  strokeDasharray="3 3"
                                  stroke="#e2e8f0"
                                />
                                <XAxis
                                  dataKey="label"
                                  interval={0}
                                  height={72}
                                  tick={renderCategoryTick}
                                />
                                <YAxis
                                  domain={
                                    isShareMetric
                                      ? comparisonDiffShareDomain
                                      : comparisonDiffCountDomain
                                  }
                                  tickFormatter={(value: number) =>
                                    isShareMetric
                                      ? `${value}%`
                                      : `${Math.round(value).toLocaleString("ja-JP")}件`
                                  }
                                  stroke="#94a3b8"
                                />
                                <RechartsTooltip
                                  content={<ComparisonTooltipContent />}
                                />
                                <ReferenceLine
                                  y={0}
                                  stroke="#94a3b8"
                                  strokeDasharray="4 4"
                                />
                                <Bar
                                  dataKey="diffValue"
                                  name={isShareMetric ? "増減率" : "増減件数"}
                                  radius={[6, 6, 6, 6]}
                                >
                                  {displayComparisonData.map((row) => (
                                    <Cell
                                      key={`diff-${row.id}`}
                                      fill={
                                        row.diffValue >= 0
                                          ? solidFill("#16a34a", 0.75)
                                          : solidFill("#dc2626", 0.8)
                                      }
                                      stroke={
                                        row.diffValue >= 0
                                          ? "#15803d"
                                          : "#b91c1c"
                                      }
                                      strokeWidth={1.1}
                                    />
                                  ))}
                                  <LabelList
                                    content={
                                      isShareMetric
                                        ? DiffLabelShare
                                        : DiffLabelCount
                                    }
                                  />
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-slate-100 bg-white p-6 text-sm text-slate-600 shadow-inner">
                        表示する地区が未選択です。地図またはセレクタから表示したい地区を追加してください。
                      </div>
                    )}

                    <div className="rounded-2xl border border-slate-100 bg-white p-4">
                      <h3 className="text-sm font-semibold text-slate-800">
                        年代構成の比較
                      </h3>
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-3 py-2 text-left">年代</th>
                              <th className="px-3 py-2 text-right">
                                {periodALabel}
                              </th>
                              <th className="px-3 py-2 text-right">
                                {periodBLabel}
                              </th>
                              <th className="px-3 py-2 text-right">差分</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-slate-700">
                            {ageComparisonRows.map((row) => (
                              <tr key={`age-${row.id}`}>
                                <td className="px-3 py-2 font-medium text-slate-800">
                                  {row.label}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {row.countA.toLocaleString("ja-JP")}
                                  <span className="ml-2 text-[11px] text-slate-500">
                                    {formatPercent(row.shareA)}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {row.countB.toLocaleString("ja-JP")}
                                  <span className="ml-2 text-[11px] text-slate-500">
                                    {formatPercent(row.shareB)}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {row.diff >= 0 ? "+" : ""}
                                  {row.diff.toLocaleString("ja-JP")}
                                  <span className="ml-2 text-[11px] text-slate-500">
                                    {row.diffShare >= 0 ? "+" : ""}
                                    {formatPercent(row.diffShare)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </section>
          )}
        </div>
      </main>

      {selectionFeedback && (
        <div
          key={selectionFeedback.key}
          className={`selection-feedback fixed bottom-8 right-6 z-[1200] flex max-w-sm items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold text-white shadow-xl ${
            selectionFeedback.tone === "added"
              ? "bg-emerald-600/90"
              : selectionFeedback.tone === "removed"
                ? "bg-slate-900/85"
                : "bg-amber-500/95"
          }`}
        >
          <MapPin className="h-4 w-4" />
          <span className="leading-snug">{selectionFeedback.message}</span>
        </div>
      )}

      {isAreaPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 backdrop-blur-sm"
          onClick={closeAreaPicker}
        >
          <div
            className="mx-4 w-full max-w-5xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  地図から比較エリアを選ぶ
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  追加したい地区をクリックすると選択が切り替わります。選択状態はすぐ下の一覧へ反映されます。
                </p>
              </div>
              <button
                type="button"
                onClick={closeAreaPicker}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-rose-200 hover:text-rose-600"
              >
                <X className="h-4 w-4" />
                閉じる
              </button>
            </div>
            <div
              className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/40"
              style={{ height: `${geoMapHeight}px` }}
            >
              <GeoDistributionMap
                reservations={filteredMapRecords}
                periodLabel={mapPeriodLabel}
                selectedAreaIds={selectedAreaIds}
                focusAreaId={focusAreaId}
                onToggleArea={handleToggleAreaFromMap}
                onRegisterAreas={handleRegisterAreas}
                pickerMode
              />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              ダブルクリックで拡大、右下のコントロールでズーム／リセットができます。
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default MapAnalysisPage;
