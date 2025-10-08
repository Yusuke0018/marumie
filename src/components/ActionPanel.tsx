import { useMemo, useState } from 'react';
import { useData } from '../contexts/DataContext';
import { downloadSnapshotJson, downloadUnifiedCsv } from '../utils/exportUtils';
import { Modal } from './Modal';
import { usePdfExport } from '../hooks/usePdfExport';
import type { PdfSectionSelection, PdfExportOptions } from '../hooks/usePdfExport';
import './ActionPanel.css';

const DEFAULT_SECTIONS: PdfSectionSelection = {
  summary: true,
  listing: true,
  reservations: true,
  surveys: true,
  correlation: true,
  appendix: true
};

export function ActionPanel() {
  const {
    createSnapshot,
    persistSnapshot,
    autoRestoreEnabled,
    setAutoRestoreEnabled,
    lastSnapshotSavedAt
  } = useData();

  const { exportPdf, isGenerating, error: pdfError, resetError } = usePdfExport();

  const [isSaveOpen, setSaveOpen] = useState(false);
  const [isPdfOpen, setPdfOpen] = useState(false);

  const [saveJson, setSaveJson] = useState(true);
  const [saveCsv, setSaveCsv] = useState(false);
  const [autoRestore, setAutoRestore] = useState(autoRestoreEnabled);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [orientation, setOrientation] = useState<PdfExportOptions['orientation']>('landscape');
  const [colorMode, setColorMode] = useState<PdfExportOptions['colorMode']>('color');
  const [sections, setSections] = useState<PdfSectionSelection>(DEFAULT_SECTIONS);
  const [pdfLocalError, setPdfLocalError] = useState<string | null>(null);

  const lastSavedLabel = useMemo(() => {
    if (!lastSnapshotSavedAt) {
      return '未保存';
    }
    return new Date(lastSnapshotSavedAt).toLocaleString('ja-JP', { hour12: false });
  }, [lastSnapshotSavedAt]);

  const openSaveModal = () => {
    setSaveJson(true);
    setSaveCsv(false);
    setAutoRestore(autoRestoreEnabled);
    setSaveError(null);
    setIsSaving(false);
    setSaveOpen(true);
  };

  const openPdfModal = () => {
    setOrientation('landscape');
    setColorMode('color');
    setSections(DEFAULT_SECTIONS);
    setPdfLocalError(null);
    resetError();
    setPdfOpen(true);
  };

  const handleSave = async () => {
    if (!saveJson && !saveCsv) {
      setSaveError('保存形式を1つ以上選択してください。');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const snapshot = createSnapshot();

      if (saveJson) {
        downloadSnapshotJson(snapshot);
      }
      if (saveCsv) {
        downloadUnifiedCsv(snapshot);
      }

      persistSnapshot(snapshot, autoRestore);

      if (autoRestore !== autoRestoreEnabled) {
        setAutoRestoreEnabled(autoRestore);
      }

      setSaveOpen(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSection = (key: keyof PdfSectionSelection) => {
    setSections(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleExportPdf = async () => {
    if (!Object.values(sections).some(Boolean)) {
      setPdfLocalError('出力するセクションを選択してください。');
      return;
    }

    setPdfLocalError(null);

    try {
      await exportPdf({ orientation, colorMode, sections });
      setPdfOpen(false);
    } catch (error) {
      setPdfLocalError(error instanceof Error ? error.message : 'PDF出力に失敗しました。');
    }
  };

  const sectionLabel = (key: keyof PdfSectionSelection) => {
    switch (key) {
      case 'summary':
        return 'サマリー';
      case 'listing':
        return 'リスティング分析';
      case 'reservations':
        return '予約分析';
      case 'surveys':
        return 'アンケート分析';
      case 'correlation':
        return '相関分析';
      case 'appendix':
        return '付録';
      default:
        return key;
    }
  };

  return (
    <div className="action-panel">
      <div className="action-panel__buttons">
        <button type="button" className="action-button" onClick={openSaveModal}>
          💾 データ保存
        </button>
        <button
          type="button"
          className="action-button action-button--primary"
          onClick={openPdfModal}
          disabled={isGenerating}
        >
          📄 PDFレポート出力
        </button>
      </div>
      <span className="action-panel__meta">最終保存: {lastSavedLabel}</span>

      {isSaveOpen && (
        <Modal
          title="データ保存"
          onClose={() => setSaveOpen(false)}
          footer={(
            <>
              <button type="button" className="btn-secondary" onClick={() => setSaveOpen(false)}>
                キャンセル
              </button>
              <button type="button" className="btn-primary" onClick={handleSave} disabled={isSaving}>
                {isSaving ? '保存中...' : '保存する'}
              </button>
            </>
          )}
        >
          <div className="save-options">
            <fieldset>
              <legend>保存形式</legend>
              <label>
                <input
                  type="checkbox"
                  checked={saveJson}
                  onChange={() => setSaveJson(!saveJson)}
                />
                JSONスナップショット（再読み込み用）
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={saveCsv}
                  onChange={() => setSaveCsv(!saveCsv)}
                />
                統合CSV（共有用）
              </label>
            </fieldset>

            <label className="save-toggle">
              <input
                type="checkbox"
                checked={autoRestore}
                onChange={() => setAutoRestore(!autoRestore)}
              />
              保存後に自動復元を有効化（ブラウザのローカルに保持）
            </label>

            <p className="save-note">
              JSONは次回アクセス時の復元に利用できます。統合CSVは広告・予約・アンケートを一括で共有するための整理済みデータです。
            </p>

            {saveError && <p className="save-error">{saveError}</p>}
          </div>
        </Modal>
      )}

      {isPdfOpen && (
        <Modal
          title="PDFレポート出力"
          onClose={() => {
            setPdfOpen(false);
            resetError();
          }}
          width="wide"
          footer={(
            <>
              <button type="button" className="btn-secondary" onClick={() => setPdfOpen(false)} disabled={isGenerating}>
                キャンセル
              </button>
              <button type="button" className="btn-primary" onClick={handleExportPdf} disabled={isGenerating}>
                {isGenerating ? '生成中...' : '出力する'}
              </button>
            </>
          )}
        >
          <div className="pdf-options">
            <fieldset>
              <legend>出力設定</legend>
              <div className="option-row">
                <span>ページ向き</span>
                <div className="option-group">
                  <label>
                    <input
                      type="radio"
                      name="pdf-orientation"
                      value="portrait"
                      checked={orientation === 'portrait'}
                      onChange={() => setOrientation('portrait')}
                    />
                    縦向き
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="pdf-orientation"
                      value="landscape"
                      checked={orientation === 'landscape'}
                      onChange={() => setOrientation('landscape')}
                    />
                    横向き
                  </label>
                </div>
              </div>

              <div className="option-row">
                <span>カラーモード</span>
                <div className="option-group">
                  <label>
                    <input
                      type="radio"
                      name="pdf-color"
                      value="color"
                      checked={colorMode === 'color'}
                      onChange={() => setColorMode('color')}
                    />
                    カラー
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="pdf-color"
                      value="mono"
                      checked={colorMode === 'mono'}
                      onChange={() => setColorMode('mono')}
                    />
                    モノクロ
                  </label>
                </div>
              </div>
            </fieldset>

            <fieldset>
              <legend>出力セクション</legend>
              <div className="section-grid">
                {Object.entries(sections).map(([key, value]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={() => toggleSection(key as keyof PdfSectionSelection)}
                    />
                    {sectionLabel(key as keyof PdfSectionSelection)}
                  </label>
                ))}
              </div>
            </fieldset>

            {pdfLocalError && <p className="save-error">{pdfLocalError}</p>}
            {pdfError && <p className="save-error">{pdfError}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
