/**
 * リスティング分析ビュー
 */

import { useEffect, useMemo, useState } from 'react';
import { useData } from '../contexts/DataContext';
import type { ListingRecord, ListingType, ReservationDepartmentGroup } from '../types/dataTypes';
import { formatDateJST, getMonthKeyJST } from '../utils/dateUtils';
import { hasCPADiscrepancy } from '../utils/validation';
import { filterReservationsByMonth } from '../utils/reservationUtils';
import { HourlyChart } from './charts/HourlyChart';
import { ListingComparisonChart } from './charts/ListingComparisonChart';
import './ListingView.css';

interface ListingConfig {
  type: ListingType;
  label: string;
  accent: string;
  reservationGroups: ReservationDepartmentGroup[];
  description: string;
}

const LISTING_CONFIG: ListingConfig[] = [
  {
    type: 'internal',
    label: '内科',
    accent: '#4b6cff',
    reservationGroups: ['内科外科外来', '内科外来', '発熱外来'],
    description: '総合内科広告のCVと関連外来の初診予約をトラッキングします。'
  },
  {
    type: 'gastroscopy',
    label: '胃カメラ',
    accent: '#f39c12',
    reservationGroups: ['人間ドックA', '胃カメラ'],
    description: '胃カメラ施策の成果を日別・時間帯で俯瞰します。'
  },
  {
    type: 'colonoscopy',
    label: '大腸カメラ',
    accent: '#16a085',
    reservationGroups: ['大腸カメラ', '内視鏡ドック', '人間ドックB'],
    description: '大腸カメラ施策の成果を日別・時間帯で俯瞰します。'
  }
];

const DATA_KEY: Record<ListingType, 'listingInternal' | 'listingGastroscopy' | 'listingColonoscopy'> = {
  internal: 'listingInternal',
  gastroscopy: 'listingGastroscopy',
  colonoscopy: 'listingColonoscopy'
};

function filterListingByMonth(records: ListingRecord[], month: string | null): ListingRecord[] {
  if (!month) return records;
  return records.filter(record => getMonthKeyJST(record.date) === month);
}

function aggregateHourlyCV(records: ListingRecord[]): (number | null)[] {
  const totals: number[] = Array(24).fill(0);
  const hasMissing = Array(24).fill(false);

  records.forEach(record => {
    record.hourlyCV.forEach((cv, hour) => {
      if (cv === null) {
        hasMissing[hour] = true;
      } else {
        totals[hour] = (totals[hour] ?? 0) + cv;
      }
    });
  });

  return totals.map((total, hour) => (hasMissing[hour] ? null : total));
}

function calculateMonthlySummary(records: ListingRecord[]) {
  const totalCV = records.reduce<number>((sum, record) => sum + (record.cv ?? 0), 0);
  const totalAmount = records.reduce<number>((sum, record) => sum + (record.amount ?? 0), 0);
  const validCVRs = records.filter(record => record.cvr !== null).map(record => record.cvr!);
  const avgCVR = validCVRs.length > 0
    ? validCVRs.reduce<number>((sum, cvr) => sum + cvr, 0) / validCVRs.length
    : 0;
  const avgCPA = totalCV > 0 ? totalAmount / totalCV : 0;

  return {
    totalCV,
    totalAmount,
    avgCVR,
    avgCPA,
    validDays: records.length
  };
}

interface DailyMetric {
  date: string;
  amount: number;
  cv: number;
  cvr: number | null;
  cpa: number | null;
  hourlyTotal: number;
  hasCPAIssue: boolean;
}

function buildDailyMetrics(records: ListingRecord[]): DailyMetric[] {
  return records
    .map(record => {
      const cv = record.cv ?? 0;
      const amount = record.amount ?? 0;
      const hourlyTotal = record.hourlyCV.reduce<number>((sum, value) => sum + (value ?? 0), 0);
      const hasIssue = record.cpa && record.amount && record.cv && record.cv > 0
        ? hasCPADiscrepancy(record.cpa, record.amount, record.cv)
        : false;

      return {
        date: formatDateJST(record.date),
        amount,
        cv,
        cvr: record.cvr,
        cpa: record.cpa,
        hourlyTotal,
        hasCPAIssue: hasIssue
      };
    })
    .sort((a, b) => (a.date > b.date ? 1 : -1));
}

