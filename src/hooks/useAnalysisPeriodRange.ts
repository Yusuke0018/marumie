import { useCallback, useEffect, useState } from "react";
import {
  ANALYSIS_PERIOD_RANGE_STORAGE_KEY,
  type StoredPeriodRange,
} from "@/lib/analysisPeriod";

type UseAnalysisPeriodRangeOptions = {
  autoSelectLatest?: boolean;
  persistStart?: boolean;
  persistEnd?: boolean;
  singleMonth?: boolean;
};

export const useAnalysisPeriodRange = (
  availableMonths: string[],
  options: UseAnalysisPeriodRangeOptions = { autoSelectLatest: true },
) => {
  const [startMonth, setStartMonthState] = useState<string>("");
  const [endMonth, setEndMonthState] = useState<string>("");
  const [isInitialized, setIsInitialized] = useState(false);

  const autoSelectLatest = options.autoSelectLatest ?? true;
  const persistStart = options.persistStart !== false;
  const persistEnd = options.persistEnd !== false;
  const singleMonth = options.singleMonth !== false;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (isInitialized) {
      return;
    }
    if (availableMonths.length === 0) {
      return;
    }

    try {
      const stored = window.localStorage.getItem(ANALYSIS_PERIOD_RANGE_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as StoredPeriodRange | null;
        if (parsed) {
          const availableSet = new Set(availableMonths);
          const storedStart =
            parsed.startMonth && availableSet.has(parsed.startMonth)
              ? parsed.startMonth
              : "";
          const storedEnd =
            parsed.endMonth && availableSet.has(parsed.endMonth)
              ? parsed.endMonth
              : "";

          if (persistStart && storedStart) {
            setStartMonthState(storedStart);
          }
          if (storedEnd) {
            const normalizedEnd =
              storedStart && storedEnd < storedStart ? storedStart : storedEnd;
            setEndMonthState(normalizedEnd);
          } else if (persistEnd && parsed.endMonth === null) {
            setEndMonthState("");
          }
        }
      }
    } catch (error) {
      console.error("期間選択の復元に失敗しました:", error);
    } finally {
      setIsInitialized(true);
    }
  }, [availableMonths, isInitialized, persistEnd, persistStart]);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }
    if (availableMonths.length === 0) {
      if (startMonth || endMonth) {
        setStartMonthState("");
        setEndMonthState("");
      }
      return;
    }

    const availableSet = new Set(availableMonths);
    const normalizedStart =
      startMonth && availableSet.has(startMonth) ? startMonth : "";
    const normalizedEnd =
      endMonth && availableSet.has(endMonth) ? endMonth : "";
    const adjustedEnd =
      normalizedStart && normalizedEnd && normalizedEnd < normalizedStart
        ? normalizedStart
        : normalizedEnd;

    if (normalizedStart !== startMonth) {
      setStartMonthState(normalizedStart);
    }
    if (adjustedEnd !== endMonth) {
      setEndMonthState(adjustedEnd);
    }
  }, [availableMonths, endMonth, isInitialized, startMonth]);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }
    if (!singleMonth) {
      return;
    }
    const selected = endMonth || startMonth;
    if (!selected) {
      return;
    }
    if (startMonth !== selected) {
      setStartMonthState(selected);
    }
    if (endMonth !== selected) {
      setEndMonthState(selected);
    }
  }, [endMonth, isInitialized, singleMonth, startMonth]);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }
    if (!autoSelectLatest) {
      return;
    }
    if (availableMonths.length === 0) {
      return;
    }
    if (startMonth || endMonth) {
      return;
    }

    const latestMonth = availableMonths[availableMonths.length - 1];
    if (latestMonth) {
      setStartMonthState(latestMonth);
      setEndMonthState(latestMonth);
    }
  }, [availableMonths, endMonth, isInitialized, autoSelectLatest, startMonth]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!isInitialized) {
      return;
    }

    let existing: StoredPeriodRange | null = null;
    if (!persistStart || !persistEnd) {
      try {
        const rawExisting = window.localStorage.getItem(ANALYSIS_PERIOD_RANGE_STORAGE_KEY);
        if (rawExisting) {
          existing = JSON.parse(rawExisting) as StoredPeriodRange;
        }
      } catch (error) {
        console.warn("期間設定の既存値取得に失敗しました", error);
      }
    }

    const payload: StoredPeriodRange = {
      startMonth: persistStart ? (startMonth || null) : existing?.startMonth ?? null,
      endMonth: persistEnd ? (endMonth || null) : existing?.endMonth ?? null,
    };

    if (!payload.startMonth && !payload.endMonth) {
      window.localStorage.removeItem(ANALYSIS_PERIOD_RANGE_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(ANALYSIS_PERIOD_RANGE_STORAGE_KEY, JSON.stringify(payload));
  }, [endMonth, isInitialized, persistEnd, persistStart, startMonth]);

  const setStartMonth = useCallback((value: string) => {
    setStartMonthState(value);
  }, []);

  const setEndMonth = useCallback((value: string) => {
    setEndMonthState(value);
  }, []);

  const resetPeriod = useCallback(() => {
    setStartMonthState("");
    setEndMonthState("");
  }, []);

  return {
    startMonth,
    endMonth,
    setStartMonth,
    setEndMonth,
    resetPeriod,
    isInitialized,
  };
};
