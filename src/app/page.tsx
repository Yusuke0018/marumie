"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { RefreshCw, Upload } from "lucide-react";
import Papa from "papaparse";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type VisitType = "初診" | "再診" | "未設定";

type Reservation = {
  key: string;
  department: string;
  visitType: VisitType;
  reservationDate: string;
  reservationMonth: string;
  reservationHour: number;
  receivedAtIso: string;
  appointmentIso: string | null;
  patientId: string;
  isSameDay: boolean;
};

type HourlyBucket = {
  hour: string;
  total: number;
  初診: number;
  再診: number;
};

type DailyBucket = {
  date: string;
  total: number;
};

type MonthlyBucket = {
  month: string;
  total: number;
  初診: number;
  再診: number;
  当日予約: number;
};

type ParsedDateTime = {
  iso: string;
  dateKey: string;
  monthKey: string;
  hour: number;
};

const STORAGE_KEY = "clinic-analytics/reservations/v1";
const TIMESTAMP_KEY = "clinic-analytics/last-updated/v1";
const HOURS = Array.from({ length: 24 }, (_, index) => index);

const hourLabel = (hour: number) => `${hour.toString().padStart(2, "0")}:00`;

const createEmptyHourlyBuckets = (): HourlyBucket[] =>
  HOURS.map((hour) => ({
    hour: hourLabel(hour),
    total: 0,
    初診: 0,
    再診: 0,
  }));

const createReservationKey = (payload: {
  department: string;
  visitType: VisitType;
  receivedIso: string;
  patientId: string;
  appointmentIso: string | null;
}) =>
  [
    payload.department,
    payload.visitType,
    payload.receivedIso,
    payload.patientId,
    payload.appointmentIso ?? "",
  ].join("|");

const normalizeVisitType = (value: string | undefined): VisitType => {
  if (!value) {
    return "未設定";
  }
  const trimmed = value.trim();
  if (trimmed === "初診" || trimmed === "再診") {
    return trimmed;
  }
  return "未設定";
};

const parseJstDateTime = (raw: string | undefined): ParsedDateTime | null => {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const [datePart, timePartRaw = "00:00"] = trimmed.split(" ");
  const [yearStr, monthStr, dayStr] = datePart.split("/");
  const [hourStr, minuteStr = "00"] = timePartRaw.split(":");

  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    Number.isNaN(hour) ||
    Number.isNaN(minute)
  ) {
    return null;
  }

  const mm = month.toString().padStart(2, "0");
  const dd = day.toString().padStart(2, "0");
  const hh = hour.toString().padStart(2, "0");
  const mi = minute.toString().padStart(2, "0");

  return {
    iso: `${year}-${mm}-${dd}T${hh}:${mi}:00+09:00`,
    dateKey: `${year}-${mm}-${dd}`,
    monthKey: `${year}-${mm}`,
    hour,
  };
};

const parseCsv = (content: string): Reservation[] => {
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message ?? "CSV parsing error");
  }

  const items: Reservation[] = [];

  for (const row of parsed.data) {
    const department = row["診療科"]?.trim();
    const received = parseJstDateTime(row["受信時刻JST"]);
    if (!department || !received) {
      continue;
    }

    const visitType = normalizeVisitType(row["初再診"]);
    const appointment = parseJstDateTime(row["予約日時"]);
    const patientId = row["患者ID"]?.trim() ?? "";

    const reservation: Reservation = {
      key: createReservationKey({
        department,
        visitType,
        receivedIso: received.iso,
        patientId,
        appointmentIso: appointment?.iso ?? null,
      }),
      department,
      visitType,
      reservationDate: received.dateKey,
      reservationMonth: received.monthKey,
      reservationHour: received.hour,
      receivedAtIso: received.iso,
      appointmentIso: appointment?.iso ?? null,
      patientId,
      isSameDay: (row["当日予約"] ?? "").trim().toLowerCase() === "true",
    };

    items.push(reservation);
  }

  const deduplicated = new Map<string, Reservation>();
  for (const item of items) {
    deduplicated.set(item.key, item);
  }

  return Array.from(deduplicated.values()).sort((a, b) =>
    a.receivedAtIso.localeCompare(b.receivedAtIso),
  );
};

