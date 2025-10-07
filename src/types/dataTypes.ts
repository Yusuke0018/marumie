/**
 * マルミエ - データ型定義
 * CSVから読み込むデータの型を定義
 */

/** 解析結果の共通型 */
export interface ParseResult<T> {
  data: T[];
  errors: ParseError[];
  warnings: ParseWarning[];
}

export interface ParseError {
  row: number;
  field?: string;
  message: string;
}

export interface ParseWarning {
  row: number;
  field: string;
  message: string;
}

/** リスティング広告レコード (内科・胃カメラ・大腸カメラ共通) */
export interface ListingRecord {
  date: Date;           // JSTに正規化された日付
  amount: number | null;
  cv: number | null;
  cvr: number | null;   // % → 小数に変換 (例: 16% → 0.16)
  cpa: number | null;
  hourlyCV: (number | null)[];  // 0-23時の配列、欠損はnull
  rawCVR?: string;      // 元の文字列 (検証用)
}

/** アンケート調査レコード (外来・内視鏡共通) */
export interface SurveyRecord {
  date: Date;
  channels: Record<string, number | null>;
  feverGoogle?: number | null;  // 発熱外来(Google) - 除外対象
}

/** 予約ログの診療科グルーピング */
export type ReservationDepartmentGroup =
  | '内科外科外来'
  | '内科外来'
  | '発熱外来'
  | '胃カメラ'
  | '大腸カメラ'
  | '内視鏡ドック'
  | '人間ドックA'
  | '人間ドックB'
  | 'オンライン診療'
  | 'その他';

/** 予約ログレコード */
export interface ReservationRecord {
  dateTime: Date;                 // 予約日時(JST)
  department: string;             // 原診療科名
  departmentGroup: ReservationDepartmentGroup;
  type: '初診' | '再診';
  count: number;                  // 予約件数 (明記なしの場合は1)
  isSameDay: boolean;             // 当日予約か否か
}

/** 予約ログ集計 (診療科×初診/再診) */
export interface ReservationDepartmentStats {
  department: ReservationDepartmentGroup;
  type: '初診' | '再診';
  total: number;
  hourly: number[];               // 0-23時の件数
  daily: Record<string, number>;  // YYYY-MM-DDごとの件数
}

/** 相関分析ポイント */
export interface CorrelationPoint {
  date: string;            // YYYY-MM-DD
  listingCV: number;
  reservationCount: number;
  highlight: boolean;
}

/** 月次サマリー */
export interface MonthlySummary {
  month: string;        // YYYY-MM形式
  totalCV: number;
  totalAmount: number;
  avgCVR: number;
  avgCPA: number;
  validDays: number;    // データが存在する日数
}

/** リスティング種別 */
export type ListingType = 'internal' | 'gastroscopy' | 'colonoscopy';

/** アンケート種別 */
export type SurveyType = 'outpatient' | 'endoscopy';
