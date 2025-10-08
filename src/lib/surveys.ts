import Papa from "papaparse";

import { parseJstDate, isOnOrAfterStart } from "@/lib/date";
import { parseNumber } from "@/lib/number";
import { ParseError, ParseResult, ParseWarning, SurveyRecord } from "@/lib/types";

function parseSurvey(csvText: string, label: string): ParseResult<SurveyRecord> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const data: SurveyRecord[] = [];

  const parsed = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    errors.push({
      row: 0,
      message: `${label}のCSV解析時にエラーが発生しました: ${parsed.errors
        .map((item) => item.message)
        .join(", ")}`,
    });
    return { data, errors, warnings };
  }

  const rows = parsed.data;
  if (rows.length === 0) {
    errors.push({ row: 0, message: `${label}CSVに行がありません` });
    return { data, errors, warnings };
  }

  const headers = rows[0];
  if (!headers.includes("日付")) {
    errors.push({
      row: 0,
      message: `${label}CSVの必須列(日付)が見つかりません。`,
    });
    return { data, errors, warnings };
  }

  const channelIndexMap: Record<string, number> = {};
  headers.forEach((header, index) => {
    if (index === 0) return;
    const trimmed = header.trim();
    if (trimmed !== "") {
      channelIndexMap[trimmed] = index;
    }
  });

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const rowNumber = i + 1;

    const date = parseJstDate(row[0]);
    if (!date) {
      warnings.push({
        row: rowNumber,
        field: "日付",
        message: `${label}CSVの日付を読み取れませんでした: "${row[0]}"`,
      });
      continue;
    }

    if (!isOnOrAfterStart(date)) {
      continue;
    }

    const channels: Record<string, number | null> = {};
    Object.entries(channelIndexMap).forEach(([channel, index]) => {
      const parsedValue = parseNumber(row[index]);
      channels[channel] = parsedValue;
    });

    data.push({
      date,
      channels,
      feverGoogle: channels["発熱外来(Google)"],
    });
  }

  return { data, errors, warnings };
}

export const parseSurveyOutpatient = (csvText: string) =>
  parseSurvey(csvText, "アンケート(外来)");

export const parseSurveyEndoscopy = (csvText: string) =>
  parseSurvey(csvText, "アンケート(内視鏡)");
