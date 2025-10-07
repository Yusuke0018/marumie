/**
 * マルミエ - アンケート調査分析ビューコンポーネント
 */

import { useMemo } from 'react';
import { useData } from '../contexts/DataContext';
import { SurveyChart } from './charts/SurveyChart';
import './SurveyView.css';

export function SurveyView() {
  const { surveyOutpatient, selectedMonth } = useData();

  const filteredData = useMemo(() => {
    if (!selectedMonth) return surveyOutpatient;
    return surveyOutpatient.filter(record => {
      const month = record.date.toISOString().substring(0, 7);
      return month === selectedMonth;
    });
  }, [surveyOutpatient, selectedMonth]);

  const channelSummary = useMemo(() => {
    const channelTotals: Record<string, number> = {};

    filteredData.forEach(record => {
      Object.entries(record.channels).forEach(([channel, count]) => {
        if (count !== null) {
          channelTotals[channel] = (channelTotals[channel] || 0) + count;
        }
      });
    });

    return Object.entries(channelTotals).map(([name, value]) => ({ name, value }));
  }, [filteredData]);

  const totalResponses = useMemo(() => {
    return channelSummary.reduce((sum, item) => sum + item.value, 0);
  }, [channelSummary]);

  if (filteredData.length === 0) {
    return (
      <div className="survey-view-empty">
        <p>📊 アンケートデータがありません</p>
        <p>CSVファイルを読み込んでください</p>
      </div>
    );
  }

  return (
    <div className="survey-view-container">
      <h2>アンケート分析 - 外来</h2>

      <SurveyChart
        channelData={channelSummary}
        title="チャネル別流入割合"
        totalResponses={totalResponses}
        validDays={filteredData.length}
      />
    </div>
  );
}
