"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  lazy,
  Suspense,
} from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  RefreshCcw,
  Sparkles,
  TrendingUp,
  DollarSign,
  Award,
} from "lucide-react";
import {
  SALES_TIMESTAMP_KEY,
  loadSalesDataFromStorage,
  type SalesMonthlyData,
} from "@/lib/salesData";
import { getDayType, getWeekdayName } from "@/lib/dateUtils";

const MonthlySalesChart = lazy(() =>
  import("@/components/sales/MonthlySalesChart").then((module) => ({
    default: module.MonthlySalesChart,
  })),
);
const WeekdaySalesAverageChart = lazy(() =>
  import("@/components/sales/WeekdaySalesAverageChart").then((module) => ({
    default: module.WeekdaySalesAverageChart,
  })),
);
const DailySalesChart = lazy(() =>
  import("@/components/sales/DailySalesChart").then((module) => ({
    default: module.DailySalesChart,
  })),
);

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const formatPeople = (value: number | null): string =>
  value === null ? "—" : `${value.toLocaleString("ja-JP")}人`;

const formatPercentage = (value: number): string =>
  `${value.toLocaleString("ja-JP", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}%`;

const WEEKDAY_ORDER = [
  "月曜",
  "火曜",
  "水曜",
  "木曜",
  "金曜",
  "土曜",
  "日曜",
];

