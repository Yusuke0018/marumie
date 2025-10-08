/**
 * マルミエ - データコンテキスト
 * アプリケーション全体のデータ状態管理
 */

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  ListingRecord,
  SurveyRecord,
  ReservationRecord,
  ParseError,
  ParseWarning
} from '../types/dataTypes';
import { getMonthKeyJST } from '../utils/dateUtils';
import type { MarumieSnapshot } from '../types/snapshot';
import { toSnapshot, fromSnapshot, parseSnapshotJson } from '../utils/snapshotUtils';

const SNAPSHOT_STORAGE_KEY = 'marumie:snapshot:v2';
const SNAPSHOT_AUTO_KEY = 'marumie:autoRestore:v2';

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

  // スナップショット設定
  autoRestoreEnabled: boolean;
  lastSnapshotSavedAt: string | null;
}

interface RestoreCounts {
  listingInternal: number;
  listingGastroscopy: number;
  listingColonoscopy: number;
  reservations: number;
  surveyOutpatient: number;
  surveyEndoscopy: number;
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
  setAutoRestoreEnabled: (enabled: boolean) => void;
  clearAllData: () => void;
  getAvailableMonths: () => string[];
  createSnapshot: () => MarumieSnapshot;
  restoreSnapshot: (snapshot: MarumieSnapshot) => RestoreCounts;
  persistSnapshot: (snapshot: MarumieSnapshot, storeToLocal: boolean) => void;
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
  autoRestoreEnabled: false,
  lastSnapshotSavedAt: null,
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

  const setAutoRestoreEnabled = (enabled: boolean) => {
    setState(prev => ({ ...prev, autoRestoreEnabled: enabled }));

    if (typeof window !== 'undefined') {
      if (enabled) {
        window.localStorage.setItem(SNAPSHOT_AUTO_KEY, '1');
      } else {
        window.localStorage.removeItem(SNAPSHOT_AUTO_KEY);
        window.localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
      }
    }
  };

  const clearAllData = () => {
    setState(prev => ({
      ...initialState,
      autoRestoreEnabled: prev.autoRestoreEnabled,
      lastSnapshotSavedAt: prev.lastSnapshotSavedAt
    }));
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

  const createSnapshot = (): MarumieSnapshot => {
    return toSnapshot({
      listingInternal: state.listingInternal,
      listingGastroscopy: state.listingGastroscopy,
      listingColonoscopy: state.listingColonoscopy,
      surveyOutpatient: state.surveyOutpatient,
      surveyEndoscopy: state.surveyEndoscopy,
      reservations: state.reservations,
      errors: state.errors,
      warnings: state.warnings,
      selectedMonth: state.selectedMonth
    });
  };

  const persistSnapshot = (snapshot: MarumieSnapshot, storeToLocal: boolean) => {
    setState(prev => ({
      ...prev,
      lastSnapshotSavedAt: snapshot.savedAt ?? new Date().toISOString()
    }));

    if (typeof window !== 'undefined') {
      if (storeToLocal) {
        window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
      } else {
        window.localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
      }
    }
  };

  const restoreSnapshot = (snapshot: MarumieSnapshot): RestoreCounts => {
    const restored = fromSnapshot(snapshot);
    setState(prev => ({
      ...prev,
      listingInternal: restored.listingInternal,
      listingGastroscopy: restored.listingGastroscopy,
      listingColonoscopy: restored.listingColonoscopy,
      surveyOutpatient: restored.surveyOutpatient,
      surveyEndoscopy: restored.surveyEndoscopy,
      reservations: restored.reservations,
      errors: restored.errors,
      warnings: restored.warnings,
      selectedMonth: restored.selectedMonth,
      isLoading: false,
      autoRestoreEnabled: prev.autoRestoreEnabled,
      lastSnapshotSavedAt: snapshot.savedAt ?? new Date().toISOString()
    }));

    return {
      listingInternal: restored.listingInternal.length,
      listingGastroscopy: restored.listingGastroscopy.length,
      listingColonoscopy: restored.listingColonoscopy.length,
      reservations: restored.reservations.length,
      surveyOutpatient: restored.surveyOutpatient.length,
      surveyEndoscopy: restored.surveyEndoscopy.length
    };
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const enabled = window.localStorage.getItem(SNAPSHOT_AUTO_KEY) === '1';
    if (!enabled) {
      return;
    }

    const snapshotJson = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!snapshotJson) {
      setState(prev => ({ ...prev, autoRestoreEnabled: true }));
      return;
    }

    try {
      const snapshot = parseSnapshotJson(snapshotJson);
      const restored = fromSnapshot(snapshot);
      setState(prev => ({
        ...prev,
        ...restored,
        autoRestoreEnabled: true,
        lastSnapshotSavedAt: snapshot.savedAt ?? new Date().toISOString(),
        isLoading: false
      }));
    } catch (error) {
      console.warn('ローカル保存データの復元に失敗しました。', error);
      setState(prev => ({ ...prev, autoRestoreEnabled: true }));
    }
  }, []);

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
      setAutoRestoreEnabled,
      clearAllData,
      getAvailableMonths,
      createSnapshot,
      restoreSnapshot,
      persistSnapshot
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
