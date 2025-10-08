import Papa from "papaparse";

import { parseJstDate, isOnOrAfterStart } from "@/lib/date";
import { parseNumber, parsePercent, validateRequiredColumns } from "@/lib/number";
import { ListingRecord, ParseError, ParseResult, ParseWarning } from "@/lib/types";

function parseListing(csvText: string, label: string): ParseResult<ListingRecord> {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const data: ListingRecord[] = [];

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
  const headerErrors = validateRequiredColumns(headers, ["日付", "金額", "CV", "CVR", "CPA"], label);
  if (headerErrors.length > 0) {
    return { data, errors: headerErrors, warnings };
  }

  const hourStart = headers.findIndex((header) => header === "0時");
  if (hourStart === -1 || hourStart + 24 > headers.length) {
    errors.push({
      row: 0,
      message: `${label}CSVに0時〜23時の列が存在しません。テンプレートをご確認ください。`,
    });
    return { data, errors, warnings };
  }

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const rowNumber = i + 1;

    const date = parseJstDate(row[0]);
    if (!date || !isOnOrAfterStart(date)) {
      continue;
    }

    if (!date) {
      warnings.push({
        row: rowNumber,
        field: "日付",
        message: `${label}CSVの日付を読み取れませんでした: "${row[0]}"`,
      });
      continue;
    }

    const amount = parseNumber(row[1]);
    const cv = parseNumber(row[2]);
    const cvr = parsePercent(row[3]);
    const cpa = parseNumber(row[4]);

    const hourly: (number | null)[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const source = row[hourStart + hour];
      const parsedHour = parseNumber(source);
      if (parsedHour === null && source && source.trim() !== "") {
        warnings.push({
          row: rowNumber,
          field: `${hour}時`,
          message: `${label}CSVの時間帯別CVを解釈できませんでした: "${source}"`,
        });
      }
      hourly.push(parsedHour);
    }

    data.push({
      date,
      amount,
      cv,
      cvr,
      cpa,
      hourlyCV: hourly,
    });
  }

  return { data, errors, warnings };
}

export const parseListingInternal = (csvText: string) =>
  parseListing(csvText, "内科リスティング");

export const parseListingGastroscopy = (csvText: string) =>
  parseListing(csvText, "胃カメラリスティング");

export const parseListingColonoscopy = (csvText: string) =>
  parseListing(csvText, "大腸カメラリスティング");
