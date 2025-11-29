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
  TrendingDown,
  PieChart,
  Calendar,
  Minus,
} from "lucide-react";
import {
  type ExpenseRecord,
  type AccountCategory,
  type PurchaseCategory,
  type FeeCategory,
  type ExpenseComparisonSummary,
  generateExpenseSummary,
  generateExpenseComparison,
  getAvailableExpenseMonths,
  getPreviousMonth,
} from "@/lib/expenseData";

interface ExpenseAnalysisSectionProps {
  records: ExpenseRecord[];
  // 売上分析と連動するための期間指定（オプション）
  linkedStartMonth?: string; // YYYY-MM形式
  linkedEndMonth?: string; // YYYY-MM形式
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

const formatChangePercentage = (value: number): string => {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toLocaleString("ja-JP", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
};

const formatYearMonth = (ym: string): string => {
  if (!ym) return "";
  return `${ym.replace("-", "年")}月`;
};

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

// 変化インジケーター
function ChangeIndicator({ change, changeRatio }: { change: number; changeRatio: number }) {
  if (change === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
        <Minus className="h-3 w-3" />
        変動なし
      </span>
    );
  }

  const isIncrease = change > 0;
  // 経費は減った方が良いので、減少は緑、増加は赤
  const colorClass = isIncrease ? "text-red-600" : "text-emerald-600";
  const bgClass = isIncrease ? "bg-red-50" : "bg-emerald-50";
  const Icon = isIncrease ? TrendingUp : TrendingDown;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full ${bgClass} px-2.5 py-1 text-xs font-bold ${colorClass}`}>
      <Icon className="h-3.5 w-3.5" />
      {formatChangePercentage(changeRatio)}
    </span>
  );
}

export function ExpenseAnalysisSection({ records, linkedStartMonth, linkedEndMonth }: ExpenseAnalysisSectionProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // 利用可能な月を取得
  const availableMonths = useMemo(() => getAvailableExpenseMonths(records), [records]);

  // 連動モードかどうか
  const isLinkedMode = linkedStartMonth !== undefined && linkedEndMonth !== undefined;

  // 連動モード時の表示期間
  const linkedMonths = useMemo(() => {
    if (!isLinkedMode || !linkedStartMonth || !linkedEndMonth) return [];
    return availableMonths.filter((m) => m >= linkedStartMonth && m <= linkedEndMonth);
  }, [isLinkedMode, linkedStartMonth, linkedEndMonth, availableMonths]);

  // 連動モード時の単月表示かどうか
  const isLinkedSingleMonth = isLinkedMode && linkedStartMonth === linkedEndMonth;

  // 最新月をデフォルトに（非連動時のみ使用）
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    return availableMonths.length > 0 ? availableMonths[availableMonths.length - 1] : "";
  });

  // 連動時は選択月を同期
  const effectiveSelectedMonth = useMemo(() => {
    // 連動モードで単月選択の場合
    if (isLinkedMode && isLinkedSingleMonth && linkedStartMonth) {
      // 経費データにその月があれば使う、なければ空文字（データなし表示用）
      return availableMonths.includes(linkedStartMonth) ? linkedStartMonth : "";
    }
    // 連動モードで期間選択の場合
    if (isLinkedMode) {
      // 期間内に経費データがあればその最新月を使う
      if (linkedMonths.length > 0) {
        return linkedMonths[linkedMonths.length - 1];
      }
      // 期間内に経費データがなくても、経費データ自体があれば最新月を使う
      // （これにより経費分析セクション自体は表示される）
      if (availableMonths.length > 0) {
        return availableMonths[availableMonths.length - 1];
      }
      return "";
    }
    // 非連動モードは独自選択を使う
    return selectedMonth;
  }, [isLinkedMode, isLinkedSingleMonth, linkedStartMonth, linkedMonths, selectedMonth, availableMonths]);

  // 選択月のサマリー
  const summary = useMemo(() => {
    if (!effectiveSelectedMonth || records.length === 0) return null;
    return generateExpenseSummary(records, effectiveSelectedMonth);
  }, [records, effectiveSelectedMonth]);

  // 前月
  const previousMonth = useMemo(() => getPreviousMonth(effectiveSelectedMonth), [effectiveSelectedMonth]);

  // 前年同月
  const previousYearMonth = useMemo(() => {
    if (!effectiveSelectedMonth) return "";
    const [year, month] = effectiveSelectedMonth.split("-").map(Number);
    return `${year - 1}-${String(month).padStart(2, "0")}`;
  }, [effectiveSelectedMonth]);

  // 前月比較データ
  const comparison = useMemo<ExpenseComparisonSummary | null>(() => {
    if (!effectiveSelectedMonth || records.length === 0) return null;
    return generateExpenseComparison(records, effectiveSelectedMonth, previousMonth);
  }, [records, effectiveSelectedMonth, previousMonth]);

  // 前年比較データ
  const yearComparison = useMemo<ExpenseComparisonSummary | null>(() => {
    if (!effectiveSelectedMonth || records.length === 0) return null;
    return generateExpenseComparison(records, effectiveSelectedMonth, previousYearMonth);
  }, [records, effectiveSelectedMonth, previousYearMonth]);

  // 前月データがあるか
  const hasPreviousData = useMemo(() => {
    return availableMonths.includes(previousMonth);
  }, [availableMonths, previousMonth]);

  // 前年データがあるか
  const hasPreviousYearData = useMemo(() => {
    return availableMonths.includes(previousYearMonth);
  }, [availableMonths, previousYearMonth]);

  // 期間集計データ（連動モード・期間表示時）
  const periodSummary = useMemo(() => {
    if (!isLinkedMode || linkedMonths.length <= 1) return null;
    let total = 0;
    for (const m of linkedMonths) {
      const monthRecords = records.filter((r) => r.date.startsWith(m));
      total += monthRecords.reduce((sum, r) => sum + r.amount, 0);
    }
    return {
      totalAmount: total,
      monthCount: linkedMonths.length,
      averageMonthlyAmount: linkedMonths.length > 0 ? total / linkedMonths.length : 0,
    };
  }, [isLinkedMode, linkedMonths, records]);

  const purchaseTotal = useMemo(() => {
    if (!summary) return 0;
    return summary.purchaseCategorySummaries.reduce((sum, s) => sum + s.amount, 0);
  }, [summary]);

  const feeTotal = useMemo(() => {
    if (!summary) return 0;
    return summary.feeCategorySummaries.reduce((sum, s) => sum + s.amount, 0);
  }, [summary]);

  // 期間ラベル（連動モード用）- 早期リターンの前に定義
  const linkedPeriodLabel = useMemo(() => {
    if (!isLinkedMode) return "";
    if (isLinkedSingleMonth && linkedStartMonth) {
      return formatYearMonth(linkedStartMonth);
    }
    // 期間モードで期間内にデータがある場合
    if (linkedMonths.length > 0) {
      if (linkedMonths.length === 1) return formatYearMonth(linkedMonths[0]);
      return `${formatYearMonth(linkedMonths[0])} 〜 ${formatYearMonth(linkedMonths[linkedMonths.length - 1])}`;
    }
    // 期間内にデータがない場合、経費データの最新月を表示
    if (effectiveSelectedMonth) {
      return `${formatYearMonth(effectiveSelectedMonth)}（経費データの最新月）`;
    }
    return "データなし";
  }, [isLinkedMode, isLinkedSingleMonth, linkedStartMonth, linkedMonths, effectiveSelectedMonth]);

  // 連動モードで選択月に経費データがあるか
  const hasExpenseDataForLinkedMonth = useMemo(() => {
    if (!isLinkedMode) return true;
    // 経費データ自体がなければfalse
    if (availableMonths.length === 0) return false;
    // 単月選択の場合、その月に経費データがあるかチェック
    if (isLinkedSingleMonth && linkedStartMonth) {
      return availableMonths.includes(linkedStartMonth);
    }
    // 期間モードでは経費データがあればOK（期間に関係なく表示）
    return true;
  }, [isLinkedMode, isLinkedSingleMonth, linkedStartMonth, availableMonths]);

  if (records.length === 0) {
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

  if (!summary) return null;

  return (
    <section className="flex flex-col gap-7 rounded-3xl border border-orange-100/60 bg-white p-8 shadow-xl shadow-orange-500/5">
      {/* Header with Month Selector */}
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 p-3 shadow-lg shadow-orange-500/30">
            <Receipt className="h-7 w-7 text-white" />
          </div>
          <div>
            <h2 className="text-3xl font-black text-slate-900">経費分析<span className="ml-2 text-lg font-semibold text-slate-500">（人件費を除く）</span></h2>
            <p className="mt-1 text-base text-slate-600">
              {isLinkedMode ? (
                <>売上分析と連動中: <span className="font-semibold text-orange-600">{linkedPeriodLabel}</span></>
              ) : (
                "月別経費の推移と前月比較"
              )}
            </p>
          </div>
        </div>

        {/* 月選択（非連動モードのみ） */}
        {!isLinkedMode && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2">
              <Calendar className="h-4 w-4 text-slate-500" />
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-transparent text-sm font-semibold text-slate-700 focus:outline-none cursor-pointer"
              >
                {availableMonths.map((month) => (
                  <option key={month} value={month}>
                    {formatYearMonth(month)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* 連動モードで選択月に経費データがない場合 */}
      {isLinkedMode && !hasExpenseDataForLinkedMonth && (
        <div className="rounded-2xl border-2 border-dashed border-orange-200 bg-orange-50/30 p-8 text-center">
          <p className="text-lg font-semibold text-slate-600">
            {isLinkedSingleMonth && linkedStartMonth ? (
              <>{formatYearMonth(linkedStartMonth)}の経費データがありません</>
            ) : (
              <>選択期間内の経費データがありません</>
            )}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            データ管理ページから経費CSVをアップロードしてください
          </p>
        </div>
      )}

      {/* 期間表示（連動モード・複数月）*/}
      {isLinkedMode && hasExpenseDataForLinkedMonth && periodSummary && linkedMonths.length > 1 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl bg-gradient-to-br from-orange-50 to-amber-50 px-6 py-5 border border-orange-200/60 shadow-lg">
            <p className="text-sm font-semibold text-orange-700">期間合計経費</p>
            <p className="mt-1 text-3xl font-black text-orange-600">
              {formatCurrency(periodSummary.totalAmount)}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {periodSummary.monthCount}ヶ月間
            </p>
          </div>
          <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-yellow-50 px-6 py-5 border border-amber-200/60 shadow-lg">
            <p className="text-sm font-semibold text-amber-700">月平均経費</p>
            <p className="mt-1 text-3xl font-black text-amber-600">
              {formatCurrency(periodSummary.averageMonthlyAmount)}
            </p>
          </div>
        </div>
      )}

      {/* 単月表示（連動モード・単月 or 非連動モード）- 経費データがある場合のみ */}
      {((isLinkedSingleMonth && hasExpenseDataForLinkedMonth) || !isLinkedMode) && summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* 経費合計 */}
          <div className="rounded-2xl bg-gradient-to-br from-orange-50 to-amber-50 px-6 py-5 border border-orange-200/60 shadow-lg">
            <p className="text-sm font-semibold text-orange-700">
              {isLinkedSingleMonth ? `${linkedPeriodLabel}の経費` : "経費合計"}
            </p>
            <p className="mt-1 text-3xl font-black text-orange-600">
              {formatCurrency(summary.totalAmount)}
            </p>
          </div>

          {/* 前月比カード */}
          {hasPreviousData && comparison && (
            <div className={`rounded-2xl px-6 py-5 border shadow-lg ${
              comparison.totalChange <= 0
                ? "bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200/60"
                : "bg-gradient-to-br from-red-50 to-rose-50 border-red-200/60"
            }`}>
              <p className={`text-sm font-semibold ${comparison.totalChange <= 0 ? "text-emerald-700" : "text-red-700"}`}>
                前月比
              </p>
              <div className="mt-1 flex items-center gap-2">
                <ChangeIndicator change={comparison.totalChange} changeRatio={comparison.totalChangeRatio} />
              </div>
              <p className="mt-2 text-lg font-bold text-slate-700">
                {formatCurrency(Math.abs(comparison.totalChange))}
                <span className="text-xs text-slate-500 ml-1">{comparison.totalChange <= 0 ? "減" : "増"}</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                前月: {formatCurrency(comparison.previousTotal)}
              </p>
            </div>
          )}

          {/* 前年比カード */}
          {hasPreviousYearData && yearComparison && (
            <div className={`rounded-2xl px-6 py-5 border shadow-lg ${
              yearComparison.totalChange <= 0
                ? "bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200/60"
                : "bg-gradient-to-br from-red-50 to-rose-50 border-red-200/60"
            }`}>
              <p className={`text-sm font-semibold ${yearComparison.totalChange <= 0 ? "text-emerald-700" : "text-red-700"}`}>
                前年比
              </p>
              <div className="mt-1 flex items-center gap-2">
                <ChangeIndicator change={yearComparison.totalChange} changeRatio={yearComparison.totalChangeRatio} />
              </div>
              <p className="mt-2 text-lg font-bold text-slate-700">
                {formatCurrency(Math.abs(yearComparison.totalChange))}
                <span className="text-xs text-slate-500 ml-1">{yearComparison.totalChange <= 0 ? "減" : "増"}</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                前年: {formatCurrency(yearComparison.previousTotal)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 勘定科目別サマリー（前月比付き）- 経費データがある場合のみ */}
      {(!isLinkedMode || hasExpenseDataForLinkedMonth) && comparison && comparison.accountComparisons.length > 0 && (
        <div>
          <h3 className="mb-4 text-lg font-bold text-slate-800">勘定科目別</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {comparison.accountComparisons.slice(0, 8).map((account) => {
              const style = accountCategoryStyles[account.category] || accountCategoryStyles["その他"];
              const Icon = style.icon;
              return (
                <div
                  key={account.category}
                  className={`group relative overflow-hidden rounded-2xl border ${style.border} bg-gradient-to-br ${style.bgGradient} p-5 shadow-lg hover:shadow-xl transition-all`}
                >
                  <div className="absolute right-0 top-0 h-20 w-20 translate-x-6 -translate-y-6 rounded-full bg-white/30 blur-2xl" />
                  <div className="relative">
                    <div className={`mb-3 inline-flex rounded-xl bg-white/80 p-2 shadow-sm ${style.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <p className={`text-sm font-semibold ${style.color}`}>{account.category}</p>
                    <p className="mt-2 text-2xl font-black text-slate-800">
                      {formatCurrency(account.currentAmount)}
                    </p>
                    {hasPreviousData && account.previousAmount > 0 && (
                      <div className="mt-2">
                        <ChangeIndicator change={account.change} changeRatio={account.changeRatio} />
                      </div>
                    )}
                    {hasPreviousData && account.previousAmount > 0 && (
                      <p className="mt-1 text-xs text-slate-500">
                        前月: {formatCurrency(account.previousAmount)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 構成比グラフ（横棒）- 経費データがある場合のみ */}
      {(!isLinkedMode || hasExpenseDataForLinkedMonth) && summary.accountSummaries.length > 0 && (
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
      )}

      {/* 仕入高の詳細（前月比付き）- 経費データがある場合のみ */}
      {(!isLinkedMode || hasExpenseDataForLinkedMonth) && summary.purchaseCategorySummaries.length > 0 && (
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
          {expandedSection === "purchase" && comparison && (
            <div className="p-6 space-y-4">
              {/* カテゴリ別（前月比付き） */}
              <div>
                <h4 className="mb-3 text-sm font-bold text-slate-700">品目カテゴリ別</h4>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {comparison.purchaseCategoryComparisons.map((cat) => (
                    <div
                      key={cat.category}
                      className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm hover:shadow-md transition-all"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${purchaseCategoryColors[cat.category] || purchaseCategoryColors["その他"]}`}>
                          {cat.category}
                        </span>
                      </div>
                      <p className="text-lg font-black text-slate-800">
                        {formatCurrency(cat.currentAmount)}
                      </p>
                      {hasPreviousData && cat.previousAmount > 0 && (
                        <div className="mt-2 space-y-1">
                          <ChangeIndicator change={cat.change} changeRatio={cat.changeRatio} />
                          <p className="text-xs text-slate-500">
                            前月: {formatCurrency(cat.previousAmount)}
                          </p>
                        </div>
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

      {/* 支払手数料の詳細（前月比付き）- 経費データがある場合のみ */}
      {(!isLinkedMode || hasExpenseDataForLinkedMonth) && summary.feeCategorySummaries.length > 0 && (
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
          {expandedSection === "fee" && comparison && (
            <div className="p-6">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {comparison.feeCategoryComparisons.map((cat) => (
                  <div
                    key={cat.category}
                    className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm hover:shadow-md transition-all"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${feeCategoryColors[cat.category] || feeCategoryColors["その他"]}`}>
                        {cat.category}
                      </span>
                    </div>
                    <p className="text-lg font-black text-slate-800">
                      {formatCurrency(cat.currentAmount)}
                    </p>
                    {hasPreviousData && cat.previousAmount > 0 && (
                      <div className="mt-2 space-y-1">
                        <ChangeIndicator change={cat.change} changeRatio={cat.changeRatio} />
                        <p className="text-xs text-slate-500">
                          前月: {formatCurrency(cat.previousAmount)}
                        </p>
                      </div>
                    )}
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
