import type {
  MarumieSnapshot,
  SnapshotInput,
  SnapshotOutput,
  SerializedListingRecord,
  SerializedSurveyRecord,
  SerializedReservationRecord
} from '../types/snapshot';
import { SNAPSHOT_VERSION } from '../types/snapshot';
import type { ListingRecord, SurveyRecord, ReservationRecord } from '../types/dataTypes';

function normalizeHourlyCV(values: (number | null)[] = []): (number | null)[] {
  return Array.from({ length: 24 }, (_, index) => values[index] ?? null);
}

function serializeListing(records: ListingRecord[]): SerializedListingRecord[] {
  return records.map(record => ({
    date: record.date.toISOString(),
    amount: record.amount ?? null,
    cv: record.cv ?? null,
    cvr: record.cvr ?? null,
    cpa: record.cpa ?? null,
    hourlyCV: normalizeHourlyCV(record.hourlyCV),
    rawCVR: record.rawCVR
  }));
}

function serializeSurvey(records: SurveyRecord[]): SerializedSurveyRecord[] {
  return records.map(record => ({
    date: record.date.toISOString(),
    channels: record.channels,
    feverGoogle: record.feverGoogle ?? null
  }));
}

function serializeReservation(records: ReservationRecord[]): SerializedReservationRecord[] {
  return records.map(record => ({
    dateTime: record.dateTime.toISOString(),
    department: record.department,
    departmentGroup: record.departmentGroup,
    type: record.type,
    count: record.count,
    isSameDay: record.isSameDay
  }));
}

function toDate(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label}の日付形式を復元できませんでした (${value})`);
  }
  return date;
}

function deserializeListing(records: SerializedListingRecord[] = []): ListingRecord[] {
  return records.map(record => ({
    date: toDate(record.date, 'リスティング'),
    amount: record.amount ?? null,
    cv: record.cv ?? null,
    cvr: record.cvr ?? null,
    cpa: record.cpa ?? null,
    hourlyCV: normalizeHourlyCV(record.hourlyCV),
    rawCVR: record.rawCVR
  }));
}

function deserializeSurvey(records: SerializedSurveyRecord[] = []): SurveyRecord[] {
  return records.map(record => ({
    date: toDate(record.date, 'アンケート'),
    channels: record.channels ?? {},
    feverGoogle: record.feverGoogle ?? null
  }));
}

function deserializeReservation(records: SerializedReservationRecord[] = []): ReservationRecord[] {
  return records.map(record => ({
    dateTime: toDate(record.dateTime, '予約'),
    department: record.department ?? '',
    departmentGroup: record.departmentGroup,
    type: record.type,
    count: record.count ?? 0,
    isSameDay: Boolean(record.isSameDay)
  }));
}

export function toSnapshot(input: SnapshotInput): MarumieSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    selectedMonth: input.selectedMonth ?? null,
    data: {
      listingInternal: serializeListing(input.listingInternal),
      listingGastroscopy: serializeListing(input.listingGastroscopy),
      listingColonoscopy: serializeListing(input.listingColonoscopy),
      surveyOutpatient: serializeSurvey(input.surveyOutpatient),
      surveyEndoscopy: serializeSurvey(input.surveyEndoscopy),
      reservations: serializeReservation(input.reservations)
    },
    errors: input.errors ?? {},
    warnings: input.warnings ?? {}
  };
}

export function fromSnapshot(snapshot: MarumieSnapshot): SnapshotOutput {
  if (!snapshot?.data) {
    throw new Error('保存ファイルにデータが含まれていません。');
  }

  return {
    listingInternal: deserializeListing(snapshot.data.listingInternal),
    listingGastroscopy: deserializeListing(snapshot.data.listingGastroscopy),
    listingColonoscopy: deserializeListing(snapshot.data.listingColonoscopy),
    surveyOutpatient: deserializeSurvey(snapshot.data.surveyOutpatient),
    surveyEndoscopy: deserializeSurvey(snapshot.data.surveyEndoscopy),
    reservations: deserializeReservation(snapshot.data.reservations),
    errors: snapshot.errors ?? {},
    warnings: snapshot.warnings ?? {},
    selectedMonth: snapshot.selectedMonth ?? null
  };
}

export function parseSnapshotJson(jsonText: string): MarumieSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('保存ファイルをJSONとして解析できませんでした。');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('保存ファイルの形式が不正です。');
  }

  const snapshot = parsed as Partial<MarumieSnapshot>;
  if (!snapshot.version) {
    throw new Error('保存ファイルにバージョン情報が含まれていません。');
  }

  const expectedMajor = SNAPSHOT_VERSION.split('.')[0];
  const actualMajor = snapshot.version.split('.')[0];
  if (expectedMajor !== actualMajor) {
    throw new Error(`保存ファイルのバージョン (${snapshot.version}) が現在のバージョンと一致しません。`);
  }

  if (!snapshot.data) {
    throw new Error('保存ファイルにデータセクションがありません。');
  }

  return snapshot as MarumieSnapshot;
}