export default function SalesPage() {
  const [salesData, setSalesData] = useState<SalesMonthlyData[]>([]);
  const [selectedMonthId, setSelectedMonthId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const hydrateFromStorage = useCallback(() => {
    const stored = loadSalesDataFromStorage();
    setSalesData(stored);
    setSelectedMonthId((currentId) => {
      if (currentId && stored.some((month) => month.id === currentId)) {
        return currentId;
      }
      return stored.length > 0 ? stored[stored.length - 1].id : null;
    });
    if (typeof window !== "undefined") {
      setLastUpdated(window.localStorage.getItem(SALES_TIMESTAMP_KEY));
    } else {
      setLastUpdated(null);
    }
  }, []);

  useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  useEffect(() => {
    setDetailsOpen(false);
  }, [selectedMonthId]);

  const monthlySummary = useMemo(
    () =>
      salesData.map((month) => ({
        id: month.id,
        label: month.label,
        totalRevenue: month.totalRevenue,
      })),
    [salesData],
  );

  const selectedMonth = useMemo(() => {
    if (salesData.length === 0) {
      return null;
    }
    if (selectedMonthId) {
      const matched = salesData.find((month) => month.id === selectedMonthId);
      if (matched) {
        return matched;
      }
    }
    return salesData[salesData.length - 1]!;
  }, [salesData, selectedMonthId]);

  const latestMonth = useMemo(
    () => (salesData.length > 0 ? salesData[salesData.length - 1] : null),
    [salesData],
  );

  const weekdayAverageData = useMemo(() => {
    if (!selectedMonth) {
      return [];
    }
    const accumulator = new Map<string, { label: string; total: number; count: number }>();

    for (const day of selectedMonth.days) {
      const dayType = getDayType(day.date);
      const weekdayName = getWeekdayName(day.date);
      const key = dayType === "祝日" ? "祝日" : weekdayName;
      if (!accumulator.has(key)) {
        accumulator.set(key, { label: key, total: 0, count: 0 });
      }
      const bucket = accumulator.get(key)!;
      bucket.total += day.totalRevenue;
      bucket.count += 1;
    }

    const orderedKeys = [
      ...WEEKDAY_ORDER,
      ...(accumulator.has("祝日") ? ["祝日"] : []),
    ];

    return orderedKeys
      .filter((key) => accumulator.has(key))
      .map((key) => {
        const bucket = accumulator.get(key)!;
        return {
          label: bucket.label,
          value: bucket.count > 0 ? bucket.total / bucket.count : 0,
        };
      });
  }, [selectedMonth]);

  const dailyChartData = useMemo(() => {
    if (!selectedMonth) {
      return [];
    }
    return selectedMonth.days.map((day) => ({
      day: day.day,
      date: day.date,
      totalRevenue: day.totalRevenue,
      note: day.note ?? undefined,
    }));
  }, [selectedMonth]);

  const profitableDays = useMemo(() => {
    if (!selectedMonth) {
      return [];
    }
    return selectedMonth.days.filter((day) => day.totalRevenue > 0);
  }, [selectedMonth]);

  const bestDay = useMemo(() => {
    if (profitableDays.length === 0) {
      return null;
    }
    return profitableDays.reduce((acc, day) =>
      day.totalRevenue > acc.totalRevenue ? day : acc,
    );
  }, [profitableDays]);

  const worstDay = useMemo(() => {
    if (profitableDays.length === 0) {
      return null;
    }
    return profitableDays.reduce((acc, day) =>
      day.totalRevenue < acc.totalRevenue ? day : acc,
    );
  }, [profitableDays]);

  const composition = useMemo(() => {
    if (!selectedMonth) {
      return null;
    }
    const {
      totalRevenue,
      totalMedicalRevenue,
      totalSelfPayRevenue,
      totalOtherRevenue,
      totalPeopleCount,
    } = selectedMonth;

    const segments = [
      { label: "医療収益", value: totalMedicalRevenue },
      { label: "自費金額", value: totalSelfPayRevenue },
      { label: "その他", value: totalOtherRevenue },
    ]
      .filter((segment) => segment.value > 0)
      .map((segment) => ({
        ...segment,
        percentage:
          totalRevenue > 0 ? (segment.value / totalRevenue) * 100 : 0,
      }));

    return {
      totalRevenue,
      segments,
      averagePerPerson:
        totalPeopleCount && totalPeopleCount > 0
          ? selectedMonth.totalRevenue / totalPeopleCount
          : null,
      totalPeopleCount,
    };
  }, [selectedMonth]);

  const topDays = useMemo(() => {
    if (!selectedMonth) {
      return [];
    }
    return [...selectedMonth.days]
      .filter((day) => day.totalRevenue > 0)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 5);
  }, [selectedMonth]);

  const weekdayHighlight = useMemo(() => {
    if (weekdayAverageData.length === 0) {
      return null;
    }
    return [...weekdayAverageData].sort((a, b) => b.value - a.value)[0]!;
  }, [weekdayAverageData]);

  const holidayAverage = useMemo(
    () => weekdayAverageData.find((item) => item.label === "祝日") ?? null,
    [weekdayAverageData],
  );

  const insights = useMemo(() => {
    if (!selectedMonth) {
      return [];
    }
    const output: { title: string; description: string }[] = [];

    if (composition && composition.segments.length > 0) {
      const leader = [...composition.segments].sort(
        (a, b) => b.value - a.value,
      )[0]!;
      output.push({
        title: "主要な収益ドライバー",
        description: `${leader.label}が全体の${formatPercentage(
          leader.percentage,
        )}を占めています。`,
      });
    }

    if (weekdayHighlight) {
      output.push({
        title: "最も強い曜日",
        description: `${weekdayHighlight.label}の平均は${formatCurrency(
          weekdayHighlight.value,
        )}です。`,
      });
    }

    if (holidayAverage) {
      output.push({
        title: "祝日パフォーマンス",
        description: `祝日の平均売上は${formatCurrency(
          holidayAverage.value,
        )}です。`,
      });
    }

    if (topDays.length > 0 && selectedMonth.totalRevenue > 0) {
      const topShare =
        (topDays[0]!.totalRevenue / selectedMonth.totalRevenue) * 100;
      output.push({
        title: "ピーク日の寄与度",
        description: `${topDays[0]!.day}日の売上は月全体の${formatPercentage(
          topShare,
        )}に相当します。`,
      });
    }

    if (composition?.averagePerPerson) {
      output.push({
        title: "平均単価",
        description: `1人あたりの平均売上は${formatCurrency(
          composition.averagePerPerson,
        )}です。`,
      });
    }

    return output.slice(0, 4);
  }, [
    composition,
    holidayAverage,
    selectedMonth,
    topDays,
    weekdayHighlight,
  ]);

  const hasData = salesData.length > 0 && selectedMonth;

  return (
    <main className="min-h-screen bg-gradient-to-br from-emerald-50/40 via-teal-50/30 to-cyan-50/40 pb-24">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-10">
        {/* Hero Section */}
        <section className="overflow-hidden rounded-3xl border border-emerald-100/60 bg-white/95 shadow-2xl shadow-emerald-500/5">
          <div className="relative isolate px-8 py-16 sm:px-12 lg:px-20">
            <div className="absolute -left-20 top-20 h-64 w-64 rounded-full bg-emerald-200/30 blur-3xl" />
            <div className="absolute -right-20 bottom-16 h-72 w-72 rounded-full bg-teal-200/25 blur-3xl" />
            <div className="relative z-10 flex flex-col gap-7">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-3 shadow-lg shadow-emerald-500/30">
                  <TrendingUp className="h-7 w-7 text-white" />
                </div>
                <span className="inline-flex items-center gap-2.5 rounded-full border border-emerald-200/80 bg-emerald-50/80 px-5 py-2.5 text-sm font-semibold text-emerald-700 shadow-sm">
                  <FileSpreadsheet className="h-4.5 w-4.5" />
                  売上ダッシュボード
                </span>
              </div>
              <h1 className="text-5xl font-black tracking-tight text-slate-900 sm:text-6xl">
                売上分析ダッシュボード
              </h1>
              <p className="max-w-2xl text-lg leading-relaxed text-slate-600">
                月次売上と曜日トレンドを可視化。データに基づいた意思決定をサポートします。
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <Link
                  href="/patients"
                  className="inline-flex items-center gap-2.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-emerald-500/30 transition-all hover:shadow-xl hover:shadow-emerald-500/40 hover:-translate-y-0.5"
                >
                  データ管理を開く
                  <ArrowRight className="h-5 w-5" />
                </Link>
                <button
                  type="button"
                  onClick={hydrateFromStorage}
                  className="inline-flex items-center gap-2.5 rounded-full border-2 border-emerald-200 bg-white px-6 py-3 text-base font-semibold text-emerald-700 transition-all hover:bg-emerald-50 hover:border-emerald-300"
                >
                  <RefreshCcw className="h-5 w-5" />
                  最新のデータを読み込み
                </button>
              </div>
            </div>
          </div>
        </section>

        {hasData ? (
          <>
            {/* Monthly Overview */}
            <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
              <div className="overflow-hidden rounded-3xl border border-emerald-100/60 bg-white shadow-xl shadow-emerald-500/5">
                <div className="flex items-center justify-between gap-4 border-b border-emerald-50 bg-gradient-to-r from-emerald-50/50 to-teal-50/30 px-8 py-6">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">
                      月別の売上推移
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      アップロード済みの月次データから売上を集計
                    </p>
                  </div>
                  {lastUpdated && (
                    <span className="inline-flex items-center gap-2 rounded-xl bg-white/80 px-4 py-2 text-xs font-medium text-slate-600 shadow-sm border border-emerald-100/50">
                      <RefreshCcw className="h-3.5 w-3.5 text-emerald-600" />
                      {new Date(lastUpdated).toLocaleString("ja-JP", {
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
                <div className="p-6">
                  <Suspense
                    fallback={
                      <div className="h-80 w-full animate-pulse rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50" />
                    }
                  >
                    <MonthlySalesChart
                      data={monthlySummary}
                      selectedId={selectedMonth?.id}
                      onSelect={setSelectedMonthId}
                    />
                  </Suspense>
                </div>
              </div>

              <div className="flex flex-col gap-6">
                {latestMonth ? (
                  <div className="rounded-3xl border border-emerald-100/60 bg-gradient-to-br from-white to-emerald-50/30 p-7 shadow-xl shadow-emerald-500/5">
                    <div className="mb-5 flex items-center gap-3">
                      <div className="rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 p-2.5 shadow-md">
                        <Award className="h-5 w-5 text-white" />
                      </div>
                      <h3 className="text-xl font-bold text-slate-900">
                        直近の集計状況
                      </h3>
                    </div>
                    <div className="space-y-4">
                      <div className="rounded-2xl bg-white/80 p-5 border border-emerald-100/50 shadow-sm">
                        <p className="text-sm font-medium text-slate-500">対象月</p>
                        <p className="mt-2 text-2xl font-black text-emerald-700">
                          {latestMonth.label}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-white/80 p-5 border border-emerald-100/50 shadow-sm">
                        <p className="text-sm font-medium text-slate-500">月次合計</p>
                        <p className="mt-2 text-3xl font-black text-slate-900">
                          {formatCurrency(latestMonth.totalRevenue)}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="rounded-2xl bg-white/80 p-4 border border-emerald-100/50 shadow-sm">
                          <p className="text-xs font-medium text-slate-500">平均日次</p>
                          <p className="mt-2 text-lg font-bold text-slate-900">
                            {formatCurrency(latestMonth.averageDailyRevenue)}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-white/80 p-4 border border-emerald-100/50 shadow-sm">
                          <p className="text-xs font-medium text-slate-500">来院人数</p>
                          <p className="mt-2 text-lg font-bold text-slate-900">
                            {formatPeople(latestMonth.totalPeopleCount)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-3xl border-2 border-dashed border-emerald-200 bg-emerald-50/30 p-8 text-center text-sm text-slate-500 shadow-inner">
                    売上データを取り込むとここにサマリが表示されます。
                  </div>
                )}

                <div className="rounded-3xl border border-emerald-100/60 bg-white p-7 shadow-xl shadow-emerald-500/5">
                  <div className="mb-4 flex items-center gap-2.5">
                    <Sparkles className="h-5 w-5 text-emerald-600" />
                    <h3 className="text-lg font-bold text-slate-900">
                      データ管理のヒント
                    </h3>
                  </div>
                  <ul className="space-y-3 text-sm text-slate-600">
                    <li className="flex items-start gap-3 rounded-xl bg-emerald-50/50 p-3">
                      <div className="mt-0.5 rounded-full bg-emerald-100 p-1">
                        <div className="h-2 w-2 rounded-full bg-emerald-600" />
                      </div>
                      <span>
                        売上CSVは「2025年売上表-2025_09.csv」のように年月を含めると自動判別されます
                      </span>
                    </li>
                    <li className="flex items-start gap-3 rounded-xl bg-emerald-50/50 p-3">
                      <div className="mt-0.5 rounded-full bg-emerald-100 p-1">
                        <div className="h-2 w-2 rounded-full bg-emerald-600" />
                      </div>
                      <span>
                        ファイル名に「売上」を含めるとデータ管理で一括処理できます
                      </span>
                    </li>
                  </ul>
                  <Link
                    href="/patients"
                    className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-emerald-200 bg-emerald-50/50 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition-all hover:bg-emerald-100 hover:border-emerald-300"
                  >
                    データ管理セクションへ移動
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </section>

            {/* Detailed Analysis */}
            <section className="flex flex-col gap-7 rounded-3xl border border-emerald-100/60 bg-white p-8 shadow-xl shadow-emerald-500/5">
              <div className="flex flex-wrap items-center justify-between gap-5">
                <div>
                  <h2 className="text-3xl font-black text-slate-900">
                    月別の詳細分析
                  </h2>
                  <p className="mt-1 text-base text-slate-600">
                    表示したい月を切り替えて、曜日平均・日別推移・詳細テーブルを確認
                  </p>
                </div>
                <div className="flex flex-wrap gap-2.5">
                  {salesData.map((month) => (
                    <button
                      key={month.id}
                      type="button"
                      onClick={() => setSelectedMonthId(month.id)}
                      className={`rounded-full px-5 py-2.5 text-sm font-bold transition-all ${
                        month.id === selectedMonth?.id
                          ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/40 scale-105"
                          : "border-2 border-emerald-200 text-slate-600 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700"
                      }`}
                    >
                      {month.label}
                    </button>
                  ))}
                </div>
              </div>

              {selectedMonth ? (
                <div className="flex flex-col gap-7">
                  {/* KPI Cards */}
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="group relative overflow-hidden rounded-2xl border border-emerald-100/60 bg-gradient-to-br from-emerald-50 to-teal-50/50 p-6 shadow-md hover:shadow-xl transition-all">
                      <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-emerald-200/30 blur-2xl" />
                      <div className="relative">
                        <div className="mb-3 inline-flex rounded-xl bg-emerald-100/80 p-2.5">
                          <DollarSign className="h-5 w-5 text-emerald-700" />
                        </div>
                        <p className="text-sm font-semibold text-slate-600">月次合計</p>
                        <p className="mt-2 text-3xl font-black text-slate-900">
                          {formatCurrency(selectedMonth.totalRevenue)}
                        </p>
                      </div>
                    </div>

                    <div className="group relative overflow-hidden rounded-2xl border border-teal-100/60 bg-gradient-to-br from-teal-50 to-cyan-50/50 p-6 shadow-md hover:shadow-xl transition-all">
                      <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-teal-200/30 blur-2xl" />
                      <div className="relative">
                        <div className="mb-3 inline-flex rounded-xl bg-teal-100/80 p-2.5">
                          <TrendingUp className="h-5 w-5 text-teal-700" />
                        </div>
                        <p className="text-sm font-semibold text-slate-600">平均日次売上</p>
                        <p className="mt-2 text-3xl font-black text-slate-900">
                          {formatCurrency(selectedMonth.averageDailyRevenue)}
                        </p>
                      </div>
                    </div>

                    <div className="group relative overflow-hidden rounded-2xl border border-emerald-100/60 bg-gradient-to-br from-emerald-50 to-green-50/50 p-6 shadow-md hover:shadow-xl transition-all">
                      <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-green-200/30 blur-2xl" />
                      <div className="relative">
                        <div className="mb-3 inline-flex rounded-xl bg-green-100/80 p-2.5">
                          <Award className="h-5 w-5 text-green-700" />
                        </div>
                        <p className="text-sm font-semibold text-slate-600">
                          最高日 ({bestDay ? `${bestDay.day}日` : "—"})
                        </p>
                        <p className="mt-2 text-3xl font-black text-slate-900">
                          {bestDay ? formatCurrency(bestDay.totalRevenue) : "—"}
                        </p>
                      </div>
                    </div>

                    <div className="group relative overflow-hidden rounded-2xl border border-slate-200/60 bg-gradient-to-br from-slate-50 to-gray-50/50 p-6 shadow-md hover:shadow-xl transition-all">
                      <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-slate-200/30 blur-2xl" />
                      <div className="relative">
                        <div className="mb-3 inline-flex rounded-xl bg-slate-100/80 p-2.5">
                          <CalendarClock className="h-5 w-5 text-slate-700" />
                        </div>
                        <p className="text-sm font-semibold text-slate-600">
                          最低日 ({worstDay ? `${worstDay.day}日` : "—"})
                        </p>
                        <p className="mt-2 text-3xl font-black text-slate-900">
                          {worstDay ? formatCurrency(worstDay.totalRevenue) : "—"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Charts */}
                  <div className="grid gap-7 lg:grid-cols-2">
                    <div className="rounded-3xl border border-emerald-100/60 bg-white p-6 shadow-lg">
                      <div className="mb-5 flex items-center justify-between">
                        <div>
                          <h3 className="text-xl font-bold text-slate-900">
                            曜日別平均売上
                          </h3>
                          <p className="mt-1 text-sm text-slate-500">
                            {selectedMonth.days.length}日分のデータ
                          </p>
                        </div>
                      </div>
                      <Suspense
                        fallback={
                          <div className="h-80 w-full animate-pulse rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50" />
                        }
                      >
                        <WeekdaySalesAverageChart data={weekdayAverageData} />
                      </Suspense>
                    </div>

                    <div className="rounded-3xl border border-emerald-100/60 bg-white p-6 shadow-lg">
                      <div className="mb-5 flex items-center justify-between">
                        <div>
                          <h3 className="text-xl font-bold text-slate-900">
                            日別売上推移
                          </h3>
                          <p className="mt-1 text-sm text-slate-500">
                            {bestDay ? `ピーク日: ${bestDay.day}日` : "ピーク未設定"}
                          </p>
                        </div>
                      </div>
                      <Suspense
                        fallback={
                          <div className="h-80 w-full animate-pulse rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50" />
                        }
                      >
                        <DailySalesChart
                          data={dailyChartData}
                          highlightDay={bestDay?.day}
                        />
                      </Suspense>
                    </div>
                  </div>

                  {/* Composition & Highlights */}
                  <div className="grid gap-7 lg:grid-cols-2">
                    <div className="rounded-3xl border border-emerald-100/60 bg-gradient-to-br from-white to-emerald-50/20 p-7 shadow-lg">
                      <div className="mb-5 flex items-center gap-2.5">
                        <div className="rounded-xl bg-emerald-100 p-2">
                          <DollarSign className="h-5 w-5 text-emerald-700" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900">
                          売上構成
                        </h3>
                      </div>
                      {composition && composition.segments.length > 0 ? (
                        <ul className="space-y-3">
                          {composition.segments.map((segment) => (
                            <li
                              key={segment.label}
                              className="flex items-center justify-between rounded-2xl border border-emerald-100/60 bg-white p-5 shadow-sm"
                            >
                              <span className="font-bold text-slate-800">
                                {segment.label}
                              </span>
                              <div className="text-right">
                                <div className="text-xl font-black text-slate-900">
                                  {formatCurrency(segment.value)}
                                </div>
                                <div className="text-sm font-semibold text-emerald-600">
                                  {formatPercentage(segment.percentage)}
                                </div>
                              </div>
                            </li>
                          ))}
                          <li className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-5">
                            <span className="font-bold text-slate-800">
                              平均単価
                            </span>
                            <span className="text-xl font-black text-emerald-700">
                              {composition.averagePerPerson !== null
                                ? formatCurrency(composition.averagePerPerson)
                                : "—"}
                            </span>
                          </li>
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-500">
                          有効な売上構成がまだありません。
                        </p>
                      )}
                    </div>

                    <div className="rounded-3xl border border-emerald-100/60 bg-gradient-to-br from-white to-teal-50/20 p-7 shadow-lg">
                      <div className="mb-5 flex items-center gap-2.5">
                        <div className="rounded-xl bg-teal-100 p-2">
                          <Award className="h-5 w-5 text-teal-700" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900">
                          売上ハイライト
                        </h3>
                      </div>
                      {topDays.length > 0 ? (
                        <ul className="space-y-3">
                          {topDays.map((day, index) => {
                            const weekday = getWeekdayName(day.date);
                            const type = getDayType(day.date);
                            return (
                              <li
                                key={day.day}
                                className={`flex items-center justify-between rounded-2xl border p-4 shadow-sm ${
                                  index === 0
                                    ? "border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50"
                                    : "border-emerald-100/60 bg-white"
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl font-black ${
                                    index === 0
                                      ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md"
                                      : "bg-slate-100 text-slate-600"
                                  }`}>
                                    {index + 1}
                                  </div>
                                  <div>
                                    <div className="font-bold text-slate-800">
                                      {day.day}日 ({weekday})
                                    </div>
                                    <div className="text-xs font-medium text-slate-500">
                                      {type}
                                    </div>
                                  </div>
                                </div>
                                <div className={`text-right ${index === 0 ? "text-xl" : "text-lg"} font-black ${
                                  index === 0 ? "text-emerald-700" : "text-slate-900"
                                }`}>
                                  {formatCurrency(day.totalRevenue)}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-500">
                          売上データが登録されると上位日が表示されます。
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Insights */}
                  {insights.length > 0 && (
                    <div className="rounded-3xl border border-emerald-100/60 bg-gradient-to-br from-emerald-50/50 via-teal-50/30 to-cyan-50/30 p-7 shadow-lg">
                      <div className="mb-5 flex items-center gap-2.5">
                        <div className="rounded-xl bg-white p-2 shadow-sm">
                          <Sparkles className="h-5 w-5 text-emerald-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900">
                          追加インサイト
                        </h3>
                      </div>
                      <ul className="grid gap-4 sm:grid-cols-2">
                        {insights.map((insight) => (
                          <li
                            key={insight.title}
                            className="flex items-start gap-3 rounded-2xl border border-emerald-100/60 bg-white/90 p-5 shadow-sm"
                          >
                            <div className="mt-1 rounded-full bg-emerald-100 p-1.5">
                              <Sparkles className="h-4 w-4 text-emerald-600" />
                            </div>
                            <div>
                              <p className="font-bold text-slate-800">
                                {insight.title}
                              </p>
                              <p className="mt-1 text-sm text-slate-600">
                                {insight.description}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Details Table */}
                  <div className="rounded-3xl border border-emerald-100/60 bg-white shadow-lg">
                    <button
                      type="button"
                      onClick={() => setDetailsOpen((value) => !value)}
                      className="flex w-full items-center justify-between gap-4 rounded-t-3xl border-b border-emerald-100 bg-gradient-to-r from-emerald-50/50 to-teal-50/30 px-7 py-5 text-left transition-all hover:from-emerald-50 hover:to-teal-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl bg-white p-2 shadow-sm">
                          <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                        </div>
                        <span className="text-lg font-bold text-slate-900">
                          日別の詳細データ
                        </span>
                      </div>
                      {detailsOpen ? (
                        <ChevronUp className="h-6 w-6 text-slate-500" />
                      ) : (
                        <ChevronDown className="h-6 w-6 text-slate-500" />
                      )}
                    </button>
                    {detailsOpen && (
                      <div className="max-h-[600px] overflow-y-auto">
                        <table className="min-w-full divide-y divide-emerald-100 text-sm">
                          <thead className="sticky top-0 bg-gradient-to-r from-emerald-50 to-teal-50/50 text-slate-700 backdrop-blur-sm">
                            <tr>
                              <th className="px-5 py-4 text-left font-bold">
                                日
                              </th>
                              <th className="px-5 py-4 text-left font-bold">
                                曜日
                              </th>
                              <th className="px-5 py-4 text-left font-bold">
                                日タイプ
                              </th>
                              <th className="px-5 py-4 text-right font-bold">
                                医療収益
                              </th>
                              <th className="px-5 py-4 text-right font-bold">
                                自費
                              </th>
                              <th className="px-5 py-4 text-right font-bold">
                                その他
                              </th>
                              <th className="px-5 py-4 text-right font-bold">
                                合計
                              </th>
                              <th className="px-5 py-4 text-right font-bold">
                                人数
                              </th>
                              <th className="px-5 py-4 text-left font-bold">
                                メモ
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-emerald-50/50 bg-white text-slate-700">
                            {selectedMonth.days.map((day) => {
                              const weekday = getWeekdayName(day.date);
                              const dayType = getDayType(day.date);
                              return (
                                <tr
                                  key={day.day}
                                  className={`transition-colors hover:bg-emerald-50/30 ${
                                    dayType === "祝日"
                                      ? "border-l-4 border-l-emerald-500 bg-emerald-50/40"
                                      : dayType === "日曜"
                                        ? "bg-red-50/30"
                                        : dayType === "土曜"
                                          ? "bg-blue-50/30"
                                          : ""
                                  }`}
                                >
                                  <td className="px-5 py-4 font-bold text-slate-700">
                                    {day.day}日
                                  </td>
                                  <td className="px-5 py-4 font-medium text-slate-600">
                                    {weekday}
                                  </td>
                                  <td className="px-5 py-4">
                                    <span
                                      className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${
                                        dayType === "祝日"
                                          ? "bg-emerald-100 text-emerald-700 shadow-sm"
                                          : dayType === "日曜"
                                            ? "bg-red-50 text-red-600"
                                            : dayType === "土曜"
                                              ? "bg-blue-100 text-blue-700"
                                              : dayType === "祝日前日"
                                                ? "bg-yellow-100 text-yellow-700"
                                                : "bg-slate-100 text-slate-600"
                                      }`}
                                    >
                                      {dayType}
                                    </span>
                                  </td>
                                  <td className="px-5 py-4 text-right font-semibold tabular-nums text-slate-800">
                                    {formatCurrency(day.medicalRevenue)}
                                  </td>
                                  <td className="px-5 py-4 text-right font-semibold tabular-nums text-slate-800">
                                    {formatCurrency(day.selfPayRevenue)}
                                  </td>
                                  <td className="px-5 py-4 text-right font-semibold tabular-nums text-slate-800">
                                    {formatCurrency(day.otherRevenue)}
                                  </td>
                                  <td className="px-5 py-4 text-right text-lg font-black tabular-nums text-emerald-700">
                                    {formatCurrency(day.totalRevenue)}
                                  </td>
                                  <td className="px-5 py-4 text-right font-semibold tabular-nums text-slate-800">
                                    {day.peopleCount !== null
                                      ? day.peopleCount.toLocaleString("ja-JP")
                                      : "—"}
                                  </td>
                                  <td className="px-5 py-4 text-left text-slate-600">
                                    {day.note ?? "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl border-2 border-dashed border-emerald-200 bg-emerald-50/30 p-16 text-center text-base text-slate-500 shadow-inner">
                  表示する月を選択してください。
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="rounded-3xl border-2 border-dashed border-emerald-200 bg-emerald-50/30 p-16 text-center text-slate-500 shadow-inner">
            <div className="mx-auto max-w-md">
              <div className="mx-auto mb-6 inline-flex rounded-full bg-emerald-100 p-4">
                <FileSpreadsheet className="h-12 w-12 text-emerald-600" />
              </div>
              <p className="text-lg font-semibold">
                売上CSVをデータ管理からアップロードすると、ここに分析結果が表示されます。
              </p>
              <Link
                href="/patients"
                className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-emerald-500/30 transition-all hover:shadow-xl hover:shadow-emerald-500/40 hover:-translate-y-0.5"
              >
                データ管理へ移動
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
