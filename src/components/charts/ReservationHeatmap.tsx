/**
 * 予約ヒートマップ
 * 診療科ごとの時間帯予約件数を表示
 */

import { ReservationDepartmentGroup } from '../../types/dataTypes';
import './ReservationHeatmap.css';

export interface HeatmapRow {
  department: ReservationDepartmentGroup;
  hourly: number[];
  total: number;
}

interface ReservationHeatmapProps {
  rows: HeatmapRow[];
  maxValue: number;
  type: '初診' | '再診';
}

export function ReservationHeatmap({ rows, maxValue, type }: ReservationHeatmapProps) {
  if (rows.length === 0) {
    return (
      <div className="reservation-heatmap reservation-heatmap--empty">
        <p className="placeholder-label">
          {type}の予約データがありません。
        </p>
      </div>
    );
  }

  const hours = Array.from({ length: 24 }, (_v, idx) => idx);

  return (
    <div className="reservation-heatmap">
      <div className="heatmap-header">
        <span className="heatmap-header__label">診療科</span>
        <div className="heatmap-header__grid">
          {hours.map(hour => (
            <span key={hour} className="heatmap-header__cell">
              {hour}
            </span>
          ))}
        </div>
        <span className="heatmap-header__total">合計</span>
      </div>

      <div className="heatmap-body">
        {rows.map(row => (
          <div key={`${row.department}`} className="heatmap-row">
            <div className="heatmap-row__label">
              <span className="heatmap-row__name">{row.department}</span>
            </div>
            <div className="heatmap-row__grid">
              {row.hourly.map((value, hour) => {
                const ratio = maxValue > 0 ? value / maxValue : 0;
                const cellColor = `rgba(90, 130, 255, ${0.12 + ratio * 0.68})`;
                const textColor = ratio > 0.5 ? '#ffffff' : '#203050';
                return (
                  <div
                    key={hour}
                    className="heatmap-cell"
                    style={{
                      backgroundColor: value === 0 ? 'rgba(245, 247, 255, 0.8)' : cellColor,
                      color: textColor
                    }}
                    title={`${row.department} ${hour}時: ${value}件`}
                  >
                    {value > 0 ? value : ''}
                  </div>
                );
              })}
            </div>
            <div className="heatmap-row__total">
              {row.total}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
