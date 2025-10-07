/**
 * マルミエ - リスティング広告CSVパーサー
 * 内科・胃カメラ・大腸カメラ共通
 */

import Papa from 'papaparse';
import { ListingRecord, ParseResult, ParseError, ParseWarning } from '../types/dataTypes';
import { parseJSTDate, isAfterStartDate } from '../utils/dateUtils';
import { validateRequiredColumns, parseCVR, parseNumber, validateHourlyCV } from '../utils/validation';

/**
 * リスティング内科CSVをパース
 * 列: 日付, 金額, CV, CVR, CPA, 0時〜23時
 */
export function parseListingInternal(csvText: string): ParseResult<ListingRecord> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const data: ListingRecord[] = [];

  const parsed = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    errors.push({
      row: 0,
      message: `CSV解析エラー: ${parsed.errors.map(e => e.message).join(', ')}`
    });
    return { data: [], errors, warnings };
  }

  const rows = parsed.data;
  if (rows.length === 0) {
    errors.push({ row: 0, message: 'CSVが空です' });
    return { data: [], errors, warnings };
  }

  // ヘッダー検証
  const headers = rows[0];
  const requiredCols = ['日付', '金額', 'CV', 'CVR', 'CPA'];
  const colErrors = validateRequiredColumns(headers, requiredCols);
  if (colErrors.length > 0) {
    return { data: [], errors: colErrors, warnings };
  }

  // 時間帯列のインデックス (5〜28列目)
  const hourStartIndex = 5;

  // データ行を処理 (1行目以降)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    // 日付解析
    const dateStr = row[0];
    const date = parseJSTDate(dateStr);

    if (!date) {
      warnings.push({
        row: rowNum,
        field: '日付',
        message: `日付解析失敗: "${dateStr}"`
      });
      continue;
    }

    // 2025-10-02以前はスキップ
    if (!isAfterStartDate(date)) {
      continue;
    }

    // 基本データ
    const amount = parseNumber(row[1]);
    const cv = parseNumber(row[2]);
    const cvr = parseCVR(row[3]);
    const cpa = parseNumber(row[4]);

    // 時間帯別CV (0〜23時)
    const hourlyValues = row.slice(hourStartIndex, hourStartIndex + 24);
    const { data: hourlyCV, warnings: hourWarnings } = validateHourlyCV(hourlyValues, rowNum);
    warnings.push(...hourWarnings);

    data.push({
      date,
      amount,
      cv,
      cvr,
      cpa,
      hourlyCV,
      rawCVR: String(row[3])
    });
  }

  return { data, errors, warnings };
}

/**
 * リスティング胃カメラCSVをパース
 * 列構造: 日付, (空4列), 0時〜23時
 * 課題: 金額/CV/CVR/CPA列が欠落
 */
export function parseListingGastroscopy(csvText: string): ParseResult<ListingRecord> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];

  const parsed = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    errors.push({
      row: 0,
      message: `CSV解析エラー: ${parsed.errors.map(e => e.message).join(', ')}`
    });
    return { data: [], errors, warnings };
  }

  const rows = parsed.data;
  if (rows.length === 0) {
    errors.push({ row: 0, message: 'CSVが空です' });
    return { data: [], errors, warnings };
  }

  // 胃カメラCSVは列名不一致 - エラーで返す
  const headers = rows[0];
  if (!headers.includes('金額') || !headers.includes('CV')) {
    errors.push({
      row: 0,
      message: '胃カメラCSVの列名が正しくありません。金額/CV/CVR/CPA列が必要です。CSVテンプレートをダウンロードして列名を修正してください。'
    });
    return { data: [], errors, warnings };
  }

  // 内科と同じロジック
  return parseListingInternal(csvText);
}