function buildComparisonSeries(
  allRecords: ListingRecord[],
  reservations: ReturnType<typeof filterReservationsByMonth>,
  groups: ReservationDepartmentGroup[],
  month: string | null
) {
  const listingRecords = filterListingByMonth(allRecords, month);
  const reservationRecords = filterReservationsByMonth(reservations, month);

  const listingMap = new Map<string, number>();
  listingRecords.forEach(record => {
    const dateKey = formatDateJST(record.date);
    listingMap.set(dateKey, (listingMap.get(dateKey) ?? 0) + (record.cv ?? 0));
  });

  const reservationMap = new Map<string, Record<ReservationDepartmentGroup, number>>();
  reservationRecords
    .filter(record => record.type === '初診' && groups.includes(record.departmentGroup))
    .forEach(record => {
      const dateKey = formatDateJST(record.dateTime);
      if (!reservationMap.has(dateKey)) {
        reservationMap.set(dateKey, Object.fromEntries(groups.map(group => [group, 0])) as Record<ReservationDepartmentGroup, number>);
      }
      const entry = reservationMap.get(dateKey)!;
      entry[record.departmentGroup] = (entry[record.departmentGroup] ?? 0) + record.count;
    });

  const dateSet = new Set<string>([...listingMap.keys(), ...reservationMap.keys()]);
  return Array.from(dateSet)
    .sort()
    .map(date => {
      const row: Record<string, number | string> = { date, listingCV: listingMap.get(date) ?? 0 };
      groups.forEach(group => {
        row[group] = reservationMap.get(date)?.[group] ?? 0;
      });
      return row;
    });
}

