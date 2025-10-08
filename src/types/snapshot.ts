import type { ParseError, ParseWarning, ListingRecord, SurveyRecord, ReservationRecord } from './dataTypes';

export const SNAPSHOT_VERSION = '2.0.0';

export interface SerializedListingRecord {
  date: string;
  amount: number | null;
  cv: number | null;
  cvr: number | null;
  cpa: number | null;
  hourlyCV: (number | null)[];
  rawCVR?: string;
}

export interface SerializedSurveyRecord {
  date: string;
  channels: Record<string, number | null>;
  feverGoogle?: number | null;
}

export interface SerializedReservationRecord {
  dateTime: string;
  department: string;
  departmentGroup: ReservationRecord['departmentGroup'];
  type: ReservationRecord['type'];
  count: number;
  isSameDay: boolean;
}

export interface SnapshotData {
  listingInternal: SerializedListingRecord[];
  listingGastroscopy: SerializedListingRecord[];
  listingColonoscopy: SerializedListingRecord[];
  surveyOutpatient: SerializedSurveyRecord[];
  surveyEndoscopy: SerializedSurveyRecord[];
  reservations: SerializedReservationRecord[];
}

export interface MarumieSnapshot {
  version: string;
  savedAt: string;
  selectedMonth: string | null;
  data: SnapshotData;
  errors: Record<string, ParseError[]>;
  warnings: Record<string, ParseWarning[]>;
}

export interface SnapshotInput {
  listingInternal: ListingRecord[];
  listingGastroscopy: ListingRecord[];
  listingColonoscopy: ListingRecord[];
  surveyOutpatient: SurveyRecord[];
  surveyEndoscopy: SurveyRecord[];
  reservations: ReservationRecord[];
  errors: Record<string, ParseError[]>;
  warnings: Record<string, ParseWarning[]>;
  selectedMonth: string | null;
}

export interface SnapshotOutput {
  listingInternal: ListingRecord[];
  listingGastroscopy: ListingRecord[];
  listingColonoscopy: ListingRecord[];
  surveyOutpatient: SurveyRecord[];
  surveyEndoscopy: SurveyRecord[];
  reservations: ReservationRecord[];
  errors: Record<string, ParseError[]>;
  warnings: Record<string, ParseWarning[]>;
  selectedMonth: string | null;
}
