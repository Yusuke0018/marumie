import Papa from "papaparse";

export type DiagnosisDepartment = "総合診療" | "発熱外来" | "オンライン診療（保険）";

export const DIAGNOSIS_TARGET_DEPARTMENTS: DiagnosisDepartment[] = [
  "総合診療",
  "発熱外来",
  "オンライン診療（保険）",
];

export type DiagnosisCategory = "生活習慣病" | "外科" | "皮膚科" | "その他";

export const DIAGNOSIS_CATEGORIES: DiagnosisCategory[] = [
  "生活習慣病",
  "外科",
  "皮膚科",
];

export type DiagnosisRecord = {
  id: string;
  patientNumber: string | null;
  patientNameNormalized: string | null;
  birthDateIso: string | null;
  diseaseName: string;
  startDate: string;
  monthKey: string;
  department: DiagnosisDepartment;
  category: DiagnosisCategory;
};

export type DiagnosisMonthlySummary = {
  month: string;
  totals: Record<DiagnosisDepartment, number>;
};

export type DiagnosisCategoryMonthlySummary = {
  month: string;
  totals: Record<DiagnosisCategory, number>;
};

export type DiagnosisDiseaseSummary = {
  department: DiagnosisDepartment;
  category: DiagnosisCategory;
  diseaseName: string;
  total: number;
};

export const DIAGNOSIS_STORAGE_KEY = "clinic-analytics/diagnosis/v1";
export const DIAGNOSIS_TIMESTAMP_KEY = "clinic-analytics/diagnosis-updated/v1";

const removeBom = (value: string) => value.replace(/^\uFEFF/, "");

const normalizeHeader = (header: string) => removeBom(header).trim();

const parseDate = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/年|月/g, "/").replace(/日/g, "");
  const separators = normalized.includes("-") ? "-" : "/";
  const parts = normalized.split(separators);
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

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
};

const toMonthKey = (isoDate: string) => isoDate.slice(0, 7);

const normalizeDepartment = (value: string | undefined): DiagnosisDepartment | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const base = trimmed
    .replace(/\s+/g, "")
    .replace(/科$/, "")
    .replace(/[()（）]/g, (match) => {
      if (match === "(" || match === "（") {
        return "（";
      }
      if (match === ")" || match === "）") {
        return "）";
      }
      return match;
    });

  if (base.includes("総合診療")) {
    return "総合診療";
  }
  if (base.includes("発熱外来")) {
    return "発熱外来";
  }
  if (base.includes("オンライン診療") && base.includes("保険")) {
    return "オンライン診療（保険）";
  }

  return null;
};

const normalizePatientName = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }
  const normalized = value
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeDiseaseName = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizePatientNumber = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }
  const digits = value.replace(/[^\d]/g, "");
  return digits.length > 0 ? digits : null;
};

const LIFESTYLE_KEYWORDS = [
  "高血圧",
  "血圧",
  "脂質異常",
  "高脂血症",
  "高コレステロール",
  "糖尿病",
  "糖代謝",
  "耐糖能",
  "メタボ",
  "肥満",
  "高トリグリセリド",
  "痛風",
  "高尿酸血症",
];

const SURGICAL_KEYWORDS = [
  "外傷",
  "創",
  "創傷",
  "切創",
  "切り傷",
  "裂傷",
  "挫創",
  "挫傷",
  "挫滅",
  "挫滅創",
  "挫滅傷",
  "擦過傷",
  "刺創",
  "刺し傷",
  "穿刺",
  "穿通創",
  "咬傷",
  "打撲",
  "打撲傷",
  "骨折",
  "脱臼",
  "腱断裂",
  "断裂",
  "熱傷",
  "火傷",
  "凍傷",
  "損傷",
];

