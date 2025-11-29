"use client";

import { useMemo, useState } from "react";
import {
  Receipt,
  Building2,
  ShoppingCart,
  Lightbulb,
  CreditCard,
  Phone,
  Package,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  PieChart,
} from "lucide-react";
import {
  type MonthlyExpenseSummary,
  type AccountCategory,
  type PurchaseCategory,
  type FeeCategory,
} from "@/lib/expenseData";

interface ExpenseAnalysisSectionProps {
  summary: MonthlyExpenseSummary | null;
}

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const formatPercentage = (value: number): string =>
  `${(value * 100).toLocaleString("ja-JP", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;

// 勘定科目のアイコンと色
const accountCategoryStyles: Record<
  AccountCategory,
  { icon: typeof Receipt; color: string; bgGradient: string; border: string }
> = {
  仕入高: {
    icon: ShoppingCart,
    color: "text-rose-600",
    bgGradient: "from-rose-50 to-pink-50",
    border: "border-rose-200",
  },
  広告宣伝費: {
    icon: TrendingUp,
    color: "text-purple-600",
    bgGradient: "from-purple-50 to-violet-50",
    border: "border-purple-200",
  },
  地代家賃: {
    icon: Building2,
    color: "text-blue-600",
    bgGradient: "from-blue-50 to-cyan-50",
    border: "border-blue-200",
  },
  支払手数料: {
    icon: CreditCard,
    color: "text-amber-600",
    bgGradient: "from-amber-50 to-orange-50",
    border: "border-amber-200",
  },
  通信費: {
    icon: Phone,
    color: "text-teal-600",
    bgGradient: "from-teal-50 to-emerald-50",
    border: "border-teal-200",
  },
  水道光熱費: {
    icon: Lightbulb,
    color: "text-yellow-600",
    bgGradient: "from-yellow-50 to-amber-50",
    border: "border-yellow-200",
  },
  "備品・消耗品費": {
    icon: Package,
    color: "text-indigo-600",
    bgGradient: "from-indigo-50 to-blue-50",
    border: "border-indigo-200",
  },
  その他: {
    icon: Receipt,
    color: "text-slate-600",
    bgGradient: "from-slate-50 to-gray-50",
    border: "border-slate-200",
  },
};

// 仕入高カテゴリの色
const purchaseCategoryColors: Record<PurchaseCategory, string> = {
  検査キット: "bg-rose-100 text-rose-700",
  "AGA・ED治療薬": "bg-purple-100 text-purple-700",
  内視鏡関連: "bg-blue-100 text-blue-700",
  その他医療材料: "bg-slate-100 text-slate-700",
  "注射器・針類": "bg-cyan-100 text-cyan-700",
  "CPAP・呼吸器": "bg-teal-100 text-teal-700",
  "ワクチン・予防接種": "bg-emerald-100 text-emerald-700",
  消化器系薬剤: "bg-amber-100 text-amber-700",
  "消毒・衛生材": "bg-green-100 text-green-700",
  糖尿病薬: "bg-orange-100 text-orange-700",
  "麻酔・鎮静剤": "bg-red-100 text-red-700",
  その他: "bg-gray-100 text-gray-700",
};

// 支払手数料カテゴリの色
const feeCategoryColors: Record<FeeCategory, string> = {
  システム利用料: "bg-blue-100 text-blue-700",
  "振込・カード手数料": "bg-amber-100 text-amber-700",
  決済手数料: "bg-purple-100 text-purple-700",
  保守契約: "bg-teal-100 text-teal-700",
  外注検査料: "bg-rose-100 text-rose-700",
  その他: "bg-slate-100 text-slate-700",
};

export function ExpenseAnalysisSection({ summary }: ExpenseAnalysisSectionProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const purchaseTotal = useMemo(() => {
    if (!summary) return 0;
    return summary.purchaseCategorySummaries.reduce((sum, s) => sum + s.amount, 0);
  }, [summary]);

  const feeTotal = useMemo(() => {
    if (!summary) return 0;
    return summary.feeCategorySummaries.reduce((sum, s) => sum + s.amount, 0);
  }, [summary]);

  if (!summary || summary.records.length === 0) {
    return (
      <section className="rounded-3xl border-2 border-dashed border-orange-200 bg-orange-50/30 p-16 text-center text-slate-500 shadow-inner">
        <div className="mx-auto max-w-md">
          <div className="mx-auto mb-6 inline-flex rounded-full bg-orange-100 p-4">
            <Receipt className="h-12 w-12 text-orange-600" />
          </div>
          <p className="text-lg font-semibold">
            経費CSVをデータ管理ページからアップロードすると、ここに経費分析が表示されます。
          </p>
          <p className="mt-4 text-sm text-slate-500">
            freeeやマネーフォワードからエクスポートした仕訳CSVに対応しています。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-7 rounded-3xl border border-orange-100/60 bg-white p-8 shadow-xl shadow-orange-500/5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 p-3 shadow-lg shadow-orange-500/30">
            <Receipt className="h-7 w-7 text-white" />
          </div>
          <div>
            <h2 className="text-3xl font-black text-slate-900">経費分析</h2>
            <p className="mt-1 text-base text-slate-600">
              {summary.yearMonth ? `${summary.yearMonth.replace("-", "年")}月` : ""}の経費内訳
            </p>
          </div>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-orange-50 to-amber-50 px-6 py-4 border border-orange-200/60 shadow-lg">
          <p className="text-sm font-semibold text-orange-700">経費合計</p>
          <p className="mt-1 text-3xl font-black text-orange-600">
            {formatCurrency(summary.totalAmount)}
          </p>
        </div>
      </div>

      {/* 勘定科目別サマリー */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summary.accountSummaries.slice(0, 8).map((account) => {
          const style = accountCategoryStyles[account.category] || accountCategoryStyles["その他"];
          const Icon = style.icon;
          return (
            <div
              key={account.category}
              className={`group relative overflow-hidden rounded-2xl border ${style.border} bg-gradient-to-br ${style.bgGradient} p-5 shadow-lg hover:shadow-xl transition-all hover:scale-105`}
            >
              <div className="absolute right-0 top-0 h-20 w-20 translate-x-6 -translate-y-6 rounded-full bg-white/30 blur-2xl" />
              <div className="relative">
                <div className={`mb-3 inline-flex rounded-xl bg-white/80 p-2 shadow-sm ${style.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <p className={`text-sm font-semibold ${style.color}`}>{account.category}</p>
                <p className="mt-2 text-2xl font-black text-slate-800">
                  {formatCurrency(account.amount)}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">
                    {account.count}件
                  </span>
                  <span className={`rounded-full bg-white/80 px-2 py-0.5 text-xs font-bold ${style.color}`}>
                    {formatPercentage(account.ratio)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 構成比グラフ（横棒） */}
      <div className="rounded-2xl border border-orange-100/60 bg-gradient-to-br from-orange-50/30 to-amber-50/20 p-6 shadow-lg">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="rounded-xl bg-white p-2 shadow-sm">
            <PieChart className="h-5 w-5 text-orange-600" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">経費構成比</h3>
        </div>
        <div className="space-y-3">
          {summary.accountSummaries.map((account) => {
            const style = accountCategoryStyles[account.category] || accountCategoryStyles["その他"];
            const widthPercent = Math.max(account.ratio * 100, 2);
            return (
              <div key={account.category} className="flex items-center gap-4">
                <div className="w-28 text-sm font-semibold text-slate-700 truncate">
                  {account.category}
                </div>
                <div className="flex-1 h-8 bg-white rounded-full overflow-hidden shadow-inner">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${style.bgGradient} border ${style.border} flex items-center justify-end pr-3 transition-all duration-500`}
                    style={{ width: `${widthPercent}%` }}
                  >
                    {widthPercent > 15 && (
                      <span className={`text-xs font-bold ${style.color}`}>
                        {formatPercentage(account.ratio)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-24 text-right text-sm font-bold text-slate-700">
                  {formatCurrency(account.amount)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 仕入高の詳細 */}
      {summary.purchaseCategorySummaries.length > 0 && (
        <div className="rounded-2xl border border-rose-100/60 bg-white shadow-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandedSection(expandedSection === "purchase" ? null : "purchase")}
            className="flex w-full items-center justify-between gap-4 border-b border-rose-100 bg-gradient-to-r from-rose-50/50 to-pink-50/30 px-6 py-4 text-left transition-all hover:from-rose-50 hover:to-pink-50"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white p-2 shadow-sm">
                <ShoppingCart className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <span className="text-lg font-bold text-slate-900">仕入高の内訳</span>
                <span className="ml-3 text-sm font-semibold text-rose-600">
                  {formatCurrency(purchaseTotal)}
                </span>
              </div>
            </div>
            {expandedSection === "purchase" ? (
              <ChevronUp className="h-5 w-5 text-slate-500" />
            ) : (
              <ChevronDown className="h-5 w-5 text-slate-500" />
            )}
          </button>
          {expandedSection === "purchase" && (
            <div className="p-6 space-y-4">
              {/* カテゴリ別 */}
              <div>
                <h4 className="mb-3 text-sm font-bold text-slate-700">品目カテゴリ別</h4>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {summary.purchaseCategorySummaries.map((cat) => (
                    <div
                      key={cat.category}
                      className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm hover:shadow-md transition-all"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${purchaseCategoryColors[cat.category]}`}>
                          {cat.category}
                        </span>
                        <span className="text-xs font-semibold text-slate-500">
                          {formatPercentage(cat.ratio)}
                        </span>
                      </div>
                      <p className="text-lg font-black text-slate-800">
                        {formatCurrency(cat.amount)}
                      </p>
                      {cat.items.length > 0 && (
                        <p className="mt-2 text-xs text-slate-500 truncate">
                          {cat.items.slice(0, 3).join("、")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {/* 取引先別 */}
              <div>
                <h4 className="mb-3 text-sm font-bold text-slate-700">取引先別</h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100 text-sm">
                    <thead className="bg-slate-50/50">
                      <tr>
                        <th className="px-4 py-3 text-left font-bold text-slate-700">取引先</th>
                        <th className="px-4 py-3 text-right font-bold text-slate-700">金額</th>
                        <th className="px-4 py-3 text-right font-bold text-slate-700">構成比</th>
                        <th className="px-4 py-3 text-right font-bold text-slate-700">件数</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {summary.vendorSummaries.slice(0, 10).map((vendor) => (
                        <tr key={vendor.vendor} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-700">{vendor.vendor}</td>
                          <td className="px-4 py-3 text-right font-bold text-slate-800 tabular-nums">
                            {formatCurrency(vendor.amount)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-600">
                            {formatPercentage(vendor.ratio)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-600">{vendor.count}件</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 支払手数料の詳細 */}
      {summary.feeCategorySummaries.length > 0 && (
        <div className="rounded-2xl border border-amber-100/60 bg-white shadow-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandedSection(expandedSection === "fee" ? null : "fee")}
            className="flex w-full items-center justify-between gap-4 border-b border-amber-100 bg-gradient-to-r from-amber-50/50 to-orange-50/30 px-6 py-4 text-left transition-all hover:from-amber-50 hover:to-orange-50"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white p-2 shadow-sm">
                <CreditCard className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <span className="text-lg font-bold text-slate-900">支払手数料の内訳</span>
                <span className="ml-3 text-sm font-semibold text-amber-600">
                  {formatCurrency(feeTotal)}
                </span>
              </div>
            </div>
            {expandedSection === "fee" ? (
              <ChevronUp className="h-5 w-5 text-slate-500" />
            ) : (
              <ChevronDown className="h-5 w-5 text-slate-500" />
            )}
          </button>
          {expandedSection === "fee" && (
            <div className="p-6">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {summary.feeCategorySummaries.map((cat) => (
                  <div
                    key={cat.category}
                    className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm hover:shadow-md transition-all"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${feeCategoryColors[cat.category]}`}>
                        {cat.category}
                      </span>
                      <span className="text-xs font-semibold text-slate-500">
                        {formatPercentage(cat.ratio)}
                      </span>
                    </div>
                    <p className="text-lg font-black text-slate-800">
                      {formatCurrency(cat.amount)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{cat.count}件</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

    </section>
  );
}
