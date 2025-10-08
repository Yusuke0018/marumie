"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
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
  receivedAt: string;
  department: string;
  visitType: VisitType;
  appointmentDate: string;
  appointmentDateTime: string;
  appointmentHour: number;
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

const STORAGE_KEY = "clinic-analytics/reservations/v1";
const TIMESTAMP_KEY = "clinic-analytics/last-updated/v1";
const HOURS = Array.from({ length: 24 }, (_, index) => index);

const hourLabel = (hour: number) => `${hour.toString().padStart(2, "0")}:00`;

const createReservationKey = (payload: {
  department: string;
  visitType: VisitType;
  appointmentDateTime: string;
  patientId: string;
}) =>
  [
    payload.department,
    payload.visitType,
    payload.appointmentDateTime,
    payload.patientId,
  ].join("|");

const parseAppointmentDateTime = (raw: string | undefined): Date | null => {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const [datePart, timePartOrUndefined] = trimmed.split(" ");
  const safeDate = datePart.replace(/\//g, "-");
  const timePart = (timePartOrUndefined ?? "00:00")
    .split(":")
    .map((segment, idx) =>
      idx === 0 ? segment.padStart(2, "0") : segment.padStart(2, "0"),
    )
    .join(":");

  const isoCandidate = `${safeDate}T${timePart}`;
  const parsed = new Date(isoCandidate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

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

const parseCsv = (content: string): Reservation[] => {
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message ?? "CSV parse error");
  }

  const items: Reservation[] = [];
  for (const row of parsed.data) {
    const department = row["診療科"]?.trim();
    const appointmentDateTimeRaw = row["予約日時"];
    const appointmentDateTime = parseAppointmentDateTime(appointmentDateTimeRaw);
    if (!department || !appointmentDateTime) {
      continue;
    }

    const visitType = normalizeVisitType(row["初再診"]);
    const formattedDate = `${appointmentDateTime.getFullYear()}-${(
      appointmentDateTime.getMonth() + 1
    )
      .toString()
      .padStart(2, "0")}-${appointmentDateTime
      .getDate()
      .toString()
      .padStart(2, "0")}`;

    const reservation: Reservation = {
      department,
      visitType,
      appointmentDate: formattedDate,
      appointmentDateTime: appointmentDateTime.toISOString(),
      appointmentHour: appointmentDateTime.getHours(),
      patientId: row["患者ID"]?.trim() ?? "",
      receivedAt: row["受信時刻JST"]?.trim() ?? "",
      isSameDay: (row["当日予約"] ?? "").trim().toLowerCase() === "true",
      key: createReservationKey({
        department,
        visitType,
        appointmentDateTime: appointmentDateTime.toISOString(),
        patientId: row["患者ID"]?.trim() ?? "",
      }),
    };

    items.push(reservation);
  }

  const deduplicated = new Map<string, Reservation>();
  for (const item of items) {
    deduplicated.set(item.key, item);
  }

  return Array.from(deduplicated.values()).sort((a, b) =>
    a.appointmentDateTime.localeCompare(b.appointmentDateTime),
  );
};

const aggregateHourly = (reservations: Reservation[]): HourlyBucket[] => {
  const map = new Map<number, HourlyBucket>();
  for (const hour of HOURS) {
    map.set(hour, {
      hour: hourLabel(hour),
      total: 0,
      初診: 0,
      再診: 0,
    });
  }

  for (const reservation of reservations) {
    const bucket = map.get(reservation.appointmentHour);
    if (!bucket) {
      continue;
    }
    bucket.total += 1;
    if (reservation.visitType === "初診" || reservation.visitType === "再診") {
      bucket[reservation.visitType] += 1;
    }
  }

  return Array.from(map.values());
};

const aggregateDaily = (reservations: Reservation[]): DailyBucket[] => {
  const counts = new Map<string, number>();
  for (const reservation of reservations) {
    counts.set(
      reservation.appointmentDate,
      (counts.get(reservation.appointmentDate) ?? 0) + 1,
    );
  }

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total }));
};

