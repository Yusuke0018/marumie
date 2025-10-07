/**
 * 予約分析セクション
 */

import { useMemo, useState } from 'react';
import { useData } from '../contexts/DataContext';
import {
  filterReservationsByMonth,
  computeDepartmentStats,
  getTopDepartmentsByType,
  buildReservationTrendData
} from '../utils/reservationUtils';
import { formatDateJST } from '../utils/dateUtils';
import { ReservationHeatmap } from './charts/ReservationHeatmap';
import { ReservationTrendChart } from './charts/ReservationTrendChart';
import type { ReservationDepartmentStats } from '../types/dataTypes';
import './ReservationView.css';

const TYPE_OPTIONS: Array<'初診' | '再診'> = ['初診', '再診'];

function countSameDayReservations(
  reservations: ReturnType<typeof filterReservationsByMonth>,
  type: '初診' | '再診'
): number {
  return reservations
    .filter(record => record.type === type && record.isSameDay)
    .reduce((sum, record) => sum + record.count, 0);
}

export function ReservationView() {
  const { reservations, selectedMonth } = useData();
  const [activeType, setActiveType] = useState<'初診' | '再診'>('初診');

  const monthFiltered = useMemo(
    () => filterReservationsByMonth(reservations, selectedMonth),
    [reservations, selectedMonth]
  );

  const stats = useMemo<ReservationDepartmentStats[]>(
    () => computeDepartmentStats(monthFiltered),
    [monthFiltered]
  );

  const hasAnyData = stats.some(stat => stat.total > 0);
  const hasActiveTypeData = stats.some(stat => stat.type === activeType && stat.total > 0);

  const topStats = useMemo(
    () => getTopDepartmentsByType(stats, activeType, 8),
    [stats, activeType]
  );

  const heatmapRows = useMemo(
    () => topStats.map(stat => ({
      department: stat.department,
      hourly: stat.hourly,
      total: stat.total
    })),
    [topStats]
  );

  const heatmapMax = useMemo(() => {
    const values = heatmapRows.flatMap(row => row.hourly);
    if (values.length === 0) return 0;
    return Math.max(...values);
  }, [heatmapRows]);

  const focalDepartments = useMemo(
    () => topStats.map(stat => stat.department),
    [topStats]
  );

  const trendData = useMemo(
    () => buildReservationTrendData(stats, focalDepartments, activeType),
    [stats, focalDepartments, activeType]
  );

  const totals = useMemo(() => {
    const totalCount = stats
      .filter(stat => stat.type === activeType)
      .reduce((sum, stat) => sum + stat.total, 0);

    const sameDayCount = countSameDayReservations(monthFiltered, activeType);

    const activeDates = new Set(
      monthFiltered
        .filter(record => record.type === activeType)
        .map(record => formatDateJST(record.dateTime))
    );

    return {
      totalCount,
      sameDayCount,
      departmentCount: stats.filter(stat => stat.type === activeType && stat.total > 0).length,
      dayCount: activeDates.size
    };
  }, [stats, monthFiltered, activeType]);

  if (!hasAnyData) {
    return (
      <div className="reservation-view reservation-view--empty">
        <p className="placeholder-label">
          予約ログのCSVを読み込むと時間帯×診療科のヒートマップが表示されます。
        </p>
      </div>
    );
  }

  return (
    <div className="reservation-view">
      <div className="reservation-toolbar">
        <div className="type-toggle">
          {TYPE_OPTIONS.map(type => (
            <button
              key={type}
              type="button"
              className={`type-toggle__button ${type === activeType ? 'is-active' : ''}`}
              onClick={() => setActiveType(type)}
            >
              {type}
            </button>
          ))}
        </div>
        <span className="reservation-toolbar__hint">
          時間帯ヒートマップと診療科別の日別推移を表示します
        </span>
      </div>

      <div className="reservation-summary">
        <div className="res-card">
          <span className="res-card__label">総予約件数</span>
          <strong className="res-card__value">{totals.totalCount}</strong>
          <span className="res-card__caption">{activeType}の合計件数</span>
        </div>
        <div className="res-card">
          <span className="res-card__label">当日予約</span>
          <strong className="res-card__value">{totals.sameDayCount}</strong>
          <span className="res-card__caption">当日予約フラグがTRUEの件数</span>
        </div>
        <div className="res-card">
          <span className="res-card__label">対象診療科数</span>
          <strong className="res-card__value">{totals.departmentCount}</strong>
          <span className="res-card__caption">タイプ別に集計した診療科</span>
        </div>
        <div className="res-card">
          <span className="res-card__label">対象稼働日</span>
          <strong className="res-card__value">{totals.dayCount}</strong>
          <span className="res-card__caption">データが存在する日数</span>
        </div>
      </div>

      {!hasActiveTypeData ? (
        <div className="reservation-view reservation-view--empty">
          <p className="placeholder-label">
            {activeType}の予約データがありません。タブを切り替えるか、CSVの内容をご確認ください。
          </p>
        </div>
      ) : (
        <div className="reservation-panels">
          <div className="reservation-panel">
            <div className="panel-header">
              <h3>時間帯ヒートマップ</h3>
              <span className="panel-caption">
                {activeType}で最も件数が多い診療科を上位表示します
              </span>
            </div>
            <ReservationHeatmap rows={heatmapRows} maxValue={heatmapMax} type={activeType} />
          </div>

          <div className="reservation-panel">
            <div className="panel-header">
              <h3>診療科別 日別推移</h3>
              <span className="panel-caption">
                上位診療科の推移と総件数を把握します
              </span>
            </div>
            <ReservationTrendChart
              data={trendData}
              departments={focalDepartments}
              type={activeType}
            />
          </div>
        </div>
      )}
    </div>
  );
}
