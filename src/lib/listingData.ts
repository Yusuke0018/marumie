import Papa from "papaparse";

export type ListingCategory = "内科" | "胃カメラ" | "大腸カメラ" | "発熱外来";

export type ListingData = {
  date: string;
  amount: number;
  cv: number;
  cvr: number;
  cpa: number;
  hourlyCV: number[];
};

export type ListingCategoryData = {
  category: ListingCategory;
  data: ListingData[];
};

export const LISTING_STORAGE_KEY = "clinic-analytics/listing/v1";
export const LISTING_TIMESTAMP_KEY = "clinic-analytics/listing-updated/v1";

const parseNumber = (value: string | undefined): number => {
  if (!value) {
    return 0;
  }
  const trimmed = value.trim().replace(/,/g, "");
  const normalized = trimmed.endsWith("%")
    ? trimmed.slice(0, -1)
    : trimmed;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const parseListingCsv = (content: string): ListingData[] => {
  const parsed = Papa.parse<string[]>(content, {
    skipEmptyLines: true,
  });

  const data: ListingData[] = [];

  for (let index = 1; index < parsed.data.length; index += 1) {
    const row = parsed.data[index];
    if (!row || !row[0]) {
      continue;
    }

    const dateStr = row[0].trim();
    if (!dateStr) {
      continue;
    }

    const amount = parseNumber(row[1]);
    const cv = parseNumber(row[2]);
    const cvr = parseNumber(row[3]);
    const cpa = parseNumber(row[4]);

    const hourlyCV: number[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      hourlyCV.push(parseNumber(row[5 + hour]));
    }

    data.push({
      date: dateStr,
      amount,
      cv,
      cvr,
      cpa,
      hourlyCV,
    });
  }

  return data.filter((item) => item.amount > 0 || item.cv > 0);
};

const cloneCategoryData = (data: ListingCategoryData[]): ListingCategoryData[] =>
  data.map((item) => ({
    category: item.category,
    data: item.data.map((entry) => ({
      ...entry,
      hourlyCV: [...entry.hourlyCV],
    })),
  }));

export const mergeListingData = (
  existing: ListingCategoryData[],
  category: ListingCategory,
  incoming: ListingData[],
): ListingCategoryData[] => {
  const snapshot = cloneCategoryData(existing);
  const dataMap = new Map<ListingCategory, Map<string, ListingData>>();

  for (const item of snapshot) {
    const map = new Map<string, ListingData>();
    item.data.forEach((entry) => {
      map.set(entry.date, entry);
    });
    dataMap.set(item.category, map);
  }

  if (!dataMap.has(category)) {
    dataMap.set(category, new Map<string, ListingData>());
  }

  const target = dataMap.get(category);
  if (target) {
    for (const entry of incoming) {
      target.set(entry.date, entry);
    }
  }

  const merged: ListingCategoryData[] = [];
  for (const [cat, map] of dataMap.entries()) {
    const values = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
    merged.push({
      category: cat,
      data: values,
    });
  }

  merged.sort((a, b) => a.category.localeCompare(b.category));
  return merged;
};

export const loadListingDataFromStorage = (): ListingCategoryData[] => {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(LISTING_STORAGE_KEY);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored) as ListingCategoryData[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch (error) {
    console.error(error);
    return [];
  }
};

export const loadListingTimestamp = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(LISTING_TIMESTAMP_KEY);
  } catch (error) {
    console.error(error);
    return null;
  }
};

export const saveListingDataToStorage = (
  data: ListingCategoryData[],
  timestampOverride?: string,
): string => {
  const timestamp = timestampOverride ?? new Date().toISOString();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LISTING_STORAGE_KEY, JSON.stringify(data));
      window.localStorage.setItem(LISTING_TIMESTAMP_KEY, timestamp);
    } catch (error) {
      console.error(error);
    }
  }
  return timestamp;
};

export const clearListingStorage = () => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(LISTING_STORAGE_KEY);
    window.localStorage.removeItem(LISTING_TIMESTAMP_KEY);
  } catch (error) {
    console.error(error);
  }
};
