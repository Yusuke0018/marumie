import Papa from "papaparse";

export type SurveyFileType = "外来" | "内視鏡";

export type SurveyData = {
  date: string;
  month: string;
  googleSearch: number;
  yahooSearch: number;
  googleMap: number;
  signboard: number;
  medicalReferral: number;
  friendReferral: number;
  flyer: number;
  youtube: number;
  libertyCity: number;
  aiSearch: number;
  feverGoogleSearch: number;
  fileType: SurveyFileType;
};

export const SURVEY_STORAGE_KEY = "clinic-analytics/survey/v1";
export const SURVEY_TIMESTAMP_KEY = "clinic-analytics/survey-updated/v1";

const parseNumber = (value: string | undefined): number => {
  if (!value) {
    return 0;
  }
  const trimmed = value.trim().replace(/,/g, "");
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
};

const removeBom = (value: string): string => value.replace(/^\uFEFF/, "");

const normalizeCsvRow = (row: Record<string, string | undefined>) => {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = removeBom(key).trim();
    normalized[normalizedKey] =
      typeof value === "string" ? value.trim() || undefined : value;
  }
  return normalized;
};

const MONTH_NAME_MAP: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const formatDateParts = (year: number, month: number, day: number) => {
  const monthStr = `${month}`.padStart(2, "0");
  const dayStr = `${day}`.padStart(2, "0");
  return {
    date: `${year}-${monthStr}-${dayStr}`,
    month: `${year}-${monthStr}`,
  };
};

const parseSurveyDate = (raw: string | undefined): { date: string; month: string } | null => {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed === "OFF") {
    return null;
  }

  // Pattern: YYYY/MM/DD
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(trimmed)) {
    const [yearStr, monthStr, dayStr] = trimmed.split("/");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return formatDateParts(year, month, day);
    }
  }

  // Pattern: Mon Sep 01 2025 00:00:00 GMT+0900 (日本標準時)
  const englishMatch = trimmed.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/);
  if (englishMatch) {
    const [, monthName, dayStr, yearStr] = englishMatch;
    const month = MONTH_NAME_MAP[monthName.toLowerCase()];
    const day = Number(dayStr);
    const year = Number(yearStr);
    if (month && Number.isFinite(day) && Number.isFinite(year)) {
      return formatDateParts(year, month, day);
    }
  }

  // Fallback: use Date parser and convert to local date
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = parsed.getMonth() + 1;
    const day = parsed.getDate();
    return formatDateParts(year, month, day);
  }

  return null;
};

export const parseSurveyCsv = (content: string, fileType: SurveyFileType): SurveyData[] => {
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
  });

  const data: SurveyData[] = [];

  for (const rawRow of parsed.data) {
    const row = normalizeCsvRow(rawRow);
    const parsedDate = parseSurveyDate(row["日付"]);
    if (!parsedDate) {
      continue;
    }

    data.push({
      date: parsedDate.date,
      month: parsedDate.month,
      googleSearch: parseNumber(row["ネット検索(Google)"]),
      yahooSearch: parseNumber(row["ネット検索(yahoo)"]),
      googleMap: parseNumber(row["Googleマップ"]),
      signboard: parseNumber(row["看板・外観"]),
      medicalReferral: parseNumber(row["医療機関からの紹介"]),
      friendReferral: parseNumber(row["家族・友人からの紹介"]),
      flyer: parseNumber(row["チラシ"]),
      youtube: parseNumber(row["Youtube"]),
      libertyCity: parseNumber(row["リベシティ"]),
      aiSearch: parseNumber(row["AI検索"]),
      feverGoogleSearch: parseNumber(row["発熱外来(Google)"]),
      fileType,
    });
  }

  return data;
};

export const determineSurveyFileType = (fileName: string): SurveyFileType => {
  return fileName.includes("内視鏡") ? "内視鏡" : "外来";
};

export const mergeSurveyData = (
  existing: SurveyData[],
  incoming: SurveyData[],
): SurveyData[] => {
  const map = new Map<string, SurveyData>();

  for (const item of existing) {
    map.set(`${item.date}|${item.fileType}`, item);
  }

  for (const item of incoming) {
    map.set(`${item.date}|${item.fileType}`, item);
  }

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
};

const normalizeLoadedSurveyItem = (item: Partial<SurveyData>): SurveyData | null => {
  if (!item || typeof item !== "object") {
    return null;
  }
  if (typeof item.date !== "string" || typeof item.month !== "string") {
    return null;
  }
  return {
    date: item.date,
    month: item.month,
    googleSearch: Number.isFinite(item.googleSearch) ? (item.googleSearch as number) : 0,
    yahooSearch: Number.isFinite(item.yahooSearch) ? (item.yahooSearch as number) : 0,
    googleMap: Number.isFinite(item.googleMap) ? (item.googleMap as number) : 0,
    signboard: Number.isFinite(item.signboard) ? (item.signboard as number) : 0,
    medicalReferral: Number.isFinite(item.medicalReferral)
      ? (item.medicalReferral as number)
      : 0,
    friendReferral: Number.isFinite(item.friendReferral) ? (item.friendReferral as number) : 0,
    flyer: Number.isFinite(item.flyer) ? (item.flyer as number) : 0,
    youtube: Number.isFinite(item.youtube) ? (item.youtube as number) : 0,
    libertyCity: Number.isFinite(item.libertyCity) ? (item.libertyCity as number) : 0,
    aiSearch: Number.isFinite(item.aiSearch) ? (item.aiSearch as number) : 0,
    feverGoogleSearch: Number.isFinite(item.feverGoogleSearch)
      ? (item.feverGoogleSearch as number)
      : 0,
    fileType: item.fileType === "内視鏡" ? "内視鏡" : "外来",
  };
};

export const loadSurveyDataFromStorage = (): SurveyData[] => {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(SURVEY_STORAGE_KEY);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored) as Array<Partial<SurveyData>>;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => normalizeLoadedSurveyItem(item))
      .filter((item): item is SurveyData => item !== null);
  } catch (error) {
    console.error(error);
    return [];
  }
};

export const loadSurveyTimestamp = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(SURVEY_TIMESTAMP_KEY);
  } catch (error) {
    console.error(error);
    return null;
  }
};

export const saveSurveyDataToStorage = (
  data: SurveyData[],
  timestampOverride?: string,
): string => {
  const timestamp = timestampOverride ?? new Date().toISOString();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SURVEY_STORAGE_KEY, JSON.stringify(data));
      window.localStorage.setItem(SURVEY_TIMESTAMP_KEY, timestamp);
    } catch (error) {
      console.error(error);
    }
  }
  return timestamp;
};

export const clearSurveyStorage = () => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(SURVEY_STORAGE_KEY);
    window.localStorage.removeItem(SURVEY_TIMESTAMP_KEY);
  } catch (error) {
    console.error(error);
  }
};
