"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Users,
  UserPlus,
  Activity,
  Heart,
  ArrowRight,
  CalendarClock,
  ClipboardList,
  BarChart3,
} from "lucide-react";
import { getCompressedItem } from "@/lib/storageCompression";
import { KARTE_STORAGE_KEY, KARTE_TIMESTAMP_KEY } from "@/lib/storageKeys";
import {
  SURVEY_STORAGE_KEY,
  type SurveyData,
} from "@/lib/surveyData";
import {
  DIAGNOSIS_STORAGE_KEY,
  type DiagnosisRecord,
} from "@/lib/diagnosisData";
import { classifyKarteRecords, isEndoscopyDepartment, type KarteRecord } from "@/lib/karteAnalytics";

type DashboardStats = {
  totalPatients: number | null;
  pureFirstVisits: number | null;
  revisitCount: number | null;
  endoscopyPatients: number | null;
  lifestyleDiseasePatients: number | null;
  internalReferrals: number | null;
  patientUpdated: string | null;
  kartePeriodLabel: string | null;
  surveyPeriodLabel: string | null;
  lifestylePeriodLabel: string | null;
};

const INITIAL_STATS: DashboardStats = {
  totalPatients: null,
  pureFirstVisits: null,
  revisitCount: null,
  endoscopyPatients: null,
  lifestyleDiseasePatients: null,
  internalReferrals: null,
  patientUpdated: null,
  kartePeriodLabel: null,
  surveyPeriodLabel: null,
  lifestylePeriodLabel: null,
};

const formatCount = (value: number | null) =>
  value === null ? "—" : value.toLocaleString("ja-JP");

const formatTimestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString("ja-JP") : "未更新";

const safeParse = <T,>(raw: string | null): T | null => {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error("JSON parse error", error);
    return null;
  }
};

const extractUniqueMonths = (values: Array<string | null | undefined>): string[] => {
  const bucket = new Set<string>();
  for (const value of values) {
    if (typeof value === "string" && value.length >= 7) {
      bucket.add(value);
    }
  }
  return Array.from(bucket).sort((a, b) => a.localeCompare(b));
};

const formatMonthDisplay = (month: string): string | null => {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(monthNum)) {
    return null;
  }
  return `${year}年${monthNum}月`;
};

const formatMonthRangeDisplay = (months: string[]): string | null => {
  if (months.length === 0) {
    return null;
  }
  const sorted = [...months].sort((a, b) => a.localeCompare(b));
  const start = formatMonthDisplay(sorted[0]);
  const end = formatMonthDisplay(sorted[sorted.length - 1]);
  if (!start || !end) {
    return null;
  }
  return sorted[0] === sorted[sorted.length - 1] ? start : `${start}〜${end}`;
};

const selectLatestMonths = (months: string[], limit: number): string[] => {
  if (limit <= 0) {
    return [];
  }
  if (months.length <= limit) {
    return months;
  }
  return months.slice(months.length - limit);
};

