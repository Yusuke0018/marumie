"use client";

import { useState, useMemo, useEffect } from "react";
import Papa from "papaparse";
import { DayPicker } from "react-day-picker";
import { ja } from "date-fns/locale";
import "react-day-picker/dist/style.css";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { KarteRecord } from "@/lib/karteAnalytics";
import { getCompressedItem } from "@/lib/storageCompression";
import { KARTE_STORAGE_KEY } from "@/lib/storageKeys";

type DateRange = {
  id: string;
  label: string;
  dates: string[]; // ISO date strings
  color: string;
};

type ComparisonMetrics = {
  // 患者数系
  totalPatients: number;
  pureFirstVisits: number;
  returningFirstVisits: number;
  revisitCount: number;

  // 診療科別
  generalDepartment: number;
  feverDepartment: number;
  endoscopyDepartment: number;

  // 年齢系
  averageAge: number | null;
  ageDistribution: Record<string, number>;

  // 経済系
  averagePoints: number;
  averagePayment: number;
  totalPoints: number;
  totalPayment: number;

  // 曜日別
  weekdayDistribution: Record<string, number>;

  // その他
  uniqueAddresses: number;
  insuranceDistribution: Record<string, number>;
};

const PRESET_COLORS = [
  "#99d6d0", // パステルティール
  "#ffb3c1", // パステルピンク
  "#b3c5ff", // パステルブルー
  "#ffe599", // パステルイエロー
  "#c1f0c1", // パステルグリーン
  "#e6b3ff", // パステルパープル
];

