/**
 * リスティング×予約 相関チャート
 */

import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Area,
  Line
} from 'recharts';
import type { CorrelationPoint } from '../../types/dataTypes';
import './CorrelationChart.css';

interface CorrelationChartProps {
  data: CorrelationPoint[];
  accent: string;
}

const ReservationDot = ({ cx, cy, payload }: any) => {
  if (payload.highlight) {
    return (
      <circle cx={cx} cy={cy} r={5.5} fill="#ffffff" stroke="#e74c3c" strokeWidth={3} />
    );
  }
  return <circle cx={cx} cy={cy} r={3.5} fill="#ffffff" stroke="#2c3e50" strokeWidth={1.5} />;
};

export function CorrelationChart({ data, accent }: CorrelationChartProps) {
  const chartData = data.map(point => ({
    date: point.date,
    listingCV: point.listingCV,
    reservationCount: point.reservationCount,
    highlight: point.highlight
  }));

  return (
    <div className="correlation-chart">
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef1f7" />
          <XAxis
            dataKey="date"
            tickFormatter={(value) => value.slice(5)}
            tick={{ fontSize: 12, fill: '#56637a' }}
          />
          <YAxis
            yAxisId="left"
            label={{ value: 'CV', angle: -90, position: 'insideLeft', fill: accent }}
            stroke={accent}
            allowDecimals={false}
            tick={{ fontSize: 12, fill: '#56637a' }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            label={{ value: '初診予約', angle: 90, position: 'insideRight', fill: '#1abc9c' }}
            stroke="#1abc9c"
            allowDecimals={false}
            tick={{ fontSize: 12, fill: '#56637a' }}
          />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid #dde3f0' }}
            formatter={(value, name) => [`${value}件`, String(name)]}
            labelFormatter={(label) => `${label}`}
          />
          <Legend verticalAlign="top" height={32} iconType="circle" />
          <Area
            yAxisId="right"
            type="monotone"
            dataKey="reservationCount"
            name="初診予約"
            stroke="#1abc9c"
            fill="#1abc9c"
            fillOpacity={0.18}
            strokeWidth={2}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="listingCV"
            name="リスティングCV"
            stroke={accent}
            strokeWidth={3}
            dot={<ReservationDot />}
            activeDot={{ r: 7 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
