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
    warnings
  } = useData();

  const sources = useMemo<SourceStatus[]>(() => {
    const specs = [
      { key: 'listingInternal', label: '内科リスティング', loaded: listingInternal.length > 0 },
      { key: 'listingGastroscopy', label: '胃カメラ', loaded: listingGastroscopy.length > 0 },
      { key: 'listingColonoscopy', label: '大腸カメラ', loaded: listingColonoscopy.length > 0 },
      { key: 'reservations', label: '予約ログ', loaded: reservations.length > 0 },
      { key: 'surveyOutpatient', label: '外来アンケート', loaded: surveyOutpatient.length > 0 },
      { key: 'surveyEndoscopy', label: '内視鏡アンケート', loaded: surveyEndoscopy.length > 0 }
    ];

    return specs.map(spec => {
      const errorCount = errors[spec.key]?.length ?? 0;
      const warningCount = warnings[spec.key]?.length ?? 0;

      let status: StatusState = 'idle';
      if (errorCount > 0) {
        status = 'error';
      } else if (warningCount > 0) {
        status = 'warning';
      } else if (spec.loaded) {
        status = 'ready';
      }

      return {
        ...spec,
        errorCount,
        warningCount,
        status
      };
    });
  }, [
    errors,
    warnings,
    listingInternal.length,
    listingGastroscopy.length,
    listingColonoscopy.length,
    reservations.length,
    surveyOutpatient.length,
    surveyEndoscopy.length
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
