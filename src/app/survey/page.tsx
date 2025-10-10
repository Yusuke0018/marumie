"use client";

import { useEffect, useMemo, useState, lazy, Suspense } from "react";

import { RefreshCw } from "lucide-react";
import {
  type SurveyData,
  loadSurveyDataFromStorage,
  loadSurveyTimestamp,
  clearSurveyStorage,
  SURVEY_STORAGE_KEY,
  SURVEY_TIMESTAMP_KEY,
} from "@/lib/surveyData";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

const MonthlyTrendChart = lazy(() =>
  import("@/components/survey/MonthlyTrendChart").then((m) => ({
    default: m.MonthlyTrendChart,
  })),
);

const ComparisonChart = lazy(() =>
  import("@/components/survey/ComparisonChart").then((m) => ({
    default: m.ComparisonChart,
  })),
);

const COLORS = [
  "#2A9D8F", "#FF7B7B", "#5DD4C3", "#E65C5C", "#75DBC3",
  "#FFB8C8", "#3FBFAA", "#FF9999", "#A3E7D7", "#FFC3CF"
];

const CHANNEL_LABELS: Record<string, string> = {
  googleSearch: "Google検索",
  yahooSearch: "Yahoo検索",
  googleMap: "Googleマップ",
  signboard: "看板・外観",
  medicalReferral: "医療機関紹介",
  friendReferral: "家族・友人紹介",
  flyer: "チラシ",
  youtube: "YouTube",
  libertyCity: "リベシティ",
  aiSearch: "AI検索",
};

const formatMonthLabel = (month: string): string => {
  const [year, monthNum] = month.split("-");
  return `${year}年${monthNum}月`;
};

