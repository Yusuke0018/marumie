"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  lazy,
  Suspense,
} from "react";
import {
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
  type SalesDayRecord,
} from "@/lib/salesData";
import { getDayType, getWeekdayName } from "@/lib/dateUtils";
import {
  loadExpenseData,
  type ExpenseRecord,
} from "@/lib/expenseData";
import { AnalysisFilterPortal } from "@/components/AnalysisFilterPortal";
import { setAnalysisPeriodLabel } from "@/lib/analysisPeriod";

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
const ExpenseAnalysisSection = lazy(() =>
  import("@/components/sales/ExpenseAnalysisSection").then((module) => ({
    default: module.ExpenseAnalysisSection,
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

// 期間範囲の集計データ型
type PeriodSummary = {
  totalRevenue: number;
  totalMedicalRevenue: number;
  totalSelfPayRevenue: number;
  totalOtherRevenue: number;
  totalPeopleCount: number | null;
  averageDailyRevenue: number;
  averageMonthlyRevenue: number;
  monthCount: number;
  dayCount: number;
  allDays: SalesDayRecord[];
};

const calculatePeriodSummary = (months: SalesMonthlyData[]): PeriodSummary => {
  if (months.length === 0) {
    return {
      totalRevenue: 0,
      totalMedicalRevenue: 0,
      totalSelfPayRevenue: 0,
      totalOtherRevenue: 0,
      totalPeopleCount: null,
      averageDailyRevenue: 0,
      averageMonthlyRevenue: 0,
      monthCount: 0,
      dayCount: 0,
      allDays: [],
    };
  }

  let totalRevenue = 0;
  let totalMedicalRevenue = 0;
  let totalSelfPayRevenue = 0;
  let totalOtherRevenue = 0;
  let totalPeopleCount = 0;
  let hasPeople = false;
  const allDays: SalesDayRecord[] = [];

  for (const month of months) {
    totalRevenue += month.totalRevenue;
    totalMedicalRevenue += month.totalMedicalRevenue;
    totalSelfPayRevenue += month.totalSelfPayRevenue;
    totalOtherRevenue += month.totalOtherRevenue;
    if (month.totalPeopleCount !== null) {
      totalPeopleCount += month.totalPeopleCount;
      hasPeople = true;
    }
    allDays.push(...month.days);
  }

  const dayCount = allDays.length;
  const monthCount = months.length;

  return {
    totalRevenue,
    totalMedicalRevenue,
    totalSelfPayRevenue,
    totalOtherRevenue,
    totalPeopleCount: hasPeople ? totalPeopleCount : null,
    averageDailyRevenue: dayCount > 0 ? totalRevenue / dayCount : 0,
    averageMonthlyRevenue: monthCount > 0 ? totalRevenue / monthCount : 0,
    monthCount,
    dayCount,
    allDays,
  };
};

export default function SalesPage() {
  const [salesData, setSalesData] = useState<SalesMonthlyData[]>([]);
  const [startMonth, setStartMonth] = useState<string>("");
  const [endMonth, setEndMonth] = useState<string>("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [expenseRecords, setExpenseRecords] = useState<ExpenseRecord[]>([]);

  const hydrateFromStorage = useCallback(() => {
    const loaded = loadSalesDataFromStorage();
    const sorted = [...loaded].sort((a, b) => a.id.localeCompare(b.id));
    setSalesData(sorted);

    // 初期値として全期間を選択
    if (sorted.length > 0) {
      setStartMonth((current) => current || sorted[0]!.id);
      setEndMonth((current) => current || sorted[sorted.length - 1]!.id);
    }

    if (typeof window !== "undefined") {
      setLastUpdated(window.localStorage.getItem(SALES_TIMESTAMP_KEY));
    } else {
      setLastUpdated(null);
    }
    // 経費データの読み込み
    const loadedExpense = loadExpenseData();
    setExpenseRecords(loadedExpense);
  }, []);

  useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  // 月リスト（セレクトボックス用）
  const monthOptions = useMemo(
    () => salesData.map((month) => month.id),
    [salesData],
  );

  // 期間内の月データをフィルタリング
  const filteredMonths = useMemo(() => {
    if (!startMonth || !endMonth) {
      return salesData;
    }
    return salesData.filter(
      (month) => month.id >= startMonth && month.id <= endMonth,
    );
  }, [salesData, startMonth, endMonth]);

  // 期間集計データ
  const periodSummary = useMemo(
    () => calculatePeriodSummary(filteredMonths),
    [filteredMonths],
  );

  // 期間ラベル
  const periodLabel = useMemo(() => {
    if (filteredMonths.length === 0) {
      return "データなし";
    }
    if (filteredMonths.length === 1) {
      return filteredMonths[0]!.label;
    }
    const first = filteredMonths[0]!;
    const last = filteredMonths[filteredMonths.length - 1]!;
    return `${first.label} 〜 ${last.label}`;
  }, [filteredMonths]);

  // ナビゲーションバーの期間表示を更新
  useEffect(() => {
    if (filteredMonths.length > 0) {
      setAnalysisPeriodLabel(periodLabel);
    } else {
      setAnalysisPeriodLabel(null);
    }
  }, [filteredMonths, periodLabel]);

  // ページ離脱時に期間ラベルをクリア
  useEffect(() => {
    return () => {
      setAnalysisPeriodLabel(null);
    };
  }, []);

  // 月をラベル表示に変換
  const renderMonthLabel = useCallback(
    (monthId: string) => {
      const month = salesData.find((m) => m.id === monthId);
      return month?.label ?? monthId;
    },
    [salesData],
  );

  // リセット処理
  const handleReset = useCallback(() => {
    if (salesData.length > 0) {
      setStartMonth(salesData[0]!.id);
      setEndMonth(salesData[salesData.length - 1]!.id);
    }
  }, [salesData]);

  // 月別サマリーデータ（グラフ用）
  const monthlySummary = useMemo(
    () =>
      filteredMonths.map((month) => ({
        id: month.id,
        label: month.label,
        totalRevenue: month.totalRevenue,
      })),
    [filteredMonths],
  );

  // 曜日別平均売上データ
  const weekdayAverageData = useMemo(() => {
    if (periodSummary.allDays.length === 0) {
      return [];
    }
    const accumulator = new Map<string, { label: string; total: number; count: number }>();

    for (const day of periodSummary.allDays) {
      const dayType = getDayType(day.date);
      const weekdayName = getWeekdayName(day.date);
      const isHolidayType =
        dayType === "祝日" ||
        dayType === "大型連休" ||
        dayType === "連休初日" ||
        dayType === "連休中日" ||
        dayType === "連休最終日";
      const key = isHolidayType ? "祝日" : weekdayName;
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
  }, [periodSummary.allDays]);

  // 売上構成
  const composition = useMemo(() => {
    const {
      totalRevenue,
      totalMedicalRevenue,
      totalSelfPayRevenue,
      totalOtherRevenue,
      totalPeopleCount,
    } = periodSummary;

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
          ? totalRevenue / totalPeopleCount
          : null,
      totalPeopleCount,
    };
  }, [periodSummary]);

  // 売上上位日
  const topDays = useMemo(() => {
    return [...periodSummary.allDays]
      .filter((day) => day.totalRevenue > 0)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 5);
  }, [periodSummary.allDays]);

  // 最高/最低曜日
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

  // インサイト
  const insights = useMemo(() => {
    if (periodSummary.monthCount === 0) {
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

    if (topDays.length > 0 && periodSummary.totalRevenue > 0) {
      const topShare =
        (topDays[0]!.totalRevenue / periodSummary.totalRevenue) * 100;
      output.push({
        title: "ピーク日の寄与度",
        description: `${topDays[0]!.date}の売上は期間全体の${formatPercentage(
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
    periodSummary,
    topDays,
    weekdayHighlight,
  ]);

  const hasData = salesData.length > 0 && filteredMonths.length > 0;

  return (
    <main className="min-h-screen bg-gradient-to-br from-emerald-50/40 via-teal-50/30 to-cyan-50/40 pb-24">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-10">
        {/* Filter Portal */}
        <AnalysisFilterPortal
          months={monthOptions}
          startMonth={startMonth}
          endMonth={endMonth}
          onChangeStart={setStartMonth}
          onChangeEnd={setEndMonth}
          onReset={handleReset}
          label={periodLabel}
          renderMonthLabel={renderMonthLabel}
        />

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
                期間を選択して、月次売上と曜日トレンドを可視化。データに基づいた意思決定をサポートします。
              </p>
              <div className="flex flex-wrap items-center gap-4">
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
            {/* Period Summary KPI Cards */}
            <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="group relative overflow-hidden rounded-2xl border border-emerald-200/60 bg-gradient-to-br from-emerald-50 to-emerald-100/50 p-6 shadow-lg hover:shadow-2xl transition-all hover:scale-105">
                <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-emerald-300/40 blur-2xl" />
                <div className="relative">
                  <div className="mb-3 inline-flex rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-500 p-2.5 shadow-md">
                    <DollarSign className="h-5 w-5 text-white" />
                  </div>
                  <p className="text-sm font-semibold text-emerald-700">期間合計</p>
                  <p className="mt-2 text-3xl font-black text-emerald-600">
                    {formatCurrency(periodSummary.totalRevenue)}
                  </p>
                  <p className="mt-2 text-xs text-emerald-600/80">
                    {periodSummary.monthCount}ヶ月分
                  </p>
                </div>
              </div>

              <div className="group relative overflow-hidden rounded-2xl border border-blue-200/60 bg-gradient-to-br from-blue-50 to-blue-100/50 p-6 shadow-lg hover:shadow-2xl transition-all hover:scale-105">
                <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-blue-300/40 blur-2xl" />
                <div className="relative">
                  <div className="mb-3 inline-flex rounded-xl bg-gradient-to-br from-blue-400 to-blue-500 p-2.5 shadow-md">
                    <TrendingUp className="h-5 w-5 text-white" />
                  </div>
                  <p className="text-sm font-semibold text-blue-700">月平均売上</p>
                  <p className="mt-2 text-3xl font-black text-blue-600">
                    {formatCurrency(periodSummary.averageMonthlyRevenue)}
                  </p>
                  <p className="mt-2 text-xs text-blue-600/80">
                    月あたり
                  </p>
                </div>
              </div>

              <div className="group relative overflow-hidden rounded-2xl border border-amber-200/60 bg-gradient-to-br from-amber-50 to-amber-100/50 p-6 shadow-lg hover:shadow-2xl transition-all hover:scale-105">
                <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-amber-300/40 blur-2xl" />
                <div className="relative">
                  <div className="mb-3 inline-flex rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 p-2.5 shadow-md">
                    <CalendarClock className="h-5 w-5 text-white" />
                  </div>
                  <p className="text-sm font-semibold text-amber-700">日平均売上</p>
                  <p className="mt-2 text-3xl font-black text-amber-600">
                    {formatCurrency(periodSummary.averageDailyRevenue)}
                  </p>
                  <p className="mt-2 text-xs text-amber-600/80">
                    {periodSummary.dayCount}日分
                  </p>
                </div>
              </div>

              <div className="group relative overflow-hidden rounded-2xl border border-purple-200/60 bg-gradient-to-br from-purple-50 to-purple-100/50 p-6 shadow-lg hover:shadow-2xl transition-all hover:scale-105">
                <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-purple-300/40 blur-2xl" />
                <div className="relative">
                  <div className="mb-3 inline-flex rounded-xl bg-gradient-to-br from-purple-400 to-purple-500 p-2.5 shadow-md">
                    <Award className="h-5 w-5 text-white" />
                  </div>
                  <p className="text-sm font-semibold text-purple-700">来院人数</p>
                  <p className="mt-2 text-3xl font-black text-purple-600">
                    {formatPeople(periodSummary.totalPeopleCount)}
                  </p>
                  <p className="mt-2 text-xs text-purple-600/80">
                    期間合計
                  </p>
                </div>
              </div>
            </section>

            {/* Monthly Overview */}
            <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
              <div className="overflow-hidden rounded-3xl border border-emerald-100/60 bg-white shadow-xl shadow-emerald-500/5">
                <div className="flex items-center justify-between gap-4 border-b border-emerald-50 bg-gradient-to-r from-emerald-50/50 to-teal-50/30 px-8 py-6">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">
                      月別の売上推移
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      選択期間: {periodLabel}
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
                      selectedId={undefined}
                      onSelect={() => {}}
                    />
                  </Suspense>
                </div>
              </div>

              <div className="flex flex-col gap-6">
                <div className="rounded-3xl border border-emerald-100/60 bg-gradient-to-br from-white to-emerald-50/30 p-7 shadow-xl shadow-emerald-500/5">
                  <div className="mb-5 flex items-center gap-3">
                    <div className="rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 p-2.5 shadow-md">
                      <Award className="h-5 w-5 text-white" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">
                      期間サマリー
                    </h3>
                  </div>
                  <div className="space-y-4">
                    <div className="rounded-2xl bg-white/80 p-5 border border-emerald-100/50 shadow-sm">
                      <p className="text-sm font-medium text-slate-500">分析期間</p>
                      <p className="mt-2 text-xl font-black text-emerald-700">
                        {periodLabel}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/80 p-5 border border-emerald-100/50 shadow-sm">
                      <p className="text-sm font-medium text-slate-500">期間合計売上</p>
                      <p className="mt-2 text-3xl font-black text-slate-900">
                        {formatCurrency(periodSummary.totalRevenue)}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-2xl bg-white/80 p-4 border border-emerald-100/50 shadow-sm">
                        <p className="text-xs font-medium text-slate-500">月数</p>
                        <p className="mt-2 text-lg font-bold text-slate-900">
                          {periodSummary.monthCount}ヶ月
                        </p>
                      </div>
                      <div className="rounded-2xl bg-white/80 p-4 border border-emerald-100/50 shadow-sm">
                        <p className="text-xs font-medium text-slate-500">営業日数</p>
                        <p className="mt-2 text-lg font-bold text-slate-900">
                          {periodSummary.dayCount}日
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

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
                        開始月・終了月を選択すると、その期間のデータを集計して表示します
                      </span>
                    </li>
                    <li className="flex items-start gap-3 rounded-xl bg-emerald-50/50 p-3">
                      <div className="mt-0.5 rounded-full bg-emerald-100 p-1">
                        <div className="h-2 w-2 rounded-full bg-emerald-600" />
                      </div>
                      <span>
                        「期間をリセット」で全期間表示に戻ります
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            {/* Detailed Analysis */}
            <section className="flex flex-col gap-7 rounded-3xl border border-emerald-100/60 bg-white p-8 shadow-xl shadow-emerald-500/5">
              <div>
                <h2 className="text-3xl font-black text-slate-900">
                  期間内の詳細分析
                </h2>
                <p className="mt-1 text-base text-slate-600">
                  {periodLabel} の曜日平均・売上構成・ハイライトを確認
                </p>
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
                        {periodSummary.dayCount}日分のデータ
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
                        月別売上推移
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {periodSummary.monthCount}ヶ月分のトレンド
                      </p>
                    </div>
                  </div>
                  <Suspense
                    fallback={
                      <div className="h-80 w-full animate-pulse rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50" />
                    }
                  >
                    <MonthlySalesChart
                      data={monthlySummary}
                      selectedId={undefined}
                      onSelect={() => {}}
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
                      {composition.segments.map((segment, index) => {
                        const colors = [
                          { bg: "from-rose-50 to-pink-50", border: "border-rose-200", text: "text-rose-700", value: "text-rose-600" },
                          { bg: "from-blue-50 to-cyan-50", border: "border-blue-200", text: "text-blue-700", value: "text-blue-600" },
                          { bg: "from-violet-50 to-purple-50", border: "border-violet-200", text: "text-violet-700", value: "text-violet-600" },
                        ];
                        const color = colors[index % colors.length];
                        return (
                          <li
                            key={segment.label}
                            className={`flex items-center justify-between rounded-2xl border ${color.border} bg-gradient-to-r ${color.bg} p-5 shadow-md hover:shadow-lg transition-all`}
                          >
                            <span className={`font-bold ${color.text}`}>
                              {segment.label}
                            </span>
                            <div className="text-right">
                              <div className={`text-xl font-black ${color.value}`}>
                                {formatCurrency(segment.value)}
                              </div>
                              <div className={`text-sm font-semibold ${color.text}`}>
                                {formatPercentage(segment.percentage)}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                      <li className="flex items-center justify-between rounded-2xl border-2 border-emerald-300 bg-gradient-to-r from-emerald-100 to-teal-100 p-5 shadow-lg">
                        <span className="font-black text-emerald-800">
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
                      売上ハイライト（期間内TOP5）
                    </h3>
                  </div>
                  {topDays.length > 0 ? (
                    <ul className="space-y-3">
                      {topDays.map((day, index) => {
                        const weekday = getWeekdayName(day.date);
                        const type = getDayType(day.date);
                        const rankColors = [
                          { bg: "from-amber-50 to-yellow-50", border: "border-amber-200", badge: "from-amber-400 to-amber-500", text: "text-amber-700", value: "text-amber-600" },
                          { bg: "from-slate-50 to-gray-50", border: "border-slate-200", badge: "from-slate-400 to-slate-500", text: "text-slate-700", value: "text-slate-600" },
                          { bg: "from-orange-50 to-amber-50", border: "border-orange-200", badge: "from-orange-400 to-orange-500", text: "text-orange-700", value: "text-orange-600" },
                          { bg: "from-sky-50 to-blue-50", border: "border-sky-200", badge: "from-sky-400 to-sky-500", text: "text-sky-700", value: "text-sky-600" },
                          { bg: "from-indigo-50 to-violet-50", border: "border-indigo-200", badge: "from-indigo-400 to-indigo-500", text: "text-indigo-700", value: "text-indigo-600" },
                        ];
                        const color = rankColors[index];
                        return (
                          <li
                            key={day.date}
                            className={`flex items-center justify-between rounded-2xl border ${color.border} bg-gradient-to-r ${color.bg} p-4 shadow-md hover:shadow-xl transition-all ${
                              index === 0 ? "scale-105 border-2" : ""
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`flex h-10 w-10 items-center justify-center rounded-xl font-black bg-gradient-to-br ${color.badge} text-white shadow-md`}>
                                {index + 1}
                              </div>
                              <div>
                                <div className={`font-bold ${color.text}`}>
                                  {day.date} ({weekday})
                                </div>
                                <div className="text-xs font-medium text-slate-500">
                                  {type}
                                </div>
                              </div>
                            </div>
                            <div className={`text-right ${index === 0 ? "text-xl" : "text-lg"} font-black ${color.value}`}>
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
                    {insights.map((insight, index) => {
                      const insightColors = [
                        { bg: "from-emerald-50 to-teal-50", border: "border-emerald-200", icon: "bg-emerald-100", iconColor: "text-emerald-600", text: "text-emerald-800" },
                        { bg: "from-blue-50 to-cyan-50", border: "border-blue-200", icon: "bg-blue-100", iconColor: "text-blue-600", text: "text-blue-800" },
                        { bg: "from-purple-50 to-violet-50", border: "border-purple-200", icon: "bg-purple-100", iconColor: "text-purple-600", text: "text-purple-800" },
                        { bg: "from-amber-50 to-orange-50", border: "border-amber-200", icon: "bg-amber-100", iconColor: "text-amber-600", text: "text-amber-800" },
                      ];
                      const color = insightColors[index % insightColors.length];
                      return (
                        <li
                          key={insight.title}
                          className={`flex items-start gap-3 rounded-2xl border ${color.border} bg-gradient-to-br ${color.bg} p-5 shadow-md hover:shadow-lg transition-all`}
                        >
                          <div className={`mt-1 rounded-full ${color.icon} p-2 shadow-sm`}>
                            <Sparkles className={`h-4 w-4 ${color.iconColor}`} />
                          </div>
                          <div>
                            <p className={`font-bold ${color.text}`}>
                              {insight.title}
                            </p>
                            <p className="mt-1 text-sm text-slate-600">
                              {insight.description}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Month by Month Details Table */}
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
                      月別詳細データ
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
                            月
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
                          <th className="px-5 py-4 text-right font-bold">
                            日平均
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-emerald-50/50 bg-white text-slate-700">
                        {filteredMonths.map((month) => (
                          <tr
                            key={month.id}
                            className="transition-colors hover:bg-emerald-50/30"
                          >
                            <td className="px-5 py-4 font-bold text-slate-700">
                              {month.label}
                            </td>
                            <td className="px-5 py-4 text-right font-semibold tabular-nums text-slate-800">
                              {formatCurrency(month.totalMedicalRevenue)}
                            </td>
                            <td className="px-5 py-4 text-right font-semibold tabular-nums text-slate-800">
                              {formatCurrency(month.totalSelfPayRevenue)}
                            </td>
                            <td className="px-5 py-4 text-right font-semibold tabular-nums text-slate-800">
                              {formatCurrency(month.totalOtherRevenue)}
                            </td>
                            <td className="px-5 py-4 text-right text-lg font-black tabular-nums text-emerald-700">
                              {formatCurrency(month.totalRevenue)}
                            </td>
                            <td className="px-5 py-4 text-right font-semibold tabular-nums text-slate-800">
                              {month.totalPeopleCount !== null
                                ? month.totalPeopleCount.toLocaleString("ja-JP")
                                : "—"}
                            </td>
                            <td className="px-5 py-4 text-right font-semibold tabular-nums text-slate-800">
                              {formatCurrency(month.averageDailyRevenue)}
                            </td>
                          </tr>
                        ))}
                        {/* 合計行 */}
                        <tr className="bg-gradient-to-r from-emerald-100 to-teal-100 font-bold">
                          <td className="px-5 py-4 font-black text-emerald-800">
                            合計
                          </td>
                          <td className="px-5 py-4 text-right tabular-nums text-emerald-800">
                            {formatCurrency(periodSummary.totalMedicalRevenue)}
                          </td>
                          <td className="px-5 py-4 text-right tabular-nums text-emerald-800">
                            {formatCurrency(periodSummary.totalSelfPayRevenue)}
                          </td>
                          <td className="px-5 py-4 text-right tabular-nums text-emerald-800">
                            {formatCurrency(periodSummary.totalOtherRevenue)}
                          </td>
                          <td className="px-5 py-4 text-right text-lg font-black tabular-nums text-emerald-900">
                            {formatCurrency(periodSummary.totalRevenue)}
                          </td>
                          <td className="px-5 py-4 text-right tabular-nums text-emerald-800">
                            {periodSummary.totalPeopleCount !== null
                              ? periodSummary.totalPeopleCount.toLocaleString("ja-JP")
                              : "—"}
                          </td>
                          <td className="px-5 py-4 text-right tabular-nums text-emerald-800">
                            {formatCurrency(periodSummary.averageDailyRevenue)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>

            {/* 経費分析セクション */}
            <Suspense
              fallback={
                <div className="h-96 w-full animate-pulse rounded-3xl bg-gradient-to-br from-orange-50 to-amber-50" />
              }
            >
              <ExpenseAnalysisSection records={expenseRecords} />
            </Suspense>
          </>
        ) : (
          <>
            <section className="rounded-3xl border-2 border-dashed border-emerald-200 bg-emerald-50/30 p-16 text-center text-slate-500 shadow-inner">
              <div className="mx-auto max-w-md">
                <div className="mx-auto mb-6 inline-flex rounded-full bg-emerald-100 p-4">
                  <FileSpreadsheet className="h-12 w-12 text-emerald-600" />
                </div>
                <p className="text-lg font-semibold">
                  売上CSVをデータ管理ページからアップロードすると、ここに分析結果が表示されます。
                </p>
                <p className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-emerald-500/30">
                  データ管理ページから売上CSVを登録するとグラフが表示されます。
                </p>
              </div>
            </section>

            {/* 経費分析セクション（売上データがなくても表示） */}
            <Suspense
              fallback={
                <div className="h-96 w-full animate-pulse rounded-3xl bg-gradient-to-br from-orange-50 to-amber-50" />
              }
            >
              <ExpenseAnalysisSection records={expenseRecords} />
            </Suspense>
          </>
        )}
      </div>
    </main>
  );
}
