import type { Reservation } from "@/lib/reservationData";
import type { KarteRecord } from "@/lib/karteAnalytics";
import type { SurveyData } from "@/lib/surveyData";
import type { ListingCategoryData, ListingData } from "@/lib/listingData";
import {
  buildFirstSeenIndex,
  createPatientIdentityKey,
} from "@/lib/patientIdentity";

const GENERAL_RESERVATION_PATTERNS = [/総合診療/, /内科外科外来/, /内科外来/, /内科/];
const FEVER_RESERVATION_PATTERN = /発熱/;

const GENERAL_KARTE_PATTERNS = [/総合診療/, /内科/];
const FEVER_KARTE_PATTERN = /発熱/;
// 内視鏡の簡易判定（胃/大腸/同義語）
const ENDOSCOPY_STOMACH_PATTERN = /(胃|上部|胃カメラ|上部内視鏡|gastroscopy|egd)/i;
const ENDOSCOPY_COLON_PATTERN = /(大腸|下部|大腸カメラ|下部内視鏡|colonoscopy)/i;

type HourlyBuckets = {
  general: number[];
  fever: number[];
};

const createEmptyHourlyBuckets = (): HourlyBuckets => ({
  general: Array.from({ length: 24 }, () => 0),
  fever: Array.from({ length: 24 }, () => 0),
});

const ensureHourlyBucket = (
  map: Map<string, HourlyBuckets>,
  dateKey: string,
): HourlyBuckets => {
  if (!map.has(dateKey)) {
    map.set(dateKey, createEmptyHourlyBuckets());
  }
  return map.get(dateKey)!;
};

type EndoscopyHourly = {
  stomach: number[];
  colon: number[];
};

const createEmptyEndoscopyHourly = (): EndoscopyHourly => ({
  stomach: Array.from({ length: 24 }, () => 0),
  colon: Array.from({ length: 24 }, () => 0),
});

const ensureEndoscopyBucket = (
  map: Map<string, EndoscopyHourly>,
  dateKey: string,
): EndoscopyHourly => {
  if (!map.has(dateKey)) {
    map.set(dateKey, createEmptyEndoscopyHourly());
  }
  return map.get(dateKey)!;
};

const normalizeGeneralDepartmentName = (department: string): "総合診療" | "内科" | null => {
  if (department.includes("総合診療")) {
    return "総合診療";
  }
  if (department.includes("内科")) {
    return "内科";
  }
  return null;
};

const categorizeReservationDepartment = (
  department: string,
): "general" | "fever" | null => {
  if (!department) {
    return null;
  }
  if (FEVER_RESERVATION_PATTERN.test(department)) {
    return "fever";
  }
  if (GENERAL_RESERVATION_PATTERNS.some((pattern) => pattern.test(department))) {
    return "general";
  }
  return null;
};

const categorizeKarteDepartment = (
  department: string | null | undefined,
): { type: "general" | "fever" | null; normalizedGeneral: "総合診療" | "内科" | null } => {
  if (!department) {
    return { type: null, normalizedGeneral: null };
  }
  if (FEVER_KARTE_PATTERN.test(department)) {
    return { type: "fever", normalizedGeneral: null };
  }
  const normalized = normalizeGeneralDepartmentName(department);
  if (
    normalized ||
    GENERAL_KARTE_PATTERNS.some((pattern) => pattern.test(department))
  ) {
    return { type: "general", normalizedGeneral: normalized };
  }
  return { type: null, normalizedGeneral: null };
};

const classifyEndoscopyFromDepartment = (
  department: string | null | undefined,
): "stomach" | "colon" | null => {
  if (!department) return null;
  const normalized = department.replace(/\s+/g, "");
  // 明示ルールを最優先
  if (normalized.includes("人間ドックA") || normalized.includes("胃カメラ")) {
    return normalized.includes("大腸カメラ") || normalized.includes("胃カメラ併用")
      ? "colon" // 併用は大腸側に集約
      : "stomach";
  }
  if (
    normalized.includes("大腸カメラ") ||
    normalized.includes("胃カメラ併用") ||
    normalized.includes("人間ドックB") ||
    normalized.includes("内視鏡ドック")
  ) {
    return "colon";
  }
  // 補助パターン
  const stomachLike = ENDOSCOPY_STOMACH_PATTERN.test(normalized);
  const colonLike = ENDOSCOPY_COLON_PATTERN.test(normalized);
  if (stomachLike && colonLike) return "colon"; // 両方該当時は大腸に集約
  if (stomachLike) return "stomach";
  if (colonLike) return "colon";
  return null;
};

