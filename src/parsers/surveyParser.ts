/**
 * マルミエ - アンケート調査CSVパーサー
 */

import Papa from 'papaparse';
import { SurveyRecord, ParseResult, ParseError, ParseWarning } from '../types/dataTypes';
import { parseJSTDate, isAfterStartDate } from '../utils/dateUtils';
import { parseNumber } from '../utils/validation';

interface SurveyParseOptions {
  label: string;
  excludedChannels?: string[];
}

function parseSurvey(csvText: string, { label, excludedChannels = [] }: SurveyParseOptions): ParseResult<SurveyRecord> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const data: SurveyRecord[] = [];

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

  if (!headers.includes('日付')) {
    errors.push({
      row: 0,
      message: `${label}CSV: 必須列が見つかりません: 日付`
    });
    return { data: [], errors, warnings };
  }

  const channelIndices: Record<string, number> = {};
  headers.forEach((header, idx) => {
    const trimmed = header.trim();
    if (idx > 0 && trimmed !== '') {
      channelIndices[trimmed] = idx;
    }
  });

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    if (!row || row.length === 0) continue;

    // 2行目のOFF等テンプレ行はスキップ
    const isTemplateRow = row[0]?.trim() === '' || row[0]?.trim().toUpperCase() === 'OFF';
    if (i === 1 && isTemplateRow) {
      continue;
    }

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

    const channels: Record<string, number | null> = {};
    let feverGoogle: number | null = null;

    Object.entries(channelIndices).forEach(([channelName, idx]) => {
      const value = parseNumber(row[idx]);
      if (channelName === '発熱外来(Google)') {
        feverGoogle = value;
        return;
      }
      if (excludedChannels.includes(channelName)) {
        return;
      }
      channels[channelName] = value;
    });

    data.push({
      date,
      channels,
      feverGoogle
    });
  }

  return { data, errors, warnings };
}

/**
 * アンケート調査 - 外来CSV
 */
export function parseSurveyOutpatient(csvText: string): ParseResult<SurveyRecord> {
  return parseSurvey(csvText, { label: 'アンケート(外来)' });
}

/**
 * アンケート調査 - 内視鏡CSV
 */
export function parseSurveyEndoscopy(csvText: string): ParseResult<SurveyRecord> {
  return parseSurvey(csvText, {
    label: 'アンケート(内視鏡)',
    excludedChannels: []
  });
}
