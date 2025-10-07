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

/** 予約ログレコード (将来拡張用) */
export interface ReservationRecord {
  dateTime: Date;       // 予約日時(JST)
  department: string;   // 診療科
  type: '初診' | '再診';
  count: number;
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
