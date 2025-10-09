"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { filterByPeriod, type PeriodType } from "@/lib/dateUtils";
import {
  loadReservationsFromStorage,
  loadReservationTimestamp,
  Reservation,
  RESERVATION_STORAGE_KEY,
} from "@/lib/reservationData";
import {
  aggregateLeadtimeMetrics,
  LEADTIME_CATEGORIES,
  type LeadtimeCategory,
  type LeadtimeCategoryCounts,
  type LeadtimeHourStat,
  type LeadtimeSummary,
} from "@/lib/leadtimeMetrics";

type VisitTypeFilter = "all" | "初診" | "再診";

const hourLabel = (hour: number) => `${hour.toString().padStart(2, "0")}:00`;

const createEmptyCategoryCounts = (): LeadtimeCategoryCounts =>
  LEADTIME_CATEGORIES.reduce((acc, category) => {
    acc[category] = 0;
    return acc;
  }, {} as LeadtimeCategoryCounts);

const createEmptySummary = (): LeadtimeSummary => ({
  total: 0,
  averageHours: null,
  medianHours: null,
  p90Hours: null,
  sameDayCount: 0,
  sameDayRate: 0,
  categoryCounts: createEmptyCategoryCounts(),
});

const createEmptyHourStats = (): LeadtimeHourStat[] =>
  Array.from({ length: 24 }, (_, hour) => ({
    hour,
    summary: createEmptySummary(),
    topCategory: null,
  }));

const formatHours = (value: number | null) => {
  if (value === null || Number.isNaN(value)) {
    return "ー";
  }
  if (value < 24) {
    return `${value.toFixed(1)}時間`;
  }
  const days = value / 24;
  if (days >= 1 && days < 2) {
    return "約1日";
  }
  return `${days.toFixed(1)}日`;
};

const formatRate = (value: number | null) => {
  if (value === null || Number.isNaN(value)) {
    return "ー";
  }
  return `${(value * 100).toFixed(1)}%`;
};

const formatCategoryRate = (
  counts: LeadtimeCategoryCounts,
  total: number,
  category: LeadtimeCategory,
) => {
  if (total === 0) {
    return "0件 (0.0%)";
  }
  const count = counts[category] ?? 0;
  const rate = (count / total) * 100;
  return `${count.toLocaleString("ja-JP")}件 (${rate.toFixed(1)}%)`;
};

const getMostFrequentCategory = (
  counts: LeadtimeCategoryCounts,
): LeadtimeCategory | null => {
  let top: LeadtimeCategory | null = null;
  let topCount = -1;
  for (const category of LEADTIME_CATEGORIES) {
    const count = counts[category] ?? 0;
    if (count > topCount) {
      top = category;
      topCount = count;
    }
  }
  return top;
};

const SectionCard = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft sm:rounded-3xl sm:p-6">
    <header className="mb-3 flex flex-col gap-2 sm:mb-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
          {title}
        </h2>
        {description && (
          <p className="text-xs leading-relaxed text-slate-500 sm:text-sm">
            {description}
          </p>
        )}
      </div>
    </header>
    <div className="sm:pt-1">{children}</div>
  </section>
);

const StatCard = ({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle?: string;
}) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-card sm:p-4">
    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">
      {label}
    </dt>
    <dd className="mt-1 text-xl font-bold text-slate-900 sm:mt-2 sm:text-2xl">
      {value}
    </dd>
    {subtitle && (
      <p className="mt-1 whitespace-pre-line text-xs font-medium text-slate-500 sm:text-sm">
        {subtitle}
      </p>
    )}
  </div>
);

const VISIT_TYPE_OPTIONS: { label: string; value: VisitTypeFilter }[] = [
  { label: "全て", value: "all" },
  { label: "初診のみ", value: "初診" },
  { label: "再診のみ", value: "再診" },
];

