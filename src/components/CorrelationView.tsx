/**
 * 相関分析セクション
 */

import { useMemo } from 'react';
import { useData } from '../contexts/DataContext';
import { buildCorrelationSeries } from '../utils/reservationUtils';
import type { ListingType, CorrelationPoint, ReservationDepartmentGroup } from '../types/dataTypes';
import { CorrelationChart } from './charts/CorrelationChart';
import './CorrelationView.css';

interface CorrelationConfig {
  id: ListingType;
  title: string;
  description: string;
  listingType: ListingType;
  reservationGroups: ReservationDepartmentGroup[];
  accent: string;
}

const CORRELATION_CONFIG: CorrelationConfig[] = [
  {
    id: 'internal',
    title: '内科 CV × 外来初診予約',
    description: '内科リスティングのCVと、内科・発熱関連外来の初診予約を重ねて相関を検証します。',
    listingType: 'internal',
    reservationGroups: ['内科外科外来', '内科外来', '発熱外来'],
    accent: '#4b6cff'
  },
  {
    id: 'gastroscopy',
    title: '胃カメラ CV × ドック初診予約',
    description: '胃カメラ施策と、人間ドックA・胃カメラ初診予約の連動を確認します。',
    listingType: 'gastroscopy',
    reservationGroups: ['人間ドックA', '胃カメラ'],
    accent: '#f39c12'
  },
  {
    id: 'colonoscopy',
    title: '大腸カメラ CV × 内視鏡系初診予約',
    description: '大腸カメラ施策と、大腸カメラ／内視鏡ドック／人間ドックBの初診予約を重ねます。',
    listingType: 'colonoscopy',
    reservationGroups: ['大腸カメラ', '内視鏡ドック', '人間ドックB'],
    accent: '#16a085'
  }
];

export function CorrelationView() {
  const {
    listingInternal,
    listingGastroscopy,
    listingColonoscopy,
    reservations,
    selectedMonth
  } = useData();

  const listingSources = useMemo(() => ({
    internal: listingInternal,
    gastroscopy: listingGastroscopy,
    colonoscopy: listingColonoscopy
  }), [listingInternal, listingGastroscopy, listingColonoscopy]);

  const cards = useMemo(() => CORRELATION_CONFIG.map(config => {
    const listingRecords = listingSources[config.listingType];
    const series = buildCorrelationSeries(
      listingRecords,
      reservations,
      config.reservationGroups,
      selectedMonth
    );
    return { config, series };
  }), [listingSources, reservations, selectedMonth]);

  const hasAnySeries = cards.some(card => card.series.length > 0);

  if (!hasAnySeries) {
    return (
      <div className="correlation-view correlation-view--empty">
        <p className="placeholder-label">
          リスティングと予約のデータを読み込むと相関チャートが表示されます。
        </p>
      </div>
    );
  }

  return (
    <div className="correlation-view">
      <div className="correlation-grid">
        {cards.map(({ config, series }) => (
          <CorrelationCard
            key={config.id}
            title={config.title}
            description={config.description}
            series={series}
            accent={config.accent}
          />
        ))}
      </div>
    </div>
  );
}

interface CorrelationCardProps {
  title: string;
  description: string;
  series: CorrelationPoint[];
  accent: string;
}

function CorrelationCard({ title, description, series, accent }: CorrelationCardProps) {
  if (series.length === 0) {
    return (
      <div className="correlation-card correlation-card--empty">
        <h3>{title}</h3>
        <p className="correlation-description">{description}</p>
        <p className="placeholder-label">対象期間の相関データがありません。</p>
      </div>
    );
  }

  const matches = series.filter(point => point.highlight).length;
  const peakCV = Math.max(...series.map(point => point.listingCV));
  const peakReservations = Math.max(...series.map(point => point.reservationCount));

  return (
    <div className="correlation-card">
      <div className="correlation-card__header">
        <h3>{title}</h3>
        <p className="correlation-description">{description}</p>
      </div>
      <div className="correlation-stats">
        <div className="correlation-stat" style={{ borderTopColor: accent }}>
          <span className="correlation-stat__label">同日ハイライト</span>
          <strong className="correlation-stat__value">{matches}</strong>
          <span className="correlation-stat__caption">CVと初診予約が同日に発生</span>
        </div>
        <div className="correlation-stat">
          <span className="correlation-stat__label">最大CV</span>
          <strong className="correlation-stat__value">{peakCV}</strong>
          <span className="correlation-stat__caption">期間内の最大CV</span>
        </div>
        <div className="correlation-stat">
          <span className="correlation-stat__label">最大初診予約</span>
          <strong className="correlation-stat__value">{peakReservations}</strong>
          <span className="correlation-stat__caption">対象診療科の最大件数</span>
        </div>
      </div>
      <CorrelationChart data={series} accent={accent} />
    </div>
  );
}