const DERMATOLOGY_KEYWORDS = [
  "湿疹",
  "皮膚",
  "皮脂",
  "蕁麻疹",
  "アトピー",
  "皮膚炎",
  "帯状疱疹",
  "白癬",
  "水虫",
  "にきび",
  "ニキビ",
  "粉瘤",
  "疣贅",
  "いぼ",
  "ケロイド",
  "脂漏",
  "膿",
  "皮膚症",
  "乾癬",
  "脂漏性皮膚炎",
  "掌蹠膿疱症",
  "尋常性疣贅",
  "角化症",
  "汗疱",
  "皮膚潰瘍",
  "褥瘡",
  "皮膚感染",
  "皮膚真菌症",
  "皮膚膿瘍",
  "毛包炎",
  "日光皮膚炎",
  "伝染性軟属腫",
  "多汗症",
  "皮膚乾燥",
  "カンジダ症",
];

const normalizeForMatch = (value: string) =>
  value
    .replace(/\s+/g, "")
    .toLowerCase();

const includesKeyword = (value: string, keywords: string[]) => {
  const normalized = normalizeForMatch(value);
  return keywords.some((keyword) => normalized.includes(keyword.replace(/\s+/g, "").toLowerCase()));
};

const categorizeDiseaseName = (diseaseName: string): DiagnosisCategory => {
  if (includesKeyword(diseaseName, LIFESTYLE_KEYWORDS)) {
    return "生活習慣病";
  }
  if (includesKeyword(diseaseName, SURGICAL_KEYWORDS)) {
    return "外科";
  }
  if (includesKeyword(diseaseName, DERMATOLOGY_KEYWORDS)) {
    return "皮膚科";
  }
  return "その他";
};

export const parseDiagnosisCsv = (content: string): DiagnosisRecord[] => {
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message ?? "CSV parsing error");
  }

  const map = new Map<string, DiagnosisRecord>();

  for (const row of parsed.data) {
    const mainFlag = (row["主病"] ?? "").trim();
    if (mainFlag !== "主病") {
      continue;
    }

    const department = normalizeDepartment(row["診療科"]);
    if (!department) {
      continue;
    }

    const startDate = parseDate(row["開始日"]);
    if (!startDate) {
      continue;
    }

    const diseaseName = normalizeDiseaseName(row["傷病名"]);
    if (!diseaseName) {
      continue;
    }
    const category = categorizeDiseaseName(diseaseName);

    const patientNumber = normalizePatientNumber(row["患者番号"]);
    const patientNameNormalized = normalizePatientName(
      row["患者氏名"] ?? row["患者名"] ?? row["患者"] ?? row["氏名"],
    );
    const birthDateIso = parseDate(row["患者生年月日"]);
    const monthKey = toMonthKey(startDate);
    const id = [
      department,
      monthKey,
      diseaseName,
      startDate,
      patientNumber ?? "",
    ].join("|");

    map.set(id, {
      id,
      patientNumber,
      patientNameNormalized,
      birthDateIso,
      diseaseName,
      startDate,
      monthKey,
      department,
      category,
    });
  }

  return Array.from(map.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));
};

export const mergeDiagnosisRecords = (
  existing: DiagnosisRecord[],
  incoming: DiagnosisRecord[],
): DiagnosisRecord[] => {
  const map = new Map<string, DiagnosisRecord>();
  for (const record of existing) {
    map.set(record.id, record);
  }
  for (const record of incoming) {
    map.set(record.id, record);
  }
  return Array.from(map.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));
};

export const loadDiagnosisFromStorage = (): DiagnosisRecord[] => {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(DIAGNOSIS_STORAGE_KEY);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored) as DiagnosisRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(error);
    return [];
  }
};

export const loadDiagnosisTimestamp = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(DIAGNOSIS_TIMESTAMP_KEY);
  } catch (error) {
    console.error(error);
    return null;
  }
};

export const saveDiagnosisToStorage = (
  data: DiagnosisRecord[],
  timestampOverride?: string,
): string => {
  const timestamp = timestampOverride ?? new Date().toISOString();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(DIAGNOSIS_STORAGE_KEY, JSON.stringify(data));
      window.localStorage.setItem(DIAGNOSIS_TIMESTAMP_KEY, timestamp);
    } catch (error) {
      console.error(error);
    }
  }
  return timestamp;
};

export const clearDiagnosisStorage = () => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(DIAGNOSIS_STORAGE_KEY);
    window.localStorage.removeItem(DIAGNOSIS_TIMESTAMP_KEY);
  } catch (error) {
    console.error(error);
  }
};

