"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Save, Sparkles } from "lucide-react";

import { CsvUploadCard } from "@/components/csv-upload-card";
import { DataOverview } from "@/components/data-overview";
import { MonthSelector } from "@/components/month-selector";
import { ReservationHeatmap } from "@/components/reservation-heatmap";
import { ReservationTrendChart } from "@/components/reservation-trend-chart";
import { SectionCard } from "@/components/section-card";
import { extractMonthOptions } from "@/lib/date";
import {
  buildTrendDataset,
  collectDepartmentPalette,
  computeDepartmentStats,
  extractTopDepartments,
  filterReservationsByMonth,
  parseReservations,
} from "@/lib/reservations";
import { parseListingColonoscopy, parseListingGastroscopy, parseListingInternal } from "@/lib/listings";
import { parseSurveyEndoscopy, parseSurveyOutpatient } from "@/lib/surveys";
import { CsvFileDefinition, CsvKind, CsvStatus, DataState } from "@/lib/types";

const CSV_FILES: CsvFileDefinition[] = [
  {
    key: "reservations",
    title: "予約ログ (reservations.csv)",
    description: "診療科×初診/再診の予約実績を読み込みます。",
    helper: "必須列: 予約日時, 診療科, 初診/再診, 件数",
  },
  {
    key: "listingInternal",
    title: "内科リスティング (listing-internal.csv)",
    description: "日別の広告費・CV・時間帯別CVを取り込みます。",
    helper: "必須列: 日付, 金額, CV, CVR, CPA, 0時〜23時",
  },
  {
    key: "listingGastroscopy",
    title: "胃カメラリスティング (listing-gastroscopy.csv)",
    description: "胃カメラ向け広告の実績を読み込みます。",
    helper: "必須列構成は内科リスティングと同じです。",
  },
  {
    key: "listingColonoscopy",
    title: "大腸カメラリスティング (listing-colonoscopy.csv)",
    description: "大腸カメラ向け広告の実績を読み込みます。",
    helper: "必須列構成は内科リスティングと同じです。",
  },
  {
    key: "surveyOutpatient",
    title: "外来アンケート (survey-outpatient.csv)",
    description: "外来患者の流入チャネルを読み込みます。",
    helper: "必須列: 日付, チャネル列 (Google, Instagram等)",
  },
  {
    key: "surveyEndoscopy",
    title: "内視鏡アンケート (survey-endoscopy.csv)",
    description: "内視鏡患者の流入チャネルを読み込みます。",
    helper: "必須列構成は外来アンケートと同じです。",
  },
];

type ParserResultMap = {
  reservations: ReturnType<typeof parseReservations>;
  listingInternal: ReturnType<typeof parseListingInternal>;
  listingGastroscopy: ReturnType<typeof parseListingGastroscopy>;
  listingColonoscopy: ReturnType<typeof parseListingColonoscopy>;
  surveyOutpatient: ReturnType<typeof parseSurveyOutpatient>;
  surveyEndoscopy: ReturnType<typeof parseSurveyEndoscopy>;
};

const INITIAL_DATA: DataState = {
  reservations: [],
  listingInternal: [],
  listingGastroscopy: [],
  listingColonoscopy: [],
  surveyOutpatient: [],
  surveyEndoscopy: [],
};