const aggregateMonthly = (reservations: Reservation[]): MonthlyBucket[] => {
  const counts = new Map<string, MonthlyBucket>();
  for (const reservation of reservations) {
    const [year, month] = reservation.appointmentDate.split("-");
    const key = `${year}-${month}`;
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
      byDepartment.set(reservation.department, aggregateHourly([]));
    }
    const buckets = byDepartment.get(reservation.department);
    if (!buckets) {
      continue;
    }
    const bucket = buckets[reservation.appointmentHour];
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
  const initialCount = reservations.filter(
    (item) => item.visitType === "初診",
  ).length;
  const followupCount = reservations.filter(
    (item) => item.visitType === "再診",
  ).length;

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
        a.appointmentDateTime.localeCompare(b.appointmentDateTime),
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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10">
      <section className="flex flex-col gap-4 rounded-2xl bg-midnight-900/60 p-6 shadow-lg shadow-midnight-950/60">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl">予約ログ分析ダッシュボード</h1>
          <p className="text-sm text-midnight-200">
            CSVをアップロードすると、予約状況が自動で集計されます。直近の集計結果はブラウザに保存され、再訪時にも確認できます。
          </p>
        </header>
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex cursor-pointer items-center gap-3 rounded-xl bg-midnight-800 px-4 py-3 text-sm font-semibold text-midnight-100 transition hover:bg-midnight-700">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            CSVを選択
          </label>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-xl border border-midnight-700 px-4 py-2 text-sm text-midnight-200 transition hover:bg-midnight-800"
          >
            保存内容をリセット
          </button>
          {lastUpdated && (
            <span className="text-xs text-midnight-300">
              最終更新: {new Date(lastUpdated).toLocaleString("ja-JP")}
            </span>
          )}
        </div>
        {uploadError && (
          <p className="rounded-xl border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-200">
            {uploadError}
          </p>
        )}
        <dl className="grid grid-cols-1 gap-4 rounded-2xl border border-midnight-800 bg-midnight-900/50 p-4 md:grid-cols-4">
          <div className="flex flex-col gap-1 rounded-xl bg-midnight-800/40 p-3">
            <dt className="text-xs text-midnight-300">総予約数</dt>
            <dd className="text-xl font-semibold text-midnight-50">
              {totalReservations.toLocaleString("ja-JP")}
            </dd>
          </div>
          <div className="flex flex-col gap-1 rounded-xl bg-midnight-800/40 p-3">
            <dt className="text-xs text-midnight-300">初診</dt>
            <dd className="text-xl font-semibold text-cyan-200">
              {initialCount.toLocaleString("ja-JP")}
            </dd>
          </div>
          <div className="flex flex-col gap-1 rounded-xl bg-midnight-800/40 p-3">
            <dt className="text-xs text-midnight-300">再診</dt>
            <dd className="text-xl font-semibold text-emerald-200">
              {followupCount.toLocaleString("ja-JP")}
            </dd>
          </div>
          <div className="flex flex-col gap-1 rounded-xl bg-midnight-800/40 p-3">
            <dt className="text-xs text-midnight-300">診療科数</dt>
            <dd className="text-xl font-semibold text-amber-200">
              {
                new Set(reservations.map((item) => item.department)).size
                  .toLocaleString("ja-JP")
              }
            </dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <article className="flex flex-col gap-4 rounded-2xl border border-midnight-800 bg-midnight-900/60 p-5">
          <h2 className="text-lg">時間帯別 予約数（全体）</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={overallHourly}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="hour" stroke="#b0b8ca" />
                <YAxis stroke="#b0b8ca" />
                <Tooltip formatter={tooltipFormatter} />
                <Legend />
                <Bar dataKey="total" fill="#60a5fa" name="総数" />
                <Bar dataKey="初診" fill="#38bdf8" name="初診" />
                <Bar dataKey="再診" fill="#34d399" name="再診" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
        <article className="flex flex-col gap-4 rounded-2xl border border-midnight-800 bg-midnight-900/60 p-5">
          <h2 className="text-lg">日別 予約推移（全体）</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={overallDaily}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="date" stroke="#b0b8ca" />
                <YAxis stroke="#b0b8ca" />
                <Tooltip formatter={tooltipFormatter} />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={false}
                  name="総数"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-midnight-800 bg-midnight-900/60 p-6">
        <header className="mb-4">
          <h2 className="text-lg">月次サマリ</h2>
          <p className="text-xs text-midnight-300">
            CSVに含まれる予約を月単位で集計しています。
          </p>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-midnight-800 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-midnight-300">
                <th className="px-3 py-2">月</th>
                <th className="px-3 py-2">総数</th>
                <th className="px-3 py-2">初診</th>
                <th className="px-3 py-2">再診</th>
                <th className="px-3 py-2">当日予約</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-midnight-800">
              {monthlyOverview.map((row) => (
                <tr key={row.month} className="hover:bg-midnight-800/40">
                  <td className="px-3 py-2 font-medium text-midnight-100">
                    {row.month}
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
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-midnight-300"
                  >
                    集計対象のデータがありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {diffMonthly && diffMonthly.length > 0 && (
        <section className="rounded-2xl border border-cyan-500/40 bg-cyan-950/20 p-6">
          <header className="mb-4">
            <h2 className="text-lg text-cyan-100">最新アップロードの差分</h2>
            <p className="text-xs text-cyan-200">
              直近で追加された予約のみを月単位で表示しています。
            </p>
          </header>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-cyan-800/40 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-cyan-200/90">
                  <th className="px-3 py-2">月</th>
                  <th className="px-3 py-2">総数</th>
                  <th className="px-3 py-2">初診</th>
                  <th className="px-3 py-2">再診</th>
                  <th className="px-3 py-2">当日予約</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cyan-800/30">
                {diffMonthly.map((row) => (
                  <tr key={row.month} className="hover:bg-cyan-900/40">
                    <td className="px-3 py-2 font-medium text-cyan-100">
                      {row.month}
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
        </section>
      )}

      <section className="flex flex-col gap-4 rounded-2xl border border-midnight-800 bg-midnight-900/60 p-6">
        <header>
          <h2 className="text-lg">診療科別 初診・再診の時間帯分布</h2>
          <p className="text-xs text-midnight-300">
            診療科ごとに1時間単位で初診・再診の予約数を可視化しています。
          </p>
        </header>
        <div className="flex flex-col gap-6">
          {departmentHourly.map(({ department, data }) => (
            <details
              key={department}
              className="rounded-xl border border-midnight-800 bg-midnight-900/70 p-4"
            >
              <summary className="cursor-pointer list-none text-sm font-semibold text-midnight-100">
                {department}
              </summary>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data}>
                    <CartesianGrid
                      stroke="rgba(255,255,255,0.05)"
                      vertical={false}
                    />
                    <XAxis dataKey="hour" stroke="#b0b8ca" />
                    <YAxis stroke="#b0b8ca" />
                    <Tooltip formatter={tooltipFormatter} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="初診"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      dot={false}
                      name="初診"
                    />
                    <Line
                      type="monotone"
                      dataKey="再診"
                      stroke="#34d399"
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
            <p className="rounded-xl border border-midnight-800 bg-midnight-900/60 px-4 py-6 text-center text-sm text-midnight-300">
              集計対象のデータがありません。CSVをアップロードしてください。
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
