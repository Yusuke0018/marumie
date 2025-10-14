import Papa from "papaparse";

export type VisitType = "初診" | "再診" | "未設定";

const normalizePatientName = (value: string | undefined): {
  raw: string | null;
  normalized: string | null;
} => {
  if (!value) {
    return { raw: null, normalized: null };
  }
  const raw = value.trim();
  if (raw.length === 0) {
    return { raw: null, normalized: null };
  }
  const upper = raw.toUpperCase();
  if (upper === "#REF!" || upper === "N/A" || upper === "NA" || upper === "なし") {
    return { raw: null, normalized: null };
  }
  const normalized = raw
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    raw,
    normalized: normalized.length > 0 ? normalized : null,
  };
};

export type Reservation = {
  key: string;
  department: string;
  visitType: VisitType;
  reservationDate: string;
  reservationMonth: string;
  reservationHour: number;
  receivedAtIso: string;
  appointmentIso: string | null;
  patientId: string;
  patientName?: string | null;
  patientNameNormalized?: string | null;
  patientAge?: number | null;
  patientPrefecture?: string | null;
  patientCity?: string | null;
  patientTown?: string | null;
  patientAddress?: string | null;
  isSameDay: boolean;
};

type ParsedDateTime = {
  iso: string;
  dateKey: string;
  monthKey: string;
  hour: number;
};

export const RESERVATION_STORAGE_KEY = "clinic-analytics/reservations/v1";
export const RESERVATION_TIMESTAMP_KEY = "clinic-analytics/last-updated/v1";
export const RESERVATION_DIFF_STORAGE_KEY =
  "clinic-analytics/reservations-diff/v1";

const createReservationKey = (payload: {
  department: string;
  visitType: VisitType;
  receivedIso: string;
  patientId: string;
  appointmentIso: string | null;
}) =>
  [
    payload.department,
    payload.visitType,
    payload.receivedIso,
    payload.patientId,
    payload.appointmentIso ?? "",
  ].join("|");

const normalizeDepartment = (name: string) =>
  name
    .replace(/[（）()●]/g, "")
    .replace(/\s+/g, "")
    .trim();

const FULL_WIDTH_DIGITS = /[０-９]/g;

const toHalfWidthDigits = (value: string): string =>
  value.replace(FULL_WIDTH_DIGITS, (digit) =>
    String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
  );

