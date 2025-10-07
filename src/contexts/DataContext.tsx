/**
 * マルミエ - データコンテキスト
 * アプリケーション全体のデータ状態管理
 */

import { createContext, useContext, useState, ReactNode } from 'react';
import {
  ListingRecord,
  SurveyRecord,
  ReservationRecord,
  ParseError,
  ParseWarning
} from '../types/dataTypes';
import { getMonthKeyJST } from '../utils/dateUtils';

interface DataState {
  // リスティングデータ
  listingInternal: ListingRecord[];
  listingGastroscopy: ListingRecord[];
  listingColonoscopy: ListingRecord[];

  // アンケートデータ
  surveyOutpatient: SurveyRecord[];
  surveyEndoscopy: SurveyRecord[];

  // 予約データ
  reservations: ReservationRecord[];

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
  setListingColonoscopy: (data: ListingRecord[], errors: ParseError[], warnings: ParseWarning[]) => void;
  setSurveyOutpatient: (data: SurveyRecord[], errors: ParseError[], warnings: ParseWarning[]) => void;
  setSurveyEndoscopy: (data: SurveyRecord[], errors: ParseError[], warnings: ParseWarning[]) => void;
  setReservations: (data: ReservationRecord[], errors: ParseError[], warnings: ParseWarning[]) => void;
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
  reservations: [],
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

  const setListingColonoscopy = (data: ListingRecord[], errors: ParseError[], warnings: ParseWarning[]) => {
    setState(prev => ({
      ...prev,
      listingColonoscopy: data,
      errors: { ...prev.errors, listingColonoscopy: errors },
      warnings: { ...prev.warnings, listingColonoscopy: warnings }
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

  const setSurveyEndoscopy = (data: SurveyRecord[], errors: ParseError[], warnings: ParseWarning[]) => {
    setState(prev => ({
      ...prev,
      surveyEndoscopy: data,
      errors: { ...prev.errors, surveyEndoscopy: errors },
      warnings: { ...prev.warnings, surveyEndoscopy: warnings }
    }));
  };

  const setReservations = (data: ReservationRecord[], errors: ParseError[], warnings: ParseWarning[]) => {
    setState(prev => ({
      ...prev,
      reservations: data,
      errors: { ...prev.errors, reservations: errors },
      warnings: { ...prev.warnings, reservations: warnings }
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

    state.listingInternal.forEach(record => monthSet.add(getMonthKeyJST(record.date)));
    state.listingGastroscopy.forEach(record => monthSet.add(getMonthKeyJST(record.date)));
    state.listingColonoscopy.forEach(record => monthSet.add(getMonthKeyJST(record.date)));
    state.surveyOutpatient.forEach(record => monthSet.add(getMonthKeyJST(record.date)));
    state.surveyEndoscopy.forEach(record => monthSet.add(getMonthKeyJST(record.date)));
    state.reservations.forEach(record => monthSet.add(getMonthKeyJST(record.dateTime)));

    return Array.from(monthSet).sort();
  };

  return (
    <DataContext.Provider value={{
      ...state,
      setListingInternal,
      setListingGastroscopy,
      setListingColonoscopy,
      setSurveyOutpatient,
      setSurveyEndoscopy,
      setReservations,
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
