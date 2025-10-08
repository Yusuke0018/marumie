/**
 * マルミエ - CSVファイルアップロードコンポーネント
 */

import { useState, useRef } from 'react';
import type { RefObject } from 'react';
import { useData } from '../contexts/DataContext';
import {
  parseListingInternal,
  parseListingGastroscopy,
  parseListingColonoscopy
} from '../parsers/listingParser';
import { parseSurveyOutpatient, parseSurveyEndoscopy } from '../parsers/surveyParser';
import { parseReservations } from '../parsers/reservationParser';
import {
  ParseResult,
  ListingRecord,
  SurveyRecord,
  ReservationRecord,
  ParseError,
  ParseWarning
} from '../types/dataTypes';
import { parseSnapshotJson } from '../utils/snapshotUtils';
import './FileUpload.css';

const SNAPSHOT_DATASET_KEYS = [
  'listingInternal',
  'listingGastroscopy',
  'listingColonoscopy',
  'reservations',
  'surveyOutpatient',
  'surveyEndoscopy'
] as const;

type SnapshotDatasetKey = typeof SNAPSHOT_DATASET_KEYS[number];

type FileType =
  | 'listing-internal'
  | 'listing-gastroscopy'
  | 'listing-colonoscopy'
  | 'reservations'
  | 'survey-outpatient'
  | 'survey-endoscopy'
  | 'snapshot';

type FileCategory = 'listing' | 'reservation' | 'survey' | 'snapshot';

interface UploadStatus {
  type: FileType;
  status: 'idle' | 'loading' | 'success' | 'error' | 'warning';
  message?: string;
  errorCount?: number;
  warningCount?: number;
}

interface FileConfig {
  type: FileType;
  title: string;
  subtitle: string;
  helper?: string;
  category: FileCategory;
  accept?: string;
}

const FILE_CONFIGS: FileConfig[] = [
  {
    type: 'listing-internal',
    title: 'リスティング - 内科',
    subtitle: '費用・CV・CPAと時間帯別CVを含むCSV',
    category: 'listing'
  },
  {
    type: 'listing-gastroscopy',
    title: 'リスティング - 胃カメラ',
    subtitle: '費用・CV・CPAと時間帯別CVを含むCSV',
    category: 'listing'
  },
  {
    type: 'listing-colonoscopy',
    title: 'リスティング - 大腸カメラ',
    subtitle: '費用・CV・CPAと時間帯別CVを含むCSV',
    category: 'listing'
  },
  {
    type: 'reservations',
    title: '予約ログ',
    subtitle: '診療科・初再診・予約日時を含むCSV',
    helper: '例: 予約確認 - 予約ログ.csv',
    category: 'reservation'
  },
  {
    type: 'survey-outpatient',
    title: 'アンケート調査 - 外来',
    subtitle: 'チャネル別流入データ',
    category: 'survey'
  },
  {
    type: 'survey-endoscopy',
    title: 'アンケート調査 - 内視鏡',
    subtitle: 'チャネル別流入データ',
    category: 'survey'
  },
  {
    type: 'snapshot',
    title: '保存データ復元',
    subtitle: 'JSONスナップショットから一括復元します',
    helper: '例: marumie_data_20251015.json',
    category: 'snapshot',
    accept: '.json'
  }
];

const CATEGORY_LABELS: Record<FileCategory, string> = {
  listing: 'リスティング広告データ',
  reservation: '予約ログデータ',
  survey: 'アンケート調査データ',
  snapshot: '復元オプション'
};

const categoryOrder: FileCategory[] = ['listing', 'reservation', 'survey', 'snapshot'];

function createInitialStatuses(): Record<FileType, UploadStatus> {
  return FILE_CONFIGS.reduce((acc, config) => {
    acc[config.type] = { type: config.type, status: 'idle' };
    return acc;
  }, {} as Record<FileType, UploadStatus>);
}

