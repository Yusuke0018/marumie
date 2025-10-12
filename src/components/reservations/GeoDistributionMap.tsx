"use client";

import { useEffect, useMemo, useRef, useState, memo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, Marker } from "react-leaflet";
import { divIcon, type LatLngExpression, type Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

type GeoDistributionMapProps = {
  reservations: MapVisualizationRecord[];
  periodLabel: string;
  selectedAreaIds?: string[];
  onToggleArea?: (area: AreaSelectionPayload) => void;
  onRegisterAreas?: (areas: AreaSelectionPayload[]) => void;
  focusAreaId?: string | null;
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

type MunicipalityCoordinate = {
  prefecture: string;
  city: string;
  latitude: number;
  longitude: number;
};

type MunicipalityMatcher = {
  prefecture: string;
  city: string;
  pattern: string;
  cityOnly: string;
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

const normalizeDepartmentLabel = (value: string) =>
  value
    .replace(/[（）()●★・\s]/g, "")
    .replace(/[‐―ーｰ-]/g, "-")
    .trim();

const DEPARTMENT_PRIORITY_KEYWORDS = [
  "総合診療",
  "内科外科外来",
  "内科外来",
  "発熱",
  "予防接種",
  "ワクチン",
  "胃カメラ",
  "大腸カメラ",
  "内視鏡",
  "人間ドック",
  "健康診断",
  "オンライン診療",
];

const getDepartmentPriority = (name: string): number => {
  const normalized = normalizeDepartmentLabel(name);
  for (let index = 0; index < DEPARTMENT_PRIORITY_KEYWORDS.length; index += 1) {
    const keyword = normalizeDepartmentLabel(DEPARTMENT_PRIORITY_KEYWORDS[index] ?? "");
    if (!keyword) {
      continue;
    }
    if (normalized.includes(keyword) || keyword.includes(normalized)) {
      return index;
    }
  }
  return DEPARTMENT_PRIORITY_KEYWORDS.length;
};

const CLINIC_LOCATION: { lat: number; lng: number } = {
  lat: 34.67518,
  lng: 135.4927610269883,
};

const CLINIC_NAME = "リベ大総合クリニック大阪院";
const CLINIC_ADDRESS = "大阪府大阪市西区北堀江2丁目1-11 久我ビルヂング 北館";

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

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const normalized = hex.replace(/^#/, "");
  if (normalized.length !== 6) {
    return null;
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((component) => Number.isNaN(component))) {
    return null;
  }
  return { r, g, b };
};

const lightenColor = (hex: string, amount: number): string => {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return hex;
  }
  const clamped = Math.max(0, Math.min(1, amount));
  const blend = (component: number) => Math.round(component + (255 - component) * clamped);
  return `#${toHexComponent(blend(rgb.r))}${toHexComponent(blend(rgb.g))}${toHexComponent(blend(rgb.b))}`;
};

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

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
  matchLevel: "town" | "city";
  dominantAgeBandId: AgeBandId;
  radius: number;
};

type AreaSelectionPayload = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  city: string | null;
  town: string | null;
  prefecture: string | null;
};

