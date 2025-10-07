/**
 * マルミエ - 時間帯別CVチャートコンポーネント
 */

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import './HourlyChart.css';

interface HourlyChartProps {
  hourlyCV: (number | null)[];
  title?: string;
  accentColor?: string;
}

export function HourlyChart({ hourlyCV, title = '時間帯別CV数', accentColor = '#3498db' }: HourlyChartProps) {
  const data = hourlyCV.map((cv, hour) => ({
    hour: `${hour}時`,
    cv: cv ?? 0,
    isMissing: cv === null
  }));

  const total = hourlyCV.reduce((sum, cv) => (sum ?? 0) + (cv ?? 0), 0);
  const missingCount = hourlyCV.filter(cv => cv === null).length;

  return (
    <div className="hourly-chart-container">
      <h3>{title}</h3>
      <div className="hourly-summary">
        <span>合計CV: <strong>{total}</strong></span>
        {missingCount > 0 && (
          <span className="missing-warning">⚠️ {missingCount}時間帯のデータ欠損</span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="hour"
            angle={-45}
            textAnchor="end"
            height={80}
            interval={1}
            style={{ fontSize: '0.75rem' }}
          />
          <YAxis />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div className="custom-tooltip">
                    <p className="tooltip-label">{data.hour}</p>
                    {data.isMissing ? (
                      <p className="tooltip-missing">データ欠損</p>
                    ) : (
                      <p className="tooltip-value">CV: {data.cv}</p>
                    )}
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar dataKey="cv">
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.isMissing ? '#e74c3c' : accentColor}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
