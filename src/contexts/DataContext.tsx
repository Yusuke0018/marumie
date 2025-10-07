/**
 * マルミエ - データコンテキスト
 * アプリケーション全体のデータ状態管理
 */

import { createContext, useContext, useState, ReactNode } from 'react';
import { ListingRecord, SurveyRecord, ParseError, ParseWarning } from '../types/dataTypes';

interface DataState {
  // リスティングデータ
  listingInternal: ListingRecord[];
  listingGastroscopy: ListingRecord[];
  listingColonoscopy: ListingRecord[];

  // アンケートデータ
  surveyOutpatient: SurveyRecord[];
  surveyEndoscopy: SurveyRecord[];

  // エラー・警告
  errors: Record<string, ParseError[]>;
  warnings: Record<string, ParseWarning[]>;

  // 選択中の月
  selectedMonth: string | null;

  // ロード状態
  isLoading: boolean;
}

interface DataContextType extends DataState {
  setListingInternal: (data: ListingRecord[], errors: ParseError[], warnings: ParseWarning[]) => void;
  setListingGastroscopy: (data: ListingRecord[], errors: ParseError[], warnings: ParseWarning[]) => void;
  setSurveyOutpatient: (data: SurveyRecord[], errors: ParseError[], warnings: ParseWarning[]) => void;
  setSelectedMonth: (month: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  clearAllData: () => void;
  getAvailableMonths: () => string[];
}

const DataContext = createContext<DataContextType | undefined>(undefined);

const initialState: DataState = {
  listingInternal: [],
  listingGastroscopy: [],
  listingColonoscopy: [],
  surveyOutpatient: [],
  surveyEndoscopy: [],
  errors: {},
  warnings: {},
  selectedMonth: null,
  isLoading: false,
};

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DataState>(initialState);

  const setListingInternal = (data: ListingRecord[], errors: ParseError[], warnings: ParseWarning[]) => {
    setState(prev => ({
      ...prev,
      listingInternal: data,
      errors: { ...prev.errors, listingInternal: errors },
      warnings: { ...prev.warnings, listingInternal: warnings }
    }));
  };

  const setListingGastroscopy = (data: ListingRecord[], errors: ParseError[], warnings: ParseWarning[]) => {
    setState(prev => ({
      ...prev,
      listingGastroscopy: data,
      errors: { ...prev.errors, listingGastroscopy: errors },
      warnings: { ...prev.warnings, listingGastroscopy: warnings }
    }));
  };

  const setSurveyOutpatient = (data: SurveyRecord[], errors: ParseError[], warnings: ParseWarning[]) => {
    setState(prev => ({
      ...prev,
      surveyOutpatient: data,
      errors: { ...prev.errors, surveyOutpatient: errors },
      warnings: { ...prev.warnings, surveyOutpatient: warnings }
    }));
  };

  const setSelectedMonth = (month: string | null) => {
    setState(prev => ({ ...prev, selectedMonth: month }));
  };

  const setIsLoading = (loading: boolean) => {
    setState(prev => ({ ...prev, isLoading: loading }));
  };

  const clearAllData = () => {
    setState(initialState);
  };

  const getAvailableMonths = (): string[] => {
    const monthSet = new Set<string>();

    [...state.listingInternal, ...state.listingGastroscopy, ...state.listingColonoscopy].forEach(record => {
      const month = record.date.toISOString().substring(0, 7);
      monthSet.add(month);
    });

    return Array.from(monthSet).sort();
  };

  return (
    <DataContext.Provider value={{
      ...state,
      setListingInternal,
      setListingGastroscopy,
      setSurveyOutpatient,
      setSelectedMonth,
      setIsLoading,
      clearAllData,
      getAvailableMonths
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within DataProvider');
  }
  return context;
}
