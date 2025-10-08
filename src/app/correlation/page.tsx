"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

type ListingData = {
  date: string;
  amount: number;
  cv: number;
  cvr: number;
  cpa: number;
  hourlyCV: number[];
};

type CategoryData = {
  category: "内科" | "胃カメラ" | "大腸カメラ";
  data: ListingData[];
};

type Reservation = {
  department: string;
  visitType: "初診" | "再診" | "未設定";
  reservationHour: number;
  reservationMonth: string;
};

const LISTING_STORAGE_KEY = "clinic-analytics/listing/v1";
const RESERVATION_STORAGE_KEY = "clinic-analytics/reservations/v1";

// カテゴリごとの診療科マッピング
const CATEGORY_MAPPING = {
  "内科": ["内科外来", "発熱外来", "内科外科外来"],
  "胃カメラ": ["胃カメラ"],
  "大腸カメラ": ["大腸カメラ", "人間ドックB", "内視鏡ドック"],
};

// 相関係数を計算（Pearson）
const calculateCorrelation = (x: number[], y: number[]): number => {
  if (x.length !== y.length || x.length === 0) return 0;
  
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  
  if (denominator === 0) return 0;
  return numerator / denominator;
};

// 相関係数の解釈テキスト
const getCorrelationInterpretation = (r: number): { level: string; meaning: string; color: string } => {
  const absR = Math.abs(r);
  if (absR >= 0.7) {
    return {
      level: "強い相関",
      meaning: "CVと予約の時間帯パターンが非常に似ています。広告が予約に寄与している可能性が高いです。",
      color: "text-green-600"
    };
  } else if (absR >= 0.4) {
    return {
      level: "中程度の相関",
      meaning: "CVと予約にある程度の関連性が見られます。他の要因と合わせて判断が必要です。",
      color: "text-blue-600"
    };
  } else if (absR >= 0.2) {
    return {
      level: "弱い相関",
      meaning: "CVと予約の関連性は弱いです。広告以外の要因が大きい可能性があります。",
      color: "text-yellow-600"
    };
  } else {
    return {
      level: "相関なし",
      meaning: "CVと予約の間に明確な関連性は見られません。",
      color: "text-slate-600"
    };
  }
};