export default function Home() {
  const [data, setData] = useState<DataState>(INITIAL_DATA);
  const [statuses, setStatuses] = useState<Partial<Record<CsvKind, CsvStatus>>>({});
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const handleUpload = async (kind: CsvKind, file: File) => {
    const text = await file.text();
    const timestamp = new Date();

    const applyStatus = (status: CsvStatus) => {
      setStatuses((prev) => ({
        ...prev,
        [kind]: { ...status, updatedAt: timestamp },
      }));
    };

    switch (kind) {
      case "reservations": {
        const result: ParserResultMap["reservations"] = parseReservations(text);
        setData((prev) => ({
          ...prev,
          reservations: result.data,
        }));
        applyStatus({
          errors: result.errors,
          warnings: result.warnings,
          rowCount: result.data.length,
        });
        return;
      }
      case "listingInternal": {
        const result = parseListingInternal(text);
        setData((prev) => ({
          ...prev,
          listingInternal: result.data,
        }));
        applyStatus({
          errors: result.errors,
          warnings: result.warnings,
          rowCount: result.data.length,
        });
        return;
      }
      case "listingGastroscopy": {
        const result = parseListingGastroscopy(text);
        setData((prev) => ({
          ...prev,
          listingGastroscopy: result.data,
        }));
        applyStatus({
          errors: result.errors,
          warnings: result.warnings,
          rowCount: result.data.length,
        });
        return;
      }
      case "listingColonoscopy": {
        const result = parseListingColonoscopy(text);
        setData((prev) => ({
          ...prev,
          listingColonoscopy: result.data,
        }));
        applyStatus({
          errors: result.errors,
          warnings: result.warnings,
          rowCount: result.data.length,
        });
        return;
      }
      case "surveyOutpatient": {
        const result = parseSurveyOutpatient(text);
        setData((prev) => ({
          ...prev,
          surveyOutpatient: result.data,
        }));
        applyStatus({
          errors: result.errors,
          warnings: result.warnings,
          rowCount: result.data.length,
        });
        return;
      }
      case "surveyEndoscopy": {
        const result = parseSurveyEndoscopy(text);
        setData((prev) => ({
          ...prev,
          surveyEndoscopy: result.data,
        }));
        applyStatus({
          errors: result.errors,
          warnings: result.warnings,
          rowCount: result.data.length,
        });
        return;
      }
      default:
        return;
    }
  };

  const monthOptions = useMemo(() => {
    const reservationDates = data.reservations.map((record) => record.dateTime);
    return extractMonthOptions(reservationDates);
  }, [data.reservations]);

  useEffect(() => {
    if (monthOptions.length === 0) {
      setSelectedMonth(null);
      return;
    }
    const latest = monthOptions[monthOptions.length - 1];
    setSelectedMonth((prev) => (prev && monthOptions.includes(prev) ? prev : latest));
  }, [monthOptions]);

  const filteredReservations = useMemo(
    () => filterReservationsByMonth(data.reservations, selectedMonth),
    [data.reservations, selectedMonth],
  );

  const reservationStats = useMemo(
    () => computeDepartmentStats(filteredReservations),
    [filteredReservations],
  );

  const focusDepartments = useMemo(
    () => extractTopDepartments(reservationStats, 4),
    [reservationStats],
  );

  const trendDataset = useMemo(
    () => buildTrendDataset(reservationStats, focusDepartments),
    [reservationStats, focusDepartments],
  );

  const palette = useMemo(
    () => collectDepartmentPalette(focusDepartments),
    [focusDepartments],
  );

  const reservationCount = data.reservations.length;
  const listingCount =
    data.listingInternal.length +
    data.listingGastroscopy.length +
    data.listingColonoscopy.length;
  const surveyCount =
    data.surveyOutpatient.length + data.surveyEndoscopy.length;

  return (
    <main className="relative mx-auto min-h-screen max-w-6xl px-6 pb-24 pt-16 sm:px-10 lg:px-12">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/10 via-surface to-surface" />
      <div className="absolute right-4 top-4 -z-10 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
      <div className="rounded-[32px] border border-border/60 bg-panel/90 p-8 shadow-2xl shadow-primary/10 backdrop-blur">
        <header className="flex flex-col gap-6 border-b border-border/70 pb-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs uppercase tracking-[0.4em] text-primary">
              <Sparkles className="h-4 w-4" />
              marumie analytics
            </p>
            <h1 className="mt-4 text-3xl font-semibold leading-tight text-muted sm:text-4xl">
              マルミエ ダッシュボード
            </h1>
            <p className="mt-2 text-sm text-muted/80">
              CSVをドラッグ＆ドロップするだけで、広告・予約・アンケートを横断可視化。
              ローカル保存とPDF出力へ向けた土台が整いました。
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <MonthSelector
              months={monthOptions}
              value={selectedMonth}
              onChange={setSelectedMonth}
            />
            <div className="flex items-center gap-2 text-xs text-muted/50">
              <Save className="h-4 w-4" />
              <span>データ保存・PDF出力は次フェーズで実装予定</span>
            </div>
          </div>
        </header>

        <div className="mt-8 flex flex-col gap-10">
          <SectionCard
            title="データインポート"
            description="ローカルCSVと解析ロジックを完全クライアントサイドで実行し、プライバシーを保持したまま分析を開始します。"
            action={
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold text-primary hover:bg-primary/20"
              >
                <Download className="h-4 w-4" />
                CSVテンプレート
              </button>
            }
          >
            <div className="grid gap-4 lg:grid-cols-2">
              {CSV_FILES.map((file) => (
                <CsvUploadCard
                  key={file.key}
                  title={file.title}
                  description={file.description}
                  helper={file.helper}
                  accept=".csv,text/csv"
                  status={statuses[file.key]}
                  onUpload={(uploaded) => handleUpload(file.key, uploaded)}
                />
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="データサマリー"
            description="読み込んだデータ件数を確認し、解析対象のボリューム感を把握します。"
          >
            <DataOverview
              reservationCount={reservationCount}
              listingCount={listingCount}
              surveyCount={surveyCount}
              availableMonths={monthOptions.length}
            />
          </SectionCard>

          <SectionCard
            title="時間帯ヒートマップ"
            description="診療科×初診/再診の組み合わせごとに、時間帯別の予約ピークを可視化します。"
          >
            <ReservationHeatmap stats={reservationStats} focusDepartments={focusDepartments} />
          </SectionCard>

          <SectionCard
            title="日別推移折れ線グラフ"
            description="主要診療科の初診・再診件数をライン種別で可視化し、日単位の動きを把握します。"
          >
            <ReservationTrendChart
              data={trendDataset}
              departments={focusDepartments}
              colorMap={palette}
            />
          </SectionCard>
        </div>
      </div>
    </main>
  );
}
