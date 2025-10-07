/**
 * マルミエ - データ検証ユーティリティ
 */

import { ParseError, ParseWarning } from '../types/dataTypes';

/**
 * 必須列の存在を検証
 */
export function validateRequiredColumns(
  headers: string[],
  required: string[]
): ParseError[] {
  const errors: ParseError[] = [];
  const missing = required.filter(col => !headers.includes(col));

  if (missing.length > 0) {
    errors.push({
      row: 0,
      message: `必須列が見つかりません: ${missing.join(', ')}`
    });
  }

  return errors;
}

/**
 * CVR文字列を数値に変換 (16% → 0.16)
 */
export function parseCVR(value: string | number): number | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') return value / 100;

  const str = String(value).trim();
  if (str === '' || str === '0%') return 0;

  // パーセント記号を除去
  const cleaned = str.replace('%', '').trim();
  const num = parseFloat(cleaned);

  if (isNaN(num)) return null;
  return num / 100;
}

/**
 * 数値文字列を数値に変換
 */
export function parseNumber(value: string | number): number | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') return value;

  const num = parseFloat(String(value).trim());
  return isNaN(num) ? null : num;
}

/**
 * CPA再計算差異チェック
 * @returns CSV値との差異が1%以上の場合true
 */
export function hasCPADiscrepancy(
  csvCPA: number,
  amount: number,
  cv: number
): boolean {
  if (cv === 0) return false;

  const calculated = amount / cv;
  const diff = Math.abs(csvCPA - calculated);
  const threshold = csvCPA * 0.01;

  return diff > threshold;
}

/**
 * 時間帯別CV配列の検証 (0-23時の24要素)
 */
export function validateHourlyCV(
  values: (string | number)[],
  rowNum: number
): { data: (number | null)[]; warnings: ParseWarning[] } {
  const warnings: ParseWarning[] = [];
  const data: (number | null)[] = [];

  for (let i = 0; i < 24; i++) {
    const val = values[i];
    const parsed = parseNumber(val);

    if (parsed === null && val !== null && val !== undefined && val !== '') {
      warnings.push({
        row: rowNum,
        field: `${i}時`,
        message: `数値変換失敗: "${val}"`
      });
    }

    data.push(parsed);
  }

  return { data, warnings };
}
