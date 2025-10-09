"use client";

import { useEffect, useMemo, useState } from "react";
import { filterByDateRange, filterByPeriod, getMonthKey, type PeriodType } from "@/lib/dateUtils";
import { RefreshCw } from "lucide-react";
import {
  type ListingCategory,
  type ListingCategoryData,
  loadListingDataFromStorage,
  loadListingTimestamp,
  clearListingStorage,
  LISTING_STORAGE_KEY,
  LISTING_TIMESTAMP_KEY,
} from "@/lib/listingData";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

type PeriodFilter = PeriodType | "custom";

export default function ListingPage() {
  const [categoryData, setCategoryData] = useState<ListingCategoryData[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<ListingCategory>("内科");
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodFilter>("all");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setCategoryData(loadListingDataFromStorage());
      setLastUpdated(loadListingTimestamp());
      setUploadError(null);
    } catch (error) {
      console.error(error);
      setUploadError("保存済みデータの読み込みに失敗しました。");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LISTING_STORAGE_KEY || event.key === LISTING_TIMESTAMP_KEY) {
        setCategoryData(loadListingDataFromStorage());
        setLastUpdated(loadListingTimestamp());
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const availableMonths = useMemo(() => {
    const category = categoryData.find((c) => c.category === selectedCategory);
    if (!category) {
      return [];
    }
    const months = new Set<string>();
    category.data.forEach((item) => {
      const key = getMonthKey(item.date);
      if (key) {
        months.add(key);
      }
    });
    return Array.from(months).sort();
  }, [categoryData, selectedCategory]);

  useEffect(() => {
    if (availableMonths.length === 0) {
      if (selectedMonth !== "" && selectedMonth !== "all") {
        setSelectedMonth("");
      }
      return;
    }

    const latestMonth = availableMonths[availableMonths.length - 1];
    if (selectedMonth === "") {
      setSelectedMonth(latestMonth);
      return;
    }

    if (selectedMonth !== "all" && !availableMonths.includes(selectedMonth)) {
      setSelectedMonth(latestMonth);
    }
  }, [availableMonths, selectedMonth]);

  const currentData = useMemo(() => {
    let data = categoryData.find(c => c.category === selectedCategory)?.data || [];
    if (selectedPeriod === "custom") {
      data = filterByDateRange(data, {
        startDate: customStartDate || undefined,
        endDate: customEndDate || undefined,
        getDate: (item) => item.date,
      });
    } else if (selectedPeriod !== "all") {
      data = filterByPeriod(data, selectedPeriod);
    }
    if (selectedMonth !== "" && selectedMonth !== "all") {
      data = data.filter((item) => getMonthKey(item.date) === selectedMonth);
    }
    return data;
  }, [
    categoryData,
    selectedCategory,
    selectedPeriod,
    selectedMonth,
    customStartDate,
    customEndDate,
  ]);

  const dailyMetricsData = useMemo(() => {
    return currentData.map(d => ({
      date: d.date,
      金額: d.amount,
      CV: d.cv,
      CVR: d.cvr,
      CPA: d.cpa,
    }));
  }, [currentData]);

  const hourlyData = useMemo(() => {
    const hourlyTotals = Array(24).fill(0);
    
    for (const item of currentData) {
      for (let h = 0; h < 24; h++) {
        hourlyTotals[h] += item.hourlyCV[h];
      }
    }

    return hourlyTotals.map((total, hour) => ({
      hour: `${hour}時`,
      CV: total,
    }));
  }, [currentData]);

  const handleReset = () => {
    clearListingStorage();
    setCategoryData([]);
    setLastUpdated(null);
    setSelectedMonth("");
    setSelectedPeriod("all");
    setCustomStartDate("");
    setCustomEndDate("");
    setUploadError(null);
  };

  const categories: ListingCategory[] = ["内科", "胃カメラ", "大腸カメラ"];

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-12">
        <section className="relative overflow-hidden rounded-3xl border border-brand-200 bg-gradient-to-r from-white via-brand-50 to-brand-100 p-8 shadow-card">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-brand-600">Listing Analytics</p>
              <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">
                リスティング分析
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                リスティング広告（Google広告など）のパフォーマンスデータを分析し、広告効果を可視化します。
              </p>
              <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-4">
                <p className="text-sm font-semibold text-green-900 mb-2">📊 表示されているデータ</p>
                <ul className="space-y-1 text-sm text-green-800">
                  <li>• <strong>金額・CV推移</strong>: 日ごとの広告費（円）と、予約ページへの遷移数（CV）の折れ線グラフ</li>
                  <li>• <strong>CVR・CPA推移</strong>: 日ごとのコンバージョン率（%）と1件あたりの獲得単価（円）の折れ線グラフ</li>
                  <li>• <strong>時間帯別CV</strong>: 0時〜23時の各時間に発生したCV（予約ページ遷移）の件数を棒グラフで表示</li>
                  <li>• <strong>カテゴリ別</strong>: 内科・胃カメラ・大腸カメラのデータを個別に表示</li>
                  <li>• <strong>期間フィルター</strong>: 直近3ヶ月/6ヶ月/1年/全期間に加え、任意の日付範囲と月別で絞り込み可能</li>
                </ul>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex w-full flex-col gap-1 rounded-2xl border border-dashed border-brand-200 bg-white/80 px-4 py-3 text-xs text-brand-700 sm:w-[320px]">
                <span className="font-semibold text-brand-600">CSVアップロード窓口</span>
                <p className="leading-relaxed">
                  リスティング広告のCSVは「患者分析（カルテ集計）」ページのデータ管理からカテゴリごとに登録してください。
                  保存後にこのページを開くと最新データが反映されます。
                </p>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center justify-center gap-2 rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-600 transition hover:border-brand-200 hover:text-brand-600"
              >
                <RefreshCw className="h-4 w-4" />
                リセット
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

        {categoryData.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-700">期間範囲:</label>
                <select
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value as PeriodFilter)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none"
                >
                  <option value="all">全期間</option>
                  <option value="3months">直近3ヶ月</option>
                  <option value="6months">直近6ヶ月</option>
                  <option value="1year">直近1年</option>
                  <option value="custom">カスタム</option>
                </select>
              </div>
              {selectedPeriod === "custom" && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="rounded-full border border-slate-200 px-3 py-2 shadow-sm focus:border-brand-400 focus:outline-none"
                  />
                  <span className="text-slate-500">〜</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="rounded-full border border-slate-200 px-3 py-2 shadow-sm focus:border-brand-400 focus:outline-none"
                  />
                </div>
              )}
              {availableMonths.length > 0 && (
                <div className="flex items-center gap-3">
                  <label className="text-sm font-semibold text-slate-700">月別絞り込み:</label>
                  <select
                    value={selectedMonth === "" ? "all" : selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none"
                  >
                    <option value="all">全月</option>
                    {availableMonths.map((month) => (
                      <option key={month} value={month}>
                        {month}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-700">カテゴリ:</label>
                <div className="flex gap-2">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                        selectedCategory === cat
                          ? "bg-brand-500 text-white"
                          : "bg-white text-slate-600 hover:bg-brand-50"
                      } border border-slate-200`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {currentData.length > 0 ? (
              <>
                <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
                  <h2 className="mb-4 text-lg font-semibold text-slate-900">日別パフォーマンス推移</h2>
                  
                  <div className="mb-8 h-80">
                    <h3 className="mb-2 text-sm font-medium text-slate-600">金額・CV推移</h3>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dailyMetricsData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                        <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Legend />
                        <Line yAxisId="left" type="monotone" dataKey="金額" stroke="#2A9D8F" strokeWidth={2} />
                        <Line yAxisId="right" type="monotone" dataKey="CV" stroke="#FF7B7B" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="mb-8 h-80">
                    <h3 className="mb-2 text-sm font-medium text-slate-600">CVR・CPA推移</h3>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dailyMetricsData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                        <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Legend />
                        <Line yAxisId="left" type="monotone" dataKey="CVR" stroke="#5DD4C3" strokeWidth={2} />
                        <Line yAxisId="right" type="monotone" dataKey="CPA" stroke="#E65C5C" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
                  <h2 className="mb-4 text-lg font-semibold text-slate-900">時間帯別CV分布</h2>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={hourlyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="hour" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Bar dataKey="CV" fill="#3FBFAA" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              </>
            ) : (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-8 py-12 text-center">
                <p className="text-slate-500">
                  {selectedCategory}のデータがありません
                </p>
              </div>
            )}
          </>
        )}

        {categoryData.length === 0 && (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 px-8 py-12 text-center">
            <p className="text-slate-500">
              リスティング広告のCSVをアップロードしてください
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
