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

export const parseSurveyCsv = (content: string, fileType: SurveyFileType): SurveyData[] => {
  const parsed = Papa.parse<string[]>(content, {
    skipEmptyLines: true,
  });

  const data: SurveyData[] = [];

  for (let index = 2; index < parsed.data.length; index += 1) {
    const row = parsed.data[index];
    if (!row || !row[0]) {
      continue;
    }

    const dateStr = row[0].trim();
    if (!dateStr || dateStr === "OFF") {
      continue;
    }

    const dateParts = dateStr.split("/");
    if (dateParts.length < 3) {
      continue;
    }

    const month = `${dateParts[0]}/${dateParts[1]}`;

    data.push({
      date: dateStr,
      month,
      googleSearch: parseNumber(row[1]),
      yahooSearch: parseNumber(row[2]),
      googleMap: parseNumber(row[3]),
      signboard: parseNumber(row[4]),
      medicalReferral: parseNumber(row[5]),
      friendReferral: parseNumber(row[6]),
      flyer: parseNumber(row[7]),
      youtube: parseNumber(row[8]),
      libertyCity: parseNumber(row[9]),
      aiSearch: parseNumber(row[10]),
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

export const loadSurveyDataFromStorage = (): SurveyData[] => {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(SURVEY_STORAGE_KEY);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored) as SurveyData[];
    return Array.isArray(parsed) ? parsed : [];
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

export const saveSurveyDataToStorage = (data: SurveyData[]): string => {
  const timestamp = new Date().toISOString();
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