export default function SurveyPage() {
  const [surveyData, setSurveyData] = useState<SurveyData[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [startMonth, setStartMonth] = useState<string>("");
  const [endMonth, setEndMonth] = useState<string>("");
  const [showGairaiChart, setShowGairaiChart] = useState(false);
  const [showNaishikyoChart, setShowNaishikyoChart] = useState(false);
  const [showGairaiComparison, setShowGairaiComparison] = useState(false);
  const [showNaishikyoComparison, setShowNaishikyoComparison] = useState(false);
  const [comparisonType, setComparisonType] = useState<"count" | "percentage">("count");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setSurveyData(loadSurveyDataFromStorage());
      setLastUpdated(loadSurveyTimestamp());
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
      if (event.key === SURVEY_STORAGE_KEY || event.key === SURVEY_TIMESTAMP_KEY) {
        setSurveyData(loadSurveyDataFromStorage());
        setLastUpdated(loadSurveyTimestamp());
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const availableMonths = useMemo(() => {
    const months = new Set(surveyData.map(d => d.month));
    return Array.from(months).sort();
  }, [surveyData]);

  useEffect(() => {
    if (availableMonths.length === 0) {
      return;
    }

    const latestMonth = availableMonths[availableMonths.length - 1];
    
    if (!startMonth && !endMonth) {
      setStartMonth(latestMonth);
      setEndMonth(latestMonth);
    }
  }, [availableMonths, startMonth, endMonth]);

  const gairaiData = useMemo(() => {
    let data = surveyData.filter(d => d.fileType === "外来");
    
    if (startMonth && endMonth) {
      data = data.filter(d => d.month >= startMonth && d.month <= endMonth);
    } else if (startMonth) {
      data = data.filter(d => d.month >= startMonth);
    } else if (endMonth) {
      data = data.filter(d => d.month <= endMonth);
    }
    
    return data;
  }, [surveyData, startMonth, endMonth]);

  const naishikyoData = useMemo(() => {
    let data = surveyData.filter(d => d.fileType === "内視鏡");
    
    if (startMonth && endMonth) {
      data = data.filter(d => d.month >= startMonth && d.month <= endMonth);
    } else if (startMonth) {
      data = data.filter(d => d.month >= startMonth);
    } else if (endMonth) {
      data = data.filter(d => d.month <= endMonth);
    }
    
    return data;
  }, [surveyData, startMonth, endMonth]);

  const gairaiChartData = useMemo(() => {
    const totals: Record<string, number> = {
      googleSearch: 0,
      yahooSearch: 0,
      googleMap: 0,
      signboard: 0,
      medicalReferral: 0,
      friendReferral: 0,
      flyer: 0,
      youtube: 0,
      libertyCity: 0,
      aiSearch: 0,
    };

    for (const item of gairaiData) {
      Object.keys(totals).forEach(key => {
        totals[key] += item[key as keyof SurveyData] as number;
      });
    }

    return Object.entries(totals)
      .filter(([, value]) => value > 0)
      .map(([key, value]) => ({
        name: CHANNEL_LABELS[key] || key,
        value,
      }))
      .sort((a, b) => b.value - a.value);
  }, [gairaiData]);

  const naishikyoChartData = useMemo(() => {
    const totals: Record<string, number> = {
      googleSearch: 0,
      yahooSearch: 0,
      googleMap: 0,
      signboard: 0,
      medicalReferral: 0,
      friendReferral: 0,
      flyer: 0,
      youtube: 0,
      libertyCity: 0,
      aiSearch: 0,
    };

    for (const item of naishikyoData) {
      Object.keys(totals).forEach(key => {
        totals[key] += item[key as keyof SurveyData] as number;
      });
    }

    return Object.entries(totals)
      .filter(([, value]) => value > 0)
      .map(([key, value]) => ({
        name: CHANNEL_LABELS[key] || key,
        value,
      }))
      .sort((a, b) => b.value - a.value);
  }, [naishikyoData]);

  const handleReset = () => {
    clearSurveyStorage();
    setSurveyData([]);
    setLastUpdated(null);
    setStartMonth("");
    setEndMonth("");
    setUploadError(null);
  };



  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
        <section className="relative overflow-hidden rounded-3xl border border-brand-200 bg-gradient-to-r from-white via-brand-50 to-brand-100 p-8 shadow-card">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-brand-600">Survey Analytics</p>
              <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">
                アンケート分析
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                来院経路のアンケートデータを分析し、どのチャネルから患者さんが来院しているかを可視化します。
              </p>
              <div className="mt-4 rounded-2xl border border-purple-200 bg-purple-50 p-4">
                <p className="text-sm font-semibold text-purple-900 mb-2">📊 表示されているデータ</p>
                <ul className="space-y-1 text-sm text-purple-800">
                  <li>• <strong>円グラフ</strong>: Google検索、Googleマップ、看板、紹介など、各チャネルごとの回答数の割合</li>
                  <li>• <strong>外来・内視鏡</strong>: それぞれ別々のグラフで、来院経路の分布を表示</li>
                  <li>• <strong>件数と割合</strong>: 右側の表に各チャネルの回答数（件）と全体に占める割合（%）を表示</li>
                  <li>• <strong>詳細テーブル</strong>: ページ下部に全チャネルの回答数と割合を一覧表で表示</li>
                  <li>• <strong>期間フィルター</strong>: 直近3ヶ月/6ヶ月/1年/全期間に加え、任意の日付範囲と月別で絞り込み可能</li>
                </ul>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex w-full flex-col gap-1 rounded-2xl border border-dashed border-brand-200 bg-white/80 px-4 py-3 text-xs text-brand-700 sm:w-[280px]">
                <span className="font-semibold text-brand-600">CSVアップロード窓口</span>
                <p className="leading-relaxed">
                  アンケートCSVは「患者分析（カルテ集計）」ページのデータ管理セクションから登録してください。
                  保存後にこのページを開くと自動で集計が更新されます。
                </p>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center justify-center gap-2 rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-600 transition hover:border-brand-200 hover:text-brand-600"
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

        {surveyData.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-semibold text-slate-700">開始月:</label>
                <select
                  value={startMonth}
                  onChange={(e) => setStartMonth(e.target.value)}
                  disabled={availableMonths.length === 0}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">選択してください</option>
                  {availableMonths.map((month) => (
                    <option key={month} value={month}>
                      {formatMonthLabel(month)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-semibold text-slate-700">終了月:</label>
                <select
                  value={endMonth}
                  onChange={(e) => setEndMonth(e.target.value)}
                  disabled={availableMonths.length === 0}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">選択してください</option>
                  {availableMonths.map((month) => (
                    <option key={month} value={month}>
                      {formatMonthLabel(month)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {gairaiChartData.length > 0 && (
              <section className="rounded-3xl border-2 border-blue-300 bg-gradient-to-br from-blue-50 to-white p-8 shadow-lg">
                <div className="mb-6 rounded-2xl bg-gradient-to-r from-blue-500 to-blue-600 px-6 py-4 shadow-md">
                  <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                    <span className="text-3xl">🏥</span>
                    外来 - 来院経路の内訳
                  </h2>
                  <p className="mt-2 text-lg text-blue-50 font-semibold">
                    📅 対象期間: {startMonth && endMonth ? (startMonth === endMonth ? formatMonthLabel(startMonth) : `${formatMonthLabel(startMonth)} 〜 ${formatMonthLabel(endMonth)}`) : "全期間"}
                  </p>
                  <p className="mt-1 text-lg text-blue-50 font-semibold">
                    総回答数: {gairaiChartData.reduce((sum, item) => sum + item.value, 0).toLocaleString("ja-JP")}件
                  </p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* 円グラフ */}
                  <div className="h-[600px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={gairaiChartData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={false}
                          outerRadius={180}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {gairaiChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          formatter={(value: number) => [value.toLocaleString("ja-JP"), "回答数"]}
                          contentStyle={{ fontSize: 14, padding: '8px 12px' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {/* 凡例テーブル */}
                  <div className="flex flex-col justify-center">
                    <div className="space-y-2">
                      {gairaiChartData.map((entry, index) => {
                        const total = gairaiChartData.reduce((sum, item) => sum + item.value, 0);
                        const percentage = ((entry.value / total) * 100).toFixed(1);
                        return (
                          <div 
                            key={entry.name} 
                            className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 hover:bg-slate-100 transition"
                          >
                            <div className="flex items-center gap-3">
                              <div 
                                className="h-5 w-5 rounded-sm shrink-0" 
                                style={{ backgroundColor: COLORS[index % COLORS.length] }}
                              />
                              <span className="font-medium text-slate-900 text-sm">{entry.name}</span>
                            </div>
                            <div className="flex items-baseline gap-2">
                              <span className="text-lg font-bold text-slate-900">
                                {entry.value.toLocaleString("ja-JP")}
                              </span>
                              <span className="text-sm text-slate-500">件</span>
                              <span className="ml-2 text-sm font-semibold text-brand-600">
                                ({percentage}%)
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {gairaiData.length > 0 && (
                  <>
                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => setShowGairaiChart(!showGairaiChart)}
                        className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {showGairaiChart ? "月次推移グラフを非表示" : "月次推移グラフを表示"}
                      </button>
                      <button
                        onClick={() => setShowGairaiComparison(!showGairaiComparison)}
                        className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {showGairaiComparison ? "前月比較グラフを非表示" : "前月比較グラフを表示"}
                      </button>
                    </div>
                    {showGairaiChart && (
                      <Suspense
                        fallback={
                          <div className="mt-4 h-[400px] flex items-center justify-center text-slate-500">
                            読み込み中...
                          </div>
                        }
                      >
                        <div className="mt-4">
                          <MonthlyTrendChart data={gairaiData} title="外来 - 来院経路の月次推移" />
                        </div>
                      </Suspense>
                    )}
                    {showGairaiComparison && (
                      <Suspense
                        fallback={
                          <div className="mt-4 h-[400px] flex items-center justify-center text-slate-500">
                            読み込み中...
                          </div>
                        }
                      >
                        <div className="mt-4 space-y-4">
                          <div className="flex gap-2">
                            <button
                              onClick={() => setComparisonType("count")}
                              className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                                comparisonType === "count"
                                  ? "border-blue-500 bg-blue-50 text-blue-700"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              数の変化
                            </button>
                            <button
                              onClick={() => setComparisonType("percentage")}
                              className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                                comparisonType === "percentage"
                                  ? "border-blue-500 bg-blue-50 text-blue-700"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              %の変化
                            </button>
                          </div>
                          <ComparisonChart
                            data={gairaiData}
                            title="外来 - 来院経路の前月比較"
                            comparisonType={comparisonType}
                          />
                        </div>
                      </Suspense>
                    )}
                  </>
                )}
              </section>
            )}

            {naishikyoChartData.length > 0 && (
              <section className="rounded-3xl border-2 border-purple-300 bg-gradient-to-br from-purple-50 to-white p-8 shadow-lg">
                <div className="mb-6 rounded-2xl bg-gradient-to-r from-purple-500 to-purple-600 px-6 py-4 shadow-md">
                  <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                    <span className="text-3xl">🔬</span>
                    内視鏡 - 来院経路の内訳
                  </h2>
                  <p className="mt-2 text-lg text-purple-50 font-semibold">
                    📅 対象期間: {startMonth && endMonth ? (startMonth === endMonth ? formatMonthLabel(startMonth) : `${formatMonthLabel(startMonth)} 〜 ${formatMonthLabel(endMonth)}`) : "全期間"}
                  </p>
                  <p className="mt-1 text-lg text-purple-50 font-semibold">
                    総回答数: {naishikyoChartData.reduce((sum, item) => sum + item.value, 0).toLocaleString("ja-JP")}件
                  </p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* 円グラフ */}
                  <div className="h-[600px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={naishikyoChartData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={false}
                          outerRadius={180}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {naishikyoChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          formatter={(value: number) => [value.toLocaleString("ja-JP"), "回答数"]}
                          contentStyle={{ fontSize: 14, padding: '8px 12px' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {/* 凡例テーブル */}
                  <div className="flex flex-col justify-center">
                    <div className="space-y-2">
                      {naishikyoChartData.map((entry, index) => {
                        const total = naishikyoChartData.reduce((sum, item) => sum + item.value, 0);
                        const percentage = ((entry.value / total) * 100).toFixed(1);
                        return (
                          <div 
                            key={entry.name} 
                            className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 hover:bg-slate-100 transition"
                          >
                            <div className="flex items-center gap-3">
                              <div 
                                className="h-5 w-5 rounded-sm shrink-0" 
                                style={{ backgroundColor: COLORS[index % COLORS.length] }}
                              />
                              <span className="font-medium text-slate-900 text-sm">{entry.name}</span>
                            </div>
                            <div className="flex items-baseline gap-2">
                              <span className="text-lg font-bold text-slate-900">
                                {entry.value.toLocaleString("ja-JP")}
                              </span>
                              <span className="text-sm text-slate-500">件</span>
                              <span className="ml-2 text-sm font-semibold text-brand-600">
                                ({percentage}%)
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {naishikyoData.length > 0 && (
                  <>
                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => setShowNaishikyoChart(!showNaishikyoChart)}
                        className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {showNaishikyoChart ? "月次推移グラフを非表示" : "月次推移グラフを表示"}
                      </button>
                      <button
                        onClick={() => setShowNaishikyoComparison(!showNaishikyoComparison)}
                        className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {showNaishikyoComparison ? "前月比較グラフを非表示" : "前月比較グラフを表示"}
                      </button>
                    </div>
                    {showNaishikyoChart && (
                      <Suspense
                        fallback={
                          <div className="mt-4 h-[400px] flex items-center justify-center text-slate-500">
                            読み込み中...
                          </div>
                        }
                      >
                        <div className="mt-4">
                          <MonthlyTrendChart data={naishikyoData} title="内視鏡 - 来院経路の月次推移" />
                        </div>
                      </Suspense>
                    )}
                    {showNaishikyoComparison && (
                      <Suspense
                        fallback={
                          <div className="mt-4 h-[400px] flex items-center justify-center text-slate-500">
                            読み込み中...
                          </div>
                        }
                      >
                        <div className="mt-4 space-y-4">
                          <div className="flex gap-2">
                            <button
                              onClick={() => setComparisonType("count")}
                              className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                                comparisonType === "count"
                                  ? "border-purple-500 bg-purple-50 text-purple-700"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              数の変化
                            </button>
                            <button
                              onClick={() => setComparisonType("percentage")}
                              className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                                comparisonType === "percentage"
                                  ? "border-purple-500 bg-purple-50 text-purple-700"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              %の変化
                            </button>
                          </div>
                          <ComparisonChart
                            data={naishikyoData}
                            title="内視鏡 - 来院経路の前月比較"
                            comparisonType={comparisonType}
                          />
                        </div>
                      </Suspense>
                    )}
                  </>
                )}
              </section>
            )}

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
              <h2 className="mb-4 text-lg font-semibold text-slate-900">詳細データ</h2>
              
              {gairaiChartData.length > 0 && (
                <div className="mb-6">
                  <h3 className="mb-3 text-sm font-semibold text-brand-600">外来</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-2">チャネル</th>
                          <th className="px-3 py-2">回答数</th>
                          <th className="px-3 py-2">割合</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {gairaiChartData.map((item) => {
                          const total = gairaiChartData.reduce((sum, i) => sum + i.value, 0);
                          return (
                            <tr key={item.name} className="hover:bg-slate-50">
                              <td className="px-3 py-2 font-medium text-slate-900">{item.name}</td>
                              <td className="px-3 py-2">{item.value.toLocaleString("ja-JP")}</td>
                              <td className="px-3 py-2">
                                {((item.value / total) * 100).toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {naishikyoChartData.length > 0 && (
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-brand-600">内視鏡</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-2">チャネル</th>
                          <th className="px-3 py-2">回答数</th>
                          <th className="px-3 py-2">割合</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {naishikyoChartData.map((item) => {
                          const total = naishikyoChartData.reduce((sum, i) => sum + i.value, 0);
                          return (
                            <tr key={item.name} className="hover:bg-slate-50">
                              <td className="px-3 py-2 font-medium text-slate-900">{item.name}</td>
                              <td className="px-3 py-2">{item.value.toLocaleString("ja-JP")}</td>
                              <td className="px-3 py-2">
                                {((item.value / total) * 100).toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {surveyData.length === 0 && (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 px-8 py-12 text-center">
            <p className="text-slate-500">
              アンケートCSVをアップロードしてください
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
