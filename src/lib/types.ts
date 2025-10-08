export type CsvKind =
  | "reservations"
  | "listingInternal"
  | "listingGastroscopy"
  | "listingColonoscopy"
  | "surveyOutpatient"
  | "surveyEndoscopy";

export interface ParseError {
  row: number;
  field?: string;
  message: string;
}

export interface ParseWarning {
  row: number;
  field?: string;
  message: string;
}

export interface ParseResult<T> {
  data: T[];
  errors: ParseError[];
  warnings: ParseWarning[];
}

export type ReservationDepartmentGroup =
  | "内科外科外来"
  | "内科外来"
  | "発熱外来"
  | "胃カメラ"
  | "大腸カメラ"
  | "内視鏡ドック"
  | "人間ドックA"
  | "人間ドックB"
  | "オンライン診療"
  | "その他";

export interface ReservationRecord {
  dateTime: Date;
  department: string;
  departmentGroup: ReservationDepartmentGroup;
  type: "初診" | "再診";
  count: number;
  isSameDay: boolean;
}

export interface ReservationDepartmentStats {
  department: ReservationDepartmentGroup;
  type: "初診" | "再診";
  total: number;
  hourly: number[];
  daily: Record<string, number>;
}

export interface ListingRecord {
  date: Date;
  amount: number | null;
  cv: number | null;
  cvr: number | null;
  cpa: number | null;
  hourlyCV: (number | null)[];
}

export interface SurveyRecord {
  date: Date;
  channels: Record<string, number | null>;
  feverGoogle?: number | null;
}

export interface CsvFileDefinition {
  key: CsvKind;
  title: string;
  description: string;
  helper: string;
  acceptMultiple?: boolean;
}

export interface DataState {
  reservations: ReservationRecord[];
  listingInternal: ListingRecord[];
  listingGastroscopy: ListingRecord[];
  listingColonoscopy: ListingRecord[];
  surveyOutpatient: SurveyRecord[];
  surveyEndoscopy: SurveyRecord[];
}

export interface CsvStatus {
  errors: ParseError[];
  warnings: ParseWarning[];
  rowCount: number;
  updatedAt?: Date;
}