const aggregateHourly = (reservations: Reservation[]): HourlyBucket[] => {
  const buckets = createEmptyHourlyBuckets();
  for (const reservation of reservations) {
    if (
      Number.isNaN(reservation.reservationHour) ||
      reservation.reservationHour < 0 ||
      reservation.reservationHour > 23
    ) {
      continue;
    }
    const bucket = buckets[reservation.reservationHour];
    if (!bucket) {
      continue;
    }
    if (!bucket) {
      continue;
    }
    bucket.total += 1;
    if (reservation.visitType === "初診" || reservation.visitType === "再診") {
      bucket[reservation.visitType] += 1;
    }
  }
  return buckets;
};

const aggregateDaily = (reservations: Reservation[]): DailyBucket[] => {
  const counts = new Map<string, number>();
  for (const reservation of reservations) {
    counts.set(
      reservation.reservationDate,
      (counts.get(reservation.reservationDate) ?? 0) + 1,
    );
  }

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total }));
};

const aggregateMonthly = (reservations: Reservation[]): MonthlyBucket[] => {
  const counts = new Map<string, MonthlyBucket>();
  for (const reservation of reservations) {
    const key = reservation.reservationMonth;
    const bucket =
      counts.get(key) ??
      ({
        month: key,
        total: 0,
        初診: 0,
        再診: 0,
        当日予約: 0,
      } satisfies MonthlyBucket);

    bucket.total += 1;
    if (reservation.visitType === "初診" || reservation.visitType === "再診") {
      bucket[reservation.visitType] += 1;
    }
    if (reservation.isSameDay) {
      bucket["当日予約"] += 1;
    }
    counts.set(key, bucket);
  }

  return Array.from(counts.values()).sort((a, b) => a.month.localeCompare(b.month));
};

const aggregateDepartmentHourly = (
  reservations: Reservation[],
): Array<{ department: string; data: HourlyBucket[] }> => {
  const byDepartment = new Map<string, HourlyBucket[]>();

  for (const reservation of reservations) {
    if (!byDepartment.has(reservation.department)) {
      byDepartment.set(reservation.department, createEmptyHourlyBuckets());
    }
    const buckets = byDepartment.get(reservation.department);
    if (!buckets) {
      continue;
    }
    if (
      Number.isNaN(reservation.reservationHour) ||
      reservation.reservationHour < 0 ||
      reservation.reservationHour > 23
    ) {
      continue;
    }
    const bucket = buckets[reservation.reservationHour];
    if (!bucket) {
      continue;
    }
    bucket.total += 1;
    if (reservation.visitType === "初診" || reservation.visitType === "再診") {
      bucket[reservation.visitType] += 1;
    }
  }

  return Array.from(byDepartment.entries())
    .map(([department, data]) => ({
      department,
      data,
    }))
    .sort((a, b) => a.department.localeCompare(b.department, "ja"));
};

const tooltipFormatter = (value: unknown, name: string): [string, string] => {
  if (typeof value === "number") {
    return [value.toLocaleString("ja-JP"), name];
  }
  return ["0", name];
};

const formatMonthLabel = (month: string) => {
  const [year, monthStr] = month.split("-");
  return `${year}年${Number(monthStr)}月`;
};

type SectionCardProps = {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
};

const SectionCard = ({ title, description, action, children }: SectionCardProps) => (
  <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
    <header className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {description && <p className="text-sm text-slate-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
    {children}
  </section>
);

const StatCard = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "brand" | "accent" | "muted" | "emerald";
}) => {
  const toneClass =
    tone === "brand"
      ? "text-brand-600"
      : tone === "accent"
        ? "text-accent-600"
        : tone === "emerald"
          ? "text-emerald-600"
          : "text-slate-900";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className={`mt-2 text-2xl font-bold ${toneClass}`}>{value}</dd>
    </div>
  );
};

