/**
 * 予約日別推移チャート
 */

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import { ReservationDepartmentGroup } from '../../types/dataTypes';
import './ReservationTrendChart.css';

interface ReservationTrendChartProps {
  data: Array<Record<string, number | string>>;
  departments: ReservationDepartmentGroup[];
  type: '初診' | '再診';
}

const DEPARTMENT_COLORS: Record<ReservationDepartmentGroup, string> = {
  内科外科外来: '#4b7bec',
  内科外来: '#2ecc71',
  発熱外来: '#e74c3c',
  胃カメラ: '#9b59b6',
  大腸カメラ: '#f39c12',
  内視鏡ドック: '#16a085',
  人間ドックA: '#8e44ad',
  人間ドックB: '#d35400',
  オンライン診療: '#1abc9c',
  その他: '#95a5a6'
};

export function ReservationTrendChart({ data, departments, type }: ReservationTrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="reservation-trend reservation-trend--empty">
        <p className="placeholder-label">
          {type}の予約推移データがありません。
        </p>
      </div>
    );
  }

  return (
    <div className="reservation-trend">
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={data} margin={{ top: 30, right: 40, left: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef1f7" />
          <XAxis
            dataKey="date"
            tickFormatter={(value) => value.slice(5)}
            tick={{ fontSize: 12, fill: '#56637a' }}
          />
          <YAxis tick={{ fontSize: 12, fill: '#56637a' }} allowDecimals={false} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid #dde3f0' }}
            formatter={(value, name) => [`${value}件`, String(name)]}
            labelFormatter={(label) => `${label}`}
          />
          <Legend verticalAlign="top" height={36} iconType="circle" />
          <Line
            type="monotone"
            dataKey="total"
            name="総件数"
            stroke="#2648ff"
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 6 }}
          />
          {departments.map(department => (
            <Line
              key={department}
              type="monotone"
              dataKey={department}
              name={department}
              stroke={DEPARTMENT_COLORS[department]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