const parseOptionalInteger = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const normalized = toHalfWidthDigits(value.trim());
  if (normalized.length === 0) {
    return null;
  }
  const match = normalized.match(/-?\d+/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[0] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBirthDate = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = toHalfWidthDigits(value.trim());
  if (trimmed.length === 0) {
    return null;
  }
  const normalized = trimmed
    .replace(/[年月]/g, "-")
    .replace(/日/g, "")
    .replace(/[^\d-]/g, "-");
  const parts = normalized
    .split(/[-/]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length < 3) {
    return null;
  }

  const year = Number.parseInt(parts[0] ?? "", 10);
  const month = Number.parseInt(parts[1] ?? "", 10);
  const day = Number.parseInt(parts[2] ?? "", 10);

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

  const iso = `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return iso;
};

const calculateAgeFromBirth = (
  birthIso: string,
  referenceIso: string,
): number | null => {
  const birthDate = new Date(birthIso);
  const referenceDate = new Date(referenceIso);
  if (Number.isNaN(birthDate.getTime()) || Number.isNaN(referenceDate.getTime())) {
    return null;
  }

  let age = referenceDate.getFullYear() - birthDate.getFullYear();
  const referenceMonth = referenceDate.getMonth();
  const birthMonth = birthDate.getMonth();

  if (
    referenceMonth < birthMonth ||
    (referenceMonth === birthMonth && referenceDate.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }

  return age >= 0 && age < 130 ? age : null;
};

const pickFirstNonEmpty = (
  source: Record<string, string>,
  keys: string[],
): string | null => {
  for (const key of keys) {
    const raw = source[key];
    if (typeof raw !== "string") {
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
};

export const normalizeVisitType = (value: string | undefined): VisitType => {
  if (!value) {
    return "未設定";
  }
  const trimmed = value.trim();
  if (trimmed === "初診" || trimmed === "再診") {
    return trimmed;
  }
  return "未設定";
};

const isValidDateKey = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return false;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const isValidMonthKey = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const month = Number(match[2]);
  return !Number.isNaN(month) && month >= 1 && month <= 12;
};

const isValidReservationRecord = (record: unknown): record is Reservation => {
  if (!record || typeof record !== "object") {
    return false;
  }

  const item = record as Reservation;

  if (
    typeof item.department !== "string" ||
    typeof item.visitType !== "string" ||
    typeof item.receivedAtIso !== "string" ||
    typeof item.reservationDate !== "string" ||
    typeof item.reservationMonth !== "string" ||
    typeof item.patientId !== "string" ||
    typeof item.isSameDay !== "boolean"
  ) {
    return false;
  }

  if (!isValidDateKey(item.reservationDate) || !isValidMonthKey(item.reservationMonth)) {
    return false;
  }

  if (
    typeof item.reservationHour !== "number" ||
    Number.isNaN(item.reservationHour) ||
    item.reservationHour < 0 ||
    item.reservationHour > 23
  ) {
    return false;
  }

  if (Number.isNaN(new Date(item.receivedAtIso).getTime())) {
    return false;
  }

  if (item.appointmentIso !== null) {
    if (typeof item.appointmentIso !== "string") {
      return false;
    }
    if (Number.isNaN(new Date(item.appointmentIso).getTime())) {
      return false;
    }
  }

  if (
    item.patientNameNormalized !== undefined &&
    item.patientNameNormalized !== null &&
    typeof item.patientNameNormalized !== "string"
  ) {
    return false;
  }

  if (
    item.patientAge !== undefined &&
    item.patientAge !== null &&
    (typeof item.patientAge !== "number" || Number.isNaN(item.patientAge))
  ) {
    return false;
  }

  if (
    item.patientAddress !== undefined &&
    item.patientAddress !== null &&
    typeof item.patientAddress !== "string"
  ) {
    return false;
  }

  if (
    item.patientPrefecture !== undefined &&
    item.patientPrefecture !== null &&
    typeof item.patientPrefecture !== "string"
  ) {
    return false;
  }

  if (
    item.patientCity !== undefined &&
    item.patientCity !== null &&
    typeof item.patientCity !== "string"
  ) {
    return false;
  }

  if (
    item.patientTown !== undefined &&
    item.patientTown !== null &&
    typeof item.patientTown !== "string"
  ) {
    return false;
  }

  return true;
};

const parseJstDateTime = (raw: string | undefined): ParsedDateTime | null => {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parts = trimmed.split(" ");
  const datePart = parts[0];
  if (!datePart || datePart.split("/").length < 3) {
    return null;
  }
  const timePartRaw = parts[1] ?? "00:00";
  const [yearStr, monthStr, dayStr] = datePart.split("/");
  const timeParts = timePartRaw.split(":");
  const hourStr = timeParts[0];
  const minuteStr = timeParts[1] ?? "00";

  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    Number.isNaN(hour) ||
    Number.isNaN(minute)
  ) {
    return null;
  }

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day ||
    utcDate.getUTCHours() !== hour ||
    utcDate.getUTCMinutes() !== minute
  ) {
    return null;
  }

  const mm = month.toString().padStart(2, "0");
  const dd = day.toString().padStart(2, "0");
  const hh = hour.toString().padStart(2, "0");
  const mi = minute.toString().padStart(2, "0");

  return {
    iso: `${year}-${mm}-${dd}T${hh}:${mi}:00+09:00`,
    dateKey: `${year}-${mm}-${dd}`,
    monthKey: `${year}-${mm}`,
    hour,
  };
};

export const parseReservationCsv = (content: string): Reservation[] => {
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message ?? "CSV parsing error");
  }

  const items: Reservation[] = [];

  for (const row of parsed.data) {
    const department = row["診療科"]?.trim();
    const received = parseJstDateTime(row["受信時刻JST"]);
    if (!department || !received) {
      continue;
    }

    const visitType = normalizeVisitType(row["初再診"]);
    const appointment = parseJstDateTime(row["予約日時"]);
    const appointmentOrReceived = appointment ?? received;
    const patientId = row["患者ID"]?.trim() ?? "";
    const patientNameCandidate = pickFirstNonEmpty(row, [
      "患者氏名",
      "患者名",
      "氏名",
      "お名前",
    ]);
    const { raw: patientName, normalized: patientNameNormalized } = normalizePatientName(
      patientNameCandidate ?? undefined,
    );

    const ageValue = parseOptionalInteger(
      pickFirstNonEmpty(row, ["年齢", "年齢（歳）", "年齢（満年齢）", "患者年齢"]),
    );
    const birthIso = parseBirthDate(
      pickFirstNonEmpty(row, ["生年月日", "誕生日", "生年月日（西暦）"]),
    );
    const computedAge =
      ageValue ?? (birthIso ? calculateAgeFromBirth(birthIso, received.iso) : null);

    const patientPrefecture =
      pickFirstNonEmpty(row, ["都道府県", "都道府県名"]) ?? null;
    const patientCity =
      pickFirstNonEmpty(row, ["市区町村", "市区町村名"]) ?? null;
    const patientTown =
      pickFirstNonEmpty(row, ["町名", "大字町丁目名", "町丁目", "町域"]) ?? null;
    const addressPrimary = pickFirstNonEmpty(row, [
      "住所",
      "患者住所",
      "住所1",
      "患者住所1",
    ]);
    const addressSecondary = pickFirstNonEmpty(row, ["住所2", "患者住所2"]);
    const addressTertiary = pickFirstNonEmpty(row, ["住所3", "患者住所3"]);
    const addressParts = [addressPrimary, addressSecondary, addressTertiary].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    let patientAddress: string | null = null;
    if (addressParts.length > 0) {
      patientAddress = addressParts.join("");
    } else {
      const fallbackParts = [patientPrefecture, patientCity, patientTown].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
      patientAddress = fallbackParts.length > 0 ? fallbackParts.join("") : null;
    }

    const reservation: Reservation = {
      key: createReservationKey({
        department,
        visitType,
        receivedIso: received.iso,
        patientId,
        appointmentIso: appointment?.iso ?? null,
      }),
      department,
      visitType,
      reservationDate: appointmentOrReceived.dateKey,
      reservationMonth: appointmentOrReceived.monthKey,
      reservationHour: appointmentOrReceived.hour,
      receivedAtIso: received.iso,
      appointmentIso: appointment?.iso ?? null,
      patientId,
      patientName,
      patientNameNormalized,
      patientAge: computedAge,
      patientPrefecture,
      patientCity,
      patientTown,
      patientAddress,
      isSameDay: (row["当日予約"] ?? "").trim().toLowerCase() === "true",
    };

    items.push(reservation);
  }

  const deduplicated = new Map<string, Reservation>();
  for (const item of items) {
    deduplicated.set(item.key, item);
  }

  return Array.from(deduplicated.values()).sort((a, b) =>
    a.receivedAtIso.localeCompare(b.receivedAtIso),
  );
};

export const mergeReservations = (
  existing: Reservation[],
  incoming: Reservation[],
): { merged: Reservation[]; newlyAdded: Reservation[] } => {
  const mergedMap = new Map<string, Reservation>();
  const existingKeys = new Set(existing.map((item) => item.key));
  const newlyAdded: Reservation[] = [];

  for (const item of existing) {
    mergedMap.set(item.key, item);
  }

  for (const item of incoming) {
    if (!existingKeys.has(item.key)) {
      newlyAdded.push(item);
      existingKeys.add(item.key);
    }
    mergedMap.set(item.key, item);
  }

  const merged = Array.from(mergedMap.values()).sort((a, b) =>
    a.receivedAtIso.localeCompare(b.receivedAtIso),
  );

  return { merged, newlyAdded };
};

export const loadReservationsFromStorage = (): Reservation[] => {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(RESERVATION_STORAGE_KEY);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored) as Reservation[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isValidReservationRecord);
  } catch (error) {
    console.error(error);
    return [];
  }
};

export const loadReservationTimestamp = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(RESERVATION_TIMESTAMP_KEY);
  } catch (error) {
    console.error(error);
    return null;
  }
};

export const saveReservationsToStorage = (
  reservations: Reservation[],
  timestampOverride?: string,
): string => {
  const timestamp = timestampOverride ?? new Date().toISOString();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        RESERVATION_STORAGE_KEY,
        JSON.stringify(reservations),
      );
      window.localStorage.setItem(RESERVATION_TIMESTAMP_KEY, timestamp);
    } catch (error) {
      console.error(error);
    }
  }
  return timestamp;
};

export const clearReservationsStorage = () => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(RESERVATION_STORAGE_KEY);
    window.localStorage.removeItem(RESERVATION_TIMESTAMP_KEY);
  } catch (error) {
    console.error(error);
  }
};

export const saveReservationDiff = (records: Reservation[]) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (records.length === 0) {
      window.localStorage.removeItem(RESERVATION_DIFF_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        RESERVATION_DIFF_STORAGE_KEY,
        JSON.stringify(records),
      );
    }
  } catch (error) {
    console.error(error);
  }
};

export const loadReservationDiff = (): Reservation[] => {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(RESERVATION_DIFF_STORAGE_KEY);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored) as Reservation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(error);
    return [];
  }
};

export const clearReservationDiff = () => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(RESERVATION_DIFF_STORAGE_KEY);
  } catch (error) {
    console.error(error);
  }
};

export const sortDepartmentsByPriority = (
  priorities: string[],
  department: string,
): number => {
  const normalized = normalizeDepartment(department);
  for (let index = 0; index < priorities.length; index += 1) {
    const normalizedPriority = normalizeDepartment(priorities[index] ?? "");
    if (normalizedPriority.length === 0) {
      continue;
    }
    if (
      normalized.includes(normalizedPriority) ||
      normalizedPriority.includes(normalized)
    ) {
      return index;
    }
  }
  return priorities.length;
};