export default function LeadtimePage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>("all");
  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("全体");
  const [visitTypeFilter, setVisitTypeFilter] =
    useState<VisitTypeFilter>("all");

  useEffect(() => {
    const stored = loadReservationsFromStorage();
    if (stored.length > 0) {
      setReservations(stored);
    }
    const timestamp = loadReservationTimestamp();
    if (timestamp) {
      setLastUpdated(timestamp);
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === RESERVATION_STORAGE_KEY) {
        const updated = loadReservationsFromStorage();
        setReservations(updated);
        const updatedTimestamp = loadReservationTimestamp();
        setLastUpdated(updatedTimestamp);
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const availableMonths = useMemo(() => {
    const months = new Set(reservations.map((item) => item.reservationMonth));
    return Array.from(months).sort();
  }, [reservations]);

  useEffect(() => {
    if (availableMonths.length === 0) {
      setSelectedMonth("all");
      return;
    }
    if (selectedMonth !== "all" && !availableMonths.includes(selectedMonth)) {
      setSelectedMonth("all");
    }
  }, [availableMonths, selectedMonth]);

  const departmentList = useMemo(() => {
    const departments = new Set(reservations.map((item) => item.department));
    return Array.from(departments).sort((a, b) => a.localeCompare(b, "ja"));
  }, [reservations]);

  useEffect(() => {
    if (
      selectedDepartment !== "全体" &&
      !departmentList.includes(selectedDepartment)
    ) {
      setSelectedDepartment("全体");
    }
  }, [departmentList, selectedDepartment]);

  const filteredReservations = useMemo(() => {
    let filtered = reservations;

    if (selectedPeriod !== "all") {
      filtered = filterByPeriod(filtered, selectedPeriod);
    }

    if (selectedMonth !== "all") {
      filtered = filtered.filter(
        (item) => item.reservationMonth === selectedMonth,
      );
    }

    if (visitTypeFilter !== "all") {
      filtered = filtered.filter((item) => item.visitType === visitTypeFilter);
    }

    return filtered;
  }, [reservations, selectedPeriod, selectedMonth, visitTypeFilter]);

  const leadtimeMetrics = useMemo(
    () => aggregateLeadtimeMetrics(filteredReservations),
    [filteredReservations],
  );

  const selectedSummary = useMemo(() => {
    if (selectedDepartment === "全体") {
      return leadtimeMetrics.summary;
    }
    const target = leadtimeMetrics.departmentStats.find(
      (item) => item.department === selectedDepartment,
    );
    return target?.summary ?? createEmptySummary();
  }, [leadtimeMetrics, selectedDepartment]);

  const displayedHourStats = useMemo(() => {
    if (selectedDepartment === "全体") {
      return leadtimeMetrics.hourStats;
    }
    const target = leadtimeMetrics.departmentHourStats[selectedDepartment];
    if (!target) {
      return createEmptyHourStats();
    }
    return target;
  }, [leadtimeMetrics, selectedDepartment]);

  const categoryBreakdown = useMemo(() => {
    return LEADTIME_CATEGORIES.map((category) => ({
      category,
      label: formatCategoryRate(
        selectedSummary.categoryCounts,
        selectedSummary.total,
        category,
      ),
    }));
  }, [selectedSummary]);

  const totalReservations = selectedSummary.total;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
        <section className="relative overflow-hidden rounded-3xl border border-brand-200 bg-gradient-to-r from-white via-brand-50 to-brand-100 p-8 shadow-card">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-4">
              <p className="text-sm font-semibold text-brand-600">
                Reservation Leadtime Analytics
              </p>
              <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">
                予約リードタイム分析
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                予約受付時刻から実際の受診予定時刻までの時間差を可視化し、短期予約・中期予約の傾向を把握します。
                朝の予約が即日受診に偏っているか、診療科ごとに待機期間がどの程度異なるかを確認できます。
              </p>
              {lastUpdated && (
                <p className="text-xs font-medium text-slate-500">
                  最終更新: {new Date(lastUpdated).toLocaleString("ja-JP")}
                </p>
              )}
            </div>
            <div className="rounded-2xl border border-brand-200 bg-white/70 px-4 py-3 text-xs leading-relaxed text-slate-600 sm:px-5 sm:text-sm">
              <p className="font-semibold text-brand-700">
                リードタイムカテゴリ
              </p>
              <ul className="mt-2 space-y-1">
                <li>・当日以内: 24時間未満</li>
                <li>・翌日: 24〜48時間未満</li>
                <li>・3日以内: 48〜72時間未満</li>
                <li>・1週間以内: 72〜168時間未満</li>
                <li>・2週間以内: 168〜336時間未満</li>
                <li>・それ以降: 336時間以上</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-soft sm:p-6">
          <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
            フィルター
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
              期間
              <select
                value={selectedPeriod}
                onChange={(event) =>
                  setSelectedPeriod(event.target.value as PeriodType)
                }
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none"
              >
                <option value="all">全期間</option>
                <option value="3months">直近3ヶ月</option>
                <option value="6months">直近6ヶ月</option>
                <option value="1year">直近1年</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
              月
              <select
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none"
              >
                <option value="all">全て</option>
                {availableMonths.map((month) => (
                  <option key={month} value={month}>
                    {month}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
              診療科
              <select
                value={selectedDepartment}
                onChange={(event) => setSelectedDepartment(event.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none"
              >
                <option value="全体">全体</option>
                {departmentList.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
              初再診
              <div className="flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
                {VISIT_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setVisitTypeFilter(option.value)}
                    className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold transition ${
                      visitTypeFilter === option.value
                        ? "bg-brand-500 text-white shadow"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {filteredReservations.length === 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-3 text-xs text-slate-600">
              <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
              フィルターに一致する予約データがありません。条件を調整してください。
            </div>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <StatCard
            label="平均リードタイム"
            value={formatHours(selectedSummary.averageHours)}
            subtitle="予約→受診までの平均所要時間"
          />
          <StatCard
            label="中央値"
            value={formatHours(selectedSummary.medianHours)}
          />
          <StatCard
            label="P90（90%がこの時間以内）"
            value={formatHours(selectedSummary.p90Hours)}
          />
          <StatCard
            label="当日完了率"
            value={formatRate(selectedSummary.sameDayRate)}
            subtitle={`総数: ${totalReservations.toLocaleString("ja-JP")}件`}
          />
        </section>

        <SectionCard
          title="リードタイムカテゴリの内訳"
          description={
            selectedDepartment === "全体"
              ? "全体の予約に対するリードタイムのカテゴリ別割合です。"
              : `${selectedDepartment} に絞ったリードタイムカテゴリの割合です。`
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">カテゴリ</th>
                  <th className="px-3 py-2">件数と構成比</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {categoryBreakdown.map((item) => (
                  <tr key={item.category} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {item.category}
                    </td>
                    <td className="px-3 py-2">{item.label}</td>
                  </tr>
                ))}
                {totalReservations === 0 && (
                  <tr>
                    <td
                      colSpan={2}
                      className="px-3 py-6 text-center text-slate-500"
                    >
                      集計対象のデータがありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard
          title="予約時間帯別 リードタイム傾向"
          description={
            selectedDepartment === "全体"
              ? "予約を受け付けた時間帯ごとのリードタイム分布です。"
              : `${selectedDepartment} の予約時間帯ごとの傾向です。`
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">時間帯</th>
                  <th className="px-3 py-2">件数</th>
                  <th className="px-3 py-2">平均</th>
                  <th className="px-3 py-2">中央値</th>
                  <th className="px-3 py-2">当日完了率</th>
                  <th className="px-3 py-2">最多カテゴリ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {displayedHourStats.map((stat) => (
                  <tr key={stat.hour} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {hourLabel(stat.hour)}
                    </td>
                    <td className="px-3 py-2">
                      {stat.summary.total.toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      {formatHours(stat.summary.averageHours)}
                    </td>
                    <td className="px-3 py-2">
                      {formatHours(stat.summary.medianHours)}
                    </td>
                    <td className="px-3 py-2">
                      {formatRate(stat.summary.sameDayRate)}
                    </td>
                    <td className="px-3 py-2">{stat.topCategory ?? "ー"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard
          title="診療科別 リードタイムサマリー"
          description="各診療科のリードタイム平均・中央値・カテゴリ構成を一覧で比較できます。"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">診療科</th>
                  <th className="px-3 py-2">件数</th>
                  <th className="px-3 py-2">平均</th>
                  <th className="px-3 py-2">中央値</th>
                  <th className="px-3 py-2">当日完了率</th>
                  <th className="px-3 py-2">最多カテゴリ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {leadtimeMetrics.departmentStats.map((item) => (
                  <tr key={item.department} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {item.department}
                    </td>
                    <td className="px-3 py-2">
                      {item.summary.total.toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2">
                      {formatHours(item.summary.averageHours)}
                    </td>
                    <td className="px-3 py-2">
                      {formatHours(item.summary.medianHours)}
                    </td>
                    <td className="px-3 py-2">
                      {formatRate(item.summary.sameDayRate)}
                    </td>
                    <td className="px-3 py-2">
                      {getMostFrequentCategory(item.summary.categoryCounts) ??
                        "ー"}
                    </td>
                  </tr>
                ))}
                {leadtimeMetrics.departmentStats.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-6 text-center text-slate-500"
                    >
                      集計対象のデータがありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </main>
  );
}