export default function HomePage() {
  const [stats, setStats] = useState<DashboardStats>(INITIAL_STATS);

  useEffect(() => {
    const loadStats = () => {
      const next: DashboardStats = { ...INITIAL_STATS };

      try {
        // カルテデータからKPI計算
        const karteRaw = getCompressedItem(KARTE_STORAGE_KEY);
        const karteRecords = safeParse<KarteRecord[]>(karteRaw);
        if (Array.isArray(karteRecords) && karteRecords.length > 0) {
          const karteMonths = extractUniqueMonths(
            karteRecords.map((record) => record.monthKey),
          );
          const latestMonth =
            karteMonths.length > 0 ? karteMonths[karteMonths.length - 1] : null;
          if (latestMonth) {
            const latestRecords = karteRecords.filter(
              (record) => record.monthKey === latestMonth,
            );
            next.totalPatients = latestRecords.length;
            next.endoscopyPatients = latestRecords.filter((record) =>
              isEndoscopyDepartment(record.department),
            ).length;

            // 純初診数と再診数を計算
            const classified = classifyKarteRecords(karteRecords);
            const latestClassified = classified.filter(
              (record) => record.monthKey === latestMonth,
            );
            next.pureFirstVisits = latestClassified.filter(
              (r) => r.category === "pureFirst",
            ).length;
            next.revisitCount = latestClassified.filter(
              (r) => r.category === "revisit",
            ).length;

            const monthLabel = formatMonthDisplay(latestMonth);
            if (monthLabel) {
              next.kartePeriodLabel = monthLabel;
            }
          }
        }
        next.patientUpdated = window.localStorage.getItem(KARTE_TIMESTAMP_KEY);
      } catch (error) {
        console.error("Failed to load patient stats", error);
      }

      try {
        // 生活習慣病患者数を計算
        const diagnosisRaw = getCompressedItem(DIAGNOSIS_STORAGE_KEY);
        const diagnosisData = safeParse<DiagnosisRecord[]>(diagnosisRaw);
        if (Array.isArray(diagnosisData) && diagnosisData.length > 0) {
          const diagnosisMonths = extractUniqueMonths(
            diagnosisData.map((record) => record.monthKey),
          );
          const lifestyleMonths = selectLatestMonths(diagnosisMonths, 6);
          const lifestyleMonthSet = new Set(lifestyleMonths);
          const lifestyleDiseaseRecords = diagnosisData.filter((record) => {
            if (record.category !== "生活習慣病") {
              return false;
            }
            if (lifestyleMonthSet.size === 0) {
              return true;
            }
            return lifestyleMonthSet.has(record.monthKey);
          });

          const uniquePatients = new Set<string>();
          lifestyleDiseaseRecords.forEach((record) => {
            const key = record.patientNumber
              ? `pn:${record.patientNumber}`
              : record.patientNameNormalized && record.birthDateIso
                ? `nb:${record.patientNameNormalized}|${record.birthDateIso}`
                : null;
            if (key) {
              uniquePatients.add(key);
            }
          });
          next.lifestyleDiseasePatients = uniquePatients.size;

          const periodLabel = formatMonthRangeDisplay(lifestyleMonths);
          if (periodLabel) {
            next.lifestylePeriodLabel = periodLabel;
          }
        }
      } catch (error) {
        console.error("Failed to load diagnosis stats", error);
      }

      try {
        // 内科の家族・友人紹介を計算
        const surveyRaw = window.localStorage.getItem(SURVEY_STORAGE_KEY);
        const surveyData = safeParse<SurveyData[]>(surveyRaw);
        if (Array.isArray(surveyData)) {
          const internalSurveys = surveyData.filter((item) => item.fileType === "外来");
          if (internalSurveys.length > 0) {
            const surveyMonths = extractUniqueMonths(internalSurveys.map((item) => item.month));
            const monthlyReferralTotals = new Map<string, number>();
            internalSurveys.forEach((item) => {
              const current = monthlyReferralTotals.get(item.month) ?? 0;
              monthlyReferralTotals.set(item.month, current + item.friendReferral);
            });
            const positiveMonths = surveyMonths.filter(
              (month) => (monthlyReferralTotals.get(month) ?? 0) > 0,
            );
            const targetMonth =
              positiveMonths.length > 0
                ? positiveMonths[positiveMonths.length - 1]
                : null;

            const targetSurveys =
              targetMonth
                ? internalSurveys.filter((item) => item.month === targetMonth)
                : [];

            next.internalReferrals = targetSurveys.reduce(
              (sum, item) => sum + item.friendReferral,
              0,
            );

            if (targetMonth) {
              const surveyLabel = formatMonthDisplay(targetMonth);
              if (surveyLabel) {
                next.surveyPeriodLabel = surveyLabel;
              }
            }
          } else {
            next.internalReferrals = 0;
          }
        }
      } catch (error) {
        console.error("Failed to load survey stats", error);
      }

      setStats(next);
    };

    loadStats();
    const handler = () => loadStats();
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const metricCards = [
    {
      id: "totalPatients",
      label: "総患者数",
      value: formatCount(stats.totalPatients),
      unit: "人",
      hint: stats.kartePeriodLabel
        ? `カルテ集計（${stats.kartePeriodLabel}／最終更新: ${formatTimestamp(stats.patientUpdated)}）`
        : `カルテ記録の総数 (最終更新: ${formatTimestamp(stats.patientUpdated)})`,
      icon: Users,
      gradient: "from-brand-500 to-brand-400",
    },
    {
      id: "pureFirst",
      label: "純初診数",
      value: formatCount(stats.pureFirstVisits),
      unit: "人",
      hint: stats.kartePeriodLabel
        ? `初めて来院された患者数（${stats.kartePeriodLabel}の集計）`
        : "初めて来院された患者数",
      icon: UserPlus,
      gradient: "from-emerald-500 to-emerald-400",
    },
    {
      id: "revisit",
      label: "再診数",
      value: formatCount(stats.revisitCount),
      unit: "人",
      hint: stats.kartePeriodLabel
        ? `再来院された患者数（${stats.kartePeriodLabel}の集計）`
        : "再来院された患者数",
      icon: Users,
      gradient: "from-sky-500 to-sky-400",
    },
    {
      id: "endoscopy",
      label: "内視鏡人数",
      value: formatCount(stats.endoscopyPatients),
      unit: "人",
      hint: stats.kartePeriodLabel
        ? `内視鏡・人間ドック合計（${stats.kartePeriodLabel}の集計）`
        : "内視鏡（保険・自費）と人間ドックA/Bの合計",
      icon: Activity,
      gradient: "from-purple-500 to-purple-400",
    },
    {
      id: "lifestyle",
      label: "生活習慣病患者数",
      value: formatCount(stats.lifestyleDiseasePatients),
      unit: "人",
      hint: stats.lifestylePeriodLabel
        ? `主病登録から集計（直近: ${stats.lifestylePeriodLabel}）`
        : "主病登録から集計（ユニーク患者数）",
      icon: Activity,
      gradient: "from-amber-500 to-amber-400",
    },
    {
      id: "referral",
      label: "内科 家族・友人紹介",
      value: formatCount(stats.internalReferrals),
      unit: "件",
      hint: stats.surveyPeriodLabel
        ? `外来アンケートから集計（${stats.surveyPeriodLabel}）`
        : "外来アンケートから集計",
      icon: Heart,
      gradient: "from-rose-500 to-rose-400",
    },
  ];

  const navigationCards = [
    {
      href: "/patients" as const,
      title: "患者分析",
      description:
        "カルテ集計CSVを読み込み、月次推移・診療科別内訳・生活習慣病の継続状況まで一括で把握できます。",
      highlights: ["月次指標と比較", "診療科別内訳", "新規主病トレンド"],
      icon: Users,
    },
    {
      href: "/patients/lifestyle" as const,
      title: "生活習慣病 継続分析",
      description:
        "生活習慣病患者の受診継続性をステータス別に分類し、優先フォロー対象を把握します。",
      highlights: ["継続受診率", "年齢×疾患分析", "フォロー対象抽出"],
      icon: Users,
    },
    {
      href: "/reservations" as const,
      title: "予約分析",
      description:
        "予約ログの時間帯・曜日・診療科ごとの傾向を可視化し、初診・再診バランスや当日予約の動きを確認できます。",
      highlights: ["時間帯別", "曜日別", "差分比較"],
      icon: CalendarClock,
    },
    {
      href: "/survey" as const,
      title: "アンケート分析",
      description:
        "来院経路アンケートを集計し、媒体別の集患効果や来院種別ごとの傾向を把握します。",
      highlights: ["媒体比較", "来院種別", "月次トレンド"],
      icon: ClipboardList,
    },
    {
      href: "/listing" as const,
      title: "リスティング分析",
      description:
        "広告の費用・CV・時間帯パフォーマンスを突合し、キャンペーンごとの費用対効果を把握します。",
      highlights: ["CV/CPA推移", "時間帯別CV", "カテゴリ別比較"],
      icon: BarChart3,
    },
    {
      href: "/correlation" as const,
      title: "相関分析",
      description:
        "予約実績と広告指標の関係性を多変量で比較し、広告施策が来院に与える影響を探ります。",
      highlights: ["時間帯相関", "月次マッチング", "散布図分析"],
      icon: Activity,
    },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-br from-white via-brand-50/30 to-slate-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
        <section className="overflow-hidden rounded-3xl border border-brand-100 bg-white/95 shadow-xl">
          <div className="relative isolate px-6 py-14 sm:px-10 lg:px-16">
            <div className="absolute -left-20 top-10 h-48 w-48 rounded-full bg-brand-200/50 blur-3xl" />
            <div className="absolute -bottom-16 right-4 h-56 w-56 rounded-full bg-emerald-200/40 blur-3xl" />
            <div className="relative z-10 flex flex-col gap-5">
              <h1 className="text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
                <span className="inline-block bg-gradient-to-r from-brand-500 via-emerald-500 to-sky-500 bg-clip-text text-transparent">
                  マルミエ
                </span>
              </h1>
              <p className="text-lg font-semibold text-slate-700 sm:text-xl">
                リベ大総合クリニック大阪院をマルミエにするアプリです。
              </p>
              <p className="max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
                総患者数、純初診数、再診数、生活習慣病患者数、内科の家族・友人紹介など、
                重要なKPIをひと目で確認できます。詳細分析ページへスムーズにアクセスし、次のアクションへつなげてください。
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {metricCards.map(({ id, label, value, unit, hint, icon: Icon, gradient }) => (
            <div
              key={id}
              className="group relative overflow-hidden rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-soft transition hover:-translate-y-1 hover:shadow-lg"
            >
              <div
                className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${gradient}`}
              />
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {label}
                  </span>
                  <p className="text-3xl font-bold text-slate-900">
                    {value}
                    <span className="ml-1 text-lg font-medium text-slate-600">{unit}</span>
                  </p>
                  <p className="text-xs text-slate-500">{hint}</p>
                </div>
                <span
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${gradient} text-white shadow-lg`}
                >
                  <Icon className="h-6 w-6" />
                </span>
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">分析ページガイド</h2>
              <p className="text-sm text-slate-500">
                主に確認できる指標や利用シーンのヒントを添えてあります。必要な分析ページへそのまま移動できます。
              </p>
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {navigationCards.map(({ href, title, description, highlights, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="group flex h-full flex-col justify-between rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-soft transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-lg"
              >
                <div className="flex flex-col gap-4">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 group-hover:bg-brand-200">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {highlights.map((text) => (
                      <span
                        key={text}
                        className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600"
                      >
                        {text}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-600 group-hover:text-brand-700">
                  詳細を見る
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
