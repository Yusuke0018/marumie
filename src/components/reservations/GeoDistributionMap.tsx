"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

type GeoDistributionMapProps = {
  reservations: MapVisualizationRecord[];
  periodLabel: string;
};

type MapVisualizationRecord = {
  department: string;
  reservationMonth: string;
  patientAge: number | null;
  patientPrefecture?: string | null;
  patientCity?: string | null;
  patientTown?: string | null;
  patientBaseTown?: string | null;
  patientAddress: string | null;
};

type TownCoordinate = {
  prefecture: string;
  city: string;
  town: string;
  latitude: number;
  longitude: number;
};

const DEFAULT_CENTER: LatLngExpression = [34.676, 135.497];

const AGE_BANDS = [
  { id: "0-19", label: "0〜19歳", min: 0, max: 19 },
  { id: "20-39", label: "20〜39歳", min: 20, max: 39 },
  { id: "40-59", label: "40〜59歳", min: 40, max: 59 },
  { id: "60-79", label: "60〜79歳", min: 60, max: 79 },
  { id: "80+", label: "80歳以上", min: 80, max: null },
  { id: "unknown", label: "年齢不明", min: null, max: null },
] as const;

type AgeBand = (typeof AGE_BANDS)[number];
type AgeBandId = AgeBand["id"];

const AGE_BAND_COLOR_MAP: Record<AgeBandId, string> = {
  "0-19": "#38bdf8",
  "20-39": "#34d399",
  "40-59": "#f59e0b",
  "60-79": "#ef4444",
  "80+": "#a855f7",
  unknown: "#94a3b8",
};

const COLOR_MODES = [
  { value: "age", label: "年代別カラー" },
  { value: "count", label: "件数ヒートマップ" },
] as const;

type ColorMode = (typeof COLOR_MODES)[number]["value"];

const KANJI_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;
const DASH_REGEX = /[－―ーｰ‐]/g;
const FULL_WIDTH_DIGITS = /[０-９]/g;

const ALL_DEPARTMENT = "__all_department__";
const ALL_PERIOD = "__all_period__";
const ALL_AGE_BAND = "all" as const;

type AgeFilterValue = AgeBandId | typeof ALL_AGE_BAND;

const COUNT_COLOR_START = { r: 219, g: 234, b: 254 }; // #dbebfe
const COUNT_COLOR_END = { r: 30, g: 64, b: 175 }; // #1e40af

const lerp = (start: number, end: number, t: number) => start + (end - start) * t;

const toHexComponent = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");

const interpolateCountColor = (value: number, maxValue: number): string => {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(maxValue) || maxValue <= 0) {
    return "#bfdbfe";
  }
  const clamped = Math.max(0, Math.min(1, value / maxValue));
  const r = lerp(COUNT_COLOR_START.r, COUNT_COLOR_END.r, clamped);
  const g = lerp(COUNT_COLOR_START.g, COUNT_COLOR_END.g, clamped);
  const b = lerp(COUNT_COLOR_START.b, COUNT_COLOR_END.b, clamped);
  return `#${toHexComponent(r)}${toHexComponent(g)}${toHexComponent(b)}`;
};

type DerivedSegments = {
  prefecture: string | null;
  city: string;
  town: string | null;
  baseTown: string | null;
  locationLabel: string;
  locationKey: string | null;
  baseLocationKey: string | null;
};

type LocationAggregation = DerivedSegments & {
  id: string;
  total: number;
  ageBreakdown: Record<AgeBandId, number>;
  departmentBreakdown: Map<string, number>;
};

type MapPoint = LocationAggregation & {
  latitude: number;
  longitude: number;
  matchedTownName: string;
  dominantAgeBandId: AgeBandId;
  radius: number;
};

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

const standardizeTownLabel = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  let normalized = value.trim();
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

const makeLocationKey = (
  prefecture: string | null,
  city: string | null,
  town: string | null,
): string | null => {
  if (!city) {
    return null;
  }
  const prefPart = (prefecture ?? "").replace(/\s+/g, "");
  const cityPart = city.replace(/\s+/g, "");
  const townPart = (town ?? "").replace(/\s+/g, "");
  return `${prefPart}|${cityPart}|${townPart}`;
};

const guessPrefectureFromAddress = (address: string | null | undefined): string | null => {
  if (!address) {
    return null;
  }
  if (address.includes("大阪府")) {
    return "大阪府";
  }
  return null;
};

