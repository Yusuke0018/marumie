"use client";

import { useEffect, useMemo, useState } from "react";
import { getMonthKey } from "@/lib/dateUtils";
import { AnalysisFilterPortal } from "@/components/AnalysisFilterPortal";
import { useAnalysisPeriodRange } from "@/hooks/useAnalysisPeriodRange";
import { setAnalysisPeriodLabel } from "@/lib/analysisPeriod";
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
  LineChart,
  ScatterChart,
  Scatter,
  ZAxis,
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
  reservationDate?: string;
  appointmentIso?: string | null;
  receivedAtIso?: string;
};

const extractDatePart = (value?: string | null): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const withoutTime = trimmed.includes("T") ? trimmed.split("T")[0] : trimmed.split(" ")[0] ?? trimmed;
  const normalized = withoutTime.replace(/\./g, "-").replace(/\//g, "-");

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) {
    const [year, month, day] = normalized.split("-");
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  if (/^\d{4}-\d{1,2}$/.test(normalized)) {
    const [year, month] = normalized.split("-");
    return `${year}-${month.padStart(2, "0")}-01`;
  }

  return normalized;
};

const resolveReservationDate = (reservation: Reservation): string | undefined => {
  return (
    extractDatePart(reservation.reservationDate) ??
    extractDatePart(reservation.appointmentIso ?? undefined) ??
    extractDatePart(reservation.receivedAtIso) ??
    extractDatePart(reservation.reservationMonth)
  );
};

const LISTING_STORAGE_KEY = "clinic-analytics/listing/v1";
const RESERVATION_STORAGE_KEY = "clinic-analytics/reservations/v1";

