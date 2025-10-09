"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  RefreshCw,
  Share2,
  Upload,
  Link as LinkIcon,
  Users,
  UserPlus,
  RotateCcw,
  Undo2,
  Clock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Papa from "papaparse";
import { uploadDataToR2, fetchDataFromR2 } from "@/lib/dataShare";
import {
  aggregateKarteMonthly,
  classifyKarteRecords,
  type KarteMonthlyStat,
  type KarteRecord,
  type KarteRecordWithCategory,
} from "@/lib/karteAnalytics";
import type { PeriodType } from "@/lib/dateUtils";

const KARTE_STORAGE_KEY = "clinic-analytics/karte-records/v1";
const KARTE_TIMESTAMP_KEY = "clinic-analytics/karte-last-updated/v1";
const KARTE_MIN_MONTH = "2025-10";
const PERIOD_MONTHS: Record<Exclude<PeriodType, "all">, number> = {
  "3months": 3,
  "6months": 6,
  "1year": 12,
};

const roundTo1Decimal = (value: number) => Math.round(value * 10) / 10;

const calculateAge = (birthIso: string | null, visitIso: string): number | null => {
  if (!birthIso) {
    return null;
  }
  const birthDate = new Date(birthIso);
  const visitDate = new Date(visitIso);
  if (Number.isNaN(birthDate.getTime()) || Number.isNaN(visitDate.getTime())) {
    return null;
  }
  let age = visitDate.getFullYear() - birthDate.getFullYear();
  const visitMonth = visitDate.getMonth();
  const birthMonth = birthDate.getMonth();
  if (
    visitMonth < birthMonth ||
    (visitMonth === birthMonth && visitDate.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }
  return age >= 0 && age < 130 ? age : null;
};

type DepartmentStat = {
  department: string;
  total: number;
  pureFirst: number;
  returningFirst: number;
  revisit: number;
  averageAge: number | null;
  pureRate: number;
  returningRate: number;
  revisitRate: number;
};

const DepartmentMetric = ({
  icon: Icon,
  label,
  value,
  accent,
  caption,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  accent: "brand" | "emerald" | "accent" | "muted";
  caption?: string | null;
}) => {
  const accentClass =
    accent === "brand"
      ? "bg-brand-50 text-brand-600"
      : accent === "emerald"
        ? "bg-emerald-50 text-emerald-600"
        : accent === "accent"
          ? "bg-accent-50 text-accent-600"
          : "bg-slate-100 text-slate-600";

  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white/60 px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-full ${accentClass}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs font-semibold text-slate-500">{label}</span>
      </div>
      <div className="flex flex-col items-end">
        <span className="text-sm font-semibold text-slate-900">{value}</span>
        {caption && <span className="text-[11px] font-medium text-slate-400">{caption}</span>}
      </div>
    </div>
  );
};

const removeBom = (value: string) => value.replace(/^\uFEFF/, "");

const normalizeCsvRow = (row: Record<string, string | undefined>) => {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = removeBom(key).trim();
    normalized[normalizedKey] =
      typeof value === "string" ? value.trim() || undefined : value;
  }
  return normalized;
};

const parseSlashDate = (raw: string | undefined) => {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parts = trimmed.split("/");
  if (parts.length < 3) {
    return null;
  }
  const [yearStr, monthStr, dayStr] = parts;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  return new Date(year, month - 1, day);
};

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parsePatientNumber = (raw: string | undefined) => {
  if (!raw) {
    return null;
  }
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 0) {
    return null;
  }
  const value = Number.parseInt(digits, 10);
  if (!Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
};

const parseKarteCsv = (text: string): KarteRecord[] => {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message ?? "CSV parsing error");
  }

  const records: KarteRecord[] = [];

  for (const rawRow of parsed.data) {
    const row = normalizeCsvRow(rawRow);
    const visitDate = parseSlashDate(row["日付"]);
    if (!visitDate) {
      continue;
    }

    const dateIso = formatDateKey(visitDate);
    const monthKey = dateIso.slice(0, 7);

    const visitTypeRaw = row["初診・再診"] ?? "";
    const visitType =
      visitTypeRaw === "初診" ? "初診" : visitTypeRaw === "再診" ? "再診" : "不明";

    const patientNumber = parsePatientNumber(row["患者番号"]);
    const birthDate = parseSlashDate(row["患者生年月日"]);
    const birthDateIso = birthDate ? formatDateKey(birthDate) : null;
    const department = row["診療科"]?.trim() ?? "";

    records.push({
      dateIso,
      monthKey,
      visitType,
      patientNumber,
      birthDateIso,
      department,
    });
  }

  if (records.length === 0) {
    throw new Error("有効なカルテ集計データが見つかりませんでした。");
  }

  records.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  return records;
};

