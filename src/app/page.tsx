"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Users,
  CalendarClock,
  ClipboardList,
  BarChart3,
  Activity,
  ArrowRight,
} from "lucide-react";
import { getCompressedItem } from "@/lib/storageCompression";
import { KARTE_STORAGE_KEY, KARTE_TIMESTAMP_KEY } from "@/lib/storageKeys";
import {
  RESERVATION_STORAGE_KEY,
  RESERVATION_TIMESTAMP_KEY,
} from "@/lib/reservationData";
import {
  SURVEY_STORAGE_KEY,
  SURVEY_TIMESTAMP_KEY,
  type SurveyData,
} from "@/lib/surveyData";
import {
  LISTING_STORAGE_KEY,
  LISTING_TIMESTAMP_KEY,
  type ListingCategoryData,
} from "@/lib/listingData";
import {
  DIAGNOSIS_STORAGE_KEY,
  DIAGNOSIS_TIMESTAMP_KEY,
  type DiagnosisRecord,
} from "@/lib/diagnosisData";

type DashboardStats = {
  totalPatients: number | null;
  patientUpdated: string | null;
  totalReservations: number | null;
  reservationUpdated: string | null;
  totalSurveys: number | null;
  surveyUpdated: string | null;
  totalListings: number | null;
  listingUpdated: string | null;
  totalDiagnosis: number | null;
  diagnosisUpdated: string | null;
  latestDiagnosisMonth: string | null;
  latestDiagnosisCount: number | null;
};

const INITIAL_STATS: DashboardStats = {
  totalPatients: null,
  patientUpdated: null,
  totalReservations: null,
  reservationUpdated: null,
  totalSurveys: null,
  surveyUpdated: null,
  totalListings: null,
  listingUpdated: null,
  totalDiagnosis: null,
  diagnosisUpdated: null,
  latestDiagnosisMonth: null,
  latestDiagnosisCount: null,
};

const formatCount = (value: number | null) =>
  value === null ? "—" : `${value.toLocaleString("ja-JP")}件`;

const formatTimestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString("ja-JP") : "未更新";