const getReservationTimestamp = (reservation: Reservation): string | null => {
  // 予約時刻（D列: appointmentIso）を最優先
  if (reservation.appointmentIso && reservation.appointmentIso.length >= 10) {
    return reservation.appointmentIso;
  }
  if (reservation.bookingIso && reservation.bookingIso.length >= 10) {
    return reservation.bookingIso;
  }
  if (reservation.receivedAtIso && reservation.receivedAtIso.length >= 10) {
    return reservation.receivedAtIso;
  }
  return null;
};

const getReservationDateKey = (reservation: Reservation): string | null => {
  // reservation.reservationDate は予約時刻ベース
  if (reservation.reservationDate && reservation.reservationDate.length >= 10) {
    return reservation.reservationDate;
  }
  if (reservation.bookingDate && reservation.bookingDate.length >= 10) {
    return reservation.bookingDate;
  }
  const timestamp = getReservationTimestamp(reservation);
  if (timestamp) {
    return timestamp.slice(0, 10);
  }
  return null;
};

const getListingDateKey = (entry: ListingData): string | null => {
  const parsed = new Date(entry.date);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
    const day = `${parsed.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const match = entry.date.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (match) {
    const [, year, month, day] = match;
    const monthStr = `${Number(month)}`.padStart(2, "0");
    const dayStr = `${Number(day)}`.padStart(2, "0");
    return `${year}-${monthStr}-${dayStr}`;
  }
  return null;
};

const getSurveyDateKey = (entry: SurveyData): string => entry.date;

export type TrueFirstAggregation = {
  trueFirstCounts: Map<string, HourlyBuckets>;
  reservationCounts: Map<string, HourlyBuckets>;
  generalDepartmentByDate: Map<string, "総合診療" | "内科" | "mixed">;
  endoscopyTrueFirstByDate: Map<string, EndoscopyHourly>;
  endoscopyReservationByDate: Map<string, EndoscopyHourly>;
};

export const buildTrueFirstAggregation = (
  reservations: Reservation[],
  karteRecords: KarteRecord[],
): TrueFirstAggregation => {
  const generalDepartmentByDate = new Map<string, "総合診療" | "内科" | "mixed">();

  const registerGeneralDepartment = (dateKey: string, department: "総合診療" | "内科") => {
    const existing = generalDepartmentByDate.get(dateKey);
    if (!existing) {
      generalDepartmentByDate.set(dateKey, department);
      return;
    }
    if (existing !== department) {
      generalDepartmentByDate.set(dateKey, "mixed");
    }
  };

  const events = [];

  for (const reservation of reservations) {
    const identityKey = createPatientIdentityKey({
      patientNameNormalized: reservation.patientNameNormalized ?? undefined,
      patientName: reservation.patientName ?? undefined,
    });
    const occurredAt = getReservationTimestamp(reservation);
    events.push({
      identityKey,
      occurredAt,
    });

    const dateKey = getReservationDateKey(reservation);
    if (dateKey) {
      const category = categorizeReservationDepartment(reservation.department);
      if (category === "general") {
        const normalized = normalizeGeneralDepartmentName(reservation.department);
        if (normalized) {
          registerGeneralDepartment(dateKey, normalized);
        }
      }
    }
  }

  for (const record of karteRecords) {
    const identityKey = createPatientIdentityKey({
      patientNumber: record.patientNumber,
      patientNameNormalized: record.patientNameNormalized ?? undefined,
      birthDateIso: record.birthDateIso ?? undefined,
    });
    events.push({
      identityKey,
      occurredAt: record.dateIso ? `${record.dateIso}T00:00:00` : null,
    });

    if (record.dateIso) {
      const category = categorizeKarteDepartment(record.department);
      if (category.type === "general" && category.normalizedGeneral) {
        registerGeneralDepartment(record.dateIso, category.normalizedGeneral);
      }
    }
  }

  const firstSeenIndex = buildFirstSeenIndex(events);
  const trueFirstCounts = new Map<string, HourlyBuckets>();
  const reservationCounts = new Map<string, HourlyBuckets>();
  const endoscopyTrueFirstByDate = new Map<string, EndoscopyHourly>();
  const endoscopyReservationByDate = new Map<string, EndoscopyHourly>();

  reservations.forEach((reservation) => {
    const timestamp = getReservationTimestamp(reservation);
    const dateKey = getReservationDateKey(reservation);
    const hour = reservation.reservationHour ?? reservation.bookingHour ?? -1;
    if (!timestamp || !dateKey || hour < 0 || hour > 23) {
      return;
    }

    const category = categorizeReservationDepartment(reservation.department);
    if (!category) {
      return;
    }

    const reservationBucket = ensureHourlyBucket(reservationCounts, dateKey);
    reservationBucket[category][hour] += 1;
    const endoType = classifyEndoscopyFromDepartment(reservation.department);
    if (endoType) {
      const endoBucket = ensureEndoscopyBucket(endoscopyReservationByDate, dateKey);
      endoBucket[endoType][hour] += 1;
    }

    const identityKey = createPatientIdentityKey({
      patientNameNormalized: reservation.patientNameNormalized ?? undefined,
      patientName: reservation.patientName ?? undefined,
    });
    if (!identityKey) {
      return;
    }

    const firstSeen = firstSeenIndex.get(identityKey);
    if (firstSeen && timestamp.localeCompare(firstSeen) === 0) {
      const trueFirstBucket = ensureHourlyBucket(trueFirstCounts, dateKey);
      trueFirstBucket[category][hour] += 1;
      const endoType2 = classifyEndoscopyFromDepartment(reservation.department);
      if (endoType2) {
        const endoBucket = ensureEndoscopyBucket(endoscopyTrueFirstByDate, dateKey);
        endoBucket[endoType2][hour] += 1;
      }
    }
  });

  return {
    trueFirstCounts,
    reservationCounts,
    generalDepartmentByDate,
    endoscopyTrueFirstByDate,
    endoscopyReservationByDate,
  };
};

export type ListingAggregation = {
  generalCvByDate: Map<string, number[]>;
  feverCvByDate: Map<string, number[]>;
  endoscopyCvByDate: Map<string, number[]>;
};

export const buildListingAggregation = (
  listingData: ListingCategoryData[],
): ListingAggregation => {
  const generalCvByDate = new Map<string, number[]>();
  const feverCvByDate = new Map<string, number[]>();
  const endoscopyCvByDate = new Map<string, number[]>();

  const registerListing = (
    target: Map<string, number[]>,
    dateKey: string,
    hourly: number[],
  ) => {
    if (!target.has(dateKey)) {
      target.set(dateKey, Array.from({ length: 24 }, () => 0));
    }
    const bucket = target.get(dateKey)!;
    for (let hour = 0; hour < 24; hour += 1) {
      bucket[hour] += hourly[hour] ?? 0;
    }
  };

  listingData.forEach((categoryData) => {
    let targetMap: Map<string, number[]> = generalCvByDate;
    if (categoryData.category === "発熱外来") {
      targetMap = feverCvByDate;
    }
    if (categoryData.category === "胃カメラ" || categoryData.category === "大腸カメラ") {
      targetMap = endoscopyCvByDate;
    }
    categoryData.data.forEach((entry) => {
      const dateKey = getListingDateKey(entry);
      if (!dateKey) {
        return;
      }
      registerListing(targetMap, dateKey, entry.hourlyCV);
    });
  });

  return {
    generalCvByDate,
    feverCvByDate,
    endoscopyCvByDate,
  };
};

export type SurveyAggregation = {
  generalGoogleByDate: Map<string, number>;
  feverGoogleByDate: Map<string, number>;
};

export const buildSurveyAggregation = (surveyData: SurveyData[]): SurveyAggregation => {
  const generalGoogleByDate = new Map<string, number>();
  const feverGoogleByDate = new Map<string, number>();

  surveyData.forEach((entry) => {
    const dateKey = getSurveyDateKey(entry);
    const existingGeneral = generalGoogleByDate.get(dateKey) ?? 0;
    const existingFever = feverGoogleByDate.get(dateKey) ?? 0;

    if (entry.fileType === "外来") {
      generalGoogleByDate.set(dateKey, existingGeneral + entry.googleSearch);
      feverGoogleByDate.set(
        dateKey,
        existingFever + entry.feverGoogleSearch,
      );
    } else {
      generalGoogleByDate.set(dateKey, existingGeneral + entry.googleSearch);
    }
  });

  return {
    generalGoogleByDate,
    feverGoogleByDate,
  };
};
