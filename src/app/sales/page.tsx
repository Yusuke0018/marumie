"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  lazy,
  Suspense,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FolderUp,
  Info,
  Loader2,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import {
  SALES_TIMESTAMP_KEY,
  clearSalesDataStorage,
  loadSalesDataFromStorage,
  parseSalesCsv,
  saveSalesDataToStorage,
  upsertSalesMonth,
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
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadSalesDataFromStorage();
    if (stored.length > 0) {
      setSalesData(stored);
      setSelectedMonthId(stored[stored.length - 1]?.id ?? null);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setLastUpdated(window.localStorage.getItem(SALES_TIMESTAMP_KEY));
  }, [salesData]);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) {
        return;
      }

      setIsUploading(true);
      setUploadMessage(null);
      setErrorMessage(null);

      const parsedMonths: SalesMonthlyData[] = [];
      const errors: string[] = [];

      for (const file of Array.from(files)) {
        try {
          const text = await file.text();
          const parsed = parseSalesCsv(text, { fileName: file.name });
          parsedMonths.push(parsed);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "解析に失敗しました";
          errors.push(`${file.name}: ${message}`);
        }
      }

      if (parsedMonths.length > 0) {
        setSalesData((prev) => {
          let next = prev;
          for (const month of parsedMonths) {
            next = upsertSalesMonth(next, month);
          }
          saveSalesDataToStorage(next);
          return next;
        });
        setSelectedMonthId(
          parsedMonths[parsedMonths.length - 1]?.id ??
            parsedMonths[0]?.id ??
            null,
        );
        setUploadMessage(`${parsedMonths.length}件の売上データを追加しました。`);
      }

      if (errors.length > 0) {
        setErrorMessage(errors.join("\n"));
      }

      setIsUploading(false);
    },
    [],
  );

  const handleFileInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      await handleFiles(event.target.files);
      event.target.value = "";
    },
    [handleFiles],
  );

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      await handleFiles(event.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
  }, []);

  const clearAllSales = useCallback(() => {
    setSalesData([]);
    setSelectedMonthId(null);
    clearSalesDataStorage();
    setUploadMessage(null);
    setErrorMessage(null);
  }, []);

  const monthlySummary = useMemo(
    () =>
      salesData.map((month) => ({
        id: month.id,
        label: month.label,
        totalRevenue: month.totalRevenue,
      })),
    [salesData],
  );

  const selectedMonth = useMemo(
    () => salesData.find((month) => month.id === selectedMonthId) ?? null,
    [salesData, selectedMonthId],
  );

  const latestMonth = useMemo(() => {
    if (salesData.length === 0) return null;
    return salesData[salesData.length - 1];
  }, [salesData]);

  const weekdayAverageData = useMemo(() => {
    if (!selectedMonth) {
      return [];
    }
    const accumulator = new Map<
      string,
      { label: string; total: number; count: number }
    >();

    for (const day of selectedMonth.days) {
      const dayType = getDayType(day.date);
      const weekdayName = getWeekdayName(day.date);

      const key =
        dayType === "祝日" || dayType === "大型連休"
          ? "祝日"
          : weekdayName;

      const label = key;
      if (!accumulator.has(key)) {
        accumulator.set(key, { label, total: 0, count: 0 });
      }
      const bucket = accumulator.get(key)!;
      bucket.total += day.totalRevenue;
      bucket.count += 1;
    }

    const ordered: string[] = [
      ...WEEKDAY_ORDER,
      ...(accumulator.has("祝日") ? ["祝日"] : []),
    ];

    return ordered
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
    if (!selectedMonth) return [];
    return selectedMonth.days.map((day) => ({
      day: day.day,
      date: day.date,
      totalRevenue: day.totalRevenue,
      note: day.note ?? undefined,
    }));
  }, [selectedMonth]);

  const bestDay = useMemo(() => {
    if (!selectedMonth || selectedMonth.days.length === 0) {
      return null;
    }
    return selectedMonth.days.reduce((acc, day) =>
      day.totalRevenue > acc.totalRevenue ? day : acc,
    );
  }, [selectedMonth]);

  const worstDay = useMemo(() => {
    if (!selectedMonth || selectedMonth.days.length === 0) {
      return null;
    }
    return selectedMonth.days.reduce((acc, day) =>
      day.totalRevenue < acc.totalRevenue ? day : acc,
    );
  }, [selectedMonth]);

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
                売上CSVをアップロードすると月別の売上推移・曜日別平均・日別の詳細を可視化します。
                他の分析ページと同じUIで、気になる月を素早く切り替えながら貢献度の高い日を確認できます。
              </p>
              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  月次サマリ・曜日平均・日次詳細
                </div>
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2">
                  <ArrowRight className="h-4 w-4 text-sky-500" />
                  CSVドラッグ＆ドロップ対応
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col gap-8">
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-lg">
              <div className="flex flex-col gap-6 p-8">
                <div className="flex flex-col gap-2">
                  <h2 className="text-xl font-bold text-slate-900">売上CSVの取り込み</h2>
                  <p className="text-sm text-slate-500">
                    例: <span className="font-semibold">2025年売り上げ表 - 2025_10.csv</span>
                    。同じ月を再アップロードすると上書きします。
                  </p>
                </div>

                <label
                  htmlFor="sales-upload"
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  className="group relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-sky-200 bg-sky-50/40 px-6 py-10 text-center transition hover:border-sky-300 hover:bg-sky-50"
                >
                  <div className="rounded-full bg-sky-100 p-4 text-sky-600 shadow-inner">
                    {isUploading ? (
                      <Loader2 className="h-8 w-8 animate-spin" />
                    ) : (
                      <FolderUp className="h-8 w-8" />
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-base font-semibold text-slate-700">
                      クリックまたはCSVをドロップ
                    </span>
                    <span className="text-xs text-slate-500">
                      ShiftまたはCommandキーで複数ファイル選択
                    </span>
                  </div>
                  <input
                    id="sales-upload"
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={handleFileInputChange}
                    multiple
                    disabled={isUploading}
                  />
                </label>

                {uploadMessage && (
                  <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-700">
                    <CheckCircle2 className="h-5 w-5" />
                    <span>{uploadMessage}</span>
                  </div>
                )}

                {errorMessage && (
                  <div className="flex items-start gap-3 rounded-2xl border border-rose-100 bg-rose-50/80 px-4 py-4 text-sm text-rose-600">
                    <Info className="mt-1 h-5 w-5" />
                    <span className="whitespace-pre-wrap">{errorMessage}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                  <div className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span>
                      {salesData.length > 0
                        ? `${salesData.length}件の月次データを管理中`
                        : "まだ売上データはありません"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={clearAllSales}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-500"
                    disabled={salesData.length === 0}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    すべて削除
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-lg">
              <div className="flex flex-col gap-4 p-8">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">月別の売上推移</h2>
                    <p className="text-sm text-slate-500">
                      アップロード済みの月次データから合計を算出しています。
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
                <Suspense fallback={<div className="h-80 w-full animate-pulse bg-slate-100 rounded-2xl" />}>
                  <MonthlySalesChart
                    data={monthlySummary}
                    selectedId={selectedMonthId}
                    onSelect={setSelectedMonthId}
                  />
                </Suspense>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="rounded-3xl border border-emerald-100 bg-emerald-50/70 p-6 shadow-inner ring-1 ring-emerald-100">
              <h3 className="text-sm font-semibold text-emerald-800">
                売上CSVのフォーマット
              </h3>
              <ul className="mt-3 space-y-2 text-sm text-emerald-700">
                <li>先頭列が日（1〜31）、次に医療収益・自費金額・その他・日々の合計・人数を想定。</li>
                <li>金額は「¥」付きでも自動整形します。</li>
                <li>ファイル名に <span className="font-semibold">YYYY_MM</span> を含めると月を自動判定します。</li>
              </ul>
            </div>

            {latestMonth ? (
              <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-lg">
                <h3 className="text-lg font-bold text-slate-900">
                  直近の集計状況
                </h3>
                <div className="mt-4 space-y-3 text-sm text-slate-600">
                  <div className="flex items-center justify-between">
                    <span>対象月</span>
                    <span className="font-semibold text-slate-800">{latestMonth.label}</span>
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
          </div>
        </section>

        {salesData.length > 0 ? (
          <section className="flex flex-col gap-8 rounded-3xl border border-slate-200 bg-white/95 p-8 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">
                  月別の詳細分析
                </h2>
                <p className="text-sm text-slate-500">
                  表示したい月を切り替えて、曜日平均・日次推移・詳細テーブルを確認できます。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {salesData.map((month) => (
                  <button
                    key={month.id}
                    type="button"
                    onClick={() => setSelectedMonthId(month.id)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      month.id === selectedMonthId
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
                    <Suspense fallback={<div className="h-72 w-full animate-pulse rounded-2xl bg-slate-100" />}>
                      <WeekdaySalesAverageChart data={weekdayAverageData} />
                    </Suspense>
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-inner">
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-slate-800">
                        日別売上推移
                      </h3>
                      <span className="text-xs text-slate-400">
                        ピーク日: {bestDay ? `${bestDay.day}日` : "—"}
                      </span>
                    </div>
                    <Suspense fallback={<div className="h-72 w-full animate-pulse rounded-2xl bg-slate-100" />}>
                      <DailySalesChart
                        data={dailyChartData}
                        highlightDay={bestDay?.day}
                      />
                    </Suspense>
                  </div>
                </div>

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
                            <th className="px-4 py-3 text-left font-semibold">日</th>
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
        ) : (
          <section className="rounded-3xl border border-dashed border-slate-200 bg-white/70 p-12 text-center text-slate-500">
            売上CSVをアップロードすると分析結果が表示されます。
          </section>
        )}
      </div>
    </main>
  );
}
