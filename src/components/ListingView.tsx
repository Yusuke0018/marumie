/**
 * マルミエ - リスティング分析ビューコンポーネント
 */

import { useMemo } from 'react';
import { useData } from '../contexts/DataContext';
import { ListingRecord } from '../types/dataTypes';
import { formatDateJST } from '../utils/dateUtils';
import { HourlyChart } from './charts/HourlyChart';
import { hasCPADiscrepancy } from '../utils/validation';
import './ListingView.css';

export function ListingView() {
  const { listingInternal, selectedMonth } = useData();

  const filteredData = useMemo(() => {
    if (!selectedMonth) return listingInternal;
    return listingInternal.filter(record => {
      const month = record.date.toISOString().substring(0, 7);
      return month === selectedMonth;
    });
  }, [listingInternal, selectedMonth]);

  const monthlySummary = useMemo(() => {
    const totalCV = filteredData.reduce((sum, r) => sum + (r.cv ?? 0), 0);
    const totalAmount = filteredData.reduce((sum, r) => sum + (r.amount ?? 0), 0);
    const validCVRs = filteredData.filter(r => r.cvr !== null).map(r => r.cvr!);
    const avgCVR = validCVRs.length > 0
      ? validCVRs.reduce((sum, cvr) => sum + cvr, 0) / validCVRs.length
      : 0;
    const avgCPA = totalCV > 0 ? totalAmount / totalCV : 0;

    return { totalCV, totalAmount, avgCVR, avgCPA, validDays: filteredData.length };
  }, [filteredData]);

  if (filteredData.length === 0) {
    return (
      <div className="listing-view-empty">
        <p>📊 リスティングデータがありません</p>
        <p>CSVファイルを読み込んでください</p>
      </div>
    );
  }

  return (
    <div className="listing-view-container">
      <h2>リスティング分析 - 内科</h2>

      {/* 月次サマリー */}
      <div className="monthly-summary">
        <div className="summary-card">
          <span className="summary-label">合計CV</span>
          <span className="summary-value">{monthlySummary.totalCV}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">総広告費</span>
          <span className="summary-value">¥{monthlySummary.totalAmount.toLocaleString()}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">平均CVR</span>
          <span className="summary-value">{(monthlySummary.avgCVR * 100).toFixed(1)}%</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">平均CPA</span>
          <span className="summary-value">¥{Math.round(monthlySummary.avgCPA).toLocaleString()}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">有効日数</span>
          <span className="summary-value">{monthlySummary.validDays}日</span>
        </div>
      </div>

      {/* 日別データカード */}
      <div className="daily-cards-grid">
        {filteredData.map((record, idx) => (
          <DailyCard key={idx} record={record} />
        ))}
      </div>

      {/* 時間帯別CV集計 (全日合計) */}
      <div className="hourly-section">
        <HourlyChart
          hourlyCV={aggregateHourlyCV(filteredData)}
          title="時間帯別CV数 (期間合計)"
        />
      </div>
    </div>
  );
}

function DailyCard({ record }: { record: ListingRecord }) {
  const cpaDiff = record.cpa && record.amount && record.cv && record.cv > 0
    ? hasCPADiscrepancy(record.cpa, record.amount, record.cv)
    : false;

  return (
    <div className="daily-card">
      <div className="daily-card-header">
        <h4>{formatDateJST(record.date)}</h4>
      </div>
      <div className="daily-card-body">
        <div className="daily-stat">
          <span className="stat-label">広告費</span>
          <span className="stat-value">¥{(record.amount ?? 0).toLocaleString()}</span>
        </div>
        <div className="daily-stat">
          <span className="stat-label">CV</span>
          <span className="stat-value">{record.cv ?? '-'}</span>
        </div>
        <div className="daily-stat">
          <span className="stat-label">CVR</span>
          <span className="stat-value">
            {record.cvr !== null ? `${(record.cvr * 100).toFixed(1)}%` : '-'}
          </span>
        </div>
        <div className="daily-stat">
          <span className="stat-label">CPA</span>
          <span className="stat-value">
            ¥{record.cpa !== null ? Math.round(record.cpa).toLocaleString() : '-'}
          </span>
          {cpaDiff && (
            <span className="cpa-warning" title="CSV値と計算値の差が1%以上">⚠️</span>
          )}
        </div>
      </div>
    </div>
  );
}

function aggregateHourlyCV(records: ListingRecord[]): (number | null)[] {
  const totals: (number | null)[] = Array(24).fill(0);
  const hasMissing: boolean[] = Array(24).fill(false);

  records.forEach(record => {
    record.hourlyCV.forEach((cv, hour) => {
      if (cv === null) {
        hasMissing[hour] = true;
      } else {
        totals[hour] = (totals[hour] ?? 0) + cv;
      }
    });
  });

  return totals.map((total, hour) => (hasMissing[hour] ? null : total));
}
