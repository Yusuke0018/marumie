import Papa from "papaparse";

export type VisitType = "初診" | "再診" | "未設定";

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
    const patientId = row["患者ID"]?.trim() ?? "";

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
      reservationDate: received.dateKey,
      reservationMonth: received.monthKey,
      reservationHour: received.hour,
      receivedAtIso: received.iso,
      appointmentIso: appointment?.iso ?? null,
      patientId,
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
    return parsed;
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