export default function ABTestPage() {
  const [dateRanges, setDateRanges] = useState<DateRange[]>([
    {
      id: "period-a",
      label: "期間A",
      dates: [],
      color: PRESET_COLORS[0],
    },
  ]);

  const [karteData, setKarteData] = useState<KarteRecord[]>([]);
  const [activeRangeId, setActiveRangeId] = useState<string>("period-a");
  const [isLoading, setIsLoading] = useState(false);

  const formatDateToIso = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const parseIsoDateToLocal = (value: string): Date | null => {
    if (!value) return null;
    const [year, month, day] = value.split("-").map((part) => Number(part));
    if ([year, month, day].some((part) => Number.isNaN(part))) {
      return null;
    }
    return new Date(year, month - 1, day);
  };

  // localStorageからカルテデータを読み込み
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const stored = getCompressedItem(KARTE_STORAGE_KEY);
      if (stored) {
        const parsed: KarteRecord[] = JSON.parse(stored);
        setKarteData(parsed);
      }
    } catch (error) {
      console.error("カルテデータの読み込みエラー:", error);
    }
  }, []);

  // CSV解析関数
  const parseKarteCsv = (text: string): KarteRecord[] => {
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors.length > 0) {
      throw new Error(parsed.errors[0]?.message ?? "CSV parsing error");
    }

    const records: KarteRecord[] = [];

    for (const row of parsed.data) {
      const dateRaw = row["日付"];
      if (!dateRaw) continue;

      const dateIso = dateRaw
        .trim()
        .replace(/\//g, "-")
        .replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (_, y, m, d) => {
          const mm = m.padStart(2, "0");
          const dd = d.padStart(2, "0");
          return `${y}-${mm}-${dd}`;
        });

      const monthKey = dateIso.substring(0, 7);

      const visitTypeRaw = row["初診・再診"] || "";
      let visitType: "初診" | "再診" | "不明" = "不明";
      if (visitTypeRaw.includes("初診")) visitType = "初診";
      else if (visitTypeRaw.includes("再診")) visitType = "再診";

      const patientNumberRaw = row["患者番号"];
      const patientNumber = patientNumberRaw ? Number(patientNumberRaw.trim()) : null;

      const birthDateRaw = row["患者生年月日"];
      const birthDateIso = birthDateRaw
        ? birthDateRaw
            .trim()
            .replace(/\//g, "-")
            .replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (_, y, m, d) => {
              const mm = m.padStart(2, "0");
              const dd = d.padStart(2, "0");
              return `${y}-${mm}-${dd}`;
            })
        : null;

      const pointsRaw = row["点数"];
      const points = pointsRaw ? Number(pointsRaw.trim().replace(/,/g, "")) : null;

      records.push({
        dateIso,
        monthKey,
        visitType,
        patientNumber: Number.isFinite(patientNumber) ? patientNumber : null,
        birthDateIso,
        department: row["診療科"] || null,
        points: Number.isFinite(points) ? points : null,
        patientNameNormalized: row["患者氏名"] || null,
        patientAddress: row["患者住所"] || null,
      });
    }

    return records;
  };

  // CSVファイル読み込みハンドラ
  const handleKarteUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const records = parseKarteCsv(text);
        setKarteData(records);
        alert(`${records.length}件のデータを読み込みました`);
      } catch (error) {
        console.error("CSV解析エラー:", error);
        alert("CSVの読み込みに失敗しました");
      } finally {
        setIsLoading(false);
      }
    };

    reader.readAsText(file, "UTF-8");
  };

  // 期間追加
  const addPeriod = () => {
    const newId = `period-${String.fromCharCode(65 + dateRanges.length)}`;
    const newLabel = `期間${String.fromCharCode(65 + dateRanges.length)}`;
    setDateRanges([
      ...dateRanges,
      {
        id: newId,
        label: newLabel,
        dates: [],
        color: PRESET_COLORS[dateRanges.length % PRESET_COLORS.length],
      },
    ]);
    setActiveRangeId(newId);
  };

  // 期間削除
  const removePeriod = (id: string) => {
    if (dateRanges.length <= 1) return;
    setDateRanges(dateRanges.filter((r) => r.id !== id));
    if (activeRangeId === id) {
      setActiveRangeId(dateRanges[0].id);
    }
  };

  // 日付範囲設定（開始日〜終了日）
  const setDateRangeFromTo = (id: string, startDate: string, endDate: string) => {
    const start = parseIsoDateToLocal(startDate);
    const end = parseIsoDateToLocal(endDate);
    if (!start || !end || start > end) {
      return;
    }

    const dates: string[] = [];

    const current = new Date(start);
    let dayCount = 0;
    while (current <= end && dayCount < 30) {
      dates.push(formatDateToIso(current));
      current.setDate(current.getDate() + 1);
      dayCount++;
    }

    setDateRanges(
      dateRanges.map((r) =>
        r.id === id ? { ...r, dates } : r
      )
    );
  };

  // カレンダーで複数日を選択
  const setSelectedDates = (id: string, dates: Date[] | undefined) => {
    if (!dates) {
      setDateRanges(dateRanges.map((r) => (r.id === id ? { ...r, dates: [] } : r)));
      return;
    }

    if (dates.length > 30) {
      alert("最大30日まで選択できます");
      return;
    }

    const dateIsos = dates.map((d) => formatDateToIso(d)).sort();
    setDateRanges(dateRanges.map((r) => (r.id === id ? { ...r, dates: dateIsos } : r)));
  };

  // 個別日付の削除
  const removeDate = (id: string, dateIso: string) => {
    setDateRanges(
      dateRanges.map((r) => {
        if (r.id !== id) return r;
        return { ...r, dates: r.dates.filter((d) => d !== dateIso) };
      })
    );
  };

  // 集計関数
  const calculateMetrics = (dates: string[]): ComparisonMetrics => {
    const filteredRecords = karteData.filter((record) =>
      dates.includes(record.dateIso)
    );

    // 年齢計算
    const ages: number[] = [];
    const ageDistribution: Record<string, number> = {
      "10代以下": 0,
      "20代": 0,
      "30代": 0,
      "40代": 0,
      "50代": 0,
      "60代": 0,
      "70代": 0,
      "80代以上": 0,
    };

    filteredRecords.forEach((record) => {
      if (record.birthDateIso) {
        const birthDate = new Date(record.birthDateIso);
        const visitDate = new Date(record.dateIso);
        let age = visitDate.getFullYear() - birthDate.getFullYear();
        const monthDiff = visitDate.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && visitDate.getDate() < birthDate.getDate())) {
          age--;
        }
        if (age >= 0 && age < 120) {
          ages.push(age);
          if (age < 20) ageDistribution["10代以下"]++;
          else if (age < 30) ageDistribution["20代"]++;
          else if (age < 40) ageDistribution["30代"]++;
          else if (age < 50) ageDistribution["40代"]++;
          else if (age < 60) ageDistribution["50代"]++;
          else if (age < 70) ageDistribution["60代"]++;
          else if (age < 80) ageDistribution["70代"]++;
          else ageDistribution["80代以上"]++;
        }
      }
    });

    const averageAge = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : null;

    // 診療科別
    const normalizeDepartment = (dept: string) => dept.trim().replace(/[\s・●()（）【】\[\]\-]/g, "");
    const generalDepartment = filteredRecords.filter((r) => {
      const normalized = normalizeDepartment(r.department || "");
      return normalized.includes("内科外来") || normalized.includes("外科外来") || normalized.includes("総合診療");
    }).length;

    const feverDepartment = filteredRecords.filter((r) => {
      const normalized = normalizeDepartment(r.department || "");
      return normalized.includes("発熱") || normalized.includes("風邪");
    }).length;

    const endoscopyDepartment = filteredRecords.filter((r) => {
      const normalized = normalizeDepartment(r.department || "");
      return normalized.includes("内視鏡") || normalized.includes("人間ドック");
    }).length;

    // 曜日分布
    const weekdayDistribution: Record<string, number> = {
      月: 0,
      火: 0,
      水: 0,
      木: 0,
      金: 0,
      土: 0,
      日: 0,
    };

    filteredRecords.forEach((record) => {
      const date = new Date(record.dateIso);
      const weekday = date.getUTCDay();
      const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];
      weekdayDistribution[weekdayLabels[weekday]]++;
    });

    // 保険種別分布
    const insuranceDistribution: Record<string, number> = {};
    filteredRecords.forEach(() => {
      // 保険種別は仮でdepartmentから抽出（実際のデータ構造に応じて調整）
      const insurance = "不明"; // TODO: 実際のカラムから取得
      insuranceDistribution[insurance] = (insuranceDistribution[insurance] || 0) + 1;
    });

    // 住所のユニーク数
    const uniqueAddresses = new Set(
      filteredRecords.map((r) => r.patientAddress).filter((addr) => addr)
    ).size;

    // 経済系
    const points = filteredRecords.map((r) => r.points || 0);
    const totalPoints = points.reduce((a, b) => a + b, 0);
    const averagePoints = points.length > 0 ? totalPoints / points.length : 0;

    // 患者負担金は仮で点数の30%とする（実際のデータがあれば変更）
    const totalPayment = totalPoints * 0.3;
    const averagePayment = averagePoints * 0.3;

    return {
      totalPatients: filteredRecords.length,
      pureFirstVisits: filteredRecords.filter((r) => r.visitType === "初診").length,
      returningFirstVisits: 0, // TODO: カテゴリ化ロジック追加
      revisitCount: filteredRecords.filter((r) => r.visitType === "再診").length,
      generalDepartment,
      feverDepartment,
      endoscopyDepartment,
      averageAge,
      ageDistribution,
      averagePoints,
      averagePayment,
      totalPoints,
      totalPayment,
      weekdayDistribution,
      uniqueAddresses,
      insuranceDistribution,
    };
  };

  // 集計関数をuseCallbackでメモ化
  const calculateMetricsCallback = useMemo(() => calculateMetrics, [karteData]);

  // 各期間の集計結果
  const metricsMap = useMemo(() => {
    const map: Record<string, ComparisonMetrics> = {};
    dateRanges.forEach((range) => {
      map[range.id] = calculateMetricsCallback(range.dates);
    });
    return map;
  }, [dateRanges, calculateMetricsCallback]);

  // 差分・増減率計算
  const calculateDiff = (baseValue: number, compareValue: number) => {
    const diff = compareValue - baseValue;
    const rate = baseValue !== 0 ? ((diff / baseValue) * 100).toFixed(1) : "N/A";
    return { diff, rate };
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="mx-auto max-w-7xl">
        <h1 className="mb-8 text-4xl font-bold text-slate-800">ABテスト分析</h1>

        {/* 期間設定セクション */}
        <div className="mb-8 rounded-2xl bg-white p-6 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-slate-700">期間設定</h2>
            <button
              onClick={addPeriod}
              disabled={dateRanges.length >= 6}
              className="rounded-lg bg-teal-600 px-4 py-2 font-semibold text-white transition hover:bg-teal-700 disabled:bg-slate-300"
            >
              + 期間追加
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {dateRanges.map((range) => (
              <div
                key={range.id}
                className={`rounded-xl border-2 p-4 transition ${
                  activeRangeId === range.id
                    ? "border-teal-500 bg-teal-50"
                    : "border-slate-200 bg-white"
                }`}
                onClick={() => setActiveRangeId(range.id)}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-4 w-4 rounded-full"
                      style={{ backgroundColor: range.color }}
                    />
                    <input
                      type="text"
                      value={range.label}
                      onChange={(e) =>
                        setDateRanges(
                          dateRanges.map((r) =>
                            r.id === range.id ? { ...r, label: e.target.value } : r
                          )
                        )
                      }
                      className="font-semibold text-slate-700 bg-transparent border-none outline-none"
                    />
                  </div>
                  {dateRanges.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removePeriod(range.id);
                      }}
                      className="text-red-500 hover:text-red-700"
                    >
                      ×
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 mb-2 block">
                      カレンダーから日付を選択（最大30日）
                    </label>
                    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                      <DayPicker
                        mode="multiple"
                        selected={range.dates
                          .map((d) => parseIsoDateToLocal(d))
                          .filter((value): value is Date => value !== null)}
                        onSelect={(dates) => setSelectedDates(range.id, dates)}
                        locale={ja}
                        max={30}
                        modifiersStyles={{
                          selected: {
                            backgroundColor: range.color,
                            color: "white",
                            fontWeight: "bold",
                          },
                        }}
                        styles={{
                          caption: { color: "#334155", fontWeight: "600" },
                          head_cell: { color: "#64748b", fontWeight: "600" },
                          day: { fontSize: "0.875rem" },
                        }}
                      />
                    </div>
                  </div>

                  <details>
                    <summary className="text-xs font-semibold text-slate-700 cursor-pointer hover:text-slate-900">
                      期間範囲で一括選択
                    </summary>
                    <div className="mt-2 p-3 bg-slate-50 rounded-lg">
                      <div className="flex gap-2">
                        <input
                          type="date"
                          className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                          placeholder="開始日"
                          onChange={(e) => {
                            const endDate = range.dates[range.dates.length - 1] || e.target.value;
                            setDateRangeFromTo(range.id, e.target.value, endDate);
                          }}
                        />
                        <span className="text-slate-400">〜</span>
                        <input
                          type="date"
                          className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                          placeholder="終了日"
                          onChange={(e) => {
                            const startDate = range.dates[0] || e.target.value;
                            setDateRangeFromTo(range.id, startDate, e.target.value);
                          }}
                        />
                      </div>
                    </div>
                  </details>

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200">
                    <span className="font-semibold text-slate-700">
                      {range.dates.length}日間選択中
                    </span>
                    {range.dates.length > 0 && (
                      <button
                        onClick={() => setDateRanges(dateRanges.map((r) => r.id === range.id ? { ...r, dates: [] } : r))}
                        className="text-red-500 hover:text-red-700 font-semibold"
                      >
                        すべてクリア
                      </button>
                    )}
                  </div>

                  {range.dates.length > 0 && (
                    <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 text-xs space-y-1 bg-white">
                      <div className="font-semibold text-slate-600 mb-1 px-2">選択中の日付:</div>
                      {range.dates.map((date) => (
                        <div key={date} className="flex items-center justify-between bg-slate-50 px-2 py-1.5 rounded hover:bg-slate-100 transition">
                          <span className="font-medium">{date}</span>
                          <button
                            onClick={() => removeDate(range.id, date)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded px-2 py-0.5 transition"
                          >
                            削除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* データ読み込みセクション */}
        <div className="mb-8 rounded-2xl bg-white p-6 shadow-lg">
          <h2 className="mb-4 text-2xl font-semibold text-slate-700">データ読み込み</h2>

          {karteData.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-green-50 border-2 border-green-200 rounded-xl">
                <div className="flex-shrink-0 w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-xl">✓</span>
                </div>
                <div>
                  <p className="font-semibold text-green-900">
                    データ管理ページのカルテデータを使用中
                  </p>
                  <p className="text-sm text-green-700">
                    {karteData.length.toLocaleString()}件のレコードが読み込まれています
                  </p>
                </div>
              </div>
              <details className="text-sm text-slate-600">
                <summary className="cursor-pointer font-semibold hover:text-slate-800">
                  別のCSVをアップロードする場合はこちら
                </summary>
                <div className="mt-3 p-4 bg-slate-50 rounded-lg">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleKarteUpload}
                    disabled={isLoading}
                    className="w-full rounded-lg border border-slate-300 px-4 py-2 disabled:bg-slate-100"
                  />
                  {isLoading && <span className="text-sm text-slate-600 mt-2 block">読み込み中...</span>}
                  <p className="mt-2 text-xs text-slate-500">
                    新しいCSVをアップロードすると、現在のデータが上書きされます
                  </p>
                </div>
              </details>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-4 bg-amber-50 border-2 border-amber-200 rounded-xl">
                <div className="flex-shrink-0 w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-xl">!</span>
                </div>
                <div>
                  <p className="font-semibold text-amber-900">
                    カルテデータがありません
                  </p>
                  <p className="text-sm text-amber-700">
                    データ管理ページでカルテCSVをアップロードするか、こちらから直接アップロードしてください
                  </p>
                </div>
              </div>
              <input
                type="file"
                accept=".csv"
                onChange={handleKarteUpload}
                disabled={isLoading}
                className="w-full rounded-lg border border-slate-300 px-4 py-2 disabled:bg-slate-100"
              />
              {isLoading && <span className="text-sm text-slate-600">読み込み中...</span>}
            </div>
          )}
        </div>

        {/* 比較結果セクション */}
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold text-slate-700">比較結果</h2>

          {/* 患者数系 */}
          <div className="rounded-2xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-xl font-semibold text-slate-700">患者数指標</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b-2 border-slate-200">
                    <th className="pb-2 text-slate-600">指標</th>
                    {dateRanges.map((range) => (
                      <th key={range.id} className="pb-2 text-center" style={{ color: range.color }}>
                        {range.label}
                      </th>
                    ))}
                    {dateRanges.length >= 2 && (
                      <>
                        <th className="pb-2 text-center text-slate-600">差分</th>
                        <th className="pb-2 text-center text-slate-600">増減率</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: "totalPatients", label: "総患者数" },
                    { key: "pureFirstVisits", label: "初診数" },
                    { key: "revisitCount", label: "再診数" },
                    { key: "generalDepartment", label: "総合診療" },
                    { key: "feverDepartment", label: "発熱外来" },
                    { key: "endoscopyDepartment", label: "内視鏡" },
                  ].map((metric) => {
                    const baseValue = metricsMap[dateRanges[0]?.id]?.[metric.key as keyof ComparisonMetrics] as number || 0;
                    const compareValue = metricsMap[dateRanges[1]?.id]?.[metric.key as keyof ComparisonMetrics] as number || 0;
                    const { diff, rate } = calculateDiff(baseValue, compareValue);

                    return (
                      <tr key={metric.key} className="border-b border-slate-100">
                        <td className="py-3 font-medium text-slate-700">{metric.label}</td>
                        {dateRanges.map((range) => (
                          <td key={range.id} className="py-3 text-center font-semibold">
                            {(metricsMap[range.id]?.[metric.key as keyof ComparisonMetrics] as number || 0).toLocaleString()}
                          </td>
                        ))}
                        {dateRanges.length >= 2 && (
                          <>
                            <td className={`py-3 text-center font-semibold ${diff > 0 ? "text-green-600" : diff < 0 ? "text-red-600" : ""}`}>
                              {diff > 0 ? "+" : ""}{diff.toLocaleString()}
                            </td>
                            <td className={`py-3 text-center font-semibold ${diff > 0 ? "text-green-600" : diff < 0 ? "text-red-600" : ""}`}>
                              {typeof rate === "string" ? rate : `${rate}%`}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 年齢・経済系 */}
          <div className="rounded-2xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-xl font-semibold text-slate-700">年齢・経済指標</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b-2 border-slate-200">
                    <th className="pb-2 text-slate-600">指標</th>
                    {dateRanges.map((range) => (
                      <th key={range.id} className="pb-2 text-center" style={{ color: range.color }}>
                        {range.label}
                      </th>
                    ))}
                    {dateRanges.length >= 2 && (
                      <>
                        <th className="pb-2 text-center text-slate-600">差分</th>
                        <th className="pb-2 text-center text-slate-600">増減率</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: "averageAge", label: "平均年齢", unit: "歳" },
                    { key: "averagePoints", label: "平均点数", unit: "点" },
                    { key: "totalPoints", label: "総点数", unit: "点" },
                    { key: "uniqueAddresses", label: "ユニーク住所数", unit: "" },
                  ].map((metric) => {
                    const baseValue = metricsMap[dateRanges[0]?.id]?.[metric.key as keyof ComparisonMetrics] as number || 0;
                    const compareValue = metricsMap[dateRanges[1]?.id]?.[metric.key as keyof ComparisonMetrics] as number || 0;
                    const { diff, rate } = calculateDiff(baseValue, compareValue);

                    return (
                      <tr key={metric.key} className="border-b border-slate-100">
                        <td className="py-3 font-medium text-slate-700">{metric.label}</td>
                        {dateRanges.map((range) => {
                          const value = metricsMap[range.id]?.[metric.key as keyof ComparisonMetrics] as number | null;
                          return (
                            <td key={range.id} className="py-3 text-center font-semibold">
                              {value !== null ? `${value.toLocaleString()}${metric.unit}` : "N/A"}
                            </td>
                          );
                        })}
                        {dateRanges.length >= 2 && (
                          <>
                            <td className={`py-3 text-center font-semibold ${diff > 0 ? "text-green-600" : diff < 0 ? "text-red-600" : ""}`}>
                              {diff > 0 ? "+" : ""}{diff.toFixed(1)}{metric.unit}
                            </td>
                            <td className={`py-3 text-center font-semibold ${diff > 0 ? "text-green-600" : diff < 0 ? "text-red-600" : ""}`}>
                              {typeof rate === "string" ? rate : `${rate}%`}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 年代別分布グラフ */}
          <div className="rounded-2xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-xl font-semibold text-slate-700">年代別患者分布</h3>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart
                data={[
                  "10代以下",
                  "20代",
                  "30代",
                  "40代",
                  "50代",
                  "60代",
                  "70代",
                  "80代以上",
                ].map((ageGroup) => {
                  const dataPoint: Record<string, string | number> = { ageGroup };
                  dateRanges.forEach((range) => {
                    dataPoint[range.label] = metricsMap[range.id]?.ageDistribution[ageGroup] || 0;
                  });
                  return dataPoint;
                })}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#CBD5F5" />
                <XAxis dataKey="ageGroup" tick={{ fontSize: 13, fill: "#1f2937", fontWeight: 600 }} />
                <YAxis
                  label={{
                    value: "患者数（人）",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 13, fill: "#1f2937", fontWeight: 600 },
                  }}
                  tick={{ fontSize: 13, fill: "#1f2937", fontWeight: 600 }}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    borderColor: "#cbd5e1",
                    backgroundColor: "#ffffff",
                    boxShadow: "0 18px 32px rgba(15,23,42,0.12)",
                  }}
                />
                <Legend />
                {dateRanges.map((range) => (
                  <Bar
                    key={range.id}
                    dataKey={range.label}
                    fill={range.color}
                    radius={[10, 10, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 曜日別分布グラフ */}
          <div className="rounded-2xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-xl font-semibold text-slate-700">曜日別患者分布</h3>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart
                data={["月", "火", "水", "木", "金", "土", "日"].map((weekday) => {
                  const dataPoint: Record<string, string | number> = { weekday };
                  dateRanges.forEach((range) => {
                    dataPoint[range.label] = metricsMap[range.id]?.weekdayDistribution[weekday] || 0;
                  });
                  return dataPoint;
                })}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#CBD5F5" />
                <XAxis dataKey="weekday" tick={{ fontSize: 13, fill: "#1f2937", fontWeight: 600 }} />
                <YAxis
                  label={{
                    value: "患者数（人）",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 13, fill: "#1f2937", fontWeight: 600 },
                  }}
                  tick={{ fontSize: 13, fill: "#1f2937", fontWeight: 600 }}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    borderColor: "#cbd5e1",
                    backgroundColor: "#ffffff",
                    boxShadow: "0 18px 32px rgba(15,23,42,0.12)",
                  }}
                />
                <Legend />
                {dateRanges.map((range) => (
                  <Bar
                    key={range.id}
                    dataKey={range.label}
                    fill={range.color}
                    radius={[10, 10, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
