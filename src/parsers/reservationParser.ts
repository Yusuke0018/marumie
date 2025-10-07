/**
 * マルミエ - 予約ログCSVパーサー
 */

import Papa from 'papaparse';
import { ReservationRecord, ParseResult, ParseError, ParseWarning } from '../types/dataTypes';
import { parseJSTDate, isAfterStartDate } from '../utils/dateUtils';
import { parseNumber } from '../utils/validation';
import { mapReservationDepartment } from '../utils/reservationUtils';

interface ReservationHeaders {
  dateTime: number;
  department: number;
  type: number;
  sameDay?: number;
  countIndices: number[];
}

const COUNT_COLUMNS = ['件数', '当日数値', '予約数'];

function resolveHeaders(headers: string[]): ReservationHeaders | null {
  const dateTime = headers.findIndex(h => h.trim() === '予約日時');
  const department = headers.findIndex(h => h.trim() === '診療科');
  const type = headers.findIndex(h => ['初再診', '初診/再診'].includes(h.trim()));

  if (dateTime === -1 || department === -1 || type === -1) {
    return null;
  }

  const sameDay = headers.findIndex(h => h.trim() === '当日予約');
  const countIndices = COUNT_COLUMNS
    .map(column => headers.findIndex(h => h.trim() === column))
    .filter(idx => idx !== -1);

  return {
    dateTime,
    department,
    type,
    sameDay: sameDay !== -1 ? sameDay : undefined,
    countIndices
  };
}

function extractCount(row: string[], indices: number[]): number {
  for (const idx of indices) {
    const value = parseNumber(row[idx]);
    if (value !== null && !Number.isNaN(value)) {
      return Math.max(1, Math.round(value));
    }
  }
  return 1;
}

function parseSameDay(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
}

function parseReservationType(value: string | undefined): '初診' | '再診' {
  const normalized = (value ?? '').trim();
  if (normalized.includes('再')) {
    return '再診';
  }
  return '初診';
}

export function parseReservations(csvText: string): ParseResult<ReservationRecord> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const data: ReservationRecord[] = [];

  const parsed = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    errors.push({
      row: 0,
      message: `予約CSV解析エラー: ${parsed.errors.map(e => e.message).join(', ')}`
    });
    return { data: [], errors, warnings };
  }

  const rows = parsed.data;
  if (rows.length === 0) {
    errors.push({ row: 0, message: '予約CSVが空です' });
    return { data: [], errors, warnings };
  }

  const headers = rows[0].map(header => header.trim());
  const resolved = resolveHeaders(headers);

  if (!resolved) {
    errors.push({
      row: 0,
      message: '予約CSVのヘッダーが想定と異なります。必須列: 予約日時, 診療科, 初再診'
    });
    return { data: [], errors, warnings };
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;
    if (!row || row.length === 0) {
      continue;
    }

    const dateStr = row[resolved.dateTime];
    const dateTime = parseJSTDate(dateStr);
    if (!dateTime) {
      warnings.push({
        row: rowNum,
        field: '予約日時',
        message: `予約日時を解析できませんでした: "${dateStr}"`
      });
      continue;
    }

    if (!isAfterStartDate(dateTime)) {
      continue;
    }

    const department = row[resolved.department] ?? '';
    const departmentGroup = mapReservationDepartment(department);

    const typeValue = row[resolved.type];
    const type = parseReservationType(typeValue);

    const count = extractCount(row, resolved.countIndices);
    const sameDay = resolved.sameDay !== undefined
      ? parseSameDay(row[resolved.sameDay])
      : false;

    data.push({
      dateTime,
      department,
      departmentGroup,
      type,
      count,
      isSameDay: sameDay
    });
  }

  return { data, errors, warnings };
}