const guessCityFromAddress = (address: string | null | undefined): string | null => {
  if (!address) {
    return null;
  }
  const normalized = address.replace(/\s+/g, "");
  const match = normalized.match(/大阪市[\p{Script=Han}]+区/u);
  if (match && match[0]) {
    return match[0];
  }
  return normalized.includes("大阪市") ? "大阪市" : null;
};

const guessTownFromAddress = (
  address: string | null | undefined,
  prefecture: string | null,
  city: string | null,
): { town: string | null; baseTown: string | null } => {
  if (!address) {
    return { town: null, baseTown: null };
  }
  let working = address.replace(/\s+/g, "");
  if (prefecture) {
    working = working.replace(prefecture, "");
  }
  if (city) {
    working = working.replace(city, "");
  }
  working = working.replace(/大阪府/g, "").replace(/大阪市/g, "");

  const normalizedTown = standardizeTownLabel(working);
  if (normalizedTown) {
    return {
      town: normalizedTown,
      baseTown: removeChomeSuffix(normalizedTown),
    };
  }

  const baseCandidate = working.replace(/[0-9０-９].*$/, "");
  if (baseCandidate.length === 0) {
    return { town: null, baseTown: null };
  }
  const baseNormalized = standardizeTownLabel(baseCandidate);
  return {
    town: baseNormalized,
    baseTown: baseNormalized ? removeChomeSuffix(baseNormalized) : null,
  };
};

const deriveSegments = (reservation: MapVisualizationRecord): DerivedSegments | null => {
  const address = reservation.patientAddress ?? null;

  let city = reservation.patientCity?.replace(/\s+/g, "") ?? null;
  if (!city) {
    city = guessCityFromAddress(address);
  }
  if (!city) {
    return null;
  }

  let prefecture =
    reservation.patientPrefecture?.replace(/\s+/g, "") ??
    guessPrefectureFromAddress(address);
  if (!prefecture && city.startsWith("大阪市")) {
    prefecture = "大阪府";
  }

  const explicitTown = standardizeTownLabel(reservation.patientTown ?? null);
  let town = explicitTown;
  let baseTown =
    explicitTown
      ? removeChomeSuffix(explicitTown)
      : standardizeTownLabel(reservation.patientBaseTown ?? null);
  if (town === null && reservation.patientBaseTown) {
    town = standardizeTownLabel(reservation.patientBaseTown);
  }

  if (!town) {
    const guessed = guessTownFromAddress(address, prefecture, city);
    town = guessed.town;
    baseTown = guessed.baseTown ?? baseTown;
  }

  if (!town && baseTown) {
    town = baseTown;
  }

  if (!town && !baseTown) {
    return {
      prefecture,
      city,
      town: null,
      baseTown: null,
      locationLabel: city,
      locationKey: makeLocationKey(prefecture, city, null),
      baseLocationKey: makeLocationKey(prefecture, city, null),
    };
  }

  const labelParts = [city, town ?? baseTown].filter(
    (part): part is string => Boolean(part && part.length > 0),
  );
  const locationLabel =
    labelParts.length > 0 ? labelParts.join("") : city;

  const locationKey = makeLocationKey(prefecture, city, town);
  const baseLocationKey = baseTown ? makeLocationKey(prefecture, city, baseTown) : null;

  return {
    prefecture,
    city,
    town,
    baseTown,
    locationLabel,
    locationKey,
    baseLocationKey,
  };
};

const classifyAgeBand = (age: number | null | undefined): AgeBand => {
  if (age === null || age === undefined || Number.isNaN(age) || age < 0 || age > 120) {
    return AGE_BANDS[AGE_BANDS.length - 1];
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
      return band;
    }
  }
  return AGE_BANDS[AGE_BANDS.length - 1];
};

const createAgeBreakdown = (): Record<AgeBandId, number> =>
  AGE_BANDS.reduce(
    (accumulator, band) => {
      accumulator[band.id] = 0;
      return accumulator;
    },
    {} as Record<AgeBandId, number>,
  );

const computeRadius = (count: number): number => {
  if (count <= 1) {
    return 6;
  }
  if (count <= 3) {
    return 7;
  }
  if (count <= 5) {
    return 9;
  }
  if (count <= 10) {
    return 11;
  }
  if (count <= 20) {
    return 14;
  }
  return Math.min(26, 8 + Math.sqrt(count) * 2.5);
};

