import { useCallback, useState } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { useData } from '../contexts/DataContext';
import { getMonthKeyJST, formatDateJST } from '../utils/dateUtils';
import { filterReservationsByMonth } from '../utils/reservationUtils';
import type { ListingRecord, SurveyRecord } from '../types/dataTypes';

const PAGE_MARGIN = 14;

type OrientationOption = 'portrait' | 'landscape';
type ColorModeOption = 'color' | 'mono';

type PdfSectionKey = 'summary' | 'listing' | 'reservations' | 'surveys' | 'correlation' | 'appendix';

export interface PdfSectionSelection {
  summary: boolean;
  listing: boolean;
  reservations: boolean;
  surveys: boolean;
  correlation: boolean;
  appendix: boolean;
}

export interface PdfExportOptions {
  orientation: OrientationOption;
  colorMode: ColorModeOption;
  sections: PdfSectionSelection;
}

interface ListingSummary {
  label: string;
  totalCV: number;
  totalAmount: number;
  avgCVR: number;
  avgCPA: number;
  validDays: number;
}

function filterListingByMonth(records: ListingRecord[], month: string | null): ListingRecord[] {
  if (!month) return records;
  return records.filter(record => getMonthKeyJST(record.date) === month);
}

function calculateListingSummary(records: ListingRecord[]): ListingSummary {
  const totalCV = records.reduce<number>((sum, record) => sum + (record.cv ?? 0), 0);
  const totalAmount = records.reduce<number>((sum, record) => sum + (record.amount ?? 0), 0);
  const validCVRs = records.filter(record => record.cvr !== null).map(record => record.cvr ?? 0);
  const avgCVR = validCVRs.length > 0
    ? validCVRs.reduce<number>((sum, cvr) => sum + cvr, 0) / validCVRs.length
    : 0;
  const avgCPA = totalCV > 0 ? totalAmount / totalCV : 0;

  const validDates = new Set(records.map(record => formatDateJST(record.date)));

  return {
    label: '',
    totalCV,
    totalAmount,
    avgCVR,
    avgCPA,
    validDays: validDates.size
  };
}

function filterSurveyByMonth(records: SurveyRecord[], month: string | null): SurveyRecord[] {
  if (!month) return records;
  return records.filter(record => getMonthKeyJST(record.date) === month);
}

function summarizeSurvey(records: SurveyRecord[]) {
  const channelTotals = new Map<string, number>();
  let totalResponses = 0;

  records.forEach(record => {
    Object.entries(record.channels ?? {}).forEach(([channel, value]) => {
      const amount = value ?? 0;
      totalResponses += amount;
      channelTotals.set(channel, (channelTotals.get(channel) ?? 0) + amount);
    });
    if (record.feverGoogle !== null && record.feverGoogle !== undefined) {
      totalResponses += record.feverGoogle;
      channelTotals.set('発熱外来(Google)', (channelTotals.get('発熱外来(Google)') ?? 0) + (record.feverGoogle ?? 0));
    }
  });

  const topChannels = Array.from(channelTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return { totalResponses, topChannels };
}

function toGrayscale(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
  context.putImageData(imageData, 0, 0);
}

async function captureElement(selector: string, colorMode: ColorModeOption): Promise<string | null> {
  const element = document.querySelector(selector) as HTMLElement | null;
  if (!element) {
    return null;
  }

  const canvas = await html2canvas(element, {
    background: '#ffffff'
  });

  if (colorMode === 'mono') {
    toGrayscale(canvas);
  }

  return canvas.toDataURL('image/png');
}

function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat('ja-JP', options).format(Math.round(value));
}

