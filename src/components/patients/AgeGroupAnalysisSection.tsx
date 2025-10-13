"use client";

import { useState, useMemo } from "react";
import type { KarteRecord } from "@/lib/karteAnalytics";
import { aggregateKarteByAgeGroup, getDepartmentList } from "@/lib/karteAnalytics";
import { AgeGroupTrendChart } from "./AgeGroupTrendChart";
import { AgeGroupStackedChart } from "./AgeGroupStackedChart";

type Props = {
  records: KarteRecord[];
};

export function AgeGroupAnalysisSection({ records }: Props) {
  const departments = useMemo(() => getDepartmentList(records), [records]);
  const [selectedDepartment, setSelectedDepartment] = useState<string>("全体");

  const ageGroupData = useMemo(() => {
    return aggregateKarteByAgeGroup(records, selectedDepartment);
  }, [records, selectedDepartment]);

  if (records.length === 0) {
    return (
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">年代別分析</h2>
            <p className="text-sm text-slate-600">患者の年代別推移と構成比を確認できます</p>
          </div>
        </div>
        <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-8">
          <p className="text-sm text-slate-500">データがありません</p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">年代別分析</h2>
          <p className="text-sm text-slate-600">患者の年代別推移と構成比を確認できます</p>
        </div>

        {/* 診療科目フィルター */}
        <div className="flex items-center gap-3">
          <label htmlFor="department-select" className="text-sm font-medium text-slate-700">
            診療科目:
          </label>
          <select
            id="department-select"
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm transition hover:bg-slate-50 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            {departments.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 統計サマリー */}
      {ageGroupData.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(() => {
            const latestData = ageGroupData[ageGroupData.length - 1];
            const totalPatients = latestData.total;

            // 不明を除いた合計
            const totalKnown = totalPatients - (latestData.ageGroups["不明"] || 0);

            // 最も多い年代を計算
            const ageGroupEntries = Object.entries(latestData.ageGroups)
              .filter(([key]) => key !== "不明")
              .sort((a, b) => b[1] - a[1]);

            const topAgeGroup = ageGroupEntries[0]?.[0] || "-";
            const topAgeCount = ageGroupEntries[0]?.[1] || 0;
            const topAgePercentage = totalKnown > 0
              ? Math.round((topAgeCount / totalKnown) * 100)
              : 0;

            // 平均年代を計算（おおよその中央値）
            const ageGroupWeights: Record<string, number> = {
              "10代以下": 15,
              "20代": 25,
              "30代": 35,
              "40代": 45,
              "50代": 55,
              "60代": 65,
              "70代": 75,
              "80代以上": 85,
            };

            let weightedSum = 0;
            let totalCount = 0;
            Object.entries(latestData.ageGroups).forEach(([group, count]) => {
              if (group !== "不明" && ageGroupWeights[group]) {
                weightedSum += ageGroupWeights[group] * count;
                totalCount += count;
              }
            });

            const averageAge = totalCount > 0
              ? Math.round(weightedSum / totalCount)
              : null;

            return (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    総患者数
                  </p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">
                    {totalPatients.toLocaleString()}
                    <span className="ml-1 text-sm font-medium text-slate-600">人</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {latestData.month.replace("-", "年")}月
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    最多年代
                  </p>
                  <p className="mt-2 text-2xl font-bold text-brand-600">
                    {topAgeGroup}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {topAgeCount.toLocaleString()}人 ({topAgePercentage}%)
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    平均年代
                  </p>
                  <p className="mt-2 text-2xl font-bold text-emerald-600">
                    {averageAge !== null ? `${averageAge}歳代` : "-"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    おおよその中央値
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    データ範囲
                  </p>
                  <p className="mt-2 text-2xl font-bold text-sky-600">
                    {ageGroupData.length}
                    <span className="ml-1 text-sm font-medium text-slate-600">ヶ月</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {ageGroupData[0].month} 〜 {latestData.month}
                  </p>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* チャート */}
      <div className="grid gap-6 lg:grid-cols-2">
        <AgeGroupTrendChart
          data={ageGroupData}
          title={selectedDepartment === "全体" ? "年代別患者数推移" : `${selectedDepartment} 年代別推移`}
        />
        <AgeGroupStackedChart
          data={ageGroupData}
          title={selectedDepartment === "全体" ? "年代別構成比" : `${selectedDepartment} 年代別構成比`}
        />
      </div>
    </section>
  );
}
