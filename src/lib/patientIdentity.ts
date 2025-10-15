const KATAKANA_TO_HIRAGANA_OFFSET = 0x60;

const toHiragana = (value: string) =>
  value.replace(/[\u30a1-\u30f6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - KATAKANA_TO_HIRAGANA_OFFSET),
  );

const stripRubyNotation = (value: string) => value.replace(/[（(][^）)]*[）)]/g, "");

const normalizeWhitespace = (value: string) =>
  value.replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();

export const normalizeNameForMatching = (
  value: string | null | undefined,
): string | null => {
  if (!value) {
    return null;
  }
  const nfkc = value.normalize("NFKC");
  const withoutRuby = stripRubyNotation(nfkc);
  const trimmed = normalizeWhitespace(withoutRuby);
  if (trimmed.length === 0) {
    return null;
  }
  const hiragana = toHiragana(trimmed).replace(/\s+/g, "");
  return hiragana.length > 0 ? hiragana : null;
};

const normalizePatientNumberKey = (
  value: string | number | null | undefined,
): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length === 0) {
    return null;
  }
  const parsed = Number.parseInt(digits, 10);
  if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
    return String(parsed);
  }
  return digits;
};

export type PatientIdentityInput = {
  patientId?: string | null;
  patientNumber?: string | number | null;
  patientName?: string | null;
  patientNameNormalized?: string | null;
  birthDateIso?: string | null;
};

const isValidIsoLike = (value: string | null | undefined) =>
  typeof value === "string" && value.length >= 10;

/**
 * Creates a stable identity key for patient matching.
 * Priority: patient number > name + birthdate > name only (null if insufficient).
 */
export const createPatientIdentityKey = (
  input: PatientIdentityInput,
): string | null => {
  if (input.patientId && input.patientId.trim().length > 0) {
    return `pid:${input.patientId.trim()}`;
  }

  const patientNumberKey = normalizePatientNumberKey(input.patientNumber);
  if (patientNumberKey) {
    return `pn:${patientNumberKey}`;
  }

  const nameBase =
    input.patientNameNormalized ??
    normalizeNameForMatching(input.patientName);

  if (nameBase && input.birthDateIso) {
    return `nb:${nameBase}|${input.birthDateIso}`;
  }

  if (nameBase) {
    return `n:${nameBase}`;
  }

  return null;
};

export type PatientEvent = {
  identityKey: string | null;
  occurredAt: string | null | undefined;
};

/**
 * Builds a map of the first seen timestamp for each patient identity key.
 * @returns Map<identityKey, occurredAtISO>
 */
export const buildFirstSeenIndex = (
  events: PatientEvent[],
): Map<string, string> => {
  const result = new Map<string, string>();
  for (const event of events) {
    if (!event || !event.identityKey || !isValidIsoLike(event.occurredAt)) {
      continue;
    }
    const iso = event.occurredAt as string;
    const previous = result.get(event.identityKey);
    if (!previous || iso.localeCompare(previous) < 0) {
      result.set(event.identityKey, iso);
    }
  }
  return result;
};
