/**
 * マルミエ - 月次フィルタコンポーネント
 */

import { useEffect } from 'react';
import { useData } from '../contexts/DataContext';
import './MonthFilter.css';

function formatMonth(month: string): string {
  const [year, monthNum] = month.split('-');
  return `${year}年${parseInt(monthNum, 10)}月`;
}

export function MonthFilter() {
  const { selectedMonth, setSelectedMonth, getAvailableMonths } = useData();
  const availableMonths = getAvailableMonths();

  useEffect(() => {
    if (!selectedMonth && availableMonths.length > 0) {
      setSelectedMonth(availableMonths[availableMonths.length - 1]);
    }
  }, [selectedMonth, availableMonths, setSelectedMonth]);

  const handleMonthChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedMonth(event.target.value || null);
  };

  if (availableMonths.length === 0) {
    return (
      <div className="month-filter-container month-filter-empty">
        <span>データ未読み込み</span>
      </div>
    );
  }

  return (
    <div className="month-filter-container">
      <div className="month-filter-header">
        <span className="month-filter-label">対象月</span>
        <span className="month-filter-info">{availableMonths.length}ヶ月</span>
      </div>
      <select
        id="month-select"
        value={selectedMonth ?? ''}
        onChange={handleMonthChange}
        className="month-filter-select"
      >
        <option value="">全期間</option>
        {availableMonths.map(month => (
          <option key={month} value={month}>
            {formatMonth(month)}
          </option>
        ))}
      </select>
    </div>
  );
}