export default function CorrelationPage() {
  const [listingData, setListingData] = useState<CategoryData[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<"内科" | "胃カメラ" | "大腸カメラ">("内科");
  const [selectedMonth, setSelectedMonth] = useState<string>("all");

  useEffect(() => {
    if (typeof window === "undefined") return;
    
    try {
      const storedListing = window.localStorage.getItem(LISTING_STORAGE_KEY);
      if (storedListing) {
        setListingData(JSON.parse(storedListing));
      }
      
      const storedReservations = window.localStorage.getItem(RESERVATION_STORAGE_KEY);
      if (storedReservations) {
        setReservations(JSON.parse(storedReservations));
      }
    } catch (error) {
      console.error(error);
    }
  }, []);

  const currentListingData = useMemo(() => {
    const categoryData = listingData.find(c => c.category === selectedCategory);
    if (!categoryData) return [];
    
    if (selectedMonth === "all") return categoryData.data;
    return categoryData.data.filter(d => d.date.startsWith(selectedMonth));
  }, [listingData, selectedCategory, selectedMonth]);

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    currentListingData.forEach(d => {
      const parts = d.date.split("-");
      if (parts.length >= 2) {
        months.add(`${parts[0]}-${parts[1]}`);
      }
    });
    return Array.from(months).sort();
  }, [currentListingData]);

  const currentReservations = useMemo(() => {
    const departments = CATEGORY_MAPPING[selectedCategory];
    let filtered = reservations.filter(r => 
      departments.includes(r.department) && r.visitType === "初診"
    );
    
    if (selectedMonth !== "all") {
      filtered = filtered.filter(r => r.reservationMonth === selectedMonth);
    }
    
    return filtered;
  }, [reservations, selectedCategory, selectedMonth]);

  const hourlyData = useMemo(() => {
    const cvByHour = Array(24).fill(0);
    const reservationsByHour = Array(24).fill(0);
    
    // CV集計
    currentListingData.forEach(day => {
      day.hourlyCV.forEach((cv, hour) => {
        cvByHour[hour] += cv;
      });
    });
    
    // 予約集計
    currentReservations.forEach(reservation => {
      reservationsByHour[reservation.reservationHour]++;
    });
    
    // 正規化（割合）
    const cvTotal = cvByHour.reduce((a, b) => a + b, 0);
    const resTotal = reservationsByHour.reduce((a, b) => a + b, 0);
    
    return Array.from({ length: 24 }, (_, hour) => ({
      hour: `${hour}時`,
      CV数: cvByHour[hour],
      CV割合: cvTotal > 0 ? (cvByHour[hour] / cvTotal) * 100 : 0,
      初診数: reservationsByHour[hour],
      初診割合: resTotal > 0 ? (reservationsByHour[hour] / resTotal) * 100 : 0,
    }));
  }, [currentListingData, currentReservations]);

  const correlation = useMemo(() => {
    const cvValues = hourlyData.map(d => d.CV割合);
    const resValues = hourlyData.map(d => d.初診割合);
    return calculateCorrelation(cvValues, resValues);
  }, [hourlyData]);

  const interpretation = useMemo(() => {
    return getCorrelationInterpretation(correlation);
  }, [correlation]);

  const categories: Array<"内科" | "胃カメラ" | "大腸カメラ"> = ["内科", "胃カメラ", "大腸カメラ"];

  const hasData = currentListingData.length > 0 && currentReservations.length > 0;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-12">
        <section className="relative overflow-hidden rounded-3xl border border-brand-200 bg-gradient-to-r from-white via-brand-50 to-brand-100 p-8 shadow-card">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-brand-600">CV-Reservation Correlation</p>
            <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">
              CV-予約 相関分析
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              リスティング広告のCV（予約ページ遷移）が、実際の初診予約にどの程度つながっているかを時間帯の動きから分析します。
            </p>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
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

          {availableMonths.length > 0 && (
            <div className="flex items-center gap-2">
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
          )}
        </div>

        {!hasData && (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 px-8 py-12 text-center">
            <p className="text-slate-500">
              {selectedCategory}のリスティングデータと予約データをアップロードしてください
            </p>
            <p className="mt-2 text-sm text-slate-400">
              リスティング分析ページと予約分析ページでデータをアップロードしてください
            </p>
          </div>
        )}

        {hasData && (
          <>
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-slate-900">相関係数分析</h2>
                <div className="mt-4 rounded-2xl border-2 border-brand-200 bg-brand-50 p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-600">ピアソン相関係数</p>
                      <p className={`mt-1 text-4xl font-bold ${interpretation.color}`}>
                        {correlation.toFixed(3)}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`inline-block rounded-full px-4 py-2 text-sm font-semibold ${interpretation.color} bg-white`}>
                        {interpretation.level}
                      </span>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-slate-700">
                    {interpretation.meaning}
                  </p>
                  <div className="mt-4 border-t border-brand-200 pt-4">
                    <p className="text-xs text-slate-500">
                      <strong>相関係数とは：</strong>2つのデータの「形の似ている度合い」を-1〜1の数値で表したもの。
                      1に近いほど強い正の相関（同じ動き）、-1に近いほど強い負の相関（逆の動き）、0に近いほど無相関を意味します。
                    </p>
                  </div>
                </div>
              </div>

              <div className="mb-4">
                <h3 className="text-base font-semibold text-slate-800">時間帯別の重ね合わせ（正規化）</h3>
                <p className="mt-1 text-sm text-slate-500">
                  各時間帯のCV・予約を全体に対する割合（%）で表示。時間帯の「形」を比較できます。
                </p>
              </div>

              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="hour" tick={{ fontSize: 12 }} />
                    <YAxis yAxisId="left" label={{ value: 'CV割合 (%)', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} tick={{ fontSize: 12 }} />
                    <YAxis yAxisId="right" orientation="right" label={{ value: '初診割合 (%)', angle: 90, position: 'insideRight', style: { fontSize: 12 } }} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="left" dataKey="CV割合" fill="#3FBFAA" fillOpacity={0.6} name="CV割合 (%)" />
                    <Line yAxisId="right" type="monotone" dataKey="初診割合" stroke="#FF7B7B" strokeWidth={2} name="初診割合 (%)" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
              <h2 className="mb-4 text-lg font-semibold text-slate-900">分析の読み方</h2>
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="font-semibold text-slate-800">📊 グラフの見方</h3>
                  <ul className="mt-2 space-y-1 text-sm text-slate-600">
                    <li>• <strong>棒グラフ（CV割合）</strong>: 広告経由の予約ページ遷移が発生した時間帯の分布</li>
                    <li>• <strong>折れ線グラフ（初診割合）</strong>: 実際に初診予約が入った時間帯の分布</li>
                    <li>• <strong>形が似ている</strong> = CVが発生した時間帯に予約も増えている = 広告効果の可能性</li>
                  </ul>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="font-semibold text-slate-800">⚠️ 注意点</h3>
                  <ul className="mt-2 space-y-1 text-sm text-slate-600">
                    <li>• 相関関係は必ずしも因果関係を意味しません</li>
                    <li>• 診療時間の影響（昼休み等）でも形が似ることがあります</li>
                    <li>• CVは「予約ページ遷移」であり、必ずしも予約成立ではありません</li>
                    <li>• 複数の月のデータを重ねることで、より正確な判断ができます</li>
                  </ul>
                </div>

                <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
                  <h3 className="font-semibold text-slate-800">💡 次のステップ</h3>
                  <p className="mt-2 text-sm text-slate-600">
                    相関が高い場合でも、さらに詳しい分析（タイムラグ分析、アドストック分析等）を行うことで、
                    より確実に広告効果を測定できます。
                  </p>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
