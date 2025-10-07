/**
 * マルミエ - CSVファイルアップロードコンポーネント
 */

import { useState, useRef } from 'react';
import { useData } from '../contexts/DataContext';
import { parseListingInternal, parseListingGastroscopy } from '../parsers/listingParser';
import { parseSurveyOutpatient } from '../parsers/surveyParser';
import './FileUpload.css';

type FileType = 'listing-internal' | 'listing-gastroscopy' | 'survey-outpatient';

interface UploadStatus {
  type: FileType;
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
  errorCount?: number;
  warningCount?: number;
}

export function FileUpload() {
  const { setListingInternal, setListingGastroscopy, setSurveyOutpatient, setIsLoading } = useData();

  const [statuses, setStatuses] = useState<Record<FileType, UploadStatus>>({
    'listing-internal': { type: 'listing-internal', status: 'idle' },
    'listing-gastroscopy': { type: 'listing-gastroscopy', status: 'idle' },
    'survey-outpatient': { type: 'survey-outpatient', status: 'idle' }
  });

  const fileInputRefs = {
    'listing-internal': useRef<HTMLInputElement>(null),
    'listing-gastroscopy': useRef<HTMLInputElement>(null),
    'survey-outpatient': useRef<HTMLInputElement>(null)
  };

  const handleFileSelect = async (type: FileType, file: File) => {
    setStatuses(prev => ({
      ...prev,
      [type]: { type, status: 'loading', message: 'ファイル読み込み中...' }
    }));
    setIsLoading(true);

    try {
      const text = await file.text();

      let result;
      switch (type) {
        case 'listing-internal':
          result = parseListingInternal(text);
          setListingInternal(result.data, result.errors, result.warnings);
          break;
        case 'listing-gastroscopy':
          result = parseListingGastroscopy(text);
          setListingGastroscopy(result.data, result.errors, result.warnings);
          break;
        case 'survey-outpatient':
          result = parseSurveyOutpatient(text);
          setSurveyOutpatient(result.data, result.errors, result.warnings);
          break;
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
            status: 'success',
            message: `${result.data.length}件のデータを読み込みました`,
            errorCount: 0,
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
  };

  const getStatusIcon = (status: UploadStatus['status']) => {
    switch (status) {
      case 'loading': return '⏳';
      case 'success': return '✅';
      case 'error': return '❌';
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
        各種CSVファイルを選択してください。2025-10-02以降のデータが解析対象になります。
      </p>

      <div className="upload-grid">
        {/* リスティング - 内科 */}
        <div className={getStatusClass(statuses['listing-internal'].status)}>
          <div className="upload-header">
            <span className="upload-icon">{getStatusIcon(statuses['listing-internal'].status)}</span>
            <h3>リスティング - 内科</h3>
          </div>
          <input
            ref={fileInputRefs['listing-internal']}
            type="file"
            accept=".csv"
            onChange={(e) => handleFileChange('listing-internal', e)}
            className="file-input"
            id="file-listing-internal"
          />
          <label htmlFor="file-listing-internal" className="file-label">
            ファイルを選択
          </label>
          {statuses['listing-internal'].message && (
            <p className="upload-message">{statuses['listing-internal'].message}</p>
          )}
          {statuses['listing-internal'].warningCount! > 0 && (
            <p className="upload-warning">⚠️ {statuses['listing-internal'].warningCount}件の警告</p>
          )}
        </div>

        {/* リスティング - 胃カメラ */}
        <div className={getStatusClass(statuses['listing-gastroscopy'].status)}>
          <div className="upload-header">
            <span className="upload-icon">{getStatusIcon(statuses['listing-gastroscopy'].status)}</span>
            <h3>リスティング - 胃カメラ</h3>
          </div>
          <input
            ref={fileInputRefs['listing-gastroscopy']}
            type="file"
            accept=".csv"
            onChange={(e) => handleFileChange('listing-gastroscopy', e)}
            className="file-input"
            id="file-listing-gastroscopy"
          />
          <label htmlFor="file-listing-gastroscopy" className="file-label">
            ファイルを選択
          </label>
          {statuses['listing-gastroscopy'].message && (
            <p className="upload-message">{statuses['listing-gastroscopy'].message}</p>
          )}
          {statuses['listing-gastroscopy'].warningCount! > 0 && (
            <p className="upload-warning">⚠️ {statuses['listing-gastroscopy'].warningCount}件の警告</p>
          )}
        </div>

        {/* アンケート調査 - 外来 */}
        <div className={getStatusClass(statuses['survey-outpatient'].status)}>
          <div className="upload-header">
            <span className="upload-icon">{getStatusIcon(statuses['survey-outpatient'].status)}</span>
            <h3>アンケート調査 - 外来</h3>
          </div>
          <input
            ref={fileInputRefs['survey-outpatient']}
            type="file"
            accept=".csv"
            onChange={(e) => handleFileChange('survey-outpatient', e)}
            className="file-input"
            id="file-survey-outpatient"
          />
          <label htmlFor="file-survey-outpatient" className="file-label">
            ファイルを選択
          </label>
          {statuses['survey-outpatient'].message && (
            <p className="upload-message">{statuses['survey-outpatient'].message}</p>
          )}
          {statuses['survey-outpatient'].warningCount! > 0 && (
            <p className="upload-warning">⚠️ {statuses['survey-outpatient'].warningCount}件の警告</p>
          )}
        </div>
      </div>
    </div>
  );
}