const createEmptyTotals = () =>
  DIAGNOSIS_TARGET_DEPARTMENTS.reduce(
    (acc, department) => {
      acc[department] = 0;
      return acc;
    },
    {} as Record<DiagnosisDepartment, number>,
  );

const createEmptyDiagnosisCategoryTotals = () =>
  DIAGNOSIS_CATEGORIES.reduce(
    (acc, category) => {
      acc[category] = 0;
      return acc;
    },
    {} as Record<DiagnosisCategory, number>,
  );

export const aggregateDiagnosisMonthly = (
  records: DiagnosisRecord[],
): DiagnosisMonthlySummary[] => {
  if (records.length === 0) {
    return [];
  }

  const map = new Map<string, Record<DiagnosisDepartment, number>>();
  for (const record of records) {
    if (!map.has(record.monthKey)) {
      map.set(record.monthKey, createEmptyTotals());
    }
    const bucket = map.get(record.monthKey)!;
    bucket[record.department] += 1;
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, totals]) => ({
      month,
      totals,
    }));
};

export const aggregateDiagnosisCategoryMonthly = (
  records: DiagnosisRecord[],
): DiagnosisCategoryMonthlySummary[] => {
  if (records.length === 0) {
    return [];
  }

  const map = new Map<string, Record<DiagnosisCategory, number>>();
  for (const record of records) {
    if (!map.has(record.monthKey)) {
      map.set(record.monthKey, createEmptyDiagnosisCategoryTotals());
    }
    const bucket = map.get(record.monthKey)!;
    bucket[record.category] += 1;
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, totals]) => ({
      month,
      totals,
    }));
};

export const summarizeDiagnosisByDisease = (
  records: DiagnosisRecord[],
): DiagnosisDiseaseSummary[] => {
  if (records.length === 0) {
    return [];
  }

  const map = new Map<string, DiagnosisDiseaseSummary>();
  for (const record of records) {
    const key = `${record.department}|${record.diseaseName}`;
    const existing = map.get(key);
    if (existing) {
      existing.total += 1;
    } else {
      map.set(key, {
        department: record.department,
        category: record.category,
        diseaseName: record.diseaseName,
        total: 1,
      });
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => b.total - a.total || a.diseaseName.localeCompare(b.diseaseName, "ja"),
  );
};

export const filterDiagnosisByMonthRange = (
  records: DiagnosisRecord[],
  startMonth?: string,
  endMonth?: string,
): DiagnosisRecord[] => {
  if (!startMonth && !endMonth) {
    return records;
  }
  return records.filter((record) => {
    if (startMonth && record.monthKey < startMonth) {
      return false;
    }
    if (endMonth && record.monthKey > endMonth) {
      return false;
    }
    return true;
  });
};

export const extractDiagnosisMonths = (records: DiagnosisRecord[]): string[] => {
  const set = new Set<string>();
  for (const record of records) {
    set.add(record.monthKey);
  }
  return Array.from(set).sort();
};

const parseMonthKey = (monthKey: string) => {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return null;
  }
  return { year, month };
};

const toMonthKeyFromParts = (parts: { year: number; month: number }) => {
  const { year, month } = parts;
  return `${year}-${String(month).padStart(2, "0")}`;
};

export const shiftMonth = (monthKey: string, offset: number): string | null => {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) {
    return null;
  }
  const total = parsed.year * 12 + (parsed.month - 1) + offset;
  if (total < 0) {
    return null;
  }
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return toMonthKeyFromParts({ year, month });
};

export const calculatePreviousRange = (
  startMonth: string,
  endMonth: string,
): { start: string; end: string } | null => {
  const start = parseMonthKey(startMonth);
  const end = parseMonthKey(endMonth);
  if (!start || !end) {
    return null;
  }

  const span =
    end.year * 12 + (end.month - 1) - (start.year * 12 + (start.month - 1));
  if (span < 0) {
    return null;
  }

  const previousEnd = shiftMonth(startMonth, -1);
  if (!previousEnd) {
    return null;
  }
  const previousStart = shiftMonth(startMonth, -(span + 1));
  if (!previousStart) {
    return null;
  }

  return { start: previousStart, end: previousEnd };
};
