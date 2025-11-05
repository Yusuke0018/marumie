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
    <main className="min-h-screen bg-gradient-to-br from-white via-sky-50/40 to-slate-50 pb-24">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
        <section className="overflow-hidden rounded-3xl border border-sky-100 bg-white/90 shadow-xl">
          <div className="relative isolate px-6 py-14 sm:px-10 lg:px-16">
            <div className="absolute -left-24 top-16 h-56 w-56 rounded-full bg-sky-200/40 blur-3xl" />
            <div className="absolute -right-16 bottom-10 h-64 w-64 rounded-full bg-emerald-200/30 blur-3xl" />
            <div className="relative z-10 flex flex-col gap-6">
              <span className="inline-flex items-center gap-3 self-start rounded-full border border-sky-200 bg-sky-50/70 px-4 py-2 text-xs font-semibold text-sky-600 shadow-sm">
                <FileSpreadsheet className="h-4 w-4" />
                売上ダッシュボード
              </span>
              <h1 className="text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
                月次売上と曜日トレンドを一目で把握
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-slate-600">
                売上CSVは患者分析ページの「データ管理」からアップロードできます。
                取り込んだデータはこのダッシュボードに即時反映され、月別推移・曜日平均・日別の詳細を同じUIで確認できます。
              </p>
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                <Link
                  href="/patients"
                  className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 transition hover:bg-sky-600"
                >
                  データ管理を開く
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <button
                  type="button"
                  onClick={hydrateFromStorage}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
                >
                  <RefreshCcw className="h-4 w-4" />
                  最新のデータを読み込み
                </button>
              </div>
            </div>
          </div>
        </section>

        {hasData ? (
          <>
            <section className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-lg">
                <div className="flex items-center justify-between gap-4 p-8 pb-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">
                      月別の売上推移
                    </h2>
                    <p className="text-sm text-slate-500">
                      アップロード済みの月次データから合計売上を集計しています。
                    </p>
                  </div>
                  {lastUpdated && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
                      <RefreshCcw className="h-3.5 w-3.5" />
                      最終更新:{" "}
                      {new Date(lastUpdated).toLocaleString("ja-JP", {
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
                <Suspense
                  fallback={
                    <div className="h-80 w-full animate-pulse rounded-2xl bg-slate-100" />
                  }
                >
                  <MonthlySalesChart
                    data={monthlySummary}
                    selectedId={selectedMonth?.id}
                    onSelect={setSelectedMonthId}
                  />
                </Suspense>
              </div>

              <div className="flex flex-col gap-6">
                {latestMonth ? (
                  <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-lg">
                    <h3 className="text-lg font-bold text-slate-900">
                      直近の集計状況
                    </h3>
                    <div className="mt-4 space-y-3 text-sm text-slate-600">
                      <div className="flex items-center justify-between">
                        <span>対象月</span>
                        <span className="font-semibold text-slate-800">
                          {latestMonth.label}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>月次合計</span>
                        <span className="font-semibold text-slate-800">
                          {formatCurrency(latestMonth.totalRevenue)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>平均日次売上</span>
                        <span className="font-semibold text-slate-800">
                          {formatCurrency(latestMonth.averageDailyRevenue)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>延べ来院人数</span>
                        <span className="font-semibold text-slate-800">
                          {formatPeople(latestMonth.totalPeopleCount)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-3xl border border-dashed border-slate-200 bg-white/60 p-6 text-sm text-slate-500 shadow-inner">
                    売上データを取り込むとここにサマリが表示されます。
                  </div>
                )}

                <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-lg">
                  <h3 className="text-lg font-bold text-slate-900">
                    データ管理のヒント
                  </h3>
                  <ul className="mt-4 space-y-3 text-sm text-slate-600">
                    <li className="flex items-start gap-2">
                      <Sparkles className="mt-0.5 h-4 w-4 text-sky-500" />
                      売上CSVは「2025年売上表-2025_09.csv」のように年月を含めると自動で判別されます。
                    </li>
                    <li className="flex items-start gap-2">
                      <Sparkles className="mt-0.5 h-4 w-4 text-sky-500" />
                      まとめて取り込む場合はファイル名に「売上」を含めるとデータ管理で一括処理できます。
                    </li>
                  </ul>
                  <Link
                    href="/patients"
                    className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                  >
                    データ管理セクションへ移動
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-8 rounded-3xl border border-slate-200 bg-white/95 p-8 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">
                    月別の詳細分析
                  </h2>
                  <p className="text-sm text-slate-500">
                    表示したい月を切り替えて、曜日平均・日別推移・詳細テーブルを確認できます。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {salesData.map((month) => (
                    <button
                      key={month.id}
                      type="button"
                      onClick={() => setSelectedMonthId(month.id)}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                        month.id === selectedMonth?.id
                          ? "bg-sky-500 text-white shadow-lg"
                          : "border border-slate-200 text-slate-500 hover:bg-slate-100"
                      }`}
                    >
                      {month.label}
                    </button>
                  ))}
                </div>
              </div>

              {selectedMonth ? (
                <div className="flex flex-col gap-8">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-5 text-sm text-slate-600">
                      <p className="font-semibold text-slate-500">月次合計</p>
                      <p className="mt-2 text-2xl font-black text-slate-900">
                        {formatCurrency(selectedMonth.totalRevenue)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-5 text-sm text-slate-600">
                      <p className="font-semibold text-slate-500">平均日次売上</p>
                      <p className="mt-2 text-2xl font-black text-slate-900">
                        {formatCurrency(selectedMonth.averageDailyRevenue)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-5 text-sm text-slate-600">
                      <p className="font-semibold text-slate-500">
                        最高日 ({bestDay ? `${bestDay.day}日` : "—"})
                      </p>
                      <p className="mt-2 text-2xl font-black text-slate-900">
                        {bestDay ? formatCurrency(bestDay.totalRevenue) : "—"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-5 text-sm text-slate-600">
                      <p className="font-semibold text-slate-500">
                        最低日 ({worstDay ? `${worstDay.day}日` : "—"})
                      </p>
                      <p className="mt-2 text-2xl font-black text-slate-900">
                        {worstDay ? formatCurrency(worstDay.totalRevenue) : "—"}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-8 lg:grid-cols-2">
                    <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-inner">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-slate-800">
                          曜日別平均売上
                        </h3>
                        <span className="text-xs text-slate-400">
                          {selectedMonth.days.length}日分
                        </span>
                      </div>
                      <Suspense
                        fallback={
                          <div className="h-72 w-full animate-pulse rounded-2xl bg-slate-100" />
                        }
                      >
                        <WeekdaySalesAverageChart data={weekdayAverageData} />
                      </Suspense>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-inner">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-slate-800">
                          日別売上推移
                        </h3>
                        <span className="text-xs text-slate-400">
                          {bestDay ? `ピーク日: ${bestDay.day}日` : "ピーク未設定"}
                        </span>
                      </div>
                      <Suspense
                        fallback={
                          <div className="h-72 w-full animate-pulse rounded-2xl bg-slate-100" />
                        }
                      >
                        <DailySalesChart
                          data={dailyChartData}
                          highlightDay={bestDay?.day}
                        />
                      </Suspense>
                    </div>
                  </div>

                  <div className="grid gap-8 lg:grid-cols-2">
                    <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-inner">
                      <h3 className="text-lg font-semibold text-slate-800">
                        売上構成
                      </h3>
                      {composition && composition.segments.length > 0 ? (
                        <ul className="mt-4 space-y-3 text-sm text-slate-600">
                          {composition.segments.map((segment) => (
                            <li
                              key={segment.label}
                              className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white/60 px-4 py-3"
                            >
                              <span className="font-semibold text-slate-700">
                                {segment.label}
                              </span>
                              <span className="text-right">
                                <span className="block font-semibold text-slate-900">
                                  {formatCurrency(segment.value)}
                                </span>
                                <span className="text-xs text-slate-400">
                                  {formatPercentage(segment.percentage)}
                                </span>
                              </span>
                            </li>
                          ))}
                          <li className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                            <span className="font-semibold text-slate-700">
                              平均単価
                            </span>
                            <span className="text-right font-semibold text-slate-900">
                              {composition.averagePerPerson !== null
                                ? formatCurrency(composition.averagePerPerson)
                                : "—"}
                            </span>
                          </li>
                        </ul>
                      ) : (
                        <p className="mt-4 text-sm text-slate-500">
                          有効な売上構成がまだありません。
                        </p>
                      )}
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-inner">
                      <h3 className="text-lg font-semibold text-slate-800">
                        売上ハイライト
                      </h3>
                      {topDays.length > 0 ? (
                        <ul className="mt-4 space-y-3 text-sm text-slate-600">
                          {topDays.map((day) => {
                            const weekday = getWeekdayName(day.date);
                            const type = getDayType(day.date);
                            return (
                              <li
                                key={day.day}
                                className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white/60 px-4 py-3"
                              >
                                <div className="flex flex-col">
                                  <span className="font-semibold text-slate-700">
                                    {day.day}日 ({weekday})
                                  </span>
                                  <span className="text-xs text-slate-400">
                                    {type}
                                  </span>
                                </div>
                                <span className="flex items-center gap-3 font-semibold text-slate-900">
                                  {formatCurrency(day.totalRevenue)}
                                  <CalendarClock className="h-4 w-4 text-sky-500" />
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="mt-4 text-sm text-slate-500">
                          売上データが登録されると上位日が表示されます。
                        </p>
                      )}
                    </div>
                  </div>

                  {insights.length > 0 && (
                    <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-sky-50 p-6 shadow-inner">
                      <h3 className="text-lg font-semibold text-slate-800">
                        追加インサイト
                      </h3>
                      <ul className="mt-4 space-y-3 text-sm text-slate-600">
                        {insights.map((insight) => (
                          <li
                            key={insight.title}
                            className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white/70 px-4 py-3"
                          >
                            <Sparkles className="mt-0.5 h-4 w-4 text-sky-500" />
                            <div>
                              <p className="font-semibold text-slate-700">
                                {insight.title}
                              </p>
                              <p className="text-xs text-slate-500">
                                {insight.description}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="rounded-3xl border border-slate-200 bg-white/90">
                    <button
                      type="button"
                      onClick={() => setDetailsOpen((value) => !value)}
                      className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                      <span>日別の詳細データ</span>
                      {detailsOpen ? (
                        <ChevronUp className="h-5 w-5 text-slate-400" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-slate-400" />
                      )}
                    </button>
                    {detailsOpen && (
                      <div className="max-h-[540px] overflow-y-auto border-t border-slate-100">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                          <thead className="bg-slate-50 text-slate-500">
                            <tr>
                              <th className="px-4 py-3 text-left font-semibold">
                                日
                              </th>
                              <th className="px-4 py-3 text-right font-semibold">
                                医療収益
                              </th>
                              <th className="px-4 py-3 text-right font-semibold">
                                自費
                              </th>
                              <th className="px-4 py-3 text-right font-semibold">
                                その他
                              </th>
                              <th className="px-4 py-3 text-right font-semibold">
                                合計
                              </th>
                              <th className="px-4 py-3 text-right font-semibold">
                                人数
                              </th>
                              <th className="px-4 py-3 text-left font-semibold">
                                メモ
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 bg-white text-slate-700">
                            {selectedMonth.days.map((day) => (
                              <tr key={day.day} className="hover:bg-slate-50/80">
                                <td className="px-4 py-3 font-semibold text-slate-600">
                                  {day.day}日
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums">
                                  {formatCurrency(day.medicalRevenue)}
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums">
                                  {formatCurrency(day.selfPayRevenue)}
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums">
                                  {formatCurrency(day.otherRevenue)}
                                </td>
                                <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                                  {formatCurrency(day.totalRevenue)}
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums">
                                  {day.peopleCount !== null
                                    ? day.peopleCount.toLocaleString("ja-JP")
                                    : "—"}
                                </td>
                                <td className="px-4 py-3 text-left">
                                  {day.note ?? "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-white/70 p-12 text-center text-sm text-slate-500">
                  表示する月を選択してください。
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="rounded-3xl border border-dashed border-slate-200 bg-white/70 p-12 text-center text-slate-500">
            売上CSVをデータ管理からアップロードすると、ここに分析結果が表示されます。
            <div className="mt-6 flex justify-center">
              <Link
                href="/patients"
                className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 transition hover:bg-sky-600"
              >
                データ管理へ移動
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
