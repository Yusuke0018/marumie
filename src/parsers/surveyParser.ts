/**
 * マルミエ - アンケート調査CSVパーサー
 */

import Papa from 'papaparse';
import { SurveyRecord, ParseResult, ParseError, ParseWarning } from '../types/dataTypes';
import { parseJSTDate, isAfterStartDate } from '../utils/dateUtils';
import { parseNumber } from '../utils/validation';

/**
 * アンケート調査 - 外来CSVをパース
 * 列: 日付, ネット検索(Google/Yahoo), Googleマップ, 看板, 紹介系, チラシ, Youtube, リベシティ, AI検索, (空2列), 発熱外来(Google)
 */
export function parseSurveyOutpatient(csvText: string): ParseResult<SurveyRecord> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const data: SurveyRecord[] = [];

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

  // ヘッダー取得
  const headers = rows[0];

  // 必須列確認
  if (!headers.includes('日付')) {
    errors.push({
      row: 0,
      message: '必須列が見つかりません: 日付'
    });
    return { data: [], errors, warnings };
  }

  // チャネル列のインデックスマップ (日付列を除く)
  const channelIndices: Record<string, number> = {};
  headers.forEach((header, idx) => {
    if (idx > 0 && header.trim() !== '') {
      channelIndices[header.trim()] = idx;
    }
  });

  // データ行を処理
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    // 2行目の"OFF"をスキップ
    if (i === 1 && row[0]?.trim() === '') {
      continue;
    }

    // 日付解析 (YYYY/M/D形式)
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

    // チャネル別データ
    const channels: Record<string, number | null> = {};
    let feverGoogle: number | null = null;

    Object.entries(channelIndices).forEach(([channelName, idx]) => {
      const value = parseNumber(row[idx]);

      if (channelName === '発熱外来(Google)') {
        feverGoogle = value;
      } else {
        channels[channelName] = value;
      }
    });

    data.push({
      date,
      channels,
      feverGoogle
    });
  }

  return { data, errors, warnings };
}
