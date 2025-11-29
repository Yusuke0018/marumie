"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ANALYSIS_FILTER_SLOT_ID } from "@/lib/analysisPeriod";

type SalesMonthPortalProps = {
  months: { id: string; label: string }[];
  selectedMonthId: string | null;
  onChangeMonth: (id: string) => void;
  displayLabel?: string;
};

export const SalesMonthPortal = ({
  months,
  selectedMonthId,
  onChangeMonth,
  displayLabel,
}: SalesMonthPortalProps) => {
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

  return createPortal(
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-slate-700">表示月:</label>
          <select
            value={selectedMonthId ?? ""}
            onChange={(event) => onChangeMonth(event.target.value)}
            disabled={months.length === 0}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-brand-300 focus:border-brand-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">選択してください</option>
            {months.map((month) => (
              <option key={month.id} value={month.id}>
                {month.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {displayLabel && (
        <p className="text-[11px] text-slate-500">
          表示中: <span className="font-semibold text-slate-700">{displayLabel}</span>
        </p>
      )}
    </div>,
    mountNode,
  );
};
