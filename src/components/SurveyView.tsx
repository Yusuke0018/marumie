/**
 * アンケート調査分析ビュー
 */

import { useMemo, useState } from 'react';
import { useData } from '../contexts/DataContext';
import { getMonthKeyJST } from '../utils/dateUtils';
import { SurveyChart } from './charts/SurveyChart';
import type { SurveyRecord, SurveyType } from '../types/dataTypes';
import './SurveyView.css';

interface SurveyConfig {
  type: SurveyType;
  label: string;
  accent: string;
  description: string;
}

const SURVEY_CONFIG: SurveyConfig[] = [
  {
    type: 'outpatient',
    label: '外来アンケート',
    accent: '#4b6cff',
    description: '来院患者の流入チャネルを把握し、広告施策の質を検証します。'
  },
  {
    type: 'endoscopy',
    label: '内視鏡アンケート',
    accent: '#16a085',
    description: '内視鏡・ドック利用者の流入チャネルを分析します。'
  }
];

interface ChannelSummary {
  name: string;
  value: number;
}

function filterSurveyByMonth(records: SurveyRecord[], month: string | null): SurveyRecord[] {
  if (!month) return records;
  return records.filter(record => getMonthKeyJST(record.date) === month);
}

function aggregateChannels(records: SurveyRecord[]): ChannelSummary[] {
  const totals: Record<string, number> = {};

  records.forEach(record => {
    Object.entries(record.channels).forEach(([channel, count]) => {
      if (count !== null) {
        totals[channel] = (totals[channel] ?? 0) + count;
      }
    });
  });

  return Object.entries(totals)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export function SurveyView() {
  const {
    surveyOutpatient,
    surveyEndoscopy,
    selectedMonth,
    errors,
    warnings
  } = useData();

  const [activeType, setActiveType] = useState<SurveyType>('outpatient');

  const surveySources = useMemo(() => ({
    outpatient: surveyOutpatient,
    endoscopy: surveyEndoscopy
  }), [surveyOutpatient, surveyEndoscopy]);

  const activeConfig = SURVEY_CONFIG.find(config => config.type === activeType)!;
  const filteredRecords = useMemo(
    () => filterSurveyByMonth(surveySources[activeType], selectedMonth),
    [surveySources, activeType, selectedMonth]
  );

  const channelSummary = useMemo(
    () => aggregateChannels(filteredRecords),
    [filteredRecords]
  );

  const totalResponses = useMemo(
    () => channelSummary.reduce((sum, item) => sum + item.value, 0),
    [channelSummary]
  );

  const topChannel = channelSummary[0];
  const datasetErrors = errors[`survey${activeType[0].toUpperCase()}${activeType.slice(1)}`] ?? [];
  const datasetWarnings = warnings[`survey${activeType[0].toUpperCase()}${activeType.slice(1)}`] ?? [];

  if (filteredRecords.length === 0) {
    return (
      <div className="survey-view survey-view--empty">
        <p className="placeholder-label">
          {activeConfig.label}のアンケートデータがありません。CSVを読み込み、タブを切り替えてご確認ください。
        </p>
      </div>
    );
  }

  return (
    <div className="survey-view">
      <div className="survey-header">
        <div className="survey-tabs">
          {SURVEY_CONFIG.map(config => {
            const count = surveySources[config.type].length;
            return (
              <button
                key={config.type}
                type="button"
                className={`survey-tab ${config.type === activeType ? 'is-active' : ''}`}
                onClick={() => setActiveType(config.type)}
              >
                <span className="survey-tab__label">{config.label}</span>
                <span className="survey-tab__count">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="survey-alerts">
          {datasetErrors.length > 0 && (
            <span className="survey-alert survey-alert--error">❌ {datasetErrors[0].message}</span>
          )}
          {datasetWarnings.length > 0 && (
            <span className="survey-alert survey-alert--warning">
              ⚠️ {datasetWarnings.length}件の警告
            </span>
          )}
        </div>
      </div>
      <p className="survey-description">{activeConfig.description}</p>

      <div className="survey-summary">
        <div className="survey-card" style={{ borderTopColor: activeConfig.accent }}>
          <span className="survey-card__label">総回答数</span>
          <strong className="survey-card__value">{totalResponses}</strong>
          <span className="survey-card__caption">有効なチャネル数: {channelSummary.length}</span>
        </div>
        <div className="survey-card">
          <span className="survey-card__label">回答日数</span>
          <strong className="survey-card__value">{filteredRecords.length}</strong>
          <span className="survey-card__caption">本期間で回答が確認できた日数</span>
        </div>
        <div className="survey-card">
          <span className="survey-card__label">トップチャネル</span>
          <strong className="survey-card__value">{topChannel?.name ?? '-'}</strong>
          <span className="survey-card__caption">
            {topChannel ? `${topChannel.value}件` : 'データなし'}
          </span>
        </div>
      </div>

      <SurveyChart
        channelData={channelSummary}
        title={`${activeConfig.label} - チャネル別割合`}
        totalResponses={totalResponses}
        validDays={filteredRecords.length}
      />
    </div>
  );
}