const formatMonthLabel = (month: string | null) => {
  if (!month) {
    return "";
  }
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

export default function HomePage() {
  const [stats, setStats] = useState<DashboardStats>(INITIAL_STATS);

  useEffect(() => {
    const loadStats = () => {
      const next: DashboardStats = { ...INITIAL_STATS };

      try {
        const karteRaw = getCompressedItem(KARTE_STORAGE_KEY);
        const karteRecords = safeParse<unknown[]>(karteRaw);
        if (Array.isArray(karteRecords)) {
          next.totalPatients = karteRecords.length;
        }
        next.patientUpdated = window.localStorage.getItem(KARTE_TIMESTAMP_KEY);
      } catch (error) {
        console.error("Failed to load patient stats", error);
      }

      try {
        const reservationsRaw = window.localStorage.getItem(RESERVATION_STORAGE_KEY);
        const reservations = safeParse<unknown[]>(reservationsRaw);
        if (Array.isArray(reservations)) {
          next.totalReservations = reservations.length;
        }
        next.reservationUpdated = window.localStorage.getItem(RESERVATION_TIMESTAMP_KEY);
      } catch (error) {
        console.error("Failed to load reservation stats", error);
      }

      try {
        const surveyRaw = window.localStorage.getItem(SURVEY_STORAGE_KEY);
        const surveyData = safeParse<SurveyData[]>(surveyRaw);
        if (Array.isArray(surveyData)) {
          next.totalSurveys = surveyData.length;
        }
        next.surveyUpdated = window.localStorage.getItem(SURVEY_TIMESTAMP_KEY);
      } catch (error) {
        console.error("Failed to load survey stats", error);
      }

      try {
        const listingRaw = window.localStorage.getItem(LISTING_STORAGE_KEY);
        const listingData = safeParse<ListingCategoryData[]>(listingRaw);
        if (Array.isArray(listingData)) {
          next.totalListings = listingData.reduce(
            (total, { data }) => total + (Array.isArray(data) ? data.length : 0),
            0,
          );
        }
        next.listingUpdated = window.localStorage.getItem(LISTING_TIMESTAMP_KEY);
      } catch (error) {
        console.error("Failed to load listing stats", error);
      }

      try {
        const diagnosisRaw = window.localStorage.getItem(DIAGNOSIS_STORAGE_KEY);
        const diagnosisData = safeParse<DiagnosisRecord[]>(diagnosisRaw);
        if (Array.isArray(diagnosisData)) {
          next.totalDiagnosis = diagnosisData.length;
          const monthCounts = new Map<string, number>();
          diagnosisData.forEach((record) => {
            if (!record?.monthKey) {
              return;
            }
            const current = monthCounts.get(record.monthKey) ?? 0;
            monthCounts.set(record.monthKey, current + 1);
          });
          const months = Array.from(monthCounts.keys()).sort();
          const latestMonth = months[months.length - 1];
          if (latestMonth) {
            next.latestDiagnosisMonth = latestMonth;
            next.latestDiagnosisCount = monthCounts.get(latestMonth) ?? null;
          }
        }
        next.diagnosisUpdated = window.localStorage.getItem(DIAGNOSIS_TIMESTAMP_KEY);
      } catch (error) {
        console.error("Failed to load diagnosis stats", error);
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
      id: "patients",
      label: "カルテ記録",
      value: formatCount(stats.totalPatients),
      hint: `最終更新: ${formatTimestamp(stats.patientUpdated)}`,
      icon: Users,
      gradient: "from-brand-500 to-brand-400",
    },
    {
      id: "reservations",
      label: "予約ログ",
      value: formatCount(stats.totalReservations),
      hint: `最終更新: ${formatTimestamp(stats.reservationUpdated)}`,
      icon: CalendarClock,
      gradient: "from-emerald-500 to-emerald-400",
    },
    {
      id: "survey",
      label: "アンケート回答",
      value: formatCount(stats.totalSurveys),
      hint: `最終更新: ${formatTimestamp(stats.surveyUpdated)}`,
      icon: ClipboardList,
      gradient: "from-sky-500 to-sky-400",
    },
    {
      id: "listing",
      label: "リスティング日次記録",
      value: formatCount(stats.totalListings),
      hint: `最終更新: ${formatTimestamp(stats.listingUpdated)}`,
      icon: BarChart3,
      gradient: "from-amber-500 to-amber-400",
    },
    {
      id: "diagnosis",
      label: "主病登録",
      value: formatCount(stats.totalDiagnosis),
      hint:
        stats.latestDiagnosisMonth && stats.latestDiagnosisCount !== null
          ? `${formatMonthLabel(stats.latestDiagnosisMonth)}: ${stats.latestDiagnosisCount.toLocaleString(
              "ja-JP",
            )}件`
          : `最終更新: ${formatTimestamp(stats.diagnosisUpdated)}`,
      icon: Activity,
      gradient: "from-rose-500 to-rose-400",
    },
  ];

  const navigationCards = [
    {
      href: "/patients",
      title: "患者分析",
      description:
        "カルテ集計CSVを読み込み、月次推移・診療科別内訳・生活習慣病の継続状況まで一括で把握できます。",
      highlights: ["月次指標と比較", "診療科別内訳", "新規主病トレンド"],
      icon: Users,
    },
    {
      href: "/reservations",
      title: "予約分析",
      description:
        "予約ログの時間帯・曜日・診療科ごとの傾向を可視化し、初診・再診バランスや当日予約の動きを確認できます。",
      highlights: ["時間帯別", "曜日別", "差分比較"],
      icon: CalendarClock,
    },
    {
      href: "/survey",
      title: "アンケート分析",
      description:
        "来院経路アンケートを集計し、媒体別の集患効果や来院種別ごとの傾向を把握します。",
      highlights: ["媒体比較", "来院種別", "月次トレンド"],
      icon: ClipboardList,
    },
    {
      href: "/listing",
      title: "リスティング分析",
      description:
        "広告の費用・CV・時間帯パフォーマンスを突合し、キャンペーンごとの費用対効果を把握します。",
      highlights: ["CV/CPA推移", "時間帯別CV", "カテゴリ別比較"],
      icon: BarChart3,
    },
    {
      href: "/correlation",
      title: "相関分析",
      description:
        "予約実績と広告指標の関係性を多変量で比較し、広告施策が来院に与える影響を探ります。",
      highlights: ["時間帯相関", "月次マッチング", "散布図分析"],
      icon: Activity,
    },
    {
      href: "/patients/lifestyle",
      title: "生活習慣病 継続分析",
      description:
        "生活習慣病患者の受診継続性をステータス別に分類し、優先フォロー対象を把握します。",
      highlights: ["継続受診率", "年齢×疾患分析", "フォロー対象抽出"],
      icon: Users,
    },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-br from-white via-brand-50/30 to-slate-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
        <section className="overflow-hidden rounded-3xl border border-brand-100 bg-white/90 shadow-xl">
          <div className="relative isolate px-6 py-12 sm:px-10 lg:px-16">
            <div className="absolute -left-16 top-6 h-44 w-44 rounded-full bg-brand-200/40 blur-3xl" />
            <div className="absolute bottom-0 right-0 h-40 w-40 rounded-full bg-emerald-200/30 blur-3xl" />
            <div className="relative z-10 flex flex-col gap-6">
              <span className="inline-flex w-fit items-center rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
                総合ダッシュボード
              </span>
              <h1 className="text-3xl font-bold leading-tight text-slate-900 sm:text-4xl">
                クリニックの主要指標をひと目で俯瞰し、
                <br className="hidden sm:block" />
                次のアクションにつながるページへ素早くアクセス
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
                直近のカルテ記録・予約ログ・アンケート・リスティング・主病登録を集計し、最新状況をまとめています。
                下のカードから詳しい分析ページに移動し、それぞれの視点で深掘りしてください。
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {metricCards.map(({ id, label, value, hint, icon: Icon, gradient }) => (
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
                  <p className="text-3xl font-bold text-slate-900">{value}</p>
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
              <h2 className="text-xl font-bold text-slate-900">ページへのショートカット</h2>
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