const formatMonthLabel = (month: string) => {
  const [year, monthStr] = month.split("-");
  if (!year || !monthStr) {
    return month;
  }
  const numericMonth = Number(monthStr);
  if (Number.isNaN(numericMonth)) {
    return month;
  }
  return `${year}年${numericMonth}月`;
};

type SectionCardProps = {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
};

const SectionCard = ({ title, description, action, children }: SectionCardProps) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft sm:rounded-3xl sm:p-6">
    <header className="mb-3 flex flex-col gap-2 sm:mb-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">{title}</h2>
        {description && (
          <p className="text-xs leading-relaxed text-slate-500 sm:text-sm">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
    <div className="sm:pt-1">{children}</div>
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
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-card sm:p-4">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
        {label}
      </dt>
      <dd className={`mt-1 text-xl font-bold sm:mt-2 sm:text-2xl ${toneClass}`}>{value}</dd>
    </div>
  );
};

export default function PatientAnalysisPage() {
  const [records, setRecords] = useState<KarteRecord[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isLoadingShared, setIsLoadingShared] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>("all");
  const [selectedMonth, setSelectedMonth] = useState<string>("all");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const dataId = params.get("data");
    setIsReadOnly(Boolean(dataId));

    if (dataId) {
      setIsLoadingShared(true);
      fetchDataFromR2(dataId)
        .then((response) => {
          if (response.type === "karte") {
            try {
              const parsed: KarteRecord[] = JSON.parse(response.data);
              setRecords(parsed);
              setLastUpdated(response.uploadedAt);
              window.localStorage.setItem(KARTE_STORAGE_KEY, JSON.stringify(parsed));
              window.localStorage.setItem(KARTE_TIMESTAMP_KEY, response.uploadedAt);
            } catch (error) {
              console.error(error);
              setUploadError("共有データの読み込みに失敗しました。");
            }
          } else {
            setUploadError("カルテ集計データではない共有リンクです。");
          }
        })
        .catch((error) => {
          console.error(error);
          setUploadError(`共有データの読み込みに失敗しました: ${(error as Error).message}`);
        })
        .finally(() => {
          setIsLoadingShared(false);
        });
    } else {
      try {
        const stored = window.localStorage.getItem(KARTE_STORAGE_KEY);
        if (stored) {
          const parsed: KarteRecord[] = JSON.parse(stored);
          setRecords(parsed);
        }
        const storedTimestamp = window.localStorage.getItem(KARTE_TIMESTAMP_KEY);
        if (storedTimestamp) {
          setLastUpdated(storedTimestamp);
        }
      } catch (error) {
        console.error(error);
        setUploadError("保存済みデータの読み込みに失敗しました。");
      }
    }
  }, []);

  const classifiedRecords = useMemo<KarteRecordWithCategory[]>(() => {
    if (records.length === 0) {
      return [];
    }
    return classifyKarteRecords(records);
  }, [records]);
  const periodFilteredRecords = useMemo(() => {
    if (classifiedRecords.length === 0) {
      return [];
    }
    let filtered = classifiedRecords.filter((record) => record.monthKey >= KARTE_MIN_MONTH);
    if (selectedPeriod !== "all") {
      const months = PERIOD_MONTHS[selectedPeriod];
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      const cutoffStr = cutoff.toISOString().split("T")[0];
      filtered = filtered.filter((record) => record.dateIso >= cutoffStr);
    }
    return filtered;
  }, [classifiedRecords, selectedPeriod]);

  const monthsForPeriod = useMemo(() => {
    const months = new Set(periodFilteredRecords.map((record) => record.monthKey));
    return Array.from(months).sort();
  }, [periodFilteredRecords]);

  useEffect(() => {
    if (selectedMonth === "all") {
      return;
    }
    if (!monthsForPeriod.includes(selectedMonth)) {
      setSelectedMonth("all");
    }
  }, [monthsForPeriod, selectedMonth]);

  const filteredClassified = useMemo(() => {
    if (selectedMonth === "all") {
      return periodFilteredRecords;
    }
    return periodFilteredRecords.filter((record) => record.monthKey === selectedMonth);
  }, [periodFilteredRecords, selectedMonth]);

  const statsAll = useMemo(() => {
    if (records.length === 0) {
      return [];
    }
    return aggregateKarteMonthly(records).filter((item) => item.month >= KARTE_MIN_MONTH);
  }, [records]);

  const stats = useMemo(() => {
    if (periodFilteredRecords.length === 0) {
      return [];
    }
    const targetMonths =
      selectedMonth === "all"
        ? new Set(periodFilteredRecords.map((record) => record.monthKey))
        : new Set([selectedMonth]);
    return statsAll.filter((stat) => targetMonths.has(stat.month));
  }, [statsAll, periodFilteredRecords, selectedMonth]);

  const latestStat: KarteMonthlyStat | null =
    stats.length > 0 ? stats[stats.length - 1] : null;

  const departmentStats = useMemo<DepartmentStat[]>(() => {
    if (filteredClassified.length === 0) {
      return [];
    }

    const map = new Map<
      string,
      {
        department: string;
        total: number;
        pureFirst: number;
        returningFirst: number;
        revisit: number;
        ageSum: number;
        ageCount: number;
      }
    >();

    for (const record of filteredClassified) {
      const departmentRaw = record.department?.trim() ?? "";
      if (departmentRaw.includes("自費")) {
        continue;
      }
      const department = departmentRaw.length > 0 ? departmentRaw : "診療科未分類";
      if (!map.has(department)) {
        map.set(department, {
          department,
          total: 0,
          pureFirst: 0,
          returningFirst: 0,
          revisit: 0,
          ageSum: 0,
          ageCount: 0,
        });
      }

      const bucket = map.get(department)!;
      bucket.total += 1;

      if (record.category === "pureFirst") {
        bucket.pureFirst += 1;
      } else if (record.category === "returningFirst") {
        bucket.returningFirst += 1;
      } else if (record.category === "revisit") {
        bucket.revisit += 1;
      }

      const age = calculateAge(record.birthDateIso ?? null, record.dateIso);
      if (age !== null) {
        bucket.ageSum += age;
        bucket.ageCount += 1;
      }
    }

    return Array.from(map.values())
      .map((bucket) => {
        const pureRate = bucket.total > 0 ? (bucket.pureFirst / bucket.total) * 100 : 0;
        const returningRate = bucket.total > 0 ? (bucket.returningFirst / bucket.total) * 100 : 0;
        const revisitRate = bucket.total > 0 ? (bucket.revisit / bucket.total) * 100 : 0;

        return {
          department: bucket.department,
          total: bucket.total,
          pureFirst: bucket.pureFirst,
          returningFirst: bucket.returningFirst,
          revisit: bucket.revisit,
          averageAge:
            bucket.ageCount > 0 ? roundTo1Decimal(bucket.ageSum / bucket.ageCount) : null,
          pureRate: roundTo1Decimal(pureRate),
          returningRate: roundTo1Decimal(returningRate),
          revisitRate: roundTo1Decimal(revisitRate),
        };
      })
      .sort((a, b) => {
        const diff = b.total - a.total;
        if (diff !== 0) {
          return diff;
        }
        return a.department.localeCompare(b.department, "ja");
      });
  }, [filteredClassified]);

  const hasAnyRecords = records.length > 0;
  const hasPeriodRecords = periodFilteredRecords.length > 0;

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }

    setUploadError(null);
    try {
      const existingMap = new Map<string, KarteRecord>();

      // 既存データを先に追加
      for (const record of records) {
        const key = `${record.dateIso}|${record.visitType}|${record.patientNumber}|${record.department}`;
        existingMap.set(key, record);
      }

      // 複数ファイルを処理
      for (const file of Array.from(files)) {
        const text = await file.text();
        const parsed = parseKarteCsv(text);

        for (const record of parsed) {
          const key = `${record.dateIso}|${record.visitType}|${record.patientNumber}|${record.department}`;
          existingMap.set(key, record);
        }
      }

      const merged = Array.from(existingMap.values()).sort((a, b) =>
        a.dateIso.localeCompare(b.dateIso),
      );

      setRecords(merged);
      setShareUrl(null);

      const timestamp = new Date().toISOString();
      setLastUpdated(timestamp);

      if (typeof window !== "undefined") {
        window.localStorage.setItem(KARTE_STORAGE_KEY, JSON.stringify(merged));
        window.localStorage.setItem(KARTE_TIMESTAMP_KEY, timestamp);
      }
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error
          ? `カルテ集計CSVの解析に失敗しました: ${error.message}`
          : "カルテ集計CSVの解析に失敗しました。";
      setUploadError(message);
    } finally {
      event.target.value = "";
    }
  };

  const handleShare = async () => {
    if (records.length === 0) {
      setUploadError("共有するカルテ集計データがありません。");
      return;
    }

    setIsSharing(true);
    setUploadError(null);

    try {
      const response = await uploadDataToR2({
        type: "karte",
        data: JSON.stringify(records),
      });

      setShareUrl(response.url);
      await navigator.clipboard.writeText(response.url);
      alert(`共有URLをクリップボードにコピーしました！\n\n${response.url}`);
    } catch (error) {
      console.error(error);
      setUploadError(`共有URLの生成に失敗しました: ${(error as Error).message}`);
    } finally {
      setIsSharing(false);
    }
  };

  const handleReset = () => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(KARTE_STORAGE_KEY);
    window.localStorage.removeItem(KARTE_TIMESTAMP_KEY);
    setRecords([]);
    setShareUrl(null);
    setLastUpdated(null);
    setUploadError(null);
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
        <section className="relative overflow-hidden rounded-3xl border border-brand-200 bg-gradient-to-r from-white via-brand-50 to-brand-100 p-8 shadow-card">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="space-y-4">
              <p className="text-sm font-semibold text-brand-600">Patient Insights Dashboard</p>
              <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">患者分析（カルテ集計）</h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                カルテ集計CSVをアップロードすると、2025年10月以降の月次指標
                （総患者・純初診・再初診・再診・平均年齢）を自動で可視化します。共有URLを使えば、同じ集計結果を閲覧専用モードで共有できます。
              </p>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-700 sm:px-5">
                <p className="mb-2 text-sm font-semibold text-emerald-900">患者区分の見方</p>
                <ul className="space-y-1">
                  <li>・<strong>純初診</strong> : 当院での受診が今回初めての患者様</li>
                  <li>・<strong>再初診</strong> : 過去に受診歴はあるが、新たな症状で初診扱いの患者様</li>
                  <li>・<strong>再診</strong> : 継続診療を目的とした患者様</li>
                </ul>
              </div>
              {isReadOnly && (
                <p className="rounded-2xl border border-dashed border-brand-300 bg-white/80 px-4 py-3 text-sm font-medium text-brand-700">
                  共有URLから閲覧中です。閲覧者が操作すると共有データにも反映されるため取り扱いにご注意ください。
                </p>
              )}
              {lastUpdated && (
                <p className="text-xs font-medium text-slate-500">
                  最終更新: {new Date(lastUpdated).toLocaleString("ja-JP")}
                </p>
              )}
            </div>
            <p className="text-xs text-slate-500">
              CSVのアップロードや共有はページ下部の「データ管理」セクションから操作できます。
            </p>
          </div>
          {isLoadingShared && (
            <div className="mt-6 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3">
              <p className="flex items-center gap-2 text-sm text-brand-700">
                <RefreshCw className="h-4 w-4 animate-spin" />
                共有データを読み込んでいます...
              </p>
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold text-slate-700">分析期間:</label>
            <select
              value={selectedPeriod}
              onChange={(event) => setSelectedPeriod(event.target.value as PeriodType)}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none"
            >
              <option value="all">全期間</option>
              <option value="3months">直近3ヶ月</option>
              <option value="6months">直近6ヶ月</option>
              <option value="1year">直近1年</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold text-slate-700">月別:</label>
            <select
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              disabled={monthsForPeriod.length === 0}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="all">全て</option>
              {monthsForPeriod.map((month) => (
                <option key={month} value={month}>
                  {formatMonthLabel(month)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {stats.length > 0 ? (
          <>
            {latestStat && (
              <SectionCard title="最新月サマリー">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <StatCard
                    label={`最新月 (${formatMonthLabel(latestStat.month)}) 総患者`}
                    value={`${latestStat.totalPatients.toLocaleString("ja-JP")}名`}
                    tone="brand"
                  />
                  <StatCard
                    label="最新月 純初診"
                    value={`${latestStat.pureFirstVisits.toLocaleString("ja-JP")}名`}
                    tone="emerald"
                  />
                  <StatCard
                    label="最新月 再初診"
                    value={`${latestStat.returningFirstVisits.toLocaleString("ja-JP")}名`}
                    tone="muted"
                  />
                  <StatCard
                    label="最新月 再診"
                    value={`${latestStat.revisitCount.toLocaleString("ja-JP")}名`}
                    tone="accent"
                  />
                  <StatCard
                    label="最新月 平均年齢"
                    value={
                      latestStat.averageAge !== null
                        ? `${latestStat.averageAge.toFixed(1)}歳`
                        : "データなし"
                    }
                    tone="muted"
                  />
                </div>
              </SectionCard>
            )}

            <SectionCard title="月次推移" description="2025年10月以降のカルテ集計を月別に一覧しています。">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2">月</th>
                      <th className="px-3 py-2">総患者</th>
                      <th className="px-3 py-2">純初診</th>
                      <th className="px-3 py-2">再初診</th>
                      <th className="px-3 py-2">再診</th>
                      <th className="px-3 py-2">平均年齢</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {stats
                      .slice()
                      .reverse()
                      .map((stat) => (
                        <tr key={stat.month} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-medium text-slate-900">
                            {formatMonthLabel(stat.month)}
                          </td>
                          <td className="px-3 py-2">{stat.totalPatients.toLocaleString("ja-JP")}</td>
                          <td className="px-3 py-2">
                            {stat.pureFirstVisits.toLocaleString("ja-JP")}
                          </td>
                          <td className="px-3 py-2">
                            {stat.returningFirstVisits.toLocaleString("ja-JP")}
                          </td>
                          <td className="px-3 py-2">{stat.revisitCount.toLocaleString("ja-JP")}</td>
                          <td className="px-3 py-2">
                            {stat.averageAge !== null ? `${stat.averageAge.toFixed(1)}歳` : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </>
        ) : (
          <SectionCard title="集計データがありません">
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              {!hasAnyRecords
                ? "カルテ集計CSVをアップロードすると、月次指標が表示されます。"
                : !hasPeriodRecords
                  ? "選択した期間に該当するデータがありません。期間を変更して再度ご確認ください。"
                  : "選択された月に該当するデータがありません。条件を変更して再度ご確認ください。"}
            </p>
          </SectionCard>
        )}

        <SectionCard
          title="診療科別 集計"
          description="診療科ごとの総患者・純初診・再初診・再診の件数です（「外国人自費」を含む診療科は除外しています）。"
        >
          {departmentStats.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {departmentStats.map((row) => (
                <div
                  key={row.department}
                  className="group rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-soft transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-900 sm:text-base">{row.department}</h3>
                    <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-600">
                      {row.total.toLocaleString("ja-JP")}名
                    </span>
                  </div>
                  <div className="mt-4 grid gap-2">
                    <DepartmentMetric
                      icon={Users}
                      label="総患者"
                      value={`${row.total.toLocaleString("ja-JP")}名`}
                      accent="brand"
                    />
                    <DepartmentMetric
                      icon={UserPlus}
                      label="純初診"
                      value={`${row.pureFirst.toLocaleString("ja-JP")}名`}
                      caption={`${row.pureRate.toFixed(1)}%`}
                      accent="emerald"
                    />
                    <DepartmentMetric
                      icon={Undo2}
                      label="再初診"
                      value={`${row.returningFirst.toLocaleString("ja-JP")}名`}
                      caption={`${row.returningRate.toFixed(1)}%`}
                      accent="accent"
                    />
                    <DepartmentMetric
                      icon={RotateCcw}
                      label="再診"
                      value={`${row.revisit.toLocaleString("ja-JP")}名`}
                      caption={`${row.revisitRate.toFixed(1)}%`}
                      accent="muted"
                    />
                    <DepartmentMetric
                      icon={Clock}
                      label="平均年齢"
                      value={row.averageAge !== null ? `${row.averageAge.toFixed(1)}歳` : "データなし"}
                      accent="muted"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              {!hasAnyRecords
                ? "カルテ集計CSVをアップロードすると、診療科別の内訳が表示されます。"
                : !hasPeriodRecords
                  ? "選択した期間に該当する診療科データがありません。"
                  : "選択された月に該当する診療科データがありません。"}
            </p>
          )}
        </SectionCard>

        <SectionCard
          title="データ管理"
          description="カルテ集計CSVの差し替えや共有URLの発行を行います。"
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              {isReadOnly
                ? "共有URLから閲覧中です。操作内容は公開データに即時反映されるため取り扱いにご注意ください。"
                : "最新のCSVをアップロードすると集計結果が更新されます。共有URLはコピーして関係者へ連携できます。"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-emerald-200 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 sm:w-auto">
                <Upload className="h-4 w-4" />
                CSVを選択
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleUpload}
                  multiple
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={handleShare}
                disabled={isSharing || records.length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-full border border-emerald-200 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {isSharing ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Share2 className="h-4 w-4" />
                    共有URLを発行
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={records.length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <RefreshCw className="h-4 w-4" />
                集計データをリセット
              </button>
            </div>
            {shareUrl && (
              <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
                <p className="flex items-center gap-2 text-xs text-green-700">
                  <LinkIcon className="h-4 w-4" />
                  共有URL: <code className="rounded bg-white px-2 py-1">{shareUrl}</code>
                </p>
              </div>
            )}
            {uploadError && (
              <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                {uploadError}
              </p>
            )}
          </div>
        </SectionCard>
      </div>
    </main>
  );
}
