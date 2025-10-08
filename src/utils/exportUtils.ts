import type {
  MarumieSnapshot,
  SerializedListingRecord,
  SerializedSurveyRecord,
  SerializedReservationRecord
} from '../types/snapshot';

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function buildFileSuffix(baseDate?: string): string {
  const date = baseDate ? new Date(baseDate) : new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}`;
}

function escapeCsv(value: string): string {
  if (value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  if (value.includes(',') || value.includes('\n')) {
    return `"${value}"`;
  }
  return value;
}

function stringify(value: number | string | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return String(value);
}

export function downloadSnapshotJson(snapshot: MarumieSnapshot) {
  const content = JSON.stringify(snapshot, null, 2);
  const fileName = `marumie_data_${buildFileSuffix(snapshot.savedAt)}.json`;
  const blob = new Blob([content], { type: 'application/json' });
  triggerDownload(blob, fileName);
}

function appendListingRows(
  rows: string[][],
  category: string,
  records: SerializedListingRecord[]
) {
  records.forEach(record => {
    const row = new Array(16 + 24).fill('');
    row[0] = 'listing';
    row[1] = category;
    row[2] = record.date ?? '';
    row[9] = stringify(record.amount);
    row[10] = stringify(record.cv);
    row[11] = stringify(record.cvr);
    row[12] = stringify(record.cpa);
    (record.hourlyCV ?? []).forEach((value: number | null, hour: number) => {
      row[16 + hour] = stringify(value ?? null);
    });
    rows.push(row);
  });
}

function appendReservationRows(rows: string[][], records: SerializedReservationRecord[]) {
  records.forEach(record => {
    const row = new Array(16 + 24).fill('');
    row[0] = 'reservation';
    row[2] = record.dateTime ? record.dateTime.slice(0, 10) : '';
    row[3] = record.dateTime ?? '';
    row[4] = record.department ?? '';
    row[5] = record.departmentGroup ?? '';
    row[6] = record.type ?? '';
    row[13] = stringify(record.count);
    row[15] = stringify(record.isSameDay);
    rows.push(row);
  });
}

function appendSurveyRows(
  rows: string[][],
  category: string,
  records: SerializedSurveyRecord[]
) {
  records.forEach(record => {
    const channelEntries = Object.entries(record.channels ?? {}) as Array<[string, number | null]>;
    channelEntries.forEach(([channel, value]) => {
      const row = new Array(16 + 24).fill('');
      row[0] = 'survey';
      row[1] = category;
      row[2] = record.date ?? '';
      row[7] = channel;
      row[8] = '回答数';
      row[14] = stringify(value ?? null);
      rows.push(row);
    });

    if (record.feverGoogle !== null && record.feverGoogle !== undefined) {
      const row = new Array(16 + 24).fill('');
      row[0] = 'survey';
      row[1] = `${category}-fever`;
      row[2] = record.date ?? '';
      row[7] = '発熱外来(Google)';
      row[8] = '回答数';
      row[14] = stringify(record.feverGoogle ?? null);
      rows.push(row);
    }
  });
}

export function buildUnifiedCsv(snapshot: MarumieSnapshot): string {
  const headers = [
    'dataset',
    'category',
    'date',
    'datetime',
    'department',
    'departmentGroup',
    'type',
    'channel',
    'metric',
    'amount',
    'cv',
    'cvr',
    'cpa',
    'count',
    'value',
    'isSameDay',
    ...Array.from({ length: 24 }, (_, hour) => `hour_${hour}`)
  ];

  const rows: string[][] = [headers];

  const metaRow = new Array(headers.length).fill('');
  metaRow[0] = 'meta';
  metaRow[1] = 'version';
  metaRow[2] = snapshot.version ?? '';
  metaRow[3] = 'savedAt';
  metaRow[4] = snapshot.savedAt ?? '';
  rows.push(metaRow);

  appendListingRows(rows, 'internal', snapshot.data.listingInternal ?? []);
  appendListingRows(rows, 'gastroscopy', snapshot.data.listingGastroscopy ?? []);
  appendListingRows(rows, 'colonoscopy', snapshot.data.listingColonoscopy ?? []);
  appendReservationRows(rows, snapshot.data.reservations ?? []);
  appendSurveyRows(rows, 'outpatient', snapshot.data.surveyOutpatient ?? []);
  appendSurveyRows(rows, 'endoscopy', snapshot.data.surveyEndoscopy ?? []);

  return rows
    .map(row => row.map(cell => escapeCsv(cell)).join(','))
    .join('\r\n');
}

export function downloadUnifiedCsv(snapshot: MarumieSnapshot) {
  const csv = buildUnifiedCsv(snapshot);
  const fileName = `marumie_unified_${buildFileSuffix(snapshot.savedAt)}.csv`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, fileName);
}
