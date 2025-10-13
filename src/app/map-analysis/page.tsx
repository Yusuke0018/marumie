"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { RefreshCw, ArrowLeft } from "lucide-react";
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
  AreaChart,
  Area,
  Legend,
} from "recharts";

const KANJI_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;
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

const standardizeTownLabel = (raw: string | null | undefined): string | null => {
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
    return Number.isFinite(parsed) ? `${numberToKanji(parsed)}丁目` : `${digits}丁目`;
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
  const removed = normalized.replace(/([〇零一二三四五六七八九十百\d]+丁目)$/u, "");
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
      <div className="flex h-[520px] items-center justify-center rounded-3xl border border-slate-200 bg-white text-slate-500">
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

type AreaSelectionMeta = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  city: string | null;
  town: string | null;
  prefecture: string | null;
};

const MAX_SELECTED_AREAS = 8;
type AgeViewMode = "count" | "ratio";

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
        : record.patientCity ??
          record.patientPrefecture ??
          "住所未設定";

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

const buildAgeSeries = (records: MapRecord[], months: string[]): AgeSeries[] => {
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
    entry.share =
      totalCurrent > 0 ? entry.current / totalCurrent : 0;
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
    entry.share =
      ageTotalCurrent > 0 ? entry.current / ageTotalCurrent : 0;
    entry.contribution =
      totalDiff !== 0 && entry.comparison !== null
        ? (entry.diff / totalDiff) * 100
        : null;
  });

  const increases = areaEntries
    .filter((entry) => entry.diff > 0 && entry.label !== HIDDEN_AREA_LABEL)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 3);

  const decreases = areaEntries
    .filter((entry) => entry.diff < 0 && entry.label !== HIDDEN_AREA_LABEL)
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 3);

  const ages = ageEntries
    .filter((entry) => entry.diff > 0)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 3);

  return { increases, decreases, ages };
};

const AGE_BAND_COLOR_MAP: Record<AgeBandId, string> = {
  "0-19": "#0ea5e9",
  "20-39": "#10b981",
  "40-59": "#6366f1",
  "60-79": "#f97316",
  "80+": "#ef4444",
  unknown: "#94a3b8",
};

