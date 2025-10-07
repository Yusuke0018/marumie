/**
 * 内科リスティング × 予約比較チャート
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
import './ListingComparisonChart.css';

interface ListingComparisonChartProps {
  data: Array<Record<string, number | string>>;
  reservationGroups: string[];
  accent: string;
}

const RESERVATION_COLORS: Record<string, string> = {
  内科外科外来: '#2ecc71',
  内科外来: '#9b59b6',
  発熱外来: '#e74c3c',
  人間ドックA: '#8e44ad',
  胃カメラ: '#f39c12',
  大腸カメラ: '#16a085',
  内視鏡ドック: '#1abc9c',
  人間ドックB: '#d35400'
};

export function ListingComparisonChart({ data, reservationGroups, accent }: ListingComparisonChartProps) {
  return (
    <div className="listing-comparison-chart">
      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart data={data} margin={{ top: 30, right: 40, left: 0, bottom: 10 }}>
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
            label={{ value: '初診予約件数', angle: 90, position: 'insideRight', fill: '#2ecc71' }}
            stroke="#2ecc71"
            allowDecimals={false}
            tick={{ fontSize: 12, fill: '#56637a' }}
          />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid #dde3f0' }}
            formatter={(value, name) => [`${value}件`, String(name)]}
            labelFormatter={(label) => `${label}`}
          />
          <Legend verticalAlign="top" height={36} iconType="circle" />
          {reservationGroups.map(group => {
            const color = RESERVATION_COLORS[group] ?? '#95a5a6';
            return (
              <Area
                key={group}
                yAxisId="right"
                type="monotone"
                dataKey={group}
                name={group}
                stroke={color}
                fill={color}
                fillOpacity={0.18}
                strokeWidth={2}
                stackId="reservations"
                dot={false}
              />
            );
          })}
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="listingCV"
            name="内科CV"
            stroke={accent}
            strokeWidth={3}
            dot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }}
            activeDot={{ r: 6 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
