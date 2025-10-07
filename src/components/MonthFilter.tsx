/**
 * マルミエ - 月次フィルタコンポーネント
 */

import { useData } from '../contexts/DataContext';
import './MonthFilter.css';

export function MonthFilter() {
  const { selectedMonth, setSelectedMonth, getAvailableMonths } = useData();
  const availableMonths = getAvailableMonths();

  if (availableMonths.length === 0) {
    return null;
  }

  // 初回ロード時に最新月を自動選択
  if (!selectedMonth && availableMonths.length > 0) {
    setSelectedMonth(availableMonths[availableMonths.length - 1]);
  }

  const handleMonthChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedMonth(event.target.value || null);
  };

  return (
    <div className="month-filter-container">
      <label htmlFor="month-select" className="month-filter-label">
        📅 対象月:
      </label>
      <select
        id="month-select"
        value={selectedMonth || ''}
        onChange={handleMonthChange}
        className="month-filter-select"
      >
        <option value="">すべての月</option>
        {availableMonths.map(month => (
          <option key={month} value={month}>
            {formatMonth(month)}
          </option>
        ))}
      </select>
      <span className="month-filter-info">
        {availableMonths.length}ヶ月分のデータ
      </span>
    </div>
  );
}

function formatMonth(month: string): string {
  const [year, monthNum] = month.split('-');
  return `${year}年${parseInt(monthNum)}月`;
}
