/**
 * マルミエ - リスティング広告CSVパーサー
 * 内科・胃カメラ・大腸カメラ共通
 */

import Papa from 'papaparse';
import { ListingRecord, ParseResult, ParseError, ParseWarning } from '../types/dataTypes';
import { parseJSTDate, isAfterStartDate } from '../utils/dateUtils';
import { validateRequiredColumns, parseCVR, parseNumber, validateHourlyCV } from '../utils/validation';

interface ListingParseOptions {
  label: string;
}

function parseListing(csvText: string, { label }: ListingParseOptions): ParseResult<ListingRecord> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const data: ListingRecord[] = [];

  const parsed = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    errors.push({
      row: 0,
      message: `${label}CSV解析エラー: ${parsed.errors.map(e => e.message).join(', ')}`
    });
    return { data: [], errors, warnings };
  }

  const rows = parsed.data;
  if (rows.length === 0) {
    errors.push({ row: 0, message: `${label}CSVが空です` });
    return { data: [], errors, warnings };
  }

  const headers = rows[0];
  const requiredCols = ['日付', '金額', 'CV', 'CVR', 'CPA'];
  const colErrors = validateRequiredColumns(headers, requiredCols);
  if (colErrors.length > 0) {
    return {
      data: [],
      errors: colErrors.map(error => ({
        ...error,
        message: `${label}CSV: ${error.message}`
      })),
      warnings
    };
  }

  const hourStartIndex = headers.findIndex(header => header === '0時');
  if (hourStartIndex === -1 || hourStartIndex + 24 > headers.length) {
    errors.push({
      row: 0,
      message: `${label}CSVに0時〜23時の列が存在しません。CSVテンプレートを確認してください。`
    });
    return { data: [], errors, warnings };
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    if (!row || row.length === 0) continue;

    const dateStr = row[0];
    const date = parseJSTDate(dateStr);

    if (!date) {
      warnings.push({
        row: rowNum,
        field: '日付',
        message: `${label}CSV 日付解析失敗: "${dateStr}"`
      });
      continue;
    }

    if (!isAfterStartDate(date)) {
      continue;
    }

    const amount = parseNumber(row[1]);
    const cv = parseNumber(row[2]);
    const cvr = parseCVR(row[3]);
    const cpa = parseNumber(row[4]);

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
      rawCVR: row[3] ?? undefined
    });
  }

  return { data, errors, warnings };
}

/**
 * リスティング内科CSVをパース
 */
export function parseListingInternal(csvText: string): ParseResult<ListingRecord> {
  return parseListing(csvText, { label: '内科' });
}

/**
 * リスティング胃カメラCSVをパース
 */
export function parseListingGastroscopy(csvText: string): ParseResult<ListingRecord> {
  return parseListing(csvText, { label: '胃カメラ' });
}

/**
 * リスティング大腸カメラCSVをパース
 */
export function parseListingColonoscopy(csvText: string): ParseResult<ListingRecord> {
  return parseListing(csvText, { label: '大腸カメラ' });
}