export default function HomePage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [diffMonthly, setDiffMonthly] = useState<MonthlyBucket[] | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: Reservation[] = JSON.parse(stored);
        setReservations(parsed);
      }
      const storedTimestamp = window.localStorage.getItem(TIMESTAMP_KEY);
      if (storedTimestamp) {
        setLastUpdated(storedTimestamp);
      }
    } catch (error) {
      console.error(error);
      setUploadError("保存済みデータの読み込みに失敗しました。");
    }
  }, []);

  const overallHourly = useMemo(
    () => aggregateHourly(reservations),
    [reservations],
  );

  const overallDaily = useMemo(
    () => aggregateDaily(reservations),
    [reservations],
  );

  const departmentHourly = useMemo(
    () => aggregateDepartmentHourly(reservations),
    [reservations],
  );

  const monthlyOverview = useMemo(
    () => aggregateMonthly(reservations),
    [reservations],
  );

  const totalReservations = reservations.length;
  const initialCount = reservations.filter((item) => item.visitType === "初診").length;
  const followupCount = reservations.filter((item) => item.visitType === "再診").length;
  const departmentCount = useMemo(
    () => new Set(reservations.map((item) => item.department)).size,
    [reservations],
  );

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploadError(null);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);

      const existingKeys = new Set(reservations.map((item) => item.key));
      const newlyAdded = parsed.filter((item) => !existingKeys.has(item.key));

      const mergedMap = new Map<string, Reservation>();
      for (const item of reservations) {
        mergedMap.set(item.key, item);
      }
      for (const item of parsed) {
        mergedMap.set(item.key, item);
      }

      const merged = Array.from(mergedMap.values()).sort((a, b) =>
        a.receivedAtIso.localeCompare(b.receivedAtIso),
      );

      setReservations(merged);
      setDiffMonthly(newlyAdded.length > 0 ? aggregateMonthly(newlyAdded) : []);

      const timestamp = new Date().toISOString();
      setLastUpdated(timestamp);

      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        window.localStorage.setItem(TIMESTAMP_KEY, timestamp);
      }
    } catch (error) {
      console.error(error);
      setUploadError("CSVの解析に失敗しました。フォーマットをご確認ください。");
    } finally {
      event.target.value = "";
    }
  };

  const handleReset = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(TIMESTAMP_KEY);
    setReservations([]);
    setDiffMonthly(null);
    setLastUpdated(null);
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
        <section className="relative overflow-hidden rounded-3xl border border-sky-100 bg-gradient-to-r from-white via-sky-50 to-emerald-50 p-8 shadow-card">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-brand-600">
                Team Mirai Analytics Suite
              </p>
              <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">
                マルミエ
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                マルミエは、CSVをアップロードすると予約受付時刻を基準に初診・再診や診療科別の傾向を自動集計します。
                集計結果はブラウザに安全に保存され、再訪時も続きから確認できます。
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-600">
                <Upload className="h-4 w-4" />
                CSVを選択
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center justify-center gap-2 rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-600 transition hover:border-brand-200 hover:text-brand-600"
              >
                <RefreshCw className="h-4 w-4" />
                保存内容をリセット
              </button>
            </div>
          </div>
          {lastUpdated && (
            <p className="mt-6 text-xs font-medium text-slate-500">
              最終更新: {new Date(lastUpdated).toLocaleString("ja-JP")}
            </p>
          )}
          {uploadError && (
            <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {uploadError}
            </p>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="総予約数"
            value={totalReservations.toLocaleString("ja-JP")}
            tone="brand"
          />
          <StatCard
            label="初診"
            value={initialCount.toLocaleString("ja-JP")}
            tone="brand"
          />
          <StatCard
            label="再診"
            value={followupCount.toLocaleString("ja-JP")}
            tone="accent"
          />
          <StatCard
            label="診療科数"
            value={departmentCount.toLocaleString("ja-JP")}
            tone="muted"
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard title="時間帯別 予約数（受付基準）" description="1時間単位で予約受付が集中する時間帯を可視化します。">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={overallHourly}>
                  <CartesianGrid stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
                  <XAxis dataKey="hour" stroke="#64748B" />
                  <YAxis stroke="#64748B" />
                  <Tooltip formatter={tooltipFormatter} />
                  <Legend />
                  <Bar dataKey="total" fill="#3B82F6" name="総数" />
                  <Bar dataKey="初診" fill="#60A5FA" name="初診" />
                  <Bar dataKey="再診" fill="#10B981" name="再診" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          <SectionCard title="日別 予約推移（受付基準）" description="日ごとの予約受付件数の推移を確認できます。">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={overallDaily}>
                  <CartesianGrid stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
                  <XAxis dataKey="date" stroke="#64748B" />
                  <YAxis stroke="#64748B" />
                  <Tooltip formatter={tooltipFormatter} />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="#2563EB"
                    strokeWidth={2}
                    dot={false}
                    name="総数"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </div>

        <SectionCard
          title="月次サマリ（受付基準）"
          description="CSVに含まれる予約受付データを月単位で集計しています。"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">月</th>
                  <th className="px-3 py-2">総数</th>
                  <th className="px-3 py-2">初診</th>
                  <th className="px-3 py-2">再診</th>
                  <th className="px-3 py-2">当日予約</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {monthlyOverview.map((row) => (
                  <tr key={row.month} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {formatMonthLabel(row.month)}
                    </td>
                    <td className="px-3 py-2">
                      {row.total.toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      {row["初診"].toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      {row["再診"].toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      {row["当日予約"].toLocaleString("ja-JP")}
                    </td>
                  </tr>
                ))}
                {monthlyOverview.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                      集計対象のデータがありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {diffMonthly && diffMonthly.length > 0 && (
          <SectionCard
            title="最新アップロードの差分"
            description="直近で追加された予約受付のみを月単位でハイライト表示します。"
          >
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">月</th>
                    <th className="px-3 py-2">総数</th>
                    <th className="px-3 py-2">初診</th>
                    <th className="px-3 py-2">再診</th>
                    <th className="px-3 py-2">当日予約</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {diffMonthly.map((row) => (
                    <tr key={row.month} className="hover:bg-emerald-50/60">
                      <td className="px-3 py-2 font-medium text-emerald-700">
                        {formatMonthLabel(row.month)}
                      </td>
                      <td className="px-3 py-2">
                        {row.total.toLocaleString("ja-JP")}
                      </td>
                      <td className="px-3 py-2">
                        {row["初診"].toLocaleString("ja-JP")}
                      </td>
                      <td className="px-3 py-2">
                        {row["再診"].toLocaleString("ja-JP")}
                      </td>
                      <td className="px-3 py-2">
                        {row["当日予約"].toLocaleString("ja-JP")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        <SectionCard
          title="診療科別の時間帯分布（受付基準）"
          description="診療科ごとに初診・再診の受付時間帯をラインチャートで比較できます。"
        >
          <div className="flex flex-col gap-4">
            {departmentHourly.map(({ department, data }) => (
              <details
                key={department}
                className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-soft transition hover:border-brand-200"
              >
                <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-slate-800 outline-none transition group-open:text-brand-600">
                  {department}
                  <span className="text-xs font-medium text-slate-400 group-open:text-brand-400">
                    詳細を見る
                  </span>
                </summary>
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data}>
                      <CartesianGrid stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
                      <XAxis dataKey="hour" stroke="#64748B" />
                      <YAxis stroke="#64748B" />
                      <Tooltip formatter={tooltipFormatter} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="初診"
                        stroke="#3B82F6"
                        strokeWidth={2}
                        dot={false}
                        name="初診"
                      />
                      <Line
                        type="monotone"
                        dataKey="再診"
                        stroke="#10B981"
                        strokeWidth={2}
                        dot={false}
                        name="再診"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </details>
            ))}
            {departmentHourly.length === 0 && (
              <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                集計対象のデータがありません。CSVをアップロードしてください。
              </p>
            )}
          </div>
        </SectionCard>
      </div>
    </main>
  );
}
