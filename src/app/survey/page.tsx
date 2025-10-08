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
  type PieLabelRenderProps,
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

const parseSurveyCSV = (content: string): SurveyData[] => {
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

  const filteredData = useMemo(() => {
    if (selectedMonth === "all") return surveyData;
    return surveyData.filter(d => d.month === selectedMonth);
  }, [surveyData, selectedMonth]);

  const chartData = useMemo(() => {
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

    for (const item of filteredData) {
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
  }, [filteredData]);

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    try {
      const text = await file.text();
      const parsed = parseSurveyCSV(text);
      
      setSurveyData(parsed);
      const timestamp = new Date().toISOString();
      setLastUpdated(timestamp);

      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
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

  const totalResponses = chartData.reduce((sum, item) => sum + item.value, 0);

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
                来院経路のアンケートデータを分析し、集客チャネルの効果を可視化します。
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-full bg-brand-400 px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-500">
                <Upload className="h-4 w-4" />
                CSVを選択
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileUpload}
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

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-900">来院経路の内訳</h2>
                <p className="mt-1 text-sm text-slate-500">
                  総回答数: {totalResponses.toLocaleString("ja-JP")}件
                </p>
              </div>
              <div className="h-[500px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="35%"
                      cy="50%"
                      labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }}
                      label={(props: PieLabelRenderProps) => {
                        const RADIAN = Math.PI / 180;
                        const radius = (props.outerRadius as number) + 30;
                        const x = (props.cx as number) + radius * Math.cos(-(props.midAngle as number) * RADIAN);
                        const y = (props.cy as number) + radius * Math.sin(-(props.midAngle as number) * RADIAN);
                        
                        return (
                          <text
                            x={x}
                            y={y}
                            fill="#334155"
                            textAnchor={x > (props.cx as number) ? 'start' : 'end'}
                            dominantBaseline="central"
                            fontSize={13}
                            fontWeight={500}
                          >
                            {`${props.name}: ${props.value}件`}
                          </text>
                        );
                      }}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => [value.toLocaleString("ja-JP"), "回答数"]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
              <h2 className="mb-4 text-lg font-semibold text-slate-900">詳細データ</h2>
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
                    {chartData.map((item) => (
                      <tr key={item.name} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-900">{item.name}</td>
                        <td className="px-3 py-2">{item.value.toLocaleString("ja-JP")}</td>
                        <td className="px-3 py-2">
                          {((item.value / totalResponses) * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
