/**
 * データセット読み込み状況サマリー
 */

import { useMemo } from 'react';
import { useData } from '../contexts/DataContext';
import './DataStatusSummary.css';

type StatusState = 'idle' | 'ready' | 'warning' | 'error';

interface SourceStatus {
  key: string;
  label: string;
  loaded: boolean;
  errorCount: number;
  warningCount: number;
  status: StatusState;
  metaText?: string;
}

interface StatusSpec {
  key: string;
  label: string;
  loaded: boolean;
  errorKey?: string;
  metaText?: string;
  explicitStatus?: StatusState;
}

export function DataStatusSummary() {
  const {
    listingInternal,
    listingGastroscopy,
    listingColonoscopy,
    reservations,
    surveyOutpatient,
    surveyEndoscopy,
    errors,
    warnings,
    lastSnapshotSavedAt,
    autoRestoreEnabled
  } = useData();

  const sources = useMemo<SourceStatus[]>(() => {
    const snapshotLoaded = Boolean(lastSnapshotSavedAt);
    const snapshotMeta = snapshotLoaded
      ? new Date(lastSnapshotSavedAt as string).toLocaleString('ja-JP', { hour12: false })
      : autoRestoreEnabled
        ? '自動復元ON'
        : undefined;

    const hasListingData = listingInternal.length + listingGastroscopy.length + listingColonoscopy.length > 0;
    const hasReservationData = reservations.length > 0;
    const hasSurveyData = surveyOutpatient.length + surveyEndoscopy.length > 0;
    const canGeneratePdf = hasListingData || hasReservationData || hasSurveyData;

    const specs: StatusSpec[] = [
      { key: 'listingInternal', label: '内科リスティング', loaded: listingInternal.length > 0, errorKey: 'listingInternal' },
      { key: 'listingGastroscopy', label: '胃カメラ', loaded: listingGastroscopy.length > 0, errorKey: 'listingGastroscopy' },
      { key: 'listingColonoscopy', label: '大腸カメラ', loaded: listingColonoscopy.length > 0, errorKey: 'listingColonoscopy' },
      { key: 'reservations', label: '予約ログ', loaded: reservations.length > 0, errorKey: 'reservations' },
      { key: 'surveyOutpatient', label: '外来アンケート', loaded: surveyOutpatient.length > 0, errorKey: 'surveyOutpatient' },
      { key: 'surveyEndoscopy', label: '内視鏡アンケート', loaded: surveyEndoscopy.length > 0, errorKey: 'surveyEndoscopy' },
      {
        key: 'snapshot',
        label: '保存データ',
        loaded: snapshotLoaded,
        metaText: snapshotMeta,
        explicitStatus: snapshotLoaded ? 'ready' : (autoRestoreEnabled ? 'warning' : 'idle')
      },
      {
        key: 'pdfReady',
        label: 'PDF出力',
        loaded: canGeneratePdf,
        metaText: canGeneratePdf ? '出力可能' : 'データ不足',
        explicitStatus: canGeneratePdf ? 'ready' : 'warning'
      }
    ];

    return specs.map(spec => {
      const errorCount = spec.errorKey ? errors[spec.errorKey]?.length ?? 0 : 0;
      const warningCount = spec.errorKey ? warnings[spec.errorKey]?.length ?? 0 : 0;

      let status: StatusState = spec.explicitStatus ?? 'idle';
      if (spec.explicitStatus === undefined) {
        if (errorCount > 0) {
          status = 'error';
        } else if (warningCount > 0) {
          status = 'warning';
        } else if (spec.loaded) {
          status = 'ready';
        }
      }

      return {
        key: spec.key,
        label: spec.label,
        loaded: spec.loaded,
        errorCount,
        warningCount,
        status,
        metaText: spec.metaText
      };
    });
  }, [
    listingInternal.length,
    listingGastroscopy.length,
    listingColonoscopy.length,
    reservations.length,
    surveyOutpatient.length,
    surveyEndoscopy.length,
    errors,
    warnings,
    lastSnapshotSavedAt,
    autoRestoreEnabled
  ]);

  const loadedCount = sources.filter(source => source.loaded).length;

  return (
    <div className="status-summary">
      <div className="status-summary__header">
        <span className="status-summary__title">データセット状態</span>
        <span className="status-summary__count">
          {loadedCount} / {sources.length} 読み込み済み
        </span>
      </div>
      <div className="status-summary__pills">
        {sources.map(source => (
          <div key={source.key} className={`status-pill status-pill-${source.status}`}>
            <span className="status-pill__indicator" />
            <span className="status-pill__label">{source.label}</span>
            {source.metaText && (
              <span className="status-pill__detail">{source.metaText}</span>
            )}
            {source.errorCount > 0 && (
              <span className="status-pill__meta">エラー {source.errorCount}</span>
            )}
            {source.warningCount > 0 && source.errorCount === 0 && (
              <span className="status-pill__meta">警告 {source.warningCount}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