const formatMonthLabel = (value: string): string => {
  const [yearRaw, monthRaw] = value.split("-");
  const year = Number.parseInt(yearRaw ?? "", 10);
  const month = Number.parseInt(monthRaw ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return value;
  }
  return `${year}年${month}月`;
};

const formatTopDepartments = (point: LocationAggregation): string => {
  const sorted = Array.from(point.departmentBreakdown.entries()).sort(
    (a, b) => b[1] - a[1],
  );
  if (sorted.length === 0) {
    return "データなし";
  }
  return sorted
    .slice(0, 3)
    .map(([department, count]) => `${department}(${count})`)
    .join(" / ");
};

export const GeoDistributionMap = ({
  reservations,
  periodLabel,
}: GeoDistributionMapProps) => {
  const departmentOptions = useMemo(() => {
    const unique = new Set<string>();
    reservations.forEach((reservation) => {
      if (reservation.department) {
        unique.add(reservation.department);
      }
    });
    const sorted = Array.from(unique).sort((a, b) => a.localeCompare(b, "ja"));
    return [
      { value: ALL_DEPARTMENT, label: "すべての診療科" },
      ...sorted.map((department) => ({ value: department, label: department })),
    ];
  }, [reservations]);

  const periodOptions = useMemo(() => {
    const unique = new Set<string>();
    reservations.forEach((reservation) => {
      if (reservation.reservationMonth) {
        unique.add(reservation.reservationMonth);
      }
    });
    const sorted = Array.from(unique).sort();
    return [
      { value: ALL_PERIOD, label: "全期間" },
      ...sorted.map((month) => ({ value: month, label: formatMonthLabel(month) })),
    ];
  }, [reservations]);

  const ageFilterOptions = useMemo(
    () => [
      { value: ALL_AGE_BAND, label: "全ての年代" },
      ...AGE_BANDS.map((band) => ({ value: band.id, label: band.label })),
    ],
    [],
  );

  const [selectedDepartment, setSelectedDepartment] =
    useState<string>(ALL_DEPARTMENT);
  const [selectedPeriod, setSelectedPeriod] = useState<string>(ALL_PERIOD);
  const [selectedAgeBand, setSelectedAgeBand] =
    useState<AgeFilterValue>(ALL_AGE_BAND);
  const [colorMode, setColorMode] = useState<ColorMode>("age");

  useEffect(() => {
    if (!departmentOptions.some((option) => option.value === selectedDepartment)) {
      setSelectedDepartment(ALL_DEPARTMENT);
    }
  }, [departmentOptions, selectedDepartment]);

  useEffect(() => {
    if (!periodOptions.some((option) => option.value === selectedPeriod)) {
      setSelectedPeriod(ALL_PERIOD);
    }
  }, [periodOptions, selectedPeriod]);

  const enrichedRecords = useMemo(() => {
    return reservations.map((reservation) => ({
      reservation,
      ageBand: classifyAgeBand(
        typeof reservation.patientAge === "number" ? reservation.patientAge : null,
      ),
    }));
  }, [reservations]);

  const filteredRecords = useMemo(() => {
    return enrichedRecords.filter(({ reservation, ageBand }) => {
      if (
        selectedPeriod !== ALL_PERIOD &&
        reservation.reservationMonth !== selectedPeriod
      ) {
        return false;
      }
      if (
        selectedDepartment !== ALL_DEPARTMENT &&
        reservation.department !== selectedDepartment
      ) {
        return false;
      }
      if (selectedAgeBand !== ALL_AGE_BAND && ageBand.id !== selectedAgeBand) {
        return false;
      }
      return true;
    });
  }, [enrichedRecords, selectedDepartment, selectedPeriod, selectedAgeBand]);

  const { groupedLocations, missingLocationCount } = useMemo(() => {
    const map = new Map<string, LocationAggregation>();
    let missing = 0;
    for (const item of filteredRecords) {
      const segments = deriveSegments(item.reservation);
      if (!segments || !segments.city) {
        missing += 1;
        continue;
      }
      if (!segments.town && !segments.baseTown) {
        missing += 1;
        continue;
      }
      const key =
        segments.locationKey ??
        `${segments.city}|${segments.baseTown ?? "unknown"}`;
      let entry = map.get(key);
      if (!entry) {
        entry = {
          ...segments,
          id: key,
          total: 0,
          ageBreakdown: createAgeBreakdown(),
          departmentBreakdown: new Map<string, number>(),
        };
        map.set(key, entry);
      }
      entry.total += 1;
      entry.ageBreakdown[item.ageBand.id] += 1;
      entry.departmentBreakdown.set(
        item.reservation.department,
        (entry.departmentBreakdown.get(item.reservation.department) ?? 0) + 1,
      );
    }
    return {
      groupedLocations: Array.from(map.values()),
      missingLocationCount: missing,
    };
  }, [filteredRecords]);

  const [townMaster, setTownMaster] = useState<TownCoordinate[] | null>(null);
  const [geoLoading, setGeoLoading] = useState<boolean>(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setGeoLoading(true);
    fetch("/data/osaka_towns.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch town master: ${response.status}`);
        }
        return response.json() as Promise<TownCoordinate[]>;
      })
      .then((data) => {
        if (!isMounted) {
          return;
        }
        setTownMaster(data);
        setGeoError(null);
      })
      .catch((error) => {
        console.error(error);
        if (isMounted) {
          setGeoError("大阪市の住所マスタを読み込めませんでした。");
        }
      })
      .finally(() => {
        if (isMounted) {
          setGeoLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const coordinateIndex = useMemo(() => {
    if (!townMaster) {
      return null;
    }
    const byExact = new Map<string, { lat: number; lng: number; town: string }>();
    const baseAggregates = new Map<
      string,
      { lat: number; lng: number; count: number; town: string }
    >();

    for (const item of townMaster) {
      const normalizedTown =
        standardizeTownLabel(item.town) ?? item.town.replace(/\s+/g, "");
      const prefecture = item.prefecture.replace(/\s+/g, "");
      const city = item.city.replace(/\s+/g, "");

      const exactKey = makeLocationKey(prefecture, city, normalizedTown);
      if (exactKey) {
        byExact.set(exactKey, {
          lat: item.latitude,
          lng: item.longitude,
          town: normalizedTown,
        });
      }

      const baseTown = removeChomeSuffix(normalizedTown);
      if (baseTown) {
        const baseKey = makeLocationKey(prefecture, city, baseTown);
        if (baseKey) {
          const current = baseAggregates.get(baseKey);
          if (current) {
            current.lat += item.latitude;
            current.lng += item.longitude;
            current.count += 1;
          } else {
            baseAggregates.set(baseKey, {
              lat: item.latitude,
              lng: item.longitude,
              count: 1,
              town: baseTown,
            });
          }
        }
      }
    }

    const byBase = new Map<string, { lat: number; lng: number; town: string }>();
    for (const [key, value] of baseAggregates) {
      byBase.set(key, {
        lat: value.lat / value.count,
        lng: value.lng / value.count,
        town: value.town,
      });
    }

    return { byExact, byBase };
  }, [townMaster]);

  const { mappedPoints, unmatchedCount } = useMemo(() => {
    if (!coordinateIndex) {
      return { mappedPoints: [] as MapPoint[], unmatchedCount: 0 };
    }
    let unmatchedTotals = 0;
    const result: MapPoint[] = [];

    for (const group of groupedLocations) {
      const candidateKeys = [
        group.locationKey,
        group.baseLocationKey,
        makeLocationKey(group.prefecture, group.city, group.town),
        makeLocationKey(group.prefecture, group.city, group.baseTown),
        makeLocationKey(null, group.city, group.town),
        makeLocationKey(null, group.city, group.baseTown),
      ].filter((value): value is string => Boolean(value && value.length > 0));

      let coordinate: { lat: number; lng: number; town: string } | undefined;
      for (const key of candidateKeys) {
        const exact = coordinateIndex.byExact.get(key);
        if (exact) {
          coordinate = exact;
          break;
        }
      }
      if (!coordinate) {
        for (const key of candidateKeys) {
          const base = coordinateIndex.byBase.get(key);
          if (base) {
            coordinate = base;
            break;
          }
        }
      }
      if (!coordinate) {
        unmatchedTotals += group.total;
        continue;
      }

      let dominantAgeBandId: AgeBandId = "unknown";
      if (selectedAgeBand !== ALL_AGE_BAND) {
        dominantAgeBandId =
          selectedAgeBand === "unknown"
            ? "unknown"
            : (selectedAgeBand as AgeBandId);
      } else {
        let bestId: AgeBandId = "unknown";
        let bestValue = -1;
        for (const band of AGE_BANDS) {
          const current = group.ageBreakdown[band.id] ?? 0;
          if (band.id === "unknown") {
            if (bestValue < 0 && current > 0) {
              bestId = band.id;
              bestValue = current;
            }
            continue;
          }
          if (current > bestValue) {
            bestId = band.id;
            bestValue = current;
          }
        }
        dominantAgeBandId = bestValue > 0 ? bestId : "unknown";
      }

      result.push({
        ...group,
        latitude: coordinate.lat,
        longitude: coordinate.lng,
        matchedTownName: coordinate.town,
        dominantAgeBandId,
        radius: computeRadius(group.total),
      });
    }

    return { mappedPoints: result, unmatchedCount: unmatchedTotals };
  }, [coordinateIndex, groupedLocations, selectedAgeBand]);

  const maxPointTotal = useMemo(
    () => mappedPoints.reduce((max, point) => (point.total > max ? point.total : max), 0),
    [mappedPoints],
  );

  const totalFiltered = filteredRecords.length;
  const mappedTotal = mappedPoints.reduce((sum, point) => sum + point.total, 0);
  const unresolvedTotal = missingLocationCount + unmatchedCount;
  const coverageRate =
    totalFiltered > 0
      ? Math.round((mappedTotal / totalFiltered) * 1000) / 10
      : 0;

  const selectedDepartmentLabel =
    departmentOptions.find((option) => option.value === selectedDepartment)
      ?.label ?? "すべての診療科";
  const selectedMonthLabel =
    periodOptions.find((option) => option.value === selectedPeriod)?.label ??
    "全期間";
  const selectedAgeLabel =
    ageFilterOptions.find((option) => option.value === selectedAgeBand)?.label ??
    "全ての年代";

  const ageSummary = useMemo(() => {
    const totals = createAgeBreakdown();
    filteredRecords.forEach(({ ageBand }) => {
      totals[ageBand.id] = (totals[ageBand.id] ?? 0) + 1;
    });
    const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
    const rows = AGE_BANDS.map((band) => {
      const count = totals[band.id] ?? 0;
      const share = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
      return { id: band.id, label: band.label, total: count, share };
    });
    return { totals, total, rows };
  }, [filteredRecords]);
  const topLocations = useMemo(() => {
    return [...mappedPoints]
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [mappedPoints]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
        <label className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            診療科
          </span>
          <select
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            value={selectedDepartment}
            onChange={(event) => setSelectedDepartment(event.target.value)}
          >
            {departmentOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            年代
          </span>
          <select
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            value={selectedAgeBand}
            onChange={(event) =>
              setSelectedAgeBand(event.target.value as AgeFilterValue)
            }
          >
            {ageFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            集計月
          </span>
          <select
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            value={selectedPeriod}
            onChange={(event) => setSelectedPeriod(event.target.value)}
          >
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            表示モード
          </span>
          <select
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            value={colorMode}
            onChange={(event) => setColorMode(event.target.value as ColorMode)}
          >
            {COLOR_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)]">
        <div className="relative h-[520px] w-full overflow-hidden rounded-3xl border border-slate-200 shadow-inner">
          <MapContainer
            center={DEFAULT_CENTER}
            zoom={12}
            scrollWheelZoom
            style={{ height: "100%", width: "100%" }}
            attributionControl={false}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors'
            />
            {mappedPoints.map((point) => {
              const ageColor =
                selectedAgeBand === ALL_AGE_BAND
                  ? AGE_BAND_COLOR_MAP[point.dominantAgeBandId]
                  : AGE_BAND_COLOR_MAP[
                      selectedAgeBand === "unknown"
                        ? "unknown"
                        : (selectedAgeBand as AgeBandId)
                    ];
              const markerColor =
                colorMode === "age"
                  ? ageColor
                  : interpolateCountColor(point.total, maxPointTotal || point.total);
              const fillOpacity = colorMode === "age" ? 0.45 : 0.65;

              const ageDetails = AGE_BANDS.filter(
                (band) => point.ageBreakdown[band.id] > 0,
              )
                .map(
                  (band) =>
                    `${band.label} ${point.ageBreakdown[band.id].toLocaleString("ja-JP")}件`,
                )
                .join(" / ");

              return (
                <CircleMarker
                  key={point.id}
                  center={[point.latitude, point.longitude]}
                  radius={point.radius}
                  pathOptions={{
                    color: markerColor,
                    weight: 1.5,
                    fillOpacity,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -point.radius]} opacity={1}>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-900">
                        {point.locationLabel}
                      </p>
                      <p className="text-xs text-slate-600">
                        件数: {point.total.toLocaleString("ja-JP")}件
                      </p>
                      <p className="text-xs text-slate-600">
                        主要年代:
                        {" "}
                        {AGE_BANDS.find((band) => band.id === point.dominantAgeBandId)
                          ?.label ?? "不明"}
                      </p>
                      {ageDetails.length > 0 && (
                        <p className="text-[11px] leading-4 text-slate-500">
                          年代内訳: {ageDetails}
                        </p>
                      )}
                      <p className="text-xs text-slate-600">
                        上位診療科: {formatTopDepartments(point)}
                      </p>
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>
          {geoLoading && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/60 text-sm font-medium text-slate-600">
              地図データを読み込み中です...
            </div>
          )}
          {geoError && !geoLoading && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/80 text-sm font-medium text-rose-600">
              {geoError}
            </div>
          )}
          {!geoLoading && mappedPoints.length === 0 && !geoError && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-slate-500">
              表示対象のデータがありません。
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white/80 p-4 text-sm text-slate-700 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                期間
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {periodLabel}（{selectedMonthLabel}）
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                診療科
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {selectedDepartmentLabel}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                年代
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {selectedAgeLabel}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/80 px-4 py-3">
              <p className="text-xs font-semibold text-indigo-500">分析対象</p>
              <p className="mt-1 text-lg font-bold text-indigo-800">
                {totalFiltered.toLocaleString("ja-JP")}件
              </p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 px-4 py-3">
              <p className="text-xs font-semibold text-emerald-500">マッピング</p>
              <p className="mt-1 text-lg font-bold text-emerald-700">
                {mappedTotal.toLocaleString("ja-JP")}件
              </p>
              <p className="text-[11px] text-emerald-600">
                カバレッジ {coverageRate.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-xl border border-rose-100 bg-rose-50/80 px-4 py-3">
              <p className="text-xs font-semibold text-rose-500">住所未確定</p>
              <p className="mt-1 text-lg font-bold text-rose-700">
                {unresolvedTotal.toLocaleString("ja-JP")}件
              </p>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              年代内訳
            </p>
            {ageSummary.total > 0 ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {ageSummary.rows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                  >
                    <span className="flex items-center gap-2 font-semibold text-slate-800">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: AGE_BAND_COLOR_MAP[row.id] }}
                      />
                      {row.label}
                    </span>
                    <span className="text-xs text-slate-600">
                      {row.total.toLocaleString("ja-JP")}件
                      {row.total > 0 && (
                        <span className="ml-1 text-[11px] text-slate-500">
                          ({row.share.toFixed(1)}%)
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">年代情報がありません。</p>
            )}
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {colorMode === "age" ? "年代レジェンド" : "件数レジェンド"}
            </p>
            {colorMode === "age" ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {AGE_BANDS.filter((band) => band.id !== "unknown").map((band) => (
                  <span
                    key={band.id}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-[12px]"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: AGE_BAND_COLOR_MAP[band.id] }}
                    />
                    {band.label}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-[12px]">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: AGE_BAND_COLOR_MAP.unknown }}
                  />
                  年齢不明
                </span>
              </div>
            ) : (
              <>
                <div className="mt-2 h-3 w-full rounded-full bg-gradient-to-r from-[#dbeafe] via-[#60a5fa] to-[#1d4ed8]" />
                <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                  <span>件数少</span>
                  <span>件数多</span>
                </div>
              </>
            )}
            <p className="mt-1 text-[11px] text-slate-500">
              {colorMode === "age"
                ? "丸の色は主要な年代を示し、サイズは件数に比例します。"
                : "丸の色と濃さが件数の多さを示し、サイズは件数に比例します。"}
            </p>
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              件数上位エリア
            </p>
            {topLocations.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {topLocations.map((point, index) => (
                  <li
                    key={point.id}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-semibold text-slate-800">
                        {index + 1}. {point.locationLabel}
                      </span>
                      <span className="font-semibold text-slate-700">
                        {point.total.toLocaleString("ja-JP")}件
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                      {AGE_BANDS.filter((band) => point.ageBreakdown[band.id] > 0).map(
                        (band) => (
                          <span key={band.id} className="inline-flex items-center gap-1">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: AGE_BAND_COLOR_MAP[band.id] }}
                            />
                            {band.label}
                            {" "}
                            {point.ageBreakdown[band.id].toLocaleString("ja-JP")}件
                          </span>
                        ),
                      )}
                      {Object.values(point.ageBreakdown).every((value) => value === 0) && (
                        <span>年代情報なし</span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      上位診療科: {formatTopDepartments(point)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                地図に表示できるデータがありません。
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
