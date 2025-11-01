'use client';

import { useEffect, useMemo, useState } from "react";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AnalysisFilterPortal } from "@/components/AnalysisFilterPortal";
import { useAnalysisPeriodRange } from "@/hooks/useAnalysisPeriodRange";
import { setAnalysisPeriodLabel } from "@/lib/analysisPeriod";
import {
  buildListingAggregation,
  buildSurveyAggregation,
  buildTrueFirstAggregation,
} from "@/lib/correlationData";
import { getMonthKey } from "@/lib/dateUtils";
import type { ListingCategoryData } from "@/lib/listingData";
import { LISTING_STORAGE_KEY } from "@/lib/listingData"; 
import type { KarteRecord } from "@/lib/karteAnalytics";
import type { Reservation } from "@/lib/reservationData";
import { RESERVATION_STORAGE_KEY } from "@/lib/reservationData";
import { KARTE_STORAGE_KEY } from "@/lib/storageKeys";
import { getCompressedItem } from "@/lib/storageCompression";
import type { SurveyData } from "@/lib/surveyData";
import { loadSurveyDataFromStorage } from "@/lib/surveyData";

type SegmentKey =
  | "general"
  | "fever"
  | "endoscopy" // 内視鏡（合計: 胃+大腸）
  | "endoscopy-stomach" // 胃カメラ
  | "endoscopy-colon"; // 大腸カメラ

type HourlyChartPoint = {
  hour: string;
  listingCv: number;
  listingRatio: number;
  trueFirst: number;
  trueFirstRatio: number;
  reservations: number;
  reservationsRatio: number;
};

type DailyChartPoint = {
  date: string;
  listingCv: number;
  trueFirst: number;
  surveyGoogle: number;
  reservations: number;
};

type LagCorrelationPoint = {
  lag: number;
  correlation: number;
};

const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);

const calculateCorrelation = (x: number[], y: number[]): number => {
  if (x.length !== y.length || x.length === 0) {
    return 0;
  }
  const n = x.length;
  const sumX = sum(x);
  const sumY = sum(y);
  const sumXY = x.reduce((acc, xi, index) => acc + xi * y[index], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY),
  );

  if (denominator === 0) {
    return 0;
  }
  return numerator / denominator;
};

const toPercentSeries = (values: number[]) => {
  const total = sum(values);
  if (total === 0) {
    return values.map(() => 0);
  }
  return values.map((value) => (value / total) * 100);
};

const computeCrossCorrelation = (
  source: number[],
  target: number[],
  maxLag: number,
): LagCorrelationPoint[] => {
  const results: LagCorrelationPoint[] = [];
  if (source.length === 0 || target.length === 0) {
    return results;
  }

  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    const alignedSource: number[] = [];
    const alignedTarget: number[] = [];

    for (let index = 0; index < source.length; index += 1) {
      const shiftedIndex = index + lag;
      if (shiftedIndex < 0 || shiftedIndex >= target.length) {
        continue;
      }
      alignedSource.push(source[index]);
      alignedTarget.push(target[shiftedIndex]);
    }

    if (alignedSource.length > 1) {
      results.push({
        lag,
        correlation: calculateCorrelation(alignedSource, alignedTarget),
      });
    }
  }

  return results;
};

const correlationLevel = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 0.7) {
    return { label: "強い相関", color: "text-emerald-600" };
  }
  if (abs >= 0.4) {
    return { label: "中程度の相関", color: "text-blue-600" };
  }
  if (abs >= 0.2) {
    return { label: "弱い相関", color: "text-amber-600" };
  }
  return { label: "相関なし", color: "text-slate-500" };
};

const SEGMENT_LABEL: Record<SegmentKey, string> = {
  general: "総合診療・内科",
  fever: "発熱外来",
  endoscopy: "内視鏡（合計）",
  "endoscopy-stomach": "胃カメラ",
  "endoscopy-colon": "大腸カメラ",
};

