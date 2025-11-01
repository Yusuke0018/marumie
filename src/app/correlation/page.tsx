'use client';

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock,
  LineChart,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AnalysisFilterPortal } from "@/components/AnalysisFilterPortal";
import { ChartCard } from "@/components/correlation/ChartCard";
import { EffectBanner } from "@/components/correlation/EffectBanner";
import { MetricCard } from "@/components/correlation/MetricCard";
import { TabNavigation, type Tab, type TabId } from "@/components/correlation/TabNavigation";
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

const TABS: Tab[] = [
  { id: 'summary', label: 'サマリー', icon: <TrendingUp className="h-4 w-4" /> },
  { id: 'analysis', label: '詳細分析', icon: <BarChart3 className="h-4 w-4" /> },
  { id: 'quality', label: 'データ品質', icon: <CheckCircle2 className="h-4 w-4" /> },
];

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
  const [activeTab, setActiveTab] = useState<TabId>('summary');
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
    return lagCorrelations.slice(0, 12).sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
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
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-cyan-50/30">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-12">
        {/* Hero Header */}
        <section className="relative overflow-hidden rounded-3xl border border-blue-200 bg-gradient-to-r from-white via-blue-50 to-cyan-100 p-8 shadow-xl">
          <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-gradient-to-br from-blue-400/20 to-cyan-400/20 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-gradient-to-tr from-cyan-400/20 to-blue-400/20 blur-3xl" />

          <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Activity className="h-6 w-6 text-blue-600" />
                <p className="text-sm font-bold uppercase tracking-wider text-blue-600">Correlation & Incrementality</p>
              </div>
              <h1 className="text-4xl font-bold text-slate-900 md:text-5xl">
                相関分析とインクリメンタリティ評価
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-slate-700">
                広告CVと真の初診（純新規患者）の動きを時系列で突き合わせ、サニティチェックからラグ相関、分布ラグ推定まで一貫して確認できます。
              </p>
              <div className="rounded-2xl border border-blue-200 bg-white/90 p-5 shadow-sm backdrop-blur-sm">
                <p className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Zap className="h-4 w-4 text-blue-600" />
                  この画面で確認できること
                </p>
                <ul className="space-y-2 text-sm text-slate-700">
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-blue-600">•</span>
                    <span>真の初診と広告CVの時間帯・日次推移</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-blue-600">•</span>
                    <span>Googleアンケート上限との乖離とCVの質</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-blue-600">•</span>
                    <span>ラグ相関による先行度合いと分布ラグ推定による増分効果</span>
                  </li>
                </ul>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex w-full flex-col gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/90 px-5 py-4 text-xs text-slate-700 backdrop-blur-sm sm:w-[320px]">
                <span className="font-bold text-slate-900">データのアップロード</span>
                <p className="leading-relaxed">
                  予約ログ・リスティング・アンケートのCSVは「患者分析 &gt; データ管理」から登録してください。
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Period Filter */}
        <AnalysisFilterPortal
          months={availableMonths}
          startMonth={startMonth}
          endMonth={endMonth}
          onChangeStart={handleChangeStart}
          onChangeEnd={handleChangeEnd}
          onReset={availableMonths.length > 0 ? resetPeriod : undefined}
          label={periodLabel}
        />

        {/* Segment Selector */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-4 shadow-sm backdrop-blur-sm">
          <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <Users className="h-4 w-4 text-blue-600" />
            対象セグメント
          </span>
          <div className="flex flex-wrap gap-2">
            {SEGMENT_ORDER.map((segment) => (
              <button
                key={segment}
                type="button"
                onClick={() => setSelectedSegment(segment)}
                className={`rounded-full border-2 px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                  selectedSegment === segment
                    ? "border-blue-500 bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg"
                    : "border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:bg-blue-50"
                }`}
              >
                {SEGMENT_LABEL[segment]}
              </button>
            ))}
          </div>
        </div>

        {/* Effect Banner */}
        <EffectBanner
          status={effectSummary.status}
          headline={effectSummary.headline}
          message={effectSummary.message}
          badge={effectSummary.badge}
        />

        {!hasData ? (
          <div className="flex min-h-[400px] items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white/50 p-12 text-center backdrop-blur-sm">
            <div className="space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
                <BarChart3 className="h-8 w-8 text-slate-400" />
              </div>
              <p className="text-lg font-semibold text-slate-700">データがありません</p>
              <p className="text-sm text-slate-500">
                予約・広告・アンケートのCSVをアップロードしてください。
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <TabNavigation tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

              <div className="p-6">
                {/* Summary Tab */}
                {activeTab === 'summary' && (
                  <div className="space-y-6">
                    {/* Metrics Grid */}
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      <MetricCard
                        icon={<Users className="h-5 w-5" />}
                        label="総真の初診"
                        value={summaryMetrics[0]?.value || "—"}
                        iconColor="text-emerald-500"
                      />
                      <MetricCard
                        icon={<TrendingUp className="h-5 w-5" />}
                        label="総広告CV"
                        value={summaryMetrics[1]?.value || "—"}
                        iconColor="text-blue-500"
                      />
                      <MetricCard
                        icon={<Activity className="h-5 w-5" />}
                        label="CV→新患比率"
                        value={summaryMetrics[2]?.value || "—"}
                        iconColor="text-cyan-500"
                      />
                      <MetricCard
                        icon={<LineChart className="h-5 w-5" />}
                        label="Google上限比"
                        value={summaryMetrics[3]?.value || "—"}
                        helper={summaryMetrics[3]?.helper}
                        iconColor="text-orange-500"
                      />
                      {summaryMetrics[4] && (
                        <MetricCard
                          icon={<Clock className="h-5 w-5" />}
                          label="ピークラグ"
                          value={summaryMetrics[4].value}
                          helper={summaryMetrics[4].helper}
                          iconColor="text-purple-500"
                        />
                      )}
                      {summaryMetrics[5] && (
                        <MetricCard
                          icon={<Zap className="h-5 w-5" />}
                          label="推定増分"
                          value={summaryMetrics[5].value}
                          helper={summaryMetrics[5].helper}
                          iconColor="text-rose-500"
                        />
                      )}
                    </div>

                    {/* Time Series Chart */}
                    <ChartCard
                      title="時間帯別の推移"
                      description="広告CVと真の初診の時間帯推移を重ねています。ラグがある場合は、ピークラグの値を参考に読み替えてください。"
                      icon={<LineChart className="h-5 w-5" />}
                    >
                      <div className="h-80 w-full">
                        <ResponsiveContainer>
                          <RechartsLineChart data={hourlyChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis
                              dataKey="hour"
                              tickFormatter={(value) => value.slice(5, 16)}
                              minTickGap={24}
                              stroke="#64748b"
                              style={{ fontSize: 12 }}
                            />
                            <YAxis stroke="#64748b" allowDecimals={false} style={{ fontSize: 12 }} />
                            <Tooltip
                              formatter={(value: number) => `${value.toLocaleString("ja-JP")}`}
                              labelFormatter={(label) => label.replace("T", " ")}
                              contentStyle={{
                                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                border: '1px solid #e2e8f0',
                                borderRadius: '8px',
                                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                              }}
                            />
                            <Legend />
                            <Line
                              type="monotone"
                              dataKey="listingCv"
                              name="広告CV"
                              stroke="#3b82f6"
                              strokeWidth={2}
                              dot={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="trueFirst"
                              name="真の初診"
                              stroke="#10b981"
                              strokeWidth={2}
                              dot={false}
                            />
                          </RechartsLineChart>
                        </ResponsiveContainer>
                      </div>
                    </ChartCard>
                  </div>
                )}

                {/* Analysis Tab */}
                {activeTab === 'analysis' && (
                  <div className="space-y-6">
                    <div className="grid gap-6 lg:grid-cols-2">
                      {/* Lag Correlation */}
                      <ChartCard
                        title="ラグ相関"
                        description="広告CVの発生が真の初診をどの程度先導しているかを、±48時間のラグで相関分析しています。"
                        icon={<Clock className="h-5 w-5" />}
                      >
                        {lagCorrelations.length === 0 ? (
                          <p className="py-8 text-center text-sm text-slate-500">分析可能なデータが足りません。</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-left text-sm">
                              <thead>
                                <tr className="border-b-2 border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-600">
                                  <th className="px-4 py-3">ラグ(時間)</th>
                                  <th className="px-4 py-3 text-right">相関係数</th>
                                  <th className="px-4 py-3 text-right">水準</th>
                                  <th className="px-4 py-3 text-right">サンプル</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lagDisplay.map((row) => {
                                  const level = correlationLevel(row.correlation);
                                  return (
                                    <tr key={row.lag} className="border-b border-slate-100 transition-colors hover:bg-slate-50">
                                      <td className="px-4 py-3 font-semibold text-slate-700">{row.lag}</td>
                                      <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                        {formatPercent(row.correlation, 1)}
                                      </td>
                                      <td className={`px-4 py-3 text-right text-xs font-bold ${level.className}`}>
                                        {level.label}
                                      </td>
                                      <td className="px-4 py-3 text-right text-slate-500">{formatNumber(row.pairedSamples)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </ChartCard>

                      {/* Distributed Lag */}
                      <ChartCard
                        title="分布ラグ推定"
                        description="過去24時間の広告CVを説明変数にとり、Poisson近似の線形回帰で真の初診の増分を推定しています。"
                        icon={<Zap className="h-5 w-5" />}
                      >
                        {!distributedLag ? (
                          <p className="py-8 text-center text-sm text-slate-500">推定に十分なデータがありません。</p>
                        ) : (
                          <div className="space-y-4">
                            <div className="rounded-xl bg-gradient-to-br from-blue-50 to-cyan-50 p-4">
                              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">
                                CV1件あたりの推定増分
                              </div>
                              <div className="text-3xl font-bold text-blue-600">
                                {distributedLag.totalEffect.toFixed(2)} 件
                              </div>
                            </div>
                            <div className="space-y-3 text-sm text-slate-700">
                              <div className="flex justify-between rounded-lg bg-slate-50 px-4 py-3">
                                <span className="font-semibold">モデル適合</span>
                                <span>R²={distributedLag.rSquared.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between rounded-lg bg-slate-50 px-4 py-3">
                                <span className="font-semibold">サンプル数</span>
                                <span>{formatNumber(distributedLag.sampleSize)}</span>
                              </div>
                            </div>
                            <div>
                              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">
                                主なラグ寄与 (Top 5)
                              </div>
                              <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3">
                                {distributedLag.coefficients
                                  .map((coef, index) => ({ lag: index - 1, value: coef }))
                                  .filter((item) => item.lag >= 0)
                                  .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
                                  .slice(0, 5)
                                  .map((item) => (
                                    <div key={item.lag} className="flex justify-between text-xs">
                                      <span className="text-slate-700">{item.lag} 時間前</span>
                                      <span className="font-semibold text-slate-900">{item.value.toFixed(2)}</span>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </ChartCard>
                    </div>
                  </div>
                )}

                {/* Quality Tab */}
                {activeTab === 'quality' && (
                  <div className="space-y-6">
                    <ChartCard
                      title="日次の整合性"
                      description="CVと真の初診の差分、アンケート上限とのギャップを日次で確認できます。乖離の大きい日を優先的にチェックしてください。"
                      icon={<BarChart3 className="h-5 w-5" />}
                    >
                      <div className="h-80 w-full">
                        <ResponsiveContainer>
                          <BarChart data={dailyChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis
                              dataKey="date"
                              stroke="#64748b"
                              minTickGap={24}
                              style={{ fontSize: 12 }}
                            />
                            <YAxis stroke="#64748b" allowDecimals={false} style={{ fontSize: 12 }} />
                            <Tooltip
                              formatter={(value: number) => `${value.toLocaleString("ja-JP")}`}
                              contentStyle={{
                                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                border: '1px solid #e2e8f0',
                                borderRadius: '8px',
                                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                              }}
                            />
                            <Legend />
                            <Bar dataKey="listingCv" name="広告CV" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="trueFirst" name="真の初診" fill="#10b981" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="surveyGoogle" name="アンケート(Google)" fill="#f97316" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowSanityTable((prev) => !prev)}
                        className="mt-4 text-sm font-semibold text-blue-600 transition-colors hover:text-blue-700 hover:underline"
                      >
                        {showSanityTable ? "整合性テーブルを隠す" : "日次テーブルを表示"}
                      </button>
                      {showSanityTable && (
                        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                          <table className="min-w-full text-left text-sm">
                            <thead>
                              <tr className="border-b-2 border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-600">
                                <th className="px-4 py-3">日付</th>
                                <th className="px-4 py-3 text-right">広告CV</th>
                                <th className="px-4 py-3 text-right">真の初診</th>
                                <th className="px-4 py-3 text-right">差分(CV-真)</th>
                                <th className="px-4 py-3 text-right">アンケート(Google)</th>
                                <th className="px-4 py-3 text-right">差分(アンケート-真)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sanityRows.map((row) => (
                                <tr key={row.date} className="border-b border-slate-100 transition-colors hover:bg-slate-50">
                                  <td className="px-4 py-3 font-medium text-slate-700">{row.date}</td>
                                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                    {formatNumber(row.listingCv)}
                                  </td>
                                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                    {formatNumber(row.trueFirst)}
                                  </td>
                                  <td
                                    className={`px-4 py-3 text-right font-semibold ${
                                      row.gapCvVsTrue >= 0 ? "text-slate-900" : "text-rose-600"
                                    }`}
                                  >
                                    {formatNumber(row.gapCvVsTrue)}
                                  </td>
                                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                    {formatNumber(row.surveyGoogle)}
                                  </td>
                                  <td
                                    className={`px-4 py-3 text-right font-semibold ${
                                      row.surveyGap >= 0 ? "text-slate-900" : "text-rose-600"
                                    }`}
                                  >
                                    {formatNumber(row.surveyGap)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </ChartCard>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
