'use client';

import { useEffect, useMemo, useState } from "react";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AnalysisFilterPortal } from "@/components/AnalysisFilterPortal";
import { useAnalysisPeriodRange } from "@/hooks/useAnalysisPeriodRange";
import { setAnalysisPeriodLabel } from "@/lib/analysisPeriod";
import {
  buildIncrementalityDataset,
  computeDistributedLagEffect,
  computeLagCorrelations,
  type IncrementalityDataset,
  type LagCorrelationPoint,
  type SegmentDataset,
  type SegmentKey,
} from "@/lib/correlationData";
import type { ListingCategoryData } from "@/lib/listingData";
import { LISTING_STORAGE_KEY } from "@/lib/listingData";
import type { KarteRecord } from "@/lib/karteAnalytics";
import type { Reservation } from "@/lib/reservationData";
import { RESERVATION_STORAGE_KEY } from "@/lib/reservationData";
import { KARTE_STORAGE_KEY } from "@/lib/storageKeys";
import { getCompressedItem } from "@/lib/storageCompression";
import type { SurveyData } from "@/lib/surveyData";
import { loadSurveyDataFromStorage } from "@/lib/surveyData";

type SummaryMetric = {
  label: string;
  value: string;
  helper?: string;
};

type EffectSummary = {
  status: "positive" | "moderate" | "weak" | "negative" | "unknown";
  headline: string;
  message: string;
  badge: string;
};

type SanityRow = {
  date: string;
  listingCv: number;
  trueFirst: number;
  gapCvVsTrue: number;
  surveyGoogle: number;
  surveyGap: number;
};

const SEGMENT_LABEL: Record<SegmentKey, string> = {
  all: "全体",
  general: "総合診療・内科",
  fever: "発熱外来",
  endoscopy: "内視鏡",
};

const SEGMENT_ORDER: SegmentKey[] = ["fever", "general", "endoscopy", "all"];

