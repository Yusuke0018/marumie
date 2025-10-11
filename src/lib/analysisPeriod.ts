export const ANALYSIS_PERIOD_RANGE_STORAGE_KEY = "marumie/analysis/periodRange";
export const ANALYSIS_PERIOD_LABEL_STORAGE_KEY = "marumie/analysis/periodLabel";
export const ANALYSIS_PERIOD_EVENT = "analysis:period-change";
export const ANALYSIS_FILTER_SLOT_ID = "analysis-filter-slot";

export type StoredPeriodRange = {
  startMonth: string | null;
  endMonth: string | null;
};

export const setAnalysisPeriodLabel = (label: string | null) => {
  if (typeof window === "undefined") {
    return;
  }

  if (label && label.length > 0) {
    window.localStorage.setItem(ANALYSIS_PERIOD_LABEL_STORAGE_KEY, label);
  } else {
    window.localStorage.removeItem(ANALYSIS_PERIOD_LABEL_STORAGE_KEY);
  }

  window.dispatchEvent(
    new CustomEvent(ANALYSIS_PERIOD_EVENT, {
      detail: { label },
    }),
  );
};

export const getAnalysisPeriodLabel = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(ANALYSIS_PERIOD_LABEL_STORAGE_KEY);
};