export default function CorrelationPage() {
  const [listingData, setListingData] = useState<ListingCategoryData[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [surveyData, setSurveyData] = useState<SurveyData[]>([]);
  const [karteRecords, setKarteRecords] = useState<KarteRecord[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<SegmentKey>("general");
  const [showDailyTable, setShowDailyTable] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const storedListing = window.localStorage.getItem(LISTING_STORAGE_KEY);
      if (storedListing) {
        setListingData(JSON.parse(storedListing));
      }

      const storedReservations = window.localStorage.getItem(RESERVATION_STORAGE_KEY);
      if (storedReservations) {
        setReservations(JSON.parse(storedReservations) as Reservation[]);
      }

      setSurveyData(loadSurveyDataFromStorage());

      const storedKarte = getCompressedItem(KARTE_STORAGE_KEY);
      if (storedKarte) {
        try {
          const parsed = JSON.parse(storedKarte) as KarteRecord[];
          if (Array.isArray(parsed)) {
            setKarteRecords(parsed);
          }
        } catch (error) {
          console.error("Failed to parse karte records", error);
        }
      }
    } catch (error) {
      console.error("Failed to load correlation resources", error);
    }
  }, []);

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    listingData.forEach((category) => {
      if (
        category.category === "内科" ||
        category.category === "発熱外来" ||
        category.category === "胃カメラ" ||
        category.category === "大腸カメラ"
      ) {
        category.data.forEach((entry) => {
          const monthKey = getMonthKey(entry.date);
          if (monthKey) {
            months.add(monthKey);
          }
        });
      }
    });
    return Array.from(months).sort();
  }, [listingData]);

  const {
    startMonth,
    endMonth,
    setStartMonth,
    setEndMonth,
    resetPeriod,
  } = useAnalysisPeriodRange(availableMonths);

  const trueFirstAggregation = useMemo(
    () => buildTrueFirstAggregation(reservations, karteRecords),
    [reservations, karteRecords],
  );
  const listingAggregation = useMemo(
    () => buildListingAggregation(listingData),
    [listingData],
  );
  const surveyAggregation = useMemo(
    () => buildSurveyAggregation(surveyData),
    [surveyData],
  );

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
  }, [startMonth, endMonth]);

  useEffect(() => {
    setAnalysisPeriodLabel(correlationRangeLabel);
  }, [correlationRangeLabel]);

  const filteredDates = useMemo(() => {
    const dates = new Set<string>();

    let listingMap = listingAggregation.generalCvByDate;
    if (selectedSegment === "fever") listingMap = listingAggregation.feverCvByDate;
    if (
      selectedSegment === "endoscopy" ||
      selectedSegment === "endoscopy-stomach" ||
      selectedSegment === "endoscopy-colon"
    ) {
      listingMap = listingAggregation.endoscopyCvByDate;
    }

    listingMap.forEach((_, dateKey) => {
      const monthKey = dateKey.slice(0, 7);
      if (
        (!startMonth || monthKey >= startMonth) &&
        (!endMonth || monthKey <= endMonth)
      ) {
        dates.add(dateKey);
      }
    });

    // アンケートは endoscopy 系モードでは参照しない
    if (selectedSegment === "general" || selectedSegment === "fever") {
      const surveyMap =
        selectedSegment === "fever"
          ? surveyAggregation.feverGoogleByDate
          : surveyAggregation.generalGoogleByDate;
      surveyMap.forEach((_, dateKey) => {
        const monthKey = dateKey.slice(0, 7);
        if (
          (!startMonth || monthKey >= startMonth) &&
          (!endMonth || monthKey <= endMonth)
        ) {
          dates.add(dateKey);
        }
      });
    }

    if (selectedSegment === "general" || selectedSegment === "fever") {
      trueFirstAggregation.trueFirstCounts.forEach((_, dateKey) => {
        const monthKey = dateKey.slice(0, 7);
        if (
          (!startMonth || monthKey >= startMonth) &&
          (!endMonth || monthKey <= endMonth)
        ) {
          dates.add(dateKey);
        }
      });
      // 予約日も含めて日付セットを拡張（予約のみ存在する日の漏れ防止）
      trueFirstAggregation.reservationCounts.forEach((_, dateKey) => {
        const monthKey = dateKey.slice(0, 7);
        if (
          (!startMonth || monthKey >= startMonth) &&
          (!endMonth || monthKey <= endMonth)
        ) {
          dates.add(dateKey);
        }
      });
    } else {
      // 内視鏡は専用マップからも日付キーを拾う
      trueFirstAggregation.endoscopyFirstReservationByDate.forEach((_, dateKey) => {
        const monthKey = dateKey.slice(0, 7);
        if (
          (!startMonth || monthKey >= startMonth) &&
          (!endMonth || monthKey <= endMonth)
        ) {
          dates.add(dateKey);
        }
      });
    }

    return Array.from(dates).sort();
  }, [
    listingAggregation.feverCvByDate,
    listingAggregation.generalCvByDate,
    listingAggregation.endoscopyCvByDate,
    surveyAggregation.feverGoogleByDate,
    surveyAggregation.generalGoogleByDate,
    trueFirstAggregation.trueFirstCounts,
    trueFirstAggregation.reservationCounts,
    trueFirstAggregation.endoscopyFirstReservationByDate,
    selectedSegment,
    startMonth,
    endMonth,
  ]);

  const {
    hourlyChartData,
    listingSeries,
    trueFirstSeries,
    reservationsSeries,
    dailyChartData,
    surveyTotals,
  } = useMemo(() => {
    let listingMap = listingAggregation.generalCvByDate;
    if (selectedSegment === "fever") listingMap = listingAggregation.feverCvByDate;
    if (
      selectedSegment === "endoscopy" ||
      selectedSegment === "endoscopy-stomach" ||
      selectedSegment === "endoscopy-colon"
    ) {
      listingMap = listingAggregation.endoscopyCvByDate;
    }

    // アンケートは endoscopy 系モードでは使用しない
    const surveyMap =
      selectedSegment === "fever" || selectedSegment === "general"
        ? selectedSegment === "fever"
          ? surveyAggregation.feverGoogleByDate
          : surveyAggregation.generalGoogleByDate
        : new Map<string, number>();

    const trueFirstMap = trueFirstAggregation.trueFirstCounts;
    const reservationMap = trueFirstAggregation.reservationCounts;

    const hourlyBuckets = Array.from({ length: 24 }, () => ({
      listingCv: 0,
      trueFirst: 0,
      reservations: 0,
    }));

    const dailySeries: DailyChartPoint[] = [];
    let surveyTotal = 0;

    filteredDates.forEach((dateKey) => {
      const listingHourly = listingMap.get(dateKey);
      const trueFirstHourly = trueFirstMap.get(dateKey);
      const reservationHourly = reservationMap.get(dateKey);
      const surveyValue = surveyMap.get(dateKey) ?? 0;

      let listingDailyTotal = 0;
      let trueFirstDailyTotal = 0;
      let reservationDailyTotal = 0;

      for (let hour = 0; hour < 24; hour += 1) {
        const listingValue = listingHourly?.[hour] ?? 0;
        let trueFirstValue = 0;
        let reservationValue = 0;

        if (selectedSegment === "fever" || selectedSegment === "general") {
          trueFirstValue =
            trueFirstHourly?.[selectedSegment === "fever" ? "fever" : "general"]?.[
              hour
            ] ?? 0;
          reservationValue =
            reservationHourly?.[selectedSegment === "fever" ? "fever" : "general"]?.[
              hour
            ] ?? 0;
        } else {
          // 内視鏡は初診予約のみカウント（真の初診は使わない）
          const endoFirstResv = trueFirstAggregation.endoscopyFirstReservationByDate.get(dateKey);
          if (selectedSegment === "endoscopy") {
            trueFirstValue = (endoFirstResv?.stomach?.[hour] ?? 0) + (endoFirstResv?.colon?.[hour] ?? 0);
            reservationValue = trueFirstValue; // 初診予約数と同じ
          } else if (selectedSegment === "endoscopy-stomach") {
            trueFirstValue = endoFirstResv?.stomach?.[hour] ?? 0;
            reservationValue = trueFirstValue; // 初診予約数と同じ
          } else if (selectedSegment === "endoscopy-colon") {
            trueFirstValue = endoFirstResv?.colon?.[hour] ?? 0;
            reservationValue = trueFirstValue; // 初診予約数と同じ
          }
        }

        hourlyBuckets[hour].listingCv += listingValue;
        hourlyBuckets[hour].trueFirst += trueFirstValue;
        hourlyBuckets[hour].reservations += reservationValue;

        listingDailyTotal += listingValue;
        trueFirstDailyTotal += trueFirstValue;
        reservationDailyTotal += reservationValue;
      }

      surveyTotal += surveyValue;
      dailySeries.push({
        date: dateKey,
        listingCv: listingDailyTotal,
        trueFirst: trueFirstDailyTotal,
        surveyGoogle: surveyValue,
        reservations: reservationDailyTotal,
      });
    });

    const listingSeriesValues = hourlyBuckets.map((bucket) => bucket.listingCv);
    const trueFirstSeriesValues = hourlyBuckets.map((bucket) => bucket.trueFirst);
    const reservationsSeriesValues = hourlyBuckets.map((bucket) => bucket.reservations);

    const listingRatios = toPercentSeries(listingSeriesValues);
    const trueFirstRatios = toPercentSeries(trueFirstSeriesValues);
    const reservationRatios = toPercentSeries(reservationsSeriesValues);

    const hourlyData: HourlyChartPoint[] = hourlyBuckets.map((bucket, hour) => ({
      hour: `${hour}時`,
      listingCv: bucket.listingCv,
      listingRatio: listingRatios[hour],
      trueFirst: bucket.trueFirst,
      trueFirstRatio: trueFirstRatios[hour],
      reservations: bucket.reservations,
      reservationsRatio: Number(reservationRatios[hour].toFixed(1)),
    }));

    return {
      hourlyChartData: hourlyData,
      listingSeries: listingSeriesValues,
      trueFirstSeries: trueFirstSeriesValues,
      reservationsSeries: reservationsSeriesValues,
      dailyChartData: dailySeries.sort((a, b) => a.date.localeCompare(b.date)),
      surveyTotals: surveyTotal,
    };
  }, [
    filteredDates,
    listingAggregation.feverCvByDate,
    listingAggregation.generalCvByDate,
    listingAggregation.endoscopyCvByDate,
    surveyAggregation.feverGoogleByDate,
    surveyAggregation.generalGoogleByDate,
    trueFirstAggregation.trueFirstCounts,
    trueFirstAggregation.reservationCounts,
    trueFirstAggregation.endoscopyFirstReservationByDate,
    selectedSegment,
  ]);

  const lagCorrelations = useMemo(() => {
    return computeCrossCorrelation(listingSeries, trueFirstSeries, 12);
  }, [listingSeries, trueFirstSeries]);

  const peakLag = useMemo(() => {
    if (lagCorrelations.length === 0) {
      return { lag: 0, correlation: 0 };
    }
    return lagCorrelations.reduce((best, current) =>
      Math.abs(current.correlation) > Math.abs(best.correlation) ? current : best,
    );
  }, [lagCorrelations]);

  const dailyCorrelation = useMemo(() => {
    const listingTotals = dailyChartData.map((item) => item.listingCv);
    const trueFirstTotals = dailyChartData.map((item) => item.trueFirst);
    return calculateCorrelation(listingTotals, trueFirstTotals);
  }, [dailyChartData]);

  const scatterData = useMemo(() => {
    if (peakLag.correlation === 0) {
      return [];
    }
    const lag = peakLag.lag;
    const normalizedListing = toPercentSeries(listingSeries);
    const normalizedTrueFirst = toPercentSeries(trueFirstSeries);
    const points: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < normalizedListing.length; index += 1) {
      const shiftedIndex = index + lag;
      if (shiftedIndex < 0 || shiftedIndex >= normalizedTrueFirst.length) {
        continue;
      }
      points.push({
        x: normalizedListing[index],
        y: normalizedTrueFirst[shiftedIndex],
      });
    }
    return points;
  }, [peakLag, listingSeries, trueFirstSeries]);

  const totalListing = sum(listingSeries);
  const totalTrueFirst = sum(trueFirstSeries);
  const totalReservations = sum(reservationsSeries);
  const googleShare =
    (selectedSegment === "general" || selectedSegment === "fever") && totalTrueFirst > 0
      ? (surveyTotals / totalTrueFirst) * 100
      : 0;

  // 内視鏡モードかどうか
  const isEndoscopyMode =
    selectedSegment === "endoscopy" ||
    selectedSegment === "endoscopy-stomach" ||
    selectedSegment === "endoscopy-colon";

  // グラフラベル用
  const trueFirstLabel = isEndoscopyMode ? "初診予約" : "真の初診";
  const trueFirstLabelWithCount = isEndoscopyMode ? "初診予約件数" : "真の初診件数";

  const hasData =
    filteredDates.length > 0 &&
    (totalListing > 0 || totalTrueFirst > 0 || totalReservations > 0);

  const evaluationSummary = useMemo(() => {
    const lagDirection =
      peakLag.lag === 0
        ? "ほぼ同時"
        : peakLag.lag > 0
          ? `${peakLag.lag}時間後に${trueFirstLabel}が伸びています`
          : `${Math.abs(peakLag.lag)}時間前から${trueFirstLabel}が立ち上がっています`;
    const googleSentence =
      googleShare >= 20
        ? `Google流入は${trueFirstLabel}の約${googleShare.toFixed(1)}%を占めており、施策の寄与が高い状態です。`
        : `Google流入は${trueFirstLabel}の約${googleShare.toFixed(1)}%に留まっており、さらなる強化余地があります。`;
    const alignment =
      dailyCorrelation >= 0.5
        ? "日次推移も概ね同じ動きです。"
        : "日次推移はばらつきがあり、曜日要因などの影響が考えられます。";
    return {
      headline: `${SEGMENT_LABEL[selectedSegment]}は ${correlationLevel(peakLag.correlation).label}（r=${peakLag.correlation.toFixed(2)}）です。`,
      lag: lagDirection,
      googleSentence,
      alignment,
    };
  }, [selectedSegment, peakLag, googleShare, dailyCorrelation, trueFirstLabel]);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-12">
        <section className="rounded-3xl border border-brand-200 bg-gradient-to-br from-white via-brand-50 to-brand-100 p-8 shadow-card">
          <p className="text-sm font-semibold text-brand-600">
            Google Search × Listing × 新規予約
          </p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900 md:text-4xl">
            チャネル横断 相関分析ダッシュボード
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600">
            アンケートで「初めて来院」と回答した Google 流入と、リスティング広告の CV、
            真の初診（氏名ベース照合）を一括で可視化します。時間帯と日次の相関・ラグを確認して、
            訴求別の寄与やタイミングを把握しましょう。
          </p>
        </section>

        {/* データロード状況表示 */}
        <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-blue-900">データ読み込み状況</h2>
          <div className="mt-3 grid gap-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-blue-700">予約ログ:</span>
              <span className="font-mono text-blue-900">
                {reservations.length}件
                {reservations.length === 0 && " ⚠️ データがありません"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-blue-700">リスティングデータ:</span>
              <span className="font-mono text-blue-900">
                {listingData.reduce((sum, cat) => sum + cat.data.length, 0)}件
                {listingData.length === 0 && " ⚠️ データがありません"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-blue-700">アンケートデータ:</span>
              <span className="font-mono text-blue-900">
                {surveyData.length}件
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-blue-700">カルテデータ:</span>
              <span className="font-mono text-blue-900">
                {karteRecords.length}件
              </span>
            </div>
          </div>
          {(reservations.length === 0 || listingData.length === 0) && (
            <p className="mt-3 text-xs text-blue-700">
              💡 データが0件の場合は、
              <a href="/patients#data-management-panel" className="font-semibold underline">
                データ管理パネル
              </a>
              からCSVをアップロードしてください。
            </p>
          )}
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

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-slate-700">診療モード:</span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                "general",
                "fever",
                "endoscopy",
                "endoscopy-stomach",
                "endoscopy-colon",
              ] as SegmentKey[]
            ).map((segment) => (
              <button
                key={segment}
                onClick={() => setSelectedSegment(segment)}
                className={[
                  "rounded-full border px-4 py-2 text-sm font-semibold transition",
                  selectedSegment === segment
                    ? "border-brand-400 bg-brand-500 text-white shadow"
                    : "border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:text-brand-600",
                ].join(" ")}
              >
                {SEGMENT_LABEL[segment]}
              </button>
            ))}
          </div>
        </div>

        {!hasData && (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 px-8 py-16 text-center text-sm text-slate-500">
            分析に必要なリスティング・アンケート・予約データが不足しています。
            「患者分析」ページのデータ管理から各CSVを取り込み、再度このページを開いてください。
          </div>
        )}

        {hasData && (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  ベストラグ
                </p>
                <p className="mt-2 text-3xl font-bold text-slate-900">
                  {peakLag.lag > 0 ? `+${peakLag.lag}h` : `${peakLag.lag}h`}
                </p>
                <p className="text-xs text-slate-500">
                  リスティング CV が {Math.abs(peakLag.lag)} 時間{" "}
                  {peakLag.lag >= 0 ? "後" : "前"}に{trueFirstLabel}と最も同期
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  最大相関（ラグ補正）
                </p>
                <p className={`mt-2 text-3xl font-bold ${correlationLevel(peakLag.correlation).color}`}>
                  {peakLag.correlation.toFixed(3)}
                </p>
                <p className="text-xs text-slate-500">
                  {correlationLevel(peakLag.correlation).label}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  日次相関
                </p>
                <p className={`mt-2 text-3xl font-bold ${correlationLevel(dailyCorrelation).color}`}>
                  {dailyCorrelation.toFixed(3)}
                </p>
                <p className="text-xs text-slate-500">
                  日別合計ベースの結び付き
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Google 経由シェア
                </p>
                <p className="mt-2 text-3xl font-bold text-slate-900">
                  {googleShare.toFixed(1)}%
                </p>
                <p className="text-xs text-slate-500">
                  アンケート Google / {trueFirstLabel}
                </p>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    時間帯別の重ね合わせ
                  </h2>
                  <p className="text-xs text-slate-500">
                    リスティング CV（棒）・{trueFirstLabel}（線）・予約総数（点線）を 24 時間で比較
                  </p>
                </div>
              </div>
              <div className="h-80 w-full">
                <ResponsiveContainer>
                  <ComposedChart data={hourlyChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="hour" />
                    <YAxis
                      yAxisId="left"
                      label={{ value: "件数", angle: -90, position: "insideLeft" }}
                      allowDecimals={false}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      label={{ value: "構成比(%)", angle: 90, position: "insideRight" }}
                    />
                    <Tooltip />
                    <Legend />
                    <Bar
                      yAxisId="left"
                      dataKey="listingCv"
                      name="リスティングCV件数"
                      fill="#2563eb"
                      opacity={0.8}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      strokeWidth={2}
                      dataKey="trueFirst"
                      name={trueFirstLabelWithCount}
                      stroke="#f97316"
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      strokeDasharray="4 4"
                      dataKey="reservationsRatio"
                      name="予約構成比"
                      stroke="#64748b"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="grid gap-6 xl:grid-cols-[2fr_1fr]">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
                <h2 className="text-lg font-semibold text-slate-900">ラグ相関の推移</h2>
                <p className="text-xs text-slate-500">
                  -12〜+12 時間の範囲で CV→{trueFirstLabel}の結び付きを計測
                </p>
                <div className="mt-4 h-64 w-full">
                  <ResponsiveContainer>
                    <LineChart data={lagCorrelations}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="lag"
                        tickFormatter={(value) => `${value}h`}
                      />
                      <YAxis domain={[-1, 1]} />
                      <Tooltip formatter={(value: number) => value.toFixed(3)} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="correlation"
                        stroke="#2563eb"
                        strokeWidth={2}
                        dot={false}
                        name="相関係数"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
                <h2 className="text-lg font-semibold text-slate-900">散布図（最適ラグ）</h2>
                <p className="text-xs text-slate-500">
                  最も相関が高かったラグでの CV割合 vs {trueFirstLabel}割合
                </p>
                <div className="mt-4 h-64 w-full">
                  <ResponsiveContainer>
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        type="number"
                        dataKey="x"
                        name="CV割合"
                        unit="%"
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        name={`${trueFirstLabel}割合`}
                        unit="%"
                      />
                      <Tooltip
                        formatter={(value: number) => `${value.toFixed(1)}%`}
                      />
                      <Scatter data={scatterData} fill="#f97316" />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-brand-200 bg-white/80 p-6 shadow-soft">
              <h2 className="text-lg font-semibold text-slate-900">簡易評価</h2>
              <p className="mt-2 text-sm text-slate-600">{evaluationSummary.headline}</p>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                <li>・{evaluationSummary.lag}</li>
                <li>・{evaluationSummary.googleSentence}</li>
                <li>・{evaluationSummary.alignment}</li>
              </ul>
              <p className="mt-3 text-xs text-slate-400">
                ※ 指標は現時点の集計に基づきます。CSVを更新した場合は再読み込みしてください。
              </p>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft">
              <h2 className="text-lg font-semibold text-slate-900">
                日次の指標比較
              </h2>
              <p className="text-xs text-slate-500">
                {isEndoscopyMode
                  ? `リスティングCVと${trueFirstLabelWithCount}を日次で比較`
                  : `リスティングCVと${trueFirstLabelWithCount}、アンケート上の Google 回答を日次で比較`}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="h-72 w-full xl:h-80">
                  <ResponsiveContainer>
                    <ComposedChart data={dailyChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" />
                      <YAxis yAxisId="left" allowDecimals={false} />
                      <YAxis yAxisId="right" orientation="right" allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar
                        yAxisId="left"
                        dataKey="listingCv"
                        name="リスティングCV"
                        fill="#2563eb"
                        opacity={0.75}
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="trueFirst"
                        name={trueFirstLabel}
                        stroke="#f97316"
                        strokeWidth={2}
                      />
                      {!isEndoscopyMode && (
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="surveyGoogle"
                          name="アンケート Google 回答"
                          stroke="#10b981"
                          strokeWidth={2}
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDailyTable((value) => !value)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-brand-200 hover:text-brand-600"
                >
                  {showDailyTable ? "日次一覧を閉じる" : "日次一覧を表示"}
                </button>
              </div>
            </section>

            {showDailyTable && (
              <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                          日付
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                          リスティングCV
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {trueFirstLabel}
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                          予約総数
                        </th>
                        {!isEndoscopyMode && (
                          <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Google 回答
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {dailyChartData.map((row) => (
                        <tr key={row.date}>
                          <td className="px-4 py-2 text-sm text-slate-600">
                            {row.date}
                          </td>
                          <td className="px-4 py-2 text-right text-sm font-medium text-slate-900">
                            {row.listingCv.toLocaleString("ja-JP")}
                          </td>
                          <td className="px-4 py-2 text-right text-sm text-slate-600">
                            {row.trueFirst.toLocaleString("ja-JP")}
                          </td>
                          <td className="px-4 py-2 text-right text-sm text-slate-600">
                            {row.reservations.toLocaleString("ja-JP")}
                          </td>
                          {!isEndoscopyMode && (
                            <td className="px-4 py-2 text-right text-sm text-slate-600">
                              {row.surveyGoogle.toLocaleString("ja-JP")}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