const computeAgeFromBirth = (
  birthIso: string | null,
  visitIso: string,
): number | null => {
  if (!birthIso) {
    return null;
  }
  const birthDate = new Date(birthIso);
  const visitDate = new Date(visitIso);
  if (
    Number.isNaN(birthDate.getTime()) ||
    Number.isNaN(visitDate.getTime())
  ) {
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
  if (age === null || age === undefined || Number.isNaN(age) || age < 0 || age > 120) {
    return "unknown";
  }
  for (const band of AGE_BANDS) {
    if (band.id === "unknown") {
      continue;
    }
    if (band.min !== null && age >= band.min && (band.max === null || age <= band.max)) {
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

  const mapRecords = useMemo<MapRecord[]>(() => {
    if (karteRecords.length === 0) {
      return [];
    }
    return karteRecords
      .map((record) => {
        const month = record.monthKey ?? record.dateIso.slice(0, 7);
        const address = record.patientAddress ?? null;
        const { prefecture, city, town, baseTown } = parseAddressComponents(address);
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

  const [selectedAgeMonthIndex, setSelectedAgeMonthIndex] = useState(() =>
    filteredMonths.length > 0 ? filteredMonths.length - 1 : 0,
  );
  const [highlightedAgeBand, setHighlightedAgeBand] =
    useState<AgeBandId | null>(null);
  const [ageViewMode, setAgeViewMode] = useState<AgeViewMode>("ratio");
  const [selectedAreaIds, setSelectedAreaIds] = useState<string[]>([]);
  const [focusAreaId, setFocusAreaId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedAgeMonthIndex(
      filteredMonths.length > 0 ? filteredMonths.length - 1 : 0,
    );
  }, [filteredMonths.length]);

  useEffect(() => {
    setHighlightedAgeBand(null);
  }, [filteredMonths.length]);

  const areaSeries = useMemo(
    () => buildAreaSeries(filteredMapRecords, filteredMonths),
    [filteredMapRecords, filteredMonths],
  );

  const ageAnalytics = useMemo(() => {
    const series = buildAgeSeries(filteredMapRecords, filteredMonths);
    const chartData = filteredMonths.map((month, index) => {
      const row: Record<string, number | string> = { month };
      series.forEach((item) => {
        row[item.id] = item.totals[index]?.count ?? 0;
      });
      return row;
    });
    const ratioData = filteredMonths.map((month, index) => {
      const totalForMonth = series.reduce(
        (acc, item) => acc + (item.totals[index]?.count ?? 0),
        0,
      );
      const row: Record<string, number | string> = { month };
      series.forEach((item) => {
        const count = item.totals[index]?.count ?? 0;
        row[item.id] = totalForMonth > 0 ? count / totalForMonth : 0;
      });
      return row;
    });
    return { series, chartData, ratioData };
  }, [filteredMapRecords, filteredMonths]);

  const ageSeries = ageAnalytics.series;
  const ageChartData = ageAnalytics.chartData;
  const ageRatioChartData = ageAnalytics.ratioData;

  const summary = useMemo(
    () => buildSummaryEntries(areaSeries, ageSeries, filteredMonths),
    [areaSeries, ageSeries, filteredMonths],
  );

  const ageSnapshot = useMemo(() => {
    if (filteredMonths.length === 0) {
      return [];
    }
    const clampedIndex = Math.min(
      Math.max(selectedAgeMonthIndex, 0),
      filteredMonths.length - 1,
    );
    return ageSeries
      .map((series) => {
        const point = series.totals[clampedIndex];
        const totalForMonth = ageSeries.reduce((acc, item) => {
          return acc + (item.totals[clampedIndex]?.count ?? 0);
        }, 0);
        const share =
          totalForMonth > 0
            ? (point?.count ?? 0) / totalForMonth
            : 0;
        return {
          id: series.id,
          label: series.label,
          count: point?.count ?? 0,
          share,
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [ageSeries, filteredMonths.length, selectedAgeMonthIndex]);

  const startMonthLabel =
    filteredMonths.length > 0 ? formatMonthLabel(filteredMonths[0]!) : null;
  const endMonthLabel =
    filteredMonths.length > 0
      ? formatMonthLabel(filteredMonths[filteredMonths.length - 1]!)
      : null;
  const periodRangeDisplay =
    startMonthLabel && endMonthLabel
      ? `${startMonthLabel} → ${endMonthLabel}`
      : startMonthLabel ?? endMonthLabel ?? "期間未設定";

  const totalRecords = filteredMapRecords.length;
  const latestSelectedAreaId =
    selectedAreaIds.length > 0
      ? selectedAreaIds[selectedAreaIds.length - 1] ?? null
      : null;
  const activeAreaId =
    focusAreaId ?? latestSelectedAreaId ?? summary.increases[0]?.id ?? null;

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
    Number.isInteger(value)
      ? value.toLocaleString("ja-JP")
      : value.toFixed(1);
  const handleSummaryAreaClick = (areaId: string) => {
    if (!areaId) {
      return;
    }
    setSelectedAreaIds((prev) => {
      if (prev.includes(areaId)) {
        return prev;
      }
      const next = [...prev, areaId];
      if (next.length > MAX_SELECTED_AREAS) {
        next.shift();
      }
      return next;
    });
    setFocusAreaId(areaId);
  };

  const handleSummaryAgeClick = (ageBandId: AgeBandId) => {
    setHighlightedAgeBand(ageBandId);
  };

  const handleToggleAreaFromMap = useCallback((area: AreaSelectionMeta) => {
    setSelectedAreaIds((prev) => {
      let next: string[];
      if (prev.includes(area.id)) {
        next = prev.filter((id) => id !== area.id);
        setFocusAreaId((current) =>
          current === area.id ? next[next.length - 1] ?? null : current,
        );
      } else {
        next = [...prev, area.id];
        if (next.length > MAX_SELECTED_AREAS) {
          next = next.slice(next.length - MAX_SELECTED_AREAS);
        }
        setFocusAreaId(area.id);
      }
      return next;
    });
  }, []);

  const isEmpty = filteredMapRecords.length === 0;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
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
              <p className="text-sm font-semibold">地図に表示できるカルテデータがありません。</p>
            </div>
            <p className="mt-4 text-sm">
              まずは「患者分析」ページでカルテ集計CSVを取り込み、保存してください。保存後にこのページを開き直すと、最新情報が反映されます。
            </p>
          </section>
        ) : (
          <section className="space-y-8">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
              <GeoDistributionMap
                reservations={filteredMapRecords}
                periodLabel={mapPeriodLabel}
                selectedAreaIds={selectedAreaIds}
                focusAreaId={focusAreaId}
                onToggleArea={handleToggleAreaFromMap}
              />
            </section>

            <section className="rounded-3xl border border-indigo-200 bg-white/85 p-6 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">期間サマリー</h2>
                  <p className="text-xs text-slate-500">
                    範囲: <span className="font-semibold text-slate-700">{periodRangeDisplay}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span>
                    表示期間: <strong className="font-semibold text-slate-700">{mapPeriodLabel}</strong>
                  </span>
                  <span>
                    データ件数: <strong className="font-semibold text-slate-700">{totalRecords.toLocaleString("ja-JP")}件</strong>
                  </span>
                  {lastUpdated && (
                    <span>
                      最終更新: <strong className="font-semibold text-slate-700">{new Date(lastUpdated).toLocaleString("ja-JP")}</strong>
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-emerald-600">増加した地区 Top3</h3>
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
                              <p className="text-sm font-semibold text-slate-800">{entry.label}</p>
                              {location && (
                                <p className="text-[11px] text-emerald-700">地点: {location}</p>
                              )}
                            </div>
                            <span className="text-xs font-semibold text-emerald-600">
                              {formatDiffValue(entry.diff)}
                            </span>
                          </div>
                          <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                            <div>
                              <dt className="font-semibold text-slate-400">開始</dt>
                              <dd className="text-sm font-semibold text-slate-800">
                                {formatMetricValue(entry.comparison ?? 0)}
                              </dd>
                            </div>
                            <div>
                              <dt className="font-semibold text-slate-400">終了</dt>
                              <dd className="text-sm font-semibold text-slate-800">
                                {formatMetricValue(entry.current)}
                              </dd>
                            </div>
                            <div>
                              <dt className="font-semibold text-slate-400">変化率</dt>
                              <dd className="text-sm font-semibold text-slate-800">
                                {formatRatioValue(entry.ratio)}
                              </dd>
                            </div>
                            <div>
                              <dt className="font-semibold text-slate-400">終了構成比</dt>
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
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-rose-600">減少した地区 Top3</h3>
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
                              <p className="text-sm font-semibold text-slate-800">{entry.label}</p>
                              {location && (
                                <p className="text-[11px] text-rose-600">地点: {location}</p>
                              )}
                            </div>
                            <span className="text-xs font-semibold text-rose-600">
                              {formatDiffValue(entry.diff)}
                            </span>
                          </div>
                          <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                            <div>
                              <dt className="font-semibold text-slate-400">開始</dt>
                              <dd className="text-sm font-semibold text-slate-800">
                                {formatMetricValue(entry.comparison ?? 0)}
                              </dd>
                            </div>
                            <div>
                              <dt className="font-semibold text-slate-400">終了</dt>
                              <dd className="text-sm font-semibold text-slate-800">
                                {formatMetricValue(entry.current)}
                              </dd>
                            </div>
                            <div>
                              <dt className="font-semibold text-slate-400">変化率</dt>
                              <dd className="text-sm font-semibold text-slate-800">
                                {formatRatioValue(entry.ratio)}
                              </dd>
                            </div>
                            <div>
                              <dt className="font-semibold text-slate-400">終了構成比</dt>
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
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-indigo-600">伸びた年代 Top3</h3>
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
                          onClick={() => handleSummaryAgeClick(entry.id as AgeBandId)}
                          className={`w-full rounded-2xl border px-4 py-3 text-left shadow-sm transition ${
                            isActive
                              ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200"
                              : "border-indigo-100 bg-white hover:border-indigo-300 hover:shadow-lg"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-800">{entry.label}</p>
                            <span className="text-xs font-semibold text-indigo-600">
                              {formatDiffValue(entry.diff)}
                            </span>
                          </div>
                          <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                            <div>
                              <dt className="font-semibold text-slate-400">開始</dt>
                              <dd className="text-sm font-semibold text-slate-800">
                                {formatMetricValue(entry.comparison ?? 0)}
                              </dd>
                            </div>
                            <div>
                              <dt className="font-semibold text-slate-400">終了</dt>
                              <dd className="text-sm font-semibold text-slate-800">
                                {formatMetricValue(entry.current)}
                              </dd>
                            </div>
                            <div>
                              <dt className="font-semibold text-slate-400">変化率</dt>
                              <dd className="text-sm font-semibold text-slate-800">
                                {formatRatioValue(entry.ratio)}
                              </dd>
                            </div>
                            <div>
                              <dt className="font-semibold text-slate-400">終了構成比</dt>
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
            </section>

            <section className="space-y-6 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
              <header className="space-y-2">
                <h2 className="text-base font-semibold text-slate-900">患者分析の視点別いんサイト</h2>
                <p className="text-xs text-slate-500">
                  期間の開始と終了で年代構成がどう変化したかを確認できます。
                </p>
              </header>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-inner">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">年代構成の変化</h3>
                    <p className="text-xs text-slate-500">面積が大きいほど存在感が高い年代です。</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(["count", "ratio"] as AgeViewMode[]).map((mode) => {
                      const active = ageViewMode === mode;
                      return (
                        <button
                          key={`age-mode-${mode}`}
                          type="button"
                          onClick={() => setAgeViewMode(mode)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                            active
                              ? "border-violet-500 bg-violet-500 text-white"
                              : "border-slate-200 bg-white text-slate-600 hover:border-violet-400"
                          }`}
                        >
                          {mode === "count" ? "実数" : "比率"}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={ageViewMode === "ratio" ? ageRatioChartData : ageChartData}
                      margin={{ top: 12, right: 24, bottom: 8, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" tickFormatter={formatMonthLabel} stroke="#94a3b8" />
                      <YAxis
                        stroke="#94a3b8"
                        tickFormatter={(value: number) =>
                          ageViewMode === "ratio"
                            ? `${Math.round(value * 100)}%`
                            : value.toLocaleString("ja-JP")
                        }
                      />
                      <RechartsTooltip
                        formatter={(value: number, name) => [
                          ageViewMode === "ratio"
                            ? formatPercent(value)
                            : `${value.toLocaleString("ja-JP")}件`,
                          name,
                        ]}
                        labelFormatter={(label) => formatMonthLabel(String(label))}
                      />
                      <Legend verticalAlign="top" height={24} iconType="circle" />
                      {AGE_BANDS.map((band) => {
                        const highlighted = highlightedAgeBand === null || highlightedAgeBand === band.id;
                        return (
                          <Area
                            key={`age-area-${band.id}`}
                            type="monotone"
                            dataKey={band.id}
                            stackId="1"
                            name={band.label}
                            stroke={AGE_BAND_COLOR_MAP[band.id]}
                            fill={AGE_BAND_COLOR_MAP[band.id]}
                            fillOpacity={highlighted ? 0.7 : 0.2}
                            strokeWidth={highlighted ? 2.5 : 1.5}
                            activeDot={{ r: 3 }}
                          />
                        );
                      })}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-inner">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">年代の構成比（スライダーで月を切り替え）</h3>
                  <span className="text-[11px] text-slate-500">
                    選択月: {filteredMonths[selectedAgeMonthIndex] ? formatMonthLabel(filteredMonths[selectedAgeMonthIndex]!) : "—"}
                  </span>
                </div>
                <div className="mt-3">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(filteredMonths.length - 1, 0)}
                    value={Math.min(selectedAgeMonthIndex, Math.max(filteredMonths.length - 1, 0))}
                    onChange={(event) => setSelectedAgeMonthIndex(Number(event.target.value))}
                    className="w-full"
                  />
                </div>
                <div className="mt-4 space-y-2">
                  {ageSnapshot.map((row) => {
                    const highlighted = highlightedAgeBand === null || highlightedAgeBand === row.id;
                    return (
                      <button
                        key={`age-snapshot-${row.id}`}
                        type="button"
                        onClick={() => handleSummaryAgeClick(row.id as AgeBandId)}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
                          highlighted
                            ? "border-emerald-400 bg-emerald-50"
                            : "border-slate-200 bg-white hover:border-emerald-200"
                        }`}
                      >
                        <span className="w-16 text-xs font-semibold text-slate-700">{row.label}</span>
                        <div className="flex-1">
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(row.share * 100, 5)}%`,
                                backgroundColor: AGE_BAND_COLOR_MAP[row.id],
                              }}
                            />
                          </div>
                        </div>
                        <span className="w-16 text-right text-xs font-semibold text-slate-700">
                          {row.count.toLocaleString("ja-JP")}件
                        </span>
                        <span className="text-[11px] font-semibold text-slate-500">
                          {formatPercent(row.share)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          </section>
        )}
      </div>
    </main>
  );
};

export default MapAnalysisPage;
