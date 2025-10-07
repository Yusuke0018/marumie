/**
 * マルミエ - アンケート調査チャートコンポーネント
 */

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import './SurveyChart.css';

interface SurveyChartProps {
  channelData: Array<{ name: string; value: number }>;
  title?: string;
  totalResponses: number;
  validDays: number;
}

const COLORS = [
  '#3498db', '#2ecc71', '#f39c12', '#e74c3c', '#9b59b6',
  '#1abc9c', '#34495e', '#16a085', '#27ae60', '#2980b9'
];

const EXCLUDED_CHANNELS = ['発熱外来(Google)'];

export function SurveyChart({ channelData, title = 'チャネル別流入割合', totalResponses, validDays }: SurveyChartProps) {
  // 除外チャネルをフィルタ
  const filteredData = channelData.filter(item => !EXCLUDED_CHANNELS.includes(item.name));

  const totalFiltered = filteredData.reduce((sum, item) => sum + item.value, 0);

  // 割合計算
  const dataWithPercentage = filteredData.map(item => ({
    ...item,
    percentage: totalFiltered > 0 ? (item.value / totalFiltered * 100).toFixed(1) : '0.0'
  }));

  if (filteredData.length === 0) {
    return (
      <div className="survey-chart-empty">
        <p>データがありません</p>
      </div>
    );
  }

  return (
    <div className="survey-chart-container">
      <h3>{title}</h3>
      <div className="survey-info">
        <span>総回答数: <strong>{totalResponses}</strong></span>
        <span>有効日数: <strong>{validDays}日</strong></span>
        <span>除外: {EXCLUDED_CHANNELS.join(', ')}</span>
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <PieChart>
          <Pie
            data={dataWithPercentage}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={({ name, percentage }) => `${name}: ${percentage}%`}
            outerRadius={120}
            fill="#8884d8"
            dataKey="value"
          >
            {dataWithPercentage.map((_entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div className="custom-tooltip">
                    <p className="tooltip-label">{data.name}</p>
                    <p className="tooltip-value">
                      件数: {data.value} ({data.percentage}%)
                    </p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Legend
            verticalAlign="bottom"
            height={36}
            wrapperStyle={{ fontSize: '0.85rem' }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* データテーブル */}
      <div className="survey-table">
        <table>
          <thead>
            <tr>
              <th>チャネル</th>
              <th>件数</th>
              <th>割合</th>
            </tr>
          </thead>
          <tbody>
            {dataWithPercentage
              .sort((a, b) => b.value - a.value)
              .map((item, idx) => (
                <tr key={idx}>
                  <td>{item.name}</td>
                  <td>{item.value}</td>
                  <td>{item.percentage}%</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