// カテゴリごとの診療科マッピング
const CATEGORY_MAPPING = {
  "内科": ["内科・外科外来（大岩医師）", "発熱・風邪症状外来", "内科外来（担当医師）"],
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
  const [lambda, setLambda] = useState<number>(0.5);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const storedListing = window.localStorage.getItem(LISTING_STORAGE_KEY);
      if (storedListing) {
        setListingData(JSON.parse(storedListing));
      }
      
      const storedReservations = window.localStorage.getItem(RESERVATION_STORAGE_KEY);
      if (storedReservations) {
        const parsed = JSON.parse(storedReservations) as Reservation[];
        setReservations(
          parsed.map((item) => ({
            ...item,
            reservationDate: resolveReservationDate(item),
          })),
        );
      }
    } catch (error) {
      console.error(error);
    }
  }, []);

  const availableMonths = useMemo(() => {
    const category = listingData.find((c) => c.category === selectedCategory);
    if (!category) {
      return [];
    }
    const months = new Set<string>();
    category.data.forEach((day) => {
      const key = getMonthKey(day.date);
      if (key) {
        months.add(key);
      }
    });
    return Array.from(months).sort();
  }, [listingData, selectedCategory]);

  const {
    startMonth,
    endMonth,
    setStartMonth,
    setEndMonth,
    resetPeriod,
  } = useAnalysisPeriodRange(availableMonths);

  const currentListingData = useMemo(() => {
    const categoryData = listingData.find((c) => c.category === selectedCategory);
    if (!categoryData) {
      return [];
    }

    let data = categoryData.data;

    if (startMonth && endMonth) {
      data = data.filter((item) => {
        const month = getMonthKey(item.date);
        return month && month >= startMonth && month <= endMonth;
      });
    } else if (startMonth) {
      data = data.filter((item) => {
        const month = getMonthKey(item.date);
        return month && month >= startMonth;
      });
    } else if (endMonth) {
      data = data.filter((item) => {
        const month = getMonthKey(item.date);
        return month && month <= endMonth;
      });
    }

    return data;
  }, [endMonth, listingData, selectedCategory, startMonth]);

  const correlationRangeLabel = useMemo(() => {
    if (startMonth && endMonth) {
      if (startMonth === endMonth) {
        return startMonth;
      }
      return `${startMonth}〜${endMonth}`;
    }
    if (startMonth) {
      return `${startMonth}以降`;
    }
    if (endMonth) {
      return `${endMonth}まで`;
    }
    return "全期間";
  }, [endMonth, startMonth]);

  useEffect(() => {
    setAnalysisPeriodLabel(correlationRangeLabel);
  }, [correlationRangeLabel]);

  const currentReservations = useMemo(() => {
    const departments = CATEGORY_MAPPING[selectedCategory];
    let filtered = reservations.filter(r => 
      r && departments.includes(r.department) && r.visitType === "初診"
    );

    if (startMonth && endMonth) {
      filtered = filtered.filter(r => {
        if (!r.reservationMonth) return false;
        const month = r.reservationMonth.replace('/', '-');
        return month >= startMonth && month <= endMonth;
      });
    } else if (startMonth) {
      filtered = filtered.filter(r => {
        if (!r.reservationMonth) return false;
        const month = r.reservationMonth.replace('/', '-');
        return month >= startMonth;
      });
    } else if (endMonth) {
      filtered = filtered.filter(r => {
        if (!r.reservationMonth) return false;
        const month = r.reservationMonth.replace('/', '-');
        return month <= endMonth;
      });
    }
    
    return filtered;
  }, [reservations, selectedCategory, startMonth, endMonth]);

  const dailyData = useMemo(() => {
    // 日付ごとにデータを集計
    const dateMap = new Map<string, { cvByHour: number[]; reservationsByHour: number[]; date: string }>();
    
    currentListingData.forEach(day => {
      if (!dateMap.has(day.date)) {
        dateMap.set(day.date, {
          date: day.date,
          cvByHour: Array(24).fill(0),
          reservationsByHour: Array(24).fill(0)
        });
      }
      const entry = dateMap.get(day.date)!;
      day.hourlyCV.forEach((cv, hour) => {
        entry.cvByHour[hour] += cv;
      });
    });
    
    currentReservations.forEach(reservation => {
      // 予約データの安全性チェック
      if (!reservation.reservationDate || typeof reservation.reservationHour !== 'number') return;

      // 予約の実際の受診日を取得（reservationDateはYYYY-MM-DD形式）
      const resDate = reservation.reservationDate;

      // 同じ日付のエントリが存在する場合のみ予約を追加
      if (dateMap.has(resDate)) {
        const entry = dateMap.get(resDate)!;
        entry.reservationsByHour[reservation.reservationHour]++;
      }
    });
    
    // 各日付の相関係数を計算
    const dailyCorrelations: { date: string; correlation: number; cvTotal: number; resTotal: number }[] = [];
    
    for (const entry of dateMap.values()) {
      const cvTotal = entry.cvByHour.reduce((a, b) => a + b, 0);
      const resTotal = entry.reservationsByHour.reduce((a, b) => a + b, 0);
      
      if (cvTotal > 0 && resTotal > 0) {
        // 正規化（割合化）
        const cvRatio = entry.cvByHour.map(v => cvTotal > 0 ? (v / cvTotal) * 100 : 0);
        const resRatio = entry.reservationsByHour.map(v => resTotal > 0 ? (v / resTotal) * 100 : 0);
        
        const corr = calculateCorrelation(cvRatio, resRatio);
        dailyCorrelations.push({ date: entry.date, correlation: corr, cvTotal, resTotal });
      }
    }
    
    return dailyCorrelations.sort((a, b) => a.date.localeCompare(b.date));
  }, [currentListingData, currentReservations]);

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
    if (dailyData.length === 0) return 0;
    // 全日の平均相関係数を計算
    const avgCorr = dailyData.reduce((sum, d) => sum + d.correlation, 0) / dailyData.length;
    return avgCorr;
  }, [dailyData]);

  const interpretation = useMemo(() => {
    return getCorrelationInterpretation(correlation);
  }, [correlation]);

  // ラグ相関分析（0-24時間）
  const lagCorrelations = useMemo(() => {
    const cvValues = hourlyData.map(d => d.CV数);
    const resValues = hourlyData.map(d => d.初診数);
    const results: { lag: number; correlation: number }[] = [];
    
    for (let lag = 0; lag <= 24; lag++) {
      if (lag >= cvValues.length) break;
      const cvLagged = cvValues.slice(0, cvValues.length - lag);
      const resShifted = resValues.slice(lag);
      const corr = calculateCorrelation(cvLagged, resShifted);
      results.push({ lag, correlation: corr });
    }
    
    return results;
  }, [hourlyData]);

  const peakLag = useMemo(() => {
    if (lagCorrelations.length === 0) return { lag: 0, correlation: 0 };
    return lagCorrelations.reduce((max, curr) => 
      curr.correlation > max.correlation ? curr : max
    , lagCorrelations[0]);
  }, [lagCorrelations]);

  // アドストック計算
  const adstockData = useMemo(() => {
    const cvValues = hourlyData.map(d => d.CV数);
    const adstock: number[] = [];
    
    for (let t = 0; t < cvValues.length; t++) {
      let sum = 0;
      for (let i = 0; i <= t; i++) {
        sum += cvValues[t - i] * Math.pow(lambda, i);
      }
      adstock.push(sum);
    }
    
    return hourlyData.map((d, i) => ({
      hour: d.hour,
      アドストック: adstock[i],
      初診数: d.初診数,
      疑似CVR: adstock[i] > 0 ? (d.初診数 / adstock[i]) * 100 : 0,
    }));
  }, [hourlyData, lambda]);

  // 散布図データ
  const scatterData = useMemo(() => {
    return hourlyData.map(d => ({
      CV割合: d.CV割合,
      初診割合: d.初診割合,
      hour: d.hour,
    }));
  }, [hourlyData]);

  // 回帰直線の計算
  const regression = useMemo(() => {
    const xValues = hourlyData.map(d => d.CV割合);
    const yValues = hourlyData.map(d => d.初診割合);
    
    if (xValues.length === 0) return { slope: 0, intercept: 0 };
    
    const n = xValues.length;
    const sumX = xValues.reduce((a, b) => a + b, 0);
    const sumY = yValues.reduce((a, b) => a + b, 0);
    const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
    const sumX2 = xValues.reduce((sum, x) => sum + x * x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return { slope, intercept };
  }, [hourlyData]);

  const regressionLine = useMemo(() => {
    const xMin = Math.min(...hourlyData.map(d => d.CV割合));
    const xMax = Math.max(...hourlyData.map(d => d.CV割合));
    
    return [
      { CV割合: xMin, 初診割合: regression.slope * xMin + regression.intercept },
      { CV割合: xMax, 初診割合: regression.slope * xMax + regression.intercept },
    ];
  }, [hourlyData, regression]);

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
                リスティング広告のCV（予約ページ遷移）が、実際の初診予約にどの程度つながっているかを統計的に分析します。
              </p>
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900 mb-2">📊 表示されているデータ</p>
                <ul className="space-y-1 text-sm text-amber-800">
                  <li>• <strong>相関係数</strong>: -1〜1の数値。CVと予約の時間帯パターンがどれだけ似ているかを表す指標</li>
                  <li>• <strong>重ね合わせグラフ</strong>: CV割合（青い棒）と初診割合（赤い線）を時間帯ごとに並べて表示</li>
                  <li>• <strong>日別相関推移</strong>: 各日ごとの相関係数の変化を折れ線グラフで表示</li>
                  <li>• <strong>ラグ相関</strong>: 0〜24時間のタイムラグごとの相関係数を折れ線グラフで表示</li>
                  <li>• <strong>散布図</strong>: CV割合と初診割合の関係を点で表示し、回帰直線を引いたグラフ</li>
                  <li>• <strong>期間フィルター</strong>: 直近3ヶ月/6ヶ月/1年/全期間に加え、任意の日付範囲と月別で絞り込み可能</li>
                </ul>
                <p className="mt-3 text-xs text-amber-700">
                  💡 補足: 相関係数は統計的な類似度を示す数値です。高い値でも因果関係を意味するとは限りません。
                </p>
              </div>
          </div>
        </section>

        <AnalysisFilterPortal
          months={availableMonths}
          startMonth={startMonth}
          endMonth={endMonth}
          onChangeStart={setStartMonth}
          onChangeEnd={setEndMonth}
          onReset={resetPeriod}
          label={correlationRangeLabel}
        />

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold text-slate-700">カテゴリ:</label>
            <div className="flex gap-2">
              {(["内科", "胃カメラ", "大腸カメラ"] as const).map(cat => (
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
                <h2 className="text-lg font-semibold text-slate-900">日別相関係数分析</h2>
                <div className="mt-4 rounded-2xl border-2 border-brand-200 bg-brand-50 p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-600">平均相関係数（日別）</p>
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
                      <strong>日別相関とは：</strong>各日ごとにCV発生時間帯と予約時間帯の相関を計算し、その平均値を表示。
                      総数での比較ではなく、毎日のパターンの一致度を評価することで、時間のズレを検出できます。
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <h3 className="text-base font-semibold text-slate-800 mb-3">日別相関係数の推移</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dailyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={80} />
                        <YAxis domain={[-1, 1]} label={{ value: '相関係数', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} tick={{ fontSize: 12 }} />
                        <Tooltip formatter={(value: number) => [value.toFixed(3), "相関係数"]} />
                        <Line type="monotone" dataKey="correlation" stroke="#3FBFAA" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    各日のCV時間帯パターンと予約時間帯パターンの相関。変動が大きい場合、日によって広告効果が異なる可能性があります。
                  </p>
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
              <h2 className="mb-4 text-lg font-semibold text-slate-900">高度な分析（Phase 2）</h2>
              
              <div className="mb-6">
                <h3 className="text-base font-semibold text-slate-800">ラグ相関分析</h3>
                <p className="mt-1 text-sm text-slate-500">
                  CVから予約までの時間差（ラグ）を考慮した相関分析。ピーク位置で最適な時間差を特定します。
                </p>
                <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <p className="text-sm font-semibold text-blue-900">
                    ピーク: {peakLag.lag}時間後（相関係数 {peakLag.correlation.toFixed(3)}）
                  </p>
                  <p className="mt-1 text-xs text-blue-700">
                    {peakLag.lag === 0 
                      ? "CVと予約が同時刻に発生しています。即座の予約行動を示唆します。"
                      : `CVから約${peakLag.lag}時間後に予約が増える傾向があります。検討期間の目安になります。`}
                  </p>
                </div>
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={lagCorrelations}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="lag" label={{ value: 'ラグ（時間）', position: 'insideBottom', offset: -5, style: { fontSize: 12 } }} tick={{ fontSize: 12 }} />
                      <YAxis label={{ value: '相関係数', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="correlation" stroke="#5DD4C3" strokeWidth={2} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="mb-6 border-t border-slate-200 pt-6">
                <h3 className="text-base font-semibold text-slate-800">アドストック分析</h3>
                <p className="mt-1 text-sm text-slate-500">
                  広告効果の減衰を考慮した分析。λ値で効果の持続期間を調整できます。
                </p>
                <div className="mt-4 flex items-center gap-4">
                  <label className="text-sm font-semibold text-slate-700">減衰率 λ:</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={lambda}
                    onChange={(e) => setLambda(Number(e.target.value))}
                    className="w-48"
                  />
                  <span className="text-sm font-medium text-slate-700">{lambda.toFixed(1)}</span>
                  <span className="text-xs text-slate-500">
                    ({lambda < 0.3 ? "短期効果" : lambda < 0.7 ? "中期効果" : "長期効果"})
                  </span>
                </div>
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={adstockData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="hour" tick={{ fontSize: 12 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Bar yAxisId="left" dataKey="アドストック" fill="#75DBC3" fillOpacity={0.6} name="アドストック" />
                      <Line yAxisId="right" type="monotone" dataKey="初診数" stroke="#E65C5C" strokeWidth={2} name="初診数" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 rounded-xl border border-purple-200 bg-purple-50 p-4">
                  <p className="text-sm font-semibold text-purple-900">疑似CVR（アドストックベース）</p>
                  <p className="mt-1 text-xs text-purple-700">
                    平均疑似CVR: {(adstockData.reduce((sum, d) => sum + d.疑似CVR, 0) / adstockData.length).toFixed(2)}%
                    （アドストック蓄積に対する予約の割合）
                  </p>
                </div>
              </div>

              <div className="mb-6 border-t border-slate-200 pt-6">
                <h3 className="text-base font-semibold text-slate-800">散布図と回帰分析</h3>
                <p className="mt-1 text-sm text-slate-500">
                  CV割合と初診割合の関係を可視化。回帰直線の傾きが広告効果の強さを示します。
                </p>
                <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
                  <p className="text-sm font-semibold text-green-900">
                    回帰係数: {regression.slope.toFixed(3)}
                  </p>
                  <p className="mt-1 text-xs text-green-700">
                    {regression.slope > 0.5 
                      ? "CV増加が予約増加に強く寄与しています。"
                      : regression.slope > 0.2
                      ? "CV増加が予約増加にある程度寄与しています。"
                      : "CV増加の予約への寄与は限定的です。"}
                  </p>
                </div>
                <div className="mt-4 h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="CV割合" name="CV割合" label={{ value: 'CV割合 (%)', position: 'insideBottom', offset: -5, style: { fontSize: 12 } }} tick={{ fontSize: 12 }} />
                      <YAxis dataKey="初診割合" name="初診割合" label={{ value: '初診割合 (%)', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} tick={{ fontSize: 12 }} />
                      <ZAxis range={[60, 60]} />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                      <Scatter name="時間帯別データ" data={scatterData} fill="#3FBFAA" />
                      <Line data={regressionLine} type="monotone" dataKey="初診割合" stroke="#FF7B7B" strokeWidth={2} dot={false} name="回帰直線" />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <h3 className="font-semibold text-amber-900">📈 高度分析の解釈</h3>
                <ul className="mt-2 space-y-1 text-sm text-amber-800">
                  <li>• <strong>ラグ相関</strong>: 時間差を考慮した関連性。ピーク位置が検討期間の目安</li>
                  <li>• <strong>アドストック</strong>: 広告効果の蓄積と減衰。λ値で持続期間を調整</li>
                  <li>• <strong>回帰分析</strong>: CV増加が予約増加にどれだけ寄与するかを定量化</li>
                  <li>• これらの指標が一貫して正の関係を示す場合、広告効果の可能性が高い</li>
                </ul>
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
