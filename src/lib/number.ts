import { ParseError } from "@/lib/types";

export function parseNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const num = Number(trimmed.replace(/,/g, ""));
  return Number.isNaN(num) ? null : num;
}

export function parsePercent(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value / 100;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const cleaned = trimmed.replace("%", "");
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num / 100;
}

export function validateRequiredColumns(
  headers: string[],
  required: string[],
  label: string
): ParseError[] {
  const missing = required.filter((column) => !headers.includes(column));
  if (missing.length === 0) {
    return [];
  }
  return [
    {
      row: 0,
      message: `${label}の必須列が不足しています: ${missing.join(", ")}`,
    },
  ];
}
