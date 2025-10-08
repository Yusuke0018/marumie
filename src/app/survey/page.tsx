"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Upload, RefreshCw } from "lucide-react";
import Papa from "papaparse";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

type SurveyData = {
  date: string;
  month: string;
  googleSearch: number;
  yahooSearch: number;
  googleMap: number;
  signboard: number;
  medicalReferral: number;
  friendReferral: number;
  flyer: number;
  youtube: number;
  libertyCity: number;
  aiSearch: number;
  fileType: "外来" | "内視鏡";
};



const STORAGE_KEY = "clinic-analytics/survey/v1";
const TIMESTAMP_KEY = "clinic-analytics/survey-updated/v1";

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

const parseSurveyCSV = (content: string, fileType: "外来" | "内視鏡"): SurveyData[] => {
  const parsed = Papa.parse<string[]>(content, {
    skipEmptyLines: true,
  });

  const data: SurveyData[] = [];
  
  for (let i = 2; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    if (!row || !row[0]) continue;

    const dateStr = row[0].trim();
    if (!dateStr || dateStr === "OFF") continue;

    const dateParts = dateStr.split("/");
    if (dateParts.length < 3) continue;

    const month = `${dateParts[0]}/${dateParts[1]}`;

    data.push({
      date: dateStr,
      month,
      googleSearch: Number(row[1]) || 0,
      yahooSearch: Number(row[2]) || 0,
      googleMap: Number(row[3]) || 0,
      signboard: Number(row[4]) || 0,
      medicalReferral: Number(row[5]) || 0,
      friendReferral: Number(row[6]) || 0,
      flyer: Number(row[7]) || 0,
      youtube: Number(row[8]) || 0,
      libertyCity: Number(row[9]) || 0,
      aiSearch: Number(row[10]) || 0,
      fileType,
    });
  }

  return data;
};

export default function SurveyPage() {
  const [surveyData, setSurveyData] = useState<SurveyData[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>("all");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setSurveyData(JSON.parse(stored));
      }
      const timestamp = window.localStorage.getItem(TIMESTAMP_KEY);
      if (timestamp) {
        setLastUpdated(timestamp);
      }
    } catch (error) {
      console.error(error);
    }
  }, []);

  const availableMonths = useMemo(() => {
    const months = new Set(surveyData.map(d => d.month));
    return Array.from(months).sort();
  }, [surveyData]);

  const gairaiData = useMemo(() => {
    const data = surveyData.filter(d => d.fileType === "外来");
    if (selectedMonth === "all") return data;
    return data.filter(d => d.month === selectedMonth);
  }, [surveyData, selectedMonth]);

  const naishikyoData = useMemo(() => {
    const data = surveyData.filter(d => d.fileType === "内視鏡");
    if (selectedMonth === "all") return data;
    return data.filter(d => d.month === selectedMonth);
  }, [surveyData, selectedMonth]);

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

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploadError(null);
    try {
      const allData: SurveyData[] = [...surveyData];
      
      for (const file of Array.from(files)) {
        const text = await file.text();
        
        // ファイル名から種類を判定
        const fileType = file.name.includes("内視鏡") ? "内視鏡" : "外来";
        const parsed = parseSurveyCSV(text, fileType);
        allData.push(...parsed);
      }
      
      // 重複排除（日付+種類でユニーク）
      const uniqueData = allData.reduce((acc, curr) => {
        const exists = acc.find(item => item.date === curr.date && item.fileType === curr.fileType);
        if (!exists) {
          acc.push(curr);
        }
        return acc;
      }, [] as SurveyData[]);
      
      setSurveyData(uniqueData);
      const timestamp = new Date().toISOString();
      setLastUpdated(timestamp);

      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(uniqueData));
        window.localStorage.setItem(TIMESTAMP_KEY, timestamp);
      }
    } catch (error) {
      console.error(error);
      setUploadError("CSVの解析に失敗しました。");
    } finally {
      event.target.value = "";
    }
  };

  const handleReset = () => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(TIMESTAMP_KEY);
    setSurveyData([]);
    setLastUpdated(null);
    setSelectedMonth("all");
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
                <p className="text-sm font-semibold text-purple-900 mb-2">📊 データの見方</p>
                <ul className="space-y-1 text-sm text-purple-800">
                  <li>• <strong>円グラフと割合</strong>: 患者さんがどの経路で当院を知ったかの分布です。多いチャネルが効果的な集客手段です</li>
                  <li>• <strong>外来と内視鏡の違い</strong>: 患者層によって情報収集の方法が異なることがわかります</li>
                  <li>• <strong>Google検索 vs マップ</strong>: 検索とマップの比率から、地域密着度や認知度が見えてきます</li>
                  <li>• <strong>紹介の割合</strong>: 医療機関・家族友人からの紹介が多いほど、信頼されている証です</li>
                </ul>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-full bg-brand-400 px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-500">
                <Upload className="h-4 w-4" />
                CSVを追加
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileUpload}
                  multiple
                  className="hidden"
                />
              </label>
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
            <div className="flex items-center gap-4">
              <label className="text-sm font-semibold text-slate-700">期間:</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none"
              >
                <option value="all">全期間</option>
                {availableMonths.map(month => (
                  <option key={month} value={month}>{month}</option>
                ))}
              </select>
            </div>

            {gairaiChartData.length > 0 && (
              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-slate-900">外来 - 来院経路の内訳</h2>
                  <p className="mt-1 text-sm text-slate-500">
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
              </section>
            )}

            {naishikyoChartData.length > 0 && (
              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-slate-900">内視鏡 - 来院経路の内訳</h2>
                  <p className="mt-1 text-sm text-slate-500">
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
