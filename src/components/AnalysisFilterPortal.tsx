"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ANALYSIS_FILTER_SLOT_ID } from "@/lib/analysisPeriod";

type AnalysisFilterPortalProps = {
  months: string[];
  startMonth: string;
  endMonth: string;
  onChangeStart: (value: string) => void;
  onChangeEnd: (value: string) => void;
  onReset?: () => void;
  label?: string;
  rightContent?: ReactNode;
  renderMonthLabel?: (month: string) => string;
};

export const AnalysisFilterPortal = ({
  months,
  startMonth,
  endMonth,
  onChangeStart,
  onChangeEnd,
  onReset,
  label,
  rightContent,
  renderMonthLabel,
}: AnalysisFilterPortalProps) => {
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setMountNode(document.getElementById(ANALYSIS_FILTER_SLOT_ID));
  }, []);

  if (!mountNode) {
    return null;
  }

  const formatMonth = renderMonthLabel ?? ((month: string) => month);

  const displayLabel =
    label && !label.includes("\n")
      ? label.replace(/\s*〜\s*/, "〜\n")
      : label;

  return createPortal(
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-slate-700">開始月:</label>
          <select
            value={startMonth}
            onChange={(event) => onChangeStart(event.target.value)}
            disabled={months.length === 0}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">選択してください</option>
            {months.map((month) => (
              <option key={month} value={month}>
                {formatMonth(month)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-slate-700">終了月:</label>
          <select
            value={endMonth}
            onChange={(event) => onChangeEnd(event.target.value)}
            disabled={months.length === 0}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">選択してください</option>
            {months.map((month) => (
              <option key={month} value={month}>
                {formatMonth(month)}
              </option>
            ))}
          </select>
        </div>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            期間をリセット
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {label && (
          <p className="text-[11px] text-slate-500">
            表示期間:{" "}
            <span className="whitespace-pre-line">
              {displayLabel}
            </span>
          </p>
        )}
        {rightContent}
      </div>
    </div>,
    mountNode,
  );
};