type PieSegment = {
  id: AgeBandId;
  label: string;
  color: string;
  share: number;
  start: number;
  end: number;
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

const makeMunicipalityKey = (
  prefecture: string | null,
  city: string | null,
): string => {
  const prefPart = (prefecture ?? "").replace(/\s+/g, "");
  const cityPart = (city ?? "").replace(/\s+/g, "");
  return `${prefPart}|${cityPart}`;
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

const deriveSegments = (
  reservation: MapVisualizationRecord,
  municipalityMatchers: MunicipalityMatcher[],
  municipalityIndex: {
    byPrefCity: Map<string, MunicipalityCoordinate>;
    byCity: Map<string, MunicipalityCoordinate>;
  },
): DerivedSegments | null => {
  const address = reservation.patientAddress ?? null;

  let prefecture =
    reservation.patientPrefecture?.replace(/\s+/g, "") ??
    guessPrefectureFromAddress(address);
  let city = reservation.patientCity?.replace(/\s+/g, "") ?? null;
  let town = standardizeTownLabel(reservation.patientTown ?? null);
  let baseTown = reservation.patientBaseTown
    ? standardizeTownLabel(reservation.patientBaseTown)
    : null;
  if (town && !baseTown) {
    baseTown = removeChomeSuffix(town);
  }

  let normalizedAddress: string | null = null;
  if (address) {
    normalizedAddress = toHalfWidthDigits(address.replace(/\s+/g, ""));
  }

  if ((!prefecture || !city) && normalizedAddress) {
    for (const matcher of municipalityMatchers) {
      if (normalizedAddress.startsWith(matcher.pattern)) {
        prefecture = matcher.prefecture;
        city = matcher.city;
        normalizedAddress = normalizedAddress.slice(matcher.pattern.length);
        break;
      }
      if (normalizedAddress.startsWith(matcher.cityOnly)) {
        prefecture = matcher.prefecture;
        city = matcher.city;
        normalizedAddress = normalizedAddress.slice(matcher.cityOnly.length);
        break;
      }
    }
  }

  if (!city && normalizedAddress) {
    city = guessCityFromAddress(normalizedAddress);
  }
  if (!city) {
    return null;
  }

  if (!prefecture) {
    const candidate = municipalityIndex.byCity.get(city);
    if (candidate) {
      prefecture = candidate.prefecture.replace(/\s+/g, "");
    } else if (city.startsWith("大阪市")) {
      prefecture = "大阪府";
    }
  }

  let remaining = normalizedAddress;
  if (remaining) {
    if (prefecture && remaining.startsWith(prefecture)) {
      remaining = remaining.slice(prefecture.length);
    }
    if (city && remaining.startsWith(city)) {
      remaining = remaining.slice(city.length);
    }
  }

  if (!town && remaining) {
    const guessedTown = standardizeTownLabel(remaining);
    if (guessedTown) {
      town = guessedTown;
      baseTown = removeChomeSuffix(guessedTown);
    }
  }

  if (!town && baseTown) {
    town = baseTown;
  }

  if (!town && !baseTown) {
    const locationKey = makeLocationKey(prefecture, city, null);
    return {
      prefecture,
      city,
      town: null,
      baseTown: null,
      locationLabel: city,
      locationKey,
      baseLocationKey: locationKey,
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

const computeRadius = (count: number, zoom: number): number => {
  if (count <= 0) {
    return 5;
  }

  const baseZoom = 12;
  const zoomDelta = zoom - baseZoom;

  // 拡大時はズームレベル差1あたり約1.8倍まで拡大（ズーム14付近で約2.4倍）
  // 縮小時はズームレベル差1あたり約0.3倍まで縮小（ズーム10で約3分の1以下）
  const zoomFactor =
    zoomDelta >= 0
      ? 1 + zoomDelta * 0.8
      : 1 / (1 + Math.abs(zoomDelta) * 2.4);

  const scaled = Math.sqrt(count);
  const baseRadius = 5 + scaled * 10;
  const adjustedRadius = baseRadius * zoomFactor;

  return Math.min(80, Math.max(3.5, adjustedRadius));
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

const buildAgePie = (
  ageBreakdown: Record<AgeBandId, number>,
): { gradient: string; segments: PieSegment[]; total: number } | null => {
  const totals = AGE_BANDS.map((band) => ({
    band,
    value: ageBreakdown[band.id] ?? 0,
  })).filter((entry) => entry.value > 0 && entry.band.id !== "unknown");
  const unknown = ageBreakdown.unknown ?? 0;
  const total = totals.reduce((sum, entry) => sum + entry.value, 0) + unknown;
  if (total === 0) {
    return null;
  }

  const segments: PieSegment[] = [];
  let cursor = 0;
  const pushSegment = (id: AgeBandId, label: string, color: string, value: number) => {
    if (value <= 0) {
      return;
    }
    const share = value / total;
    const start = cursor * 360;
    cursor += share;
    const end = cursor * 360;
    segments.push({
      id,
      label,
      color,
      share,
      start,
      end,
    });
  };

  totals.forEach((entry) => {
    pushSegment(
      entry.band.id,
      entry.band.label,
      AGE_BAND_COLOR_MAP[entry.band.id],
      entry.value,
    );
  });
  pushSegment("unknown", "年齢不明", AGE_BAND_COLOR_MAP.unknown, unknown);

  if (segments.length === 0) {
    return null;
  }

  const gradient = `conic-gradient(${segments
    .map((segment) => {
      const start = segment.start.toFixed(2);
      const end = segment.end.toFixed(2);
      return `${segment.color} ${start}deg ${end}deg`;
    })
    .join(", ")})`;

  return { gradient, segments, total };
};


const GeoDistributionMapComponent = ({
  reservations,
  periodLabel,
  selectedAreaIds,
  onToggleArea,
  onRegisterAreas,
  focusAreaId,
}: GeoDistributionMapProps) => {
  const departmentOptions = useMemo(() => {
    const unique = new Set<string>();
    reservations.forEach((reservation) => {
      if (reservation.department) {
        unique.add(reservation.department);
      }
    });
    const sorted = Array.from(unique).sort((a, b) => {
      const priorityA = getDepartmentPriority(a);
      const priorityB = getDepartmentPriority(b);
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      return a.localeCompare(b, "ja");
    });
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
  const [currentZoom, setCurrentZoom] = useState<number>(12);

  const mapRef = useRef<LeafletMap | null>(null);
  const departmentInitializedRef = useRef(false);

  const latestMonth = useMemo(() => {
    const months = reservations
      .map((reservation) => reservation.reservationMonth)
      .filter((value): value is string => Boolean(value));
    if (months.length === 0) {
      return null;
    }
    return months.sort((a, b) => b.localeCompare(a))[0] ?? null;
  }, [reservations]);

  const clinicIcon = useMemo(
    () =>
      divIcon({
        className: "clinic-marker",
        html: `
          <div style="width:24px;height:24px;border-radius:9999px;background:#ef4444;color:#fff;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 18px rgba(239,68,68,0.45);border:2px solid #ffffff;">
            +
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 24],
      }),
    [],
  );

  const [townMaster, setTownMaster] = useState<TownCoordinate[] | null>(null);
  const [municipalities, setMunicipalities] = useState<MunicipalityCoordinate[] | null>(null);
  const [geoLoading, setGeoLoading] = useState<boolean>(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    if (!departmentOptions.some((option) => option.value === selectedDepartment)) {
      setSelectedDepartment(ALL_DEPARTMENT);
    }
  }, [departmentOptions, selectedDepartment]);

  useEffect(() => {
    if (departmentInitializedRef.current) {
      return;
    }
    const preferred = departmentOptions.find((option) => {
      if (option.value === ALL_DEPARTMENT) {
        return false;
      }
      return normalizeDepartmentLabel(option.value).includes(normalizeDepartmentLabel("総合診療"));
    });
    if (preferred) {
      setSelectedDepartment(preferred.value);
      departmentInitializedRef.current = true;
    } else {
      const fallback = departmentOptions.find((option) => option.value !== ALL_DEPARTMENT);
      if (fallback) {
        setSelectedDepartment(fallback.value);
        departmentInitializedRef.current = true;
      }
    }
  }, [departmentOptions]);

  useEffect(() => {
    if (!periodOptions.some((option) => option.value === selectedPeriod)) {
      if (latestMonth) {
        setSelectedPeriod(latestMonth);
      } else {
        setSelectedPeriod(ALL_PERIOD);
      }
    }
  }, [periodOptions, selectedPeriod, latestMonth]);

  useEffect(() => {
    if (latestMonth && (selectedPeriod === ALL_PERIOD || selectedPeriod === "")) {
      setSelectedPeriod(latestMonth);
    }
  }, [latestMonth, selectedPeriod]);

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

  const municipalityIndex = useMemo(() => {
    if (!municipalities) {
      return {
        byPrefCity: new Map<string, MunicipalityCoordinate>(),
        byCity: new Map<string, MunicipalityCoordinate>(),
      };
    }
    const byPrefCity = new Map<string, MunicipalityCoordinate>();
    const byCity = new Map<string, MunicipalityCoordinate>();
    municipalities.forEach((item) => {
      const key = makeMunicipalityKey(item.prefecture, item.city);
      byPrefCity.set(key, item);
      const cityKey = item.city.replace(/\s+/g, "");
      if (!byCity.has(cityKey)) {
        byCity.set(cityKey, item);
      }
    });
    return { byPrefCity, byCity };
  }, [municipalities]);

  const municipalityMatchers = useMemo<MunicipalityMatcher[]>(() => {
    if (!municipalities) {
      return [];
    }
    return municipalities
      .map((item) => {
        const pref = item.prefecture.replace(/\s+/g, "");
        const city = item.city.replace(/\s+/g, "");
        return {
          prefecture: pref,
          city,
          pattern: `${pref}${city}`,
          cityOnly: city,
        };
      })
      .sort((a, b) => b.pattern.length - a.pattern.length);
  }, [municipalities]);

  const { groupedLocations, missingLocationCount } = useMemo(() => {
    const map = new Map<string, LocationAggregation>();
    let missing = 0;
    for (const item of filteredRecords) {
      const segments = deriveSegments(
        item.reservation,
        municipalityMatchers,
        municipalityIndex,
      );
      if (!segments || !segments.city) {
        missing += 1;
        continue;
      }
      const key =
        segments.locationKey ??
        makeLocationKey(segments.prefecture, segments.city, segments.baseTown) ??
        `${segments.city}|city`;
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
  }, [filteredRecords, municipalityIndex, municipalityMatchers]);

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
          setGeoError("住所マスタを読み込めませんでした。");
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

  useEffect(() => {
    let active = true;
    fetch("/data/municipalities.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch municipalities: ${response.status}`);
        }
        return response.json() as Promise<MunicipalityCoordinate[]>;
      })
      .then((data) => {
        if (!active) {
          return;
        }
        setMunicipalities(data);
      })
      .catch((error) => {
        console.error(error);
      });
    return () => {
      active = false;
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
    let unmatchedTotals = 0;
    const result: MapPoint[] = [];

    for (const group of groupedLocations) {
      let coordinate: { lat: number; lng: number; town: string } | undefined;
      let matchLevel: "town" | "city" = "town";

      if (coordinateIndex && group.prefecture === "大阪府") {
        const candidateKeys = [
          group.locationKey,
          group.baseLocationKey,
          makeLocationKey(group.prefecture, group.city, group.town),
          makeLocationKey(group.prefecture, group.city, group.baseTown),
          makeLocationKey(null, group.city, group.town),
          makeLocationKey(null, group.city, group.baseTown),
        ].filter((value): value is string => Boolean(value && value.length > 0));

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
      }

      if (!coordinate && group.city) {
        const prefKey = makeMunicipalityKey(group.prefecture, group.city);
        const municipality =
          municipalityIndex.byPrefCity.get(prefKey) ??
          municipalityIndex.byCity.get(group.city.replace(/\s+/g, ""));
        if (municipality) {
          coordinate = {
            lat: municipality.latitude,
            lng: municipality.longitude,
            town: municipality.city,
          };
          matchLevel = "city";
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
        matchLevel,
        dominantAgeBandId,
        radius: computeRadius(group.total, currentZoom),
      });
    }

    return { mappedPoints: result, unmatchedCount: unmatchedTotals };
  }, [coordinateIndex, groupedLocations, municipalityIndex, selectedAgeBand, currentZoom]);


  useEffect(() => {
    if (!onRegisterAreas) {
      return;
    }
    onRegisterAreas(
      mappedPoints.map((point) => ({
        id: point.id,
        label: point.locationLabel,
        latitude: point.latitude,
        longitude: point.longitude,
        city: point.city,
        town: point.town,
        prefecture: point.prefecture,
      })),
    );
  }, [mappedPoints, onRegisterAreas]);

  useEffect(() => {
    if (!focusAreaId || !mapRef.current) {
      return;
    }
    const target = mappedPoints.find((point) => point.id === focusAreaId);
    if (!target) {
      return;
    }
    const map = mapRef.current;
    const nextZoom = Math.max(map.getZoom(), 14);
    map.flyTo([target.latitude, target.longitude], nextZoom, { duration: 0.6 });
  }, [focusAreaId, mappedPoints]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }
    const map = mapRef.current;
    
    const handleZoomEnd = () => {
      setCurrentZoom(map.getZoom());
    };
    
    map.on('zoomend', handleZoomEnd);
    setCurrentZoom(map.getZoom());
    
    return () => {
      map.off('zoomend', handleZoomEnd);
    };
  }, []);

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
            ref={mapRef}
            style={{ height: "100%", width: "100%" }}
            attributionControl={false}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors'
            />
            <Marker position={[CLINIC_LOCATION.lat, CLINIC_LOCATION.lng]} icon={clinicIcon}>
              <Tooltip direction="top" offset={[0, -12]} opacity={1}>
                <div className="space-y-1 text-xs">
                  <p className="font-semibold text-rose-600">{CLINIC_NAME}</p>
                  <p className="text-[11px] text-slate-600">{CLINIC_ADDRESS}</p>
                </div>
              </Tooltip>
            </Marker>
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
              const baseStrokeColor = markerColor;
              const baseFillColor = lightenColor(markerColor, 0.35);
              const baseFillOpacity = colorMode === "age" ? 0.55 : 0.7;
              const isSelected = selectedAreaIds?.includes(point.id) ?? false;
              const isFocused = focusAreaId === point.id;
              const markerStrokeColor = isFocused ? "#0f172a" : baseStrokeColor;
              const adjustedFillColor = isSelected ? lightenColor(markerColor, 0.15) : baseFillColor;
              const adjustedFillOpacity = isSelected ? Math.min(0.95, baseFillOpacity + 0.2) : baseFillOpacity;
              const markerRadius = point.radius + (isFocused ? 6 : isSelected ? 2 : 0);
              const pie = buildAgePie(point.ageBreakdown);

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
                  radius={markerRadius}
                  pathOptions={{
                    color: markerStrokeColor,
                    weight: isFocused ? 4.2 : isSelected ? 3.2 : 2.5,
                    fillColor: adjustedFillColor,
                    fillOpacity: adjustedFillOpacity,
                    lineCap: "round",
                    lineJoin: "round",
                    className: onToggleArea ? "cursor-pointer" : undefined,
                  }}
                  eventHandlers={
                    onToggleArea
                      ? {
                          click: () =>
                            onToggleArea({
                              id: point.id,
                              label: point.locationLabel,
                              latitude: point.latitude,
                              longitude: point.longitude,
                              city: point.city,
                              town: point.town,
                              prefecture: point.prefecture,
                            }),
                        }
                      : undefined
                  }
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
                      {pie && (
                        <div className="mt-2 flex items-center gap-3">
                          <div
                            className="relative flex h-16 w-16 items-center justify-center rounded-full border border-white/80 shadow-lg"
                            style={{ background: pie.gradient }}
                          >
                            <span className="rounded-full bg-white/85 px-2 py-[2px] text-[11px] font-semibold text-slate-700 shadow">
                              {point.total.toLocaleString("ja-JP")}
                            </span>
                          </div>
                          <div className="space-y-[2px] text-[11px] text-slate-600">
                            {pie.segments.map((segment) => (
                              <div key={`${point.id}-${segment.id}`} className="flex items-center gap-2">
                                <span
                                  className="inline-flex h-2.5 w-2.5 rounded-full"
                                  style={{ backgroundColor: segment.color }}
                                />
                                <span>{segment.label}</span>
                                <span className="ml-auto font-semibold text-slate-700">
                                  {formatPercent(segment.share)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <p className="text-xs text-slate-600">
                        上位診療科: {formatTopDepartments(point)}
                      </p>
                      {point.matchLevel === "city" && (
                        <p className="text-[11px] text-slate-500">
                          市区町村の代表点でプロットしています。
                        </p>
                      )}
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
                        {point.matchLevel === "city" && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-[2px] text-[10px] font-semibold text-slate-600">
                            市区町村代表点
                          </span>
                        )}
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

export const GeoDistributionMap = memo(GeoDistributionMapComponent);