export function ListingView() {
  const {
    listingInternal,
    listingGastroscopy,
    listingColonoscopy,
    reservations,
    selectedMonth,
    errors,
    warnings
  } = useData();

  const [activeType, setActiveType] = useState<ListingType>('internal');

  const sources = useMemo(() => ({
    internal: listingInternal,
    gastroscopy: listingGastroscopy,
    colonoscopy: listingColonoscopy
  }), [listingInternal, listingGastroscopy, listingColonoscopy]);

  useEffect(() => {
    const firstWithData = LISTING_CONFIG.find(config => sources[config.type].length > 0);
    if (firstWithData && sources[activeType].length === 0) {
      setActiveType(firstWithData.type);
    }
  }, [sources, activeType]);

  const activeConfig = LISTING_CONFIG.find(config => config.type === activeType)!;
  const activeRecords = sources[activeType];
  const filteredRecords = useMemo(
    () => filterListingByMonth(activeRecords, selectedMonth),
    [activeRecords, selectedMonth]
  );

  const monthlySummary = useMemo(
    () => calculateMonthlySummary(filteredRecords),
    [filteredRecords]
  );

  const dailyMetrics = useMemo(
    () => buildDailyMetrics(filteredRecords),
    [filteredRecords]
  );

  const hourlyTotals = useMemo(
    () => aggregateHourlyCV(filteredRecords),
    [filteredRecords]
  );

  const datasetErrors = errors[DATA_KEY[activeType]] ?? [];
  const datasetWarnings = warnings[DATA_KEY[activeType]] ?? [];

  const comparisonSeries = useMemo(() => {
    if (activeType !== 'internal') return [];
    return buildComparisonSeries(listingInternal, reservations, activeConfig.reservationGroups, selectedMonth);
  }, [activeType, listingInternal, reservations, activeConfig.reservationGroups, selectedMonth]);

  if (filteredRecords.length === 0) {
    return (
      <div className="listing-view listing-view--empty">
        <p className="placeholder-label">
          {activeConfig.label}のリスティングデータがありません。CSVを読み込み、別タブにも切り替えてください。
        </p>
      </div>
    );
  }

  return (
    <div className="listing-view">
      <div className="listing-header">
        <div>
          <div className="listing-tabs">
            {LISTING_CONFIG.map(config => {
              const count = sources[config.type].length;
              return (
                <button
                  key={config.type}
                  type="button"
                  className={`listing-tab ${config.type === activeType ? 'is-active' : ''}`}
                  onClick={() => setActiveType(config.type)}
                >
                  <span className="listing-tab__label">{config.label}</span>
                  <span className="listing-tab__count">{count}</span>
                </button>
              );
            })}
          </div>
          <p className="listing-description">{activeConfig.description}</p>
        </div>
        <div className="listing-alerts">
          {datasetErrors.length > 0 && (
            <span className="listing-alert listing-alert--error">
              ❌ {datasetErrors[0].message}
            </span>
          )}
          {datasetWarnings.length > 0 && (
            <span className="listing-alert listing-alert--warning">
              ⚠️ {datasetWarnings.length}件の警告
            </span>
          )}
        </div>
      </div>

      <div className="listing-summary">
        <div className="listing-card" style={{ borderTopColor: activeConfig.accent }}>
          <span className="listing-card__label">合計CV</span>
          <strong className="listing-card__value">{monthlySummary.totalCV}</strong>
          <span className="listing-card__caption">期間のCV合計</span>
        </div>
        <div className="listing-card">
          <span className="listing-card__label">総広告費</span>
          <strong className="listing-card__value">¥{monthlySummary.totalAmount.toLocaleString()}</strong>
          <span className="listing-card__caption">税抜金額はCSVを参照</span>
        </div>
        <div className="listing-card">
          <span className="listing-card__label">平均CVR</span>
          <strong className="listing-card__value">{(monthlySummary.avgCVR * 100).toFixed(1)}%</strong>
          <span className="listing-card__caption">有効日での平均</span>
        </div>
        <div className="listing-card">
          <span className="listing-card__label">平均CPA</span>
          <strong className="listing-card__value">
            ¥{Math.round(monthlySummary.avgCPA).toLocaleString()}
          </strong>
          <span className="listing-card__caption">合計広告費 ÷ 合計CV</span>
        </div>
        <div className="listing-card">
          <span className="listing-card__label">有効日数</span>
          <strong className="listing-card__value">{monthlySummary.validDays}</strong>
          <span className="listing-card__caption">データが存在する日数</span>
        </div>
      </div>

      <div className="listing-panels">
        <div className="listing-panel listing-panel--primary">
          <h3>日別指標</h3>
          <div className="listing-daily-grid">
            {dailyMetrics.map(metric => (
              <div key={metric.date} className="daily-metric-card">
                <div className="daily-metric__header">
                  <span className="daily-metric__date">{metric.date}</span>
                  {metric.hasCPAIssue && (
                    <span className="daily-metric__alert" title="CSV記載のCPAと計算値に差異があります">
                      ⚠
                    </span>
                  )}
                </div>
                <div className="daily-metric__stats">
                  <div>
                    <span className="daily-metric__label">広告費</span>
                    <strong className="daily-metric__value">¥{metric.amount.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span className="daily-metric__label">CV</span>
                    <strong className="daily-metric__value">{metric.cv}</strong>
                  </div>
                  <div>
                    <span className="daily-metric__label">CVR</span>
                    <strong className="daily-metric__value">
                      {metric.cvr !== null ? `${(metric.cvr * 100).toFixed(1)}%` : '-'}
                    </strong>
                  </div>
                  <div>
                    <span className="daily-metric__label">CPA</span>
                    <strong className="daily-metric__value">
                      {metric.cpa !== null ? `¥${Math.round(metric.cpa).toLocaleString()}` : '-'}
                    </strong>
                  </div>
                </div>
                <div className="daily-metric__footer">
                  <span>時間帯CV合計: {metric.hourlyTotal}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="listing-panel">
          <HourlyChart
            hourlyCV={hourlyTotals}
            title="時間帯別CV（合計）"
            accentColor={activeConfig.accent}
          />
        </div>
      </div>

      {activeType === 'internal' && comparisonSeries.length > 0 && (
        <div className="listing-panel listing-panel--comparison">
          <div className="panel-header">
            <h3>内科CV × 初診予約（日別）</h3>
            <span className="panel-caption">
              内科・発熱関連の初診予約が広告の成果と同日に発生しているかを確認します
            </span>
          </div>
          <ListingComparisonChart
            data={comparisonSeries}
            reservationGroups={activeConfig.reservationGroups}
            accent={activeConfig.accent}
          />
        </div>
      )}
    </div>
  );
}