export function usePdfExport() {
  const {
    listingInternal,
    listingGastroscopy,
    listingColonoscopy,
    reservations,
    surveyOutpatient,
    surveyEndoscopy,
    selectedMonth
  } = useData();

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportPdf = useCallback(async (options: PdfExportOptions) => {
    setIsGenerating(true);
    setError(null);

    try {
      const doc = new jsPDF({
        orientation: options.orientation,
        unit: 'mm',
        format: 'a4'
      });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      const periodLabel = selectedMonth ? `${selectedMonth} 月` : '全期間';
      const generatedAt = new Date();

      // Cover page
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.text('マルミエ 分析レポート', PAGE_MARGIN, PAGE_MARGIN + 20);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(12);
      doc.text(`対象期間: ${periodLabel}`, PAGE_MARGIN, PAGE_MARGIN + 36);
      doc.text(`生成日時: ${generatedAt.toLocaleString('ja-JP', { hour12: false })}`, PAGE_MARGIN, PAGE_MARGIN + 46);
      doc.text('データソース: ローカルCSV / JSON', PAGE_MARGIN, PAGE_MARGIN + 56);

      // Summary page
      if (options.sections.summary) {
        doc.addPage();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text('月次サマリー', PAGE_MARGIN, PAGE_MARGIN + 10);

        const summaries: ListingSummary[] = [
          { ...calculateListingSummary(filterListingByMonth(listingInternal, selectedMonth)), label: '内科' },
          { ...calculateListingSummary(filterListingByMonth(listingGastroscopy, selectedMonth)), label: '胃カメラ' },
          { ...calculateListingSummary(filterListingByMonth(listingColonoscopy, selectedMonth)), label: '大腸カメラ' }
        ];

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        let offset = PAGE_MARGIN + 22;

        summaries.forEach(summary => {
          if (summary.validDays === 0) return;
          doc.text(`● ${summary.label}`, PAGE_MARGIN, offset);
          offset += 6;
          doc.text(`合計CV: ${formatNumber(summary.totalCV)} 件`, PAGE_MARGIN + 6, offset);
          offset += 6;
          doc.text(`総広告費: ¥${formatNumber(summary.totalAmount)}`, PAGE_MARGIN + 6, offset);
          offset += 6;
          doc.text(`平均CVR: ${(summary.avgCVR * 100).toFixed(1)}% / 平均CPA: ¥${formatNumber(summary.avgCPA)}`, PAGE_MARGIN + 6, offset);
          offset += 10;
        });

        const monthReservations = filterReservationsByMonth(reservations, selectedMonth);
        const initialCount = monthReservations
          .filter(record => record.type === '初診')
          .reduce((sum, record) => sum + record.count, 0);
        const repeatCount = monthReservations
          .filter(record => record.type === '再診')
          .reduce((sum, record) => sum + record.count, 0);
        const sameDayCount = monthReservations
          .filter(record => record.isSameDay)
          .reduce((sum, record) => sum + record.count, 0);

        doc.text('予約概要', PAGE_MARGIN, offset);
        offset += 6;
        doc.text(`初診: ${formatNumber(initialCount)} 件 / 再診: ${formatNumber(repeatCount)} 件`, PAGE_MARGIN + 6, offset);
        offset += 6;
        doc.text(`当日予約: ${formatNumber(sameDayCount)} 件`, PAGE_MARGIN + 6, offset);
        offset += 10;

        const outpatientSurvey = summarizeSurvey(filterSurveyByMonth(surveyOutpatient, selectedMonth));
        const endoscopySurvey = summarizeSurvey(filterSurveyByMonth(surveyEndoscopy, selectedMonth));

        doc.text('アンケート概要', PAGE_MARGIN, offset);
        offset += 6;
        doc.text(`外来: ${formatNumber(outpatientSurvey.totalResponses)} 件 / 内視鏡: ${formatNumber(endoscopySurvey.totalResponses)} 件`, PAGE_MARGIN + 6, offset);
        offset += 6;
        doc.text('主要チャネル', PAGE_MARGIN + 6, offset);
        offset += 6;

        outpatientSurvey.topChannels.slice(0, 3).forEach(([channel, value]) => {
          doc.text(`- 外来 ${channel}: ${formatNumber(value)} 件`, PAGE_MARGIN + 10, offset);
          offset += 5;
        });
        endoscopySurvey.topChannels.slice(0, 3).forEach(([channel, value]) => {
          doc.text(`- 内視鏡 ${channel}: ${formatNumber(value)} 件`, PAGE_MARGIN + 10, offset);
          offset += 5;
        });
      }

      const sectionSelectors: Array<{ key: PdfSectionKey; selector: string; title: string }> = [
        { key: 'listing', selector: '#listing', title: 'リスティング分析' },
        { key: 'reservations', selector: '#reservations', title: '予約分析' },
        { key: 'surveys', selector: '#surveys', title: 'アンケート分析' },
        { key: 'correlation', selector: '#correlation', title: '相関分析' }
      ];

      for (const section of sectionSelectors) {
        if (!options.sections[section.key]) continue;
        const imageUrl = await captureElement(section.selector, options.colorMode);
        if (!imageUrl) continue;

        doc.addPage();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text(section.title, PAGE_MARGIN, PAGE_MARGIN + 8);

        const imageProps = doc.getImageProperties(imageUrl);
        const availableWidth = pageWidth - PAGE_MARGIN * 2;
        const availableHeight = pageHeight - PAGE_MARGIN * 2 - 10;
        const ratio = Math.min(availableWidth / imageProps.width, availableHeight / imageProps.height);
        const imgWidth = imageProps.width * ratio;
        const imgHeight = imageProps.height * ratio;

        doc.addImage(imageUrl, 'PNG', PAGE_MARGIN, PAGE_MARGIN + 12, imgWidth, imgHeight);
      }

      if (options.sections.appendix) {
        doc.addPage();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text('データ付録', PAGE_MARGIN, PAGE_MARGIN + 8);

        const months = new Set<string>();
        listingInternal.forEach(record => months.add(getMonthKeyJST(record.date)));
        listingGastroscopy.forEach(record => months.add(getMonthKeyJST(record.date)));
        listingColonoscopy.forEach(record => months.add(getMonthKeyJST(record.date)));
        reservations.forEach(record => months.add(getMonthKeyJST(record.dateTime)));
        surveyOutpatient.forEach(record => months.add(getMonthKeyJST(record.date)));
        surveyEndoscopy.forEach(record => months.add(getMonthKeyJST(record.date)));

        const appendixLines = [
          `内科リスティング: ${listingInternal.length} 行`,
          `胃カメリスティング: ${listingGastroscopy.length} 行`,
          `大腸カメリスティング: ${listingColonoscopy.length} 行`,
          `予約ログ: ${reservations.length} 行`,
          `外来アンケート: ${surveyOutpatient.length} 行`,
          `内視鏡アンケート: ${surveyEndoscopy.length} 行`,
          `対象月数: ${months.size}`
        ];

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        appendixLines.forEach((line, index) => {
          doc.text(line, PAGE_MARGIN, PAGE_MARGIN + 20 + index * 8);
        });
      }

      const fileName = `marumie_report_${generatedAt.getFullYear()}${String(generatedAt.getMonth() + 1).padStart(2, '0')}${String(generatedAt.getDate()).padStart(2, '0')}_${String(generatedAt.getHours()).padStart(2, '0')}${String(generatedAt.getMinutes()).padStart(2, '0')}.pdf`;
      doc.save(fileName);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PDF出力に失敗しました';
      setError(message);
      throw err;
    } finally {
      setIsGenerating(false);
    }
  }, [
    listingInternal,
    listingGastroscopy,
    listingColonoscopy,
    reservations,
    surveyOutpatient,
    surveyEndoscopy,
    selectedMonth
  ]);

  const resetError = useCallback(() => setError(null), []);

  return {
    exportPdf,
    isGenerating,
    error,
    resetError
  };
}