const formatNumber = (value: number, fractionDigits = 0) =>
  value.toLocaleString("ja-JP", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

const formatPercent = (value: number, fractionDigits = 1) =>
  `${(value * 100).toFixed(fractionDigits)}%`;

const inMonthRange = (monthKey: string, start?: string, end?: string): boolean => {
  if (start && monthKey < start) {
    return false;
  }
  if (end && monthKey > end) {
    return false;
  }
  return true;
};

const buildSanityRows = (daily: SegmentDataset["daily"]): SanityRow[] =>
  daily
    .map((item) => ({
      date: item.date,
      listingCv: item.listingCv,
      trueFirst: item.trueFirst,
      gapCvVsTrue: item.listingCv - item.trueFirst,
      surveyGoogle: item.surveyGoogle,
      surveyGap: item.surveyGoogle - item.trueFirst,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

const selectTopLag = (correlations: LagCorrelationPoint[]): LagCorrelationPoint | null => {
  if (correlations.length === 0) {
    return null;
  }
  return correlations.reduce((best, current) =>
    Math.abs(current.correlation) > Math.abs(best.correlation) ? current : best,
  );
};

const correlationLevel = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 0.7) {
    return { label: "強い", className: "text-emerald-600" };
  }
  if (abs >= 0.4) {
    return { label: "中程度", className: "text-blue-600" };
  }
  if (abs >= 0.2) {
    return { label: "弱い", className: "text-amber-600" };
  }
  return { label: "ほぼなし", className: "text-slate-500" };
};

const EFFECT_THEME: Record<EffectSummary["status"], string> = {
  positive: "border-emerald-200 bg-emerald-50 text-emerald-900",
  moderate: "border-blue-200 bg-blue-50 text-blue-900",
  weak: "border-amber-200 bg-amber-50 text-amber-900",
  negative: "border-rose-200 bg-rose-50 text-rose-900",
  unknown: "border-slate-200 bg-slate-50 text-slate-700",
};

const ensureDataset = (
  dataset: IncrementalityDataset | null,
  segment: SegmentKey,
): SegmentDataset | null => {
  if (!dataset) {
    return null;
  }
  return dataset.segments[segment] ?? null;
};

export default function CorrelationPage(): JSX.Element {
  const [listingData, setListingData] = useState<ListingCategoryData[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [surveyData, setSurveyData] = useState<SurveyData[]>([]);
  const [karteRecords, setKarteRecords] = useState<KarteRecord[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<SegmentKey>("fever");
  const [showSanityTable, setShowSanityTable] = useState(false);

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

      const compressedKarte = getCompressedItem(KARTE_STORAGE_KEY);
      if (compressedKarte) {
        const parsed = JSON.parse(compressedKarte) as KarteRecord[];
        if (Array.isArray(parsed)) {
          setKarteRecords(parsed);
        }
      }
    } catch (error) {
      console.error("Failed to load correlation resources", error);
    }
  }, []);

  const incrementalityDataset = useMemo<IncrementalityDataset | null>(() => {
    try {
      return buildIncrementalityDataset(reservations, karteRecords, listingData, surveyData);
    } catch (error) {
      console.error("Failed to build incrementality dataset", error);
      return null;
    }
  }, [reservations, karteRecords, listingData, surveyData]);

  const availableMonths = useMemo(() => {
    if (!incrementalityDataset) {
      return [] as string[];
    }
    const monthSet = new Set<string>();
    Object.values(incrementalityDataset.segments).forEach((segment) => {
      segment.daily.forEach((day) => {
        monthSet.add(day.date.slice(0, 7));
      });
    });
    return Array.from(monthSet).sort();
  }, [incrementalityDataset]);

  const { startMonth, endMonth, setStartMonth, setEndMonth, resetPeriod } =
    useAnalysisPeriodRange(availableMonths);

  const periodLabel = useMemo(() => {
    if (startMonth && endMonth && startMonth === endMonth) {
      return startMonth;
    }
    if (startMonth && endMonth) {
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

  const filteredSegmentDataset = useMemo(() => {
    const target = ensureDataset(incrementalityDataset, selectedSegment);
    if (!target) {
      return null;
    }
    const hourly = target.hourly.filter((item) =>
      inMonthRange(item.date.slice(0, 7), startMonth, endMonth),
    );
    const daily = target.daily.filter((item) =>
      inMonthRange(item.date.slice(0, 7), startMonth, endMonth),
    );
    const totals = daily.reduce(
      (acc, item) => {
        acc.reservations += item.reservations;
        acc.trueFirst += item.trueFirst;
        acc.listingCv += item.listingCv;
        acc.surveyGoogle += item.surveyGoogle;
        return acc;
      },
      { reservations: 0, trueFirst: 0, listingCv: 0, surveyGoogle: 0 },
    );
    return {
      hourly,
      daily,
      totals,
    };
  }, [incrementalityDataset, selectedSegment, startMonth, endMonth]);

  useEffect(() => {
    setAnalysisPeriodLabel(periodLabel);
  }, [periodLabel]);

  const sanityRows = useMemo<SanityRow[]>(() => {
    if (!filteredSegmentDataset) {
      return [];
    }
    return buildSanityRows(filteredSegmentDataset.daily);
  }, [filteredSegmentDataset]);

  const lagCorrelations = useMemo<LagCorrelationPoint[]>(() => {
    if (!filteredSegmentDataset) {
      return [];
    }
    return computeLagCorrelations(filteredSegmentDataset.hourly, 48);
  }, [filteredSegmentDataset]);

  const peakLag = useMemo(() => selectTopLag(lagCorrelations), [lagCorrelations]);

  const distributedLag = useMemo(() => {
    if (!filteredSegmentDataset) {
      return null;
    }
    return computeDistributedLagEffect(filteredSegmentDataset.hourly, 24);
  }, [filteredSegmentDataset]);

  const summaryMetrics = useMemo<SummaryMetric[]>(() => {
    if (!filteredSegmentDataset) {
      return [
        { label: "データなし", value: "—" },
      ];
    }

    const { totals } = filteredSegmentDataset;
    const totalCv = totals.listingCv;
    const totalTrueFirst = totals.trueFirst;
    const ratio = totalCv > 0 ? totalTrueFirst / totalCv : 0;
    const coverage = totals.surveyGoogle > 0 ? totalTrueFirst / totals.surveyGoogle : 0;

    const metrics: SummaryMetric[] = [
      {
        label: "総真の初診",
        value: `${formatNumber(totalTrueFirst)} 件`,
      },
      {
        label: "総広告CV",
        value: `${formatNumber(totalCv)} 件`,
      },
      {
        label: "CV→新患比率",
        value: totalCv > 0 ? formatPercent(ratio) : "—",
      },
      {
        label: "Google上限比",
        value: totals.surveyGoogle > 0 ? formatPercent(coverage) : "—",
        helper: totals.surveyGoogle > 0 ? `${formatNumber(totals.surveyGoogle)} 回回答` : undefined,
      },
    ];

    if (peakLag) {
      metrics.push({
        label: "ピークラグ",
        value: `${peakLag.lag} 時間`,
        helper: `${correlationLevel(peakLag.correlation).label} (${formatPercent(Math.abs(peakLag.correlation), 1)})`,
      });
    }

    if (distributedLag) {
      metrics.push({
        label: "推定増分 (CV1件あたり)",
        value: `${distributedLag.totalEffect.toFixed(2)} 件`,
        helper: `R²=${distributedLag.rSquared.toFixed(2)} / サンプル=${distributedLag.sampleSize}`,
      });
    }

    return metrics;
  }, [filteredSegmentDataset, peakLag, distributedLag]);

  const hourlyChartData = useMemo(() => {
    if (!filteredSegmentDataset) {
      return [] as Array<{ hour: string; listingCv: number; trueFirst: number }>;
    }
    return filteredSegmentDataset.hourly.map((point) => ({
      hour: point.isoHour,
      listingCv: point.listingCv,
      trueFirst: point.trueFirst,
    }));
  }, [filteredSegmentDataset]);

  const dailyChartData = useMemo(() => {
    if (!filteredSegmentDataset) {
      return [] as Array<{ date: string; listingCv: number; trueFirst: number; surveyGoogle: number }>;
    }
    return filteredSegmentDataset.daily.map((point) => ({
      date: point.date,
      listingCv: point.listingCv,
      trueFirst: point.trueFirst,
      surveyGoogle: point.surveyGoogle,
    }));
  }, [filteredSegmentDataset]);

  const lagDisplay = useMemo(() => {
    if (lagCorrelations.length === 0) {
      return [] as LagCorrelationPoint[];
    }
    return lagCorrelations.slice(0, 12).sort((a, b) => Math.abs(b.lag) - Math.abs(a.lag));
  }, [lagCorrelations]);

  const hasData = Boolean(filteredSegmentDataset && (filteredSegmentDataset.hourly.length > 0 || filteredSegmentDataset.daily.length > 0));

  const effectSummary = useMemo<EffectSummary>(() => {
    if (!filteredSegmentDataset) {
      return {
        status: "unknown",
        headline: "データが不足しています",
        message: "予約・広告・アンケートのCSVをアップロードしてからご確認ください。",
        badge: "NO DATA",
      };
    }

    const { totals } = filteredSegmentDataset;
    const totalCv = totals.listingCv;
    const totalTrueFirst = totals.trueFirst;
    const ratio = totalCv > 0 ? totalTrueFirst / totalCv : 0;
    const coverage = totals.surveyGoogle > 0 ? totalTrueFirst / totals.surveyGoogle : 0;

    const renderMessage = (base: string) => {
      const parts: string[] = [base];
      if (totalCv > 0) {
        parts.push(`CV→新患比率 ${formatPercent(ratio, 1)}`);
      }
      if (totals.surveyGoogle > 0) {
        parts.push(`Google上限比 ${formatPercent(coverage, 1)}`);
      }
      return parts.join(" / " );
    };

    if (distributedLag) {
      const lift = distributedLag.totalEffect;
      if (lift >= 0.5) {
        return {
          status: "positive",
          headline: "広告が明確に新患を押し上げています",
          message: renderMessage(`推定増分 ${lift.toFixed(2)} 件/ CV1件`),
          badge: "EFFECTIVE",
        };
      }
      if (lift >= 0.2) {
        return {
          status: "moderate",
          headline: "広告の寄与は中程度です",
          message: renderMessage(`推定増分 ${lift.toFixed(2)} 件/ CV1件`),
          badge: "MODERATE",
        };
      }
      if (lift > 0.05) {
        return {
          status: "weak",
          headline: "広告による純増は小さめです",
          message: renderMessage(`推定増分 ${lift.toFixed(2)} 件/ CV1件`),
          badge: "WEAK",
        };
      }
      if (lift <= 0) {
        return {
          status: "negative",
          headline: "広告CVが新患増に結び付いていません",
          message: renderMessage(`推定増分 ${lift.toFixed(2)} 件/ CV1件`),
          badge: "NO LIFT",
        };
      }
      return {
        status: "weak",
        headline: "広告の寄与は限定的です",
        message: renderMessage(`推定増分 ${lift.toFixed(2)} 件/ CV1件`),
        badge: "LIMITED",
      };
    }

    if (totalCv === 0) {
      return {
        status: "unknown",
        headline: "広告CVがありません",
        message: "CVを計測できるようにタグ設定をご確認ください。",
        badge: "NO CV",
      };
    }

    if (ratio >= 0.7) {
      return {
        status: "positive",
        headline: "広告CVが新患に強く結び付いています",
        message: renderMessage("CVの多くが純新規につながっています"),
        badge: "LIKELY EFFECTIVE",
      };
    }
    if (ratio >= 0.4) {
      return {
        status: "moderate",
        headline: "広告CVは一部新患に寄与しています",
        message: renderMessage("更なる検証で増分を確かめましょう"),
        badge: "NEEDS REVIEW",
      };
    }
    if (ratio > 0) {
      return {
        status: "weak",
        headline: "広告CVの多くが新患化していません",
        message: renderMessage("CV定義や計測内容を見直してください"),
        badge: "LOW IMPACT",
      };
    }
    return {
      status: "unknown",
      headline: "評価できるデータが不足しています",
      message: "CSVの期間や内容をご確認ください。",
      badge: "NEEDS DATA",
    };
  }, [filteredSegmentDataset, distributedLag]);

  const handleChangeStart = (value: string) => {
    setStartMonth(value);
  };

  const handleChangeEnd = (value: string) => {
    setEndMonth(value);
  };


  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-12">
        <section className="relative overflow-hidden rounded-3xl border border-brand-200 bg-gradient-to-r from-white via-sky-50 to-blue-100 p-8 shadow-card">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-4">
              <p className="text-sm font-semibold text-brand-600">Correlation & Incrementality</p>
              <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">
                相関分析とインクリメンタリティ評価
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                広告CVと真の初診（純新規患者）の動きを時系列で突き合わせ、サニティチェックからラグ相関、分布ラグ推定まで一貫して確認できます。
                「たまたま同時に動いているだけ」を排除し、広告が実際にどれだけ新患を増やしたかを把握するためのビューです。
              </p>
              <div className="rounded-2xl border border-sky-200 bg-white/80 p-4">
                <p className="text-sm font-semibold text-slate-800">この画面で確認できること</p>
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  <li>• 真の初診と広告CVの時間帯・日次推移</li>
                  <li>• Googleアンケート上限との乖離とCVの質</li>
                  <li>• ラグ相関による先行度合いと分布ラグ推定による増分効果</li>
                </ul>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex w-full flex-col gap-1 rounded-2xl border border-dashed border-slate-200 bg-white/80 px-4 py-3 text-xs text-slate-700 sm:w-[320px]">
                <span className="font-semibold text-slate-800">データのアップロード</span>
                <p className="leading-relaxed">
                  予約ログ・リスティング・アンケートのCSVは「患者分析 &gt; データ管理」から登録してください。登録後にこのページを開くと最新値が反映されます。
                </p>
              </div>
            </div>
          </div>
        </section>

        <AnalysisFilterPortal
          months={availableMonths}
          startMonth={startMonth}
          endMonth={endMonth}
          onChangeStart={handleChangeStart}
          onChangeEnd={handleChangeEnd}
          onReset={availableMonths.length > 0 ? resetPeriod : undefined}
          label={periodLabel}
        />

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <span className="text-xs font-semibold text-slate-500">対象セグメント</span>
          <div className="flex flex-wrap gap-1">
            {SEGMENT_ORDER.map((segment) => (
              <button
                key={segment}
                type="button"
                onClick={() => setSelectedSegment(segment)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${selectedSegment === segment ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}
              >
                {SEGMENT_LABEL[segment]}
              </button>
            ))}
          </div>
        </div>

        <section className={`rounded-2xl border px-6 py-5 shadow-sm transition ${EFFECT_THEME[effectSummary.status]}`}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide">増分評価</p>
              <h2 className="mt-1 text-lg font-bold">{effectSummary.headline}</h2>
              <p className="mt-1 text-sm">{effectSummary.message}</p>
            </div>
            <span className="inline-flex items-center self-start rounded-full border border-white/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide md:self-center">{effectSummary.badge}</span>
          </div>
        </section>

        {!hasData ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-12 text-center text-slate-500">
            対象期間に一致するデータがありません。予約・広告・アンケートのCSVをアップロードしてください。
          </div>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {summaryMetrics.map((metric) => (
                <div key={metric.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-semibold text-slate-500">{metric.label}</div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">{metric.value}</div>
                  {metric.helper ? (
                    <div className="mt-1 text-xs text-slate-500">{metric.helper}</div>
                  ) : null}
                </div>
              ))}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">時間帯別の推移</h2>
              <p className="mt-1 text-sm text-slate-500">
                広告CVと真の初診の時間帯推移を重ねています。ラグがある場合は、ピークラグの値を参考に読み替えてください。
              </p>
              <div className="mt-4 h-72 w-full">
                <ResponsiveContainer>
                  <LineChart data={hourlyChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="hour"
                      tickFormatter={(value) => value.slice(5, 16)}
                      minTickGap={24}
                      stroke="#475569"
                    />
                    <YAxis stroke="#475569" allowDecimals={false} />
                    <Tooltip
                      formatter={(value: number) => `${value.toLocaleString("ja-JP")}`}
                      labelFormatter={(label) => label.replace("T", " ")}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="listingCv" name="広告CV" stroke="#2563eb" dot={false} />
                    <Line type="monotone" dataKey="trueFirst" name="真の初診" stroke="#16a34a" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">日次の整合性</h2>
              <p className="mt-1 text-sm text-slate-500">
                CVと真の初診の差分、アンケート上限とのギャップを日次で確認できます。乖離の大きい日を優先的にチェックしてください。
              </p>
              <div className="mt-4 h-72 w-full">
                <ResponsiveContainer>
                  <BarChart data={dailyChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" stroke="#475569" minTickGap={24} />
                    <YAxis stroke="#475569" allowDecimals={false} />
                    <Tooltip formatter={(value: number) => `${value.toLocaleString("ja-JP")}`} />
                    <Legend />
                    <Bar dataKey="listingCv" name="広告CV" fill="#3b82f6" />
                    <Bar dataKey="trueFirst" name="真の初診" fill="#10b981" />
                    <Bar dataKey="surveyGoogle" name="アンケート(Google)" fill="#f97316" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <button
                type="button"
                onClick={() => setShowSanityTable((prev) => !prev)}
                className="mt-4 text-sm text-blue-600 hover:underline"
              >
                {showSanityTable ? "整合性テーブルを隠す" : "日次テーブルを表示"}
              </button>
              {showSanityTable ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2">日付</th>
                        <th className="px-3 py-2 text-right">広告CV</th>
                        <th className="px-3 py-2 text-right">真の初診</th>
                        <th className="px-3 py-2 text-right">差分(CV-真)</th>
                        <th className="px-3 py-2 text-right">アンケート(Google)</th>
                        <th className="px-3 py-2 text-right">差分(アンケート-真)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sanityRows.map((row) => (
                        <tr key={row.date} className="border-b border-slate-100">
                          <td className="px-3 py-2 text-slate-700">{row.date}</td>
                          <td className="px-3 py-2 text-right text-slate-900">{formatNumber(row.listingCv)}</td>
                          <td className="px-3 py-2 text-right text-slate-900">{formatNumber(row.trueFirst)}</td>
                          <td className={`px-3 py-2 text-right ${row.gapCvVsTrue >= 0 ? "text-slate-900" : "text-rose-600"}`}>
                            {formatNumber(row.gapCvVsTrue)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-900">{formatNumber(row.surveyGoogle)}</td>
                          <td className={`px-3 py-2 text-right ${row.surveyGap >= 0 ? "text-slate-900" : "text-rose-600"}`}>
                            {formatNumber(row.surveyGap)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>

            <section className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">ラグ相関</h2>
                <p className="mt-1 text-sm text-slate-500">
                  広告CVの発生が真の初診をどの程度先導しているかを、±48時間のラグで相関分析しています。
                </p>
                {lagCorrelations.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">分析可能なデータが足りません。</p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-2">ラグ(時間)</th>
                          <th className="px-3 py-2 text-right">相関係数</th>
                          <th className="px-3 py-2 text-right">水準</th>
                          <th className="px-3 py-2 text-right">サンプル</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lagDisplay.map((row) => {
                          const level = correlationLevel(row.correlation);
                          return (
                            <tr key={row.lag} className="border-b border-slate-100">
                              <td className="px-3 py-2 text-slate-700">{row.lag}</td>
                              <td className="px-3 py-2 text-right text-slate-900">{formatPercent(row.correlation, 1)}</td>
                              <td className={`px-3 py-2 text-right text-xs font-semibold ${level.className}`}>
                                {level.label}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-500">{formatNumber(row.pairedSamples)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">分布ラグ推定</h2>
                <p className="mt-1 text-sm text-slate-500">
                  過去24時間の広告CVを説明変数にとり、Poisson近似の線形回帰で真の初診の増分を推定しています。
                </p>
                {!distributedLag ? (
                  <p className="mt-4 text-sm text-slate-500">推定に十分なデータがありません。</p>
                ) : (
                  <ul className="mt-4 space-y-2 text-sm text-slate-700">
                    <li>
                      <span className="font-semibold text-slate-900">CV1件あたりの推定増分:</span>{" "}
                      {distributedLag.totalEffect.toFixed(2)} 件
                    </li>
                    <li>
                      <span className="font-semibold text-slate-900">モデル適合:</span>{" "}
                      R²={distributedLag.rSquared.toFixed(2)}, サンプル={formatNumber(distributedLag.sampleSize)}
                    </li>
                    <li>
                      <span className="font-semibold text-slate-900">主なラグ寄与:</span>
                      <div className="mt-1 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                        {distributedLag.coefficients
                          .map((coef, index) => ({ lag: index - 1, value: coef }))
                          .filter((item) => item.lag >= 0)
                          .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
                          .slice(0, 5)
                          .map((item) => (
                            <div key={item.lag} className="flex justify-between">
                              <span>{item.lag} 時間前</span>
                              <span>{item.value.toFixed(2)}</span>
                            </div>
                          ))}
                      </div>
                    </li>
                  </ul>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
