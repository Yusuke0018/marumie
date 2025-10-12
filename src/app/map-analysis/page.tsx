"use client";

import { useEffect, useMemo, useState, useCallback, type ChangeEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { RefreshCw, ArrowLeft, MapPin, Target, Plus, X } from "lucide-react";
import { type KarteRecord } from "@/lib/karteAnalytics";
import { getCompressedItem } from "@/lib/storageCompression";
import { KARTE_STORAGE_KEY, KARTE_TIMESTAMP_KEY } from "@/lib/storageKeys";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Cell,
  ReferenceLine,
  LabelList,
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

const MAX_SELECTED_AREAS = 8;

type AreaColor = { fill: string; accent: string };

// エリアごとの淡色パレットとアクセント色
const AREA_COLOR_PALETTE: AreaColor[] = [
  { fill: "#2563eb", accent: "#1d4ed8" }, // blue
  { fill: "#0f766e", accent: "#0b5f59" }, // teal
  { fill: "#b45309", accent: "#92400e" }, // amber
  { fill: "#be123c", accent: "#9f1239" }, // rose
  { fill: "#7c3aed", accent: "#6d28d9" }, // violet
  { fill: "#db2777", accent: "#be185d" }, // pink
  { fill: "#0ea5e9", accent: "#0284c7" }, // sky
  { fill: "#ea580c", accent: "#c2410c" }, // orange
];

const toTransparentColor = (hex: string, alpha: number) => {
  const sanitized = hex.replace("#", "");
  const bigint = parseInt(sanitized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const translucentFill = (hex: string, alpha = 0.4) => toTransparentColor(hex, alpha);
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

  const periodLabel = useMemo(
    () => buildPeriodLabel(availableMonths),
    [availableMonths],
  );

  const sortedMonths = useMemo(
    () => [...availableMonths].sort((a, b) => a.localeCompare(b)),
    [availableMonths],
  );

  type ComparisonRange = { start: string | null; end: string | null };
  const [rangeA, setRangeA] = useState<ComparisonRange>({ start: null, end: null });
  const [rangeB, setRangeB] = useState<ComparisonRange>({ start: null, end: null });
  const [selectedAreaIds, setSelectedAreaIds] = useState<string[]>([]);
  const [hasCustomSelection, setHasCustomSelection] = useState(false);
  const [focusAreaId, setFocusAreaId] = useState<string | null>(null);
  const [pendingAreaId, setPendingAreaId] = useState<string>("");
  const [areaMetadata, setAreaMetadata] = useState<Record<string, AreaSelectionMeta>>({});

  useEffect(() => {
    if (sortedMonths.length === 0) {
      return;
    }
    setRangeA((prev) => {
      if (prev.start && prev.end) {
        return prev;
      }
      const mid = Math.max(0, Math.floor(sortedMonths.length / 2) - 1);
      const start = sortedMonths[0];
      const end = sortedMonths[Math.max(mid, 0)];
      return { start, end };
    });
    setRangeB((prev) => {
      if (prev.start && prev.end) {
        return prev;
      }
      const startIndex = Math.max(sortedMonths.length - 3, 0);
      const start = sortedMonths[startIndex];
      const end = sortedMonths[sortedMonths.length - 1];
      return { start, end };
    });
  }, [sortedMonths]);

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

      records.forEach((record) => {
        const bandId = classifyAgeBandId(record.patientAge);
        ageTotals[bandId] += 1;

        const prefecture = record.patientPrefecture ?? null;
        const city = record.patientCity ?? null;
        const town = record.patientTown ?? record.patientBaseTown ?? null;
        const labelParts = [city, town].filter((part): part is string => Boolean(part));
        const label = labelParts.length > 0 ? labelParts.join("") : city ?? "住所未設定";
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
      });

      return {
        total: records.length,
        areas: areaMap,
        ageTotals,
      };
    };
  }, []);

  const comparisonData = useMemo(() => {
    if (
      (!rangeA.start && !rangeA.end) ||
      (!rangeB.start && !rangeB.end)
    ) {
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

  const topDiffRows = useMemo<ComparisonRow[]>(() => {
    if (!validComparison) {
      return [];
    }
    // 住所未設定や異常な住所を除外
    const validRows = validComparison.rows.filter((row) => {
      const label = row.label.trim();
      // 「住所未設定」を除外
      if (label === "住所未設定" || label === "" || label === "未設定") {
        return false;
      }
      // 明らかにおかしい住所パターンを除外
      // - 単一文字
      // - 数字のみ
      // - 記号のみ
      if (label.length < 2) {
        return false;
      }
      if (/^[\d\-]+$/.test(label)) {
        return false;
      }
      if (/^[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(label)) {
        return false;
      }
      return true;
    });
    return validRows.slice(0, 8);
  }, [validComparison]);

  const defaultAreaIds = useMemo(
    () => topDiffRows.slice(0, MAX_SELECTED_AREAS).map((row) => row.id),
    [topDiffRows],
  );

  useEffect(() => {
    if (hasCustomSelection) {
      return;
    }
    setSelectedAreaIds((prev) => {
      if (
        prev.length === defaultAreaIds.length &&
        prev.every((id, index) => id === defaultAreaIds[index])
      ) {
        return prev;
      }
      return defaultAreaIds;
    });
  }, [defaultAreaIds, hasCustomSelection]);

  const topIncrease = useMemo(() => {
    if (!validComparison) {
      return [];
    }
    // 住所未設定や異常な住所を除外
    const validRows = validComparison.rows.filter((row) => {
      const label = row.label.trim();
      if (label === "住所未設定" || label === "" || label === "未設定") {
        return false;
      }
      if (label.length < 2 || /^[\d\-]+$/.test(label)) {
        return false;
      }
      if (/^[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(label)) {
        return false;
      }
      return row.diffShare > 0;
    });
    return validRows.slice(0, 5);
  }, [validComparison]);

  const topDecrease = useMemo(() => {
    if (!validComparison) {
      return [];
    }
    // 住所未設定や異常な住所を除外
    const validRows = validComparison.rows.filter((row) => {
      const label = row.label.trim();
      if (label === "住所未設定" || label === "" || label === "未設定") {
        return false;
      }
      if (label.length < 2 || /^[\d\-]+$/.test(label)) {
        return false;
      }
      if (/^[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(label)) {
        return false;
      }
      return row.diffShare < 0;
    });
    return validRows.slice(0, 5);
  }, [validComparison]);

  const comparisonBarData = useMemo<
    Array<{ id: string; label: string; periodA: number; periodB: number; diff: number; fill: string; accent: string }>
  >(() => {
    if (!validComparison || topDiffRows.length === 0) {
      return [];
    }
    const palette = AREA_COLOR_PALETTE;
    return topDiffRows.map((row, index) => {
      const { fill, accent } = palette[index % palette.length];
      return {
        id: row.id,
        label: row.label,
        periodA: Number((row.shareA * 100).toFixed(1)),
        periodB: Number((row.shareB * 100).toFixed(1)),
        diff: Number((row.diffShare * 100).toFixed(1)),
        fill,
        accent,
      };
    });
  }, [topDiffRows, validComparison]);

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

  const comparisonShareDomain = useMemo<[number, number]>(() => {
    if (comparisonBarData.length === 0) {
      return [0, 100];
    }
    const maxShare = Math.max(
      ...comparisonBarData.map((row) => Math.max(row.periodA, row.periodB)),
      5,
    );
    return [0, Math.min(100, Math.ceil(maxShare + 1))];
  }, [comparisonBarData]);

  const comparisonDiffDomain = useMemo<[number, number]>(() => {
    if (comparisonBarData.length === 0) {
      return [-10, 10];
    }
    const maxAbs = Math.max(...comparisonBarData.map((row) => Math.abs(row.diff)), 1);
    const padding = Math.ceil(maxAbs + 1);
    return [-padding, padding];
  }, [comparisonBarData]);

  const selectedComparisonData = useMemo(() => {
    if (comparisonBarData.length === 0) {
      return [];
    }
    const dataMap = new Map(comparisonBarData.map((row) => [row.id, row]));
    const sourceIds =
      selectedAreaIds.length > 0 ? selectedAreaIds : defaultAreaIds;
    const orderedUnique = sourceIds.filter(
      (id, index, array) => array.indexOf(id) === index,
    );
    return orderedUnique
      .map((id) => dataMap.get(id))
      .filter((row): row is (typeof comparisonBarData)[number] => Boolean(row));
  }, [comparisonBarData, selectedAreaIds, defaultAreaIds]);

  const areaOptions = useMemo(
    () =>
      comparisonBarData.map((row) => ({
        id: row.id,
        label: row.label,
      })),
    [comparisonBarData],
  );

  const comparisonChartHeight = Math.max(280, selectedComparisonData.length * 68);
  const diffChartHeight = Math.max(240, selectedComparisonData.length * 60);

  const invalidRange = useMemo(() => Boolean(comparisonData?.invalid), [comparisonData]);

  const leadingDiff = useMemo(() => {
    if (!validComparison || validComparison.rows.length === 0) {
      return null;
    }
    return validComparison.rows[0];
  }, [validComparison]);

  const monthOptions = useMemo(
    () => sortedMonths.map((month) => ({ value: month, label: formatMonthLabel(month) })),
    [sortedMonths],
  );

  const handleRangeAChange = (field: keyof ComparisonRange) => (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value || null;
    setRangeA((prev) => ({ ...prev, [field]: value }));
  };

  const handleRangeBChange = (field: keyof ComparisonRange) => (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value || null;
    setRangeB((prev) => ({ ...prev, [field]: value }));
  };

  const handleRegisterAreas = useCallback((areas: AreaSelectionMeta[]) => {
    setAreaMetadata(() => {
      const registry: Record<string, AreaSelectionMeta> = {};
      areas.forEach((area) => {
        registry[area.id] = area;
      });
      return registry;
    });
  }, []);

  const handleAddArea = (areaId: string) => {
    if (!areaId) {
      return;
    }
    const available = comparisonBarData.find((row) => row.id === areaId);
    if (!available) {
      return;
    }
    setHasCustomSelection(true);
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
    setPendingAreaId("");
  };

  const handleRemoveArea = (areaId: string) => {
    setHasCustomSelection(true);
    setSelectedAreaIds((prev) => prev.filter((id) => id !== areaId));
    setFocusAreaId((current) => (current === areaId ? null : current));
  };

  const handleResetAreas = () => {
    setHasCustomSelection(false);
    setSelectedAreaIds(defaultAreaIds);
    setFocusAreaId(null);
    setPendingAreaId("");
  };

  const handleToggleAreaFromMap = useCallback((area: AreaSelectionMeta) => {
    setHasCustomSelection(true);
    setSelectedAreaIds((prev) => {
      if (prev.includes(area.id)) {
        return prev.filter((id) => id !== area.id);
      }
      const next = [...prev, area.id];
      if (next.length > MAX_SELECTED_AREAS) {
        next.shift();
      }
      return next;
    });
    setFocusAreaId(area.id);
  }, []);

  const handleFocusArea = (areaId: string, ensureSelected = false) => {
    if (ensureSelected && !selectedAreaIds.includes(areaId)) {
      handleAddArea(areaId);
    } else {
      setFocusAreaId(areaId);
    }
  };

  const handlePendingAreaChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setPendingAreaId(event.target.value);
  };

  const resolveAreaLocation = (areaId: string): string | null => {
    const meta = areaMetadata[areaId];
    if (!meta) {
      return null;
    }
    const parts = [meta.prefecture, meta.city, meta.town].filter(
      (part): part is string => Boolean(part && part.length > 0),
    );
    if (parts.length === 0) {
      return meta.label;
    }
    return parts.join("");
  };

  const ComparisonTooltipContent = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ name?: string | number; dataKey?: string | number; value?: number }>;
    label?: string | number;
  }) => {
    if (!active || !payload || payload.length === 0) {
      return null;
    }
    const safeLabel = typeof label === "string" ? label : "";
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
        {safeLabel && <p className="mb-1 font-semibold text-slate-700">{safeLabel}</p>}
        {payload.map((entry) => (
          <p key={entry.name ?? entry.dataKey?.toString()} className="text-slate-600">
            {entry.name ?? entry.dataKey}: {typeof entry.value === "number" ? entry.value.toFixed(1) : entry.value}%
          </p>
        ))}
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

  const DiffLabel = ({ x, y, width, height, value }: LabelGeometry) => {
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

  const renderCategoryTick = ({
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
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} fill="#475569" fontSize={10} textAnchor="middle">
          {segments.map((segment, index) => (
            <tspan key={`${payload.value}-${index}`} x={0} dy={index === 0 ? 0 : 12}>
              {segment}
            </tspan>
          ))}
        </text>
      </g>
    );
  };

  const isEmpty = mapRecords.length === 0;

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
          <section className="space-y-6">
            <div className="rounded-3xl border border-indigo-200 bg-white/80 p-6 text-slate-700 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">分析サマリ</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3">
                  <p className="text-xs font-semibold text-indigo-500">
                    期間サマリ
                  </p>
                  <p className="mt-1 text-lg font-bold text-indigo-800">
                    {periodLabel}
                  </p>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3">
                  <p className="text-xs font-semibold text-emerald-500">
                    カルテ件数
                  </p>
                  <p className="mt-1 text-lg font-bold text-emerald-700">
                    {mapRecords.length.toLocaleString("ja-JP")}件
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold text-slate-500">
                    最終更新
                  </p>
                  <p className="mt-1 text-lg font-bold text-slate-700">
                    {lastUpdated
                      ? new Date(lastUpdated).toLocaleDateString("ja-JP")
                      : "不明"}
                  </p>
                </div>
              </div>
            </div>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
              <GeoDistributionMap
                reservations={mapRecords}
                periodLabel={periodLabel}
                selectedAreaIds={selectedAreaIds}
                focusAreaId={focusAreaId}
                onToggleArea={handleToggleAreaFromMap}
                onRegisterAreas={handleRegisterAreas}
              />
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">期間比較モード</h2>
                    <p className="text-xs text-slate-500">
                      期間Aと期間Bを指定して、来院エリア・年代構成の変化を確認できます。
                    </p>
                  </div>
                  <div className="grid w-full gap-4 sm:grid-cols-2 md:w-auto">
                    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                      <p className="text-xs font-semibold text-indigo-500">期間A</p>
                      <div className="mt-2 flex items-center gap-2 text-sm">
                        <select
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                          value={rangeA.start ?? ""}
                          onChange={handleRangeAChange("start")}
                        >
                          <option value="">指定なし</option>
                          {monthOptions.map((option) => (
                            <option key={`a-start-${option.value}`} value={option.value}>
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
                            <option key={`a-end-${option.value}`} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">{rangeDescription.a}</p>
                    </div>
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                      <p className="text-xs font-semibold text-emerald-500">期間B</p>
                      <div className="mt-2 flex items-center gap-2 text-sm">
                        <select
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                          value={rangeB.start ?? ""}
                          onChange={handleRangeBChange("start")}
                        >
                          <option value="">指定なし</option>
                          {monthOptions.map((option) => (
                            <option key={`b-start-${option.value}`} value={option.value}>
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
                            <option key={`b-end-${option.value}`} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">{rangeDescription.b}</p>
                    </div>
                  </div>
                </div>

                {invalidRange ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-700">
                    期間Aまたは期間Bの開始月が終了月より後になっています。範囲を修正してください。
                  </div>
                ) : !validComparison ? (
                  <p className="text-sm text-slate-500">比較する期間を選択してください。</p>
                ) : (
                  <div className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                        <p className="text-xs font-semibold text-indigo-500">期間A 件数</p>
                        <p className="mt-2 text-2xl font-bold text-indigo-700">
                          {validComparison.totalA.toLocaleString("ja-JP")}件
                        </p>
                      </div>
                      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                        <p className="text-xs font-semibold text-emerald-500">期間B 件数</p>
                        <p className="mt-2 text-2xl font-bold text-emerald-700">
                          {validComparison.totalB.toLocaleString("ja-JP")}件
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                        <p className="text-xs font-semibold text-slate-500">最大変化エリア</p>
                        {leadingDiff ? (
                          <div className="mt-2 text-sm text-slate-800">
                            <p className="font-semibold">{leadingDiff.label}</p>
                            <p className="text-xs text-slate-500">
                              期間A {formatPercent(leadingDiff.shareA)} → 期間B {formatPercent(leadingDiff.shareB)}
                            </p>
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">差分のあるエリアがありません。</p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-inner">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-800">比較する地区を選択</h3>
                          <p className="text-[11px] text-slate-500">
                            地図をクリックすると地区を追加・削除できます。最大{MAX_SELECTED_AREAS}件まで表示できます。
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleResetAreas}
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600"
                        >
                          <Target className="h-3.5 w-3.5" />
                          増減が大きい順にリセット
                        </button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedComparisonData.length > 0 ? (
                          selectedComparisonData.map((row) => (
                            <span
                              key={`selection-${row.id}`}
                              className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm"
                              style={{ borderColor: row.fill, backgroundColor: translucentFill(row.fill, 0.25) }}
                            >
                              <span>{row.label}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveArea(row.id)}
                                className="flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-slate-500 transition hover:bg-white hover:text-slate-700"
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
                            <option key={`option-${option.id}`} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleAddArea(pendingAreaId)}
                          disabled={!pendingAreaId || selectedAreaIds.includes(pendingAreaId)}
                          className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-200 disabled:text-slate-500 hover:bg-indigo-600"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          選択に追加
                        </button>
                        <p className="text-[11px] text-slate-500">
                          選択数: {selectedComparisonData.length}/{MAX_SELECTED_AREAS}
                        </p>
                      </div>
                    </div>

                    {selectedComparisonData.length > 0 ? (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-inner">
                          <h3 className="text-sm font-semibold text-slate-800">期間A/Bの来院割合</h3>
                          <p className="text-[11px] text-slate-500">同じ町丁目は同色で表示され、淡色が期間A、濃色が期間Bです。</p>
                          <div className="mt-4" style={{ height: `${comparisonChartHeight}px` }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={selectedComparisonData} margin={{ top: 12, right: 24, bottom: 32, left: 32 }} barCategoryGap="30%" barGap={6}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                <XAxis dataKey="label" interval={0} height={60} tick={renderCategoryTick} />
                                <YAxis domain={comparisonShareDomain} tickFormatter={(value: number) => `${value}%`} stroke="#94a3b8" />
                                <RechartsTooltip content={<ComparisonTooltipContent />} />
                                <Bar dataKey="periodA" name="期間A" radius={[6, 6, 0, 0]}>
                                  {selectedComparisonData.map((row) => (
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
                                    formatter={(value) => `${typeof value === "number" ? value.toFixed(1) : value}%`}
                                    fill="#1e293b"
                                    fontSize={11}
                                  />
                                </Bar>
                                <Bar dataKey="periodB" name="期間B" radius={[6, 6, 0, 0]}>
                                  {selectedComparisonData.map((row) => (
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
                                    formatter={(value) => `${typeof value === "number" ? value.toFixed(1) : value}%`}
                                    fill="#1e293b"
                                    fontSize={11}
                                  />
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-inner">
                          <h3 className="text-sm font-semibold text-slate-800">増減率（期間B - 期間A）</h3>
                          <p className="text-[11px] text-slate-500">正の値は増加、負の値は減少を示します。破線が基準の0%です。</p>
                          <div className="mt-4" style={{ height: `${diffChartHeight}px` }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={selectedComparisonData} margin={{ top: 12, right: 32, bottom: 32, left: 32 }} barCategoryGap="35%" barGap={6}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                <XAxis dataKey="label" interval={0} height={60} tick={renderCategoryTick} />
                                <YAxis domain={comparisonDiffDomain} tickFormatter={(value: number) => `${value}%`} stroke="#94a3b8" />
                                <RechartsTooltip content={<ComparisonTooltipContent />} />
                                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
                                <Bar dataKey="diff" name="増減率" radius={[6, 6, 6, 6]}>
                                  {selectedComparisonData.map((row) => (
                                    <Cell
                                      key={`diff-${row.id}`}
                                      fill={row.diff >= 0 ? solidFill("#16a34a", 0.75) : solidFill("#dc2626", 0.8)}
                                      stroke={row.diff >= 0 ? "#15803d" : "#b91c1c"}
                                      strokeWidth={1.1}
                                    />
                                  ))}
                                  <LabelList content={DiffLabel} />
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

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 shadow-sm">
                        <h3 className="text-sm font-semibold text-emerald-700">増加したエリア</h3>
                        {topIncrease.length > 0 ? (
                          <ul className="mt-3 space-y-2 text-xs text-emerald-700">
                            {topIncrease.map((row) => {
                              const location = resolveAreaLocation(row.id);
                              return (
                                <li key={`inc-${row.id}`} className="flex flex-col gap-1 rounded-xl border border-emerald-100 bg-white/70 p-3 shadow-sm">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold text-emerald-800">{row.label}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleFocusArea(row.id, true)}
                                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                                    >
                                      <MapPin className="h-3 w-3" />
                                      地図で表示
                                    </button>
                                  </div>
                                  {location && (
                                    <span className="text-[11px] text-emerald-600">地点: {location}</span>
                                  )}
                                  <span className="text-[11px]">
                                    {formatPercent(row.shareA)} → {formatPercent(row.shareB)}
                                    <span className="ml-2 font-semibold text-emerald-600">
                                      (+{formatPercent(row.diffShare)})
                                    </span>
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="mt-2 text-xs text-emerald-700">増加したエリアはありません。</p>
                        )}
                      </div>
                      <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4 shadow-sm">
                        <h3 className="text-sm font-semibold text-rose-700">減少したエリア</h3>
                        {topDecrease.length > 0 ? (
                          <ul className="mt-3 space-y-2 text-xs text-rose-700">
                            {topDecrease.map((row) => {
                              const location = resolveAreaLocation(row.id);
                              return (
                                <li key={`dec-${row.id}`} className="flex flex-col gap-1 rounded-xl border border-rose-100 bg-white/70 p-3 shadow-sm">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold text-rose-700">{row.label}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleFocusArea(row.id, true)}
                                      className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-500 px-2 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-rose-600"
                                    >
                                      <MapPin className="h-3 w-3" />
                                      地図で表示
                                    </button>
                                  </div>
                                  {location && (
                                    <span className="text-[11px] text-rose-600">地点: {location}</span>
                                  )}
                                  <span className="text-[11px]">
                                    {formatPercent(row.shareA)} → {formatPercent(row.shareB)}
                                    <span className="ml-2 font-semibold text-rose-600">
                                      ({formatPercent(row.diffShare)})
                                    </span>
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="mt-2 text-xs text-rose-700">減少したエリアはありません。</p>
                        )}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-white p-4">
                      <h3 className="text-sm font-semibold text-slate-800">年代構成の比較</h3>
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-3 py-2 text-left">年代</th>
                              <th className="px-3 py-2 text-right">期間A</th>
                              <th className="px-3 py-2 text-right">期間B</th>
                              <th className="px-3 py-2 text-right">差分</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-slate-700">
                            {ageComparisonRows.map((row) => (
                              <tr key={`age-${row.id}`}>
                                <td className="px-3 py-2 font-medium text-slate-800">{row.label}</td>
                                <td className="px-3 py-2 text-right">
                                  {row.countA.toLocaleString("ja-JP")}
                                  <span className="ml-2 text-[11px] text-slate-500">{formatPercent(row.shareA)}</span>
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {row.countB.toLocaleString("ja-JP")}
                                  <span className="ml-2 text-[11px] text-slate-500">{formatPercent(row.shareB)}</span>
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
              </div>
            </section>
          </section>
        )}
      </div>
    </main>
  );
};

export default MapAnalysisPage;