export function FileUpload() {
  const {
    setListingInternal,
    setListingGastroscopy,
    setListingColonoscopy,
    setSurveyOutpatient,
    setSurveyEndoscopy,
    setReservations,
    setIsLoading,
    restoreSnapshot,
    persistSnapshot,
    autoRestoreEnabled
  } = useData();

  const [statuses, setStatuses] = useState<Record<FileType, UploadStatus>>(createInitialStatuses());

  const fileInputRefs: Record<FileType, RefObject<HTMLInputElement>> = {
    'listing-internal': useRef(null),
    'listing-gastroscopy': useRef(null),
    'listing-colonoscopy': useRef(null),
    reservations: useRef(null),
    'survey-outpatient': useRef(null),
    'survey-endoscopy': useRef(null),
    snapshot: useRef(null)
  };

  const handleFileSelect = async (type: FileType, file: File) => {
    setStatuses(prev => ({
      ...prev,
      [type]: { type, status: 'loading', message: 'ファイル読み込み中...' }
    }));
    setIsLoading(true);

    try {
      const text = await file.text();

      if (type === 'snapshot') {
        const snapshot = parseSnapshotJson(text);
        const counts = restoreSnapshot(snapshot);
        persistSnapshot(snapshot, autoRestoreEnabled);

        const parsedDate = snapshot.savedAt ? new Date(snapshot.savedAt) : new Date();
        const errorsMap = snapshot.errors as Record<SnapshotDatasetKey, ParseError[]>;
        const warningsMap = snapshot.warnings as Record<SnapshotDatasetKey, ParseWarning[]>;
        const warningTotal = SNAPSHOT_DATASET_KEYS.reduce(
          (sum, key) => sum + (warningsMap[key]?.length ?? 0),
          0
        );

        setStatuses(prev => {
          const next = { ...prev };
          next.snapshot = {
            type: 'snapshot',
            status: 'success',
            message: `保存日時: ${parsedDate.toLocaleString('ja-JP', { hour12: false })}`,
            errorCount: 0,
            warningCount: warningTotal
          };

          const datasetMap: Array<{
            type: Exclude<FileType, 'snapshot'>;
            key: SnapshotDatasetKey;
            count: number;
          }> = [
            { type: 'listing-internal', key: 'listingInternal', count: counts.listingInternal },
            { type: 'listing-gastroscopy', key: 'listingGastroscopy', count: counts.listingGastroscopy },
            { type: 'listing-colonoscopy', key: 'listingColonoscopy', count: counts.listingColonoscopy },
            { type: 'reservations', key: 'reservations', count: counts.reservations },
            { type: 'survey-outpatient', key: 'surveyOutpatient', count: counts.surveyOutpatient },
            { type: 'survey-endoscopy', key: 'surveyEndoscopy', count: counts.surveyEndoscopy }
          ];

          datasetMap.forEach(item => {
            const errorCount = errorsMap[item.key]?.length ?? 0;
            const warningCount = warningsMap[item.key]?.length ?? 0;

            let status: UploadStatus['status'] = 'idle';
            if (errorCount > 0) {
              status = 'error';
            } else if (item.count > 0) {
              status = 'success';
            } else if (warningCount > 0) {
              status = 'warning';
            }

            const message =
              item.count > 0
                ? `${item.count}件を復元しました`
                : errorCount > 0
                  ? errorsMap[item.key]?.[0]?.message ?? 'エラーが発生しました'
                  : 'データ未読み込み';

            next[item.type] = {
              type: item.type,
              status,
              message,
              errorCount,
              warningCount
            };
          });

          return next;
        });
        return;
      }

      let result: ParseResult<unknown>;

      switch (type) {
        case 'listing-internal':
          result = parseListingInternal(text);
          setListingInternal(result.data as ListingRecord[], result.errors, result.warnings);
          break;
        case 'listing-gastroscopy':
          result = parseListingGastroscopy(text);
          setListingGastroscopy(result.data as ListingRecord[], result.errors, result.warnings);
          break;
        case 'listing-colonoscopy':
          result = parseListingColonoscopy(text);
          setListingColonoscopy(result.data as ListingRecord[], result.errors, result.warnings);
          break;
        case 'reservations':
          result = parseReservations(text);
          setReservations(result.data as ReservationRecord[], result.errors, result.warnings);
          break;
        case 'survey-outpatient':
          result = parseSurveyOutpatient(text);
          setSurveyOutpatient(result.data as SurveyRecord[], result.errors, result.warnings);
          break;
        case 'survey-endoscopy':
          result = parseSurveyEndoscopy(text);
          setSurveyEndoscopy(result.data as SurveyRecord[], result.errors, result.warnings);
          break;
        default:
          result = { data: [], errors: [], warnings: [] } as ParseResult<unknown>;
      }

      if (result.errors.length > 0) {
        setStatuses(prev => ({
          ...prev,
          [type]: {
            type,
            status: 'error',
            message: result.errors[0].message,
            errorCount: result.errors.length,
            warningCount: result.warnings.length
          }
        }));
      } else {
        setStatuses(prev => ({
          ...prev,
          [type]: {
            type,
            status: result.warnings.length > 0 ? 'warning' : 'success',
            message: `${result.data.length}件のデータを読み込みました`,
            errorCount: result.errors.length,
            warningCount: result.warnings.length
          }
        }));
      }
    } catch (error) {
      setStatuses(prev => ({
        ...prev,
        [type]: {
          type,
          status: 'error',
          message: error instanceof Error ? error.message : 'ファイル読み込みエラー'
        }
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (type: FileType, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileSelect(type, file);
    }
    event.target.value = '';
  };

  const getStatusIcon = (status: UploadStatus['status']) => {
    switch (status) {
      case 'loading': return '⏳';
      case 'success': return '✅';
      case 'error': return '❌';
      case 'warning': return '⚠️';
      default: return '📄';
    }
  };

  const getStatusClass = (status: UploadStatus['status']) => {
    return `upload-card upload-card-${status}`;
  };

  return (
    <div className="file-upload-container">
      <h2>CSVファイル読み込み</h2>
      <p className="upload-description">
        各種CSVファイル、または保存済みJSONを選択してください。2025-10-02以降のデータが解析対象になります。
      </p>

      <div className="upload-grid">
        {categoryOrder.map(category => {
          const configs = FILE_CONFIGS.filter(config => config.category === category);
          return (
            <section key={category} className="upload-section">
              <header className="upload-section-header">
                <h3>{CATEGORY_LABELS[category]}</h3>
              </header>
              <div className="upload-section-grid">
                {configs.map(config => {
                  const status = statuses[config.type];
                  return (
                    <div key={config.type} className={getStatusClass(status.status)}>
                      <div className="upload-header">
                        <span className="upload-icon">{getStatusIcon(status.status)}</span>
                        <div>
                          <h4>{config.title}</h4>
                          <p className="upload-subtitle">{config.subtitle}</p>
                        </div>
                      </div>
                      {config.helper && (
                        <p className="upload-helper">{config.helper}</p>
                      )}
                      <input
                        ref={fileInputRefs[config.type]}
                        type="file"
                        accept={config.accept ?? '.csv'}
                        onChange={(e) => handleFileChange(config.type, e)}
                        className="file-input"
                        id={`file-${config.type}`}
                      />
                      <label htmlFor={`file-${config.type}`} className="file-label">
                        ファイルを選択
                      </label>
                      {status.message && (
                        <p className="upload-message">{status.message}</p>
                      )}
                      {status.errorCount && status.errorCount > 0 && (
                        <p className="upload-error">❗ {status.errorCount}件のエラー</p>
                      )}
                      {status.warningCount && status.warningCount > 0 && status.errorCount === 0 && (
                        <p className="upload-warning">⚠️ {status.warningCount}件の警告</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
